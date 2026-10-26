// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE DAY PARTS IN THE EDITOR (user, 2026-10-05): "buttons above the bar graph: All Days, Weekdays, Weekends, Holiday,
// Seasonal, Summer DD, Winter DD. If All Days is selected, the other options dim. If any dimmed button is selected, the All
// Days button is dimmed … The various option definitions are applied uniformly throughout the year except for Seasonal,
// which overrides as selected in the calendar view, with editable ID." The user's rulings the same day: these buttons
// REPLACE the column's "assignment by" day parts; the holiday list is ONE per project (the engine's own
// RunPeriodControl:SpecialDays — every schedule's Holiday profile runs on its days); ONE season per schedule.
//
// A schedule in parts is one Schedule:Compact. The days outside the season are one date block per run of days ("Through:"),
// each "For:" the parts' day types (equal profiles share a line; one profile for all is "For: AllDays"). The season's days
// are blocks of their own: the design days keep their own profiles there (they are not calendar days — the engine reads the
// block holding the design day's date), every other day type takes the Seasonal profile — the season overrides Weekdays,
// Weekends and Holiday on its days. Custom days 1 and 2 go with Weekdays: they occur only on a SpecialDays the model never
// writes. A schedule that cannot be held this way (its Saturday and Sunday differ, a day type with no profile, more than
// one season) is said so; it is edited by its own day profiles, or converted on the user's word with what changes named.

import type { DayType, ScheduleProfile, SchedulePeriod } from "./schedules.js";
import { DAY_TYPES, ruleWith } from "./schedules.js";
import type { IdfObject } from "./idfLib.js";
import { ENGINE_CALENDAR } from "./scheduleCalendar.js";
import { monthDayOf, dayOfYear } from "../../../core/sun.js";

export type PartKey = "all" | "weekdays" | "weekends" | "holiday" | "seasonal" | "summerDD" | "winterDD";
export const PART_KEYS: PartKey[] = ["all", "weekdays", "weekends", "holiday", "seasonal", "summerDD", "winterDD"];
export const PART_LABELS: Record<PartKey, string> = { all: "All Days", weekdays: "Weekdays", weekends: "Weekends", holiday: "Holiday", seasonal: "Seasonal", summerDD: "Summer DD", winterDD: "Winter DD" };
type SplitKey = Exclude<PartKey, "all">;
export const SPLIT_KEYS: SplitKey[] = ["weekdays", "weekends", "holiday", "seasonal", "summerDD", "winterDD"];

/** a named annual set of days by day of the engine's year (1…365): a holiday list, or a season */
export interface DaySetDef { id: string; days: number[] }
/** a schedule in parts: one profile for every day, or one per part (and a season's own, on its days) */
export interface PartSchedule {
  mode: "all" | "split";
  hours: Record<PartKey, number[]>;
  /** the season the Seasonal profile overrides on — null: none (its hours are kept but not written) */
  season: DaySetDef | null;
}

const WEEKDAY_T: DayType[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "customday1", "customday2"];
const WEEKEND_T: DayType[] = ["saturday", "sunday"];
/** the day types each part governs outside the season */
const TYPES_OF: Record<Exclude<SplitKey, "seasonal">, DayType[]> = { weekdays: WEEKDAY_T, weekends: WEEKEND_T, holiday: ["holiday"], summerDD: ["summerdesignday"], winterDD: ["winterdesignday"] };
const KEYWORD: Record<DayType, string> = {
  sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday",
  holiday: "Holiday", summerdesignday: "SummerDesignDay", winterdesignday: "WinterDesignDay", customday1: "CustomDay1", customday2: "CustomDay2",
};
/** the "For:" of a set of day types, in the engine's keywords (Weekdays / Weekends where whole; AllDays for every type) */
function forOf(types: DayType[]): string {
  const s = new Set(types);
  if (DAY_TYPES.every((t) => s.has(t))) return "For: AllDays";
  const parts: string[] = [];
  if (["monday", "tuesday", "wednesday", "thursday", "friday"].every((t) => s.has(t as DayType))) { parts.push("Weekdays"); for (const t of ["monday", "tuesday", "wednesday", "thursday", "friday"]) s.delete(t as DayType); }
  if (WEEKEND_T.every((t) => s.has(t))) { parts.push("Weekends"); WEEKEND_T.forEach((t) => s.delete(t)); }
  for (const t of DAY_TYPES) if (s.has(t)) parts.push(KEYWORD[t]);
  return `For: ${parts.join(" ")}`;
}

