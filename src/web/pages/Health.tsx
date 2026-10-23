import { Link } from "react-router-dom";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, PageHead } from "../ui";
import { ChartCard, Meter, TrendChart } from "../charts";
import { fmtDate } from "../ui";

function Ring({ score, label, sub }: { score: number | null; label: string; sub: string }) {
  const r = 62, c = 2 * Math.PI * r, v = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = score == null ? "var(--border-strong)" : score >= 80 ? "var(--good)" : score >= 60 ? "var(--s3)" : score >= 40 ? "var(--s4)" : "var(--s2)";
  return (
    <div style={{ position: "relative", width: 170, height: 170 }} role="img" aria-label={score == null ? "Score unavailable" : `Score ${score.toFixed(0)} out of 100, ${label}`}>
      <svg width="170" height="170" viewBox="0 0 170 170"><circle cx="85" cy="85" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" /><circle cx="85" cy="85" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 85 85)" /></svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}><div><b className="num" style={{ fontSize: 36, letterSpacing: "-.03em" }}>{score == null ? "—" : score.toFixed(0)}</b><div className="small muted">/ 100</div><div style={{ fontWeight: 650, fontSize: 12, lineHeight: 1.2, maxWidth: 100, margin: "2px auto 0" }}>{label}</div><div className="small muted">{sub}</div></div></div>
    </div>
  );
}

export function HealthPage() {
  const { state } = useApp();
  const ev = state!.evaluation, h = ev.health, hist = state!.data.scoreHistory;
  const bands = [...state!.data.settings.scoreBands].sort((a, b) => a.min - b.min);
  return (
    <>
      <PageHead title="Financial health score" subtitle="An explainable 0–100 indicator built from six transparent components. It is an educational tool — not a CIBIL / credit-bureau score and not financial advice." />
      <div className="stack">
        <Card>
          <div className="row" style={{ gap: 28, alignItems: "center" }}>
            <Ring score={h.overall} label={h.band ?? "Not assessable"} sub={h.provisional ? "provisional" : "complete"} />
            <div style={{ flex: 1, minWidth: 260 }} className="stack">
              <div className="row">{h.provisional && <Badge tone="warn">Provisional</Badge>}{h.lowCoverage && <Badge tone="serious">Low coverage</Badge>}<Badge tone="outline">{(h.coverage * 100).toFixed(0)}% of weight assessed</Badge></div>
              <p className="sec">{h.disclosure}</p>
              <div className="small muted">Bands: {bands.map((b, i) => `${b.min}${i < bands.length - 1 ? `–${bands[i + 1].min - 1}` : "+"} ${b.label}`).join(" · ")}</div>
              <div className="small muted">{h.methodology} Weights are editable in <Link to="/rules">Rules & allocation → Scoring</Link>.</div>
            </div>
          </div>
        </Card>
        <div className="grid g2">
          {h.components.map((c) => (
            <Card key={c.key} title={c.label} subtitle={`Weight ${c.weight}%`} actions={c.assessed ? <Badge tone={c.provisional ? "warn" : "good"}>{c.provisional ? "provisional" : "assessed"}</Badge> : <Badge tone="info">not assessed</Badge>}>
              {c.assessed ? <div className="row between" style={{ marginBottom: 6 }}><b className="num" style={{ fontSize: 28 }}>{c.score!.toFixed(0)}</b><span className="small muted">out of 100</span></div> : <div style={{ marginBottom: 6 }}><b style={{ color: "var(--ink-3)" }}>Unassessed</b><span className="small muted"> — excluded and re-weighted, not scored as full or zero</span></div>}
              <Meter label={`${c.label} score`} parts={[{ value: c.score ?? 0, color: c.assessed ? "var(--s1)" : "var(--border)", label: "score" }, { value: 100 - (c.score ?? 0), color: "var(--surface-2)", label: "rest" }]} />
              <dl className="dl small" style={{ marginTop: 10 }}>{c.metrics.map((m) => <><dt key={m.label}>{m.label}</dt><dd className="num">{m.value}</dd></>)}</dl>
              <p className="small" style={{ marginTop: 8 }}><b>Why:</b> {c.reason}</p>
              <p className="small" style={{ marginTop: 4 }}><b>To improve:</b> {c.improvement}</p>
              <details className="small" style={{ marginTop: 6 }}><summary>Formula</summary><span className="sec">{c.formula}</span></details>
            </Card>))}
        </div>
        <ChartCard title="Score history" subtitle="One assessment is stored per day when the score can be calculated" height={220} table={{ headers: ["Date", "Score", "Weight assessed"], rows: hist.map((x) => [fmtDate(x.date), x.score.toFixed(0), `${(x.coverage * 100).toFixed(0)}%`]) }}
          empty={hist.length < 2 ? <Empty title="History builds over time">{hist.length === 0 ? "No stored assessments yet." : "One assessment stored so far; trends appear from the second."}</Empty> : undefined}>
          <TrendChart data={hist.map((x) => ({ label: fmtDate(x.date), score: x.score }))} series={[{ key: "score", label: "Score", color: "var(--s1)" }]} fmt={(v) => v.toFixed(0)} yFmt={(v) => String(v)} />
        </ChartCard>
        <Banner>Scores based on partial data are marked provisional and never imply precision they don’t have. A change in coverage (for example after you enter loans) can move the score even if nothing about your finances changed.</Banner>
      </div>
    </>
  );
}
