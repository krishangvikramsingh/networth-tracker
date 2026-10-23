import type { DB } from "./db";
import { nowISO, uid } from "./db";
import { SEVERITY_ORDER } from "./alerts";
import { RULE_DEF_BY_KEY } from "../shared/rules";
import type { Severity } from "../shared/types";

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { mode: "smtp" | "outbox"; send(m: MailMessage): Promise<void> }
export const MAX_ATTEMPTS = 3;
const sevIdx = (s: string) => SEVERITY_ORDER.indexOf(s as Severity);

// ---- mailers ------------------------------------------------------------------------------------
/** No SMTP configured: keep the rendered message in the database so it can be inspected. Nothing leaves the machine. */
export function outboxMailer(db: DB): Mailer {
  return {
    mode: "outbox",
    async send(m) { db.prepare("INSERT INTO mail_outbox (id, to_email, subject, text_body, html_body, created_at) VALUES (?,?,?,?,?,?)").run(uid("mail"), m.to, m.subject, m.text, m.html, nowISO()); },
  };
}
/** Wraps any nodemailer-compatible transport (a stub in tests). */
export function smtpMailer(transport: { sendMail(o: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }, from: string): Mailer {
  return { mode: "smtp", async send(m) { await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html }); } };
}
export async function mailerFromEnv(db: DB, env: NodeJS.ProcessEnv = process.env): Promise<Mailer> {
  if (!env.SMTP_HOST) return outboxMailer(db);
  const nodemailer = await import("nodemailer");
  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "1" : port === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined });
  return smtpMailer(transport, env.MAIL_FROM || "Wealth Intelligence <no-reply@localhost>");
}

// ---- preferences --------------------------------------------------------------------------------
export interface Prefs { emailEnabled: boolean; minSeverity: Severity }
export function getPrefs(db: DB, userId: string): Prefs {
  const r = db.prepare("SELECT email_enabled, min_severity FROM notification_prefs WHERE user_id = ?").get(userId) as any;
  return r ? { emailEnabled: r.email_enabled === 1, minSeverity: r.min_severity } : { emailEnabled: false, minSeverity: "high" };
}
export function setPrefs(db: DB, userId: string, p: Prefs): Prefs {
  db.prepare(`INSERT INTO notification_prefs (user_id, email_enabled, min_severity, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email_enabled = excluded.email_enabled, min_severity = excluded.min_severity, updated_at = excluded.updated_at`).run(userId, p.emailEnabled ? 1 : 0, p.minSeverity, nowISO());
  return getPrefs(db, userId);
}

// ---- rendering ----------------------------------------------------------------------------------
export interface DigestItem { severity: Severity; escalated?: boolean; ruleName: string; subject: string; why: string; action: string; currentLabel: string; thresholdLabel: string }
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", warning: "Warning", info: "Notice" };

/**
 * Email is not a private channel, so by default a message names the rule and the record but carries no figures or advice text.
 * Set NOTIFY_INCLUDE_DETAILS=1 to add the explanation, the current value and the threshold.
 */
