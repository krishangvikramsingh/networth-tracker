import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, nowISO, uid, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { resetThrottle } from "../src/server/auth";
import { MAX_ATTEMPTS, dispatchNotifications, mailerFromEnv, outboxMailer, renderDigest, smtpMailer, type MailMessage, type Mailer } from "../src/server/notify";
import { MODEL_PORTFOLIOS, RISK_QUESTIONS } from "../src/shared/riskprofile";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
const tmp = path.join(os.tmpdir(), `nw-features-${process.pid}.db`);

class Session {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return { status: r.status, data: (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as any) : await r.text() };
  }
  login(email: string, password: string) { return this.req("POST", "/api/auth/login", { email, password }); }
}
const admin = new Session(), viewer = new Session();
const P = "/api/clients/client_priya";
const answers = (opt: number, over: Record<string, number> = {}) => ({ ...Object.fromEntries(RISK_QUESTIONS.map((q) => [q.id, opt])), ...over });

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp);
  seedIfEmpty(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  expect((await admin.login("advisor@demo.local", "Demo@2026-Advisor")).status).toBe(200);
  expect((await viewer.login("viewer@demo.local", "Demo@2026-Viewer")).status).toBe(200);
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("risk profile API", () => {
  it("starts empty, and a read-only viewer cannot record or apply", async () => {
    expect((await admin.req("GET", `${P}/risk-profile`)).data.assessments).toEqual([]);
    expect((await viewer.req("POST", `${P}/risk-profile`, { answers: answers(2) })).status).toBe(403);
    expect((await viewer.req("POST", `${P}/risk-profile/apply`)).status).toBe(403);
    expect((await viewer.req("GET", `${P}/risk-profile`)).status).toBe(200);
  });
  it("rejects incomplete, unknown and out-of-range answers", async () => {
    const part = await admin.req("POST", `${P}/risk-profile`, { answers: { t_drop: 2 } });
    expect(part.status).toBe(422); expect(part.data.error).toMatch(/Answer every question/); expect(part.data.details.length).toBe(RISK_QUESTIONS.length - 1);
    expect((await admin.req("POST", `${P}/risk-profile`, { answers: answers(2, { t_drop: 9 }) })).status).toBe(422);
    expect((await admin.req("POST", `${P}/risk-profile`, { answers: { ...answers(2), bogus: 1 } })).status).toBe(422);
    expect((await admin.req("POST", `${P}/risk-profile`, {})).status).toBe(422);
    expect((await admin.req("GET", `${P}/risk-profile`)).data.assessments.length).toBe(0);
  });
  it("scores on the server, stores the result and audits it", async () => {
    const r = await admin.req("POST", `${P}/risk-profile`, { answers: answers(3, { c_horizon: 0 }) });
    expect(r.status).toBe(201);
    expect(r.data.assessment).toMatchObject({ profile: "conservative", toleranceScore: 100, limitedBy: "guard_rail" });
    const list = (await admin.req("GET", `${P}/risk-profile`)).data.assessments;
    expect(list.length).toBe(1); expect(list[0].appliedAt).toBeNull();
    const state = (await admin.req("GET", `${P}/state`)).data;
    expect(state.audit.some((a: any) => a.entity === "risk_profile" && /Conservative/.test(a.summary))).toBe(true);
  });
  it("applying replaces the targets with the model portfolio but never marks the policy validated", async () => {
    await admin.req("POST", `${P}/risk-profile`, { answers: answers(3) });
    const r = await admin.req("POST", `${P}/risk-profile/apply`);
    expect(r.status).toBe(200); expect(r.data.profile).toBe("aggressive");
    const { data } = (await admin.req("GET", `${P}/state`)).data;
    const got = Object.fromEntries(data.targets.map((t: any) => [t.assetClass, t.targetBps]));
    expect(got).toEqual(MODEL_PORTFOLIOS.aggressive);
    expect(data.settings.investmentPolicyValidated).toBe(false);
    expect((await admin.req("GET", `${P}/risk-profile`)).data.assessments[0].appliedAt).not.toBeNull();
  });
  it("apply with no assessment is a conflict, and history stays per client", async () => {
    const id = (await admin.req("POST", "/api/clients", { name: "Blank Risk Client" })).data.id;
    expect((await admin.req("POST", `/api/clients/${id}/risk-profile/apply`)).status).toBe(409);
    expect((await admin.req("GET", `/api/clients/${id}/risk-profile`)).data.assessments).toEqual([]);
    expect((await admin.req("GET", "/api/clients/nope/risk-profile")).status).toBe(404);
  });
});

describe("nominee API", () => {
  let holdingId = "", n1 = "", n2 = "", otherClient = "";
  it("is empty at first, and measures Priya's real holdings as not recorded (not as zero nominees)", async () => {
    const r = (await admin.req("GET", `${P}/estate`)).data;
    expect(r.nominees).toEqual([]);
    expect(r.coverage.counts.complete).toBe(0); expect(r.coverage.counts.not_recorded).toBe(r.coverage.rows.length);
    holdingId = r.coverage.rows.find((x: any) => x.entity === "holding").entityId;
    expect(r.coverage.coveredPct).toBe(0);
  });
  it("validates and creates nominees; viewers are read-only", async () => {
    expect((await admin.req("POST", `${P}/nominees`, { name: "", relationship: "Spouse" })).status).toBe(422);
    expect((await admin.req("POST", `${P}/nominees`, { name: "Asha", relationship: "" })).status).toBe(422);
    expect((await viewer.req("POST", `${P}/nominees`, { name: "X", relationship: "Y" })).status).toBe(403);
    n1 = (await admin.req("POST", `${P}/nominees`, { name: "Test Nominee One", relationship: "Spouse", contact: "n/a" })).data.nominee.id;
    n2 = (await admin.req("POST", `${P}/nominees`, { name: "Test Nominee Two", relationship: "Son" })).data.nominee.id;
    expect((await admin.req("PATCH", `${P}/nominees/${n2}`, { relationship: "Child" })).data.nominee.relationship).toBe("Child");
    expect((await admin.req("PATCH", `${P}/nominees/missing`, { name: "Z" })).status).toBe(404);
  });
  it("records shares: partial at 80%, complete at 100%, refuses over 100% and duplicates", async () => {
    let r = await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 6000 }, { nomineeId: n2, shareBps: 2000 }] });
    expect(r.status).toBe(200);
    expect(r.data.coverage.rows.find((x: any) => x.entityId === holdingId)).toMatchObject({ status: "partial", totalBps: 8000 });
    r = await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 6000 }, { nomineeId: n2, shareBps: 4000 }] });
    expect(r.data.coverage.rows.find((x: any) => x.entityId === holdingId).status).toBe("complete");
    expect(r.data.coverage.coveredPct).toBeGreaterThan(0);
    const over = await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 7000 }, { nomineeId: n2, shareBps: 4000 }] });
    expect(over.status).toBe(422); expect(over.data.error).toMatch(/more than 100%/);
    expect((await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 5000 }, { nomineeId: n1, shareBps: 5000 }] })).status).toBe(422);
    expect((await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 0 }] })).status).toBe(422);
    // a failed update leaves the previous record intact
    expect((await admin.req("GET", `${P}/estate`)).data.coverage.rows.find((x: any) => x.entityId === holdingId).status).toBe("complete");
    expect((await viewer.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [] })).status).toBe(403);
  });
  it("refuses unknown assets and a nominee that belongs to another client", async () => {
    otherClient = (await admin.req("POST", "/api/clients", { name: "Other Estate Client" })).data.id;
    expect((await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: "h_missing", shares: [] })).status).toBe(404);
    const foreign = await admin.req("POST", `/api/clients/${otherClient}/nominees`, { name: "Foreign", relationship: "Friend" });
    const r = await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: foreign.data.nominee.id, shareBps: 10000 }] });
    expect(r.status).toBe(404);
    expect((await admin.req("GET", `${P}/estate`)).data.nominees.map((n: any) => n.name)).not.toContain("Foreign");
  });
  it("clearing returns the asset to not recorded; deleting a nominee removes their shares", async () => {
    await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [] });
    expect((await admin.req("GET", `${P}/estate`)).data.coverage.rows.find((x: any) => x.entityId === holdingId).status).toBe("not_recorded");
    await admin.req("PUT", `${P}/nominations`, { entity: "holding", entityId: holdingId, shares: [{ nomineeId: n1, shareBps: 10000 }] });
    expect((await admin.req("DELETE", `${P}/nominees/${n1}`)).status).toBe(200);
    const after = (await admin.req("GET", `${P}/estate`)).data;
    expect(after.nominations.length).toBe(0); expect(after.coverage.rows.find((x: any) => x.entityId === holdingId).status).toBe("not_recorded");
  });
});

