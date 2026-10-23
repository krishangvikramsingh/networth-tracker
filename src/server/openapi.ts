import { z } from "zod";
import { ENTITY_SCHEMAS, settingsPatch, ruleIn, targetsIn, tradesIn } from "./schemas";
import { nomineeIn, nominationIn } from "./estate";
import { RISK_QUESTIONS } from "../shared/riskprofile";

export interface RouteInfo { method: string; path: string }
type Json = Record<string, unknown>;

const js = (s: z.ZodType): Json => z.toJSONSchema(s, { unrepresentable: "any", io: "input" }) as Json;
const obj = (properties: Json, required: string[] = []): Json => ({ type: "object", properties, required });

/** Hand-written request bodies for routes that do not use a zod schema directly. */
const BODIES: Record<string, Json> = {
  "POST /api/auth/login": obj({ email: { type: "string" }, password: { type: "string" } }, ["email", "password"]),
  "POST /api/auth/mfa/verify": obj({ challenge: { type: "string", description: "From the login response when mfaRequired is true" }, code: { type: "string", description: "6-digit authenticator code, or an unused recovery code" } }, ["challenge", "code"]),
  "POST /api/auth/forgot": obj({ email: { type: "string" } }, ["email"]),
  "POST /api/auth/reset": obj({ token: { type: "string" }, password: { type: "string", minLength: 10 } }, ["token", "password"]),
  "POST /api/account/mfa/enable": obj({ code: { type: "string" } }, ["code"]),
  "POST /api/account/mfa/disable": obj({ password: { type: "string" }, code: { type: "string" } }, ["password", "code"]),
  "POST /api/account/password": obj({ current: { type: "string" }, next: { type: "string", minLength: 10 } }, ["current", "next"]),
  "POST /api/clients": obj({ name: { type: "string", minLength: 2, maxLength: 80 } }, ["name"]),
  "PUT /api/notifications/prefs": obj({ emailEnabled: { type: "boolean" }, minSeverity: { enum: ["info", "warning", "high", "critical"] } }, ["emailEnabled", "minSeverity"]),
  "POST /api/clients/{cid}/risk-profile": obj({ answers: { type: "object", description: "Question id to option index (0-3). Every question must be answered.", properties: Object.fromEntries(RISK_QUESTIONS.map((q) => [q.id, { type: "integer", minimum: 0, maximum: q.options.length - 1, description: q.text }])), required: RISK_QUESTIONS.map((q) => q.id) } }, ["answers"]),
  "POST /api/clients/{cid}/snapshots": obj({ date: { type: "string", format: "date" }, note: { type: "string" }, grossAssets: { type: "integer", description: "Paise. Omit to snapshot current figures." }, liabilities: { type: "integer" }, liabilitiesComplete: { type: "boolean" } }),
  "POST /api/clients/{cid}/mappings": obj({ domain: { enum: ["asset", "cashflow"] }, matchType: { enum: ["exact", "keyword"] }, pattern: { type: "string" }, category: { type: "string" } }, ["domain", "matchType", "pattern", "category"]),
  "POST /api/clients/{cid}/scenarios": obj({ name: { type: "string" }, trades: js(tradesIn) }, ["name", "trades"]),
  "POST /api/clients/{cid}/scenario/evaluate": obj({ trades: js(tradesIn) }, ["trades"]),
  "PUT /api/clients/{cid}/targets": js(targetsIn),
  "PATCH /api/clients/{cid}/settings": js(settingsPatch),
  "PUT /api/clients/{cid}/rules/{key}": js(ruleIn),
  "POST /api/clients/{cid}/nominees": js(nomineeIn),
  "PATCH /api/clients/{cid}/nominees/{id}": js(nomineeIn),
  "PUT /api/clients/{cid}/nominations": js(nominationIn),
  "POST /api/clients/{cid}/holdings/{id}/override": obj({ assetClass: { type: ["string", "null"] } }),
  "POST /api/clients/{cid}/market/apply": obj({ holdingIds: { type: "array", items: { type: "string" } }, includeManual: { type: "boolean" } }, ["holdingIds"]),
  "POST /api/demo/reset": obj({ clientId: { type: "string" } }),
  "POST /api/market/refresh": obj({ provider: { type: "string" }, symbols: { type: "array", items: { type: "string" } } }),
};
export const BODY_KEYS = (): string[] => Object.keys(BODIES);
for (const [name, schema] of Object.entries(ENTITY_SCHEMAS)) { BODIES[`POST /api/clients/{cid}/${name}`] = js(schema); BODIES[`PATCH /api/clients/{cid}/${name}/{id}`] = js(schema); }

