import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, nowISO, uid, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { createUser, resetThrottle } from "../src/server/auth";
import { dispatchNotifications, type MailMessage, type Mailer } from "../src/server/notify";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string, routes: Array<{ method: string; path: string }> = [];
const tmp = path.join(os.tmpdir(), `nw-tenancy-${process.pid}.db`);
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|BEGIN|SAVEPOINT)/i;

class Session {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, data: ct.includes("json") ? ((await r.json()) as any) : await r.text() };
  }
  login(email: string, password: string) { return this.req("POST", "/api/auth/login", { email, password }); }
}
const A = new Session(), B = new Session(), Bv = new Session(); // A = default tenant admin (operator); B / Bv = "acme" admin / viewer
let bClient = "";
const aClient = "client_priya";
const fill = (p: string, cid: string) => p.replace(":cid", cid).replace(":id", "probe_id").replace(":entity", "holdings").replace(":what", "holdings.csv").replace(":kind", "holdings").replace(":key", "equity_allocation_max");
async function writesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []; const d = db as any, prep = d.prepare.bind(db), exec = d.exec.bind(db);
  d.prepare = (sql: string) => { if (WRITE.test(sql)) seen.push(sql.trim().slice(0, 70)); return prep(sql); };
  d.exec = (sql: string) => { if (WRITE.test(sql)) seen.push(sql.trim().slice(0, 70)); return exec(sql); };
  try { await fn(); } finally { delete d.prepare; delete d.exec; }
  return seen;
}

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  createUser(db, "b-admin@acme.test", "Acme Admin", "admin", "Acme-Admin-2026!", "acme");
  createUser(db, "b-viewer@acme.test", "Acme Viewer", "viewer", "Acme-Viewer-2026!", "acme");
  const app = createApp(db);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stack = ((app as any).router ?? (app as any)._router).stack as any[];
  routes = stack.filter((l) => l.route && typeof l.route.path === "string" && l.route.path.includes(":cid")).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path as string })));
  resetThrottle(db);
  expect((await A.login("advisor@demo.local", "Demo@2026-Advisor")).status).toBe(200);
  expect((await B.login("b-admin@acme.test", "Acme-Admin-2026!")).status).toBe(200);
  expect((await Bv.login("b-viewer@acme.test", "Acme-Viewer-2026!")).status).toBe(200);
  bClient = (await B.req("POST", "/api/clients", { name: "Acme Client" })).data.id;
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("tenant isolation: every client-scoped route", () => {
  it("finds the routes to test (so the sweep cannot silently be empty)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(new Set(routes.map((r) => r.method))).toEqual(new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]));
    expect(routes.some((r) => r.path.endsWith("/state"))).toBe(true); expect(routes.some((r) => r.path.endsWith("/nominations"))).toBe(true);
  });
  it("another tenant gets 'Client not found' on every method and route, and nothing is written", async () => {
    const failures: string[] = [];
    const writes = await writesDuring(async () => {
      for (const r of routes) for (const who of [B, Bv]) {
        const res = await who.req(r.method, fill(r.path, aClient), ["GET", "DELETE"].includes(r.method) ? undefined : {});
        if (res.status !== 404 || res.data?.error !== "Client not found.") failures.push(`${r.method} ${r.path} -> ${res.status} ${JSON.stringify(res.data).slice(0, 60)}`);
      }
    });
    expect(failures).toEqual([]); expect(writes).toEqual([]);
  });
  it("the operator tenant has no special access to another tenant's clients either", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      const res = await A.req(r.method, fill(r.path, bClient), ["GET", "DELETE"].includes(r.method) ? undefined : {});
      if (res.status !== 404 || res.data?.error !== "Client not found.") failures.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
  it("control: the owner reaches the same routes (the guard blocks only other tenants)", async () => {
    let reachable = 0;
    for (const r of routes) {
      const res = await A.req(r.method, fill(r.path, aClient), ["GET", "DELETE"].includes(r.method) ? undefined : {});
      if (!(res.status === 404 && res.data?.error === "Client not found.")) reachable++;
    }
    expect(reachable).toBe(routes.length);
  });
  it("an other-tenant client and a nonexistent one are indistinguishable (ids cannot be probed)", async () => {
    for (const r of routes.filter((x) => ["GET", "POST", "DELETE"].includes(x.method)).slice(0, 25)) {
      const body = r.method === "GET" || r.method === "DELETE" ? undefined : {};
      const other = await B.req(r.method, fill(r.path, aClient), body), none = await B.req(r.method, fill(r.path, "client_does_not_exist"), body);
      expect(other, `${r.method} ${r.path}`).toEqual(none);
    }
  });
  it("an unauthenticated caller still gets 401, not a tenant error", async () => {
    expect((await new Session().req("GET", `/api/clients/${aClient}/state`)).status).toBe(401);
  });
});

