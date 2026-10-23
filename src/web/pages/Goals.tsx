import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, Icon, ICONS, PageHead, fmtDate } from "../ui";
import { ChartCard, SimpleBars, Meter } from "../charts";
import { formatCompact, formatPct } from "@shared/money";
import type { Goal } from "@shared/types";
import { EntityForm } from "../forms";
import { AddButton } from "./common";

export function GoalsPage() {
  const { state, clientId, run, canWrite } = useApp();
  const ev = state!.evaluation;
  const [form, setForm] = useState<null | Goal | "new">(null);
  const g = ev.goals;
  return (
    <>
      <PageHead title="Goals & wealth progress" subtitle="Actual earmarked amounts are shown separately from projections. Projections use only the return assumption you enter (default 0%) — they are scenarios, not forecasts or promises."
        actions={<AddButton onClick={() => setForm("new")}>New goal</AddButton>} />
      {g.length === 0 ? <Card><Empty title="No goals yet" action={canWrite ? <button className="btn primary" onClick={() => setForm("new")}>Create your first goal</button> : undefined}>Retirement, property purchase, education, business capital, emergency reserve or long-term wealth creation.</Empty></Card> : (
        <div className="stack">
          <ChartCard title="Progress towards targets" height={Math.max(180, g.length * 52)} subtitle="Actual earmarked vs target" table={{ headers: ["Goal", "Earmarked", "Target", "Progress"], rows: g.map((x) => [x.goal.name, formatCompact(x.goal.earmarkedAmount), formatCompact(x.goal.targetAmount), formatPct(x.progressPct, 0)]) }}>
            <SimpleBars layout="horizontal" yFmt={(v) => `${v}%`} fmt={(v) => `${v.toFixed(0)}%`} data={g.map((x) => ({ name: x.goal.name, value: x.progressPct ?? 0, color: "var(--s1)" }))} />
          </ChartCard>
          <div className="grid g2">
            {g.map((x) => (
              <Card key={x.goal.id} title={x.goal.name} subtitle={`${x.goal.type} · target ${fmtDate(x.goal.targetDate)}${x.goal.isIllustrative ? " · illustrative" : ""}`}
                actions={canWrite ? <div className="row" style={{ gap: 4 }}><button className="btn sm" aria-label={`Edit ${x.goal.name}`} onClick={() => setForm(x.goal)}><Icon d={ICONS.edit} size={13} /></button><button className="btn sm" aria-label={`Archive ${x.goal.name}`} onClick={() => confirm("Archive this goal?") && run(() => api.del(`/api/clients/${clientId}/goals/${x.goal.id}`), "Archived")}><Icon d={ICONS.trash} size={13} /></button></div> : undefined}>
                <div className="row between small"><span>Actual progress</span><b className="num">{formatPct(x.progressPct, 0)}</b></div>
                <Meter label={`${x.goal.name} progress`} parts={[{ value: x.goal.earmarkedAmount, color: "var(--s1)", label: "Earmarked" }, { value: x.gap, color: "var(--surface-2)", label: "Gap" }]} />
                <dl className="dl" style={{ marginTop: 10 }}><dt>Target</dt><dd className="num">{formatCompact(x.goal.targetAmount)}</dd><dt>Earmarked now (actual)</dt><dd className="num">{formatCompact(x.goal.earmarkedAmount)}</dd><dt>Funding gap today</dt><dd className="num">{formatCompact(x.gap)}</dd>
                  <dt>Planned contribution</dt><dd className="num">{formatCompact(x.goal.monthlyContribution)} / month</dd><dt>Months left</dt><dd>{x.overdue ? <Badge tone="serious">date passed</Badge> : x.monthsLeft}</dd></dl>
                <div className="banner info" style={{ marginTop: 10 }}><div><b>Projection (scenario):</b> {formatCompact(x.projectedValue)} at the target date → {x.onTrack ? <Badge tone="good">meets target</Badge> : <Badge tone="warn">short by {formatCompact(x.projectedGap)}</Badge>}
                  {x.requiredMonthly != null && !x.onTrack && <div className="small">≈ {formatCompact(x.requiredMonthly)} / month needed to close the gap.</div>}<div className="small muted">{x.assumption}</div></div></div>
              </Card>))}
          </div>
          <Banner>Earmarked amounts are bookkeeping labels — they don’t move money or reduce your net worth.</Banner>
        </div>)}
      {form && <EntityForm entity="goals" initial={form === "new" ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}
