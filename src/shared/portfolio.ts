import { daysBetween, type ISODate } from "./dates";
import { pct, sum, type Paise } from "./money";
import { xirr, type DatedFlow, type XirrResult } from "./xirr";
import {
  ASSET_CLASSES, INSTRUMENT_DEFAULTS, type AssetClass, type Denominator, type InstrumentType, type LiquidityTier,
} from "./taxonomy";
import type { ClassificationStatus, ClientData, Holding, Transaction } from "./types";

/** A holding after aggregate/underlying reconciliation: exactly the rows that are summed (no double counting). */
export interface EffectiveLine {
  id: string; sourceId: string; name: string; instrumentType: InstrumentType;
  assetClass: AssetClass | null; status: ClassificationStatus; candidates: AssetClass[];
  value: Paise; invested: Paise | null; liquidityTier: LiquidityTier; emergencyEligible: boolean;
  parentId: string | null; isRemainder: boolean; isAggregate: boolean; valuationDate: ISODate | null; geography: "india" | "global" | null;
  issuer: string | null; sector: string | null; symbol: string | null; account: string | null;
}

export interface ReconciliationIssue {
  parentId: string; parentName: string; aggregateValue: Paise; childrenValue: Paise;
  kind: "unallocated_remainder" | "children_exceed_aggregate"; difference: Paise;
}

export interface ClassBucket {
  assetClass: AssetClass; value: Paise; min: Paise; max: Paise; provisionalValue: Paise; lines: number;
}

export interface DenominatorInfo { key: Denominator; value: Paise; label: string; description: string }
export const DENOMINATOR_LABEL: Record<Denominator, { label: string; description: string }> = {
  gross: { label: "Total gross assets", description: "Every in-scope asset, including direct property." },
  investable: { label: "Investable financial assets", description: "Gross assets excluding direct real estate (includes bank/cash, gold, funds, PMS, AIF)." },
  investments_ex_property: { label: "Investment portfolio excl. property & cash", description: "Gross assets excluding direct real estate and cash / bank balances." },
};

export interface ReturnMetrics {
  investmentValue: Paise; investedCapital: Paise | null; coveredValue: Paise; coveredInvested: Paise | null;
  coveragePct: number | null; absoluteReturn: Paise | null; absoluteReturnPct: number | null; note: string;
}

export interface PortfolioResult {
  asOf: ISODate;
  lines: EffectiveLine[];
  grossAssets: Paise;
  denominators: Record<Denominator, DenominatorInfo>;
  buckets: Record<AssetClass, ClassBucket>;
  unresolved: { value: Paise; lines: EffectiveLine[]; pctOfGross: number | null };
  reconciliation: ReconciliationIssue[];
  returns: ReturnMetrics;
  xirr: XirrResult & { flowCount: number };
  liquidity: Record<LiquidityTier, Paise>;
  liquidAssets: Paise; // tiers 1-2
  emergencyReserves: Paise;
  directStocks: Array<{ key: string; name: string; value: Paise; direct: Paise; lookThrough: Paise }>;
  directEquity: Paise; indirectEquity: Paise;
  valuation: { missingDate: EffectiveLine[]; stale: EffectiveLine[]; oldestDate: ISODate | null; newestDate: ISODate | null };
  needsReview: EffectiveLine[]; // unresolved + provisional classifications
}

const effectiveClass = (h: Holding): AssetClass | null => h.classOverride ?? h.assetClass;

function candidatesFor(type: InstrumentType): AssetClass[] {
  const c = INSTRUMENT_DEFAULTS[type]?.candidates;
  return c && c.length > 0 ? c : [...ASSET_CLASSES];
}