const SUMMARY: Record<string, string> = {
  "GET /api/health": "Liveness and migration count (no sign-in needed)",
  "POST /api/auth/login": "Sign in; sets an HttpOnly session cookie. Throttled to 8 attempts per 15 minutes per address and email",
  "POST /api/auth/mfa/verify": "Second step of sign-in for users with two-factor on; sets the session cookie. Throttled; a challenge allows 5 wrong codes",
  "POST /api/auth/forgot": "Email a password-reset link (valid 30 minutes). Always answers the same, whether or not the address has an account",
  "POST /api/auth/reset": "Set a new password from an emailed token (single use). Signs the account out everywhere",
  "GET /api/account/security": "Whether two-factor is on and how many recovery codes remain",
  "POST /api/account/mfa/setup": "Start two-factor enrolment: returns the secret and an otpauth:// URI",
  "POST /api/account/mfa/enable": "Confirm enrolment with a code from the app; returns 8 single-use recovery codes (shown once)",
  "POST /api/account/mfa/disable": "Turn two-factor off (needs the password and a current code)",
  "POST /api/account/password": "Change your password (needs the current one); other sessions are signed out",
  "POST /api/auth/logout": "Sign out", "GET /api/auth/me": "Current user, or null",
  "GET /api/clients": "Clients in your organisation", "POST /api/clients": "Create a client",
  "GET /api/overview": "Portfolio-level summary of every client, plus an attention queue. Read-only",
  "GET /api/clients/{cid}/state": "Data, fresh evaluation and stored alert history for one client. Read-only: performs no database writes",
  "POST /api/clients/{cid}/risk-profile": "Score and store a completed risk questionnaire", "GET /api/clients/{cid}/risk-profile": "Risk assessment history",
  "POST /api/clients/{cid}/risk-profile/apply": "Replace the target allocation with the model portfolio for the latest profile",
  "GET /api/clients/{cid}/estate": "Nominees, nominations and coverage", "PUT /api/clients/{cid}/nominations": "Replace the nominee shares recorded for one asset (empty list clears it)",
  "GET /api/notifications": "Your email-alert preferences, recent notifications and (without SMTP) your outbox", "PUT /api/notifications/prefs": "Set your email-alert preferences",
  "POST /api/notifications/dispatch": "Send pending notifications now (administrators)",
  "POST /api/demo/reset": "Restore demo clients (platform operator only)", "POST /api/market/refresh": "Refresh market data (platform operator only)", "POST /api/market/manual": "Upload manual prices as CSV (platform operator only)",
  "GET /api/clients/{cid}/export/{what}": "Download a workbook or CSV; each CSV export is recorded in the audit trail",
};
const CRUD = (m: string, p: string) => {
  const mm = /^\/api\/clients\/\{cid\}\/(\w+)(\/\{id\}(\/restore)?)?$/.exec(p);
  if (!mm || !(mm[1] in ENTITY_SCHEMAS)) return null;
  const e = mm[1];
  if (m === "POST" && !mm[2]) return `Add to ${e}`; if (m === "PATCH") return `Update one of ${e}`; if (m === "DELETE") return `Archive (or delete, for transactions) one of ${e}`; if (m === "POST" && mm[3]) return `Restore an archived item of ${e}`;
  return null;
};

export function buildOpenApi(routes: RouteInfo[], version: string): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const r of routes) {
    const path = r.path.replace(/:(\w+)/g, "{$1}"), key = `${r.method} ${path}`, method = r.method.toLowerCase();
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const op: Json = {
      summary: SUMMARY[key] ?? CRUD(r.method, path) ?? key, tags: [path.split("/")[2] ?? "api"], parameters: params,
      responses: { "200": { description: "Success (JSON)" }, "401": { description: "Not signed in" }, "403": { description: "Read-only role, missing CSRF header, or operator-only route" }, "404": { description: "Not found. Also returned for a client in another organisation" }, "422": { description: "Validation failed: { error, details: [{ field, message }] }" } },
    };
    if (!/^\/api\/(health|auth\/(login|forgot|reset|mfa\/verify))/.test(path)) op.security = [{ session: [] }];
    if (BODIES[key]) op.requestBody = { required: true, content: { "application/json": { schema: BODIES[key] } } };
    paths[path] ??= {};
    paths[path][method] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: "Wealth Intelligence API", version, description: "Money is integer paise. Every non-GET request needs the header `X-Requested-With: networth` (CSRF defence) and a session cookie. GET requests never write (except CSV export's audit entry). Client routes are scoped to your organisation." },
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "nw_session" } } },
    paths,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Dependency-free page (the CSP forbids inline scripts and CDNs): endpoints grouped by area, request schemas in collapsible blocks. */
export function renderDocsHtml(spec: Json): string {
  const paths = spec.paths as Record<string, Record<string, any>>;
  const rows = Object.entries(paths).flatMap(([p, ms]) => Object.entries(ms).map(([m, op]) => ({ p, m: m.toUpperCase(), op })));
  const rowHtml = rows.map(({ p, m, op }) => `<tr><td><b>${m}</b></td><td><code>${esc(p)}</code></td><td>${esc(String(op.summary))}${op.requestBody ? `<details><summary>request body</summary><pre>${esc(JSON.stringify(op.requestBody.content["application/json"].schema, null, 1))}</pre></details>` : ""}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>API reference</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1100px;padding:0 16px;color:#1b1c1a}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:6px 8px;vertical-align:top}pre{background:#f2f2ee;padding:8px;overflow:auto;font-size:12px}code{font-size:12.5px}@media(prefers-color-scheme:dark){body{background:#111211;color:#e8e8e3}td{border-color:#33332f}pre{background:#232321}}</style></head><body><h1>${esc(String((spec.info as any).title))}</h1><p>${esc(String((spec.info as any).description))}</p><p>Machine-readable: <a href="/api/docs/openapi.json">openapi.json</a> (OpenAPI 3.1)</p><table>${rowHtml}</table></body></html>`;
}
