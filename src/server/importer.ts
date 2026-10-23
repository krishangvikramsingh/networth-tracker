import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { DB } from "./db";
import { tx } from "./db";
import { audit } from "./audit";
import { createEntity, HttpError } from "./service";
import { listAll, loadMappings } from "./repo";
import { parseMoneyInput } from "../shared/money";
import { classifyHolding } from "../shared/classify";
import { INSTRUMENT_TYPES, LIABILITY_TYPES, INCOME_CATEGORIES, EXPENSE_CATEGORIES, type InstrumentType } from "../shared/taxonomy";
import { ENTITY_SCHEMAS } from "./schemas";
import type { Holding, Liability, CashflowItem } from "../shared/types";

export type ImportKind = "holdings" | "liabilities" | "cashflows";
export interface ImportReport {
  kind: ImportKind; dryRun: boolean; filename: string | null; total: number; accepted: number; rejected: number; duplicates: number; unresolved: number;
  rows: Array<{ row: number; status: "accepted" | "rejected" | "duplicate" | "unresolved"; name: string; reason?: string; category?: string | null }>; alreadyImported: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string[]> = {
  name: ["name", "holding", "security", "scheme", "asset", "description", "item", "loan", "liability"],
  instrumentType: ["type", "instrument", "instrument type", "asset type"],
  currentValue: ["value", "current value", "market value", "amount", "current value inr", "valuation", "balance"],
  investedValue: ["invested", "cost", "invested value", "invested amount", "invested capital", "cost value"],
  acquisitionDate: ["acquisition date", "purchase date", "invested on", "start date"], valuationDate: ["valuation date", "as of", "as of date", "nav date"],
  maturityDate: ["maturity date", "maturity"], account: ["account", "folio", "demat"], issuer: ["issuer", "amc", "institution", "bank", "fund house"],
  symbol: ["symbol", "ticker", "isin", "code"], quantity: ["quantity", "units", "qty", "shares"], parent: ["parent", "underlying of", "part of"], classOverride: ["asset class", "category", "class"],
  outstanding: ["outstanding", "balance", "principal outstanding", "outstanding inr"], emi: ["emi", "monthly emi", "emi inr"], rate: ["rate", "interest rate", "rate p a"], months: ["remaining months", "tenure left", "months left"], lender: ["lender", "bank", "institution"],
  liabilityType: ["type", "loan type", "liability type"], kind: ["kind", "income expense", "direction"], category: ["category"], frequency: ["frequency", "freq"], anchorDate: ["date", "next date", "due date", "anchor date"],
};
const INSTR_ALIASES: Record<string, InstrumentType> = {
  stock: "direct_stock", stocks: "direct_stock", equity: "direct_stock", "direct equity": "direct_stock", "equity mf": "equity_mf", "equity mutual fund": "equity_mf", "equity fund": "equity_mf",
  "debt mf": "debt_mf", "debt mutual fund": "debt_mf", "debt fund": "debt_mf", fd: "fixed_deposit", "fixed deposit": "fixed_deposit", gold: "gold_physical", property: "property_residential",
  pms: "pms", aif: "aif", bond: "bond", bonds: "bond", reit: "reit", invit: "invit", cash: "cash", bank: "bank_balance", "bank balance": "bank_balance", etf: "etf", mf: "mutual_fund_aggregate",
};
const classOf: Record<string, string> = { "indian equity": "indian_equity", "global equity": "global_equity", debt: "debt", commodities: "commodities", "real estate": "real_estate", reits: "reits_invits", alternatives: "alternatives" };

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
export async function parseXLSX(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(422, "The workbook has no sheets.");
  const rows: string[][] = [];
  ws.eachRow((r) => {
    const vals: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) {
      const v = r.getCell(c).value as any;
      vals.push(v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" ? String(v.result ?? v.text ?? "") : String(v));
    }
    if (vals.some((x) => x.trim() !== "")) rows.push(vals);
  });
  return rows;
}

function toDate(s: string | undefined): string | null | undefined {
  if (!s || !s.trim()) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t); // dd/mm/yyyy (Indian convention)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined; // invalid
}

