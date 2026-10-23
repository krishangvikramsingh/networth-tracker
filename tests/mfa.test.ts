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
import { base32Decode, base32Encode, totpAt, verifyTotp } from "../src/server/mfa";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
const tmp = path.join(os.tmpdir(), `nw-mfa-${process.pid}.db`);
const EMAIL = "mfa.user@demo.local", PW = "Correct-Horse-9";
const step = () => Math.floor(Date.now() / 1000 / 30);

async function call(method: string, url: string, body?: unknown, cookie = "") {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, cookie: sc ? sc.split(";")[0] : "", data: ct.includes("json") ? ((await r.json()) as any) : await r.text() };
}
const login = (email = EMAIL, password = PW) => call("POST", "/api/auth/login", { email, password });
/** Sign in and turn two-factor on; returns the session cookie, the secret and the recovery codes. */
async function enrol() {
  const s = await login(); expect(s.status).toBe(200);
  const { data: setup } = await call("POST", "/api/account/mfa/setup", {}, s.cookie);
  const en = await call("POST", "/api/account/mfa/enable", { code: totpAt(setup.secret, step()) }, s.cookie);
  expect(en.status).toBe(200);
  return { cookie: s.cookie, secret: setup.secret as string, codes: en.data.recoveryCodes as string[] };
}

beforeAll(() => {
  for (const x of ["", "-wal", "-shm"]) fs.rmSync(tmp + x, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); db.close(); for (const x of ["", "-wal", "-shm"]) fs.rmSync(tmp + x, { force: true }); });
beforeEach(() => {
  resetThrottle(db);
  db.exec("DELETE FROM users WHERE email = '" + EMAIL + "'; DELETE FROM mail_outbox;");
  createUser(db, EMAIL, "MFA User", "viewer", PW);
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vector (SHA-1, secret 12345678901234567890, T=59 → 94287082; six digits 287082)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("base32 round-trips", () => { const b = Buffer.from("hello world, 2fa"); expect(base32Decode(base32Encode(b)).equals(b)).toBe(true); });
  it("accepts one step of clock drift either way but not two, and refuses a step it has already accepted", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890")), now = 1_700_000_000_000, cur = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpAt(secret, cur), null, now)).toBe(cur);
    expect(verifyTotp(secret, totpAt(secret, cur - 1), null, now)).toBe(cur - 1);
    expect(verifyTotp(secret, totpAt(secret, cur + 1), null, now)).toBe(cur + 1);
    expect(verifyTotp(secret, totpAt(secret, cur - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, cur), cur, now)).toBeNull();
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", null, now)).toBeNull();
  });
});

