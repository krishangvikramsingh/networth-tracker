import { addMonths, daysBetween, type ISODate } from "./dates";
import { pct, type Paise } from "./money";
import type { Goal } from "./types";

export interface GoalProgress {
  goal: Goal; progressPct: number | null; gap: Paise; monthsLeft: number; overdue: boolean;
  projectedValue: Paise; projectedGap: Paise; requiredMonthly: Paise | null; onTrack: boolean;
  assumption: string;
}

/** Future value of current earmark + monthly contributions at an annual rate (nominal, monthly compounding). Projection only. */
export function projectGoal(g: Goal, asOf: ISODate): GoalProgress {
  const days = daysBetween(asOf, g.targetDate);
  const monthsLeft = Math.max(0, Math.round(days / 30.4375));
  const gap = Math.max(0, g.targetAmount - g.earmarkedAmount);
  const r = (g.expectedReturnBps ?? 0) / 10000 / 12;
  const n = monthsLeft;
  const growth = r === 0 ? 1 : Math.pow(1 + r, n);
  const fvLump = g.earmarkedAmount * growth;
  const fvAnn = r === 0 ? g.monthlyContribution * n : g.monthlyContribution * ((growth - 1) / r);
  const projected = Math.round(fvLump + fvAnn);
  const projectedGap = Math.max(0, g.targetAmount - projected);
  // contribution needed per month to close the remaining gap after growth of the existing earmark
  const need = g.targetAmount - fvLump;
  const requiredMonthly = n === 0 ? null : need <= 0 ? 0 : Math.round(r === 0 ? need / n : need / ((growth - 1) / r));
  return {
    goal: g, progressPct: pct(g.earmarkedAmount, g.targetAmount), gap, monthsLeft, overdue: days < 0, projectedValue: projected, projectedGap,
    requiredMonthly, onTrack: projected >= g.targetAmount,
    assumption: g.expectedReturnBps == null ? "No return assumption given: projection uses 0% growth." : `Assumes ${(g.expectedReturnBps / 100).toFixed(1)}% p.a. (user assumption, not a forecast or guarantee).`,
  };
}
export { addMonths };