export function toEffectiveLines(holdings: Holding[]): { lines: EffectiveLine[]; reconciliation: ReconciliationIssue[] } {
  const active = holdings.filter((h) => !h.archived);
  const byParent = new Map<string, Holding[]>();
  for (const h of active) if (h.parentId) {
    const arr = byParent.get(h.parentId) ?? [];
    arr.push(h);
    byParent.set(h.parentId, arr);
  }
  const ids = new Set(active.map((h) => h.id));
  const lines: EffectiveLine[] = [];
  const reconciliation: ReconciliationIssue[] = [];
  const mk = (h: Holding, over: Partial<EffectiveLine> = {}): EffectiveLine => {
    const cls = effectiveClass(h);
    return {
      id: h.id, sourceId: h.id, name: h.name, instrumentType: h.instrumentType, assetClass: cls,
      status: h.classOverride ? "confirmed" : h.classificationStatus,
      candidates: cls ? [] : candidatesFor(h.instrumentType),
      value: h.currentValue, invested: h.investedValue, liquidityTier: h.liquidityTier, emergencyEligible: h.emergencyEligible,
      parentId: h.parentId, isRemainder: false, isAggregate: h.isAggregate, valuationDate: h.valuationDate, geography: h.geography,
      issuer: h.issuer, sector: h.sector, symbol: h.symbol, account: h.account, ...over,
    };
  };
  for (const h of active) {
    if (h.parentId && ids.has(h.parentId)) continue; // handled via its parent
    const kids = byParent.get(h.id);
    if (!kids || kids.length === 0) { lines.push(mk(h)); continue; }
    const childSum = sum(kids.map((k) => k.currentValue));
    for (const k of kids) lines.push(mk(k));
    const remainder = h.currentValue - childSum;
    if (remainder > 0) {
      reconciliation.push({ parentId: h.id, parentName: h.name, aggregateValue: h.currentValue, childrenValue: childSum, kind: "unallocated_remainder", difference: remainder });
      const invested = h.investedValue != null && sum(kids.map((k) => k.investedValue)) <= h.investedValue && kids.every((k) => k.investedValue != null)
        ? h.investedValue - sum(kids.map((k) => k.investedValue)) : null;
      lines.push(mk(h, { id: `${h.id}#remainder`, name: `${h.name} — unallocated remainder`, value: remainder, invested, isRemainder: true, isAggregate: true }));
    } else if (remainder < 0) {
      reconciliation.push({ parentId: h.id, parentName: h.name, aggregateValue: h.currentValue, childrenValue: childSum, kind: "children_exceed_aggregate", difference: -remainder });
    }
  }
  return { lines, reconciliation };
}

const isInvestmentLine = (l: EffectiveLine) =>
  l.assetClass !== "real_estate" && l.instrumentType !== "cash" && l.instrumentType !== "bank_balance" && l.instrumentType !== "pension_annuity";

export function txFlowSign(t: Transaction["type"]): -1 | 0 | 1 {
  switch (t) {
    case "purchase": case "contribution": case "fee": return -1;
    case "sale": case "withdrawal": case "dividend": case "distribution": return 1;
    default: return 0; // transfers are internal
  }
}