describe("tenant isolation: lists, creation and cross-links", () => {
  it("each tenant sees only its own clients, and a new tenant starts without the demo data", async () => {
    const a = (await A.req("GET", "/api/clients")).data.clients.map((c: any) => c.id), b = (await B.req("GET", "/api/clients")).data.clients.map((c: any) => c.id);
    expect(a).toContain(aClient); expect(a).not.toContain(bClient);
    expect(b).toEqual([bClient]);
    expect((await Bv.req("GET", "/api/clients")).data.clients.map((c: any) => c.id)).toEqual([bClient]); // same tenant, so the viewer sees the same client
  });
  it("clients are created in the caller's tenant", () => {
    expect((db.prepare("SELECT tenant_id FROM clients WHERE id = ?").get(bClient) as any).tenant_id).toBe("acme");
    expect((db.prepare("SELECT tenant_id FROM clients WHERE id = ?").get(aClient) as any).tenant_id).toBe("default");
  });
  it("the tenant's own client works end to end, and the viewer stays read-only inside it", async () => {
    expect((await B.req("GET", `/api/clients/${bClient}/state`)).status).toBe(200);
    expect((await B.req("POST", `/api/clients/${bClient}/goals`, { name: "G", type: "wealth", targetAmount: 100, targetDate: "2030-01-01", earmarkedAmount: 0, monthlyContribution: 0 })).status).toBe(201);
    expect((await Bv.req("GET", `/api/clients/${bClient}/state`)).status).toBe(200);
    expect((await Bv.req("POST", `/api/clients/${bClient}/goals`, {})).status).toBe(403);
  });
  it("cannot attach another tenant's holding or nominee to your own client", async () => {
    const aHolding = (await A.req("GET", `/api/clients/${aClient}/estate`)).data.coverage.rows[0].entityId;
    const aNominee = (await A.req("POST", `/api/clients/${aClient}/nominees`, { name: "A Person", relationship: "Spouse" })).data.nominee.id;
    const bNominee = (await B.req("POST", `/api/clients/${bClient}/nominees`, { name: "B Person", relationship: "Spouse" })).data.nominee.id;
    expect((await B.req("PUT", `/api/clients/${bClient}/nominations`, { entity: "holding", entityId: aHolding, shares: [{ nomineeId: bNominee, shareBps: 10000 }] })).status).toBe(404);
    const bHolding = (await B.req("POST", `/api/clients/${bClient}/holdings`, { name: "B Cash", instrumentType: "bank_balance", currentValue: 100000 })).data.item.id;
    expect((await B.req("PUT", `/api/clients/${bClient}/nominations`, { entity: "holding", entityId: bHolding, shares: [{ nomineeId: aNominee, shareBps: 10000 }] })).status).toBe(404);
    expect((await B.req("PUT", `/api/clients/${bClient}/nominations`, { entity: "holding", entityId: bHolding, shares: [{ nomineeId: bNominee, shareBps: 10000 }] })).status).toBe(200);
    expect((await A.req("GET", `/api/clients/${aClient}/estate`)).data.nominees.map((n: any) => n.name)).not.toContain("B Person");
  });
  it("a record id from another tenant cannot be edited through your own client", async () => {
    const aHolding = (await A.req("GET", `/api/clients/${aClient}/estate`)).data.coverage.rows[0].entityId;
    for (const [m, body] of [["PATCH", { name: "hijack" }], ["DELETE", undefined]] as const) expect((await B.req(m, `/api/clients/${bClient}/holdings/${aHolding}`, body)).status).toBe(404);
    expect((await A.req("GET", `/api/clients/${aClient}/state`)).data.data.holdings.some((h: any) => h.name === "hijack")).toBe(false);
  });
  it("email is globally unique, and tenant ids are validated", () => {
    expect(() => createUser(db, "b-admin@acme.test", "Dup", "admin", "x", "other")).toThrow(/UNIQUE/i);
    expect(() => createUser(db, "z@z.test", "Z", "admin", "x", "Bad Tenant!")).toThrow(/Tenant id/);
    expect(() => createUser(db, "z2@z.test", "Z", "admin", "x", "../x")).toThrow(/Tenant id/);
  });
});

