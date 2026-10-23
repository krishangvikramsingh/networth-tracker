import { z } from "zod";
import { isValidISODate } from "../shared/dates";
import { ASSET_CLASSES, INSTRUMENT_TYPES, LIABILITY_TYPES, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "../shared/taxonomy";

export const iso = z.string().refine(isValidISODate, "Use a valid date (yyyy-mm-dd).");
export const paise = z.number({ message: "Enter an amount." }).int("Amount must be whole paise.").min(0, "Amount cannot be negative.").max(9e13, "Amount is unrealistically large.");
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();
const text = (max = 160) => z.string().trim().max(max);
const dataStatus = z.enum(["collected", "pending", "needs_review", "not_applicable"]);
const freq = z.enum(["monthly", "quarterly", "half_yearly", "annual", "once"]);

export const holdingIn = z.object({
  name: text(120).min(1, "Name is required."), originalDescription: opt(text(300)),
  instrumentType: z.enum(INSTRUMENT_TYPES), currentValue: paise, investedValue: opt(paise),
  acquisitionDate: opt(iso), valuationDate: opt(iso), maturityDate: opt(iso), expectedMaturityValue: opt(paise),
  classOverride: opt(z.enum(ASSET_CLASSES)), geography: opt(z.enum(["india", "global"])),
  issuer: opt(text(100)), account: opt(text(100)), symbol: opt(text(40)), sector: opt(text(80)), quantity: opt(z.number().min(0).max(1e12)),
  liquidityTier: opt(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])), emergencyEligible: opt(z.boolean()),
  parentId: opt(z.string()), isAggregate: opt(z.boolean()), dataStatus: opt(dataStatus), notes: opt(text(1000)),
}).superRefine((v, ctx) => {
  if (v.acquisitionDate && v.valuationDate && v.valuationDate < v.acquisitionDate) ctx.addIssue({ code: "custom", path: ["valuationDate"], message: "Valuation date cannot precede the acquisition date." });
  if (v.maturityDate && v.acquisitionDate && v.maturityDate < v.acquisitionDate) ctx.addIssue({ code: "custom", path: ["maturityDate"], message: "Maturity cannot precede the acquisition date." });
});

export const liabilityIn = z.object({
  name: text(120).min(1, "Name is required."), type: z.enum(LIABILITY_TYPES), lender: opt(text(100)), outstanding: paise, originalPrincipal: opt(paise), emi: opt(paise),
  rateBps: opt(z.number().int().min(0).max(10000)), remainingMonths: opt(z.number().int().min(0).max(1200)), nextDueDate: opt(iso), minimumDue: opt(paise), dataStatus: opt(dataStatus), notes: opt(text(1000)),
}).superRefine((v, ctx) => {
  if (v.originalPrincipal != null && v.outstanding > v.originalPrincipal) ctx.addIssue({ code: "custom", path: ["outstanding"], message: "Outstanding cannot exceed the original principal." });
});

export const cashflowIn = z.object({
  kind: z.enum(["income", "expense"]), category: z.enum([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]), name: text(120).min(1, "Name is required."), amount: paise, frequency: freq,
  anchorDate: opt(iso), endDate: opt(iso), verified: opt(z.boolean()), essential: opt(z.boolean()), commitmentId: opt(z.string()), liabilityId: opt(z.string()), dataStatus: opt(dataStatus), notes: opt(text(1000)),
}).superRefine((v, ctx) => {
  const inc = (INCOME_CATEGORIES as readonly string[]).includes(v.category);
  if (v.kind === "income" && !inc) ctx.addIssue({ code: "custom", path: ["category"], message: "Choose an income category." });
  if (v.kind === "expense" && inc) ctx.addIssue({ code: "custom", path: ["category"], message: "Choose an expense category." });
  if (v.frequency === "once" && !v.anchorDate) ctx.addIssue({ code: "custom", path: ["anchorDate"], message: "A one-off item needs a date." });
  if (v.anchorDate && v.endDate && v.endDate < v.anchorDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot precede the start date." });
});

export const commitmentIn = z.object({
  name: text(120).min(1, "Name is required."), kind: z.enum(["pension_premium", "insurance_premium", "other"]), totalAmount: paise, paidAmount: paise, installmentAmount: opt(paise),
  frequency: opt(freq), nextDueDate: opt(iso), endDate: opt(iso), annualReceivable: opt(paise), dataStatus: opt(dataStatus), notes: opt(text(1000)),
}).superRefine((v, ctx) => {
  if (v.paidAmount > v.totalAmount) ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "Paid cannot exceed the total commitment." });
  if (v.nextDueDate && (!v.installmentAmount || !v.frequency)) ctx.addIssue({ code: "custom", path: ["installmentAmount"], message: "A scheduled commitment needs an instalment amount and frequency." });
});

