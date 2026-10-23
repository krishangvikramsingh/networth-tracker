import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { DEFAULT_TENANT, nowISO, tx, uid } from "./db";
import {
  COOKIE, createSession, csrfGuard, destroySession, loginSucceeded, loginThrottle, parseCookies, requireAuth, requireWrite, sessionMiddleware, verifyPassword,
} from "./auth";
import { audit, recentAudit } from "./audit";
import {
  HttpError, asOfDate, buildState, classifyPreview, createEntity, overrideClassification, patchSettings, reclassifyAll, reconcileAggregate, recordSnapshot, refresh, removeEntity, requireClient,
  restoreEntity, runScenario, setTargets, updateEntity, updateRule,
} from "./service";
import { ENTITY_SCHEMAS, tradesIn } from "./schemas";
import { listAlerts } from "./alerts";
import { buildTables, buildWorkbook, summaryLines, toCSV } from "./exports";
import { TEMPLATES, runImport, type ImportKind } from "./importer";
import { marketStatus, parseManualCsv, proposeValuations, refreshProvider, storeObservations } from "./market/service";
import { resetDemo } from "./seed";
import { insertRow, listAll } from "./repo";
import { defaultSettings } from "../shared/fixtures";
import { defaultRules } from "../shared/rules";
import { evaluateClient } from "../shared/evaluate";
import { MIGRATIONS_DIR } from "./db";
import { applyProfileTargets, listAssessments, recordAssessment } from "./risk";
import { addNominee, loadEstate, removeNominee, setNomination, updateNominee } from "./estate";
import { dispatchNotifications, getPrefs, outboxMailer, outboxFor, recentNotifications, setPrefs, type Mailer } from "./notify";
import { SEVERITY_ORDER } from "./alerts";
import { buildOverview } from "./overview";
import { createTask, deleteTask, listAssignees, listTasks, taskCounts, updateTask } from "./tasks";
import { changePassword, completeChallenge, confirmEmail, createChallenge, disableMfa, enableMfa, isVerified, listSessions, mfaRequiredButMissing, mfaStatus, requestEmailVerification, requestReset, resetPassword, revokeOtherSessions, revokeSession, startEnrolment } from "./mfa";
import { buildOpenApi, renderDocsHtml, type RouteInfo } from "./openapi";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};
const param = (req: Request, k: string): string => String(req.params[k] ?? "");
/** Burn the same time a real password check takes, so response timing does not reveal which emails exist. */
const spendHashingTime = (): false => { verifyPassword("x", "scrypt$00$00"); return false; };

