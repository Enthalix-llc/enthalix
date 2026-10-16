// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SCHEDULES CALENDAR (user, 2026-09-13): the main view of the SCHEDULES tab — the full year, zoomed by a click on a
// month, then a week, then a day; a double-click backs up one level. A card selected in the column paints the calendar
// with that schedule's values, evaluated day by day the way the engine does (scheduleCalendar.ts); no card, the run
// calendar alone — its day types, the run period, the weather file's word. The frame under the view is the day profile
// editor (ScheduleEditor.tsx); its table of values was removed (user, 2026-10-05). Divs and one SVG strip; nothing authored, nothing synthesised.

import { useEffect, useMemo, useRef } from "react";
import type { ScheduleProfile } from "../core/schedules.js";
import { type RunCalendar, yearOf, summary, dowOf, dayTypeOf, dayLabel, DAY_NAMES, ENGINE_CALENDAR } from "../core/scheduleCalendar.js";
import { monthDayOf, dayOfYear, MONTH_NAMES } from "../../../core/sun.js";
import { fmtTemp } from "./bemUi.js";
import { Strip } from "./BemSchedules.js";

export type CalLevel = "year" | "month" | "week" | "day";
export interface CalAt { level: CalLevel; n: number }
export type Kind = "fraction" | "temperature";
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthOf = (n: number): number => monthDayOf(n).month;
const firstOfMonth = (m: number): number => dayOfYear(m, 1);
/** the Sunday a week starts on, never before the year */
const weekStart = (cal: RunCalendar, n: number): number => Math.max(1, n - dowOf(cal, n));

/** the cell's colour: a fraction on the sun ramp 0 … 1, a temperature on the diverging ramp 10 … 30 °C, NaN grey */
const mix = (a: [number, number, number], b: [number, number, number], t: number): string => `rgb(${a.map((x, i) => Math.round(x + (b[i]! - x) * t)).join(",")})`;
export function cellColor(v: number, kind: Kind): string {
  if (!Number.isFinite(v)) return "#464a54";
  if (kind === "fraction") return mix([30, 34, 48], [255, 142, 20], Math.max(0, Math.min(1, v)));
  const t = Math.max(0, Math.min(1, (v - 10) / 20));
  return t < 0.5 ? mix([59, 111, 214], [200, 200, 200], t * 2) : mix([200, 200, 200], [214, 85, 59], (t - 0.5) * 2);
}
const fmtV = (v: number, kind: Kind, imperial: boolean): string => (Number.isFinite(v) ? (kind === "temperature" ? fmtTemp(v, imperial, 1) : v.toFixed(2)) : "—");

export interface CalendarProps {
  profile: ScheduleProfile | null; kind: Kind; cal: RunCalendar;
  at: CalAt; onAt: (a: CalAt) => void;
  imperial: boolean;
  /** the words of the legend: the role, the schedule's name · file · source, or the code default's words */
  label: string; source: string;
  /** THE DAY PARTS (2026-10-02): with no card selected, the subtab's ACTIVE days — a bright block, the rest an empty one */
  active?: ((n: number) => boolean) | null;
  /** Holiday and the seasons: a left click toggles a day, a left drag paints a run of them (add or remove, by the first day's state) */
  onPaint?: ((n: number, add: boolean) => void) | null;
}

