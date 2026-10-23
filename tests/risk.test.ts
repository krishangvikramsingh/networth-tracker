import { describe, expect, it } from "vitest";
import { ASSET_CLASSES } from "../src/shared/taxonomy";
import { MODEL_PORTFOLIOS, PROFILE_KEYS, PROFILES, RISK_QUESTIONS, assessRisk, modelTargets, profileForScore, type Answers } from "../src/shared/riskprofile";

/** Answer every question with the same option index, optionally overriding some. */
const all = (opt: number, over: Answers = {}): Answers => ({ ...Object.fromEntries(RISK_QUESTIONS.map((q) => [q.id, opt])), ...over });

describe("risk profile scoring", () => {
  it("has the expected question set and four options each", () => {
    expect(RISK_QUESTIONS.filter((q) => q.section === "tolerance").length).toBe(4);
    expect(RISK_QUESTIONS.filter((q) => q.section === "capacity").length).toBe(4);
    for (const q of RISK_QUESTIONS) expect(q.options.map((o) => o.score)).toEqual([0, 1, 2, 3]);
    expect(new Set(RISK_QUESTIONS.map((q) => q.id)).size).toBe(RISK_QUESTIONS.length);
  });
  it("band edges: just below, at and just above each minimum", () => {
    const edges: Array<[number, number]> = [[24, 0], [25, 1], [44, 1], [45, 2], [64, 2], [65, 3], [84, 3], [85, 4], [100, 4], [0, 0]];
    for (const [score, i] of edges) expect(profileForScore(score), `score ${score}`).toBe(PROFILE_KEYS[i]);
  });
  it("lowest answers give Conservative, highest give Aggressive", () => {
    const lo = assessRisk(all(0)), hi = assessRisk(all(3));
    expect(lo.complete).toBe(true); expect(lo.profile).toBe("conservative"); expect(lo.tolerance.score).toBe(0); expect(lo.capacity.score).toBe(0);
    expect(hi.profile).toBe("aggressive"); expect(hi.tolerance.score).toBe(100); expect(hi.capacity.score).toBe(100); expect(hi.limitedBy).toBe("equal");
  });
  it("uses the LOWER of willingness and capacity", () => {
    const r = assessRisk(all(3, { c_income: 1, c_obligations: 0 })); // capacity (3+1+3+0)/12 = 58 -> balanced; tolerance 100
    expect(r.tolerance.score).toBe(100); expect(r.capacity.score).toBe(58);
    expect(r.profile).toBe("balanced"); expect(r.limitedBy).toBe("capacity");
    const r2 = assessRisk(all(3, { t_drop: 0, t_range: 0, t_exp: 1, t_goal: 1 })); // tolerance 17 -> conservative
    expect(r2.profile).toBe("conservative"); expect(r2.limitedBy).toBe("tolerance");
  });
  it("a horizon under 3 years caps the profile at Conservative whatever the scores say", () => {
    const r = assessRisk(all(3, { c_horizon: 0 }));
    expect(r.capacity.score).toBeGreaterThanOrEqual(75);
    expect(r.profile).toBe("conservative"); expect(r.limitedBy).toBe("guard_rail"); expect(r.guardRails).toEqual([{ questionId: "c_horizon", cap: "conservative" }]);
  });
  it("3 to 5 years, or under 3 months of reserve, caps at Moderately conservative; the lowest cap wins", () => {
    expect(assessRisk(all(3, { c_horizon: 1 })).profile).toBe("moderately_conservative");
    expect(assessRisk(all(3, { c_reserve: 0 })).profile).toBe("moderately_conservative");
    expect(assessRisk(all(3, { c_reserve: 0, c_horizon: 0 })).profile).toBe("conservative");
    expect(assessRisk(all(3, { c_horizon: 2 })).guardRails).toEqual([]);
  });
  it("rounds scores to whole numbers", () => {
    expect(assessRisk(all(1)).tolerance.score).toBe(33); // 4/12
    expect(assessRisk(all(2)).tolerance.score).toBe(67); // 8/12
  });
});

describe("risk profile with missing answers (unknown is not zero)", () => {
  it("no answers: no profile, full range, no section scores", () => {
    const r = assessRisk({});
    expect(r.complete).toBe(false); expect(r.profile).toBeNull(); expect(r.range).toEqual(["conservative", "aggressive"]);
    expect(r.tolerance.score).toBeNull(); expect(r.tolerance.min).toBe(0); expect(r.tolerance.max).toBe(100); expect(r.answered).toBe(0);
  });
  it("partial answers narrow the range but leave the profile open", () => {
    const r = assessRisk({ t_drop: 3, t_range: 3, t_exp: 3, t_goal: 3 }); // tolerance 100, capacity unknown
    expect(r.profile).toBeNull(); expect(r.range).toEqual(["conservative", "aggressive"]);
    const r2 = assessRisk({ t_drop: 0, t_range: 0, t_exp: 0, t_goal: 0 }); // tolerance 0 -> nothing above conservative is possible
    expect(r2.range).toEqual(["conservative", "conservative"]); expect(r2.profile).toBe("conservative");
  });
  it("a guard rail settles the profile even before the rest is answered", () => {
    const r = assessRisk({ c_horizon: 0 });
    expect(r.complete).toBe(false); expect(r.profile).toBe("conservative");
  });
  it("rejects unknown questions and out-of-range options", () => {
    expect(() => assessRisk({ nope: 1 })).toThrow(/Unknown question/);
    expect(() => assessRisk({ t_drop: 4 })).toThrow(/Invalid answer/);
    expect(() => assessRisk({ t_drop: -1 })).toThrow(/Invalid answer/);
    expect(() => assessRisk({ t_drop: 1.5 })).toThrow(/Invalid answer/);
  });
});

describe("model portfolios", () => {
  it("every profile has a model and each sums to exactly 100%", () => {
    for (const k of PROFILE_KEYS) {
      const total = Object.values(MODEL_PORTFOLIOS[k]).reduce((a, b) => a + b, 0);
      expect(total, k).toBe(10000);
      for (const c of Object.keys(MODEL_PORTFOLIOS[k])) expect(ASSET_CLASSES as readonly string[]).toContain(c);
      expect(PROFILES[k].label.length).toBeGreaterThan(0);
    }
  });
  it("equity share rises with each step up in risk and direct property is never targeted", () => {
    const eq = PROFILE_KEYS.map((k) => (MODEL_PORTFOLIOS[k].indian_equity ?? 0) + (MODEL_PORTFOLIOS[k].global_equity ?? 0));
    expect(eq).toEqual([2000, 3500, 5000, 6500, 8000]);
    for (const k of PROFILE_KEYS) expect(MODEL_PORTFOLIOS[k].real_estate).toBeUndefined();
  });
  it("modelTargets yields positive basis points with no band", () => {
    for (const t of modelTargets("balanced")) { expect(t.targetBps).toBeGreaterThan(0); expect(t.bandBps).toBeNull(); }
  });
});
