import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { Badge, Banner, PageHead, fmtDateTime } from "../ui";

/** The QR is drawn as SVG rects from the matrix (no innerHTML), in the page's own ink colour. */
function Qr({ text }: { text: string }) {
  const cells = useMemo(() => {
    const q = qrcode(0, "M"); q.addData(text); q.make();
    const n = q.getModuleCount(), out: Array<[number, number]> = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) out.push([c, r]);
    return { n, out };
  }, [text]);
  return (
    <svg className="qr" viewBox={`-2 -2 ${cells.n + 4} ${cells.n + 4}`} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={cells.n + 4} height={cells.n + 4} fill="#fff" />
      {cells.out.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0b0b0b" />)}
    </svg>
  );
}
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
interface Sess { id: string; createdAt: string; expiresAt: string; userAgent: string | null; ip: string | null; current: boolean }
/** "Mac · Chrome" from a user-agent string; the raw string is kept in the tooltip. */
function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
function Setting({ title, children, aside }: { title: string; aside: ReactNode; children: ReactNode }) {
  return <section className="setting"><div className="setting-label"><h2>{title}</h2><div className="small sec">{aside}</div></div><div className="setting-panel">{children}</div></section>;
}

export function SecurityPage() {
  const { toast } = useApp();
  const { setUser, user } = useApp();
  const [st, setSt] = useState<{ enabled: boolean; recoveryCodesLeft: number; email?: string; emailVerified?: boolean; mfaPolicy?: boolean } | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]); const [mailMsg, setMailMsg] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState(""); const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [offPw, setOffPw] = useState(""); const [offCode, setOffCode] = useState(""); const [offing, setOffing] = useState(false);
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [pwErr, setPwErr] = useState("");
  const refresh = () => { api.get("/api/account/security").then(setSt).catch((e) => setErr(errText(e))); api.get("/api/account/sessions").then((r) => setSessions(r.sessions)).catch(() => {}); };
  useEffect(() => { refresh(); }, []);
  const signOutOne = async (id: string) => { try { await api.del(`/api/account/sessions/${id}`); toast("Signed that device out"); refresh(); } catch (e) { toast(errText(e), "err"); } };
  const signOutOthers = async () => { try { const r = await api.post("/api/account/sessions/revoke-others"); toast(`Signed out ${r.revoked} other device${r.revoked === 1 ? "" : "s"}`); refresh(); } catch (e) { toast(errText(e), "err"); } };
  const sendVerify = async () => { setMailMsg(""); try { await api.post("/api/account/email/verify-request"); setMailMsg("Check your inbox for the confirmation link."); } catch (e) { setMailMsg(errText(e)); } };

  const begin = async () => { setErr(""); setBusy(true); try { setSetup(await api.post("/api/account/mfa/setup")); setCode(""); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const enable = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const r = await api.post("/api/account/mfa/enable", { code }); setCodes(r.recoveryCodes); setSt((p) => ({ ...p, enabled: r.enabled, recoveryCodesLeft: r.recoveryCodesLeft })); setSetup(null); if (user?.mfaSetupRequired) setUser({ ...user, mfaSetupRequired: false }); toast("Two-factor sign-in is on"); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  const disable = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const r = await api.post("/api/account/mfa/disable", { password: offPw, code: offCode }); setSt((p) => ({ ...p, ...r })); refresh(); setOffing(false); setOffPw(""); setOffCode(""); setCodes(null); toast("Two-factor sign-in is off"); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault(); setPwErr(""); setBusy(true);
    try { await api.post("/api/account/password", { current: cur, next }); setCur(""); setNext(""); toast("Password changed. Other devices were signed out."); } catch (e2) { setPwErr(errText(e2)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Account security" subtitle="How you sign in and where. These settings apply to your own account only." />
      {user?.mfaSetupRequired && <div style={{ marginBottom: 16 }}><Banner tone="warn" title="Two-factor sign-in is required for advisors.">Turn it on below to continue to the rest of the app.</Banner></div>}
      <div className="settings">
        <Setting title="Two-factor sign-in" aside={<>After your password, you type a 6-digit code from an authenticator app. A stolen password alone is then not enough.{st?.mfaPolicy ? " Your organisation requires it for advisors." : ""}</>}>
          <div className="stack">
            <div className="row between"><b>Authenticator app</b>{st && <Badge tone={st.enabled ? "good" : "warn"}>{st.enabled ? "on" : "off"}</Badge>}</div>
            {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
            {st && !st.enabled && !setup && !codes && <div><button type="button" className="btn primary" onClick={begin} disabled={busy}>Set up two-factor</button></div>}
            {setup && <form className="stack" onSubmit={enable}>
              <ol className="steps">
                <li>Scan this code with your authenticator app (Google Authenticator, 1Password, Authy).<div className="qr-wrap"><Qr text={setup.uri} /></div>
                  <details className="small"><summary>Can't scan? Enter the key by hand</summary><div className="num keybox" style={{ marginTop: 6 }}>{setup.secret.match(/.{1,4}/g)?.join(" ")}</div></details></li>
                <li><div className="field"><label htmlFor="otp">Type the 6-digit code it shows</label><input id="otp" className="num" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required style={{ maxWidth: 180 }} /></div></li>
              </ol>
              <div className="row"><button type="submit" className="btn primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Turn on</button><button type="button" className="btn ghost" onClick={() => { setSetup(null); setErr(""); }}>Cancel</button></div>
            </form>}
            {codes && <div className="stack">
              <Banner tone="warn" title="Save your recovery codes now.">Each works once if you lose your phone. They are shown only this time.</Banner>
              <div className="codes num">{codes.map((c) => <span key={c}>{c}</span>)}</div>
              <div className="row"><button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast("Recovery codes copied"))}>Copy codes</button><button type="button" className="btn primary" onClick={() => setCodes(null)}>I have saved them</button></div>
            </div>}
            {st?.enabled && !codes && <>
              <p className="sec"><b className="num">{st.recoveryCodesLeft}</b> recovery code{st.recoveryCodesLeft === 1 ? "" : "s"} left.</p>
              {!offing ? <div><button type="button" className="btn danger" onClick={() => { setOffing(true); setErr(""); }}>Turn off…</button></div> : (
                <form className="stack" onSubmit={disable}>
                  <div className="field"><label htmlFor="offpw">Your password</label><input id="offpw" type="password" autoComplete="current-password" value={offPw} onChange={(e) => setOffPw(e.target.value)} required /></div>
                  <div className="field"><label htmlFor="offcode">A current code (or a recovery code)</label><input id="offcode" className="num" inputMode="numeric" autoComplete="one-time-code" value={offCode} onChange={(e) => setOffCode(e.target.value)} required /></div>
                  <div className="row"><button type="submit" className="btn danger" disabled={busy}>Turn off two-factor</button><button type="button" className="btn ghost" onClick={() => { setOffing(false); setErr(""); }}>Cancel</button></div>
                </form>)}</>}
          </div>
        </Setting>
        <Setting title="Email address" aside="Alerts and password-reset mail go only to a confirmed address.">
          <div className="stack">
            <div className="row between"><b className="breakable">{st?.email ?? "…"}</b>{st && <Badge tone={st.emailVerified ? "good" : "warn"}>{st.emailVerified ? "confirmed" : "not confirmed"}</Badge>}</div>
            {st && !st.emailVerified && <div className="stack"><p className="sec">Until you confirm this address you will not get alert emails or be able to reset your password by email.</p><div className="row"><button type="button" className="btn" onClick={sendVerify}>Email me a confirmation link</button>{mailMsg && <span className="small sec" role="status">{mailMsg}</span>}</div></div>}
          </div>
        </Setting>
        <Setting title="Password" aside="At least 10 characters. Changing it signs your other devices out.">
          <form className="stack" onSubmit={changePw}>
            <div className="field"><label htmlFor="cur">Current password</label><input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
            <div className="field"><label htmlFor="nxt">New password</label><input id="nxt" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></div>
            {pwErr && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{pwErr}</div>}
            <div><button type="submit" className="btn primary" disabled={busy || next.length < 10 || !cur}>Change password</button></div>
          </form>
        </Setting>
        <Setting title="Where you are signed in" aside="Sessions last 12 hours. Sign out any device you do not recognise.">
          <div className="stack">
            <ul className="sessions">
              {sessions.map((x) => (
                <li key={x.id}>
                  <div><b title={x.userAgent ?? undefined}>{deviceName(x.userAgent)}</b> {x.current && <Badge tone="info">this device</Badge>}<div className="small muted">Signed in {fmtDateTime(x.createdAt)}{x.ip ? ` from ${x.ip}` : ""}</div></div>
                  {!x.current && <button type="button" className="btn sm" onClick={() => signOutOne(x.id)}>Sign out</button>}
                </li>))}
              {sessions.length === 0 && <li className="small muted">Loading…</li>}
            </ul>
            {sessions.length > 1 && <div><button type="button" className="btn" onClick={signOutOthers}>Sign out everywhere else</button></div>}
          </div>
        </Setting>
      </div>
    </>
  );
}
