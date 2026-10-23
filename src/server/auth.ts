import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { DB } from "./db";
import { DEFAULT_TENANT, nowISO, tx, uid } from "./db";

export interface AuthUser { id: string; email: string; name: string; role: "admin" | "viewer"; tenantId: string }
declare module "express-serve-static-core" { interface Request { user?: AuthUser } }

export const COOKIE = "nw_session";
const SESSION_HOURS = 12;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const h = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return h.length === expected.length && timingSafeEqual(h, expected);
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function createUser(db: DB, email: string, name: string, role: "admin" | "viewer", password: string, tenantId = DEFAULT_TENANT): AuthUser {
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(tenantId)) throw new Error("Tenant id must be 2-40 characters: lowercase letters, digits, - or _.");
  const id = uid("usr");
  db.prepare("INSERT INTO users (id, email, name, role, password_hash, created_at, tenant_id) VALUES (?,?,?,?,?,?,?)").run(id, email.toLowerCase(), name, role, hashPassword(password), nowISO(), tenantId);
  return { id, email: email.toLowerCase(), name, role, tenantId };
}
export function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString("hex");
  const exp = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(sha(token), userId, nowISO(), exp);
  return token;
}
export function destroySession(db: DB, token: string) { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); }

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function userFromToken(db: DB, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, u.tenant_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token)) as any;
  if (!row) return null;
  if (row.expires_at < nowISO()) { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); return null; }
  return { id: row.id, email: row.email, name: row.name, role: row.role, tenantId: row.tenant_id };
}

/** Sets req.user from the session cookie. */
export const sessionMiddleware = (db: DB) => (req: Request, _res: Response, next: NextFunction) => {
  req.user = userFromToken(db, parseCookies(req.headers.cookie)[COOKIE]) ?? undefined;
  next();
};
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return void res.status(401).json({ error: "Authentication required." });
  next();
}
/** Server-side authorisation: viewers are read-only; mutations need admin plus the CSRF-guard header. */
export function requireWrite(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return void res.status(401).json({ error: "Authentication required." });
  if (req.user.role !== "admin") return void res.status(403).json({ error: "Your role is read-only." });
  next();
}
/** CSRF defence in depth (cookie is also SameSite=Strict): mutating requests must carry a custom header browsers will not send cross-site. */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-requested-with"] !== "networth") return void res.status(403).json({ error: "Missing CSRF header." });
  next();
}

const THROTTLE_WINDOW_MS = 15 * 60_000, THROTTLE_MAX = 8;
/** Count a login attempt; false means "too many, refuse". State is in the database so it survives restarts and is shared by instances. */
export function loginThrottle(db: DB, key: string, now = Date.now()): boolean {
  return tx(db, () => {
    db.prepare("DELETE FROM login_attempts WHERE window_start < ?").run(now - THROTTLE_WINDOW_MS);
    const e = db.prepare("SELECT attempts FROM login_attempts WHERE key = ?").get(key) as { attempts: number } | undefined;
    if (!e) { db.prepare("INSERT INTO login_attempts (key, attempts, window_start) VALUES (?,1,?)").run(key, now); return true; }
    db.prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE key = ?").run(key);
    return e.attempts + 1 <= THROTTLE_MAX;
  });
}
export function loginSucceeded(db: DB, key: string) { db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key); }
export function resetThrottle(db: DB) { db.prepare("DELETE FROM login_attempts").run(); }
