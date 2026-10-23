import { useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact } from "@shared/money";
import { Card, Icon, ICONS } from "./ui";

const axis = { fontSize: 11, fill: "var(--ink-3)" };
const grid = <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />;
export const money = (v: unknown) => formatCompact(Number(v));

function TipBox({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", boxShadow: "0 6px 20px rgba(0,0,0,.18)", fontSize: 12 }}>
      {label != null && <div style={{ fontWeight: 650, marginBottom: 4 }}>{label}</div>}
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <div key={p.dataKey ?? p.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <i style={{ width: 9, height: 9, borderRadius: 2, background: p.color || p.payload?.fill || p.fill }} /><span style={{ color: "var(--ink-2)" }}>{p.name}</span>
          <b className="num" style={{ marginLeft: "auto", paddingLeft: 12 }}>{(fmt ?? money)(p.value, p)}</b>
        </div>))}
    </div>
  );
}

/** Wraps a chart with a title, legend/table toggle (accessible data table view) and a descriptive label. */
export function ChartCard({ title, subtitle, children, table, height = 260, actions, empty }: {
  title: string; subtitle?: ReactNode; children: ReactNode; table?: { headers: string[]; rows: ReactNode[][] }; height?: number; actions?: ReactNode; empty?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card title={title} subtitle={subtitle} actions={<div className="row no-print">{actions}{table && !empty && <button className="btn sm ghost chart-toggle" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}><Icon d={ICONS.chart} size={14} />{asTable ? "Chart" : "Table"}</button>}</div>}>
      {empty ? empty : asTable && table ? (
        <div className="tbl-wrap" style={{ maxHeight: height + 40, overflow: "auto" }}><table className="tbl"><thead><tr>{table.headers.map((h, i) => <th key={h} className={i ? "r" : ""}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "r num" : ""}>{c}</td>)}</tr>)}</tbody></table></div>
      ) : <div style={{ height }} role="img" aria-label={`${title}. ${subtitle ?? ""} Use the Table button for the underlying numbers.`}>{children}</div>}
    </Card>
  );
}

export function Donut({ data, center }: { data: Array<{ name: string; value: number; color: string }>; center?: ReactNode }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", height: "100%" }}>
      <div style={{ position: "relative", width: "58%", height: "100%", minWidth: 150 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<TipBox fmt={(v: number) => `${formatCompact(v)} · ${((v / total) * 100).toFixed(1)}%`} />} />
          </PieChart>
        </ResponsiveContainer>
        {center && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", textAlign: "center" }}>{center}</div>}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5, flex: 1, minWidth: 0 }}>
        {data.map((d) => <li key={d.name} style={{ display: "flex", gap: 8, alignItems: "center" }}><i style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flex: "none" }} /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span><b className="num">{((d.value / total) * 100).toFixed(1)}%</b></li>)}
      </ul>
    </div>
  );
}

export function BarsChart({ data, series, xKey = "name", layout = "vertical", stack, fmt, yFmt }: {
  data: Array<Record<string, any>>; series: Array<{ key: string; label: string; color: string }>; xKey?: string; layout?: "vertical" | "horizontal"; stack?: boolean; fmt?: (v: number) => string; yFmt?: (v: number) => string;
}) {
  const horizontal = layout === "horizontal";
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 16, right: 12, bottom: 0, left: horizontal ? 12 : 0 }} barCategoryGap={data.length > 8 ? "12%" : "28%"} barGap={2}>
        {grid}
        {horizontal ? <><XAxis type="number" tick={axis} tickFormatter={yFmt ?? money} axisLine={false} tickLine={false} /><YAxis type="category" dataKey={xKey} tick={axis} width={120} axisLine={false} tickLine={false} /></>
          : <><XAxis dataKey={xKey} tick={axis} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} interval={0} /><YAxis tick={axis} tickFormatter={yFmt ?? money} width={58} axisLine={false} tickLine={false} /></>}
        <Tooltip content={<TipBox fmt={fmt} />} cursor={{ fill: "var(--surface-2)", opacity: 0.6 }} />
        <RLegend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stack ? "a" : undefined} radius={stack ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} stroke="var(--surface)" strokeWidth={stack ? 2 : 0} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data, series, area, fmt, yFmt, zeroLine }: { data: Array<Record<string, any>>; series: Array<{ key: string; label: string; color: string }>; area?: boolean; fmt?: (v: number) => string; yFmt?: (v: number) => string; zeroLine?: boolean }) {
  const C: any = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer>
      <C data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        {grid}
        <XAxis dataKey="label" tick={axis} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} minTickGap={24} />
        <YAxis tick={axis} tickFormatter={yFmt ?? money} width={58} axisLine={false} tickLine={false} />
        <Tooltip content={<TipBox fmt={fmt} />} />
        {series.length > 1 && <RLegend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {series.map((s) => area
          ? <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.14} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} connectNulls />
          : <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)", fill: s.color }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />)}
      </C>
    </ResponsiveContainer>
  );
}

export function Meter({ parts, label }: { parts: Array<{ value: number; color: string; label: string }>; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return <div className="meter" role="img" aria-label={label}>{parts.map((p) => <span key={p.label} title={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color, borderRadius: 4 }} />)}</div>;
}

/** Single series, one colour per bar (categories that each keep their own identity colour). */
export function SimpleBars({ data, layout = "vertical", fmt, yFmt, height }: { data: Array<{ name: string; value: number; color: string }>; layout?: "vertical" | "horizontal"; fmt?: (v: number) => string; yFmt?: (v: number) => string; height?: number }) {
  const horizontal = layout === "horizontal";
  return (
    <ResponsiveContainer height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 16, right: 16, bottom: 0, left: horizontal ? 8 : 0 }} barCategoryGap="30%">
        {grid}
        {horizontal ? <><XAxis type="number" tick={axis} tickFormatter={yFmt ?? money} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" tick={axis} width={130} axisLine={false} tickLine={false} /></>
          : <><XAxis dataKey="name" tick={axis} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} interval={0} /><YAxis tick={axis} tickFormatter={yFmt ?? money} width={58} axisLine={false} tickLine={false} /></>}
        <Tooltip content={<TipBox fmt={fmt} />} cursor={{ fill: "var(--surface-2)", opacity: 0.6 }} />
        <Bar dataKey="value" name="Value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
