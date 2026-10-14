// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PROJECT'S HOLIDAYS. Until 2026-10-05 this module also held the column's "assignment by" day parts (2026-10-02: a
// library pick per role per part, composed day by day). The user's ruling of 2026-10-05 RETIRED those: the day parts are
// the editor's buttons (scheduleParts.ts), each schedule carrying its own Weekdays / Weekends / Holiday / Seasonal /
// design-day profiles. What stays here: the holiday list is ONE per project — the engine's RunPeriodControl:SpecialDays,
// on whose days every schedule runs its own Holiday profile — the US federal days to start from, and the retired
// ledger shape, read so a ledger that still carries it is named, never silently dropped.

import { ENGINE_CALENDAR } from "./scheduleCalendar.js";
import { monthDayOf, dayOfYear } from "../../../core/sun.js";
import type { ScheduleRef, ScheduleRole } from "./schedules.js";

/** a named annual set of holidays, by day of the engine's year (1…365) */
export interface HolidaySet { label: string; days: number[] }
/** THE RETIRED DAY PARTS (2026-10-02 … 2026-10-05), as a ledger may still carry them */
export interface ScheduleDays {
  active: Partial<Record<string, boolean>>;
  holiday?: HolidaySet;
  saved?: HolidaySet[];
  winter: number[]; summer: number[];
  picks: Partial<Record<ScheduleRole, Partial<Record<string, ScheduleRef>>>>;
}
/** the retired picks a ledger still carries, in words (empty: none) */
export function retiredPicks(d: ScheduleDays | undefined): string[] {
  if (!d) return [];
  return Object.entries(d.picks ?? {}).flatMap(([role, ps]) => Object.entries(ps ?? {}).filter(([, r]) => r).map(([k, r]) => `${role} ${k} → ${r!.name}`));
}
/** the project's holiday days: the ruling, else the retired calendar's set where its Holiday part was on */
export function projectHolidayDays(l: { holidays?: { id: string; days: number[] } | null; scheduleDays?: ScheduleDays } | null | undefined): number[] {
  return appliedHolidays(l)?.days ?? [];
}

const dow = (n: number): number => (((ENGINE_CALENDAR.jan1Dow + n - 1) % 7) + 7) % 7;

/** THE US FEDERAL HOLIDAYS (5 U.S.C. 6103) in the engine's year — a starting set for Custom; the observed date when one
 *  falls on a weekend (Saturday → Friday, Sunday → Monday) */
export function usFederalHolidays(): HolidaySet {
  const y = ENGINE_CALENDAR.year;
  const nth = (m: number, wd: number, k: number): number => { let n = dayOfYear(m, 1); while (dow(n) !== wd) n++; return n + 7 * (k - 1); };
  const last = (m: number, wd: number): number => { let n = dayOfYear(m + 1, 1) - 1; while (dow(n) !== wd) n--; return n; };
  const observed = (n: number): number => (dow(n) === 6 ? n - 1 : dow(n) === 0 ? n + 1 : n);
  const days = [
    observed(dayOfYear(1, 1)), nth(1, 1, 3), nth(2, 1, 3), last(5, 1), observed(dayOfYear(6, 19)), observed(dayOfYear(7, 4)),
    nth(9, 1, 1), nth(10, 1, 2), observed(dayOfYear(11, 11)), nth(11, 4, 4), observed(dayOfYear(12, 25)),
  ].filter((n) => n >= 1 && n <= 365);
  return { label: `US federal (${y})`, days: [...new Set(days)].sort((a, b) => a - b) };
}

/** the holiday days as the engine's RunPeriodControl:SpecialDays takes them: "M/D" */
export const specialDayDate = (n: number): string => { const md = monthDayOf(n); return `${md.month}/${md.day}`; };
/** the project's holiday list as applied: the ruling, else the retired calendar's set where its Holiday part was on */
export function appliedHolidays(l: { holidays?: { id: string; days: number[] } | null; scheduleDays?: ScheduleDays } | null | undefined): { id: string; days: number[] } | null {
  if (l?.holidays !== undefined) return l.holidays;
  const d = l?.scheduleDays;
  return d?.active.holiday && d.holiday ? { id: d.holiday.label, days: [...d.holiday.days] } : null;
}