export async function runImport(db: DB, cid: string, kind: ImportKind, content: { text?: string; buffer?: Buffer }, opts: { dryRun: boolean; filename: string | null; force?: boolean }, actor: { id: string } | undefined): Promise<ImportReport> {
  const raw = content.buffer ? await parseXLSX(content.buffer) : parseCSV(content.text ?? "");
  const checksum = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const dupFile = db.prepare("SELECT 1 FROM import_log WHERE client_id = ? AND kind = ? AND checksum = ?").get(cid, kind, checksum);
  const report: ImportReport = { kind, dryRun: opts.dryRun, filename: opts.filename, total: 0, accepted: 0, rejected: 0, duplicates: 0, unresolved: 0, rows: [], alreadyImported: !!dupFile };
  if (raw.length < 2) throw new HttpError(422, "The file needs a header row and at least one data row.");
  const headers = raw[0].map(norm);
  const col = (field: string): number => { for (const a of ALIASES[field] ?? [field]) { const i = headers.indexOf(a); if (i >= 0) return i; } return -1; };
  const get = (row: string[], field: string) => { const i = col(field); return i >= 0 ? (row[i] ?? "").trim() : ""; };
  if (col("name") < 0) throw new HttpError(422, "Could not find a 'Name' column. Expected headers like: Name, Type, Current value…");
  const maps = loadMappings(db, cid);
  const seen = new Set<string>();
  const existing: Array<Holding | Liability | CashflowItem> = kind === "holdings" ? listAll(db, "holdings", cid) : kind === "liabilities" ? listAll(db, "liabilities", cid) : listAll(db, "cashflows", cid);
  const keyOf = (name: string, type: string, val: number) => `${norm(name)}|${type}|${val}`;
  const existingKeys = new Set(existing.map((e: any) => keyOf(e.name, e.instrumentType ?? e.type ?? e.category, e.currentValue ?? e.outstanding ?? e.amount)));
  const money = (s: string): number | null | undefined => { if (!s) return null; const m = parseMoneyInput(s); return m == null ? undefined : m; };
  const pending: Array<{ body: any; idx: number }> = [];

  raw.slice(1).forEach((row, i) => {
    const line = i + 2; report.total++;
    const name = get(row, "name");
    const rej = (reason: string) => { report.rejected++; report.rows.push({ row: line, status: "rejected", name: name || `(row ${line})`, reason }); };
    if (!name) return rej("Name is missing.");
    let body: any; let dedupeKey: string;
    if (kind === "holdings") {
      const t = norm(get(row, "instrumentType"));
      const type = (INSTRUMENT_TYPES as readonly string[]).includes(t.replace(/ /g, "_")) ? t.replace(/ /g, "_") : INSTR_ALIASES[t];
      if (!type) return rej(`Unknown instrument type "${get(row, "instrumentType")}".`);
      const val = money(get(row, "currentValue")); if (val == null || val === undefined) return rej("Current value is missing or not a valid amount.");
      const inv = money(get(row, "investedValue")); if (inv === undefined) return rej("Invested value is not a valid amount.");
      const acq = toDate(get(row, "acquisitionDate")), vd = toDate(get(row, "valuationDate")), md = toDate(get(row, "maturityDate"));
      if (acq === undefined || vd === undefined || md === undefined) return rej("A date is not valid (use yyyy-mm-dd or dd/mm/yyyy).");
      const co = classOf[norm(get(row, "classOverride"))] ?? null;
      const parentName = get(row, "parent");
      const parent = parentName ? (existing as Holding[]).find((h) => norm(h.name) === norm(parentName)) : null;
      if (parentName && !parent) return rej(`Parent "${parentName}" not found among existing holdings.`);
      body = { name, instrumentType: type, currentValue: val, investedValue: inv, acquisitionDate: acq, valuationDate: vd, maturityDate: md, account: get(row, "account") || null, issuer: get(row, "issuer") || null,
        symbol: get(row, "symbol") || null, quantity: get(row, "quantity") ? Number(get(row, "quantity")) : null, parentId: parent?.id ?? null, classOverride: co };
      dedupeKey = keyOf(name, type, val);
    } else if (kind === "liabilities") {
      const t = norm(get(row, "liabilityType")).replace(/ /g, "_");
      const type = (LIABILITY_TYPES as readonly string[]).includes(t) ? t : t.includes("home") ? "home_loan" : t.includes("card") ? "credit_card" : t.includes("vehicle") || t.includes("car") ? "vehicle_loan" : t.includes("business") ? "business_loan" : t.includes("personal") ? "personal_loan" : null;
      if (!type) return rej(`Unknown liability type "${get(row, "liabilityType")}".`);
      const out = money(get(row, "outstanding")); if (out == null || out === undefined) return rej("Outstanding amount is missing or invalid.");
      const emi = money(get(row, "emi")); if (emi === undefined) return rej("EMI is not a valid amount.");
      const rate = get(row, "rate") ? Math.round(parseFloat(get(row, "rate")) * 100) : null;
      body = { name, type, outstanding: out, emi, rateBps: rate != null && Number.isFinite(rate) ? rate : null, remainingMonths: get(row, "months") ? parseInt(get(row, "months"), 10) : null, lender: get(row, "lender") || null };
      dedupeKey = keyOf(name, type, out);
    } else {
      const k = norm(get(row, "kind")) === "income" ? "income" : norm(get(row, "kind")) === "expense" ? "expense" : null;
      if (!k) return rej("Kind must be 'income' or 'expense'.");
      const cat = norm(get(row, "category")).replace(/ /g, "_");
      const valid = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES] as readonly string[];
      if (!valid.includes(cat)) return rej(`Unknown category "${get(row, "category")}".`);
      const amt = money(get(row, "currentValue")); if (amt == null || amt === undefined) return rej("Amount is missing or invalid.");
      const fr = norm(get(row, "frequency")).replace(/ /g, "_") || "monthly";
      const ad = toDate(get(row, "anchorDate")); if (ad === undefined) return rej("Date is not valid.");
      body = { kind: k, category: cat, name, amount: amt, frequency: fr, anchorDate: ad, verified: false };
      dedupeKey = keyOf(name, cat, amt);
    }
    const parsed = (ENTITY_SCHEMAS[kind] as any).safeParse(body);
    if (!parsed.success) return rej(parsed.error.issues[0]?.message ?? "Invalid row.");
    if (existingKeys.has(dedupeKey) || seen.has(dedupeKey)) { report.duplicates++; report.rows.push({ row: line, status: "duplicate", name, reason: existingKeys.has(dedupeKey) ? "Already recorded for this client." : "Duplicate of an earlier row in this file." }); return; }
    seen.add(dedupeKey);
    let category: string | null | undefined; let unresolved = false;
    if (kind === "holdings") {
      const r = classifyHolding({ name, originalDescription: name, instrumentType: body.instrumentType, classOverride: body.classOverride }, maps);
      category = r.assetClass; unresolved = r.status === "needs_review";
    }
    if (unresolved) report.unresolved++;
    report.accepted++;
    report.rows.push({ row: line, status: unresolved ? "unresolved" : "accepted", name, category: category ?? null, reason: unresolved ? "Accepted, but needs classification review." : undefined });
    pending.push({ body, idx: i });
  });

  if (!opts.dryRun) {
    if (report.alreadyImported && !opts.force) throw new HttpError(409, "This exact file was already imported for this client (duplicate import blocked).");
    tx(db, () => {
      for (const p of pending) createEntity(db, cid, kind, p.body, actor);
      db.prepare("INSERT OR REPLACE INTO import_log (id, client_id, kind, filename, checksum, at, accepted, rejected, unresolved) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(`imp_${checksum.slice(0, 12)}_${kind}`, cid, kind, opts.filename, checksum, new Date().toISOString(), report.accepted, report.rejected, report.unresolved);
      audit(db, { clientId: cid, userId: actor?.id, entity: kind, action: "import", summary: `Imported ${report.accepted} ${kind} from ${opts.filename ?? "file"} (${report.rejected} rejected, ${report.duplicates} duplicates)` });
    });
  }
  return report;
}

export const TEMPLATES: Record<ImportKind, string> = {
  holdings: "Name,Type,Current value,Invested value,Acquisition date,Valuation date,Maturity date,Account,Issuer,Symbol,Quantity,Parent,Asset class\r\nSAMPLE — Example Flexi Cap Fund,Equity MF,500000,400000,2022-04-01,2026-10-15,,Folio-123,Example AMC,,1520.5,,\r\n",
  liabilities: "Name,Type,Outstanding,EMI,Rate,Remaining months,Lender\r\nSAMPLE — Home loan,home_loan,2500000,32000,8.5,180,Example Bank\r\n",
  cashflows: "Name,Kind,Category,Amount,Frequency,Date\r\nSAMPLE — Salary,income,salary,150000,monthly,\r\n",
};
