"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Parameter } from "@/lib/api";

const C = { blue: "#1e6fff", amber: "#f59e0b", red: "#ef4444", green: "#16c784", muted: "#5b6b85", line: "#dbe6f7" };

/** Compact tick labels: 0.68 → "0.68", 93.6 → "93.6", 1460 → "1.46k". */
export const fmtTick = (v: number) => {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return Number(v.toFixed(2)).toString();
};

export function Sparkline({ data, color = C.blue, height = 40 }: { data: { v: number }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`sp-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#sp-${color})`} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Live parameter chart with the normal band (green), warning (amber) and critical (red) lines. */
export function LimitChart({ data, param, height = 220, now }: { data: { t: number; v: number }[]; param: Parameter; height?: number; now?: number }) {
  const n = now ?? Date.now() / 1000;
  const pts = data.map((d) => ({ x: Math.round(d.t - n), v: d.v }));
  const vals = pts.map((p) => p.v);
  const bounds = [param.crit_low, param.crit_high, param.warn_low, param.warn_high, param.normal_min, param.normal_max].filter((x): x is number => typeof x === "number");
  const lo = Math.min(...vals, ...bounds);
  const hi = Math.max(...vals, ...bounds);
  const pad = (hi - lo || 1) * 0.1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
        <XAxis dataKey="x" type="number" domain={["dataMin", 0]} tickFormatter={(v) => `${v}s`} tick={{ fontSize: 10, fill: C.muted }} />
        <YAxis domain={[lo - pad, hi + pad]} tick={{ fontSize: 10, fill: C.muted }} width={52} tickFormatter={(v) => fmtTick(Number(v))} />
        <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${C.line}`, fontSize: 12 }} formatter={(v) => [`${Number(v).toFixed(2)} ${param.unit ?? ""}`, param.name]} labelFormatter={(l) => `${l}s`} />
        {typeof param.normal_min === "number" && typeof param.normal_max === "number" && <ReferenceArea y1={param.normal_min} y2={param.normal_max} fill={C.green} fillOpacity={0.08} />}
        {typeof param.warn_high === "number" && <ReferenceLine y={param.warn_high} stroke={C.amber} strokeDasharray="4 4" label={{ value: "warn", fontSize: 10, fill: C.amber, position: "insideTopRight" }} />}
        {typeof param.crit_high === "number" && <ReferenceLine y={param.crit_high} stroke={C.red} strokeDasharray="4 4" label={{ value: "crit", fontSize: 10, fill: C.red, position: "insideTopRight" }} />}
        {typeof param.warn_low === "number" && <ReferenceLine y={param.warn_low} stroke={C.amber} strokeDasharray="4 4" />}
        {typeof param.crit_low === "number" && <ReferenceLine y={param.crit_low} stroke={C.red} strokeDasharray="4 4" />}
        <Line type="monotone" dataKey="v" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, color = C.blue, height = 160, label }: { data: number[]; color?: string; height?: number; label?: (i: number) => string }) {
  const d = data.map((v, i) => ({ i, v, l: label ? label(i) : String(i) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={d} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="l" tick={{ fontSize: 10, fill: C.muted }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: C.muted }} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${C.line}`, fontSize: 12 }} />
        <Bar dataKey="v" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HealthRing({ value, size = 64 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 80 ? C.green : value >= 50 ? C.amber : C.red;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke={C.line} strokeWidth="6" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.26} fontWeight="700" fill="#0b1a33" fontFamily="var(--font-mono)">
        {value}
      </text>
    </svg>
  );
}