const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const md = (n: number): string => { const d = monthDayOf(n); return `${d.month}/${d.day}`; };
const hhmm = (h: number): string => `${String(h).padStart(2, "0")}:00`;
/** a value exactly as read — never rounded (the examples carry 0.837199999999997) */
const fmt = (v: number): string => String(v);

/** the 24 hours a part runs, as the parts stand (All Days: every part is the one profile) */
export const hoursOfPart = (s: PartSchedule, k: PartKey): number[] => (s.mode === "all" ? s.hours.all : s.hours[k]);

/** the rules of a block: the parts' day types, equal profiles on one line; in a season block every non-design day type
 *  takes the Seasonal profile */
function rulesOf(s: PartSchedule, inSeason: boolean): Array<{ types: DayType[]; hours: number[] }> {
  if (s.mode === "all") return [{ types: [...DAY_TYPES], hours: s.hours.all }];
  const groups: Array<{ types: DayType[]; hours: number[] }> = [];
  const add = (types: DayType[], hours: number[]): void => { const g = groups.find((x) => same(x.hours, hours)); if (g) g.types.push(...types); else groups.push({ types: [...types], hours }); };
  if (inSeason) add([...WEEKDAY_T, ...WEEKEND_T, "holiday"], s.hours.seasonal);
  else for (const k of ["weekdays", "weekends", "holiday"] as const) add(TYPES_OF[k], s.hours[k]);
  add(["summerdesignday"], s.hours.summerDD);
  add(["winterdesignday"], s.hours.winterDD);
  return groups;
}

/** the date blocks: runs of days in or out of the season */
export function periodsOf(s: PartSchedule): SchedulePeriod[] {
  const inS = new Set(s.mode === "split" && s.season ? s.season.days : []);
  const out: SchedulePeriod[] = [];
  for (let n = 1; n <= 365;) {
    let e = n;
    while (e < 365 && inS.has(e + 1) === inS.has(n)) e++;
    out.push({ from: n, to: e, rules: rulesOf(s, inS.has(n)).map((r) => ({ types: new Set(r.types), hours: [...r.hours] })) });
    n = e + 1;
  }
  return out;
}

/** THE SCHEDULE IN PARTS AS ONE Schedule:Compact */
export function compactOfParts(name: string, typeLimits: string | null, s: PartSchedule, file: string): IdfObject {
  const fields: string[] = [name, typeLimits ?? ""];
  for (const per of periodsOf(s)) {
    fields.push(`Through: ${md(per.to)}`);
    for (const r of per.rules) {
      fields.push(forOf([...r.types]));
      for (let i = 0; i < 24; i++) if (i === 23 || !Object.is(r.hours[i + 1], r.hours[i])) fields.push(`Until: ${hhmm(i + 1)}`, fmt(r.hours[i]!));
    }
  }
  return { cls: "Schedule:Compact", name, fields, file } as IdfObject;
}

/** the 24 hours a schedule gives day type t on day n (its own date block), or null */
function at(p: ScheduleProfile, n: number, t: DayType): number[] | null {
  const per = p.periods.find((x) => n >= x.from && n <= x.to);
  const r = per ? ruleWith(per.rules, t) : null;
  return r ? r.hours : null;
}
const CHECKED: DayType[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "holiday", "summerdesignday", "winterdesignday"];

/** do two schedules give the same 24 hours on every day of the year for every day type that can occur (custom days aside) */
export function sameYear(a: ScheduleProfile, b: ScheduleProfile): boolean {
  for (let n = 1; n <= 365; n++) for (const t of CHECKED) {
    const x = at(a, n, t), y = at(b, n, t);
    if (!x !== !y || (x && y && !same(x, y))) return false;
  }
  return true;
}