describe("two-factor sign-in", () => {
  it("leaves sign-in unchanged for a user who has not turned it on", async () => {
    const r = await login(); expect(r.status).toBe(200); expect(r.cookie).toContain("nw_session"); expect(r.data.mfaRequired).toBeUndefined();
    expect((await call("GET", "/api/account/security", undefined, r.cookie)).data).toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });
  it("does not turn on until a correct code proves the secret was scanned", async () => {
    const s = await login(); const { data: setup } = await call("POST", "/api/account/mfa/setup", {}, s.cookie);
    expect(setup.uri).toContain("otpauth://totp/"); expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect((await call("POST", "/api/account/mfa/enable", { code: "000000" }, s.cookie)).status).toBe(422);
    expect((await call("GET", "/api/account/security", undefined, s.cookie)).data.enabled).toBe(false);
    expect((await login()).data.mfaRequired).toBeUndefined();
  });
  it("after enrolment a correct password earns a challenge and no session", async () => {
    await enrol();
    const r = await login();
    expect(r.status).toBe(200); expect(r.data.mfaRequired).toBe(true); expect(typeof r.data.challenge).toBe("string"); expect(r.cookie).toBe("");
    expect((await call("GET", "/api/auth/me")).data.user).toBeNull();
  });
  it("a wrong password gets no challenge", async () => { await enrol(); const r = await login(EMAIL, "wrong-password-1"); expect(r.status).toBe(401); expect(r.data.challenge).toBeUndefined(); });
  it("the right code completes sign-in; the same code cannot be used again", async () => {
    const { secret } = await enrol();
    // enrolment spent this step, so move to the next one the way a real user waits for a fresh code
    const code = totpAt(secret, step() + 1);
    const ch = (await login()).data.challenge;
    const ok = await call("POST", "/api/auth/mfa/verify", { challenge: ch, code });
    expect(ok.status).toBe(200); expect(ok.cookie).toContain("nw_session"); expect(ok.data.user.email).toBe(EMAIL);
    expect((await call("GET", "/api/auth/me", undefined, ok.cookie)).data.user.email).toBe(EMAIL);
    const ch2 = (await login()).data.challenge;
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: ch2, code })).status).toBe(401); // replay
  });
  it("a wrong code is refused, and five wrong codes burn the challenge even if the sixth is right", async () => {
    const { secret } = await enrol();
    const ch = (await login()).data.challenge;
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/auth/mfa/verify", { challenge: ch, code: "000000" })).status).toBe(401);
    const late = await call("POST", "/api/auth/mfa/verify", { challenge: ch, code: totpAt(secret, step() + 1) });
    expect(late.status).toBe(401); expect(late.cookie).toBe("");
  });
  it("an expired or made-up challenge is refused", async () => {
    await enrol();
    const ch = (await login()).data.challenge;
    db.prepare("UPDATE login_challenges SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: ch, code: "123456" })).status).toBe(401);
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: "nope", code: "123456" })).status).toBe(401);
  });
  it("a recovery code signs in once and then is spent", async () => {
    const { codes } = await enrol(); expect(codes).toHaveLength(8); expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    const a = await call("POST", "/api/auth/mfa/verify", { challenge: (await login()).data.challenge, code: codes[0] });
    expect(a.status).toBe(200);
    expect((await call("GET", "/api/account/security", undefined, a.cookie)).data.recoveryCodesLeft).toBe(7);
    expect((await call("POST", "/api/auth/mfa/verify", { challenge: (await login()).data.challenge, code: codes[0] })).status).toBe(401);
  });
  it("stores only hashes of recovery codes", async () => {
    const { codes } = await enrol();
    const rows = db.prepare("SELECT code_hash FROM recovery_codes").all() as Array<{ code_hash: string }>;
    for (const c of codes) expect(rows.some((r) => r.code_hash === c)).toBe(false);
  });
  it("turning it off needs the password and a current code, then sign-in is one step again", async () => {
    const { cookie, secret, codes } = await enrol();
    expect((await call("POST", "/api/account/mfa/disable", { password: "wrong-password-1", code: totpAt(secret, step() + 1) }, cookie)).status).toBe(401);
    expect((await call("POST", "/api/account/mfa/disable", { password: PW, code: "000000" }, cookie)).status).toBe(422);
    expect((await call("POST", "/api/account/mfa/disable", { password: PW, code: codes[1] }, cookie)).status).toBe(200);
    const r = await login(); expect(r.cookie).toContain("nw_session"); expect(r.data.mfaRequired).toBeUndefined();
  });
  it("the verify endpoint is throttled", async () => {
    await enrol();
    let last = 0; for (let i = 0; i < 10; i++) last = (await call("POST", "/api/auth/mfa/verify", { challenge: "nope", code: "000000" })).status;
    expect(last).toBe(429);
  });
});

describe("password change", () => {
  it("needs the current password, enforces the length, and signs out other sessions but not this one", async () => {
    const a = await login(), b = await login();
    expect((await call("POST", "/api/account/password", { current: "wrong-password-1", next: "Another-Long-Pass-1" }, a.cookie)).status).toBe(401);
    expect((await call("POST", "/api/account/password", { current: PW, next: "short" }, a.cookie)).status).toBe(422);
    expect((await call("POST", "/api/account/password", { current: PW, next: "Another-Long-Pass-1" }, a.cookie)).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, a.cookie)).data.user).not.toBeNull();
    expect((await call("GET", "/api/auth/me", undefined, b.cookie)).data.user).toBeNull();
    expect((await login(EMAIL, PW)).status).toBe(401);
    expect((await login(EMAIL, "Another-Long-Pass-1")).status).toBe(200);
  });
});