describe("tenant isolation: shared services", () => {
  const addAlert = (clientId: string, subject: string) => {
    const id = uid("alt"), now = nowISO();
    db.prepare(`INSERT INTO alerts (id, client_id, rule_key, fingerprint, kind, status, severity, subject, current_label, threshold_label, why, action, records, first_detected_at, last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, clientId, "equity_allocation_max", `fp-${id}`, "breach", "open", "critical", subject, "x", "y", "w", "a", "[]", now, now);
    db.prepare("INSERT INTO notifications (id, alert_id, client_id, severity, created_at) VALUES (?,?,?,?,?)").run(uid("nt"), id, clientId, "critical", now);
  };
  const recorder = () => { const sent: MailMessage[] = []; const m: Mailer = { mode: "smtp", async send(x) { sent.push(x); } }; return { m, sent }; };

  it("email alerts reach only recipients in the same tenant as the client", async () => {
    db.exec("UPDATE notifications SET status='skipped'; DELETE FROM notification_prefs");
    await A.req("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "info" });
    await B.req("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "info" });
    addAlert(aClient, "A-SECRET-SUBJECT"); addAlert(bClient, "B-SECRET-SUBJECT");
    const r = recorder(); await dispatchNotifications(db, r.m);
    const to = (e: string) => r.sent.filter((m) => m.to === e);
    expect(to("advisor@demo.local").length).toBe(1); expect(to("b-admin@acme.test").length).toBe(1);
    expect(to("advisor@demo.local")[0].text).toContain("A-SECRET-SUBJECT"); expect(to("advisor@demo.local")[0].text).not.toContain("B-SECRET-SUBJECT");
    expect(to("b-admin@acme.test")[0].text).toContain("B-SECRET-SUBJECT"); expect(to("b-admin@acme.test")[0].text).not.toContain("A-SECRET-SUBJECT");
  });
  it("a tenant with no opted-in recipients sends nothing, even when other tenants have some", async () => {
    db.exec("UPDATE notifications SET status='skipped'; DELETE FROM notification_prefs");
    await A.req("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "info" });
    addAlert(bClient, "B-ONLY");
    const r = recorder(); const out = await dispatchNotifications(db, r.m);
    expect(r.sent).toEqual([]); expect(out.skipped).toBeGreaterThan(0);
  });
  it("the notification log shows only your tenant's alerts", async () => {
    addAlert(aClient, "LOGPROBE-A"); addAlert(bClient, "LOGPROBE-B");
    const names = (s: Session) => s.req("GET", "/api/notifications").then((r) => r.data.log.map((l: any) => `${l.clientName}|${l.subject}`));
    const a = await names(A), b = await names(B);
    expect(a.some((x: string) => x.includes("LOGPROBE-A"))).toBe(true); expect(a.some((x: string) => x.includes("LOGPROBE-B"))).toBe(false);
    expect(b.some((x: string) => x.includes("LOGPROBE-B"))).toBe(true); expect(b.some((x: string) => x.includes("LOGPROBE-A") || x.includes("Priya"))).toBe(false);
  });
  it("preferences and the outbox are per user, never shared across tenants", async () => {
    await B.req("PUT", "/api/notifications/prefs", { emailEnabled: false, minSeverity: "critical" });
    expect((await A.req("GET", "/api/notifications")).data.prefs).toEqual({ emailEnabled: true, minSeverity: "info" });
    expect((await B.req("GET", "/api/notifications")).data.email).toBe("b-admin@acme.test");
  });
  it("demo reset and shared market data are operator-only", async () => {
    const reset = await B.req("POST", "/api/demo/reset", {}); expect(reset.status).toBe(403);
    expect((await B.req("POST", "/api/market/refresh", { provider: "demo" })).status).toBe(403);
    expect((await B.req("POST", "/api/market/manual", {})).status).toBe(403);
    expect((await A.req("POST", "/api/demo/reset", { clientId: aClient })).status).toBe(200);
    expect((await A.req("POST", "/api/market/refresh", { provider: "demo", symbols: [] })).status).toBe(200);
    expect((await Bv.req("POST", "/api/demo/reset", {})).status).toBe(403);
  });
  it("another tenant's demo reset attempt left the data untouched", async () => {
    expect((await A.req("GET", `/api/clients/${aClient}/state`)).status).toBe(200);
    expect((await B.req("GET", "/api/clients")).data.clients.map((c: any) => c.id)).toEqual([bClient]);
  });
});
