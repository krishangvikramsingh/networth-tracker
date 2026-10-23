import type { AssetClass } from "./taxonomy";

/**
 * Risk-profile questionnaire. Pure functions only (no I/O).
 *
 * Two independent scores are produced:
 *   tolerance - willingness to accept losses (behaviour, experience, objective)
 *   capacity  - ability to absorb losses (horizon, income stability, reserves, obligations)
 * The profile is the LOWER of the two, then capped by any hard guard-rail option the client chose
 * (e.g. "need the money within 3 years"). Unanswered questions give a range, never a silent zero.
 */
export const PROFILE_KEYS = ["conservative", "moderately_conservative", "balanced", "moderately_aggressive", "aggressive"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export const PROFILES: Record<ProfileKey, { label: string; minScore: number; description: string }> = {
  conservative: { label: "Conservative", minScore: 0, description: "Protects capital first. Accepts low returns to avoid losses." },
  moderately_conservative: { label: "Moderately conservative", minScore: 25, description: "Mostly stable assets with a modest growth allocation." },
  balanced: { label: "Balanced", minScore: 45, description: "Comfortable with periodic falls for a mix of growth and stability." },
  moderately_aggressive: { label: "Moderately aggressive", minScore: 65, description: "Growth-oriented; accepts large temporary falls." },
  aggressive: { label: "Aggressive", minScore: 85, description: "Maximises long-term growth; accepts deep and prolonged falls." },
};

export interface RiskOption { label: string; score: 0 | 1 | 2 | 3; /** Hard ceiling on the final profile if this option is chosen. */ cap?: ProfileKey }
export interface RiskQuestion { id: string; section: "tolerance" | "capacity"; text: string; options: RiskOption[] }

export const RISK_QUESTIONS: RiskQuestion[] = [
  { id: "t_drop", section: "tolerance", text: "Your portfolio falls 20% in three months. What would you most likely do?",
    options: [{ label: "Sell everything to stop further losses", score: 0 }, { label: "Sell some to reduce the risk", score: 1 }, { label: "Hold and wait for a recovery", score: 2 }, { label: "Invest more while prices are low", score: 3 }] },
  { id: "t_range", section: "tolerance", text: "Which range of yearly outcomes would you accept for your long-term money?",
    options: [{ label: "+4% to +6% (almost no loss)", score: 0 }, { label: "-5% to +10%", score: 1 }, { label: "-15% to +20%", score: 2 }, { label: "-30% to +40%", score: 3 }] },
  { id: "t_exp", section: "tolerance", text: "How much experience do you have with market-linked investments?",
    options: [{ label: "None; deposits and savings only", score: 0 }, { label: "Some (under 3 years)", score: 1 }, { label: "Moderate (3 to 10 years, including a downturn)", score: 2 }, { label: "Extensive (10+ years, several downturns)", score: 3 }] },
  { id: "t_goal", section: "tolerance", text: "What matters most for this money?",
    options: [{ label: "Protecting what I have", score: 0 }, { label: "Steady income", score: 1 }, { label: "Growth, with some ups and downs", score: 2 }, { label: "Maximum long-term growth", score: 3 }] },
  { id: "c_horizon", section: "capacity", text: "When will you first need a significant part (over 25%) of this money?",
    options: [{ label: "Within 3 years", score: 0, cap: "conservative" }, { label: "In 3 to 5 years", score: 1, cap: "moderately_conservative" }, { label: "In 5 to 10 years", score: 2 }, { label: "In more than 10 years", score: 3 }] },
  { id: "c_income", section: "capacity", text: "How stable is your income?",
    options: [{ label: "Irregular or uncertain", score: 0 }, { label: "Somewhat stable", score: 1 }, { label: "Stable salary or business", score: 2 }, { label: "Stable, with other income such as rent or pension", score: 3 }] },
  { id: "c_reserve", section: "capacity", text: "How many months of expenses do you hold in easily accessible savings, outside this portfolio?",
    options: [{ label: "Less than 3", score: 0, cap: "moderately_conservative" }, { label: "3 to 6", score: 1 }, { label: "6 to 12", score: 2 }, { label: "More than 12", score: 3 }] },
  { id: "c_obligations", section: "capacity", text: "What share of your monthly income goes to EMIs and fixed obligations?",
    options: [{ label: "Over 50%", score: 0 }, { label: "30% to 50%", score: 1 }, { label: "10% to 30%", score: 2 }, { label: "Under 10%", score: 3 }] },
];

/**
 * Illustrative model allocations in basis points (each sums to 10,000). These are teaching examples,
 * NOT a validated investment policy; applying one never marks the policy as validated.
 */
export const MODEL_PORTFOLIOS: Record<ProfileKey, Partial<Record<AssetClass, number>>> = {
  conservative: { indian_equity: 1500, global_equity: 500, debt: 6500, commodities: 1000, reits_invits: 500 },
  moderately_conservative: { indian_equity: 2500, global_equity: 1000, debt: 5000, commodities: 1000, reits_invits: 500 },
  balanced: { indian_equity: 3500, global_equity: 1500, debt: 3000, commodities: 1000, reits_invits: 500, alternatives: 500 },
  moderately_aggressive: { indian_equity: 4500, global_equity: 2000, debt: 1500, commodities: 1000, reits_invits: 500, alternatives: 500 },
  aggressive: { indian_equity: 5500, global_equity: 2500, debt: 500, commodities: 500, reits_invits: 500, alternatives: 500 },
};
export const modelTargets = (p: ProfileKey) =>
  (Object.entries(MODEL_PORTFOLIOS[p]) as Array<[AssetClass, number]>).map(([assetClass, targetBps]) => ({ assetClass, targetBps, bandBps: null as number | null }));

export type Answers = Record<string, number>;
export interface SectionScore { score: number | null; min: number; max: number; answered: number; total: number }
export interface RiskResult {
  answered: number; total: number; complete: boolean;
  tolerance: SectionScore; capacity: SectionScore;
  /** Definite only when every answer is in, or when the remaining answers cannot change the outcome. */
  profile: ProfileKey | null;
  /** Lowest and highest profile still possible given the answers so far. */
  range: [ProfileKey, ProfileKey];
  limitedBy: "tolerance" | "capacity" | "guard_rail" | "equal" | null;
  guardRails: Array<{ questionId: string; cap: ProfileKey }>;
}

const idx = (p: ProfileKey) => PROFILE_KEYS.indexOf(p);
export function profileForScore(score: number): ProfileKey {
  let out: ProfileKey = "conservative";
  for (const k of PROFILE_KEYS) if (score >= PROFILES[k].minScore) out = k;
  return out;
}

function section(answers: Answers, which: RiskQuestion["section"]): SectionScore {
  const qs = RISK_QUESTIONS.filter((q) => q.section === which);
  const per = (q: RiskQuestion) => answers[q.id];
  const answeredQs = qs.filter((q) => per(q) != null);
  const sum = answeredQs.reduce((a, q) => a + q.options[per(q)].score, 0);
  const full = qs.length * 3;
  const remaining = (qs.length - answeredQs.length) * 3;
  const pct = (v: number) => Math.round((v / full) * 100);
  const complete = answeredQs.length === qs.length;
  return { score: complete ? pct(sum) : null, min: pct(sum), max: pct(sum + remaining), answered: answeredQs.length, total: qs.length };
}

/** Throws on an unknown question id or an out-of-range option index; unanswered questions are allowed. */
export function assessRisk(answers: Answers): RiskResult {
  for (const [id, v] of Object.entries(answers)) {
    const q = RISK_QUESTIONS.find((x) => x.id === id);
    if (!q) throw new Error(`Unknown question "${id}".`);
    if (!Number.isInteger(v) || v < 0 || v >= q.options.length) throw new Error(`Invalid answer for "${id}".`);
  }
  const tolerance = section(answers, "tolerance"), capacity = section(answers, "capacity");
  const guardRails = RISK_QUESTIONS.flatMap((q) => { const o = answers[q.id] != null ? q.options[answers[q.id]] : undefined; return o?.cap ? [{ questionId: q.id, cap: o.cap }] : []; });
  const ceiling = guardRails.reduce((m, g) => Math.min(m, idx(g.cap)), PROFILE_KEYS.length - 1);
  const at = (t: number, c: number) => Math.min(idx(profileForScore(t)), idx(profileForScore(c)), ceiling);
  const lo = at(tolerance.min, capacity.min), hi = at(tolerance.max, capacity.max);
  const answered = tolerance.answered + capacity.answered, total = tolerance.total + capacity.total;
  const complete = answered === total;
  const profile = complete || lo === hi ? PROFILE_KEYS[lo] : null;

  let limitedBy: RiskResult["limitedBy"] = null;
  if (profile && complete) {
    const t = idx(profileForScore(tolerance.score!)), c = idx(profileForScore(capacity.score!));
    const base = Math.min(t, c);
    limitedBy = ceiling < base ? "guard_rail" : t === c ? "equal" : t < c ? "tolerance" : "capacity";
  }
  return { answered, total, complete, tolerance, capacity, profile, range: [PROFILE_KEYS[lo], PROFILE_KEYS[hi]], limitedBy, guardRails };
}

export const LIMITED_BY_TEXT: Record<NonNullable<RiskResult["limitedBy"]>, string> = {
  tolerance: "Your willingness to take risk is the limiting factor, so the profile follows it.",
  capacity: "Your financial ability to absorb losses is lower than your willingness, so the profile is held back to match it.",
  guard_rail: "A short time horizon or thin emergency reserve caps the profile regardless of the scores.",
  equal: "Willingness and ability to take risk point to the same profile.",
};
