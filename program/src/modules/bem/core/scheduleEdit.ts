// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE DAY PROFILE EDITOR (user, 2026-10-05): "use the frame below the calendar view for defining day profiles for the
// selected schedule … a bar graph of 24 bars (one per hour), with each bar edit showing a 0.0 to 1.0 input … a Name box
// for the schedule (reference name for unedited schedule), which is editable upon any edit … so that a custom schedule
// can be saved." The user's rulings the same day: every day profile the schedule defines is editable (a chip each, per
// date block); a saved schedule goes to THE USER'S LIBRARY, every project (data/schedules-user.idf, read beside the
// engine's two files); setpoints edit in °F/°C; a save stages it for the role being edited.
//
// A day profile is one RULE of one date block, as the engine evaluates it (ScheduleManager.cc: the last "For:" naming a
// day type wins). Nothing is authored but the hours the user types: the edited schedule keeps the source's date blocks,
// its day types and its type limits, and is written as ONE Schedule:Compact — each block a "Through:", each rule a
// "For:" over the day types it actually governs (disjoint, so the engine never sees a day assigned twice), each run of
// equal hours one "Until:". An unedited schedule written this way evaluates to the source's own 8,760 values (the gate).

import type { IdfObject, Library } from "./idfLib.js";
import { parseScheduleObjects, readProfile, ruleWith, objectText, isTopLevelSchedule, DAY_TYPES, type DayType, type ScheduleProfile, type SchedulePeriod, type ScheduleRole, ROLE_KIND } from "./schedules.js";
import { monthDayOf } from "../../../core/sun.js";
import { compactOfParts, type PartSchedule } from "./scheduleParts.js";

/** the user's schedule library, in the data folder beside materials-user.json: plain IDF, read by every project */
export const USER_SCHEDULE_FILE = "schedules-user.idf";
export const isUserSchedule = (p: { file: string }): boolean => p.file.split("/").pop() === USER_SCHEDULE_FILE;

