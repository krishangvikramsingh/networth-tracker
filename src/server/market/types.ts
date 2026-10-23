export type ObservationKind = "index" | "mf_nav" | "bond" | "commodity_fund" | "reit" | "stock" | "fx";
export interface Observation { symbol: string; kind: ObservationKind; value: number; currency: string; asOf: string; source: string; isDemo: boolean; name?: string }

export interface ProviderInfo {
  id: string; name: string; covers: string[]; requiresCredentials: boolean; credentialEnv?: string; isDemo: boolean; configured: boolean;
  /** Honest status of what has actually been verified. */
  liveStatus: "demo-data" | "implemented-unverified" | "needs-credentials" | "manual-upload";
  notes: string; terms?: string;
}
export interface MarketProvider {
  info: () => ProviderInfo;
  fetch: (symbols: string[], signal?: AbortSignal) => Promise<Observation[]>;
}
