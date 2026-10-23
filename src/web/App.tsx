import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "./api";
import { useApp } from "./store";
import { Badge, Banner, Icon, ICONS, Skeleton, fmtDate } from "./ui";

/** Each page is its own chunk, fetched when first visited, so the first load stays small. */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const ClientsPage = page(() => import("./pages/Clients"), "ClientsPage");
const Overview = page(() => import("./pages/Overview"), "Overview");
const AssetsPage = page(() => import("./pages/Assets"), "AssetsPage");
const PortfolioPage = page(() => import("./pages/Portfolio"), "PortfolioPage");
const CashflowPage = page(() => import("./pages/Cashflow"), "CashflowPage");
const RulesPage = page(() => import("./pages/Rules"), "RulesPage");
const AlertsPage = page(() => import("./pages/Alerts"), "AlertsPage");
const HealthPage = page(() => import("./pages/Health"), "HealthPage");
const GoalsPage = page(() => import("./pages/Goals"), "GoalsPage");
const CasesPage = page(() => import("./pages/Cases"), "CasesPage");
const DataCollectionPage = page(() => import("./pages/DataCollection"), "DataCollectionPage");
const MarketPage = page(() => import("./pages/Market"), "MarketPage");
const ReportsPage = page(() => import("./pages/Reports"), "ReportsPage");
const DemoPage = page(() => import("./pages/Demo"), "DemoPage");
const MethodologyPage = page(() => import("./pages/Methodology"), "MethodologyPage");
const RiskProfilePage = page(() => import("./pages/RiskProfile"), "RiskProfilePage");
const NomineesPage = page(() => import("./pages/Nominees"), "NomineesPage");
const NotificationsPage = page(() => import("./pages/Notifications"), "NotificationsPage");

/** A page chunk that cannot be fetched (offline, or a release replaced it) should not blank the whole app. */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (<Banner tone="crit" title="This page could not be loaded.">If you are offline, reconnect and try again. If the app was just updated, reloading fetches the new version. <button type="button" className="btn sm" onClick={() => location.reload()}>Reload</button></Banner>);
  }
}

const NAV: Array<{ to: string; label: string; icon: string; group?: string }> = [
  { to: "/clients", label: "All clients", icon: ICONS.users, group: "Advisor" },
  { to: "/", label: "Wealth overview", icon: ICONS.home, group: "Wealth" },
  { to: "/assets", label: "Assets & liabilities", icon: ICONS.wallet },
  { to: "/portfolio", label: "Portfolio analytics", icon: ICONS.chart },
  { to: "/cashflow", label: "Cash-flow planner", icon: ICONS.flow },
  { to: "/goals", label: "Goals", icon: ICONS.target },
  { to: "/nominees", label: "Nominees & estate", icon: ICONS.users },
  { to: "/rules", label: "Rules & allocation", icon: ICONS.rules, group: "Intelligence" },
  { to: "/alerts", label: "Alerts", icon: ICONS.bell },
  { to: "/notifications", label: "Email notifications", icon: ICONS.mail },
  { to: "/health", label: "Financial health", icon: ICONS.heart },
  { to: "/risk", label: "Risk profile", icon: ICONS.shield },
  { to: "/cases", label: "Investor case studies", icon: ICONS.users },
  { to: "/data", label: "Data collection", icon: ICONS.db, group: "Data & reports" },
  { to: "/market", label: "Market data", icon: ICONS.globe },
  { to: "/reports", label: "Reports & export", icon: ICONS.file },
  { to: "/demo", label: "Guided demo", icon: ICONS.play, group: "Project" },
  { to: "/methodology", label: "Methodology", icon: ICONS.book },
];

