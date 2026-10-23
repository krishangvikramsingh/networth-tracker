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
import { dispatchNotifications, renderDigest, type MailMessage, type Mailer } from "../src/server/notify";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string, cookie = "";
const tmp = path.join(os.tmpdir(), `nw-escalation-${process.pid}.db`);
const P = "/api/clients/client_priya";
async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, data: (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as any) : await r.text() };
}
const recorder = () => { const sent: MailMessage[] = []; const m: Mailer = { mode: "smtp", async send(x) { sent.push(x); } }; return { m, sent }; };
/** Definite breaches only: a "possible" finding is capped at Warning by design, so a higher rule severity does not raise it. */
const pendingFor = (rule: string) => db.prepare("SELECT n.status, n.severity, n.reason FROM notifications n JOIN alerts a ON a.id = n.alert_id WHERE a.rule_key = ? AND a.kind = 'breach' AND a.status != 'resolved'").all(rule) as Array<{ status: string; severity: string; reason: string }>;

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  await call("POST", "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
  await call("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "info" });
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("escalation emails", () => {
  it("a rise in severity re-queues the alert, even for people who already received the milder one", async () => {
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "warning" });
    const r1 = recorder(); await dispatchNotifications(db, r1.m);
    expect(r1.sent.length).toBeGreaterThan(0);
    const settled = pendingFor("portfolio_drift_max"); expect(settled.length).toBeGreaterThan(0); expect(settled.every((n) => n.status === "sent")).toBe(true);

    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "critical" });
    const after = pendingFor("portfolio_drift_max");
    expect(after.every((n) => n.status === "pending" && n.severity === "critical" && n.reason === "escalated")).toBe(true);
    const r2 = recorder(); await dispatchNotifications(db, r2.m);
    const drift = r2.sent.find((m) => /Escalated to Critical: Allocation drift/.test(m.text));
    expect(drift, r2.sent.map((m) => m.subject).join(" | ")).toBeTruthy();
    expect(drift!.subject).toMatch(/^\[Critical\] \d+ escalated alerts - /);
    expect(pendingFor("portfolio_drift_max").every((n) => n.status === "sent")).toBe(true);
  });
  it("saving the same severity again, or lowering it, sends nothing", async () => {
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "critical" });
    const r = recorder(); await dispatchNotifications(db, r.m);
    expect(r.sent.some((m) => /Allocation drift/.test(m.text))).toBe(false);
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "warning" });
    expect(pendingFor("portfolio_drift_max").every((n) => n.status === "sent")).toBe(true);
    const r2 = recorder(); await dispatchNotifications(db, r2.m);
    expect(r2.sent.some((m) => /Allocation drift/.test(m.text))).toBe(false);
  });
  it("only people whose minimum severity now qualifies get the escalation", async () => {
    await call("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "critical" });
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "info" });
    const settle = recorder(); await dispatchNotifications(db, settle.m);
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "high" }); // info -> high: still below "critical"
    const r = recorder(); await dispatchNotifications(db, r.m);
    expect(r.sent.some((m) => /Allocation drift/.test(m.text))).toBe(false);
    await call("PUT", `${P}/rules/portfolio_drift_max`, { severity: "critical" }); // high -> critical: now eligible
    const r2 = recorder(); await dispatchNotifications(db, r2.m);
    expect(r2.sent.some((m) => /Escalated to Critical: Allocation drift/.test(m.text))).toBe(true);
  });
  it("wording: a single escalation, a mixed digest and an all-new digest read correctly", () => {
    const item = { severity: "high" as const, ruleName: "Rule A", subject: "X", why: "", action: "", currentLabel: "", thresholdLabel: "" };
    expect(renderDigest("C", [{ ...item, escalated: true }], "http://x", false).subject).toBe("[High] Escalated: Rule A - C");
    expect(renderDigest("C", [{ ...item, escalated: true }, item], "http://x", false).subject).toBe("[High] 2 new or escalated alerts - C");
    expect(renderDigest("C", [item, item], "http://x", false).subject).toBe("[High] 2 new alerts - C");
    expect(renderDigest("C", [item], "http://x", false).text).toContain("New alerts for C");
  });
});
