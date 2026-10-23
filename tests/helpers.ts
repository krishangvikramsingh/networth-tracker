import { buildPriya, mkCashflow, mkHolding, mkLiability, defaultSettings, SAMPLE_TARGETS } from "../src/shared/fixtures";
import { defaultRules } from "../src/shared/rules";
import { defaultMappings } from "../src/shared/classify";
import type { ClientData, RuleConfig, RuleKey } from "../src/shared/types";
import { evaluateClient } from "../src/shared/evaluate";

export const ASOF = "2026-10-20";
export { buildPriya, mkCashflow, mkHolding, mkLiability, defaultSettings, SAMPLE_TARGETS, defaultMappings, defaultRules };

/** Empty client with default settings and rules. */
export function blank(over: Partial<ClientData> = {}): ClientData {
  const p = buildPriya();
  return {
    client: { ...p.client, id: "t", name: "Test" }, settings: { ...defaultSettings(), liabilitiesStatus: "complete", incomeStatus: "complete" },
    holdings: [], liabilities: [], cashflows: [], commitments: [], transactions: [], snapshots: [], policies: [], goals: [], targets: SAMPLE_TARGETS.map((t) => ({ ...t })),
    rules: defaultRules(), mappings: defaultMappings(), valuations: [], scoreHistory: [], ...over,
  };
}
export function setRule(d: ClientData, key: RuleKey, patch: Partial<RuleConfig> & { params?: Record<string, unknown> }): ClientData {
  return { ...d, rules: d.rules.map((r) => (r.key === key ? { ...r, ...patch, params: { ...r.params, ...(patch.params ?? {}) } } : r)) };
}
export const ruleOf = (d: ClientData, key: RuleKey, asOf = ASOF) => evaluateClient(d, asOf).rules.find((r) => r.key === key)!;
