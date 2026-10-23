import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { resetThrottle } from "../src/server/auth";
import { crore, lakh } from "../src/shared/money";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
const tmp = path.join(os.tmpdir(), `nw-test-${process.pid}.db`);

class Session {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const isText = typeof body === "string";
    const r = await fetch(base + url, {
      method, headers: { ...(body !== undefined ? { "Content-Type": isText ? "text/csv" : "application/json" } : {}), "X-Requested-With": "networth", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : isText ? body : JSON.stringify(body),
    });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await r.json() : await r.text();
    return { status: r.status, data: data as any, headers: r.headers };
  }
  async login(email: string, password: string) { return this.req("POST", "/api/auth/login", { email, password }); }
}
const admin = new Session(), viewer = new Session();
const P = "/api/clients/client_priya";

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp);
  seedIfEmpty(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle();
  expect((await admin.login("advisor@demo.local", "Demo@2026-Advisor")).status).toBe(200);
  expect((await viewer.login("viewer@demo.local", "Demo@2026-Viewer")).status).toBe(200);
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("auth & authorisation", () => {
  it("rejects unauthenticated access", async () => { expect((await new Session().req("GET", "/api/clients")).status).toBe(401); });
  it("rejects wrong password with a generic message", async () => { const r = await new Session().login("advisor@demo.local", "nope"); expect(r.status).toBe(401); expect(r.data.error).toBe("Incorrect email or password."); });
  it("unknown user gets the same error", async () => { const r = await new Session().login("ghost@x.com", "nope"); expect(r.status).toBe(401); expect(r.data.error).toBe("Incorrect email or password."); });
  it("session cookie is HttpOnly + SameSite=Strict", async () => { const r = await new Session().login("advisor@demo.local", "Demo@2026-Advisor"); const c = r.headers.get("set-cookie")!; expect(c).toMatch(/HttpOnly/i); expect(c).toMatch(/SameSite=Strict/i); });
  it("viewer is read-only (server-enforced)", async () => {
    expect((await viewer.req("GET", `${P}/state`)).status).toBe(200);
    expect((await viewer.req("POST", `${P}/liabilities`, { name: "x", type: "personal_loan", outstanding: 100 })).status).toBe(403);
    expect((await viewer.req("POST", "/api/demo/reset", {})).status).toBe(403);
  });
  it("mutations without the CSRF header are refused", async () => {
    const r = await fetch(base + `${P}/liabilities`, { method: "POST", headers: { "Content-Type": "application/json", cookie: admin.cookie }, body: "{}" });
    expect(r.status).toBe(403);
  });
  it("password hashes never leave the server", async () => { const r = await admin.req("GET", "/api/auth/me"); expect(JSON.stringify(r.data)).not.toMatch(/scrypt|password/i); });
  it("security headers are present", async () => { const r = await admin.req("GET", "/api/health"); expect(r.headers.get("content-security-policy")).toContain("default-src 'self'"); expect(r.headers.get("x-content-type-options")).toBe("nosniff"); });
});

describe("Priya baseline via API", () => {
  it("reconciles to the supplied figures", async () => {
    const { data } = await admin.req("GET", `${P}/state`);
    const e = data.evaluation;
    expect(e.portfolio.grossAssets).toBe(crore(8.63));
    expect(e.cash.monthlyOutflows).toBe(lakh(2));
    expect(e.netWorth.netWorth).toBeNull();
    expect(e.netWorth.commitmentsRemaining).toBe(lakh(20));
  });
  it("persists alert history without duplicating on every refresh", async () => {
    const a1 = (await admin.req("GET", `${P}/state`)).data.alerts;
    const a2 = (await admin.req("GET", `${P}/state`)).data.alerts;
    expect(a2.length).toBe(a1.length);
    expect(new Set(a2.filter((a: any) => a.status !== "resolved").map((a: any) => a.fingerprint)).size).toBe(a2.filter((a: any) => a.status !== "resolved").length);
  });
});

describe("workflow: add scheme -> alert -> resolve; liabilities -> net worth", () => {
  let childId = "";
  it("validates input", async () => {
    const r = await admin.req("POST", `${P}/holdings`, { name: "", instrumentType: "equity_mf", currentValue: -5 });
    expect(r.status).toBe(422);
  });
  it("adding an equity scheme under the MF aggregate triggers a definite equity alert", async () => {
    const r = await admin.req("POST", `${P}/holdings`, { name: "Sample Flexi Cap Fund", instrumentType: "equity_mf", currentValue: crore(1.5), investedValue: crore(1.2), valuationDate: "2026-10-18", parentId: "h_priya_mf", classOverride: "indian_equity" });
    expect(r.status).toBe(201); childId = r.data.item.id;
    expect(r.data.item.classOverride).toBe("indian_equity"); expect(r.data.item.classificationMethod).toBe("user_override");
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.evaluation.portfolio.grossAssets).toBe(crore(8.63)); // no double counting
    expect(st.evaluation.portfolio.unresolved.value).toBe(crore(0.33));
    const eq = st.alerts.find((a: any) => a.ruleKey === "equity_allocation_max" && a.status !== "resolved");
    expect(eq.kind).toBe("breach");
    expect(st.evaluation.portfolio.returns.absoluteReturn).not.toBeNull();
  });
  it("lowering the value downgrades the SAME alert to 'possible' (a logged change, not a duplicate)", async () => {
    await admin.req("PATCH", `${P}/holdings/${childId}`, { currentValue: lakh(10) });
    const st = (await admin.req("GET", `${P}/state`)).data;
    const eqAlerts = st.alerts.filter((a: any) => a.ruleKey === "equity_allocation_max");
    expect(eqAlerts).toHaveLength(1);
    expect(eqAlerts[0].kind).toBe("possible");
    expect(eqAlerts[0].events.map((e: any) => e.event)).toEqual(expect.arrayContaining(["detected", "changed"]));
    await admin.req("PATCH", `${P}/holdings/${childId}`, { currentValue: crore(1.5) });
    const st2 = (await admin.req("GET", `${P}/state`)).data;
    expect(st2.alerts.filter((a: any) => a.ruleKey === "equity_allocation_max" && a.status !== "resolved")).toHaveLength(1);
  });
  it("threshold change immediately changes evaluation", async () => {
    await admin.req("PUT", `${P}/rules/equity_allocation_max`, { value: 90 });
    let st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.evaluation.rules.find((r: any) => r.key === "equity_allocation_max").state).toBe("ok");
    const eqAlerts = st.alerts.filter((a: any) => a.ruleKey === "equity_allocation_max");
    expect(eqAlerts.every((a: any) => a.status === "resolved" && a.resolvedAt)).toBe(true);
    expect(eqAlerts[0].events.map((e: any) => e.event)).toContain("resolved");
    expect((await admin.req("PUT", `${P}/rules/equity_allocation_max`, { value: 150 })).status).toBe(422);
    await admin.req("PUT", `${P}/rules/equity_allocation_max`, { value: 60 });
    st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.evaluation.rules.find((r: any) => r.key === "equity_allocation_max").state).toBe("triggered");
  });
  it("disabling a rule resolves its alerts", async () => {
    await admin.req("PUT", `${P}/rules/equity_allocation_max`, { enabled: false });
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.alerts.find((a: any) => a.ruleKey === "equity_allocation_max" && a.status !== "resolved")).toBeUndefined();
    await admin.req("PUT", `${P}/rules/equity_allocation_max`, { enabled: true });
  });
  it("recording a liability makes net worth provisional and recalculates", async () => {
    const r = await admin.req("POST", `${P}/liabilities`, { name: "Home loan", type: "home_loan", outstanding: lakh(40), emi: lakh(0.4), rateBps: 850, remainingMonths: 120 }, { "Idempotency-Key": "k1" });
    expect(r.status).toBe(201);
    const again = await admin.req("POST", `${P}/liabilities`, { name: "Home loan", type: "home_loan", outstanding: lakh(40), emi: lakh(0.4) }, { "Idempotency-Key": "k1" });
    expect(again.headers.get("idempotent-replay")).toBe("true");
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.data.liabilities.filter((l: any) => l.name === "Home loan")).toHaveLength(1);
    expect(st.evaluation.netWorth.netWorth).toBe(crore(8.63) - lakh(40));
    expect(st.evaluation.netWorth.provisional).toBe(true);
    await admin.req("PATCH", `${P}/settings`, { liabilitiesStatus: "complete" });
    expect((await admin.req("GET", `${P}/state`)).data.evaluation.netWorth.provisional).toBe(false);
  });
  it("snapshots feed month-on-month change", async () => {
    const prev = new Date(); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const date = prev.toISOString().slice(0, 10);
    expect((await admin.req("POST", `${P}/snapshots`, { date })).status).toBe(201);
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.evaluation.netWorth.changeMonth.comparable).toBe(true);
    expect(st.evaluation.netWorth.changeMonth.percent).toBeCloseTo(0, 6);
  });
  it("audit trail records changes", async () => {
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.audit.some((a: any) => a.action === "create" && /Home loan/.test(a.summary))).toBe(true);
  });
});