/** A SCHEDULE READ INTO PARTS — or why it cannot be, in words. The season is named from the user's own seasons (and the
 *  starting ones) when its days match one, else "season of <name>". */
export function partsOf(p: ScheduleProfile, seasons: DaySetDef[]): { parts: PartSchedule } | { reason: string } {
  if (p.problem) return { reason: p.problem };
  // each day's signature: the hours of every day type that can occur
  const sig = (n: number): string | null => { const hs = CHECKED.map((t) => at(p, n, t)); return hs.some((h) => !h) ? null : JSON.stringify(hs); };
  const bySig = new Map<string, number[]>();
  for (let n = 1; n <= 365; n++) {
    const s = sig(n);
    if (s === null) { const miss = CHECKED.filter((t) => !at(p, n, t)); return { reason: `no profile for ${miss.join(", ")} on ${md(n)}` }; }
    (bySig.get(s) ?? bySig.set(s, []).get(s)!).push(n);
  }
  if (bySig.size > 2) return { reason: `${bySig.size} different sets of day profiles over the year — the buttons hold the year and one season` };
  const groups = [...bySig.values()].sort((a, b) => b.length - a.length);
  const base = groups[0]!, season = groups[1] ?? null;
  const b0 = base[0]!;
  const wk = at(p, b0, "monday")!;
  if (WEEKDAY_T.slice(0, 5).some((t) => !same(at(p, b0, t)!, wk))) return { reason: "its weekdays differ from one another — the buttons hold one Weekdays profile" };
  const we = at(p, b0, "saturday")!;
  if (!same(at(p, b0, "sunday")!, we)) return { reason: "its Saturday and Sunday differ — the buttons hold one Weekends profile" };
  const hours: Record<PartKey, number[]> = {
    all: [...wk], weekdays: [...wk], weekends: [...we], holiday: [...at(p, b0, "holiday")!], seasonal: [...wk],
    summerDD: [...at(p, b0, "summerdesignday")!], winterDD: [...at(p, b0, "winterdesignday")!],
  };
  let def: DaySetDef | null = null;
  if (season) {
    const s0 = season[0]!, sh = at(p, s0, "monday")!;
    if ((["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "holiday"] as DayType[]).some((t) => !same(at(p, s0, t)!, sh)))
      return { reason: "its second set of dates has its own weekdays and weekends — the Seasonal profile is one for every day of the season" };
    if (!same(at(p, s0, "summerdesignday")!, hours.summerDD) || !same(at(p, s0, "winterdesignday")!, hours.winterDD))
      return { reason: "its design days differ between its date blocks — the buttons hold one Summer DD and one Winter DD" };
    hours.seasonal = [...sh];
    const known = seasons.find((x) => x.days.length === season.length && x.days.every((d, i) => d === season[i]));
    def = { id: known?.id ?? `season of ${p.name}`, days: [...season] };
  }
  const allSame = SPLIT_KEYS.filter((k) => k !== "seasonal").every((k) => same(hours[k], hours.weekdays));
  return { parts: { mode: allSame && !def ? "all" : "split", hours, season: def } };
}

/** the parts after a part is picked: from All Days a pick splits every part from the one profile */
export function splitFrom(s: PartSchedule): PartSchedule {
  if (s.mode === "split") return s;
  const h = s.hours.all;
  return { ...s, mode: "split", hours: { all: [...h], weekdays: [...h], weekends: [...h], holiday: [...h], seasonal: [...h], summerDD: [...h], winterDD: [...h] } };
}
/** back to All Days (the user, 2026-10-05: "clicking All Days applies the hourly schedule to every day"): the profile shown
 *  — the part picked — becomes every day's; what that discards, in words (null: nothing) */
export function joinWords(s: PartSchedule, from: PartKey = "weekdays"): string | null {
  if (s.mode === "all") return null;
  const src = from === "all" ? "weekdays" : from;
  const differ = SPLIT_KEYS.filter((k) => k !== src && (k !== "seasonal" || !!s.season) && !same(s.hours[k], s.hours[src])).map((k) => PART_LABELS[k]);
  const words = [...differ.map((w) => `${w}' own profile`), ...(s.season ? [`the season "${s.season.id}"`] : [])];
  return words.length ? words.join(", ") : null;
}
export function joinAll(s: PartSchedule, from: PartKey = "weekdays"): PartSchedule {
  const src = from === "all" ? "weekdays" : from;
  return { ...s, mode: "all", hours: { ...s.hours, all: [...s.hours[src]] }, season: null };
}

/** THE SEASONS TO START FROM: the engine's year, whole months */
const span = (m1: number, d1: number, m2: number, d2: number): number[] => { const a = dayOfYear(m1, d1), b = dayOfYear(m2, d2); return Array.from({ length: b - a + 1 }, (_, i) => a + i); };
export const SEASON_PRESETS: DaySetDef[] = [
  { id: "Summer (Jun 1 – Sep 30)", days: span(6, 1, 9, 30) },
  { id: "Winter (Dec 1 – Mar 31)", days: [...span(1, 1, 3, 31), ...span(12, 1, 12, 31)] },
];

/** the days in words: "92 days, 6/1 – 9/30" or the runs */
export function daysWords(days: number[]): string {
  if (!days.length) return "no days";
  const runs: string[] = [];
  const s = [...days].sort((a, b) => a - b);
  for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++; runs.push(i === j ? md(s[i]!) : `${md(s[i]!)} – ${md(s[j]!)}`); i = j + 1; }
  return `${s.length} day${s.length === 1 ? "" : "s"}: ${runs.length > 6 ? `${runs.slice(0, 6).join(", ")} … (${runs.length} runs)` : runs.join(", ")}`;
}

/** an ID's problem, or null: a name the engine never reads, but the user's library keys on it */
export function idProblem(id: string, taken: string[], own: string | null): string | null {
  const t = id.trim();
  if (!t) return "type an ID";
  if (t.length > 60) return "at most 60 characters";
  if (taken.some((x) => x.toLowerCase() === t.toLowerCase() && x.toLowerCase() !== (own ?? "").toLowerCase())) return `"${t}" is taken — choose another ID`;
  return null;
}

/** THE USER'S CALENDARS (data/calendars-user.json, every project): their holiday lists and seasons, by ID */
export const USER_CALENDAR_FILE = "calendars-user.json";
export interface UserCalendars { holidays: DaySetDef[]; seasons: DaySetDef[] }
export function readUserCalendars(text: string | null): UserCalendars {
  if (!text) return { holidays: [], seasons: [] };
  try {
    const j = JSON.parse(text) as Partial<UserCalendars>;
    const ok = (x: unknown): x is DaySetDef => !!x && typeof (x as DaySetDef).id === "string" && Array.isArray((x as DaySetDef).days) && (x as DaySetDef).days.every((n) => Number.isInteger(n) && n >= 1 && n <= 365);
    return { holidays: (j.holidays ?? []).filter(ok), seasons: (j.seasons ?? []).filter(ok) };
  } catch { return { holidays: [], seasons: [] }; }
}
/** the file with one set kept (the earlier one of that ID replaced) */
export function keepInCalendars(prev: UserCalendars, kind: "holidays" | "seasons", def: DaySetDef): UserCalendars {
  const lc = def.id.trim().toLowerCase();
  return { ...prev, [kind]: [...prev[kind].filter((x) => x.id.toLowerCase() !== lc), { id: def.id.trim(), days: [...new Set(def.days)].sort((a, b) => a - b) }] };
}
export const calendarsText = (c: UserCalendars): string => `${JSON.stringify({
  note: "YOUR holiday lists and seasons (BIM-BEM-BOM, BEM › SCHEDULES, the frame under the calendar): days of the engine's year " + ENGINE_CALENDAR.year + ", 1 = Jan 1. Read by every project.",
  holidays: c.holidays, seasons: c.seasons }, null, 2)}\n`;
