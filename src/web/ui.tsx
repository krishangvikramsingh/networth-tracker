import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { formatCompact, formatINR, parseMoneyInput, type Paise } from "@shared/money";
import { ASSET_CLASS_LABEL, type AssetClass } from "@shared/taxonomy";

export const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10", wallet: "M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2", chart: "M4 20V10M10 20V4M16 20v-7M22 20H2", flow: "M3 12h13M12 6l6 6-6 6", rules: "M4 6h16M4 12h10M4 18h6M18 14l2 2 3-4",
  bell: "M6 17V11a6 6 0 1112 0v6l2 2H4zM10 21h4", heart: "M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z", target: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z",
  users: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 20c0-3 3.6-5 8-5s8 2 8 5", db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6", globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  file: "M6 3h9l4 4v14H6zM14 3v5h5", play: "M7 4l13 8-13 8z", book: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11", search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5", plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18", check: "M5 12l5 5 9-10", alert: "M12 3l10 18H2zM12 10v5M12 18v.5", info: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5", menu: "M4 6h16M4 12h16M4 18h16", moon: "M20 14A8 8 0 1110 4a7 7 0 0010 10z", download: "M12 4v12M7 11l5 5 5-5M5 20h14", edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4", trash: "M5 7h14M10 4h4M7 7l1 13h8l1-13", up: "M12 19V5M6 11l6-6 6 6", cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
};

export function Badge({ tone = "", children, title }: { tone?: "good" | "warn" | "serious" | "crit" | "info" | "outline" | ""; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}
export const SEV_TONE = { critical: "crit", high: "serious", warning: "warn", info: "info" } as const;
export const SEV_LABEL = { critical: "Critical", high: "High", warning: "Warning", info: "Notice" } as const;
export function SevBadge({ s }: { s: keyof typeof SEV_TONE }) { return <Badge tone={SEV_TONE[s]}><Icon d={s === "info" ? ICONS.info : ICONS.alert} size={12} />{SEV_LABEL[s]}</Badge>; }

export function Card({ title, subtitle, actions, children, pad = true, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <header className="card-h"><div><h2>{title}</h2>{subtitle && <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div>}</div>{actions}</header>}
      <div className={pad ? "card-b" : ""}>{children}</div>
    </section>
  );
}
export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="row">{actions}</div></div>;
}
export function Banner({ tone = "info", children, title }: { tone?: "info" | "warn" | "crit"; children: ReactNode; title?: string }) {
  return <div className={`banner ${tone}`} role={tone === "crit" ? "alert" : "note"}><Icon d={tone === "info" ? ICONS.info : ICONS.alert} /><div>{title && <b>{title} </b>}{children}</div></div>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="ico"><Icon d={ICONS.info} /></div><b>{title}</b>{children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}{action}</div>;
}