// ---- notifications ------------------------------------------------------------------------------
const reset = () => { db.exec("DELETE FROM notification_deliveries; DELETE FROM mail_outbox; UPDATE notifications SET status='skipped', note='test reset'"); db.exec("DELETE FROM notification_prefs"); };
function addAlert(over: Partial<{ clientId: string; severity: string; status: string; subject: string }> = {}) {
  const id = uid("alt"), cid = over.clientId ?? "client_priya", sev = over.severity ?? "critical", now = nowISO();
  db.prepare(`INSERT INTO alerts (id, client_id, rule_key, fingerprint, kind, status, severity, subject, current_label, threshold_label, why, action, records, first_detected_at, last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, cid, "equity_allocation_max", `fp-${id}`, "breach", over.status ?? "open", sev, over.subject ?? "Equity", "SECRET-CURRENT 61%", "SECRET-LIMIT 50%", "SECRET-WHY detail", "SECRET-ACTION do x", "[]", now, now);
  const nid = uid("nt");
  db.prepare("INSERT INTO notifications (id, alert_id, client_id, severity, created_at) VALUES (?,?,?,?,?)").run(nid, id, cid, sev, now);
  return { alertId: id, nid };
}
const optIn = async (s: Session, minSeverity: string, emailEnabled = true) => s.req("PUT", "/api/notifications/prefs", { emailEnabled, minSeverity });
const recorder = (fail: (m: MailMessage, n: number) => boolean = () => false) => { const sent: MailMessage[] = []; let calls = 0; const m: Mailer = { mode: "smtp", async send(x) { calls++; if (fail(x, calls)) throw new Error("smtp down"); sent.push(x); } }; return { m, sent, calls: () => calls }; };
const statusOf = (nid: string) => (db.prepare("SELECT status, note FROM notifications WHERE id = ?").get(nid) as any);

describe("email notifications", () => {
  it("queues exactly one pending notification per alert that the engine raises", () => {
    const alerts = (db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as any).n;
    const queued = (db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as any).n;
    expect(alerts).toBeGreaterThan(0); expect(queued).toBe(alerts);
    expect((db.prepare("SELECT COUNT(*) AS n FROM alerts a WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.alert_id = a.id)").get() as any).n).toBe(0);
  });
  it("re-reading state does not queue more (reads add no notifications)", async () => {
    const before = (db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as any).n;
    await admin.req("GET", `${P}/state`); await admin.req("GET", `${P}/state`);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as any).n).toBe(before);
  });
  it("preferences: default off, validated, per user, and a viewer can set their own", async () => {
    reset();
    expect((await viewer.req("GET", "/api/notifications")).data).toMatchObject({ prefs: { emailEnabled: false, minSeverity: "high" }, mode: "outbox", email: "viewer@demo.local" });
    expect((await viewer.req("PUT", "/api/notifications/prefs", { emailEnabled: "yes", minSeverity: "high" })).status).toBe(422);
    expect((await viewer.req("PUT", "/api/notifications/prefs", { emailEnabled: true, minSeverity: "loud" })).status).toBe(422);
    expect((await optIn(viewer, "warning")).data.prefs).toEqual({ emailEnabled: true, minSeverity: "warning" });
    expect((await admin.req("GET", "/api/notifications")).data.prefs.emailEnabled).toBe(false);
    expect((await new Session().req("GET", "/api/notifications")).status).toBe(401);
  });
  it("with nobody opted in, nothing is sent and every pending item is skipped", async () => {
    reset(); const a = addAlert(); const r = recorder();
    const out = await dispatchNotifications(db, r.m);
    expect(r.calls()).toBe(0); expect(out).toMatchObject({ processed: 1, skipped: 1, sent: 0, emails: 0 });
    expect(statusOf(a.nid).status).toBe("skipped");
  });
  it("sends one digest per recipient and client, respects each person's minimum severity, and never repeats", async () => {
    reset(); await optIn(admin, "high"); await optIn(viewer, "critical");
    const crit = addAlert({ severity: "critical", subject: "Equity" }), high = addAlert({ severity: "high", subject: "Debt" }), low = addAlert({ severity: "warning", subject: "Cash" });
    const r = recorder();
    const out = await dispatchNotifications(db, r.m, { baseUrl: "http://app.test/" });
    const to = (e: string) => r.sent.filter((m) => m.to === e);
    expect(to("advisor@demo.local").length).toBe(1); expect(to("viewer@demo.local").length).toBe(1);
    expect(to("advisor@demo.local")[0].text).toContain("Equity"); expect(to("advisor@demo.local")[0].text).toContain("Debt"); expect(to("advisor@demo.local")[0].text).not.toContain("Cash");
    expect(to("viewer@demo.local")[0].text).toContain("Equity"); expect(to("viewer@demo.local")[0].text).not.toContain("Debt");
    expect(to("advisor@demo.local")[0].subject).toBe("[Critical] 2 new alerts - Priya Ramanathan");
    expect(to("advisor@demo.local")[0].text).toContain("http://app.test/alerts");
    expect(out).toMatchObject({ emails: 2, sent: 2, skipped: 1 });
    expect(statusOf(crit.nid).status).toBe("sent"); expect(statusOf(high.nid).status).toBe("sent"); expect(statusOf(low.nid).status).toBe("skipped");
    const again = await dispatchNotifications(db, r.m);
    expect(again.processed).toBe(0); expect(r.sent.length).toBe(2);
  });
  it("sends separate digests for separate clients", async () => {
    reset(); await optIn(admin, "info");
    addAlert({ clientId: "client_priya" }); addAlert({ clientId: "client_priya" });
    const other = (db.prepare("SELECT id FROM clients WHERE id != 'client_priya' LIMIT 1").get() as any).id; addAlert({ clientId: other });
    const r = recorder(); await dispatchNotifications(db, r.m);
    expect(r.sent.length).toBe(2); expect(r.sent.map((m) => m.subject).sort()).toEqual([expect.stringMatching(/\[Critical\] 2 new alerts - Priya/), expect.stringMatching(/\[Critical\] Equity allocation exceeds limit - /)].sort());
  });
  it("skips alerts that were resolved or acknowledged before the email went out", async () => {
    reset(); await optIn(admin, "info");
    const a = addAlert({ status: "resolved" }), b = addAlert({ status: "acknowledged" });
    const r = recorder(); const out = await dispatchNotifications(db, r.m);
    expect(r.calls()).toBe(0); expect(out.skipped).toBe(2);
    expect(statusOf(a.nid).note).toMatch(/cleared/); expect(statusOf(b.nid).note).toMatch(/acknowledged/);
  });
  it("retries a failed send on the next run, without re-sending to people who already got it", async () => {
    reset(); await optIn(admin, "info"); await optIn(viewer, "info");
    const a = addAlert();
    const r = recorder((m, n) => m.to === "viewer@demo.local" && n <= 2); // viewer's first attempt fails
    const first = await dispatchNotifications(db, r.m);
    expect(first.emails).toBe(1); expect(statusOf(a.nid).status).toBe("pending");
    const second = await dispatchNotifications(db, r.m);
    expect(second).toMatchObject({ emails: 1, sent: 1 });
    expect(r.sent.filter((m) => m.to === "advisor@demo.local").length).toBe(1);
    expect(r.sent.filter((m) => m.to === "viewer@demo.local").length).toBe(1);
    expect(statusOf(a.nid).status).toBe("sent");
  });
  it(`gives up after ${MAX_ATTEMPTS} failed attempts and records the failure`, async () => {
    reset(); await optIn(admin, "info");
    const a = addAlert(); const r = recorder(() => true);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) { await dispatchNotifications(db, r.m); expect(statusOf(a.nid).status).toBe("pending"); }
    const last = await dispatchNotifications(db, r.m);
    expect(last.failed).toBe(1); expect(statusOf(a.nid).status).toBe("failed"); expect(r.calls()).toBe(MAX_ATTEMPTS);
    await dispatchNotifications(db, r.m); expect(r.calls()).toBe(MAX_ATTEMPTS);
    const d = db.prepare("SELECT status, attempts, error FROM notification_deliveries WHERE notification_id = ?").get(a.nid) as any;
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, error: "smtp down" });
  });
  it("keeps figures and advice out of the email by default, and includes them only when asked", async () => {
    reset(); await optIn(admin, "info");
    addAlert(); const r = recorder(); await dispatchNotifications(db, r.m, { details: false });
    expect(r.sent[0].text).not.toMatch(/SECRET/); expect(r.sent[0].html).not.toMatch(/SECRET/);
    reset(); await optIn(admin, "info");
    addAlert(); const r2 = recorder(); await dispatchNotifications(db, r2.m, { details: true });
    expect(r2.sent[0].text).toContain("SECRET-CURRENT 61%"); expect(r2.sent[0].text).toContain("SECRET-WHY detail");
  });
  it("escapes HTML in names that reach the email body", () => {
    const m = renderDigest("<b>Client</b>", [{ severity: "high", ruleName: "R", subject: "<script>x</script>", why: "", action: "", currentLabel: "", thresholdLabel: "" }], "http://x", false);
    expect(m.html).not.toContain("<script>"); expect(m.html).toContain("&lt;script&gt;"); expect(m.html).toContain("&lt;b&gt;Client&lt;/b&gt;");
  });
  it("without SMTP the message is kept in the outbox and shown to its owner only", async () => {
    reset(); await optIn(admin, "info");
    addAlert({ subject: "Outbox probe" }); const out = await dispatchNotifications(db, outboxMailer(db));
    expect(out.emails).toBe(1);
    const mine = (await admin.req("GET", "/api/notifications")).data;
    expect(mine.mode).toBe("outbox"); expect(mine.outbox.length).toBe(1); expect(mine.outbox[0].text).toContain("Outbox probe");
    expect((await viewer.req("GET", "/api/notifications")).data.outbox).toEqual([]);
    expect(mine.log[0]).toMatchObject({ status: "sent", delivered: 1 });
    expect((db.prepare("SELECT status FROM notification_deliveries").get() as any).status).toBe("outbox");
  });
  it("the dispatch endpoint is write-protected", async () => {
    expect((await viewer.req("POST", "/api/notifications/dispatch")).status).toBe(403);
    expect((await admin.req("POST", "/api/notifications/dispatch")).status).toBe(200);
  });
  it("smtpMailer hands the message to the transport; mailerFromEnv falls back to the outbox without SMTP_HOST", async () => {
    const calls: any[] = [];
    await smtpMailer({ async sendMail(o) { calls.push(o); } }, "Wealth <a@b.test>").send({ to: "x@y.test", subject: "S", text: "T", html: "<p>T</p>" });
    expect(calls).toEqual([{ from: "Wealth <a@b.test>", to: "x@y.test", subject: "S", text: "T", html: "<p>T</p>" }]);
    expect((await mailerFromEnv(db, {})).mode).toBe("outbox");
    expect((await mailerFromEnv(db, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "2525" })).mode).toBe("smtp");
  });
});
