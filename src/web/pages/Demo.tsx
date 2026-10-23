import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Icon, ICONS, PageHead } from "../ui";
import { EntityForm, type EntityName } from "../forms";
import { crore, lakh } from "@shared/money";
import { PRIYA_ID } from "@shared/fixtures";

interface Step { id: string; title: string; body: string; to?: string; action?: { label: string; entity: EntityName; defaults: any; title: string }; done?: (s: ReturnType<typeof useApp>["state"]) => boolean }

const STEPS: Step[] = [
  { id: "s1", title: "Open Priya’s wealth dashboard", body: "KPIs show real figures where data exists and “Awaiting data” where it doesn’t — liabilities are shown as not yet assessed, not zero.", to: "/" },
  { id: "s2", title: "Review the supplied assets", body: "Seven aggregate holdings reconcile to ₹8.63 crore. Note the provisional / needs-review badges on MF, PMS and AIF.", to: "/assets" },
  { id: "s3", title: "Add a missing mutual-fund scheme", body: "Splits the ₹1.83 Cr aggregate. The amount below is a DEMO entry, not Priya’s real holding. The aggregate is never double counted: the rest stays as an unallocated remainder.",
    action: { label: "Add demo scheme", entity: "holdings", title: "Add underlying mutual-fund scheme (DEMO entry)", defaults: { name: "Demo Flexi Cap Fund (DEMO entry)", instrumentType: "equity_mf", parentId: "h_priya_mf", currentValue: crore(1.5), investedValue: crore(1.2), acquisitionDate: "2023-04-03", notes: "DEMO entry for the walkthrough — not client data." } },
    done: (s) => !!s?.data.holdings.some((h) => h.parentId === "h_priya_mf" && !h.archived) },
  { id: "s4", title: "Watch it categorise automatically", body: "In the form, the classification panel shows the result, the method (instrument type / keyword / exact name) and its status. You can override it on the holding’s detail page — the override is logged.", to: "/assets" },
  { id: "s5", title: "Record a liability", body: "A DEMO home loan. Net worth switches from “Awaiting data” to a provisional figure; it becomes final once you mark liabilities complete.",
    action: { label: "Add demo loan", entity: "liabilities", title: "Record liability (DEMO entry)", defaults: { name: "Demo home loan (DEMO entry)", type: "home_loan", outstanding: lakh(40), originalPrincipal: lakh(55), emi: lakh(0.45), ratePct: "8.5", remainingMonths: 120 } },
    done: (s) => !!s?.data.liabilities.some((l) => !l.archived) },
  { id: "s6", title: "Observe net worth recalculate", body: "Back on the dashboard: gross assets, liabilities, net worth, debt ratio and the health score all moved.", to: "/" },
  { id: "s7", title: "Record monthly income", body: "A DEMO salary line. Income stays “partial” until you mark it complete, and the savings rate remains provisional until then.",
    action: { label: "Add demo salary", entity: "cashflows", title: "Record income (DEMO entry)", defaults: { kind: "income", category: "salary", name: "Demo monthly salary (DEMO entry)", amount: lakh(3), frequency: "monthly", verified: true } },
    done: (s) => !!s?.data.cashflows.some((c) => c.kind === "income" && c.category === "salary" && !c.archived) },
  { id: "s8", title: "Review the cash-flow forecast", body: "Dated 12-month view: pension receipt and the ₹20 L premium balance appear as unscheduled until given dates — they are not smeared across months.", to: "/cashflow" },
  { id: "s9", title: "Trigger an allocation alert", body: "After step 3, classified equity passes the 60% limit on investable assets, so the equity rule moves from “possible” to a definite breach. Open it to see why, the affected holdings and the recommended action.", to: "/alerts" },
  { id: "s10", title: "Adjust an allocation threshold", body: "Change the equity limit (e.g. to 70%) under Alert rules → Save. The alert resolves immediately and the history keeps the record.", to: "/rules" },
  { id: "s11", title: "Review a rebalancing scenario", body: "Target allocation tab: see gaps, sale-vs-illiquid caveats and the scenario simulator. Nothing is executed.", to: "/rules" },
  { id: "s12", title: "View the financial-health score and why", body: "Provisional score, per-component explanation, formulas and what is unassessed.", to: "/health" },
  { id: "s13", title: "Compare the three investor case studies", body: "A (aggressive, ₹10 Cr assets / ₹5 Cr liabilities), B (50:50), C (70:30) — isolated from Priya.", to: "/cases" },
  { id: "s14", title: "Review the pension commitment", body: "₹80 L of ₹1 Cr paid, ₹20 L remaining — reported as a commitment, not a loan, with the ₹5 L annual pension receivable separate.", to: "/assets?tab=commitments" },
  { id: "s15", title: "Export a report", body: "Excel, CSV and a print-ready PDF with methodology, data-quality notices and limitations.", to: "/reports" },
];

export function DemoPage() {
  const { state, clientId, setClientId, run, canWrite, clients } = useApp();
  const [checked, setChecked] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("nw.demo") ?? "{}"); } catch { return {}; } });
  const [form, setForm] = useState<Step["action"] | null>(null);
  const toggle = (id: string) => { const n = { ...checked, [id]: !checked[id] }; setChecked(n); try { localStorage.setItem("nw.demo", JSON.stringify(n)); } catch { /* ignore */ } };
  const onPriya = clientId === PRIYA_ID;
  const doneCount = STEPS.filter((s) => checked[s.id] || (onPriya && s.done?.(state))).length;
  return (
    <>
      <PageHead title="Guided demonstration" subtitle="A 15-step walkthrough for the live presentation. Data-entry steps use clearly labelled DEMO values and can be undone with Reset."
        actions={<button className="btn danger" disabled={!canWrite} onClick={async () => { if (!confirm("Reset Priya and the three case studies to their original state? Clients you created yourself are not touched.")) return; await run(() => api.post("/api/demo/reset", {}), "Demo data reset"); setChecked({}); try { localStorage.removeItem("nw.demo"); } catch { /* ignore */ } }}>Reset demo data</button>} />
      {!onPriya && <div style={{ marginBottom: 14 }}><Banner tone="warn">You are viewing a different client. The demo walkthrough is written for Priya Ramanathan. <button className="btn sm" onClick={() => setClientId(PRIYA_ID)} disabled={!clients.some((c) => c.id === PRIYA_ID)}>Switch to Priya</button></Banner></div>}
      <Card title={`Progress: ${doneCount} of ${STEPS.length}`}>
        {STEPS.map((s, i) => {
          const auto = onPriya && s.done?.(state);
          const done = checked[s.id] || auto;
          return (
            <div key={s.id} className={`step ${done ? "done" : ""}`}>
              <div className="n">{done ? <Icon d={ICONS.check} size={13} /> : i + 1}</div>
              <div><b>{s.title}</b> {auto && <Badge tone="good">detected</Badge>}<div className="small sec">{s.body}</div></div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {s.action && <button className="btn sm primary" disabled={!canWrite || !onPriya} onClick={() => setForm(s.action!)}>{s.action.label}</button>}
                {s.to && <Link className="btn sm" to={s.to}>Open →</Link>}
                <label className="check small"><input type="checkbox" checked={!!checked[s.id]} onChange={() => toggle(s.id)} />done</label>
              </div>
            </div>);
        })}
      </Card>
      {form && <EntityForm entity={form.entity} defaults={form.defaults} title={form.title} onClose={() => setForm(null)} />}
    </>
  );
}
