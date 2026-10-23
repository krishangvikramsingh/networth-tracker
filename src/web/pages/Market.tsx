import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, DataTable, Empty, Icon, ICONS, PageHead, fmtDate, fmtDateTime } from "../ui";
import { formatCompact } from "@shared/money";

const LIVE_LABEL: Record<string, [string, "good" | "warn" | "info" | "serious"]> = { "demo-data": ["Demo data", "warn"], "implemented-unverified": ["Implemented · not verified live", "info"], "needs-credentials": ["Needs credentials", "serious"], "manual-upload": ["Manual upload", "good"] };

export function MarketPage() {
  const { clientId, run, canWrite, toast, state } = useApp();
  const [m, setM] = useState<any>(null);
  const [props, setProps] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [incl, setIncl] = useState(false);
  const [csv, setCsv] = useState("symbol,date,value,currency\nNIFTY500,2026-10-16,22310.55,INR\n");
  const [busy, setBusy] = useState("");
  const load = () => { api.get("/api/market/status").then(setM); api.get(`/api/clients/${clientId}/market/proposals?includeManual=${incl ? 1 : 0}`).then((r) => setProps(r.proposals)); };
  useEffect(load, [clientId, incl, state?.serverTime]);
  async function refresh(provider: string) {
    setBusy(provider);
    try { const r = await api.post("/api/market/refresh", { provider }); toast(r.message, r.ok ? "ok" : "err"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); } finally { setBusy(""); }
  }
  if (!m) return null;
  const applicable = props.filter((p) => p.newValue != null);
  return (
    <>
      <PageHead title="Market data" subtitle="Provider architecture for NIFTY 500, S&P 500, mutual-fund NAVs, bonds, commodity funds, REITs and InvITs. Every value shows its source and as-of date; simulated data is never presented as live." />
      <Banner tone="warn" title="Honest status.">No licensed market-data credentials are configured in this build and the public AMFI endpoint could not be reached from the build sandbox, so <b>nothing here has been verified as live</b>. The demo provider supplies clearly labelled sample values; manual CSV upload works fully.</Banner>
      <div className="stack" style={{ marginTop: 16 }}>
        <Card title="Providers" pad={false}><div className="card-b"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Provider</th><th>Covers</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>
          {m.providers.map((p: any) => (<tr key={p.id}><td><b>{p.name}</b></td><td className="small">{p.covers.slice(0, 4).join(", ")}</td><td><Badge tone={LIVE_LABEL[p.liveStatus][1]}>{LIVE_LABEL[p.liveStatus][0]}</Badge>{p.requiresCredentials && <div className="small muted">env {p.credentialEnv} {p.configured ? "set" : "missing"}</div>}</td><td className="small sec">{p.notes}{p.terms && <div className="muted">{p.terms}</div>}</td>
            <td>{p.id !== "manual" && <button className="btn sm" disabled={!canWrite || busy === p.id} onClick={() => refresh(p.id)}><Icon d={ICONS.up} size={13} />{busy === p.id ? "…" : "Refresh"}</button>}</td></tr>))}</tbody></table></div></div></Card>
        <Card title="Latest observations" subtitle="Validated, timestamped, cached. Failed refreshes keep the previous valid value.">
          <DataTable dense rows={m.observations.map((o: any) => ({ ...o, id: o.symbol }))} search={(o: any) => `${o.symbol} ${o.name}`} empty={<Empty title="No observations yet">Use Refresh on the demo provider or upload a CSV.</Empty>}
            cols={[{ key: "s", label: "Instrument", render: (o: any) => <div><b>{o.name}</b><div className="small muted">{o.symbol} · {o.kind}</div></div> }, { key: "v", label: "Value", right: true, render: (o: any) => `${o.currency === "USD" ? "$" : "₹"}${o.value.toLocaleString("en-IN")}` }, { key: "a", label: "As of", render: (o: any) => fmtDate(o.asOf) },
              { key: "f", label: "Fetched", render: (o: any) => fmtDateTime(o.fetchedAt) }, { key: "src", label: "Source", render: (o: any) => <span>{o.source} {o.isDemo && <Badge tone="warn">sample</Badge>}</span> }, { key: "st", label: "Freshness", render: (o: any) => (o.stale ? <Badge tone="serious">stale ({o.ageDays}d)</Badge> : <Badge tone="good">fresh</Badge>) }]} />
          {m.lastRefresh.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Last refresh: {m.lastRefresh[0].provider} · {fmtDateTime(m.lastRefresh[0].at)} · {m.lastRefresh[0].ok ? "ok" : "failed"} — {m.lastRefresh[0].message}</p>}
        </Card>
        <Card title="Apply prices to holdings" subtitle="Quantity × latest price (× FX for USD). You confirm each valuation; manual valuations are protected.">
          <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} />Include holdings with manual valuations</label>
          {props.length === 0 ? <Empty title="No holdings are linked to a price">Give a holding a symbol (scheme code / ticker) and quantity to value it from market data.</Empty> : (
            <table className="tbl"><thead><tr><th></th><th>Holding</th><th className="r">Now</th><th className="r">Proposed</th><th>Price</th></tr></thead><tbody>{props.map((p) => (
              <tr key={p.holdingId}><td><input type="checkbox" aria-label={`Select ${p.name}`} disabled={p.newValue == null} checked={sel.has(p.holdingId)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(p.holdingId) : n.delete(p.holdingId); setSel(n); }} /></td><td>{p.name}<div className="small muted">{p.symbol} × {p.quantity}</div></td><td className="r num">{formatCompact(p.oldValue)}</td><td className="r num">{p.newValue == null ? "—" : formatCompact(p.newValue)}</td><td className="small">{p.skipped ?? `${p.price} ${p.currency} @ ${p.priceAsOf}${p.fx ? ` · FX ${p.fx}` : ""}`}</td></tr>))}</tbody></table>)}
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={!canWrite || !applicable.some((p) => sel.has(p.holdingId))} onClick={() => run(async () => { await api.post(`/api/clients/${clientId}/market/apply`, { holdingIds: [...sel], includeManual: incl }); setSel(new Set()); }, "Valuations updated")}>Apply selected</button></div>
        </Card>
        <Card title="Manual CSV upload" subtitle="symbol,date,value[,currency,kind] — stored as user-supplied observations after validation (positive, not future-dated, no >50% jumps)">
          <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV observations" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
          <div style={{ marginTop: 8 }}><button className="btn" disabled={!canWrite} onClick={async () => { try { const r = await api.postText("/api/market/manual", csv); toast(`Stored ${r.stored}, rejected ${r.rejected.length}${r.rejected[0] ? ` (${r.rejected[0].symbol}: ${r.rejected[0].reason})` : ""}`, r.rejected.length ? "err" : "ok"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); } }}>Store observations</button></div>
        </Card>
      </div>
    </>
  );
}
