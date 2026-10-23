import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, tx, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { loginThrottle, loginSucceeded, resetThrottle } from "../src/server/auth";

process.env.LOG_LEVEL = "silent";

describe("transactions use savepoints and per-connection depth", () => {
  const mem = () => { const d = openDb(":memory:"); d.exec("CREATE TABLE t (n INTEGER)"); return d; };
  const count = (d: DB) => (d.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
  it("commits the outer transaction with its nested work", () => {
    const d = mem();
    tx(d, () => { d.exec("INSERT INTO t VALUES (1)"); tx(d, () => d.exec("INSERT INTO t VALUES (2)")); });
    expect(count(d)).toBe(2);
  });
  it("rolls back everything when the outer work fails", () => {
    const d = mem();
    expect(() => tx(d, () => { d.exec("INSERT INTO t VALUES (1)"); tx(d, () => d.exec("INSERT INTO t VALUES (2)")); throw new Error("boom"); })).toThrow("boom");
    expect(count(d)).toBe(0);
  });
  it("an inner failure the caller catches undoes only the inner work", () => {
    const d = mem();
    tx(d, () => {
      d.exec("INSERT INTO t VALUES (1)");
      try { tx(d, () => { d.exec("INSERT INTO t VALUES (2)"); throw new Error("inner"); }); } catch { /* handled */ }
      d.exec("INSERT INTO t VALUES (3)");
    });
    expect(d.prepare("SELECT n FROM t ORDER BY n").all().map((r: any) => r.n)).toEqual([1, 3]);
  });
  it("keeps three levels straight and returns the callback's value", () => {
    const d = mem();
    const v = tx(d, () => tx(d, () => tx(d, () => { d.exec("INSERT INTO t VALUES (9)"); return 42; })));
    expect(v).toBe(42); expect(count(d)).toBe(1);
  });
  it("tracks depth per connection, so one connection's failure cannot affect another", () => {
    const a = mem(), b = mem();
    tx(a, () => { a.exec("INSERT INTO t VALUES (1)"); expect(() => tx(b, () => { b.exec("INSERT INTO t VALUES (1)"); throw new Error("b fails"); })).toThrow("b fails"); });
    expect(count(a)).toBe(1); expect(count(b)).toBe(0);
    tx(b, () => b.exec("INSERT INTO t VALUES (5)")); // b is usable afterwards (depth reset)
    expect(count(b)).toBe(1);
  });
  it("is usable again after a failed transaction", () => {
    const d = mem();
    expect(() => tx(d, () => { throw new Error("x"); })).toThrow();
    tx(d, () => d.exec("INSERT INTO t VALUES (1)")); expect(count(d)).toBe(1);
  });
  it("refuses an async callback instead of silently committing early", () => {
    const d = mem();
    expect(() => tx(d, (async () => { d.exec("INSERT INTO t VALUES (1)"); }) as any)).toThrow(/synchronous/);
    expect(count(d)).toBe(0);
  });
});

describe("login throttle lives in the database", () => {
  it("allows 8 attempts per window, refuses the 9th, and the window expires", () => {
    const d = openDb(":memory:"), t0 = 1_000_000;
    for (let i = 1; i <= 8; i++) expect(loginThrottle(d, "ip:a", t0 + i), `attempt ${i}`).toBe(true);
    expect(loginThrottle(d, "ip:a", t0 + 9)).toBe(false);
    expect(loginThrottle(d, "ip:b", t0 + 9)).toBe(true); // other keys are independent
    expect(loginThrottle(d, "ip:a", t0 + 14 * 60_000)).toBe(false); // still inside 15 minutes
    expect(loginThrottle(d, "ip:a", t0 + 16 * 60_000)).toBe(true); // window passed: counter restarts
  });
  it("a successful login clears the counter", () => {
    const d = openDb(":memory:");
    for (let i = 0; i < 7; i++) loginThrottle(d, "k");
    loginSucceeded(d, "k");
    for (let i = 0; i < 8; i++) expect(loginThrottle(d, "k")).toBe(true);
  });
  it("expired rows are cleaned up so the table cannot grow without bound", () => {
    const d = openDb(":memory:");
    loginThrottle(d, "old", 1000); loginThrottle(d, "new", 1000 + 20 * 60_000);
    expect((d.prepare("SELECT key FROM login_attempts").all() as any[]).map((r) => r.key)).toEqual(["new"]);
  });
  it("resetThrottle empties the table", () => { const d = openDb(":memory:"); loginThrottle(d, "k"); resetThrottle(d); expect((d.prepare("SELECT COUNT(*) AS n FROM login_attempts").get() as any).n).toBe(0); });
});

describe("restart survival (a second app instance on the same database)", () => {
  let db: DB, s1: Server, s2: Server;
  const tmp = path.join(os.tmpdir(), `nw-runtime-${process.pid}.db`);
  const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const post = (s: Server, p: string, body: unknown, cookie = "", headers: Record<string, string> = {}) =>
    fetch(url(s) + p, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth", ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
  beforeAll(() => {
    for (const x of ["", "-wal", "-shm"]) fs.rmSync(tmp + x, { force: true });
    db = openDb(tmp); seedIfEmpty(db);
    s1 = createApp(db).listen(0); s2 = createApp(db).listen(0); // two "instances" sharing one database
  });
  afterAll(() => { s1.close(); s2.close(); db.close(); for (const x of ["", "-wal", "-shm"]) fs.rmSync(tmp + x, { force: true }); });

  it("lockout from repeated bad logins is enforced by a different instance", async () => {
    resetThrottle(db);
    for (let i = 0; i < 8; i++) expect((await post(s1, "/api/auth/login", { email: "advisor@demo.local", password: "wrong" })).status).toBe(401);
    expect((await post(s2, "/api/auth/login", { email: "advisor@demo.local", password: "wrong" })).status).toBe(429);
    expect((await post(s2, "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" })).status).toBe(429);
    resetThrottle(db);
    expect((await post(s2, "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" })).status).toBe(200);
  });

  it("a retried create with the same Idempotency-Key replays the first answer from another instance, creating one record", async () => {
    const login = await post(s1, "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const goal = { name: "Idem goal", type: "wealth", targetAmount: 100000000, targetDate: "2030-01-01", earmarkedAmount: 0, monthlyContribution: 0 };
    const key = { "Idempotency-Key": "k-123" };
    const first = await post(s1, "/api/clients/client_priya/goals", goal, cookie, key);
    const second = await post(s2, "/api/clients/client_priya/goals", goal, cookie, key);
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true"); expect(first.headers.get("idempotent-replay")).toBeNull();
    expect((await second.json() as any).item.id).toBe((await first.json() as any).item.id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM goals WHERE name = 'Idem goal'").get() as any).n).toBe(1);
    const other = await post(s1, "/api/clients/client_priya/goals", goal, cookie, { "Idempotency-Key": "k-456" });
    expect(other.headers.get("idempotent-replay")).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM goals WHERE name = 'Idem goal'").get() as any).n).toBe(2);
  });

  it("a failed create stores no key, so the user can correct it and retry with the same key", async () => {
    const login = await post(s1, "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const key = { "Idempotency-Key": "k-bad" };
    expect((await post(s1, "/api/clients/client_priya/goals", { name: "" }, cookie, key)).status).toBe(422);
    const ok = await post(s1, "/api/clients/client_priya/goals", { name: "Fixed goal", type: "wealth", targetAmount: 100, targetDate: "2030-01-01", earmarkedAmount: 0, monthlyContribution: 0 }, cookie, key);
    expect(ok.status).toBe(201); expect(ok.headers.get("idempotent-replay")).toBeNull();
  });

  it("expired keys are purged, and a key is scoped to its user and path", async () => {
    db.prepare("INSERT INTO idempotency_keys (key, status, body, created_at) VALUES ('stale', 201, '{}', ?)").run(Date.now() - 11 * 60_000);
    const login = await post(s1, "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    await post(s1, "/api/clients/client_priya/goals", { name: "Purge probe", type: "wealth", targetAmount: 100, targetDate: "2030-01-01", earmarkedAmount: 0, monthlyContribution: 0 }, cookie, { "Idempotency-Key": "k-purge" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE key = 'stale'").get() as any).n).toBe(0);
    const keys = (db.prepare("SELECT key FROM idempotency_keys").all() as any[]).map((r) => r.key as string);
    expect(keys.every((k) => k.includes(":POST:/"))).toBe(true); // user:method:path:key
  });
});
