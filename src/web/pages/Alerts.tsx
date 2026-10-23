import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, Modal, PageHead, SevBadge, Tabs, fmtDateTime } from "../ui";
import type { AlertRow } from "../../server/alerts";

type Tab = "open" | "acknowledged" | "resolved" | "data";
const ORDER = { critical: 0, high: 1, warning: 2, info: 3 } as const;
const REC_LINK = { holding: "/assets", liability: "/assets?tab=liabilities", commitment: "/assets?tab=commitments", policy: "/assets?tab=insurance", goal: "/goals", cashflow: "/cashflow", metric: "/" } as const;

export function AlertsPage() {
  const { state } = useApp();
  const [sp, setSp] = useSearchParams();
  const all = state!.alerts;
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "open");
  const [sev, setSev] = useState("");
  const openId = sp.get("open");
  const sel = openId ? all.find((a) => a.id === openId) : null;
  const groups: Record<Tab, AlertRow[]> = {
    open: all.filter((a) => a.status === "open" && a.kind !== "data_gap"), acknowledged: all.filter((a) => a.status === "acknowledged" && a.kind !== "data_gap"),
    resolved: all.filter((a) => a.status === "resolved"), data: all.filter((a) => a.kind === "data_gap" && a.status !== "resolved"),
  };
  const rows = groups[tab].filter((a) => !sev || a.severity === sev).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.firstDetectedAt.localeCompare(a.firstDetectedAt));
  const count = (s: string) => groups.open.filter((a) => a.severity === s).length;
  useEffect(() => { if (openId && sel) { const t = sel.status === "resolved" ? "resolved" : sel.kind === "data_gap" ? "data" : sel.status; setTab(t as Tab); } }, [openId]);
  return (
    <>
      <PageHead title="Alerts & recommendations" subtitle="One persistent inbox. An alert is created when a condition starts, updated when it changes, and resolved when it clears — refreshing never duplicates it." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {(["critical", "high", "warning", "info"] as const).map((s) => <div key={s} className="kpi"><div className="lbl"><SevBadge s={s} /></div><div className="val num">{count(s)}</div><div className="sub">open {s === "info" ? "notices" : s}</div></div>)}
      </div>
      <Tabs<Tab> value={tab} onChange={(t) => { setTab(t); setSp((p) => { p.delete("open"); p.set("tab", t); return p; }); }} tabs={[{ id: "open", label: "Open", count: groups.open.length }, { id: "acknowledged", label: "Acknowledged", count: groups.acknowledged.length }, { id: "data", label: "Data notices", count: groups.data.length }, { id: "resolved", label: "Resolved", count: groups.resolved.length }]} />
      <div className="toolbar"><select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)} style={{ width: "auto" }}><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="warning">Warning</option><option value="info">Notice</option></select></div>
      {tab === "data" && <div style={{ marginBottom: 12 }}><Banner>These rules cannot run yet because information is missing. They are not “all clear” — they are unknown. Supply the data on the <Link to="/data">Data collection</Link> page.</Banner></div>}
      <Card pad={false}>
        {rows.length === 0 ? <div className="card-b"><Empty title={tab === "open" ? "No open alerts" : tab === "data" ? "No data notices" : "Nothing here"}>{tab === "open" ? "Every evaluable rule is within its limit. Rules without enough data appear under Data notices." : undefined}</Empty></div>
          : rows.map((a) => (
            <button key={a.id} className="alert-row" onClick={() => setSp((p) => { p.set("open", a.id); return p; })}>
              <span className={`sev ${a.severity}`} />
              <span><b>{a.ruleName}</b> <span className="muted">· {a.subject}</span> {a.kind === "possible" && <Badge tone="warn">possible</Badge>} {a.provisional && a.kind !== "possible" && <Badge tone="outline">provisional</Badge>}
                <div className="small sec" style={{ marginTop: 2 }}>{a.why}</div><div className="small muted" style={{ marginTop: 3 }}>Detected {fmtDateTime(a.firstDetectedAt)}{a.status === "resolved" && a.resolvedAt ? ` · resolved ${fmtDateTime(a.resolvedAt)}` : ""}</div></span>
              <span className="right"><SevBadge s={a.severity} /><div className="small num" style={{ marginTop: 4 }}>{a.currentLabel}</div><div className="small muted">{a.thresholdLabel}</div></span>
            </button>))}
      </Card>
      {sel && <AlertDrawer a={sel} onClose={() => setSp((p) => { p.delete("open"); return p; })} />}
    </>
  );
}