export function ScheduleCalendar(p: CalendarProps): React.ReactElement {
  const values = useMemo(() => (p.profile ? yearOf(p.profile, p.cal) : null), [p.profile, p.cal]);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PAINTING (2026-10-02): the left button down on a day sets add or remove by that day's state; entering another day
  // with the button held does the same to it; the button up anywhere ends the stroke
  const stroke = useRef<boolean | null>(null);
  useEffect(() => { const up = (): void => { stroke.current = null; }; window.addEventListener("pointerup", up); return () => window.removeEventListener("pointerup", up); }, []);
  const painting = !!p.onPaint && !!p.active;
  const paintProps = (d: number): React.HTMLAttributes<HTMLDivElement> => painting ? {
    onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const add = !p.active!(d); stroke.current = add; p.onPaint!(d, add); },
    onPointerEnter: (e) => { if (stroke.current !== null && (e.buttons & 1)) p.onPaint!(d, stroke.current); },
    onClick: (e) => e.stopPropagation(),
  } : {};
  const activeBg = (d: number): string | null => (p.active && !values ? (p.active(d) ? "#e8a33d" : "#161a24") : null);
  // a single click zooms in, deferred so a double-click (zoom out) does not zoom in twice on its way
  const zoomIn = (next: CalAt): void => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => { clickTimer.current = null; p.onAt(next); }, 220); };
  const zoomOut = (): void => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    const { level, n } = p.at;
    if (level === "day") p.onAt({ level: "week", n: weekStart(p.cal, n) });
    else if (level === "week") p.onAt({ level: "month", n: firstOfMonth(monthOf(n)) });
    else if (level === "month") p.onAt({ level: "year", n: 1 });
  };
  // a run over the new year (an actual year from November) wraps: its days are from `from` to Dec 31 and Jan 1 to `to`
  const inRun = (n: number): boolean => (p.cal.run.from <= p.cal.run.to ? n >= p.cal.run.from && n <= p.cal.run.to : n >= p.cal.run.from || n <= p.cal.run.to);
  const dayTitle = (n: number): string => { const s = values ? summary(values, n, n) : null; const hol = p.cal.holidays.find((h) => h.n === n); return `${dayLabel(p.cal, n)} · ${hol ? `holiday ${hol.name}` : dayTypeOf(p.cal, n)}${s && s.n ? ` · ${fmtV(s.min, p.kind, p.imperial)} · mean ${fmtV(s.mean, p.kind, p.imperial)} · ${fmtV(s.max, p.kind, p.imperial)}` : ""}${inRun(n) ? "" : " · outside the run period"}`; };
  // what the colour means at this zoom (the user, 2026-10-05): a year's or a month's cell is the day's AVERAGE, not its peak
  const colourNote = p.kind === "temperature"
    ? (p.at.level === "year" || p.at.level === "month" ? "each day's colour is its average setpoint over the 24 hours — blue cooler, red warmer" : p.at.level === "week" ? "each cell's colour is that hour's setpoint — blue cooler, red warmer" : "each bar is that hour's setpoint — blue cooler, red warmer")
    : (p.at.level === "year" || p.at.level === "month" ? "each day's colour intensity is its average value over the 24 hours — dark 0.0, bright 1.0; a short evening peak reads dim" : p.at.level === "week" ? "each cell's colour intensity is that hour's value — dark 0.0, bright 1.0" : "each bar is that hour's value — dark 0.0, bright 1.0");
  const dayMean = (n: number): number => (values ? summary(values, n, n).mean : NaN);
  const cellStyle = (n: number): React.CSSProperties => ({ background: activeBg(n) ?? (values ? cellColor(dayMean(n), p.kind) : dowOf(p.cal, n) === 0 || dowOf(p.cal, n) === 6 ? "#2a2f3c" : "#1e2230"), opacity: inRun(n) ? 1 : 0.35, ...(activeBg(n) ? { outline: "1px solid #3a4152" } : {}) });
  const heads = DAY_NAMES.map((d) => d.slice(0, 1).toUpperCase());
  const monthGrid = (m: number, mini: boolean): React.ReactElement => {
    const first = firstOfMonth(m), n = DAYS_IN[m - 1]!, offset = dowOf(p.cal, first);
    return (
      <div key={m} className={`calMonth${mini ? " mini" : ""}`} data-month={m} onClick={mini && !painting ? () => zoomIn({ level: "month", n: first }) : undefined} title={mini ? (painting ? `${MONTH_NAMES[m - 1]}: click its name for the month; click or drag days to add or remove them` : `${MONTH_NAMES[m - 1]}: click for the month`) : undefined}>
        <div className="calMonthName" onClick={mini && painting ? () => p.onAt({ level: "month", n: first }) : undefined} style={mini && painting ? { cursor: "zoom-in" } : undefined}>{MONTH_NAMES[m - 1]}</div>
        <div className="calGrid">
          {heads.map((h, i) => <div key={`h${i}`} className="calHead">{h}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`o${i}`} className="calCell blank" />)}
          {Array.from({ length: n }, (_, i) => { const d = first + i; const hol = p.cal.holidays.some((h) => h.n === d);
            return mini
              ? <div key={d} className={`calCell${hol ? " hol" : ""}${painting ? " paint" : ""}`} data-n={d} style={cellStyle(d)} title={dayTitle(d)} {...paintProps(d)} />
              : <div key={d} className={`calCell day${hol ? " hol" : ""}${painting ? " paint" : ""}`} data-n={d} style={{ opacity: inRun(d) ? 1 : 0.35, ...(activeBg(d) ? { background: activeBg(d)! } : {}) }} title={painting ? `${dayTitle(d)} — click or drag to add or remove` : `${dayTitle(d)} — click for its week`} onClick={(e) => { e.stopPropagation(); zoomIn({ level: "week", n: weekStart(p.cal, d) }); }} {...paintProps(d)}>
                  <span className="calDayNo">{i + 1}</span>
                  {values && <Strip hours={Array.from({ length: 24 }, (_, h) => values[(d - 1) * 24 + h] ?? NaN)} min={p.kind === "temperature" ? 10 : 0} max={p.kind === "temperature" ? 30 : 1} cls="calStrip" />}
                </div>; })}
        </div>
      </div>
    );
  };
  const week = (n0: number): React.ReactElement => {
    const days = Array.from({ length: 7 }, (_, i) => n0 + i).filter((d) => d <= 365);
    return (
      <div className="calWeek">
        <div className="calWeekHead"><div className="calHour" />{days.map((d) => <div key={d} className="calWeekDay" title={`${dayTitle(d)} — click for the day`} onClick={() => zoomIn({ level: "day", n: d })}>{dayLabel(p.cal, d)}</div>)}</div>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="calWeekRow">
            <div className="calHour">{h + 1}h</div>
            {days.map((d) => { const v = values ? values[(d - 1) * 24 + h] ?? NaN : NaN;
              return <div key={d} className="calCell" data-n={d} data-h={h} style={{ background: activeBg(d) ?? (values ? cellColor(v, p.kind) : "#1e2230"), opacity: inRun(d) ? 1 : 0.35 }} title={`${dayLabel(p.cal, d)} · hour ending ${h + 1} · ${fmtV(v, p.kind, p.imperial)}`} onClick={() => zoomIn({ level: "day", n: d })} {...paintProps(d)} />; })}
          </div>
        ))}
      </div>
    );
  };
  const day = (n: number): React.ReactElement => {
    const hours = Array.from({ length: 24 }, (_, h) => (values ? values[(n - 1) * 24 + h] ?? NaN : NaN));
    return (
      <div className="calDay">
        <div className="calDayHead">{dayTitle(n)}</div>
        <div className="calDayBars">{hours.map((v, h) => <div key={h} className="calBar" data-n={n} data-h={h} title={`hour ending ${h + 1} · ${fmtV(v, p.kind, p.imperial)}`}><div className="calBarFill" style={{ height: `${Number.isFinite(v) ? Math.max(2, 100 * Math.max(0, Math.min(1, p.kind === "temperature" ? (v - 10) / 20 : v))) : 0}%`, background: cellColor(v, p.kind) }} /><span className="calBarV">{Number.isFinite(v) ? (p.kind === "temperature" ? fmtTemp(v, p.imperial, 0) : v.toFixed(2)) : "—"}</span><span className="calBarH">{h + 1}</span></div>)}</div>
      </div>
    );
  };
  const crumb = (): React.ReactElement => {
    const { level, n } = p.at;
    const m = monthOf(n);
    return (
      <div className="calCrumb">
        <button className={`chip${level === "year" ? " on" : ""}`} onClick={() => p.onAt({ level: "year", n: 1 })}>year</button>
        {level !== "year" && <button className={`chip${level === "month" ? " on" : ""}`} onClick={() => p.onAt({ level: "month", n: firstOfMonth(m) })}>{MONTH_NAMES[m - 1]}</button>}
        {(level === "week" || level === "day") && <button className={`chip${level === "week" ? " on" : ""}`} onClick={() => p.onAt({ level: "week", n: weekStart(p.cal, n) })}>week of {dayLabel(p.cal, weekStart(p.cal, n))}</button>}
        {level === "day" && <button className="chip on">{dayLabel(p.cal, n)}</button>}
        <span className="muted">{painting ? "click or drag days to add or remove them · a month's name zooms in · the chips back up" : "click zooms in · double-click backs up"}</span>
        {values && <span className="calNote">{colourNote}</span>}
      </div>
    );
  };
  const lo = p.kind === "temperature" ? 10 : 0, hi = p.kind === "temperature" ? 30 : 1;
  return (
    <div className="calSlot" data-level={p.at.level} onDoubleClick={(e) => { e.preventDefault(); if (!painting) zoomOut(); }}>
      {crumb()}
      {p.at.level === "year" && <div className="calYear">{Array.from({ length: 12 }, (_, i) => monthGrid(i + 1, true))}</div>}
      {p.at.level === "month" && monthGrid(monthOf(p.at.n), false)}
      {p.at.level === "week" && week(weekStart(p.cal, p.at.n))}
      {p.at.level === "day" && day(p.at.n)}
      <div className="calLegend">
        <div><b>{p.label}</b> <span className="muted">· {p.source}</span></div>
        {p.active && !values && <div className="calRamp"><span className="calRampBar" style={{ width: 14, background: "#e8a33d" }} /><span>active</span><span className="calRampBar" style={{ width: 14, background: "#161a24", outline: "1px solid #3a4152" }} /><span>not</span></div>}
        {values && <div className="calRamp"><span>{fmtV(lo, p.kind, p.imperial)}</span><span className="calRampBar" style={{ background: `linear-gradient(90deg, ${cellColor(lo, p.kind)}, ${p.kind === "temperature" ? cellColor(20, p.kind) + ", " : ""}${cellColor(hi, p.kind)})` }} /><span>{fmtV(hi, p.kind, p.imperial)}</span><span className="muted"> · {colourNote}; grey = no value</span></div>}
        <div className="muted" title={`the engine's year: ${ENGINE_CALENDAR.citation} · design days never occur in the run year · Interpolate: none in the library`}>the run: {monthDayOf(p.cal.run.from).month}/{monthDayOf(p.cal.run.from).day} – {monthDayOf(p.cal.run.to).month}/{monthDayOf(p.cal.run.to).day} · year {ENGINE_CALENDAR.year} (Jan 1 a Sunday) · the weather file says {p.cal.epwWord ?? "no start day"} · holidays it states {p.cal.holidays.length}{p.cal.dst ? ` · ${p.cal.dst}` : ""}</div>
      </div>
    </div>
  );
}
