import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};
const param = (req: Request, k: string): string => String(req.params[k] ?? "");

export function createApp(db: DB) {
  const app = express();
  app.disable("x-powered-by");
  const prod = process.env.NODE_ENV === "production";

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

  // idempotency (duplicate-submit protection) for create endpoints
  const idem = new Map<string, { at: number; status: number; body: unknown }>();
  const withIdem = (req: Request, res: Response, fn: () => { status: number; body: unknown }) => {
    const k = req.header("Idempotency-Key");
    const key = k && req.user ? `${req.user.id}:${req.method}:${req.path}:${k}` : null;
    if (key) {
      for (const [kk, v] of idem) if (Date.now() - v.at > 10 * 60_000) idem.delete(kk);
      const hit = idem.get(key);
      if (hit) { res.setHeader("Idempotent-Replay", "true"); return void res.status(hit.status).json(hit.body); }
    }
    const r = fn();
    if (key) idem.set(key, { at: Date.now(), ...r });
    res.status(r.status).json(r.body);
  };

  // ---- public ---------------------------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    const m = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    res.json({ ok: true, time: nowISO(), migrations: m.n });
  });
  app.post("/api/auth/login", wrap(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const key = `${req.ip}:${String(email ?? "").toLowerCase()}`;
    if (!loginThrottle(key)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email ?? "").toLowerCase()) as any;
    // verify even when the user is unknown so timing does not reveal which emails exist
    const ok = row ? verifyPassword(String(password ?? ""), row.password_hash) : (verifyPassword("x", "scrypt$00$00"), false);
    if (!row || !ok) throw new HttpError(401, "Incorrect email or password.");
    loginSucceeded(key);
    const token = createSession(db, row.id);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: prod, maxAge: 12 * 3600_000, path: "/" });
    audit(db, { clientId: null, userId: row.id, entity: "auth", action: "login", summary: `${row.email} signed in` });
    res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role } });
  }));
  app.post("/api/auth/logout", (req, res) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) destroySession(db, t);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/auth/me", (req, res) => res.json({ user: req.user ?? null }));

  // everything below needs a session
  app.use("/api", requireAuth);
  const W = requireWrite;

  // ---- clients --------------------------------------------------------------------------------
  app.get("/api/clients", (_req, res) => {
    const rows = db.prepare("SELECT id, name, kind, description, is_demo FROM clients ORDER BY (kind='live') DESC, rowid").all() as any[];
    res.json({ clients: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, description: r.description, isDemo: r.is_demo === 1 })) });
  });
  app.post("/api/clients", W, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2 || name.length > 80) throw new HttpError(422, "Enter a client name (2–80 characters).");
    const id = uid("client");
    tx(db, () => {
      db.prepare("INSERT INTO clients (id, name, kind, description, is_demo, created_at) VALUES (?,?,?,?,0,?)").run(id, name, "live", "Blank client created in the app.", nowISO());
      db.prepare("INSERT INTO client_settings (client_id, json, updated_at) VALUES (?,?,?)").run(id, JSON.stringify(defaultSettings("live")), nowISO());
      for (const r of defaultRules()) db.prepare("INSERT INTO rules (client_id, key, enabled, value, unit, severity, params) VALUES (?,?,?,?,?,?,?)").run(id, r.key, r.enabled ? 1 : 0, r.value, r.unit, r.severity, JSON.stringify(r.params));
      audit(db, { clientId: id, userId: req.user!.id, entity: "clients", entityId: id, action: "create", summary: `Created client "${name}"` });
    });
    res.status(201).json({ id });
  }));

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
  app.post("/api/market/refresh", W, wrap(async (req, res) => {
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map(String).slice(0, 200) : [];
    res.json(await refreshProvider(db, String(req.body?.provider ?? "demo"), symbols));
  }));
  app.post("/api/market/manual", W, wrap((req, res) => {
    if (typeof req.body !== "string") throw new HttpError(415, "Send CSV as text/csv.");
    let obs; try { obs = parseManualCsv(req.body); } catch (e: any) { throw new HttpError(422, e.message); }
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
  app.post("/api/demo/reset", W, wrap((req, res) => {
    const ids = resetDemo(db, req.body?.clientId);
    for (const id of ids) refresh(db, id);
    audit(db, { clientId: null, userId: req.user!.id, entity: "demo", action: "reset", summary: `Demo data reset for ${ids.join(", ")}` });
    res.json({ reset: ids });
  }));
  app.get("/api/meta", (_req, res) => res.json({ asOf: asOfDate(), migrations: fs.readdirSync(MIGRATIONS_DIR).length, version: "1.0.0" }));

  // ---- static SPA -----------------------------------------------------------------------------
  const dist = path.join(ROOT, "dist", "web");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
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
