import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Kpi, PageHead, SEV_LABEL, SevBadge, fmtDate, type Col } from "../ui";
import { formatCompact, formatPct } from "@shared/money";
import { PROFILES, type ProfileKey } from "@shared/riskprofile";
import type { ClientOverview, AttentionItem } from "../../server/overview";

interface Overview { asOf: string; clients: ClientOverview[]; attention: AttentionItem[]; totals: { liveClients: number; caseStudies: number; liveGrossAssets: number | null } }

export function ClientsPage() {
  const { setClientId, clientId } = useApp();
  const nav = useNavigate();
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<Overview>("/api/overview").then(setO).catch((e) => setErr(e.message)); }, []);
  if (err) return <Banner tone="crit">{err}</Banner>;
  if (!o) return null;
  const open = (id: string, to = "/") => { setClientId(id); nav(to); };
  const cols: Col<ClientOverview>[] = [
    { key: "name", label: "Client", render: (c) => <><b>{c.name}</b> {c.kind === "case" && <Badge tone="outline">case study</Badge>} {c.id === clientId && <Badge tone="info">open</Badge>}</>, sort: (c) => c.name },
    { key: "gross", label: "Gross assets", right: true, render: (c) => formatCompact(c.grossAssets), sort: (c) => c.grossAssets },
    { key: "nw", label: "Net worth", right: true, render: (c) => (c.netWorth == null ? <span className="muted">Awaiting data</span> : formatCompact(c.netWorth)), sort: (c) => c.netWorth },
    { key: "health", label: "Health score", right: true, render: (c) => (c.healthScore == null ? <span className="muted">—</span> : <>{c.healthScore.toFixed(0)}{c.healthProvisional && <span className="muted small"> provisional</span>}</>), sort: (c) => c.healthScore },
    { key: "alerts", label: "Open alerts", render: (c) => { const t = c.openAlerts.critical + c.openAlerts.high + c.openAlerts.warning + c.openAlerts.info; return t === 0 ? <span className="muted">none</span> : <span className="row" style={{ gap: 4 }}>{c.openAlerts.critical > 0 && <Badge tone="crit">{c.openAlerts.critical} critical</Badge>}{c.openAlerts.high > 0 && <Badge tone="serious">{c.openAlerts.high} high</Badge>}{c.openAlerts.warning > 0 && <Badge tone="warn">{c.openAlerts.warning} warning</Badge>}{c.openAlerts.info > 0 && <Badge tone="info">{c.openAlerts.info} notice</Badge>}</span>; },
      sort: (c) => c.openAlerts.critical * 1000 + c.openAlerts.high * 100 + c.openAlerts.warning * 10 + c.openAlerts.info },
    { key: "nom", label: "Nominations", right: true, render: (c) => (c.nominationCoveredPct == null ? <span className="muted">not recorded</span> : formatPct(c.nominationCoveredPct, 0)), sort: (c) => c.nominationCoveredPct },
    { key: "risk", label: "Risk profile", render: (c) => (c.riskProfile ? PROFILES[c.riskProfile as ProfileKey]?.label ?? c.riskProfile : <span className="muted">not assessed</span>), sort: (c) => c.riskProfile },
  ];
  return (
    <>
      <PageHead title="All clients" subtitle="Every client in your organisation at a glance. Click a row to open that client." />
      <div className="stack">
        <div className="kpi-group">
          <Kpi label="Clients" value={o.totals.liveClients} sub={`${o.totals.caseStudies} illustrative case stud${o.totals.caseStudies === 1 ? "y" : "ies"} not counted`} />
          <Kpi label="Total gross assets (clients)" value={o.totals.liveGrossAssets == null ? undefined : formatCompact(o.totals.liveGrossAssets)} await={o.totals.liveGrossAssets == null} sub="Case studies excluded" />
          <Kpi label="Needing attention" value={o.attention.filter((a) => a.severity === "critical" || a.severity === "high").length} sub="critical or high alerts open" tone={o.attention.some((a) => a.severity === "critical") ? "crit" : ""} />
        </div>
        <Card title="Clients" pad={false}>
          <div className="card-b"><DataTable cols={cols.map((c) => c)} rows={o.clients} onRow={(c) => open(c.id)} search={(c) => c.name} defaultSort={{ key: "alerts", dir: -1 }} empty={<Empty title="No clients yet" />} /></div>
        </Card>
        <Card title="Attention queue" subtitle="Most severe open alerts across all clients (data-gap notices excluded). Click to open the alert." pad={false}>
          <div className="card-b">{o.attention.length === 0 ? <Empty title="Nothing needs attention" /> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Severity</th><th>Client</th><th>Alert</th><th>Detected</th></tr></thead>
              <tbody>{o.attention.map((a) => <tr key={a.alertId} style={{ cursor: "pointer" }} onClick={() => open(a.clientId, `/alerts?open=${a.alertId}`)}><td><SevBadge s={a.severity} /></td><td>{a.clientName}</td><td>{a.ruleName}{a.subject ? ` (${a.subject})` : ""}</td><td className="nowrap">{fmtDate(a.firstDetectedAt)}</td></tr>)}</tbody></table></div>)}</div>
        </Card>
        <p className="small muted">Severity labels: {Object.values(SEV_LABEL).join(", ")}. Figures are as of {fmtDate(o.asOf)}.</p>
      </div>
    </>
  );
}