describe("password reset by email", () => {
  const latestLink = () => { const m = db.prepare("SELECT text_body FROM mail_outbox ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { text_body: string } | undefined; return m?.text_body.match(/reset\?token=([\w-]+)/)?.[1]; };

  it("answers the same for an address with no account, and sends nothing to it", async () => {
    const known = await call("POST", "/api/auth/forgot", { email: EMAIL });
    const unknown = await call("POST", "/api/auth/forgot", { email: "nobody@nowhere.example" });
    expect(known.status).toBe(200); expect(unknown.status).toBe(200); expect(unknown.data).toEqual(known.data);
    expect((db.prepare("SELECT COUNT(*) AS n FROM mail_outbox").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT to_email FROM mail_outbox").get() as { to_email: string }).to_email).toBe(EMAIL);
  });
  it("emails a link whose token works once, sets the new password and signs the account out everywhere", async () => {
    const before = await login();
    await call("POST", "/api/auth/forgot", { email: EMAIL });
    const token = latestLink()!; expect(token.length).toBeGreaterThan(30);
    expect((await call("POST", "/api/auth/reset", { token, password: "short" })).status).toBe(422);
    expect((await call("POST", "/api/auth/reset", { token, password: "Brand-New-Pass-77" })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, before.cookie)).data.user).toBeNull();
    expect((await login(EMAIL, PW)).status).toBe(401);
    expect((await login(EMAIL, "Brand-New-Pass-77")).status).toBe(200);
    expect((await call("POST", "/api/auth/reset", { token, password: "Another-New-Pass-88" })).status).toBe(410); // single use
  });
  it("refuses an expired token and a guessed one", async () => {
    await call("POST", "/api/auth/forgot", { email: EMAIL });
    const token = latestLink()!;
    db.prepare("UPDATE password_resets SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await call("POST", "/api/auth/reset", { token, password: "Brand-New-Pass-77" })).status).toBe(410);
    expect((await call("POST", "/api/auth/reset", { token: "x".repeat(43), password: "Brand-New-Pass-77" })).status).toBe(410);
  });
  it("a newer request retires the older link", async () => {
    await call("POST", "/api/auth/forgot", { email: EMAIL }); const first = latestLink()!;
    await call("POST", "/api/auth/forgot", { email: EMAIL }); const second = latestLink()!;
    expect(second).not.toBe(first);
    expect((await call("POST", "/api/auth/reset", { token: first, password: "Brand-New-Pass-77" })).status).toBe(410);
    expect((await call("POST", "/api/auth/reset", { token: second, password: "Brand-New-Pass-77" })).status).toBe(200);
  });
  it("stores only a hash of the token", async () => {
    await call("POST", "/api/auth/forgot", { email: EMAIL }); const token = latestLink()!;
    expect((db.prepare("SELECT token_hash FROM password_resets").all() as Array<{ token_hash: string }>).some((r) => r.token_hash === token)).toBe(false);
  });
  it("does not build the link from a forged Host header in production", async () => {
    const old = process.env.NODE_ENV; process.env.NODE_ENV = "production"; delete process.env.PUBLIC_URL;
    const prodServer = createApp(db).listen(0); const url = `http://127.0.0.1:${(prodServer.address() as AddressInfo).port}`;
    try {
      const r = await fetch(url + "/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth", "x-forwarded-host": "evil.example" }, body: JSON.stringify({ email: EMAIL }) });
      expect(r.status).toBe(200);
      expect((db.prepare("SELECT COUNT(*) AS n FROM mail_outbox").get() as { n: number }).n).toBe(0); // no PUBLIC_URL, so nothing is sent
    } finally { process.env.NODE_ENV = old; prodServer.close(); }
  });
  it("uses PUBLIC_URL for the link when it is set", async () => {
    process.env.PUBLIC_URL = "https://wealth.example.com";
    try { await call("POST", "/api/auth/forgot", { email: EMAIL }); } finally { delete process.env.PUBLIC_URL; }
    expect((db.prepare("SELECT text_body FROM mail_outbox").get() as { text_body: string }).text_body).toContain("https://wealth.example.com/reset?token=");
  });
});
