// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A RUN'S HOURS ON THE CALENDAR (2026-10-07). A typical year runs Jan 1 → Dec 31 of the engine's nominal year; an actual-year run
// runs over the weather file's own days — from the solar's connection on 2025-11-01 to the latest data, say — so hour i of a series
// is the hour i after the run's first midnight, dated by the engine (`HourlySeries.start`). One rule for RUN's graphs and BOM's
// months: an hour is placed by its DATE, never by its index.

export const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const DAYS_BEFORE = DAYS_IN.map((_, m) => DAYS_IN.slice(0, m).reduce((t, d) => t + d, 0));
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** the date of hour i of a run that starts at `start` (absent = Jan 1 of a non-leap year): [year, month 1–12, day, clock hour 0–23] */
export function hourDate(start: readonly [number, number, number] | undefined, i: number): [number, number, number, number] {
  const [y, m, d] = start ?? [2017, 1, 1];
  const t = new Date(Date.UTC(y, m - 1, d) + Math.floor(i / 24) * DAY_MS);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), i % 24];
}

/** the hours placed on one calendar year's 365 × 24 grid by their month and day (index 0 = Jan 1 00:00–01:00, as the graphs read it);
 *  Feb 29 left out; `fill` where the run has no hour. For a run from Jan 1 this is the series itself, cut at 8,760 */
export function calendarHours(values: readonly number[], start: readonly [number, number, number] | undefined, fill: number): number[] {
  const out = new Array<number>(365 * 24).fill(fill);
  for (let i = 0; i < values.length; i++) {
    const [, m, d, h] = hourDate(start, i);
    if (m === 2 && d === 29) continue;
    const doy = DAYS_BEFORE[m - 1]! + d - 1;
    const k = doy * 24 + h;
    if (out[k] === fill || Number.isNaN(out[k]!)) out[k] = values[i]!;
  }
  return out;
}

/** a run that is one whole calendar year from Jan 1 (a typical year, or an actual calendar year) — read by its months, Jan to Dec */
export const isCalendarYear = (start: readonly [number, number, number] | undefined, hours: number): boolean =>
  (!start || (start[1] === 1 && start[2] === 1)) && hours >= 8760;

/** the run's period in words for a total (2026-10-07): "/yr" for one calendar year from Jan 1, else the run's own days — an actual-
 *  weather run from the solar's connection is not a year */
export function perRun(hourly: ReadonlyArray<{ values: number[]; start?: readonly [number, number, number] }> | undefined): string {
  const h = hourly?.[0];
  if (!h || isCalendarYear(h.start, h.values.length)) return "/yr";
  const days = Math.round(h.values.length / 24), a = hourDate(h.start, 0), z = hourDate(h.start, h.values.length - 1);
  return ` over ${days} days, ${a[0]}-${String(a[1]).padStart(2, "0")}-${String(a[2]).padStart(2, "0")} to ${z[0]}-${String(z[1]).padStart(2, "0")}-${String(z[2]).padStart(2, "0")}`;
}
