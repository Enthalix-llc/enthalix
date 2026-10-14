// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE RUN CALENDAR AND THE SCHEDULE EVALUATOR (user, 2026-09-13: "a calendar in view that shows the full year and can zoom in
// by month, week and day"). The value a schedule takes on a day of the year at an hour is what the engine computes: the period
// the day falls in (a Through: block, a week period), the day's TYPE (its weekday name, or a holiday the weather file names),
// the LAST rule of the period naming that type, the hour. THE CALENDAR IS THE ENGINE'S: a RunPeriod written with no year and
// no start weekday starts on a Sunday (WeatherManager.cc:5135 "No input, set the default as Sunday") in the year 2017, whose
// 1/1 is a Sunday (:5195-5196); the IDD's own note: "If no year is input, this field will default to Sunday". The weather
// file's DATA PERIODS word is read and shown beside it, never used in its place. Pure; the gate hand-checks it against the
// library's own files.

import { dayOfYear, monthDayOf, MONTH_NAMES } from "../../../core/sun.js";
import type { ScheduleProfile, DayType } from "./schedules.js";
import { DAY_TYPES, ruleWith } from "./schedules.js";

export const DAY_NAMES = DAY_TYPES.slice(0, 7) as DayType[];   // sunday … saturday, index = the day of the week
export const ENGINE_CALENDAR = { year: 2017, jan1Dow: 0, citation: "a RunPeriod with no year and no start weekday: Sunday (WeatherManager.cc:5135), the year 2017 whose 1/1 is a Sunday (:5195-5196); the IDD: \"If no year is input, this field will default to Sunday\"" } as const;

export interface RunCalendar {
  year: number;
  /** the weekday of January 1 — 0 Sunday … 6 Saturday */
  jan1Dow: number;
  /** what the weather file's DATA PERIODS line says the start day is, shown beside the engine's */
  epwWord: string | null;
  /** the holidays the weather file names, by day of the year (a date the reader could not place keeps NaN) */
  holidays: Array<{ name: string; date: string; n: number }>;
  /** the run period, days of the year inclusive */
  run: { from: number; to: number };
  /** the leap-year / daylight-saving words of the weather file, as written */
  dst: string | null;
}

/** the start weekday named in an EPW's DATA PERIODS line (`1, 1, Data, Sunday, 1/ 1, 12/31`), when it names one */
export function parseDataPeriodDow(dataPeriod: string | null | undefined): string | null {
  const w = (dataPeriod ?? "").split(",").map((x) => x.trim())[3] ?? "";
  return DAY_NAMES.includes(w.toLowerCase() as DayType) ? w : null;
}
/** an EPW holiday date as a day of the year: `M/D` or `D Mon` are read; any other form is named and left NaN */
export function holidayDay(date: string): number {
  const md = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(date.trim()); if (md) return dayOfYear(Number(md[1]), Number(md[2]));
  const dm = /^(\d{1,2})\s+([A-Za-z]{3})/.exec(date.trim());
  if (dm) { const m = MONTH_NAMES.findIndex((x) => x.toLowerCase() === dm[2]!.toLowerCase()); if (m >= 0) return dayOfYear(m + 1, Number(dm[1])); }
  return NaN;
}
export function runCalendar(epw: { dataPeriod?: string; holidays?: Array<{ name: string; date: string }>; dst?: string; kind?: string; firstDate?: [number, number, number] | null; lastDate?: [number, number, number] | null } | null, rp?: { begin: [number, number]; end: [number, number] } | null): RunCalendar {
  // AN ACTUAL YEAR (2026-10-07): the run goes over the weather file's own days with their years, so the calendar is that year's —
  // the year the run ends in (a run from the solar's connection, Nov 2025 → Oct 2026, reads as 2026), its Jan 1 the real weekday;
  // the run period the file's first and last days (a run over the new year wraps)
  if (epw?.kind === "AMY" && epw.firstDate && epw.lastDate) {
    const y = epw.lastDate[0];
    return {
      year: y, jan1Dow: new Date(Date.UTC(y, 0, 1)).getUTCDay(),
      epwWord: parseDataPeriodDow(epw.dataPeriod),
      holidays: (epw.holidays ?? []).map((h) => ({ ...h, n: holidayDay(h.date) })),
      run: { from: dayOfYear(epw.firstDate[1], epw.firstDate[2]), to: dayOfYear(epw.lastDate[1], epw.lastDate[2]) },
      dst: epw.dst ?? null,
    };
  }
  return {
    year: ENGINE_CALENDAR.year, jan1Dow: ENGINE_CALENDAR.jan1Dow,
    epwWord: parseDataPeriodDow(epw?.dataPeriod),
    holidays: (epw?.holidays ?? []).map((h) => ({ ...h, n: holidayDay(h.date) })),
    run: rp ? { from: dayOfYear(rp.begin[0], rp.begin[1]), to: dayOfYear(rp.end[0], rp.end[1]) } : { from: 1, to: 365 },
    dst: epw?.dst ?? null,
  };
}
/** the weekday of a day of the year: 0 Sunday … 6 Saturday */
export const dowOf = (cal: RunCalendar, n: number): number => (((cal.jan1Dow + n - 1) % 7) + 7) % 7;
/** a day's TYPE: a holiday the file names, else its weekday name — the design days never occur in the run year */
export function dayTypeOf(cal: RunCalendar, n: number): DayType {
  if (cal.holidays.some((h) => h.n === n)) return "holiday";
  return DAY_NAMES[dowOf(cal, n)]!;
}
/** the schedule's value on day n (1…365) at hour h (0…23, the hour ending at h+1); NaN outside every period or rule */
export function valueAt(p: ScheduleProfile, n: number, h: number, cal: RunCalendar): number {
  if (p.problem) return NaN;
  const period = p.periods.find((x) => n >= x.from && n <= x.to);
  if (!period) return NaN;
  const rule = ruleWith(period.rules, dayTypeOf(cal, n));
  return rule ? (rule.hours[h] ?? NaN) : NaN;
}
/** the whole year: 8,760 values, index (n − 1) × 24 + h */
export function yearOf(p: ScheduleProfile, cal: RunCalendar): Float64Array {
  const out = new Float64Array(365 * 24);
  for (let n = 1; n <= 365; n++) for (let h = 0; h < 24; h++) out[(n - 1) * 24 + h] = valueAt(p, n, h, cal);
  return out;
}
/** min · mean · max over the finite values of days from…to (inclusive), every hour */
export function summary(values: ArrayLike<number>, from: number, to: number): { min: number; mean: number; max: number; n: number } {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (let d = from; d <= to; d++) for (let h = 0; h < 24; h++) { const v = values[(d - 1) * 24 + h]; if (v !== undefined && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; sum += v; n++; } }
  return n ? { min, mean: sum / n, max, n } : { min: NaN, mean: NaN, max: NaN, n: 0 };
}
/** the day as the calendar names it: "Mon 3/6" */
export function dayLabel(cal: RunCalendar, n: number): string {
  const { month, day } = monthDayOf(n);
  const dow = DAY_NAMES[dowOf(cal, n)]!;
  return `${dow.slice(0, 1).toUpperCase()}${dow.slice(1, 3)} ${month}/${day}`;
}