export function renderDigest(client: string, items: DigestItem[], baseUrl: string, details: boolean): { subject: string; text: string; html: string } {
  const worst = items.reduce((m, i) => (sevIdx(i.severity) > sevIdx(m) ? i.severity : m), items[0].severity);
  const allEsc = items.every((i) => i.escalated), noneEsc = items.every((i) => !i.escalated);
  const subject = items.length === 1 ? `[${SEV_LABEL[worst]}] ${items[0].escalated ? "Escalated: " : ""}${items[0].ruleName} - ${client}` : `[${SEV_LABEL[worst]}] ${items.length} ${allEsc ? "escalated alerts" : noneEsc ? "new alerts" : "new or escalated alerts"} - ${client}`;
  const link = `${baseUrl.replace(/\/$/, "")}/alerts`;
  const line = (i: DigestItem) => `${i.escalated ? "Escalated to " : ""}${SEV_LABEL[i.severity]}: ${i.ruleName}${i.subject ? ` (${i.subject})` : ""}`;
  const more = (i: DigestItem) => (details ? [`   ${i.currentLabel} against ${i.thresholdLabel}`, `   Why: ${i.why}`, `   Option to consider: ${i.action}`] : []);
  const foot = "Educational tool with synthetic data. Not investment, tax or legal advice. You can turn these emails off on the Notifications page.";
  const text = [`${noneEsc ? "New alerts" : "Alerts"} for ${client}:`, "", ...items.flatMap((i) => ["- " + line(i), ...more(i)]), "", `Review them: ${link}`, "", foot].join("\n");
  const html = `<p>${noneEsc ? "New alerts" : "Alerts"} for <b>${esc(client)}</b>:</p><ul>${items.map((i) => `<li><b>${i.escalated ? "Escalated to " : ""}${esc(SEV_LABEL[i.severity])}</b>: ${esc(i.ruleName)}${i.subject ? ` (${esc(i.subject)})` : ""}${details ? `<br><small>${esc(i.currentLabel)} against ${esc(i.thresholdLabel)}. ${esc(i.why)} Option to consider: ${esc(i.action)}</small>` : ""}</li>`).join("")}</ul><p><a href="${esc(link)}">Review alerts</a></p><p><small>${esc(foot)}</small></p>`;
  return { subject, text, html };
}

// ---- dispatch -----------------------------------------------------------------------------------
export interface DispatchResult { processed: number; sent: number; skipped: number; failed: number; emails: number }

/**
 * Send pending notifications. One digest per (recipient, client) per run. A failed send is retried on later runs until
 * MAX_ATTEMPTS, and a recipient who already received a message is never sent it again.
 */
export async function dispatchNotifications(db: DB, mailer: Mailer, opts: { baseUrl?: string; details?: boolean; now?: string } = {}): Promise<DispatchResult> {
  const now = opts.now ?? nowISO(), baseUrl = opts.baseUrl ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:8787", details = opts.details ?? process.env.NOTIFY_INCLUDE_DETAILS === "1";
  const out: DispatchResult = { processed: 0, sent: 0, skipped: 0, failed: 0, emails: 0 };
  const pending = db.prepare(`SELECT n.id, n.client_id, n.severity, n.reason, a.rule_key, a.subject, a.why, a.action, a.current_label, a.threshold_label, a.status AS alert_status, c.name AS client_name, c.tenant_id
    FROM notifications n JOIN alerts a ON a.id = n.alert_id JOIN clients c ON c.id = n.client_id WHERE n.status = 'pending' ORDER BY n.created_at, n.rowid`).all() as any[];
  if (!pending.length) return out;
  const finish = db.prepare("UPDATE notifications SET status = ?, note = ?, processed_at = ? WHERE id = ?");

  const live: any[] = [];
  for (const n of pending) {
    if (n.alert_status !== "open") { finish.run("skipped", n.alert_status === "resolved" ? "Condition cleared before sending." : "Already acknowledged before sending.", now, n.id); out.skipped++; out.processed++; }
    else live.push(n);
  }
  const users = db.prepare("SELECT u.id, u.email, u.tenant_id, p.min_severity FROM notification_prefs p JOIN users u ON u.id = p.user_id WHERE p.email_enabled = 1").all() as any[];
  const delivery = (nid: string, uidv: string) => db.prepare("SELECT status, attempts FROM notification_deliveries WHERE notification_id = ? AND user_id = ?").get(nid, uidv) as { status: string; attempts: number } | undefined;
  const settled = (d: ReturnType<typeof delivery>) => !!d && (d.status !== "failed" || d.attempts >= MAX_ATTEMPTS);
  const upsert = db.prepare(`INSERT INTO notification_deliveries (notification_id, user_id, status, attempts, error, at) VALUES (?,?,?,1,?,?)
    ON CONFLICT(notification_id, user_id) DO UPDATE SET status = excluded.status, attempts = notification_deliveries.attempts + 1, error = excluded.error, at = excluded.at`);

  for (const u of users) {
    for (const cid of new Set(live.map((n) => n.client_id))) {
      const items = live.filter((n) => n.client_id === cid && n.tenant_id === u.tenant_id && sevIdx(n.severity) >= sevIdx(u.min_severity) && !settled(delivery(n.id, u.id)));
      if (!items.length) continue;
      const msg = renderDigest(items[0].client_name, items.map((n) => ({ severity: n.severity, escalated: n.reason === "escalated", ruleName: RULE_DEF_BY_KEY[n.rule_key as keyof typeof RULE_DEF_BY_KEY]?.name ?? n.rule_key, subject: n.subject, why: n.why, action: n.action, currentLabel: n.current_label, thresholdLabel: n.threshold_label })), baseUrl, details);
      try {
        await mailer.send({ to: u.email, ...msg });
        for (const n of items) upsert.run(n.id, u.id, mailer.mode === "smtp" ? "sent" : "outbox", null, now);
        out.emails++;
      } catch (e) {
        const err = String((e as Error)?.message ?? e).slice(0, 200);
        for (const n of items) upsert.run(n.id, u.id, "failed", err, now);
      }
    }
  }

  for (const n of live) {
    const eligible = users.filter((u) => u.tenant_id === n.tenant_id && sevIdx(n.severity) >= sevIdx(u.min_severity));
    if (!eligible.length) { finish.run("skipped", "No recipient has email alerts on for this severity.", now, n.id); out.skipped++; out.processed++; continue; }
    const ds = eligible.map((u) => delivery(n.id, u.id));
    if (!ds.every(settled)) continue; // still retrying
    const delivered = ds.filter((d) => d && d.status !== "failed").length;
    if (delivered) { finish.run("sent", `${delivered} recipient(s).`, now, n.id); out.sent++; } else { finish.run("failed", "Every send attempt failed.", now, n.id); out.failed++; }
    out.processed++;
  }
  return out;
}

