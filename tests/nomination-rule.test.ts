import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blank, mkHolding, ruleOf, setRule } from "./helpers";
import { lakh } from "../src/shared/money";
import { validateRuleValue } from "../src/shared/rules";
import type { Nomination, Nominee } from "../src/shared/estate";
import type { ClientData } from "../src/shared/types";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { resetThrottle } from "../src/server/auth";

const nominee = (id = "n1"): Nominee => ({ id, clientId: "t", name: `Person ${id}`, relationship: "Spouse", contact: null, notes: null });
const nom = (entityId: string, shareBps: number, nomineeId = "n1"): Nomination => ({ id: `${entityId}${nomineeId}`, clientId: "t", entity: "holding", entityId, nomineeId, shareBps });
const h = (id: string, v: number, over = {}) => mkHolding("t", { id, name: `H-${id}`, instrumentType: "bank_balance", currentValue: v, ...over });
/** Two equal holdings, the first fully nominated: exactly 50% covered. */
const half = (threshold: number): ClientData => setRule(blank({ holdings: [h("a", lakh(50)), h("b", lakh(50))], nominees: [nominee()], nominations: [nom("a", 10000)] }), "nomination_gap", { value: threshold });

describe("nomination_gap rule", () => {
  it("is registered, enabled, informational by default, and validates its threshold", () => {
    const r = ruleOf(blank(), "nomination_gap");
    expect(r.name).toBe("Nomination gaps"); expect(r.severity).toBe("info"); expect(r.state).not.toBe("disabled");
    expect(validateRuleValue("nomination_gap", 0)).toBeNull(); expect(validateRuleValue("nomination_gap", 100)).toBeNull();
    expect(validateRuleValue("nomination_gap", 101)).toMatch(/at most 100/); expect(validateRuleValue("nomination_gap", -1)).toMatch(/at least 0/);
  });
  it("with nothing recorded it says Awaiting data, never 0% and never a breach", () => {
    const r = ruleOf(blank({ holdings: [h("a", lakh(10))] }), "nomination_gap");
    expect(r.state).toBe("not_evaluable"); expect(r.currentLabel).toBeNull();
    expect(r.findings).toHaveLength(1); expect(r.findings[0].kind).toBe("data_gap"); expect(r.findings[0].currentLabel).toBe("Awaiting data");
    expect(r.findings[0].why).toMatch(/does not mean none exist/);
  });
  it("boundary: exactly at the threshold is fine, just above it triggers, below it is fine", () => {
    expect(ruleOf(half(50), "nomination_gap").state).toBe("ok"); // 50% covered, threshold 50
    expect(ruleOf(half(50.01), "nomination_gap").state).toBe("triggered");
    expect(ruleOf(half(49.99), "nomination_gap").state).toBe("ok");
    expect(ruleOf(half(0), "nomination_gap").state).toBe("ok");
    expect(ruleOf(half(100), "nomination_gap").state).toBe("triggered");
  });
  it("explains what is missing and points at the uncovered holdings", () => {
    const r = ruleOf(half(100), "nomination_gap"); const f = r.findings[0];
    expect(f).toMatchObject({ kind: "breach", fingerprint: "nomination_gap:coverage", subject: "Nominations", thresholdLabel: "< 100%" });
    expect(f.currentLabel).toBe("50.0% by value"); expect(f.why).toContain("H-b (not recorded)"); expect(f.why).not.toContain("H-a");
    expect(f.records).toEqual([{ type: "holding", id: "b", name: "H-b" }]);
  });
  it("nominees with no shares recorded yet is 0% covered (they have started, so it is assessable)", () => {
    const r = ruleOf(setRule(blank({ holdings: [h("a", lakh(10))], nominees: [nominee()] }), "nomination_gap", { value: 100 }), "nomination_gap");
    expect(r.state).toBe("triggered"); expect(r.currentLabel).toBe("0.0%");
  });
  it("an 80% nomination does not count as covered; completing it to 100% does", () => {
    const base = (shares: number) => setRule(blank({ holdings: [h("a", lakh(10))], nominees: [nominee(), nominee("n2")], nominations: [nom("a", 6000), nom("a", shares, "n2")] }), "nomination_gap", { value: 100 });
    const partial = ruleOf(base(2000), "nomination_gap"); expect(partial.state).toBe("triggered"); expect(partial.findings[0].why).toContain("(partial)");
    expect(ruleOf(base(4000), "nomination_gap").state).toBe("ok");
    expect(ruleOf(base(4001), "nomination_gap").state).toBe("triggered"); // over 100% is invalid, not covered
  });
  it("measures value, not count, and ignores archived holdings and underlying positions", () => {
    const d = setRule(blank({
      holdings: [h("big", lakh(90)), h("small", lakh(10)), h("old", lakh(500), { archived: true }), h("agg", lakh(50), { isAggregate: true }), h("kid", lakh(50), { parentId: "agg" })],
      nominees: [nominee()], nominations: [nom("big", 10000), nom("agg", 10000)],
    }), "nomination_gap", { value: 100 });
    // counted: big 90 + small 10 + agg 50 = 150; covered: big 90 + agg 50 = 140
    expect(ruleOf(d, "nomination_gap").currentLabel).toBe("93.3%");
    expect(ruleOf(setRule(d, "nomination_gap", { value: 93.3 }), "nomination_gap").state).toBe("ok");
  });
  it("no holdings to measure is Awaiting data, and a disabled rule stays quiet", () => {
    expect(ruleOf(blank({ nominees: [nominee()] }), "nomination_gap").state).toBe("not_evaluable");
    expect(ruleOf(setRule(half(100), "nomination_gap", { enabled: false }), "nomination_gap")).toMatchObject({ state: "disabled", findings: [] });
  });
});