function Login() {
  const { setUser } = useApp();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await api.post("/api/auth/login", { email, password: pw }); setUser(r.user); } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ color: "var(--ink)", padding: "0 0 18px" }}>
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#0f2a43" /><path d="M7 22l5-6 4 3 8-10" stroke="#62d0b4" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div>Wealth Intelligence<small style={{ color: "var(--ink-3)" }}>Net worth tracker · NMIMS MPSTME Design Experience</small></div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
          {err && <div className="err" role="alert" style={{ color: "var(--crit)", fontWeight: 550 }}>{err}</div>}
          <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"}</button>
          <div className="small muted">Academic demo with synthetic data. Demo accounts are listed in the README (advisor: full access · viewer: read-only).</div>
        </div>
      </form>
    </div>
  );
}

function GlobalSearch() {
  const { state } = useApp(); const nav = useNavigate();
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const out: Array<{ label: string; sub: string; to: string }> = NAV.map((n) => ({ label: n.label, sub: "Page", to: n.to }));
    if (state) {
      for (const h of state.data.holdings.filter((h) => !h.archived)) out.push({ label: h.name, sub: "Holding", to: `/assets?q=${encodeURIComponent(h.name)}` });
      for (const l of state.data.liabilities.filter((l) => !l.archived)) out.push({ label: l.name, sub: "Liability", to: `/assets?tab=liabilities&q=${encodeURIComponent(l.name)}` });
      for (const a of state.alerts.filter((a) => a.status !== "resolved")) out.push({ label: a.ruleName + (a.subject ? ` — ${a.subject}` : ""), sub: "Alert", to: `/alerts?open=${a.id}` });
    }
    return out;
  }, [state]);
  const res = q.trim() ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  useEffect(() => { const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  return (
    <div className="searchbox" ref={ref}>
      <Icon d={ICONS.search} />
      <input aria-label="Search pages, holdings and alerts" placeholder="Search holdings, alerts, pages…" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && res[0]) { nav(res[0].to); setOpen(false); setQ(""); } if (e.key === "Escape") setOpen(false); }} />
      {open && res.length > 0 && <div className="results" role="listbox">{res.map((r, i) => <button type="button" key={i} role="option" aria-selected={false} onClick={() => { nav(r.to); setOpen(false); setQ(""); }}><b>{r.label}</b> <span className="muted small">· {r.sub}</span></button>)}</div>}
    </div>
  );
}

