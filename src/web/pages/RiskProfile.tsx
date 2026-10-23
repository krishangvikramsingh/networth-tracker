import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, Kpi, PageHead, classLabel, fmtDate } from "../ui";
import { formatPct } from "@shared/money";
import { ASSET_CLASSES } from "@shared/taxonomy";
import { LIMITED_BY_TEXT, MODEL_PORTFOLIOS, PROFILES, PROFILE_KEYS, RISK_QUESTIONS, assessRisk, profileForScore, type Answers, type ProfileKey, type RiskQuestion } from "@shared/riskprofile";

interface Stored { id: string; date: string; answers: Answers; toleranceScore: number; capacityScore: number; profile: ProfileKey; limitedBy: string; createdAt: string; appliedAt: string | null }
const SECTIONS: Array<{ id: RiskQuestion["section"]; title: string; sub: string }> = [
  { id: "tolerance", title: "Willingness to take risk", sub: "How you feel and behave when markets fall." },
  { id: "capacity", title: "Ability to take risk", sub: "How much loss your finances can absorb. The profile follows the lower of the two." },
];

export function RiskProfilePage() {
  const { state, clientId, run, canWrite } = useApp();
  const ev = state!.evaluation;
  const [answers, setAnswers] = useState<Answers>({});
  const [saved, setSaved] = useState<Stored[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.get(`/api/clients/${clientId}/risk-profile`).then((r) => { setSaved(r.assessments); return r.assessments as Stored[]; });
  useEffect(() => { setSaved(null); setAnswers({}); setErr(null); load().then((l) => { if (l[0]) setAnswers(l[0].answers); }).catch((e) => setErr(e.message)); }, [clientId]);

  const res = useMemo(() => assessRisk(answers), [answers]);
  const latest = saved?.[0] ?? null;
  const unchanged = !!latest && RISK_QUESTIONS.every((q) => latest.answers[q.id] === answers[q.id]);
  const den = state!.data.settings.denominator;
  const rows = ev.allocation[den].filter((r) => r.inDenominator);
  const shown = res.profile ?? latest?.profile ?? null;
  const reserve = ev.emergencyCoverageMonths;

  async function save() {
    setErr(null);
    try { await api.post(`/api/clients/${clientId}/risk-profile`, { answers }); await load(); await run(async () => {}, "Risk profile saved"); } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save"); }
  }
  async function apply() {
    if (!confirm(`Replace the target allocation with the ${PROFILES[latest!.profile].label} model portfolio? Your current targets will be overwritten (the change is recorded in the audit trail).`)) return;
    await run(() => api.post(`/api/clients/${clientId}/risk-profile/apply`), "Target allocation updated from your risk profile");
    load();
  }
  const hint = (q: RiskQuestion) => q.id === "c_reserve" && reserve != null ? `Your records show about ${reserve.toFixed(1)} months of essential expenses in emergency-eligible assets. That figure is for reference; answer for savings outside this portfolio.` : null;

  return (
    <>
      <PageHead title="Risk profile" subtitle="Eight questions turn how much risk you are willing and able to take into a profile and an example allocation. A guide for discussion, not a recommendation." />
      <div className="stack">
        <Banner tone="info" title="Educational tool.">The model portfolios are illustrative examples, not a validated investment policy or advice. Applying one only fills in the target allocation; the policy stays marked as not validated until you confirm it.</Banner>
        {err && <Banner tone="crit">{err}</Banner>}
        <div className="grid g-main">
          <div className="stack">
            {SECTIONS.map((s) => (
              <Card key={s.id} title={s.title} subtitle={s.sub}>
                <div className="stack" style={{ gap: 16 }}>
                  {RISK_QUESTIONS.filter((q) => q.section === s.id).map((q) => (
                    <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0 }} disabled={!canWrite}>
                      <legend style={{ fontWeight: 600, marginBottom: 6 }}>{q.text}</legend>
                      <div className="stack" style={{ gap: 4 }}>
                        {q.options.map((o, i) => (
                          <label key={i} className="check"><input type="radio" name={q.id} checked={answers[q.id] === i} onChange={() => setAnswers({ ...answers, [q.id]: i })} />{o.label}</label>))}
                      </div>
                      {hint(q) && <div className="small muted" style={{ marginTop: 4 }}>{hint(q)}</div>}
                    </fieldset>))}
                </div>
              </Card>))}
          </div>

          <div className="stack">
            <Card title="Your result" subtitle={`${res.answered} of ${res.total} answered`}>
              {res.answered === 0 && !latest ? <Empty title="Answer the questions to see your profile" /> : (
                <div className="stack" style={{ gap: 10 }}>
                  {res.profile ? <div><div className="small muted">{res.complete ? "Profile" : "Already settled by your answers"}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{PROFILES[res.profile].label}</div><p className="small sec">{PROFILES[res.profile].description}</p></div>
                    : <div><div className="small muted">Profile</div><div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-3)" }}>Awaiting answers</div>
                      <p className="small sec">Still possible: <b>{PROFILES[res.range[0]].label}</b>{res.range[0] !== res.range[1] && <> to <b>{PROFILES[res.range[1]].label}</b></>}. Nothing is assumed for the questions you have not answered.</p></div>}
                  <div className="grid g2">
                    <Kpi label="Willingness" value={res.tolerance.score != null ? `${res.tolerance.score}/100` : undefined} await={res.tolerance.score == null} sub={res.tolerance.score == null ? `${res.tolerance.min}–${res.tolerance.max} possible` : PROFILES[profileForScore(res.tolerance.score)].label} />
                    <Kpi label="Ability" value={res.capacity.score != null ? `${res.capacity.score}/100` : undefined} await={res.capacity.score == null} sub={res.capacity.score == null ? `${res.capacity.min}–${res.capacity.max} possible` : PROFILES[profileForScore(res.capacity.score)].label} />
                  </div>
                  {res.limitedBy && <p className="small sec">{LIMITED_BY_TEXT[res.limitedBy]}</p>}
                  {res.guardRails.length > 0 && <Banner tone="warn" title="Guard-rail applied.">{res.guardRails.map((g) => RISK_QUESTIONS.find((q) => q.id === g.questionId)!.text.replace(/\?$/, "")).join("; ")} — caps the profile at {PROFILES[res.guardRails.reduce((m, g) => (PROFILE_KEYS.indexOf(g.cap) < PROFILE_KEYS.indexOf(m) ? g.cap : m), res.guardRails[0].cap)].label}.</Banner>}
                  {canWrite && <div className="row"><button className="btn primary" onClick={save} disabled={!res.complete || unchanged}>{unchanged ? "Saved" : "Save assessment"}</button>{!res.complete && <span className="small muted">Answer all {res.total} to save.</span>}</div>}
                </div>)}
            </Card>

            {shown && (
              <Card title={`${PROFILES[shown].label} model vs your portfolio`} subtitle={`Percent of ${den === "investable" ? "investable portfolio" : den === "gross" ? "gross assets" : "investments excluding property"}`}>
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Asset class</th><th className="r">Model</th><th className="r">Current target</th><th className="r">Actual</th></tr></thead>
                  <tbody>{ASSET_CLASSES.filter((c) => MODEL_PORTFOLIOS[shown][c] || rows.some((r) => r.assetClass === c && (r.pct || r.targetPct))).map((c) => { const r = rows.find((x) => x.assetClass === c); return (
                    <tr key={c}><td>{classLabel(c)}</td><td className="r num"><b>{formatPct((MODEL_PORTFOLIOS[shown][c] ?? 0) / 100)}</b></td><td className="r num">{r?.targetPct != null ? formatPct(r.targetPct) : "—"}</td><td className="r num">{r?.pct != null ? formatPct(r.pct) : "—"}</td></tr>); })}</tbody></table></div>
                {canWrite && latest && <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={apply} disabled={!unchanged} title={unchanged ? undefined : "Save the assessment first"}>Apply as target allocation</button>{latest.appliedAt && unchanged && <Badge tone="good">applied {fmtDate(latest.appliedAt)}</Badge>}</div>}
              </Card>)}
          </div>
        </div>

        <Card title="History" subtitle="Each saved assessment is kept so changes in your profile are visible over time.">
          {!saved || saved.length === 0 ? <Empty title="No saved assessments yet" /> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Profile</th><th className="r">Willingness</th><th className="r">Ability</th><th>Applied as target</th></tr></thead>
              <tbody>{saved.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td><b>{PROFILES[a.profile].label}</b></td><td className="r num">{a.toleranceScore}</td><td className="r num">{a.capacityScore}</td><td>{a.appliedAt ? fmtDate(a.appliedAt) : "—"}</td></tr>)}</tbody></table></div>)}
        </Card>
      </div>
    </>
  );
}