describe("targets, scenarios", () => {
  it("rejects allocation targets that do not sum to 100%", async () => {
    const r = await admin.req("PUT", `${P}/targets`, [{ assetClass: "indian_equity", targetBps: 6000, bandBps: null }, { assetClass: "debt", targetBps: 3000, bandBps: null }]);
    expect(r.status).toBe(422); expect(r.data.error).toMatch(/100%/);
  });
  it("changing targets recalculates drift", async () => {
    const ok = await admin.req("PUT", `${P}/targets`, [{ assetClass: "indian_equity", targetBps: 7000, bandBps: null }, { assetClass: "debt", targetBps: 3000, bandBps: null }]);
    expect(ok.status).toBe(200);
    const row = (await admin.req("GET", `${P}/state`)).data.evaluation.allocation.investable.find((r: any) => r.assetClass === "indian_equity");
    expect(row.targetPct).toBe(70);
  });
  it("scenario evaluation does not persist anything", async () => {
    const before = (await admin.req("GET", `${P}/state`)).data.evaluation.portfolio.grossAssets;
    const r = await admin.req("POST", `${P}/scenario/evaluate`, { trades: [{ assetClass: "debt", amount: lakh(30) }] });
    expect(r.status).toBe(200); expect(r.data.after.grossAssets).toBe(before + lakh(30));
    expect((await admin.req("GET", `${P}/state`)).data.evaluation.portfolio.grossAssets).toBe(before);
  });
});