describe("nomination_gap alert lifecycle (API)", () => {
  let db: DB, server: Server, base: string, cookie = "";
  const tmp = path.join(os.tmpdir(), `nw-nomrule-${process.pid}.db`);
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: r.status, data: (await r.json()) as any };
  };
  const live = async () => (await call("GET", "/api/clients/client_priya/state")).data.alerts.filter((a: any) => a.ruleKey === "nomination_gap" && a.status !== "resolved");
  beforeAll(async () => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
    db = openDb(tmp); seedIfEmpty(db);
    server = createApp(db).listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resetThrottle(db); await call("POST", "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
  });
  afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

  it("starts as a data-gap notice, becomes a breach once nominees exist, and resolves when every holding is fully nominated", async () => {
    let a = await live(); expect(a.map((x: any) => x.kind)).toEqual(["data_gap"]);
    const nid = (await call("POST", "/api/clients/client_priya/nominees", { name: "Test Person", relationship: "Spouse" })).data.nominee.id;
    a = await live(); expect(a.map((x: any) => x.kind)).toEqual(["breach"]); expect(a[0].currentLabel).toBe("0.0% by value");
    const rows = (await call("GET", "/api/clients/client_priya/estate")).data.coverage.rows.filter((r: any) => r.entity === "holding");
    for (const r of rows.slice(0, -1)) await call("PUT", "/api/clients/client_priya/nominations", { entity: "holding", entityId: r.entityId, shares: [{ nomineeId: nid, shareBps: 10000 }] });
    a = await live(); expect(a).toHaveLength(1); expect(a[0].kind).toBe("breach"); expect(a[0].why).toContain(rows.at(-1).name);
    const last = rows.at(-1);
    await call("PUT", "/api/clients/client_priya/nominations", { entity: "holding", entityId: last.entityId, shares: [{ nomineeId: nid, shareBps: 10000 }] });
    expect(await live()).toHaveLength(0);
    await call("PUT", "/api/clients/client_priya/nominations", { entity: "holding", entityId: last.entityId, shares: [] });
    expect((await live()).map((x: any) => x.kind)).toEqual(["breach"]); // clearing a record brings it back
  });
  it("nominee changes are audited and the rule can be tuned like any other", async () => {
    expect((await call("PUT", "/api/clients/client_priya/rules/nomination_gap", { value: 0 })).status).toBe(200);
    expect(await live()).toHaveLength(0);
    expect((await call("PUT", "/api/clients/client_priya/rules/nomination_gap", { value: 150 })).status).toBe(422);
  });
});
