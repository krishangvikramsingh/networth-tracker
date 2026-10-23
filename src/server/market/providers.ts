import type { MarketProvider, Observation, ProviderInfo } from "./types";
import { todayISO } from "../../shared/dates";

/** Sample data. Deterministic, clearly labelled — NEVER presented as live market data. */
export const DEMO_UNIVERSE: Array<{ symbol: string; name: string; kind: Observation["kind"]; currency: string; base: number }> = [
  { symbol: "NIFTY500", name: "NIFTY 500 (sample)", kind: "index", currency: "INR", base: 22150.35 },
  { symbol: "SPX", name: "S&P 500 (sample)", kind: "index", currency: "USD", base: 5950.12 },
  { symbol: "USDINR", name: "USD/INR (sample)", kind: "fx", currency: "INR", base: 84.2 },
  { symbol: "DEMO-EQMF", name: "Sample Equity Fund NAV", kind: "mf_nav", currency: "INR", base: 78.4 },
  { symbol: "DEMO-DEBTMF", name: "Sample Debt Fund NAV", kind: "mf_nav", currency: "INR", base: 31.2 },
  { symbol: "DEMO-GOLDFUND", name: "Sample Gold Fund NAV", kind: "commodity_fund", currency: "INR", base: 22.8 },
  { symbol: "DEMO-REIT", name: "Sample REIT price", kind: "reit", currency: "INR", base: 318.5 },
  { symbol: "DEMO-INVIT", name: "Sample InvIT price", kind: "reit", currency: "INR", base: 104.2 },
  { symbol: "DEMO-GSEC", name: "Sample G-Sec price", kind: "bond", currency: "INR", base: 101.35 },
];
export const demoProvider: MarketProvider = {
  info: () => ({ id: "demo", name: "Demo sample data", covers: DEMO_UNIVERSE.map((u) => u.symbol), requiresCredentials: false, isDemo: true, configured: true, liveStatus: "demo-data",
    notes: "Synthetic, deterministic values for demonstration. These are NOT market prices." }),
  async fetch(symbols) {
    const day = todayISO();
    const seed = Number(day.replaceAll("-", "")) % 97;
    return DEMO_UNIVERSE.filter((u) => symbols.length === 0 || symbols.includes(u.symbol)).map((u, i) => ({
      symbol: u.symbol, name: u.name, kind: u.kind, currency: u.currency, asOf: day, source: "demo", isDemo: true,
      value: Math.round(u.base * (1 + (((seed + i * 7) % 21) - 10) / 1000) * 100) / 100,
    }));
  },
};

/**
 * AMFI NAV file (https://www.amfiindia.com/spages/NAVAll.txt) — AMFI publishes daily NAVs for all Indian mutual-fund schemes.
 * Format: "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date". Date is dd-Mon-yyyy.
 * NOTE: parser is unit-tested against the documented format; the live endpoint could not be reached from the build sandbox.
 */
export function parseAmfiNav(text: string, wanted: string[]): Observation[] {
  const want = new Set(wanted);
  const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const out: Observation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.split(";");
    if (p.length < 6 || !/^\d+$/.test(p[0].trim())) continue;
    const [code, isin1, isin2, name, nav, date] = p.map((x) => x.trim());
    const hit = want.has(code) ? code : want.has(isin1) ? isin1 : want.has(isin2) ? isin2 : null;
    if (!hit) continue;
    const v = Number(nav);
    const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(date);
    if (!Number.isFinite(v) || v <= 0 || !m || !MONTHS[m[2]]) continue; // "N.A." etc. are skipped, never stored
    out.push({ symbol: hit, name, kind: "mf_nav", value: v, currency: "INR", asOf: `${m[3]}-${MONTHS[m[2]]}-${m[1]}`, source: "amfi", isDemo: false });
  }
  return out;
}
export const amfiProvider: MarketProvider = {
  info: () => ({ id: "amfi", name: "AMFI India — mutual fund NAVs", covers: ["Equity MF", "Debt MF", "Commodity/gold funds (as MF schemes)"], requiresCredentials: false, isDemo: false, configured: true, liveStatus: "implemented-unverified",
    notes: "Public daily NAV file published by AMFI. Request is cached and rate-limited. Identify holdings by AMFI scheme code or ISIN in the Symbol field.", terms: "Check AMFI's terms of use before commercial use." }),
  async fetch(symbols, signal) {
    const res = await fetch(process.env.AMFI_NAV_URL ?? "https://www.amfiindia.com/spages/NAVAll.txt", { signal, headers: { "user-agent": "networth-tracker-academic/1.0" } });
    if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
    return parseAmfiNav(await res.text(), symbols);
  },
};

function licensed(id: string, name: string, covers: string[], env: string, notes: string): MarketProvider {
  return {
    info: (): ProviderInfo => ({ id, name, covers, requiresCredentials: true, credentialEnv: env, isDemo: false, configured: !!process.env[env], liveStatus: process.env[env] ? "implemented-unverified" : "needs-credentials", notes }),
    async fetch() {
      if (!process.env[env]) throw new Error(`${name}: credentials missing — set ${env} (see docs/MARKET_DATA.md).`);
      throw new Error(`${name}: adapter slot only. Implement the vendor request in src/server/market/providers.ts after confirming licence terms.`);
    },
  };
}
export const nseProvider = licensed("nse", "NSE indices / REITs / InvITs / bonds", ["NIFTY 500", "REITs", "InvITs", "Bonds"], "NSE_DATA_API_KEY", "NSE market data is licensed; no free official API is assumed. Use manual CSV upload or a licensed vendor.");
export const spProvider = licensed("sp500", "S&P 500 via licensed market-data vendor", ["S&P 500"], "SP500_DATA_API_KEY", "Index levels require a vendor licence (e.g. S&P Dow Jones Indices partners). Not assumed free.");

export const manualProvider: MarketProvider = {
  info: () => ({ id: "manual", name: "Manual CSV upload", covers: ["Any symbol"], requiresCredentials: false, isDemo: false, configured: true, liveStatus: "manual-upload",
    notes: "Upload a CSV with columns: symbol,date,value[,currency,kind]. Values you enter are stored as user-supplied observations." }),
  async fetch() { return []; },
};
export const PROVIDERS: Record<string, MarketProvider> = { demo: demoProvider, amfi: amfiProvider, nse: nseProvider, sp500: spProvider, manual: manualProvider };
