import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { createUser, resetThrottle } from "../src/server/auth";
import { totpAt } from "../src/server/mfa";
import { open, seal, sealLegacySecrets } from "../src/server/secretbox";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
const tmp = path.join(os.tmpdir(), `nw-account-${process.pid}.db`);
const EMAIL = "acct.user@demo.local", PW = "Correct-Horse-9";
const step = () => Math.floor(Date.now() / 1000 / 30);

async function call(method: string, url: string, body?: unknown, cookie = "", headers: Record<string, string> = {}) {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, cookie: sc ? sc.split(";")[0] : "", data: ct.includes("json") ? ((await r.json()) as any) : await r.text() };
}
const login = (email = EMAIL, password = PW, headers: Record<string, string> = {}) => call("POST", "/api/auth/login", { email, password }, "", headers);
const outbox = () => db.prepare("SELECT to_email, subject, text_body FROM mail_outbox ORDER BY created_at, rowid").all() as Array<{ to_email: string; subject: string; text_body: string }>;

beforeAll(() => {
  for (const x of ["", "-wal", "-shm", ".key"]) fs.rmSync(tmp + x, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); db.close(); for (const x of ["", "-wal", "-shm", ".key"]) fs.rmSync(tmp + x, { force: true }); delete process.env.REQUIRE_MFA_FOR_ADMINS; });
beforeEach(() => {
  resetThrottle(db); delete process.env.REQUIRE_MFA_FOR_ADMINS; process.env.PUBLIC_URL = "https://wealth.example.com";
  db.exec("DELETE FROM users WHERE email LIKE '%@demo.local' AND email NOT IN ('advisor@demo.local','viewer@demo.local'); DELETE FROM mail_outbox;");
});

describe("sessions", () => {
  it("lists this device and others, marks the current one, and records the device", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW);
    const s1 = await login(EMAIL, PW, { "User-Agent": "Laptop Chrome" }), s2 = await login(EMAIL, PW, { "User-Agent": "Phone Safari" });
    const list = (await call("GET", "/api/account/sessions", undefined, s1.cookie)).data.sessions as any[];
    expect(list).toHaveLength(2);
    expect(list.filter((x) => x.current)).toHaveLength(1);
    expect(list.find((x) => x.current).userAgent).toBe("Laptop Chrome");
    expect(list.find((x) => !x.current).userAgent).toBe("Phone Safari");
    expect(JSON.stringify(list)).not.toContain(s1.cookie.split("=")[1]); // the secret token is never listed
    void s2;
  });
  it("signs one device out, and cannot touch another user's session", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW);
    const mine = await login(EMAIL, PW), other = await login(EMAIL, PW);
    const adv = await login("advisor@demo.local", "Demo@2026-Advisor");
    const otherId = ((await call("GET", "/api/account/sessions", undefined, mine.cookie)).data.sessions as any[]).find((x) => !x.current).id;
    const advId = ((await call("GET", "/api/account/sessions", undefined, adv.cookie)).data.sessions as any[])[0].id;
    expect((await call("DELETE", `/api/account/sessions/${advId}`, undefined, mine.cookie)).status).toBe(404);   // someone else's
    expect((await call("GET", "/api/auth/me", undefined, adv.cookie)).data.user).not.toBeNull();
    expect((await call("DELETE", `/api/account/sessions/${otherId}`, undefined, mine.cookie)).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, other.cookie)).data.user).toBeNull();
    expect((await call("DELETE", "/api/account/sessions/not-an-id", undefined, mine.cookie)).status).toBe(404);
  });
  it("'sign out everywhere else' keeps this device only", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW);
    const a = await login(), b = await login(), c = await login();
    const r = await call("POST", "/api/account/sessions/revoke-others", {}, a.cookie);
    expect(r.data.revoked).toBe(2);
    expect((await call("GET", "/api/auth/me", undefined, a.cookie)).data.user).not.toBeNull();
    expect((await call("GET", "/api/auth/me", undefined, b.cookie)).data.user).toBeNull();
    expect((await call("GET", "/api/auth/me", undefined, c.cookie)).data.user).toBeNull();
  });
});

describe("email verification", () => {
  it("an unverified address gets no password-reset mail", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW, "default", { requireEmailVerification: true });
    await call("POST", "/api/auth/forgot", { email: EMAIL });
    expect(outbox()).toHaveLength(0);
    const s = await login(); expect((await call("GET", "/api/account/security", undefined, s.cookie)).data).toMatchObject({ emailVerified: false, email: EMAIL });
  });
  it("a confirmation link verifies the address once, then reset mail flows", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW, "default", { requireEmailVerification: true });
    const s = await login();
    expect((await call("POST", "/api/account/email/verify-request", {}, s.cookie)).status).toBe(200);
    const mail = outbox()[0]; expect(mail.to_email).toBe(EMAIL); expect(mail.text_body).toContain("https://wealth.example.com/verify-email?token=");
    const token = mail.text_body.match(/token=([\w-]+)/)![1];
    expect((await call("POST", "/api/auth/verify-email", { token: "x".repeat(43) })).status).toBe(410);
    expect((await call("POST", "/api/auth/verify-email", { token })).status).toBe(200);
    expect((await call("POST", "/api/auth/verify-email", { token })).status).toBe(410); // single use
    expect((await call("GET", "/api/account/security", undefined, s.cookie)).data.emailVerified).toBe(true);
    expect((await call("POST", "/api/account/email/verify-request", {}, s.cookie)).status).toBe(409); // nothing left to verify
    await call("POST", "/api/auth/forgot", { email: EMAIL });
    expect(outbox().some((m) => m.subject.includes("Reset"))).toBe(true);
  });
  it("an expired link is refused, and without PUBLIC_URL no link is sent", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW, "default", { requireEmailVerification: true });
    const s = await login();
    await call("POST", "/api/account/email/verify-request", {}, s.cookie);
    const token = outbox()[0].text_body.match(/token=([\w-]+)/)![1];
    db.prepare("UPDATE email_verifications SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await call("POST", "/api/auth/verify-email", { token })).status).toBe(410);
    const old = process.env.NODE_ENV; process.env.NODE_ENV = "production"; delete process.env.PUBLIC_URL;
    const prod = createApp(db).listen(0); const url = `http://127.0.0.1:${(prod.address() as AddressInfo).port}`;
    try {
      const l = await fetch(url + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth" }, body: JSON.stringify({ email: EMAIL, password: PW }) });
      const ck = (l.headers.get("set-cookie") ?? "").split(";")[0];
      const r = await fetch(url + "/api/account/email/verify-request", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth", cookie: ck }, body: "{}" });
      expect(r.status).toBe(503);
    } finally { process.env.NODE_ENV = old; prod.close(); }
  });
  it("operator-created accounts that already existed count as verified", () => {
    expect((db.prepare("SELECT email_verified_at FROM users WHERE email = 'advisor@demo.local'").get() as { email_verified_at: string | null }).email_verified_at).not.toBeNull();
  });
});