describe("import / export", () => {
  const csv = "Name,Type,Current value,Invested value,Valuation date\r\nImp Debt Fund,Debt MF,5L,4L,2026-10-10\r\nBad Row,Wibble,1000,,\r\nImp Debt Fund,Debt MF,5L,4L,2026-10-10\r\n=HYPERLINK(\"x\"),Equity MF,1L,,\r\n";
  it("dry run reports accepted / rejected / duplicates and writes nothing", async () => {
    const r = await admin.req("POST", `${P}/import/holdings?dryRun=1&filename=t.csv`, csv);
    expect(r.status).toBe(200);
    expect(r.data.accepted).toBe(2); expect(r.data.rejected).toBe(1); expect(r.data.duplicates).toBe(1);
    expect((await admin.req("GET", `${P}/state`)).data.data.holdings.some((h: any) => h.name === "Imp Debt Fund")).toBe(false);
  });
  it("commit imports once; the same file is blocked the second time", async () => {
    expect((await admin.req("POST", `${P}/import/holdings?filename=t.csv`, csv)).status).toBe(200);
    expect((await admin.req("POST", `${P}/import/holdings?filename=t.csv`, csv)).status).toBe(409);
    expect((await admin.req("GET", `${P}/state`)).data.data.holdings.filter((h: any) => h.name === "Imp Debt Fund")).toHaveLength(1);
  });
  it("CSV export neutralises formula injection and scopes to the client", async () => {
    const r = await admin.req("GET", `${P}/export/holdings.csv`);
    expect(r.status).toBe(200);
    expect(r.data).toContain("'=HYPERLINK");
    expect(r.data).not.toContain("Case A");
  });
  it("xlsx export works", async () => {
    const r = await fetch(base + `${P}/export/workbook.xlsx`, { headers: { cookie: admin.cookie } });
    expect(r.status).toBe(200);
    const buf = Buffer.from(await r.arrayBuffer()); expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("demo isolation & reset", () => {
  it("case studies are separate clients", async () => {
    const c = (await admin.req("GET", "/api/clients")).data.clients;
    expect(c.map((x: any) => x.id)).toEqual(expect.arrayContaining(["client_priya", "case_a_aggressive", "case_b_conservative", "case_c_moderate"]));
    const a = (await admin.req("GET", "/api/clients/case_a_aggressive/state")).data;
    expect(a.evaluation.netWorth.netWorth).toBe(crore(5));
  });
  it("reset restores Priya but leaves user-created clients alone", async () => {
    const mine = await admin.req("POST", "/api/clients", { name: "My real client" });
    expect(mine.status).toBe(201);
    await admin.req("POST", `/api/clients/${mine.data.id}/liabilities`, { name: "L", type: "personal_loan", outstanding: 1000 });
    expect((await admin.req("POST", "/api/demo/reset", {})).status).toBe(200);
    const st = (await admin.req("GET", `${P}/state`)).data;
    expect(st.evaluation.portfolio.grossAssets).toBe(crore(8.63));
    expect(st.data.liabilities).toHaveLength(0);
    expect(st.evaluation.netWorth.netWorth).toBeNull();
    const m = (await admin.req("GET", `/api/clients/${mine.data.id}/state`)).data;
    expect(m.data.liabilities).toHaveLength(1);
  });
  it("reset of a non-demo client is refused", async () => { expect((await admin.req("POST", "/api/demo/reset", { clientId: "nope" })).status).toBeGreaterThanOrEqual(400); });
});

describe("market data", () => {
  it("demo provider is labelled demo and validated", async () => {
    const r = await admin.req("POST", "/api/market/refresh", { provider: "demo" });
    expect(r.data.ok).toBe(true);
    const s = (await admin.req("GET", "/api/market/status")).data;
    expect(s.observations.length).toBeGreaterThan(0);
    expect(s.observations.every((o: any) => o.isDemo)).toBe(true);
  });
  it("provider without credentials fails gracefully and keeps previous data", async () => {
    const before = (await admin.req("GET", "/api/market/status")).data.observations.length;
    const r = await admin.req("POST", "/api/market/refresh", { provider: "sp500" });
    expect(r.data.ok).toBe(false); expect(r.data.message).toMatch(/credentials|kept/i);
    expect((await admin.req("GET", "/api/market/status")).data.observations.length).toBe(before);
  });
  it("manual CSV rejects invalid rows", async () => {
    const r = await admin.req("POST", "/api/market/manual", "symbol,date,value\r\nXYZ,2026-10-01,100\r\nBAD,2026-10-01,-5\r\n");
    expect(r.data.stored).toBe(1); expect(r.data.rejected).toHaveLength(1);
  });
});

describe("durability", () => {
  it("data and alert history survive closing and re-opening the database file", async () => {
    await admin.req("POST", `${P}/goals`, { name: "Persist me", type: "wealth", targetAmount: lakh(10), targetDate: "2030-01-01", earmarkedAmount: 0, monthlyContribution: 0 });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const db2 = openDb(tmp);
    const row = db2.prepare("SELECT name FROM goals WHERE name = 'Persist me'").get();
    const n = (db2.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }).n;
    db2.close();
    expect(row).toBeTruthy(); expect(n).toBeGreaterThan(0);
  });
});
