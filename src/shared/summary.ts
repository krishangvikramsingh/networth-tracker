import { formatCompact } from "./money";
import type { ClientData } from "./types";
import type { Evaluation } from "./evaluate";

export interface SummaryLine { label: string; value: string }
export function summaryLines(data: ClientData, ev: Evaluation): SummaryLine[] {
  const nw = ev.netWorth;
  return [
    { label: "Client", value: data.client.name }, { label: "Calculation date", value: ev.asOf }, { label: "Report generated", value: ev.computedAt },
    { label: "Gross reported assets", value: formatCompact(nw.grossAssets) },
    { label: "Confirmed outstanding liabilities", value: nw.liabilitiesStatus === "not_assessed" ? "Not yet assessed" : formatCompact(nw.liabilities) },
    { label: "Calculated net worth", value: nw.netWorth == null ? `Awaiting liabilities (upper bound ${formatCompact(nw.upperBound)})` : `${formatCompact(nw.netWorth)}${nw.provisional ? " (provisional)" : ""}` },
    { label: "Remaining contractual commitments", value: formatCompact(nw.commitmentsRemaining) },
    { label: "Adjusted net worth after commitments", value: nw.adjustedNetWorth == null ? "Awaiting data" : formatCompact(nw.adjustedNetWorth) },
    { label: "Financial-health score", value: ev.health.overall == null ? "Not assessable" : `${ev.health.overall.toFixed(0)}/100 — ${ev.health.provisional ? "provisional, " : ""}${(ev.health.coverage * 100).toFixed(0)}% weight coverage` },
    { label: "Data completeness", value: `${ev.completeness.percent.toFixed(0)}%` },
    { label: "Note", value: nw.note },
  ];
}