describe("encrypted two-factor secrets", () => {
  it("stores the seed sealed, and sign-in still works with it", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW);
    const s = await login(); const { data: setup } = await call("POST", "/api/account/mfa/setup", {}, s.cookie);
    const stored = (db.prepare("SELECT totp_secret FROM users WHERE email = ?").get(EMAIL) as { totp_secret: string }).totp_secret;
    expect(stored.startsWith("enc1:")).toBe(true); expect(stored).not.toContain(setup.secret);
    expect((await call("POST", "/api/account/mfa/enable", { code: totpAt(setup.secret, step()) }, s.cookie)).status).toBe(200);
    const ch = (await login()).data.challenge;
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: ch, code: totpAt(setup.secret, step() + 1) })).status).toBe(200);
  });
  it("seals a seed that was stored in the clear, and it keeps working", async () => {
    createUser(db, EMAIL, "Acct", "viewer", PW);
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE email = ?").run(secret, EMAIL);
    expect(sealLegacySecrets(db)).toBe(1); expect(sealLegacySecrets(db)).toBe(0);
    expect((db.prepare("SELECT totp_secret FROM users WHERE email = ?").get(EMAIL) as { totp_secret: string }).totp_secret.startsWith("enc1:")).toBe(true);
    const ch = (await login()).data.challenge;
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: ch, code: totpAt(secret, step()) })).status).toBe(200);
  });
  it("round-trips, is different each time, and refuses a tampered or foreign ciphertext", () => {
    const a = seal(db, "hello secret"), b = seal(db, "hello secret");
    expect(a).not.toBe(b); expect(open(db, a)).toBe("hello secret");
    const [iv, tag, ct] = a.slice(5).split(".");
    const flipped = Buffer.from(ct, "base64"); flipped[0] ^= 1;
    expect(() => open(db, `enc1:${iv}.${tag}.${flipped.toString("base64")}`)).toThrow();
    const other = openDb(path.join(os.tmpdir(), `nw-other-${process.pid}.db`));
    try { expect(() => open(other, a)).toThrow(); } finally { other.close(); for (const x of ["", "-wal", "-shm", ".key"]) fs.rmSync(path.join(os.tmpdir(), `nw-other-${process.pid}.db`) + x, { force: true }); }
  });
  it("writes a key file only the owner can read", () => {
    const st = fs.statSync(tmp + ".key"); expect(st.mode & 0o077).toBe(0);
  });
});

describe("mandatory two-factor for advisors", () => {
  it("is off by default", async () => { expect((await call("GET", "/api/clients", undefined, (await login("advisor@demo.local", "Demo@2026-Advisor")).cookie)).status).toBe(200); });
  it("blocks an advisor without two-factor from everything but account settings, until they enrol", async () => {
    process.env.REQUIRE_MFA_FOR_ADMINS = "1";
    const adv = await login("advisor@demo.local", "Demo@2026-Advisor");
    expect(adv.data.user.mfaSetupRequired).toBe(true);
    expect((await call("GET", "/api/auth/me", undefined, adv.cookie)).data.user.mfaSetupRequired).toBe(true);
    expect((await call("GET", "/api/clients", undefined, adv.cookie)).status).toBe(403);
    expect((await call("GET", "/api/clients/client_priya/state", undefined, adv.cookie)).status).toBe(403);
    expect((await call("GET", "/api/account/security", undefined, adv.cookie)).data.mfaPolicy).toBe(true);
    const { data: setup } = await call("POST", "/api/account/mfa/setup", {}, adv.cookie);
    expect((await call("POST", "/api/account/mfa/enable", { code: totpAt(setup.secret, step()) }, adv.cookie)).status).toBe(200);
    expect((await call("GET", "/api/clients", undefined, adv.cookie)).status).toBe(200);
    // leave the shared demo advisor as we found it
    db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE email = 'advisor@demo.local'").run(); db.prepare("DELETE FROM recovery_codes").run();
  });
  it("does not apply to read-only viewers", async () => {
    process.env.REQUIRE_MFA_FOR_ADMINS = "1";
    const v = await login("viewer@demo.local", "Demo@2026-Viewer");
    expect(v.data.user.mfaSetupRequired).toBe(false);
    expect((await call("GET", "/api/clients", undefined, v.cookie)).status).toBe(200);
  });
});