export function App() {
  const { user, authChecked, unreachable, retryAuth, clients, clientId, setClientId, state, error, reload, toasts, setUser, loading } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installEvt, setInstallEvt] = useState<any>(null); // the browser's deferred "add to home screen" prompt (not offered by iOS Safari)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    const ready = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    const done = () => setInstallEvt(null);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("beforeinstallprompt", ready); window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("nw.theme", next); } catch { /* ignore */ }
  };
  if (!authChecked) return <div className="page"><Skeleton h={40} /></div>;
  if (!user && unreachable) return (
    <div className="login"><div className="card" style={{ maxWidth: 420, padding: 24 }} role="alert">
      <h1 style={{ fontSize: 18 }}>Cannot reach the server</h1>
      <p className="sec" style={{ margin: "8px 0 14px" }}>You may be offline, or the server may be stopped. You have not been signed out. Nothing is stored on this device.</p>
      <button type="button" className="btn primary" onClick={retryAuth}>Try again</button></div></div>);
  if (!user) return <Login />;

  const openAlerts = state?.alerts.filter((a) => a.status === "open" && a.kind !== "data_gap").length ?? 0;
  const client = clients.find((c) => c.id === clientId);
  const ev = state?.evaluation;
  const stale = ev && (ev.portfolio.valuation.stale.length > 0 || ev.portfolio.valuation.missingDate.length > 0);
  let lastGroup = "";
  return (
    <div className="shell">
      <nav className={`nav ${navOpen ? "open" : ""}`} aria-label="Main">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#17314c" /><path d="M7 22l5-6 4 3 8-10" stroke="#62d0b4" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div>Wealth Intelligence<small>Net worth tracker</small></div>
        </div>
        {NAV.map((n) => {
          const g = n.group && n.group !== lastGroup ? n.group : null; if (n.group) lastGroup = n.group;
          return (<div key={n.to} style={{ display: "contents" }}>{g && <div className="grp">{g}</div>}
            <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}><Icon d={n.icon} />{n.label}{n.to === "/alerts" && openAlerts > 0 && <span className="badge-count">{openAlerts}<span className="sr-only"> open alerts</span></span>}</NavLink></div>);
        })}
        <div style={{ marginTop: "auto", padding: "14px 10px 0", fontSize: 11.5, color: "#7d93ab" }}>Educational tool. Not investment advice.<br />Synthetic demo data.</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost menu-btn" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation"><Icon d={ICONS.menu} /></button>
          <label className="sr-only" htmlFor="client-switch">Client</label>
          <select id="client-switch" value={clientId ?? ""} onChange={(e) => setClientId(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            <optgroup label="Clients">{clients.filter((c) => c.kind === "live").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            <optgroup label="Case studies (illustrative)">{clients.filter((c) => c.kind === "case").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          </select>
          <GlobalSearch />
          <div className="grow" />
          {ev && <div className="small" style={{ textAlign: "right" }} title={`Calculated ${ev.computedAt}`}>
            <div>As of <b>{fmtDate(ev.asOf)}</b></div>
            <div className="muted">{ev.portfolio.valuation.newestDate ? `Latest valuation ${fmtDate(ev.portfolio.valuation.newestDate)}` : "No valuation dates recorded"} {stale && <Badge tone="warn" title="Some valuations are missing a date or are older than the staleness limit">check freshness</Badge>}</div></div>}
          {installEvt && <button type="button" className="btn sm install-btn" onClick={async () => { installEvt.prompt(); try { await installEvt.userChoice; } finally { setInstallEvt(null); } }}><Icon d={ICONS.download} size={14} />Install app</button>}
          <button type="button" className="btn ghost" onClick={toggleTheme} aria-label="Toggle dark mode"><Icon d={ICONS.moon} /></button>
          <div className="small" style={{ textAlign: "right" }}><b>{user.name}</b><div className="muted">{user.role === "admin" ? "Advisor" : "Read-only"}</div></div>
          <button type="button" className="btn sm" onClick={async () => { await api.post("/api/auth/logout"); setUser(null); }}>Sign out</button>
        </header>
        <main className="page" id="main">
          {!online && <div style={{ marginBottom: 14 }}><Banner tone="warn" title="You are offline.">Figures on screen are from your last connection and may be out of date. Changes cannot be saved until you are back online.</Banner></div>}
          {client?.kind === "case" && <div style={{ marginBottom: 14 }}><Banner tone="info" title="Illustrative case study.">Values here are separate from Priya Ramanathan's records. Anything marked illustrative is an editable assumption, not client data.</Banner></div>}
          {user.role !== "admin" && <div style={{ marginBottom: 14 }}><Banner>You are signed in with a read-only role. Editing is disabled.</Banner></div>}
          {error && <div style={{ marginBottom: 14 }}><Banner tone="crit" title="Could not load data.">{error} <button type="button" className="btn sm" onClick={reload}>Retry</button></Banner></div>}
          {!state && !error ? <div className="stack"><Skeleton h={34} w={300} /><div className="grid g4"><Skeleton h={108} /><Skeleton h={108} /><Skeleton h={108} /><Skeleton h={108} /></div><Skeleton h={300} /></div> : state ? (
            <div style={{ opacity: loading ? 0.85 : 1, transition: "opacity .15s" }}>
              <PageBoundary key={loc.pathname}><Suspense fallback={<div className="stack"><Skeleton h={34} w={300} /><Skeleton h={300} /></div>}><Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/cashflow" element={<CashflowPage />} />
                <Route path="/rules" element={<RulesPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/health" element={<HealthPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/nominees" element={<NomineesPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/risk" element={<RiskProfilePage />} />
                <Route path="/cases" element={<CasesPage />} />
                <Route path="/data" element={<DataCollectionPage />} />
                <Route path="/market" element={<MarketPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/demo" element={<DemoPage />} />
                <Route path="/methodology" element={<MethodologyPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes></Suspense></PageBoundary>
            </div>) : null}
        </main>
      </div>
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>{t.text}</div>)}</div>
    </div>
  );
}