export function createApp(db: DB, opts: { mailer?: Mailer } = {}) {
  const mailer = opts.mailer ?? outboxMailer(db);
  const app = express();
  app.disable("x-powered-by");
  // Behind a reverse proxy set TRUST_PROXY (e.g. "1") so req.ip, and with it the login throttle, sees the real client address.
  if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  const prod = process.env.NODE_ENV === "production";

  app.use(compression()); // the state payload is large JSON (about 6 MB at 5,000 holdings) and compresses roughly tenfold
  app.use((req, res, next) => {
    const id = randomUUID().slice(0, 8);
    const t0 = Date.now();
    res.setHeader("X-Request-Id", id);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (prod) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    res.on("finish", () => {
      if (process.env.LOG_LEVEL !== "silent" && req.path.startsWith("/api")) console.log(JSON.stringify({ t: nowISO(), id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0, user: req.user?.id ?? null }));
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }));
  app.use(express.raw({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"], limit: "10mb" }));
  app.use(sessionMiddleware(db));
  app.use("/api", csrfGuard);

  // idempotency (duplicate-submit protection) for create endpoints. Stored in the database so a retry after a restart, or on
  // another instance, still replays the original answer. The lookup, the work and the store share one transaction.
  const IDEM_TTL_MS = 10 * 60_000;
  const withIdem = (req: Request, res: Response, fn: () => { status: number; body: unknown }) => {
    const k = req.header("Idempotency-Key");
    const key = k && req.user ? `${req.user.id}:${req.method}:${req.path}:${k}` : null;
    const out = tx(db, () => {
      if (key) {
        db.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").run(Date.now() - IDEM_TTL_MS);
        const hit = db.prepare("SELECT status, body FROM idempotency_keys WHERE key = ?").get(key) as { status: number; body: string } | undefined;
        if (hit) return { replay: true, status: hit.status, body: JSON.parse(hit.body) as unknown };
      }
      const r = fn();
      if (key) db.prepare("INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (?,?,?,?)").run(key, r.status, JSON.stringify(r.body), Date.now());
      return { replay: false, ...r };
    });
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    res.status(out.status).json(out.body);
  };

  // ---- public ---------------------------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    const m = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    res.json({ ok: true, time: nowISO(), migrations: m.n });
  });
  const deviceOf = (req: Request) => ({ userAgent: req.get("user-agent") ?? undefined, ip: req.ip });
  const baseUrlOf = (req: Request) => process.env.PUBLIC_URL || (prod ? "" : `${req.protocol}://${req.get("host")}`);
  const setSessionCookie = (res: Response, token: string) => res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: prod, maxAge: 12 * 3600_000, path: "/" });
  app.post("/api/auth/login", wrap(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const key = `${req.ip}:${String(email ?? "").toLowerCase()}`;
    if (!loginThrottle(db, key)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email ?? "").toLowerCase()) as any;
    // verify even when the user is unknown so timing does not reveal which emails exist
    const ok = row ? verifyPassword(String(password ?? ""), row.password_hash) : spendHashingTime();
    if (!row || !ok) throw new HttpError(401, "Incorrect email or password.");
    loginSucceeded(db, key);
    // A user with two-factor on gets a short-lived challenge, not a session, until the second step is done.
    if (row.totp_enabled === 1) return void res.json({ mfaRequired: true, challenge: createChallenge(db, row.id) });
    const token = createSession(db, row.id, deviceOf(req));
    setSessionCookie(res, token);
    audit(db, { clientId: null, userId: row.id, entity: "auth", action: "login", summary: `${row.email} signed in` });
    res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role, mfaSetupRequired: mfaRequiredButMissing(db, row) } });
  }));
  app.post("/api/auth/mfa/verify", wrap(async (req, res) => {
    const { challenge, code } = (req.body ?? {}) as { challenge?: string; code?: string };
    if (!loginThrottle(db, `mfa:${req.ip}`)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const out = completeChallenge(db, String(challenge ?? ""), String(code ?? ""), deviceOf(req));
    setSessionCookie(res, out.session);
    res.json({ user: { ...out.user, mfaSetupRequired: false } });
  }));
  // Reset by email. The answer never says whether the address has an account.
  app.post("/api/auth/forgot", wrap(async (req, res) => {
    const email = String((req.body as { email?: unknown } | undefined)?.email ?? "");
    if (!loginThrottle(db, `forgot:${req.ip}`)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    // The link's host must not come from the request (a forged Host header would send the token to an attacker); production needs PUBLIC_URL.
    const baseUrl = baseUrlOf(req);
    if (baseUrl && email.includes("@")) await requestReset(db, email, mailer, baseUrl).catch((e) => console.error("reset email failed:", e instanceof Error ? e.message : e));
    else if (!baseUrl) console.error("Password reset requested but PUBLIC_URL is not set; no email sent.");
    res.json({ ok: true, message: "If that address has an account, a reset link is on its way. It works for 30 minutes." });
  }));
  app.post("/api/auth/reset", wrap(async (req, res) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    if (!loginThrottle(db, `reset:${req.ip}`)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    resetPassword(db, String(token ?? ""), password as string);
    res.json({ ok: true });
  }));
  app.post("/api/auth/logout", (req, res) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) destroySession(db, t);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/auth/me", (req, res) => res.json({ user: req.user ? { ...req.user, mfaSetupRequired: mfaRequiredButMissing(db, req.user) } : null }));
  app.post("/api/auth/verify-email", wrap(async (req, res) => {
    if (!loginThrottle(db, `verify:${req.ip}`)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    confirmEmail(db, String((req.body as { token?: unknown } | undefined)?.token ?? ""));
    res.json({ ok: true });
  }));

  // everything below needs a session
  app.use("/api", requireAuth);
  // Optional policy: advisors must turn on two-factor before using anything but their account settings.
  app.use("/api", (req, _res, next) => {
    if (req.user && !/^\/(account|auth)\//.test(req.path) && mfaRequiredButMissing(db, req.user)) return next(new HttpError(403, "Advisors must turn on two-factor sign-in before continuing. Open Account security.", [{ field: "code", message: "mfa_required" }]));
    next();
  });
  const W = requireWrite;
  // Account security: every signed-in user, including read-only viewers, manages their own sign-in.
  const tokenOf = (req: Request) => parseCookies(req.headers.cookie)[COOKIE] ?? "";
  app.get("/api/account/security", (req, res) => res.json({ ...mfaStatus(db, req.user!.id), email: req.user!.email, emailVerified: isVerified(db, req.user!.id), mfaPolicy: process.env.REQUIRE_MFA_FOR_ADMINS === "1" && req.user!.role === "admin" }));
  app.get("/api/account/sessions", (req, res) => res.json({ sessions: listSessions(db, req.user!.id, tokenOf(req)) }));
  app.post("/api/account/sessions/revoke-others", wrap((req, res) => res.json({ revoked: revokeOtherSessions(db, req.user!.id, tokenOf(req)) })));
  app.delete("/api/account/sessions/:sid", wrap((req, res) => { revokeSession(db, req.user!.id, String(req.params.sid)); res.json({ ok: true }); }));
  app.post("/api/account/email/verify-request", wrap(async (req, res) => {
    const base = baseUrlOf(req);
    if (!base) throw new HttpError(503, "PUBLIC_URL is not set, so no confirmation link can be sent.");
    await requestEmailVerification(db, req.user!.id, mailer, base);
    res.json({ ok: true });
  }));
  app.post("/api/account/mfa/setup", wrap((req, res) => res.json(startEnrolment(db, req.user!.id))));
  app.post("/api/account/mfa/enable", wrap((req, res) => res.json({ recoveryCodes: enableMfa(db, req.user!.id, String((req.body as { code?: unknown } | undefined)?.code ?? "")), ...mfaStatus(db, req.user!.id) })));
  app.post("/api/account/mfa/disable", wrap((req, res) => { const b = (req.body ?? {}) as { password?: string; code?: string }; disableMfa(db, req.user!.id, String(b.password ?? ""), String(b.code ?? "")); res.json(mfaStatus(db, req.user!.id)); }));
  app.post("/api/account/password", wrap((req, res) => { const b = (req.body ?? {}) as { current?: string; next?: string }; changePassword(db, req.user!.id, String(b.current ?? ""), b.next as string, parseCookies(req.headers.cookie)[COOKIE]); res.json({ ok: true }); }));
  // Tenant isolation, enforced in ONE place: every route with a :cid runs this first, so a new client-scoped route cannot forget it.
  // A client that belongs to another tenant answers exactly like one that does not exist, so ids cannot be probed.
  app.param("cid", (req, _res, next, cid) => {
    const row = db.prepare("SELECT tenant_id FROM clients WHERE id = ?").get(String(cid)) as { tenant_id: string } | undefined;
    if (!req.user || !row || row.tenant_id !== req.user.tenantId) return next(new HttpError(404, "Client not found."));
    next();
  });
  // Shared reference data and the demo fixtures belong to the platform operator (the default tenant).
  const operatorOnly = (req: Request, _res: Response, next: NextFunction) => next(req.user?.tenantId === DEFAULT_TENANT ? undefined : new HttpError(403, "Only the platform operator can do this."));

  // ---- advisor task queue (organisation-wide, not under :cid; each handler scopes to the caller's tenant) ------
  app.get("/api/tasks", wrap((req, res) => res.json({ tasks: listTasks(db, req.user!, { status: req.query.status as string, assignee: req.query.assignee as string, clientId: req.query.client as string, alertId: req.query.alert as string }), counts: taskCounts(db, req.user!), assignees: listAssignees(db, req.user!) })));
  app.get("/api/tasks/assignees", (req, res) => res.json({ assignees: listAssignees(db, req.user!) }));
  app.post("/api/tasks", W, wrap((req, res) => res.status(201).json(createTask(db, req.user!, req.body))));
  app.patch("/api/tasks/:id", W, wrap((req, res) => res.json(updateTask(db, req.user!, String(req.params.id), req.body))));
  app.delete("/api/tasks/:id", W, wrap((req, res) => { deleteTask(db, req.user!, String(req.params.id)); res.json({ ok: true }); }));

  // ---- clients --------------------------------------------------------------------------------
  app.get("/api/clients", (req, res) => {
    const rows = db.prepare("SELECT id, name, kind, description, is_demo FROM clients WHERE tenant_id = ? ORDER BY (kind='live') DESC, rowid").all(req.user!.tenantId) as any[];
    res.json({ clients: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, description: r.description, isDemo: r.is_demo === 1 })) });
  });
  app.post("/api/clients", W, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2 || name.length > 80) throw new HttpError(422, "Enter a client name (2–80 characters).");
    const id = uid("client");
    tx(db, () => {
      db.prepare("INSERT INTO clients (id, name, kind, description, is_demo, created_at, tenant_id) VALUES (?,?,?,?,0,?,?)").run(id, name, "live", "Blank client created in the app.", nowISO(), req.user!.tenantId);
      db.prepare("INSERT INTO client_settings (client_id, json, updated_at) VALUES (?,?,?)").run(id, JSON.stringify(defaultSettings("live")), nowISO());
      for (const r of defaultRules()) db.prepare("INSERT INTO rules (client_id, key, enabled, value, unit, severity, params) VALUES (?,?,?,?,?,?,?)").run(id, r.key, r.enabled ? 1 : 0, r.value, r.unit, r.severity, JSON.stringify(r.params));
      audit(db, { clientId: id, userId: req.user!.id, entity: "clients", entityId: id, action: "create", summary: `Created client "${name}"` });
    });
    refresh(db, id); // state reads no longer reconcile, so seed the alert history now
    res.status(201).json({ id });
  }));

  app.get("/api/overview", (req, res) => res.json(buildOverview(db, req.user!.tenantId)));

  app.get("/api/clients/:cid/state", wrap((req, res) => {
    const s = buildState(db, param(req, "cid"));
    res.json({ ...s, audit: recentAudit(db, param(req, "cid")), user: req.user });
  }));

  // ---- generic entities -----------------------------------------------------------------------
  for (const entity of Object.keys(ENTITY_SCHEMAS) as Array<keyof typeof ENTITY_SCHEMAS>) {
    app.post(`/api/clients/:cid/${entity}`, W, wrap((req, res) => withIdem(req, res, () => {
      const item = createEntity(db, param(req, "cid"), entity, req.body, req.user);
      refresh(db, param(req, "cid"));
      return { status: 201, body: { item } };
    })));
    app.patch(`/api/clients/:cid/${entity}/:id`, W, wrap((req, res) => {
      const item = updateEntity(db, param(req, "cid"), entity, param(req, "id"), req.body ?? {}, req.user);
      refresh(db, param(req, "cid"));
      res.json({ item });
    }));
    app.delete(`/api/clients/:cid/${entity}/:id`, W, wrap((req, res) => {
      removeEntity(db, param(req, "cid"), entity, param(req, "id"), req.user);
      refresh(db, param(req, "cid"));
      res.json({ ok: true });
    }));
    app.post(`/api/clients/:cid/${entity}/:id/restore`, W, wrap((req, res) => {
      restoreEntity(db, param(req, "cid"), entity, param(req, "id"), req.user);
      refresh(db, param(req, "cid"));
      res.json({ ok: true });
    }));
  }
  app.get("/api/clients/:cid/archived/:entity", wrap((req, res) => {
    const e = param(req, "entity") as keyof typeof ENTITY_SCHEMAS;
    if (!(e in ENTITY_SCHEMAS) || e === "transactions") throw new HttpError(404, "Unknown entity.");
    const all = listAll<any>(db, e as any, param(req, "cid"), { includeArchived: true }).filter((x) => x.archived);
    res.json({ items: all });
  }));
  app.post("/api/clients/:cid/holdings/:id/override", W, wrap((req, res) => {
    const item = overrideClassification(db, param(req, "cid"), param(req, "id"), req.body?.assetClass ?? null, req.user);
    refresh(db, param(req, "cid"));
    res.json({ item });
  }));
  app.post("/api/clients/:cid/holdings/:id/reconcile", W, wrap((req, res) => {
    const total = reconcileAggregate(db, param(req, "cid"), param(req, "id"), req.user);
    refresh(db, param(req, "cid"));
    res.json({ total });
  }));
  app.post("/api/clients/:cid/reclassify", W, wrap((req, res) => {
    const changed = reclassifyAll(db, param(req, "cid"), req.user);
    refresh(db, param(req, "cid"));
    res.json({ changed });
  }));
  app.post("/api/clients/:cid/classify/preview", wrap((req, res) => res.json(classifyPreview(db, param(req, "cid"), req.body))));

  app.post("/api/clients/:cid/snapshots", W, wrap((req, res) => {
    const date = req.body?.date; if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(422, "Invalid date.");
    const b = req.body ?? {};
    const snap = recordSnapshot(db, param(req, "cid"), { date, note: b.note ?? null, grossAssets: b.grossAssets, liabilities: b.liabilities, liabilitiesComplete: b.liabilitiesComplete }, req.user);
    refresh(db, param(req, "cid"));
    res.status(201).json({ item: snap });
  }));
  app.delete("/api/clients/:cid/snapshots/:id", W, wrap((req, res) => { removeEntity(db, param(req, "cid"), "snapshots", param(req, "id"), req.user); refresh(db, param(req, "cid")); res.json({ ok: true }); }));

  app.patch("/api/clients/:cid/settings", W, wrap((req, res) => { const s = patchSettings(db, param(req, "cid"), req.body, req.user); refresh(db, param(req, "cid")); res.json({ settings: s }); }));
  app.put("/api/clients/:cid/rules/:key", W, wrap((req, res) => { const r = updateRule(db, param(req, "cid"), param(req, "key"), req.body, req.user); refresh(db, param(req, "cid")); res.json({ rule: r }); }));
  app.put("/api/clients/:cid/targets", W, wrap((req, res) => { const t = setTargets(db, param(req, "cid"), req.body, req.user); refresh(db, param(req, "cid")); res.json({ targets: t }); }));

  // alerts
  app.post("/api/clients/:cid/alerts/:id/ack", W, wrap((req, res) => {
    const r = db.prepare("UPDATE alerts SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND client_id=? AND status='open'").run(nowISO(), req.user!.name, param(req, "id"), param(req, "cid"));
    if (!r.changes) throw new HttpError(409, "Alert is not open.");
    db.prepare("INSERT INTO alert_events (id, alert_id, at, event, detail) VALUES (?,?,?,?,?)").run(uid("ae"), param(req, "id"), nowISO(), "acknowledged", req.user!.name);
    res.json({ ok: true });
  }));
  app.post("/api/clients/:cid/alerts/:id/unack", W, wrap((req, res) => {
    const r = db.prepare("UPDATE alerts SET status='open', acknowledged_at=NULL, acknowledged_by=NULL WHERE id=? AND client_id=? AND status='acknowledged'").run(param(req, "id"), param(req, "cid"));
    if (!r.changes) throw new HttpError(409, "Alert is not acknowledged.");
    db.prepare("INSERT INTO alert_events (id, alert_id, at, event, detail) VALUES (?,?,?,?,?)").run(uid("ae"), param(req, "id"), nowISO(), "reopened", req.user!.name);
    res.json({ ok: true });
  }));


  // risk profile
  app.get("/api/clients/:cid/risk-profile", wrap((req, res) => res.json({ assessments: listAssessments(db, param(req, "cid")) })));
  app.post("/api/clients/:cid/risk-profile", W, wrap((req, res) => res.status(201).json({ assessment: recordAssessment(db, param(req, "cid"), req.body, req.user) })));
  app.post("/api/clients/:cid/risk-profile/apply", W, wrap((req, res) => {
    const r = applyProfileTargets(db, param(req, "cid"), req.user);
    refresh(db, param(req, "cid"));
    res.json(r);
  }));

  // nominees and nominations
  app.get("/api/clients/:cid/estate", wrap((req, res) => res.json(loadEstate(db, param(req, "cid")))));
  app.post("/api/clients/:cid/nominees", W, wrap((req, res) => { const nominee = addNominee(db, param(req, "cid"), req.body, req.user); refresh(db, param(req, "cid")); res.status(201).json({ nominee }); }));
  app.patch("/api/clients/:cid/nominees/:id", W, wrap((req, res) => { const nominee = updateNominee(db, param(req, "cid"), param(req, "id"), req.body ?? {}, req.user); refresh(db, param(req, "cid")); res.json({ nominee }); }));
  app.delete("/api/clients/:cid/nominees/:id", W, wrap((req, res) => { removeNominee(db, param(req, "cid"), param(req, "id"), req.user); refresh(db, param(req, "cid")); res.json({ ok: true }); }));
  app.put("/api/clients/:cid/nominations", W, wrap((req, res) => { setNomination(db, param(req, "cid"), req.body, req.user); refresh(db, param(req, "cid")); res.json(loadEstate(db, param(req, "cid"))); }));

  // email notifications (preferences are per user, so a read-only viewer may manage their own)
  app.get("/api/notifications", wrap((req, res) => res.json({
    prefs: getPrefs(db, req.user!.id), mode: mailer.mode, email: req.user!.email, log: recentNotifications(db, 25, req.user!.tenantId), outbox: mailer.mode === "outbox" ? outboxFor(db, req.user!.email) : [],
  })));
  app.put("/api/notifications/prefs", wrap((req, res) => {
    const b = req.body ?? {};
    if (typeof b.emailEnabled !== "boolean" || !SEVERITY_ORDER.includes(b.minSeverity)) throw new HttpError(422, "Choose whether to receive email and the lowest severity.");
    const prefs = setPrefs(db, req.user!.id, { emailEnabled: b.emailEnabled, minSeverity: b.minSeverity });
    audit(db, { clientId: null, userId: req.user!.id, entity: "notifications", action: "update", summary: `Email alerts ${prefs.emailEnabled ? `on (${prefs.minSeverity} and above)` : "off"} for ${req.user!.email}` });
    res.json({ prefs });
  }));
  app.post("/api/notifications/dispatch", W, wrap(async (_req, res) => res.json(await dispatchNotifications(db, mailer))));

  // scenarios
  app.post("/api/clients/:cid/scenario/evaluate", wrap((req, res) => {
    const p = tradesIn.safeParse(req.body?.trades ?? []);
    if (!p.success) throw new HttpError(422, p.error.issues[0]?.message ?? "Invalid trades.");
    res.json(runScenario(db, param(req, "cid"), p.data));
  }));
  app.get("/api/clients/:cid/scenarios", wrap((req, res) => {
    const rows = db.prepare("SELECT id, name, trades, created_at, created_by FROM scenarios WHERE client_id = ? ORDER BY created_at DESC").all(param(req, "cid")) as any[];
    res.json({ scenarios: rows.map((r) => ({ id: r.id, name: r.name, trades: JSON.parse(r.trades), createdAt: r.created_at })) });
  }));
  app.post("/api/clients/:cid/scenarios", W, wrap((req, res) => {
    const p = tradesIn.safeParse(req.body?.trades ?? []);
    const name = String(req.body?.name ?? "").trim();
    if (!p.success || !p.data.length) throw new HttpError(422, "Add at least one trade.");
    if (!name) throw new HttpError(422, "Name the scenario.");
    const id = uid("scn");
    db.prepare("INSERT INTO scenarios (id, client_id, name, trades, created_by, created_at) VALUES (?,?,?,?,?,?)").run(id, param(req, "cid"), name, JSON.stringify(p.data), req.user!.id, nowISO());
    audit(db, { clientId: param(req, "cid"), userId: req.user!.id, entity: "scenarios", entityId: id, action: "create", summary: `Saved rebalancing scenario "${name}" (not executed)` });
    res.status(201).json({ id });
  }));
  app.delete("/api/clients/:cid/scenarios/:id", W, wrap((req, res) => { db.prepare("DELETE FROM scenarios WHERE id = ? AND client_id = ?").run(param(req, "id"), param(req, "cid")); res.json({ ok: true }); }));

  // mappings
  app.post("/api/clients/:cid/mappings", W, wrap((req, res) => {
    const b = req.body ?? {};
    if (!["asset", "cashflow"].includes(b.domain) || !["exact", "keyword"].includes(b.matchType) || !String(b.pattern ?? "").trim() || !String(b.category ?? "").trim()) throw new HttpError(422, "Provide domain, matchType, pattern and category.");
    const id = uid("map");
    db.prepare("INSERT INTO category_mappings (id, client_id, domain, match_type, pattern, category, priority, source) VALUES (?,?,?,?,?,?,?,'user')").run(id, param(req, "cid"), b.domain, b.matchType, String(b.pattern).trim().slice(0, 80), b.category, 200);
    audit(db, { clientId: param(req, "cid"), userId: req.user!.id, entity: "mappings", entityId: id, action: "create", summary: `Added ${b.matchType} mapping "${b.pattern}" → ${b.category}` });
    res.status(201).json({ id });
  }));
  app.delete("/api/clients/:cid/mappings/:id", W, wrap((req, res) => { db.prepare("DELETE FROM category_mappings WHERE id = ? AND client_id = ?").run(param(req, "id"), param(req, "cid")); res.json({ ok: true }); }));

  // ---- exports / imports ----------------------------------------------------------------------
  app.get("/api/clients/:cid/export/:what", wrap(async (req, res) => {
    const cid = param(req, "cid");
    const data = requireClient(db, cid);
    const ev = evaluateClient(data, asOfDate());
    const alerts = listAlerts(db, cid);
    const safe = data.client.name.replace(/[^a-z0-9]+/gi, "_");
    const what = param(req, "what");
    if (what === "workbook.xlsx") {
      const buf = await buildWorkbook(data, ev, alerts);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safe}_wealth_report.xlsx"`);
      return void res.send(buf);
    }
    const m = /^(.+)\.csv$/.exec(what);
    const tables = buildTables(data, ev, alerts);
    const t = m && tables.find((x) => x.name.toLowerCase().replace(/ /g, "-") === m[1]);
    if (!t) throw new HttpError(404, "Unknown export.");
    audit(db, { clientId: cid, userId: req.user!.id, entity: "export", action: "export", summary: `Exported ${t.name} as CSV` });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}_${t.name.toLowerCase().replace(/ /g, "-")}.csv"`);
    res.send(toCSV(t));
  }));
  app.get("/api/clients/:cid/report", wrap((req, res) => {
    const cid = param(req, "cid");
    const data = requireClient(db, cid);
    const ev = evaluateClient(data, asOfDate());
    res.json({ summary: summaryLines(data, ev), tables: buildTables(data, ev, listAlerts(db, cid)).map((t) => ({ name: t.name, headers: t.headers, rows: t.rows })) });
  }));
  app.get("/api/import/template/:kind", (req, res) => {
    const k = param(req, "kind") as ImportKind;
    if (!TEMPLATES[k]) throw new HttpError(404, "Unknown template.");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${k}_template.csv"`);
    res.send(TEMPLATES[k]);
  });
  app.post("/api/clients/:cid/import/:kind", W, wrap(async (req, res) => {
    const kind = param(req, "kind") as ImportKind;
    if (!TEMPLATES[kind]) throw new HttpError(404, "Unknown import kind.");
    const isXlsx = Buffer.isBuffer(req.body);
    if (!isXlsx && typeof req.body !== "string") throw new HttpError(415, "Send the file as text/csv or an .xlsx binary body.");
    const report = await runImport(db, param(req, "cid"), kind, isXlsx ? { buffer: req.body } : { text: req.body },
      { dryRun: req.query.dryRun === "1", filename: typeof req.query.filename === "string" ? req.query.filename.slice(0, 120) : null, force: req.query.force === "1" }, req.user);
    if (!report.dryRun) refresh(db, param(req, "cid"));
    res.json(report);
  }));

  // ---- market data ----------------------------------------------------------------------------
  app.get("/api/market/status", (_req, res) => res.json(marketStatus(db)));
  app.post("/api/market/refresh", W, operatorOnly, wrap(async (req, res) => {
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map(String).slice(0, 200) : [];
    res.json(await refreshProvider(db, String(req.body?.provider ?? "demo"), symbols));
  }));
  app.post("/api/market/manual", W, operatorOnly, wrap((req, res) => {
    if (typeof req.body !== "string") throw new HttpError(415, "Send CSV as text/csv.");
    let obs: ReturnType<typeof parseManualCsv>; try { obs = parseManualCsv(req.body); } catch (e: any) { throw new HttpError(422, e.message); }
    res.json(storeObservations(db, obs));
  }));
  app.get("/api/clients/:cid/market/proposals", wrap((req, res) => res.json({ proposals: proposeValuations(db, param(req, "cid"), req.query.includeManual === "1") })));
  app.post("/api/clients/:cid/market/apply", W, wrap((req, res) => {
    const ids: string[] = Array.isArray(req.body?.holdingIds) ? req.body.holdingIds : [];
    const props = proposeValuations(db, param(req, "cid"), !!req.body?.includeManual).filter((p) => ids.includes(p.holdingId) && p.newValue != null);
    let applied = 0;
    tx(db, () => {
      for (const p of props) {
        db.prepare("UPDATE holdings SET current_value = ?, valuation_date = ?, valuation_source = 'market', updated_at = ? WHERE id = ? AND client_id = ?").run(p.newValue, p.priceAsOf, nowISO(), p.holdingId, param(req, "cid"));
        insertRow(db, "valuations", { id: uid("val"), holdingId: p.holdingId, clientId: param(req, "cid"), date: p.priceAsOf, value: p.newValue, source: "market", note: `${p.quantity} × ${p.price}${p.fx ? ` × FX ${p.fx}` : ""}` });
        applied++;
      }
      audit(db, { clientId: param(req, "cid"), userId: req.user!.id, entity: "valuations", action: "market_apply", summary: `Applied ${applied} market valuation(s) (user-confirmed)` });
    });
    refresh(db, param(req, "cid"));
    res.json({ applied });
  }));

  // ---- demo -----------------------------------------------------------------------------------
  app.post("/api/demo/reset", W, operatorOnly, wrap((req, res) => {
    const ids = resetDemo(db, req.body?.clientId);
    for (const id of ids) refresh(db, id);
    audit(db, { clientId: null, userId: req.user!.id, entity: "demo", action: "reset", summary: `Demo data reset for ${ids.join(", ")}` });
    res.json({ reset: ids });
  }));
  // API reference generated from the live route table and the zod schemas, so it cannot drift from the code
  const apiRoutes = (): RouteInfo[] => (((app as any).router ?? (app as any)._router).stack as any[])
    .filter((l) => l.route && typeof l.route.path === "string" && l.route.path.startsWith("/api")).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path as string })));
  app.get("/api/docs/openapi.json", (_req, res) => res.json(buildOpenApi(apiRoutes(), "1.0.0")));
  app.get("/api/docs", (_req, res) => res.type("html").send(renderDocsHtml(buildOpenApi(apiRoutes(), "1.0.0"))));
  app.get("/api/meta", (_req, res) => res.json({ asOf: asOfDate(), migrations: fs.readdirSync(MIGRATIONS_DIR).length, version: "1.0.0" }));

  // ---- static SPA -----------------------------------------------------------------------------
  const dist = path.join(ROOT, "dist", "web");
  if (fs.existsSync(dist)) {
    // the service worker and manifest must always be revalidated so a new release reaches installed copies
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (r, f) => { if (/(sw\.js|manifest\.webmanifest)$/.test(f)) r.setHeader("Cache-Control", "no-cache"); else if (/[\\/]assets[\\/]/.test(f)) r.setHeader("Cache-Control", "public, max-age=31536000, immutable"); /* file names carry a content hash */ } }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Malformed JSON." });
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "Payload too large." });
    const rid = res.getHeader("X-Request-Id");
    console.error(JSON.stringify({ t: nowISO(), id: rid, level: "error", path: req.path, message: String(err?.message ?? err).slice(0, 300) }));
    res.status(500).json({ error: "Something went wrong. Please try again.", requestId: rid });
  });
  return app;
}