export function computePortfolio(data: ClientData, asOf: ISODate): PortfolioResult {
  const { lines, reconciliation } = toEffectiveLines(data.holdings);
  const grossAssets = sum(lines.map((l) => l.value));

  const buckets = Object.fromEntries(ASSET_CLASSES.map((c) => [c, { assetClass: c, value: 0, min: 0, max: 0, provisionalValue: 0, lines: 0 }])) as Record<AssetClass, ClassBucket>;
  const unresolvedLines: EffectiveLine[] = [];
  for (const l of lines) {
    if (l.assetClass) {
      const b = buckets[l.assetClass];
      b.value += l.value; b.min += l.value; b.max += l.value; b.lines += 1;
      if (l.status !== "confirmed") b.provisionalValue += l.value;
    } else unresolvedLines.push(l);
  }
  for (const l of unresolvedLines) for (const c of l.candidates) buckets[c].max += l.value;

  const realEstate = sum(lines.filter((l) => l.assetClass === "real_estate").map((l) => l.value));
  const cashLike = sum(lines.filter((l) => l.instrumentType === "cash" || l.instrumentType === "bank_balance").map((l) => l.value));
  const denominators: Record<Denominator, DenominatorInfo> = {
    gross: { key: "gross", value: grossAssets, ...DENOMINATOR_LABEL.gross },
    investable: { key: "investable", value: grossAssets - realEstate, ...DENOMINATOR_LABEL.investable },
    investments_ex_property: { key: "investments_ex_property", value: grossAssets - realEstate - cashLike, ...DENOMINATOR_LABEL.investments_ex_property },
  };

  // returns -----------------------------------------------------------------
  const inv = lines.filter(isInvestmentLine);
  const investmentValue = sum(inv.map((l) => l.value));
  const covered = inv.filter((l) => l.invested != null && l.invested > 0);
  const coveredValue = sum(covered.map((l) => l.value));
  const coveredInvested = covered.length ? sum(covered.map((l) => l.invested)) : null;
  const coveragePct = pct(coveredValue, investmentValue);
  let returns: ReturnMetrics;
  if (coveredInvested == null || coveredInvested <= 0) {
    returns = { investmentValue, investedCapital: null, coveredValue, coveredInvested: null, coveragePct: 0, absoluteReturn: null, absoluteReturnPct: null,
      note: "Invested capital has not been supplied, so return cannot be calculated." };
  } else {
    const absoluteReturn = coveredValue - coveredInvested;
    const full = covered.length === inv.length;
    returns = {
      investmentValue, investedCapital: full ? coveredInvested : null, coveredValue, coveredInvested, coveragePct,
      absoluteReturn, absoluteReturnPct: pct(absoluteReturn, coveredInvested),
      note: full
        ? "Simple (money-weighted-agnostic) return = current value − invested capital. Ignores timing of flows, distributions and fees; not a time-weighted return."
        : `Partial: computed on the ${coveragePct?.toFixed(0)}% of investment value that has invested capital recorded.`,
    };
  }

  // XIRR ----------------------------------------------------------------------
  const txs = data.transactions.filter((t) => txFlowSign(t.type) !== 0);
  let xr: XirrResult = { ok: false, reason: "Insufficient cash-flow history." };
  if (txs.length > 0) {
    const activeById = new Map(data.holdings.filter((h) => !h.archived).map((h) => [h.id, h]));
    const txHoldingIds = new Set(txs.map((t) => t.holdingId).filter((x): x is string => !!x));
    let terminal: Paise;
    if (txs.some((t) => !t.holdingId)) terminal = investmentValue;
    else {
      terminal = 0;
      for (const id of txHoldingIds) {
        const h = activeById.get(id);
        if (!h) continue;
        if (h.parentId && txHoldingIds.has(h.parentId)) continue;
        terminal += h.currentValue;
      }
    }
    const flows: DatedFlow[] = txs.map((t) => ({ date: t.date, amount: (txFlowSign(t.type) * t.amount) / 100 }));
    flows.push({ date: asOf, amount: terminal / 100 });
    xr = xirr(flows);
  }

  // liquidity -----------------------------------------------------------------
  const liquidity: Record<LiquidityTier, Paise> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const l of lines) liquidity[l.liquidityTier] += l.value;

  // direct stock concentration (direct vs look-through) ---------------------------
  const stockMap = new Map<string, { key: string; name: string; value: Paise; direct: Paise; lookThrough: Paise }>();
  for (const l of lines) {
    if (l.instrumentType !== "direct_stock" || l.isAggregate) continue; // aggregates are not single securities
    const key = (l.symbol ?? l.name).toLowerCase().trim();
    const e = stockMap.get(key) ?? { key, name: l.name, value: 0, direct: 0, lookThrough: 0 };
    e.value += l.value;
    if (l.parentId) e.lookThrough += l.value; else e.direct += l.value;
    stockMap.set(key, e);
  }
  const directStocks = [...stockMap.values()].sort((a, b) => b.value - a.value);
  const directEquity = sum(lines.filter((l) => l.instrumentType === "direct_stock" && !l.parentId).map((l) => l.value));
  const equityClasses: AssetClass[] = ["indian_equity", "global_equity"];
  const totalEquity = sum(lines.filter((l) => l.assetClass && equityClasses.includes(l.assetClass)).map((l) => l.value));

  // valuation freshness ------------------------------------------------------------
  const missingDate = lines.filter((l) => !l.valuationDate);
  const stale = lines.filter((l) => l.valuationDate && daysBetween(l.valuationDate, asOf) > data.settings.stalenessDays);
  const dates = lines.map((l) => l.valuationDate).filter((d): d is ISODate => !!d).sort();

  return {
    asOf, lines, grossAssets, denominators, buckets,
    unresolved: { value: sum(unresolvedLines.map((l) => l.value)), lines: unresolvedLines, pctOfGross: pct(sum(unresolvedLines.map((l) => l.value)), grossAssets) },
    reconciliation, returns, xirr: { ...xr, flowCount: txs.length } as PortfolioResult["xirr"],
    liquidity, liquidAssets: liquidity[1] + liquidity[2],
    emergencyReserves: sum(lines.filter((l) => l.emergencyEligible).map((l) => l.value)),
    directStocks, directEquity, indirectEquity: Math.max(0, totalEquity - directEquity),
    valuation: { missingDate, stale, oldestDate: dates[0] ?? null, newestDate: dates[dates.length - 1] ?? null },
    needsReview: lines.filter((l) => l.status !== "confirmed" || l.isRemainder),
  };
}