export function Kpi({ label, value, sub, await: awaiting, onClick, badge, tone }: { label: string; value?: ReactNode; sub?: ReactNode; await?: boolean; onClick?: () => void; badge?: ReactNode; tone?: "good" | "crit" | "" }) {
  const body = (
    <>
      <div className="lbl"><span>{label}</span>{badge}</div>
      <div className={`val ${awaiting ? "await" : ""}`} style={tone === "crit" ? { color: "var(--crit)" } : tone === "good" ? { color: "var(--good)" } : undefined}>{awaiting ? "Awaiting data" : value}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
  return onClick ? <button className="kpi" onClick={onClick} aria-label={`${label}: open details`}>{body}</button> : <div className="kpi">{body}</div>;
}

export function Modal({ title, onClose, children, footer, drawer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; drawer?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])");
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) { // keep focus inside the dialog
        const f = [...ref.current.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const ov = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ov; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`overlay ${drawer ? "drawer" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1} style={wide ? { maxWidth: 820 } : undefined}>
        <div className="modal-h"><h2 id={id}>{title}</h2><button className="btn ghost sm" data-close onClick={onClose} aria-label="Close"><Icon d={ICONS.x} /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, full }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; full?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div>{typeof children === "object" && children && "type" in (children as any) ? cloneWithId(children as any, id, !!error) : children}</div>
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
import { cloneElement, type ReactElement } from "react";
function cloneWithId(el: ReactElement<any>, id: string, invalid: boolean) { return cloneElement(el, { id, "aria-invalid": invalid || undefined }); }

/** Money field: accepts "1.5cr", "20L", "1,00,000". Value is integer paise (or null when blank). */
export function MoneyInput({ value, onChange, placeholder, disabled, id, ...rest }: { value: Paise | null; onChange: (v: Paise | null) => void; placeholder?: string; disabled?: boolean; id?: string; "aria-invalid"?: boolean }) {
  const [text, setText] = useState(value == null ? "" : String(value / 100));
  const [lastValue, setLast] = useState(value);
  if (value !== lastValue) { setLast(value); const parsed = parseMoneyInput(text); if (parsed !== value) setText(value == null ? "" : String(value / 100)); }
  const parsed = text.trim() ? parseMoneyInput(text) : null;
  return (
    <div>
      <input id={id} {...rest} inputMode="decimal" disabled={disabled} placeholder={placeholder ?? "e.g. 25L, 1.5cr, 100000"} value={text}
        onChange={(e) => { setText(e.target.value); const p = e.target.value.trim() ? parseMoneyInput(e.target.value) : null; setLast(p); onChange(p); }} />
      <div className="small muted num" style={{ marginTop: 2, minHeight: 16 }}>{text.trim() ? (parsed == null ? <span style={{ color: "var(--crit)" }}>Not a valid amount</span> : `${formatINR(parsed)} · ${formatCompact(parsed)}`) : ""}</div>
    </div>
  );
}

export interface Col<T> { key: string; label: string; render: (r: T) => ReactNode; sort?: (r: T) => string | number | null; right?: boolean; hide?: boolean }
export function DataTable<T extends { id?: string }>({ cols, rows, search, defaultSort, onRow, empty, rowClass, dense, pageSize = 50 }: {
  cols: Col<T>[]; rows: T[]; search?: (r: T) => string; defaultSort?: { key: string; dir: 1 | -1 }; onRow?: (r: T) => void; empty?: ReactNode; rowClass?: (r: T) => string; dense?: boolean; pageSize?: number;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    let r = rows;
    if (q && search) { const n = q.toLowerCase(); r = r.filter((x) => search(x).toLowerCase().includes(n)); }
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      if (c?.sort) r = [...r].sort((a, b) => { const x = c.sort!(a), y = c.sort!(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    }
    return r;
  }, [rows, q, sort, cols, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  return (
    <div>
      {search && <div className="toolbar"><div className="searchbox"><Icon d={ICONS.search} /><input aria-label="Search table" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div><span className="small muted">{filtered.length} of {rows.length}</span></div>}
      <div className="tbl-wrap">
        <table className="tbl" style={dense ? { fontSize: 12.5 } : undefined}>
          <thead><tr>{cols.filter((c) => !c.hide).map((c) => (
            <th key={c.key} className={c.right ? "r" : ""} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
              {c.sort ? <button onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: (-sort.dir) as 1 | -1 } : { key: c.key, dir: 1 })}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button> : c.label}
            </th>))}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id ?? i} className={rowClass?.(r)} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: "pointer" } : undefined}>
                {cols.filter((c) => !c.hide).map((c) => <td key={c.key} className={c.right ? "r num" : ""}>{c.render(r)}</td>)}
              </tr>))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (empty ?? <Empty title="Nothing to show" />)}
      {pages > 1 && <div className="row between small" style={{ marginTop: 8 }}><span className="muted">Page {cur + 1} of {pages}</span><div className="row"><button className="btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button><button className="btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button></div></div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" className="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>{t.label}{t.count != null && <span className="muted"> · {t.count}</span>}</button>)}
    </div>
  );
}
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void; label: string }) {
  return <div className="pill-select" role="group" aria-label={label}>{options.map((o) => <button key={o.id} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}

export const classColor = (c: AssetClass | "unclassified") => `var(--c-${c})`;
export const classLabel = (c: AssetClass | "unclassified") => (c === "unclassified" ? "Unclassified" : ASSET_CLASS_LABEL[c]);
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>;
}
export function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: number | string }) { return <div className="skeleton" style={{ height: h, width: w }} />; }

export function download(url: string) { const a = document.createElement("a"); a.href = url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T00:00:00Z" : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