export const transactionIn = z.object({
  holdingId: opt(z.string()), date: iso, type: z.enum(["purchase", "contribution", "sale", "withdrawal", "dividend", "distribution", "fee", "transfer"]),
  amount: paise.refine((n) => n > 0, "Amount must be greater than zero."), quantity: opt(z.number().min(0)), notes: opt(text(500)),
}).superRefine((v, ctx) => { if (v.date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) ctx.addIssue({ code: "custom", path: ["date"], message: "Transactions cannot be dated in the future." }); });

export const policyIn = z.object({
  type: z.enum(["term_life", "health", "home", "vehicle", "ulip", "endowment", "other"]), insurer: opt(text(100)), policyNo: opt(text(60)), sumAssured: opt(paise), annualPremium: opt(paise),
  premiumFrequency: opt(freq), nextPremiumDate: opt(iso), renewalDate: opt(iso), maturityDate: opt(iso), expectedMaturityValue: opt(paise), dataStatus: opt(dataStatus),
});

export const goalIn = z.object({
  name: text(120).min(1, "Name is required."), type: z.enum(["retirement", "property", "education", "business", "emergency", "wealth", "other"]),
  targetAmount: paise.refine((n) => n > 0, "Target must be greater than zero."), targetDate: iso, earmarkedAmount: paise, monthlyContribution: paise,
  expectedReturnBps: opt(z.number().int().min(-5000).max(5000)), notes: opt(text(1000)),
});

export const ENTITY_SCHEMAS = { holdings: holdingIn, liabilities: liabilityIn, cashflows: cashflowIn, commitments: commitmentIn, transactions: transactionIn, policies: policyIn, goals: goalIn } as const;

export const settingsPatch = z.object({
  denominator: z.enum(["gross", "investable", "investments_ex_property"]), concentrationDenominator: z.enum(["gross", "investable", "investments_ex_property"]),
  liabilitiesStatus: z.enum(["not_assessed", "partial", "complete"]), incomeStatus: z.enum(["pending", "partial", "complete"]),
  emergencyMonthsTarget: z.number().min(0).max(120),
  healthWeights: z.object({ net_worth: z.number().min(0).max(100), cash_flow: z.number().min(0).max(100), emergency: z.number().min(0).max(100), debt: z.number().min(0).max(100), diversification: z.number().min(0).max(100), insurance: z.number().min(0).max(100) })
    .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) > 0, "At least one weight must be above zero."),
  scoreBands: z.array(z.object({ min: z.number().min(0).max(100), label: z.string().min(1).max(40) })).min(1),
  savingsExcludedCategories: z.array(z.enum([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])),
  groupGrowth: z.array(z.enum(ASSET_CLASSES)), groupDefensive: z.array(z.enum(ASSET_CLASSES)),
  stalenessDays: z.number().int().min(1).max(730), insuranceLifeCoverMultiple: z.number().min(0).max(100),
  nwStrengthBands: z.array(z.object({ multiple: z.number().min(0), score: z.number().min(0).max(100) })).min(2),
  investmentPolicyValidated: z.boolean(), profileNote: z.string().max(500).nullable(),
}).partial().strict();

export const ruleIn = z.object({
  enabled: z.boolean().optional(), value: z.number().optional(), severity: z.enum(["critical", "high", "warning", "info"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const targetsIn = z.array(z.object({ assetClass: z.enum(ASSET_CLASSES), targetBps: z.number().int().min(0).max(10000), bandBps: z.number().int().min(0).max(5000).nullable() }))
  .superRefine((t, ctx) => {
    if (t.length === 0) return;
    const sum = t.reduce((s, x) => s + x.targetBps, 0);
    if (sum !== 10000) ctx.addIssue({ code: "custom", message: `Targets must add up to 100% (currently ${(sum / 100).toFixed(2)}%).` });
    if (new Set(t.map((x) => x.assetClass)).size !== t.length) ctx.addIssue({ code: "custom", message: "Each asset class may appear only once." });
  });

export const tradesIn = z.array(z.object({ assetClass: z.enum(ASSET_CLASSES), amount: z.number().int().min(-9e13).max(9e13), label: z.string().max(100).optional() })).max(20);
