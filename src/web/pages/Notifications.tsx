import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, Card, Empty, Field, PageHead, SEV_LABEL, fmtDateTime } from "../ui";

type Sev = "info" | "warning" | "high" | "critical";
interface Data {
  prefs: { emailEnabled: boolean; minSeverity: Sev }; mode: "smtp" | "outbox"; email: string;
  log: Array<{ id: string; severity: Sev; status: "pending" | "sent" | "skipped" | "failed"; note: string | null; createdAt: string; subject: string; ruleName: string; clientName: string; delivered: number }>;
  outbox: Array<{ id: string; subject: string; text: string; createdAt: string }>;
}
const SEVS: Sev[] = ["critical", "high", "warning", "info"];
const STATUS_TONE = { pending: "info", sent: "good", skipped: "", failed: "crit" } as const;

export function NotificationsPage() {
  const { canWrite, toast } = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [form, setForm] = useState<Data["prefs"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.get<Data>("/api/notifications").then((r) => { setD(r); setForm(r.prefs); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <Banner tone="crit">{err}</Banner>;
  if (!d || !form) return null;
  const dirty = form.emailEnabled !== d.prefs.emailEnabled || form.minSeverity !== d.prefs.minSeverity;

  async function save() {
    try { await api.put("/api/notifications/prefs", form); toast("Notification settings saved"); load(); } catch (e) { toast(e instanceof ApiError ? e.message : "Failed", "err"); }
  }
  async function sendNow() {
    try { const r = await api.post("/api/notifications/dispatch"); toast(r.emails ? `${r.emails} email(s) ${d!.mode === "smtp" ? "sent" : "saved to the outbox"}` : "Nothing to send"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  return (
    <>
      <PageHead title="Notifications" subtitle="Get an email when a new alert appears. One digest per client, never one email per alert, and nothing for alerts you have already handled." />
      <div className="stack">
        {d.mode === "outbox"
          ? <Banner tone="warn" title="No mail server is connected.">Emails are written to a local outbox below instead of being sent. To send real email, start the server with <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>MAIL_FROM</code> set (see <code>.env.example</code>).</Banner>
          : <Banner tone="info" title="Mail server connected.">Alerts are emailed to <b>{d.email}</b>.</Banner>}
        <Card title="Your email alerts" subtitle={`Settings apply to ${d.email} only.`}>
          <div className="form-grid">
            <Field label="Email me about new alerts"><label className="check"><input type="checkbox" checked={form.emailEnabled} onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })} />Send email alerts</label></Field>
            <Field label="Lowest severity to email" hint="Critical is the quietest setting. Notice includes data-gap reminders."><select value={form.minSeverity} disabled={!form.emailEnabled} onChange={(e) => setForm({ ...form, minSeverity: e.target.value as Sev })}>{SEVS.map((s) => <option key={s} value={s}>{SEV_LABEL[s]} and above</option>)}</select></Field>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={!dirty} onClick={save}>Save</button>{dirty && <button className="btn" onClick={() => setForm(d.prefs)}>Discard</button>}
            {canWrite && <button className="btn" style={{ marginLeft: "auto" }} onClick={sendNow}>Send pending now</button>}</div>
          <p className="small muted" style={{ marginTop: 8 }}>Emails name the rule and the record only. Figures and explanations stay in the app because email is not a private channel. The administrator can include them with <code>NOTIFY_INCLUDE_DETAILS=1</code>.</p>
        </Card>

        <Card title="Recent notifications" subtitle="Every new alert is queued, then sent in the background about once a minute." pad={false}>
          <div className="card-b">{d.log.length === 0 ? <Empty title="Nothing queued yet" /> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Queued</th><th>Client</th><th>Alert</th><th>Severity</th><th>Status</th><th className="r">Emails</th></tr></thead>
              <tbody>{d.log.map((n) => <tr key={n.id}><td className="nowrap">{fmtDateTime(n.createdAt)}</td><td>{n.clientName}</td><td>{n.ruleName}{n.subject ? ` (${n.subject})` : ""}</td><td>{SEV_LABEL[n.severity]}</td>
                <td><Badge tone={STATUS_TONE[n.status]} title={n.note ?? undefined}>{n.status}</Badge>{n.note && <span className="small muted"> {n.note}</span>}</td><td className="r num">{n.delivered}</td></tr>)}</tbody></table></div>)}</div>
        </Card>

        {d.mode === "outbox" && (
          <Card title="Outbox (emails that would have been sent to you)" subtitle="Stored on this machine only.">
            {d.outbox.length === 0 ? <Empty title="No messages yet">Turn on email alerts above, then wait for the next alert or press “Send pending now”.</Empty> : (
              <div className="stack">{d.outbox.map((m) => <details key={m.id}><summary><b>{m.subject}</b> <span className="muted small">· {fmtDateTime(m.createdAt)}</span></summary><pre className="code" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{m.text}</pre></details>)}</div>)}
          </Card>)}
      </div>
    </>
  );
}