function AlertDrawer({ a, onClose }: { a: AlertRow; onClose: () => void }) {
  const { clientId, run, canWrite } = useApp();
  const nav = useNavigate();
  return (
    <Modal drawer title={a.ruleName} onClose={onClose} footer={<>
      {canWrite && a.status === "open" && <button className="btn primary" onClick={() => run(() => api.post(`/api/clients/${clientId}/alerts/${a.id}/ack`), "Alert acknowledged")}>Acknowledge</button>}
      {canWrite && a.status === "acknowledged" && <button className="btn" onClick={() => run(() => api.post(`/api/clients/${clientId}/alerts/${a.id}/unack`), "Alert re-opened")}>Re-open</button>}
      <button className="btn" onClick={onClose}>Close</button></>}>
      <div className="stack">
        <div className="row"><SevBadge s={a.severity} /><Badge tone={a.status === "resolved" ? "good" : a.status === "acknowledged" ? "info" : "warn"}>{a.status}</Badge>{a.kind === "possible" && <Badge tone="warn">possible — depends on missing data</Badge>}{a.kind === "data_gap" && <Badge tone="info">data notice</Badge>}{a.provisional && <Badge tone="outline">provisional</Badge>}</div>
        <dl className="dl">
          <dt>Triggering metric</dt><dd>{a.ruleName} — {a.subject}</dd><dt>Current value</dt><dd className="num"><b>{a.currentLabel}</b></dd><dt>Configured threshold</dt><dd>{a.thresholdLabel}</dd>
          <dt>First detected</dt><dd>{fmtDateTime(a.firstDetectedAt)}</dd><dt>Last seen</dt><dd>{fmtDateTime(a.lastSeenAt)}</dd>{a.resolvedAt && <><dt>Resolved</dt><dd>{fmtDateTime(a.resolvedAt)}</dd></>}{a.acknowledgedAt && <><dt>Acknowledged</dt><dd>{fmtDateTime(a.acknowledgedAt)} by {a.acknowledgedBy}</dd></>}
        </dl>
        <Card title="Why this triggered"><p>{a.why}</p></Card>
        <Card title="Recommended action"><p>{a.action}</p>{a.effect && <p className="small sec" style={{ marginTop: 6 }}><b>Expected effect:</b> {a.effect}</p>}<p className="small muted" style={{ marginTop: 6 }}>A recommendation to review — never an automatic trade, redemption or transfer.</p></Card>
        {a.records.length > 0 && <Card title="Relevant records"><ul style={{ margin: 0, paddingLeft: 18 }}>{a.records.slice(0, 12).map((r, i) => <li key={i}><a href={REC_LINK[r.type] + (REC_LINK[r.type].includes("?") ? "&" : "?") + "q=" + encodeURIComponent(r.name)} onClick={(e) => { e.preventDefault(); nav(REC_LINK[r.type] + (REC_LINK[r.type].includes("?") ? "&" : "?") + "q=" + encodeURIComponent(r.name)); }}>{r.name}</a> <span className="muted small">({r.type})</span></li>)}</ul></Card>}
        <Card title="History">{a.events && a.events.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.events.map((e, i) => <li key={i}><b>{e.event}</b> · {fmtDateTime(e.at)}{e.detail ? ` — ${e.detail}` : ""}</li>)}</ul> : <p className="small muted">No events.</p>}</Card>
      </div>
    </Modal>
  );
}
