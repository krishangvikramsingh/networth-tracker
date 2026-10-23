import ExcelJS from "exceljs";
import type { ClientData } from "../shared/types";
import type { Evaluation } from "../shared/evaluate";
import { ASSET_CLASS_LABEL, CASHFLOW_LABEL, INSTRUMENT_LABEL, LIABILITY_LABEL, LIQUIDITY_LABEL } from "../shared/taxonomy";
import { formatCompact } from "../shared/money";
import type { AlertRow } from "./alerts";
import { summaryLines } from "../shared/summary";
export { summaryLines };

export type Cell = string | number | boolean | null;
export interface Table { name: string; headers: string[]; rows: Cell[][] }

const rs = (p: number | null | undefined): number | null => (p == null ? null : Math.round(p) / 100);

export function buildTables(data: ClientData, ev: Evaluation, alerts: AlertRow[]): Table[] {
  const eff = (h: ClientData["holdings"][number]) => h.classOverride ?? h.assetClass;
  const byId = new Map(data.holdings.map((h) => [h.id, h.name]));
  return [
    { name: "Holdings", headers: ["Name", "Instrument", "Asset class", "Classification method", "Classification status", "Current value (INR)", "Invested (INR)", "Acquisition date", "Valuation date", "Maturity date", "Liquidity", "Underlying of", "Aggregate", "Account", "Issuer", "Symbol", "Quantity", "Data status", "Original description"],
      rows: data.holdings.map((h) => [h.name, INSTRUMENT_LABEL[h.instrumentType], eff(h) ? ASSET_CLASS_LABEL[eff(h)!] : "Needs review", h.classificationMethod, h.classificationStatus, rs(h.currentValue), rs(h.investedValue), h.acquisitionDate, h.valuationDate, h.maturityDate,
        LIQUIDITY_LABEL[h.liquidityTier], h.parentId ? byId.get(h.parentId) ?? null : null, h.isAggregate ? "Yes" : "No", h.account, h.issuer, h.symbol, h.quantity, h.dataStatus, h.originalDescription]) },
    { name: "Liabilities", headers: ["Name", "Type", "Lender", "Outstanding (INR)", "EMI (INR)", "Rate % p.a.", "Remaining months", "Next due", "Data status"],
      rows: data.liabilities.map((l) => [l.name, LIABILITY_LABEL[l.type], l.lender, rs(l.outstanding), rs(l.emi), l.rateBps == null ? null : l.rateBps / 100, l.remainingMonths, l.nextDueDate, l.dataStatus]) },
    { name: "Cash flow", headers: ["Name", "Type", "Category", "Amount (INR)", "Frequency", "Anchor date", "End date", "Verified", "Essential", "Monthly equivalent (INR)"],
      rows: data.cashflows.map((c) => [c.name, c.kind, CASHFLOW_LABEL[c.category], rs(c.amount), c.frequency, c.anchorDate, c.endDate, c.verified ? "Yes" : "No", c.essential ? "Yes" : "No",
        rs(({ monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, once: 0 } as const)[c.frequency] * c.amount / 12)]) },
    { name: "Commitments", headers: ["Name", "Total (INR)", "Paid (INR)", "Remaining (INR)", "Instalment (INR)", "Frequency", "Next due", "Annual receivable (INR)", "Data status"],
      rows: data.commitments.map((c) => [c.name, rs(c.totalAmount), rs(c.paidAmount), rs(c.totalAmount - c.paidAmount), rs(c.installmentAmount), c.frequency, c.nextDueDate, rs(c.annualReceivable), c.dataStatus]) },
    { name: "Allocation", headers: ["Asset class", "Value (INR)", "Actual %", "Min %", "Max %", "Target %", "Drift (pp)", "Band (pp)", "Status", "Gap to target (INR)"],
      rows: ev.allocation[ev.activeDenominator].filter((r) => r.inDenominator).map((r) => [ASSET_CLASS_LABEL[r.assetClass], rs(r.value), r.pct, r.minPct, r.maxPct, r.targetPct, r.driftPp, r.bandPp, r.status, rs(r.gapValue)]) },
    { name: "Alerts", headers: ["Status", "Severity", "Rule", "Subject", "Current", "Threshold", "First detected", "Last seen", "Resolved", "Why", "Recommended action"],
      rows: alerts.map((a) => [a.status, a.severity, a.ruleName, a.subject, a.currentLabel, a.thresholdLabel, a.firstDetectedAt, a.lastSeenAt, a.resolvedAt, a.why, a.action]) },
    { name: "Data quality", headers: ["Item", "Status", "Detail"], rows: ev.completeness.items.map((i) => [i.label, i.status, i.detail]) },
  ];
}

/** Neutralise spreadsheet formula injection: cells beginning with = + - @ are prefixed with an apostrophe in CSV. */
function csvCell(v: Cell): string {
  if (v == null) return "";
  let s = typeof v === "number" ? String(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(t: Table): string {
  return "﻿" + [t.headers, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function buildWorkbook(data: ClientData, ev: Evaluation, alerts: AlertRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Net Worth Tracker"; wb.created = new Date();
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 38 }, { width: 90 }];
  s.addRow([`Wealth report — ${data.client.name}`]).font = { bold: true, size: 14 };
  for (const l of summaryLines(data, ev)) s.addRow([l.label, l.value]);
  s.addRow([]);
  s.addRow(["Disclaimer", "Educational tool; figures depend on user-supplied data and the documented methodology. Not investment advice."]);
  for (const t of buildTables(data, ev, alerts)) {
    const ws = wb.addWorksheet(t.name);
    ws.addRow(t.headers).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
    for (const r of t.rows) ws.addRow(r.map((c) => (typeof c === "string" && /^[=+\-@]/.test(c) ? "'" + c : c)));
    ws.columns.forEach((c, i) => { c.width = Math.min(48, Math.max(12, (t.headers[i]?.length ?? 10) + 4)); });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