export interface AllocationRow {
  assetClass: AssetClass; value: Paise; pct: number | null; minPct: number | null; maxPct: number | null;
  targetPct: number | null; bandPp: number | null; driftPp: number | null; driftMinPp: number | null; driftMaxPp: number | null;
  status: "within" | "breach" | "possible" | "no_target" | "n/a"; provisional: boolean; inDenominator: boolean;
  targetValue: Paise | null; gapValue: Paise | null;
}

/**
 * Allocation vs target. Drift = actual% − target% in PERCENTAGE POINTS (not relative change).
 * Because unresolved holdings could land in several classes, each class also has a [min,max] range;
 * a breach is "definite" only if the whole range sits outside the band, otherwise "possible".
 * Strict ">" comparison on |drift| by default (exactly 5.0pp is not a breach of a 5pp tolerance).
 */
export function computeAllocation(p: PortfolioResult, data: ClientData, denominator: Denominator, defaultBandPp: number, inclusive = false): AllocationRow[] {
  const D = p.denominators[denominator].value;
  const outside = (c: AssetClass) => (denominator !== "gross" && c === "real_estate");
  const targets = new Map(data.targets.map((t) => [t.assetClass, t]));
  return ASSET_CLASSES.map((c) => {
    const b = p.buckets[c];
    const inDen = !outside(c);
    const value = inDen ? b.value : 0;
    const t = targets.get(c);
    const targetPct = t ? t.targetBps / 100 : null;
    const band = t?.bandBps != null ? t.bandBps / 100 : defaultBandPp;
    const actual = inDen ? pct(b.value, D) : null;
    const minPct = inDen ? pct(b.min, D) : null;
    const maxPct = inDen ? pct(b.max, D) : null;
    const drift = actual != null && targetPct != null ? actual - targetPct : null;
    const dMin = minPct != null && targetPct != null ? minPct - targetPct : null;
    const dMax = maxPct != null && targetPct != null ? maxPct - targetPct : null;
    const exceeds = (d: number) => (inclusive ? Math.abs(d) >= band : Math.abs(d) > band);
    let status: AllocationRow["status"] = "n/a";
    if (!inDen) status = "n/a";
    else if (targetPct == null || D <= 0) status = "no_target";
    else if (dMin != null && dMax != null) {
      const definite = (dMin > 0 && exceeds(dMin)) || (dMax < 0 && exceeds(dMax));
      const possible = exceeds(dMin) || exceeds(dMax) || (dMin < 0 && dMax > 0 && (exceeds(dMin) || exceeds(dMax)));
      status = definite ? "breach" : possible ? "possible" : "within";
    }
    const targetValue = targetPct != null && D > 0 ? Math.round((targetPct / 100) * D) : null;
    return {
      assetClass: c, value, pct: actual, minPct, maxPct, targetPct, bandPp: targetPct != null ? band : null, driftPp: drift,
      driftMinPp: dMin, driftMaxPp: dMax, status, provisional: b.provisionalValue > 0 || b.max !== b.min, inDenominator: inDen,
      targetValue, gapValue: targetValue != null ? targetValue - value : null,
    };
  });
}
