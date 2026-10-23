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
import { reconcileAll } from "../src/server/service";
import { startReconciler } from "../src/server/jobs";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string, cookie = "";
const tmp = path.join(os.tmpdir(), `nw-readonly-${process.pid}.db`);
const P = "/api/clients/client_priya";
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|BEGIN|SAVEPOINT)/i;

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, data: ct.includes("json") ? ((await r.json()) as any) : await r.text() };
}
/** Run fn while recording every SQL statement the app prepares or executes. */
async function writesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const d = db as any, prep = d.prepare.bind(db), exec = d.exec.bind(db);
  d.prepare = (sql: string) => { if (WRITE.test(sql)) seen.push(sql.trim().slice(0, 60)); return prep(sql); };
  d.exec = (sql: string) => { if (WRITE.test(sql)) seen.push(sql.trim().slice(0, 60)); return exec(sql); };
  try { await fn(); } finally { delete d.prepare; delete d.exec; }
  return seen;
}
const dump = () => JSON.stringify([db.prepare("SELECT * FROM alerts ORDER BY id").all(), db.prepare("SELECT * FROM alert_events ORDER BY id").all(), db.prepare("SELECT * FROM health_assessments ORDER BY id").all(), db.prepare("SELECT client_id, key, last_evaluated_at FROM rules ORDER BY client_id, key").all(), db.prepare("SELECT * FROM notifications ORDER BY id").all()]);

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp);
  seedIfEmpty(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  expect((await call("POST", "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" })).status).toBe(200);
});
afterAll(() => { server.close(); db.close(); delete process.env.APP_AS_OF; for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("GET requests are read-only", () => {
  const GETS = [
    "/api/health", "/api/auth/me", "/api/meta", "/api/overview", "/api/clients", `${P}/state`, `${P}/archived/holdings`, `${P}/risk-profile`, `${P}/estate`, `${P}/scenarios`, `${P}/report`,
    `${P}/market/proposals`, "/api/market/status", "/api/import/template/holdings", "/api/notifications",
  ];
  for (const url of GETS) {
    it(`${url} issues no write statement`, async () => {
      let status = 0;
      const writes = await writesDuring(async () => { status = (await call("GET", url)).status; });
      expect(status).toBe(200);
      expect(writes).toEqual([]);
    });
  }
  it("two consecutive state reads leave every alert-related table byte-for-byte unchanged", async () => {
    await call("GET", `${P}/state`);
    const before = dump();
    await new Promise((r) => setTimeout(r, 5));
    await call("GET", `${P}/state`); await call("GET", `${P}/state`);
    expect(dump()).toBe(before);
  });
  it("the only GET that writes is the CSV export, and only its audit entry", async () => {
    const writes = await writesDuring(async () => { expect((await call("GET", `${P}/export/holdings.csv`)).status).toBe(200); });
    expect(writes.length).toBe(1); expect(writes[0]).toMatch(/INSERT INTO audit_events/);
  });
  it("a read after a change made behind the app's back does not silently reconcile", async () => {
    const before = (await call("GET", `${P}/state`)).data.alerts.length;
    db.prepare("DELETE FROM alerts WHERE client_id = 'client_priya' AND rule_key = 'portfolio_drift_max'").run();
    const after = (await call("GET", `${P}/state`)).data.alerts.length;
    expect(after).toBeLessThan(before); // proof the read just reports what is stored
    reconcileAll(db);
    expect((await call("GET", `${P}/state`)).data.alerts.length).toBe(before); // the job restores it
  });
});

describe("mutations and the scheduled job keep alerts current", () => {
  it("a mutation reconciles alerts immediately (no read needed)", async () => {
    const eq = (await call("GET", `${P}/state`)).data.alerts.filter((a: any) => a.ruleKey === "equity_allocation_max" && a.status !== "resolved").length;
    const r = await call("PUT", `${P}/rules/equity_allocation_max`, { value: 99 });
    expect(r.status).toBe(200);
    const alerts = (await call("GET", `${P}/state`)).data.alerts;
    expect(alerts.filter((a: any) => a.ruleKey === "equity_allocation_max" && a.status !== "resolved").length).toBeLessThanOrEqual(eq);
    expect(alerts.some((a: any) => a.ruleKey === "equity_allocation_max" && a.status === "resolved") || eq === 0).toBe(true);
    await call("PUT", `${P}/rules/equity_allocation_max`, { value: 60 });
  });
  it("a newly created client has its alert history seeded at creation", async () => {
    const id = (await call("POST", "/api/clients", { name: "Fresh Client" })).data.id;
    const n = (db.prepare("SELECT COUNT(*) AS n FROM rules WHERE client_id = ? AND last_evaluated_at IS NOT NULL").get(id) as any).n;
    expect(n).toBeGreaterThan(0);
  });
  it("a date-driven change is picked up by the job, not by a read", async () => {
    process.env.APP_AS_OF = "2027-09-01";
    try {
      const snap = dump();
      await new Promise((r) => setTimeout(r, 5));
      const s = (await call("GET", `${P}/state`)).data;
      expect(s.asOf).toBe("2027-09-01"); // figures use the new date...
      expect(dump()).toBe(snap); // ...but nothing was written
      reconcileAll(db);
      expect(dump()).not.toBe(snap); // the job writes (last_seen_at / rule evaluation time move)
    } finally { delete process.env.APP_AS_OF; reconcileAll(db); }
  });
  it("the reconciler can be switched off and does not keep the process alive", () => {
    expect(startReconciler(db, 0)).toBeNull();
    const t = startReconciler(db, 3600);
    expect(t).not.toBeNull(); expect(t!.hasRef()).toBe(false); clearInterval(t!);
  });
});
