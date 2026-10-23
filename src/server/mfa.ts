import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { audit } from "./audit";
import { HttpError } from "./service";
import { hashPassword, verifyPassword, createSession } from "./auth";
import type { Mailer } from "./notify";
import { open, seal } from "./secretbox";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STEP = 30, DIGITS = 6, CHALLENGE_MINUTES = 5, MAX_CHALLENGE_ATTEMPTS = 5, RESET_MINUTES = 30;
export const MIN_PASSWORD = 10;

// ---- TOTP (RFC 6238, HMAC-SHA1, 30 s steps, 6 digits: what every authenticator app expects) --------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error("Not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpAt(secret: string, step: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** The accepted step if the code is valid within ±1 step (clock drift) and newer than `lastStep`; otherwise null. */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const step of [cur, cur - 1, cur + 1]) if (safeEq(totpAt(secret, step), c) && (lastStep == null || step > lastStep)) return step;
  return null;
}
export const newSecret = () => base32Encode(randomBytes(20));
export const otpauthUri = (email: string, secret: string) => `otpauth://totp/${encodeURIComponent(`Wealth Intelligence:${email}`)}?secret=${secret}&issuer=${encodeURIComponent("Wealth Intelligence")}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

// ---- enrolment ----------------------------------------------------------------------------------
interface Row { id: string; email: string; password_hash: string; totp_secret: string | null; totp_enabled: number; totp_last_step: number | null }
const userRow = (db: DB, id: string) => db.prepare("SELECT id, email, password_hash, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?").get(id) as Row | undefined;

export function mfaStatus(db: DB, userId: string) {
  const r = userRow(db, userId);
  const left = (db.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL").get(userId) as { n: number }).n;
  return { enabled: r?.totp_enabled === 1, recoveryCodesLeft: r?.totp_enabled === 1 ? left : 0 };
}
/** Start (or restart) enrolment. The secret is not live until a code from the app proves it was scanned. */
export function startEnrolment(db: DB, userId: string) {
  const r = userRow(db, userId)!;
  if (r.totp_enabled === 1) throw new HttpError(409, "Two-factor sign-in is already on. Turn it off first to enrol a new device.");
  const secret = newSecret();
  db.prepare("UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?").run(seal(db, secret), userId);
  return { secret, uri: otpauthUri(r.email, secret) };
}
const makeRecoveryCodes = () => Array.from({ length: 8 }, () => { const h = randomBytes(5).toString("hex"); return `${h.slice(0, 5)}-${h.slice(5)}`; });
export function enableMfa(db: DB, userId: string, code: string): string[] {
  const r = userRow(db, userId)!;
  if (r.totp_enabled === 1) throw new HttpError(409, "Two-factor sign-in is already on.");
  if (!r.totp_secret) throw new HttpError(409, "Start enrolment first.");
  const step = verifyTotp(open(db, r.totp_secret), code, null);
  if (step == null) throw new HttpError(422, "That code is not right. Check the time on your phone and try the newest code.");
  const codes = makeRecoveryCodes();
  tx(db, () => {
    db.prepare("UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?").run(step, userId);
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
    for (const c of codes) db.prepare("INSERT INTO recovery_codes (id, user_id, code_hash) VALUES (?,?,?)").run(uid("rc"), userId, sha(c));
    audit(db, { clientId: null, userId, entity: "auth", action: "mfa_enable", summary: `${r.email} turned on two-factor sign-in` });
  });
  return codes;
}
export function disableMfa(db: DB, userId: string, password: string, code: string) {
  const r = userRow(db, userId)!;
  if (r.totp_enabled !== 1) throw new HttpError(409, "Two-factor sign-in is not on.");
  if (!verifyPassword(password, r.password_hash)) throw new HttpError(401, "Incorrect password.");
  if (!checkSecondFactor(db, r, code)) throw new HttpError(422, "That code is not right.");
  tx(db, () => {
    db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?").run(userId);
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
    audit(db, { clientId: null, userId, entity: "auth", action: "mfa_disable", summary: `${r.email} turned off two-factor sign-in` });
  });
}
/** A current authenticator code, or an unused recovery code (which is then spent). */
function checkSecondFactor(db: DB, r: Row, code: string): boolean {
  const trimmed = code.trim();
  if (r.totp_secret) {
    const step = verifyTotp(open(db, r.totp_secret), trimmed, r.totp_last_step);
    if (step != null) { db.prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, r.id); return true; }
  }
  const hit = db.prepare("SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL").get(r.id, sha(trimmed.toLowerCase())) as { id: string } | undefined;
  if (!hit) return false;
  db.prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ?").run(nowISO(), hit.id);
  return true;
}

// ---- sign-in with a second factor ---------------------------------------------------------------
export function createChallenge(db: DB, userId: string): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM login_challenges WHERE expires_at < ?").run(nowISO());
  db.prepare("INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha(token), userId, new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString());
  return token;
}
export function completeChallenge(db: DB, challenge: string, code: string, meta: { userAgent?: string; ip?: string } = {}): { session: string; user: { id: string; email: string; name: string; role: string } } {
  // Outcomes are returned, not thrown, so the attempt counter and the lock-out commit even when the answer is a refusal.
  type Out = { kind: "expired" | "locked" | "wrong" } | { kind: "ok"; session: string; user: { id: string; email: string; name: string; role: string } };
  const out = tx<Out>(db, () => {
    const c = db.prepare("SELECT user_id, expires_at, attempts FROM login_challenges WHERE token_hash = ?").get(sha(challenge)) as { user_id: string; expires_at: string; attempts: number } | undefined;
    if (!c || c.expires_at < nowISO()) return { kind: "expired" };
    if (c.attempts >= MAX_CHALLENGE_ATTEMPTS) { db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").run(sha(challenge)); return { kind: "locked" }; }
    db.prepare("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?").run(sha(challenge));
    const r = db.prepare("SELECT id, email, name, role, password_hash, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?").get(c.user_id) as (Row & { name: string; role: string }) | undefined;
    if (!r || !checkSecondFactor(db, r, code)) return { kind: "wrong" };
    db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").run(sha(challenge));
    audit(db, { clientId: null, userId: r.id, entity: "auth", action: "login", summary: `${r.email} signed in with two-factor` });
    return { kind: "ok", session: createSession(db, r.id, meta), user: { id: r.id, email: r.email, name: r.name, role: r.role } };
  });
  if (out.kind !== "ok") throw new HttpError(401, { expired: "This sign-in has expired. Start again.", locked: "Too many wrong codes. Start again.", wrong: "That code is not right." }[out.kind]);
  return out;
}

// ---- password change and reset ------------------------------------------------------------------
export function validatePassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new HttpError(422, `Use at least ${MIN_PASSWORD} characters.`, [{ field: "password", message: `At least ${MIN_PASSWORD} characters.` }]);
  if (pw.length > 200) throw new HttpError(422, "That password is too long.");
  return pw;
}
const revokeSessions = (db: DB, userId: string) => { db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); db.prepare("DELETE FROM login_challenges WHERE user_id = ?").run(userId); };

export function changePassword(db: DB, userId: string, current: string, next: string, keepSession?: string) {
  const r = userRow(db, userId)!;
  if (!verifyPassword(current, r.password_hash)) throw new HttpError(401, "Your current password is not right.");
  validatePassword(next);
  tx(db, () => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, keepSession ? sha(keepSession) : "");
    audit(db, { clientId: null, userId, entity: "auth", action: "password_change", summary: `${r.email} changed their password` });
  });
}

/** Always looks the same to the caller. Returns the plain token only so tests can read it; the route never exposes it. */
export async function requestReset(db: DB, email: string, mailer: Mailer, baseUrl: string): Promise<string | null> {
  const r = db.prepare("SELECT id, email FROM users WHERE email = ? AND email_verified_at IS NOT NULL").get(email.trim().toLowerCase()) as { id: string; email: string } | undefined;
  if (!r) return null; // unknown or not-yet-verified address: nothing is sent, and the caller answers the same either way
  const token = randomBytes(32).toString("base64url");
  tx(db, () => {
    db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(nowISO(), r.id);
    db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(sha(token), r.id, nowISO(), new Date(Date.now() + RESET_MINUTES * 60_000).toISOString());
    audit(db, { clientId: null, userId: r.id, entity: "auth", action: "password_reset_request", summary: `Password reset requested for ${r.email}` });
  });
  const link = `${baseUrl.replace(/\/$/, "")}/reset?token=${token}`;
  const text = `Someone asked to reset the password for this account. If that was you, open this link within ${RESET_MINUTES} minutes:\n\n${link}\n\nIf it was not you, ignore this message; your password has not changed.`;
  await mailer.send({ to: r.email, subject: "Reset your Wealth Intelligence password", text, html: `<p>Someone asked to reset the password for this account. If that was you, open this link within ${RESET_MINUTES} minutes:</p><p><a href="${link}">Reset my password</a></p><p>If it was not you, ignore this message; your password has not changed.</p>` });
  return token;
}
export function resetPassword(db: DB, token: string, password: string) {
  validatePassword(password);
  tx(db, () => {
    const t = db.prepare("SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?").get(sha(String(token))) as { user_id: string; expires_at: string; used_at: string | null } | undefined;
    if (!t || t.used_at || t.expires_at < nowISO()) throw new HttpError(410, "This reset link is no longer valid. Ask for a new one.");
    db.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(nowISO(), sha(String(token)));
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), t.user_id);
    revokeSessions(db, t.user_id);
    audit(db, { clientId: null, userId: t.user_id, entity: "auth", action: "password_reset", summary: "Password reset with an emailed link; all sessions signed out" });
  });
}

// ---- email verification -------------------------------------------------------------------------
const VERIFY_HOURS = 48;
export const isVerified = (db: DB, userId: string) => !!(db.prepare("SELECT email_verified_at FROM users WHERE id = ?").get(userId) as { email_verified_at: string | null } | undefined)?.email_verified_at;
/** Mail a link to the address on file. Until it is opened, the address receives no alerts and no password-reset mail. */
export async function requestEmailVerification(db: DB, userId: string, mailer: Mailer, baseUrl: string): Promise<string> {
  const u = db.prepare("SELECT email, email_verified_at FROM users WHERE id = ?").get(userId) as { email: string; email_verified_at: string | null };
  if (u.email_verified_at) throw new HttpError(409, "This email address is already verified.");
  const token = randomBytes(32).toString("base64url");
  tx(db, () => {
    db.prepare("UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(nowISO(), userId);
    db.prepare("INSERT INTO email_verifications (token_hash, user_id, email, created_at, expires_at) VALUES (?,?,?,?,?)").run(sha(token), userId, u.email, nowISO(), new Date(Date.now() + VERIFY_HOURS * 3600_000).toISOString());
  });
  const link = `${baseUrl.replace(/\/$/, "")}/verify-email?token=${token}`;
  await mailer.send({ to: u.email, subject: "Confirm your email for Wealth Intelligence", text: `Open this link within ${VERIFY_HOURS} hours to confirm this address:\n\n${link}\n\nIf you did not ask for this, ignore this message.`, html: `<p>Open this link within ${VERIFY_HOURS} hours to confirm this address:</p><p><a href="${link}">Confirm my email</a></p><p>If you did not ask for this, ignore this message.</p>` });
  return token;
}
export function confirmEmail(db: DB, token: string) {
  tx(db, () => {
    const t = db.prepare("SELECT user_id, email, expires_at, used_at FROM email_verifications WHERE token_hash = ?").get(sha(String(token))) as { user_id: string; email: string; expires_at: string; used_at: string | null } | undefined;
    if (!t || t.used_at || t.expires_at < nowISO()) throw new HttpError(410, "This confirmation link is no longer valid. Ask for a new one from Account security.");
    const cur = db.prepare("SELECT email FROM users WHERE id = ?").get(t.user_id) as { email: string };
    if (cur.email !== t.email) throw new HttpError(410, "The address on this account has changed since the link was sent.");
    db.prepare("UPDATE email_verifications SET used_at = ? WHERE token_hash = ?").run(nowISO(), sha(String(token)));
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(nowISO(), t.user_id);
    audit(db, { clientId: null, userId: t.user_id, entity: "auth", action: "email_verified", summary: `${t.email} confirmed their address` });
  });
}

// ---- sessions ("where am I signed in") ----------------------------------------------------------
export interface SessionInfo { id: string; createdAt: string; expiresAt: string; userAgent: string | null; ip: string | null; current: boolean }
export function listSessions(db: DB, userId: string, currentToken?: string): SessionInfo[] {
  const cur = currentToken ? sha(currentToken) : "";
  return (db.prepare("SELECT token_hash, created_at, expires_at, user_agent, ip FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(userId, nowISO()) as any[])
    .map((r) => ({ id: r.token_hash.slice(0, 16), createdAt: r.created_at, expiresAt: r.expires_at, userAgent: r.user_agent, ip: r.ip, current: r.token_hash === cur }));
}
export function revokeSession(db: DB, userId: string, id: string) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(404, "Session not found.");
  const r = db.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?").run(userId, id);
  if (r.changes === 0) throw new HttpError(404, "Session not found.");
  audit(db, { clientId: null, userId, entity: "auth", action: "session_revoked", summary: "Signed out one device" });
}
export function revokeOtherSessions(db: DB, userId: string, currentToken: string): number {
  const r = db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, sha(currentToken));
  audit(db, { clientId: null, userId, entity: "auth", action: "sessions_revoked", summary: `Signed out ${r.changes} other device(s)` });
  return Number(r.changes);
}
/** Advisors (role admin) may be required to use two-factor: REQUIRE_MFA_FOR_ADMINS=1. */
export const mfaRequiredButMissing = (db: DB, u: { id: string; role: string }) => process.env.REQUIRE_MFA_FOR_ADMINS === "1" && u.role === "admin" && !mfaStatus(db, u.id).enabled;