const WEEKDAYS: DayType[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const WEEKEND: DayType[] = ["saturday", "sunday"];
/** the engine's own keyword for each day type (the Schedule:Compact "For:" choices) */
const KEYWORD: Record<DayType, string> = {
  sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday",
  holiday: "Holiday", summerdesignday: "SummerDesignDay", winterdesignday: "WinterDesignDay", customday1: "CustomDay1", customday2: "CustomDay2",
};
const WORD: Record<DayType, string> = {
  sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday",
  holiday: "Holiday", summerdesignday: "summer design day", winterdesignday: "winter design day", customday1: "custom day 1", customday2: "custom day 2",
};

/** the day types each rule of a period actually governs: a type belongs to the LAST rule naming it, as the engine reads */
export function governed(period: SchedulePeriod): DayType[][] {
  const out: DayType[][] = period.rules.map(() => []);
  for (const t of DAY_TYPES) {
    const r = ruleWith(period.rules, t);
    if (r) out[period.rules.indexOf(r)]!.push(t);
  }
  return out;
}

/** the day types in words: "Weekdays", "Weekends", "All days", the rest by name */
export function dayTypesWords(types: DayType[]): string {
  if (types.length === DAY_TYPES.length) return "All days";
  const s = new Set(types), parts: string[] = [];
  if (WEEKDAYS.every((d) => s.has(d))) { parts.push("Weekdays"); WEEKDAYS.forEach((d) => s.delete(d)); }
  if (WEEKEND.every((d) => s.has(d))) { parts.push("Weekends"); WEEKEND.forEach((d) => s.delete(d)); }
  for (const t of DAY_TYPES) if (s.has(t)) parts.push(WORD[t]);
  return parts.join(" · ") || "no day";
}
/** the "For:" field for a set of day types, in the engine's keywords (several on one line, as the I/O Reference allows) */
export function forField(types: DayType[]): string {
  if (types.length === DAY_TYPES.length) return "For: AllDays";
  const s = new Set(types), parts: string[] = [];
  if (WEEKDAYS.every((d) => s.has(d))) { parts.push("Weekdays"); WEEKDAYS.forEach((d) => s.delete(d)); }
  if (WEEKEND.every((d) => s.has(d))) { parts.push("Weekends"); WEEKEND.forEach((d) => s.delete(d)); }
  for (const t of DAY_TYPES) if (s.has(t)) parts.push(KEYWORD[t]);
  return `For: ${parts.join(" ")}`;
}

const md = (n: number): string => { const d = monthDayOf(n); return `${d.month}/${d.day}`; };

/** ONE EDITABLE DAY PROFILE: a rule of a date block and the day types it governs */
export interface DayProfile { key: string; period: number; rule: number; from: number; to: number; types: DayType[]; label: string; hours: number[] }
/** every day profile of a schedule — a rule that governs no day (overridden by later ones) is left out */
export function dayProfilesOf(p: ScheduleProfile): DayProfile[] {
  const out: DayProfile[] = [];
  const many = p.periods.length > 1;
  p.periods.forEach((per, pi) => {
    const g = governed(per);
    per.rules.forEach((r, ri) => {
      if (!g[ri]!.length) return;
      out.push({ key: `${pi}:${ri}`, period: pi, rule: ri, from: per.from, to: per.to, types: g[ri]!, label: `${dayTypesWords(g[ri]!)}${many ? ` · ${md(per.from)}–${md(per.to)}` : ""}`, hours: [...r.hours] });
    });
  });
  return out;
}
/** the day profile a day of the run takes: its date block, its day type (a holiday's, when the calendar names one) */
export function dayProfileOn(list: DayProfile[], p: ScheduleProfile, n: number, type: DayType): string | null {
  const pi = p.periods.findIndex((x) => n >= x.from && n <= x.to);
  if (pi < 0) return null;
  return list.find((d) => d.period === pi && d.types.includes(type))?.key ?? null;
}

/** the edits: a day profile's key → its 24 hours (NaN = not typed yet, in a new schedule) */
export type DayEdits = Record<string, number[]>;
export const isEdited = (list: DayProfile[], edits: DayEdits): boolean =>
  list.some((d) => edits[d.key] && edits[d.key]!.some((v, h) => !Object.is(v, d.hours[h])));

/** a value exactly as read (the shortest text that reads back to the same number) — never rounded: the examples carry 0.837199999999997 */
const fmt = (v: number): string => String(v);
const hhmm = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** THE EDITED SCHEDULE AS ONE Schedule:Compact: the source's blocks and governed day types, the edited hours */
export function compactOf(name: string, typeLimits: string | null, periods: SchedulePeriod[]): IdfObject {
  const fields: string[] = [name, typeLimits ?? ""];
  for (const per of periods) {
    fields.push(`Through: ${md(per.to)}`);
    const g = governed(per);
    per.rules.forEach((r, ri) => {
      if (!g[ri]!.length) return;
      fields.push(forField(g[ri]!));
      for (let i = 0; i < 24; i++) if (i === 23 || r.hours[i + 1] !== r.hours[i]) fields.push(`Until: ${hhmm(i + 1)}`, fmt(r.hours[i]!));
    });
  }
  return { cls: "Schedule:Compact", name, fields, file: USER_SCHEDULE_FILE } as IdfObject;
}

/** the source's periods with the edits laid over them (each rule's hours copied — a Year's shared day is edited in one place only) */
export function editedPeriods(p: ScheduleProfile, edits: DayEdits): SchedulePeriod[] {
  return p.periods.map((per, pi) => ({ from: per.from, to: per.to, rules: per.rules.map((r, ri) => ({ types: new Set(r.types), hours: [...(edits[`${pi}:${ri}`] ?? r.hours)] })) }));
}

/** THE DRAFT: the edited schedule as a profile the calendar paints, and the objects a save writes (its type limits, itself) */
export function draftOf(lib: Library, p: ScheduleProfile, edits: DayEdits, name: string): { profile: ScheduleProfile; object: IdfObject; limits: IdfObject | null } {
  const object = compactOf(name, p.typeLimits, editedPeriods(p, edits));
  const limits = p.chain.find((o) => o.cls === "ScheduleTypeLimits") ?? null;
  const limitsCopy = limits ? ({ ...limits, file: USER_SCHEDULE_FILE } as IdfObject) : null;
  // read back through the same reader the library uses: what the calendar paints is what the engine will be given
  const scratch: Library = { ...lib, byClass: new Map(lib.byClass), objects: lib.objects };
  if (limitsCopy) scratch.byClass.set("ScheduleTypeLimits", [limitsCopy, ...(lib.byClass.get("ScheduleTypeLimits") ?? [])]);
  const profile = readProfile(scratch, object);
  return { profile, object, limits: limitsCopy };
}

/** THE DRAFT IN PARTS (the editor's buttons, 2026-10-05): the schedule as its parts write it, read back the same way */
export function draftOfParts(lib: Library, p: ScheduleProfile, parts: PartSchedule, name: string): { profile: ScheduleProfile; object: IdfObject; limits: IdfObject | null } {
  const object = compactOfParts(name, p.typeLimits, parts, USER_SCHEDULE_FILE);
  const limits = p.chain.find((o) => o.cls === "ScheduleTypeLimits") ?? null;
  const limitsCopy = limits ? ({ ...limits, file: USER_SCHEDULE_FILE } as IdfObject) : null;
  const scratch: Library = { ...lib, byClass: new Map(lib.byClass), objects: lib.objects };
  if (limitsCopy) scratch.byClass.set("ScheduleTypeLimits", [limitsCopy, ...(lib.byClass.get("ScheduleTypeLimits") ?? [])]);
  return { profile: readProfile(scratch, object), object, limits: limitsCopy };
}

/** A NEW SCHEDULE (a role with no schedule object to start from): one block, every day type, 24 hours not yet typed */
export function blankProfile(lib: Library, role: ScheduleRole): ScheduleProfile {
  const temp = ROLE_KIND[role] === "temperature";
  // the type limits named by the engine's own files, by name — "Fraction" (0…1, continuous), "Temperature"
  const limitsName = temp ? "Temperature" : "Fraction";
  const limits = (lib.byClass.get("ScheduleTypeLimits") ?? []).find((o) => o.name.toLowerCase() === limitsName.toLowerCase()) ?? null;
  const hours = Array(24).fill(NaN) as number[];
  return {
    name: "", file: "", cls: "Schedule:Compact", typeLimits: limits?.name ?? null, limits: null,
    weekday: hours, weekend: hours, blocks: 1, dayTypes: ["AllDays"], min: NaN, max: NaN, constant: null,
    chain: limits ? [limits] : [], periods: [{ from: 1, to: 365, rules: [{ types: new Set(DAY_TYPES), hours }] }], problem: null,
  };
}

/** the range an hour takes: a fraction role its type limits (0…1 when none is stated; whole numbers when discrete), a
 *  setpoint role a room temperature 5…40 °C — the bounds the setpoint picker already uses (fitsRole) */
export function hourRange(p: ScheduleProfile, role: ScheduleRole): { lo: number; hi: number; discrete: boolean } {
  if (ROLE_KIND[role] === "temperature") return { lo: 5, hi: 40, discrete: false };
  const lo = p.limits?.lo ?? 0, hi = p.limits?.hi ?? 1;
  return { lo: Math.max(0, lo), hi: Math.min(1, hi), discrete: !!p.limits?.discrete };
}
/** an hour as typed → its value in SI (°C for a setpoint typed in °F), or why it is refused */
export function parseHour(text: string, range: { lo: number; hi: number; discrete: boolean }, temp: boolean, imperial: boolean): { value: number } | { error: string } {
  const t = text.trim();
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return { error: `"${text}" is not a number` };
  const typed = Number(t);
  const v = temp && imperial ? (typed - 32) * 5 / 9 : typed;
  const show = (x: number): string => (temp ? (imperial ? `${(x * 9 / 5 + 32).toFixed(1)} °F` : `${x.toFixed(1)} °C`) : String(x));
  if (v < range.lo - 1e-9 || v > range.hi + 1e-9) return { error: `${t} is outside ${show(range.lo)} – ${show(range.hi)}` };
  if (range.discrete && !Number.isInteger(v)) return { error: `the schedule's type limits are discrete: ${show(range.lo)} or ${show(range.hi)}` };
  return { value: temp ? Number(v.toFixed(4)) : v };
}

/** why a name cannot be saved, or null: an IDF name has no comma, semicolon or "!"; it may not repeat a schedule the
 *  library holds (the engine's names are case-insensitive) — except the one of yours being re-saved under its own name */
export function nameProblem(name: string, lib: Library, resaving: string | null): string | null {
  const n = name.trim();
  if (!n) return "type a name";
  if (/[,;!]/.test(n)) return "a name cannot hold a comma, a semicolon or \"!\"";
  if (n.length > 100) return "at most 100 characters";
  const clash = lib.objects.find((o) => isTopLevelSchedule(o.cls) && o.name.toLowerCase() === n.toLowerCase());
  if (!clash) return null;
  if (resaving && resaving.toLowerCase() === n.toLowerCase() && isUserSchedule(clash)) return null;
  return isUserSchedule(clash) ? `"${clash.name}" is already one of your schedules — choose another name` : `"${clash.name}" is in ${clash.file.split("/").pop()} — choose another name`;
}

/** THE USER'S FILE: its schedule objects and each one's note (the "! <name> — …" line written above it) */
export function readUserFile(text: string | null): { objects: IdfObject[]; notes: Map<string, string> } {
  if (!text) return { objects: [], notes: new Map() };
  const notes = new Map<string, string>();
  for (const m of text.matchAll(/^! ◆ (.+?) — (.+)$/gm)) notes.set(m[1]!.toLowerCase(), m[2]!);
  return { objects: parseScheduleObjects(text, USER_SCHEDULE_FILE), notes };
}
/** the file with one schedule saved into it (a schedule of the same name replaced); type limits once each, by name */
export function writeUserFile(prev: { objects: IdfObject[]; notes: Map<string, string> }, save: { object: IdfObject; limits: IdfObject | null; note: string }): { text: string; objects: IdfObject[]; notes: Map<string, string> } {
  const lc = (s: string): string => s.toLowerCase();
  const scheds = prev.objects.filter((o) => o.cls !== "ScheduleTypeLimits" && lc(o.name) !== lc(save.object.name));
  scheds.push(save.object);
  const limits = new Map<string, IdfObject>();
  for (const o of prev.objects) if (o.cls === "ScheduleTypeLimits") limits.set(lc(o.name), o);
  if (save.limits && !limits.has(lc(save.limits.name))) limits.set(lc(save.limits.name), save.limits);
  const used = new Set(scheds.map((o) => lc(o.fields[1] ?? "")));
  const keep = [...limits.values()].filter((o) => used.has(lc(o.name)));
  const notes = new Map(prev.notes);
  notes.set(lc(save.object.name), save.note);
  const text = [
    "! schedules-user.idf — YOUR schedules: the day profiles you edited in Enthalix (BEM › SCHEDULES, the frame under the calendar).",
    "! Every project's library reads this file beside the engine's own two. Each schedule is one Schedule:Compact; the type limits it names follow.",
    "",
    ...keep.map((o) => objectText(o)),
    "",
    ...scheds.flatMap((o) => [`! ◆ ${o.name} — ${notes.get(lc(o.name)) ?? "saved by hand"}`, objectText(o), ""]),
  ].join("\n");
  const objects = [...keep.map((o) => ({ ...o, file: USER_SCHEDULE_FILE }) as IdfObject), ...scheds.map((o) => ({ ...o, file: USER_SCHEDULE_FILE }) as IdfObject)];
  return { text, objects, notes };
}

/** the library with the user's schedules in it (the earlier copy of the user's file replaced) */
export function withUserSchedules(lib: Library, objs: IdfObject[]): Library {
  const objects = [...lib.objects.filter((o) => o.file !== USER_SCHEDULE_FILE), ...objs];
  const byClass = new Map<string, IdfObject[]>();
  const census: Record<string, number> = {};
  for (const o of objects) {
    (byClass.get(o.cls) ?? byClass.set(o.cls, []).get(o.cls)!).push(o);
    census[o.cls] = (census[o.cls] ?? 0) + 1;
  }
  // byName keeps what else was put there (materials.db's rows, withMaterials): only the user's file's entries are replaced
  const byName = new Map([...lib.byName].filter(([, o]) => o.file !== USER_SCHEDULE_FILE));
  for (const o of objs) if (!byName.has(o.name)) byName.set(o.name, o);
  return { ...lib, objects, byClass, byName, census, files: [...new Set([...lib.files.filter((f) => f !== USER_SCHEDULE_FILE), ...(objs.length ? [USER_SCHEDULE_FILE] : [])])] };
}

/** THE PROJECT'S COPY of one of the user's schedules (2026-10-05): its type limits and itself, as IDF text — what the
 *  ledger keeps, so the project runs on the schedule as applied whatever the user's file later holds; null: not the user's */
export function copyTextOf(lib: Library, name: string): string | null {
  const o = lib.objects.find((x) => isUserSchedule(x) && isTopLevelSchedule(x.cls) && x.name.toLowerCase() === name.toLowerCase());
  if (!o) return null;
  const lim = o.fields[1] ? lib.objects.find((x) => x.cls === "ScheduleTypeLimits" && x.name.toLowerCase() === o.fields[1]!.toLowerCase()) : null;
  return [...(lim ? [objectText(lim)] : []), objectText(o)].join("\n");
}
/** the library with the project's copies standing in for the user's schedules of the same names (added when the user's
 *  file no longer holds them); type limits once each, by name */
export function withProjectCopies(lib: Library, copies: Record<string, string> | undefined): Library {
  if (!copies || !Object.keys(copies).length) return lib;
  const lc = (s: string): string => s.toLowerCase();
  const fromCopies = Object.values(copies).flatMap((t) => parseScheduleObjects(t, USER_SCHEDULE_FILE));
  const names = new Set(fromCopies.filter((o) => o.cls !== "ScheduleTypeLimits").map((o) => lc(o.name)));
  const mine = lib.objects.filter((o) => isUserSchedule(o) && !(o.cls !== "ScheduleTypeLimits" && names.has(lc(o.name))));
  const limits = new Set(mine.filter((o) => o.cls === "ScheduleTypeLimits").map((o) => lc(o.name)));
  const added = fromCopies.filter((o) => o.cls !== "ScheduleTypeLimits" || (!limits.has(lc(o.name)) && (limits.add(lc(o.name)), true)));
  return withUserSchedules(lib, [...mine, ...added]);
}
