import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { useApp } from "../store";

const Logo = () => (
  <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0f2a43" /><path d="M7 22l5-6 4 3 8-10" stroke="#62d0b4" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
function Shell({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="login">
      <div className="card auth-card">
        <div className="brand" style={{ color: "var(--ink)", padding: "0 0 18px" }}><Logo /><div>Wealth Intelligence<small style={{ color: "var(--ink-3)" }}>Net worth tracker · NMIMS MPSTME Design Experience</small></div></div>
        <div className="auth-step" key={title}>
          <h1 style={{ fontSize: 18, marginBottom: 6 }}>{title}</h1>
          {lead && <p className="sec" style={{ marginBottom: 14 }}>{lead}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

type Step = "password" | "code" | "forgot" | "sent";

export function Login() {
  const { setUser } = useApp();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = (s: Step) => { setErr(""); setStep(s); };

  async function signIn(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api.post("/api/auth/login", { email, password: pw });
      if (r.mfaRequired) { setChallenge(r.challenge); setCode(""); setStep("code"); } else setUser(r.user);
    } catch (e2) { setErr(msg(e2, "Sign-in failed.")); } finally { setBusy(false); }
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await api.post("/api/auth/mfa/verify", { challenge, code }); setUser(r.user); }
    catch (e2) { setErr(msg(e2, "Could not verify the code.")); if (e2 instanceof ApiError && /expired|Too many/.test(e2.message)) { setPw(""); setStep("password"); } } finally { setBusy(false); }
  }
  async function forgot(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api.post("/api/auth/forgot", { email }); setStep("sent"); } catch (e2) { setErr(msg(e2, "Could not send the link.")); } finally { setBusy(false); }
  }

  if (step === "code") return (
    <Shell title="Enter your code" lead="Open your authenticator app and type the 6-digit code. Lost your phone? Use one of your recovery codes instead.">
      <form className="stack" style={{ gap: 12 }} onSubmit={verify}>
        <div className="field"><label htmlFor="code">Code</label><input id="code" className="num" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></div>
        {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
        <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6} style={{ justifyContent: "center" }}>{busy ? "Checking…" : "Verify and sign in"}</button>
        <button type="button" className="linkbtn small" onClick={() => { go("password"); setPw(""); }}>Use a different account</button>
      </form>
    </Shell>);
  if (step === "forgot") return (
    <Shell title="Reset your password" lead="Enter your account email. If it has an account, we send a link that works for 30 minutes.">
      <form className="stack" style={{ gap: 12 }} onSubmit={forgot}>
        <div className="field"><label htmlFor="fe">Email</label><input id="fe" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Sending…" : "Email me a reset link"}</button>
        <button type="button" className="linkbtn small" onClick={() => go("password")}>Back to sign in</button>
      </form>
    </Shell>);
  if (step === "sent") return (
    <Shell title="Check your email" lead="If that address has an account, a reset link is on its way. It works for 30 minutes and only once.">
      <button type="button" className="btn" onClick={() => go("password")}>Back to sign in</button>
    </Shell>);
  return (
    <Shell title="Sign in">
      <form className="stack" style={{ gap: 12 }} onSubmit={signIn}>
        <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="linkbtn small" onClick={() => go("forgot")}>Forgot your password?</button>
        <div className="small muted">Academic demo with synthetic data. Demo accounts are listed in the README (advisor: full access · viewer: read-only).</div>
      </form>
    </Shell>);
}

/** Opened from the emailed link: /reset?token=… */
export function ResetPassword({ token }: { token: string }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  async function submit(e: FormEvent) {
    e.preventDefault(); if (pw !== pw2) return; setBusy(true); setErr("");
    try { await api.post("/api/auth/reset", { token, password: pw }); setDone(true); history.replaceState(null, "", "/reset"); } catch (e2) { setErr(msg(e2, "Could not reset the password.")); } finally { setBusy(false); }
  }
  if (done) return (
    <Shell title="Password changed" lead="You have been signed out everywhere. Sign in with your new password.">
      <a className="btn primary" href="/" style={{ justifyContent: "center" }}>Go to sign in</a>
    </Shell>);
  return (
    <Shell title="Choose a new password" lead="At least 10 characters. A long phrase is easier to remember and harder to guess.">
      <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
        <div className="field"><label htmlFor="np">New password</label><input id="np" type="password" autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></div>
        <div className="field"><label htmlFor="np2">Repeat it</label><input id="np2" type="password" autoComplete="new-password" aria-invalid={mismatch || undefined} value={pw2} onChange={(e) => setPw2(e.target.value)} required />{mismatch && <span className="err" role="alert">The two passwords differ.</span>}</div>
        {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}{/no longer valid/.test(err) && <> <a href="/">Ask for a new link</a></>}</div>}
        <button type="submit" className="btn primary" disabled={busy || pw.length < 10 || mismatch} style={{ justifyContent: "center" }}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
    </Shell>);
}