let running = false;
/** Poll for pending notifications. Overlapping runs are skipped; the timer never keeps the process alive. */
export function startDispatcher(db: DB, mailer: Mailer, everySeconds = Number(process.env.NOTIFY_INTERVAL_SECONDS ?? 60)): NodeJS.Timeout | null {
  if (!(everySeconds > 0)) return null;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try { await dispatchNotifications(db, mailer); } catch (e) { console.error(JSON.stringify({ t: nowISO(), level: "error", scope: "notify", message: String((e as Error)?.message ?? e).slice(0, 300) })); } finally { running = false; }
  }, everySeconds * 1000);
  t.unref();
  return t;
}

// ---- read models for the UI ---------------------------------------------------------------------
export function recentNotifications(db: DB, limit = 25, tenantId?: string) {
  return (db.prepare(`SELECT n.id, n.severity, n.status, n.note, n.created_at, n.processed_at, a.subject, a.rule_key, c.name AS client_name,
      (SELECT COUNT(*) FROM notification_deliveries d WHERE d.notification_id = n.id AND d.status != 'failed') AS delivered
    FROM notifications n JOIN alerts a ON a.id = n.alert_id JOIN clients c ON c.id = n.client_id WHERE (? IS NULL OR c.tenant_id = ?) ORDER BY n.created_at DESC, n.rowid DESC LIMIT ?`).all(tenantId ?? null, tenantId ?? null, limit) as any[])
    .map((r) => ({ id: r.id, severity: r.severity, status: r.status, note: r.note, createdAt: r.created_at, processedAt: r.processed_at, subject: r.subject, ruleName: RULE_DEF_BY_KEY[r.rule_key as keyof typeof RULE_DEF_BY_KEY]?.name ?? r.rule_key, clientName: r.client_name, delivered: r.delivered as number }));
}
export function outboxFor(db: DB, email: string, limit = 10) {
  return (db.prepare("SELECT id, subject, text_body, created_at FROM mail_outbox WHERE to_email = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(email, limit) as any[])
    .map((r) => ({ id: r.id, subject: r.subject, text: r.text_body, createdAt: r.created_at }));
}
