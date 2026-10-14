// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SCHEDULES — the engine's own profiles, READ (2026-09-09). Nothing here is
// authored: a schedule the model runs on is either the code default the
// writer always used (always on; a constant setpoint per zone) or an object
// picked out of the engine's own files — DataSets/Schedules.idf (the
// commercial building types, the multifamily profiles and the constants)
// and the single-family example beside it (the Building America residential
// profiles and the HERS reference setpoints) — emitted verbatim with the
// week and day objects and the type limits it names. This file turns any of
// them into a 24-hour reading (weekday, weekend) the screen draws and the
// gate checks against the file's own numbers; the same objects reach the IDF.

import { parseIdfObjects, type IdfObject, type Library } from "./idfLib.js";
import { dayOfYear } from "../../../core/sun.js";

/** THE EQUIPMENT GROUPS' ROLES (user, 2026-10-03: "expand occupant equipment loads for both Schedules and Zones tabs" — cooking,
 *  refrigeration, dishwasher, laundry, charging, entertainment, work): a group's role, ruled, takes that group's rows; the
 *  `equipment` role, ruled, takes every row whose group's role is not */
export const EQUIPMENT_GROUP_ROLES = ["cooking", "refrigeration", "dishwasher", "laundry", "charging", "entertainment", "work"] as const;
/** THE WATER ROLES (user, 2026-10-03: "We need both Domestic Hot Water and Domestic Water schedules"): the hot water's draw on the
 *  water heaters' tanks, and the household's whole water use the well pump lifts */
export const WATER_ROLES = ["hot-water", "domestic-water"] as const;
export const SCHEDULE_ROLES = ["occupancy", "lighting", "equipment", ...EQUIPMENT_GROUP_ROLES, ...WATER_ROLES, "infiltration", "ventilation", "hvac-availability", "heating-setpoint", "cooling-setpoint"] as const;
export type ScheduleRole = (typeof SCHEDULE_ROLES)[number];
export const ROLE_LABELS: Record<ScheduleRole, string> = {
  occupancy: "occupancy", lighting: "lighting", equipment: "equipment (every load)", infiltration: "infiltration", ventilation: "ventilation",
  "hot-water": "domestic hot water", "domestic-water": "domestic water",
  cooking: "cooking (range)", refrigeration: "refrigeration", dishwasher: "dishwasher", laundry: "laundry (washer, dryer)", charging: "charging (cars, tools)", entertainment: "entertainment (TV, stereo)", work: "work (computers, printers)",
  "hvac-availability": "HVAC availability", "heating-setpoint": "heating setpoint", "cooling-setpoint": "cooling setpoint",
};
/** what a role's schedule states: a fraction of a design level (0…1, on/off included) or a temperature */
export const ROLE_KIND: Record<ScheduleRole, "fraction" | "temperature"> = {
  occupancy: "fraction", lighting: "fraction", equipment: "fraction", infiltration: "fraction", ventilation: "fraction",
  "hot-water": "fraction", "domestic-water": "fraction",
  cooking: "fraction", refrigeration: "fraction", dishwasher: "fraction", laundry: "fraction", charging: "fraction", entertainment: "fraction", work: "fraction",
  "hvac-availability": "fraction", "heating-setpoint": "temperature", "cooling-setpoint": "temperature",
};
/** the object that takes the role's schedule — People / Lights / ElectricEquipment per room since 2026-09-13 (bemGains.ts); ventilation's waits on a SYSTEMS ruling */
export const ROLE_CONSUMER: Record<ScheduleRole, string | null> = {
  occupancy: "People", lighting: "Lights", equipment: "ElectricEquipment", ventilation: "ZoneVentilation:DesignFlowRate",
  "hot-water": "WaterHeater:Stratified", "domestic-water": "Exterior:FuelEquipment",
  cooking: "ElectricEquipment", refrigeration: "ElectricEquipment", dishwasher: "ElectricEquipment", laundry: "ElectricEquipment", charging: "ElectricEquipment", entertainment: "ElectricEquipment", work: "ElectricEquipment",
  infiltration: "ZoneInfiltration:DesignFlowRate", "hvac-availability": "HVACTemplate:Zone:IdealLoadsAirSystem",
  "heating-setpoint": "HVACTemplate:Thermostat", "cooling-setpoint": "HVACTemplate:Thermostat",
};
/** the PROFILE a role runs on with no ruling, where the default is one of the library's own (2026-09-13): the gains' schedules from the
 *  engine's single-family example; the plug loads' MiscPlugLoad stands for the equipment role (each appliance has its own) */
export const DEFAULT_PROFILE_REF: Partial<Record<ScheduleRole, ScheduleRef>> = {
  occupancy: { file: "SingleFamilyHouse_HP_Slab.idf", name: "Occupancy" },
  lighting: { file: "SingleFamilyHouse_HP_Slab.idf", name: "InteriorLightingHE" },
  equipment: { file: "SingleFamilyHouse_HP_Slab.idf", name: "MiscPlugLoad" },
  cooking: { file: "SingleFamilyHouse_HP_Slab.idf", name: "CookingRange" },
  refrigeration: { file: "SingleFamilyHouse_HP_Slab.idf", name: "Refrigerator" },
  dishwasher: { file: "SingleFamilyHouse_HP_Slab.idf", name: "DishWasher" },
};
/** what the model runs on for a role with no ruling — the writer's own defaults, in words */
export const CODE_DEFAULT_SCHEDULE: Record<ScheduleRole, string> = {
  occupancy: "the engine's example's Building America Occupancy profile (SingleFamilyHouse_HP_Slab.idf) on every room's People",
  lighting: "the engine's example's InteriorLightingHE profile on every room's Lights",
  equipment: "each appliance's own Building America profile (the example's DishWasher, Refrigerator, ClothesWasher, ClothesDryer, CookingRange), MiscPlugLoad for the rest; a group's own role, ruled, takes its rows",
  "hot-water": "the example's Building America shower, sink and bath profiles (BA_shower_sch, BA_sink_sch, BA_bath_sch) weighted by their peak flows — one hourly shape on every tank's draw (SYSTEMS › PLUMBING)",
  "domestic-water": "the domestic hot water's shape — no published hourly shape of a household's whole water use was read; the well pump runs on it (SYSTEMS › PLUMBING › Domestic Water)",
  cooking: "the example's CookingRange profile on the range",
  refrigeration: "the example's Refrigerator profile",
  dishwasher: "the example's DishWasher profile",
  laundry: "the example's ClothesWasher profile on the washer, ClothesDryer on the dryer",
  charging: "no profile in the example — a charging row runs on the equipment role, else the example's MiscPlugLoad",
  entertainment: "no profile in the example (its television is 0 W) — a row runs on the equipment role, else the example's MiscPlugLoad",
  work: "no profile in the example — a row runs on the equipment role, else the example's MiscPlugLoad",
  ventilation: "none — no ventilation until ZONES rules it",
  infiltration: "always on (Schedule:Constant 1)",
  "hvac-availability": "always available (the template's default, no schedule)",
  "heating-setpoint": "a constant per zone — 22.22 °C (72 °F), the IECC R405 standard reference design, or the zone's ruling",
  "cooling-setpoint": "a constant per zone — 23.89 °C (75 °F), the IECC R405 standard reference design, or the zone's ruling",
};

/** the files READ for the library, relative to the engine's install directory, each with what it holds */
export const SCHEDULE_FILES = [
  { path: "DataSets/Schedules.idf", note: "the engine's DataSets: occupancy, lighting, HVAC and service-water profiles by building type, the multifamily profiles, the constants" },
  { path: "ExampleFiles/SingleFamilyHouse_HP_Slab.idf", note: "the engine's single-family example: the Building America residential profiles (occupancy, lighting, appliances) and the HERS reference setpoints" },
] as const;
export const scheduleFileName = (p: string): string => p.split("/").pop() ?? p;
/** an object that belongs in the schedule library: the schedules themselves and their type limits */
export const isScheduleClass = (cls: string): boolean => cls === "ScheduleTypeLimits" || cls.startsWith("Schedule:");
/** one of the schedule files → its schedule objects only (the example file also carries a whole model), keyed by the file's base name */
export const parseScheduleObjects = (text: string, file: string): IdfObject[] => parseIdfObjects(text, scheduleFileName(file)).filter((o) => isScheduleClass(o.cls));
/** a schedule an object can name (the top level — a week or a day is only part of a year) */
export const isTopLevelSchedule = (cls: string): boolean => cls === "Schedule:Compact" || cls === "Schedule:Constant" || cls === "Schedule:Year" || cls === "Schedule:File";

export interface ScheduleLimits { name: string; lo: number | null; hi: number | null; discrete: boolean }
/** THE ENGINE'S TWELVE DAY TYPES (ScheduleManager.cc), in the Week:Daily field order */
export type DayType = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "holiday" | "summerdesignday" | "winterdesignday" | "customday1" | "customday2";
export const DAY_TYPES: DayType[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "holiday", "summerdesignday", "winterdesignday", "customday1", "customday2"];
/** a rule of a period: the day types it covers and its 24 hourly values (hour h = the hour ending at h+1) */
export interface ScheduleRule { types: Set<DayType>; hours: number[] }
/** a date block — a Through: … of a Schedule:Compact, a week period of a Schedule:Year — by day of the year, inclusive */
export interface SchedulePeriod { from: number; to: number; rules: ScheduleRule[] }
export interface ScheduleProfile {
  name: string; file: string; cls: string;
  typeLimits: string | null;
  limits: ScheduleLimits | null;
  /** the 24 hourly values of a weekday and of a weekend day in the schedule's FIRST date block — hour h is the hour ending at h+1 */
  weekday: number[]; weekend: number[];
  /** date blocks (Through: … / Schedule:Year periods) — the strips draw the first; the object carries them all */
  blocks: number;
  /** the day types the first block names, as written */
  dayTypes: string[];
  /** the least and greatest value the schedule states anywhere */
  min: number; max: number;
  /** the one value, when the schedule is constant */
  constant: number | null;
  /** the objects the schedule is made of, verbatim — itself, its weeks and days, its type limits — what the writer emits */
  chain: IdfObject[];
  /** every date block with its rules (2026-09-13): what the calendar evaluates; the strips are period 1's Monday and Saturday */
  periods: SchedulePeriod[];
  /** why the profile could not be read (a Schedule:File, a form this reader does not know); the object is still listed */
  problem: string | null;
}

const num = (s: string | undefined): number => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : NaN);
const timeMin = (s: string): number | null => { const m = /(\d{1,2}):(\d{2})/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** the object as read, in the file's own layout */
export const objectText = (o: IdfObject): string => `${o.cls},\n    ${o.fields.join(",\n    ")};`;

/** 24 hourly values from (until, value) pairs: hour h takes the first "until" at or past the hour's END */
function hoursFromUntils(untils: Array<{ min: number; value: number }>): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const end = (h + 1) * 60;
    const u = untils.find((x) => x.min >= end) ?? untils[untils.length - 1];
    out.push(u ? u.value : NaN);
  }
  return out;
}
const lower = (s: string): string => s.trim().toLowerCase();
/** the day types a "For:" field names, AS THE ENGINE MATCHES THEM (ScheduleManager.cc, substrings of the upper-cased text —
 *  WEEKDAY, WEEKEND, ALLDAY, the seven names, HOLIDAY, SUMMERDESIGNDAY, WINTERDESIGNDAY, CUSTOMDAY1/2; ALLOTHERDAY = the
 *  types no earlier rule of the period took); `taken` accumulates over the period's rules */
export function dayTypesOf(field: string, taken: Set<DayType>): Set<DayType> {
  const u = field.toUpperCase().replace(/^FOR:?\s*/, "");
  const out = new Set<DayType>();
  const add = (...t: DayType[]): void => { for (const x of t) out.add(x); };
  if (u.includes("WEEKDAY")) add("monday", "tuesday", "wednesday", "thursday", "friday");
  if (u.includes("WEEKEND")) add("saturday", "sunday");
  if (u.replace(/ALLOTHERDAYS?/g, "").includes("ALLDAY")) add(...DAY_TYPES);
  for (const d of DAY_TYPES.slice(0, 7)) if (u.includes(d.toUpperCase())) add(d);
  if (u.includes("HOLIDAY")) add("holiday");
  if (u.includes("SUMMERDESIGNDAY")) add("summerdesignday");
  if (u.includes("WINTERDESIGNDAY")) add("winterdesignday");
  if (u.includes("CUSTOMDAY1")) add("customday1");
  if (u.includes("CUSTOMDAY2")) add("customday2");
  if (u.includes("ALLOTHERDAY")) for (const d of DAY_TYPES) if (!taken.has(d)) out.add(d);
  for (const d of out) taken.add(d);
  return out;
}
/** the rule a day type takes: the LAST rule of the period naming it (a later "For:" overrides an earlier one, as in the engine) */
export const ruleWith = (rules: ScheduleRule[], day: DayType): ScheduleRule | null => { for (let i = rules.length - 1; i >= 0; i--) if (rules[i]!.types.has(day)) return rules[i]!; return null; };

interface CompactRead { periods: SchedulePeriod[]; dayTypes: string[]; values: number[] }
/** Schedule:Compact: Through / For / Until fields, in the file's order — every date block kept with its dates (2026-09-13) */
function readCompact(o: IdfObject): CompactRead | null {
  const periods: SchedulePeriod[] = [], dayTypes: string[] = [];
  type Cur = { period: SchedulePeriod; taken: Set<DayType>; types: Set<DayType> | null; untils: Array<{ min: number; value: number }> | null };
  let cur = null as Cur | null;   // `as`, not an annotation: the closures below assign it, which TS does not follow
  const closeRule = (): void => { if (cur?.types && cur.untils) { cur.period.rules.push({ types: cur.types, hours: hoursFromUntils(cur.untils) }); cur.types = null; cur.untils = null; } };
  const open = (to: number): void => { closeRule(); const period: SchedulePeriod = { from: (periods[periods.length - 1]?.to ?? 0) + 1, to, rules: [] }; periods.push(period); cur = { period, taken: new Set(), types: null, untils: null }; };
  const f = o.fields;
  for (let i = 2; i < f.length; ) {
    const s = f[i] ?? "", low = lower(s);
    if (low.startsWith("through")) { const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(s); if (!m) return null; open(dayOfYear(Number(m[1]), Number(m[2]))); i++; }
    else if (low.startsWith("for")) {
      if (!cur) open(365);
      closeRule();
      if (!periods.length || periods[0] === cur!.period) dayTypes.push(...s.replace(/^for:?\s*/i, "").split(/\s+/).filter(Boolean));
      cur!.types = dayTypesOf(s, cur!.taken); cur!.untils = []; i++;
    } else if (low.startsWith("interpolate")) i++;
    else if (low.startsWith("until")) {
      const min = timeMin(s), v = num(f[i + 1]);
      if (min === null || !cur?.untils || !Number.isFinite(v)) return null;
      cur.untils.push({ min, value: v }); i += 2;
    } else return null;   // a field this reader does not know — the object is listed, not read
  }
  closeRule();
  if (!periods.length || !periods[0]!.rules.length) return null;
  return { periods, dayTypes: [...new Set(dayTypes)], values: periods.flatMap((p) => p.rules.flatMap((r) => r.hours)) };
}

/** a Schedule:Day:* object's 24 values */
function readDay(o: IdfObject): number[] | null {
  const f = o.fields;
  if (o.cls === "Schedule:Day:Hourly") { const v = f.slice(2, 26).map(num); return v.length === 24 && v.every(Number.isFinite) ? v : null; }
  if (o.cls === "Schedule:Day:Interval") {
    const untils: Array<{ min: number; value: number }> = [];
    for (let i = 3; i + 1 < f.length; i += 2) { const min = timeMin(f[i] ?? ""), v = num(f[i + 1]); if (min === null || !Number.isFinite(v)) return null; untils.push({ min, value: v }); }
    return untils.length ? hoursFromUntils(untils) : null;
  }
  if (o.cls === "Schedule:Day:List") {
    const step = num(f[3]); if (!Number.isFinite(step) || step <= 0) return null;
    const vals = f.slice(4).map(num); if (!vals.length || !vals.some(Number.isFinite)) return null;
    const out: number[] = [];
    for (let h = 0; h < 24; h++) { const idx = Math.min(vals.length - 1, Math.floor(((h + 1) * 60 - 1) / step)); out.push(vals[idx] ?? NaN); }
    return out;
  }
  return null;
}
/** a Schedule:Week:* object: its rules — the day types and the day schedule each names, in the file's order */
function readWeek(o: IdfObject): { rules: Array<{ types: Set<DayType>; day: string }> } | null {
  const f = o.fields;
  if (o.cls === "Schedule:Week:Daily") {
    // Sunday, Monday … Saturday, Holiday, SummerDesignDay, WinterDesignDay, CustomDay1, CustomDay2 — the DAY_TYPES order
    const rules = DAY_TYPES.map((d, i) => ({ types: new Set<DayType>([d]), day: f[i + 1] ?? "" })).filter((r) => r.day);
    return rules.length === 12 ? { rules } : null;
  }
  if (o.cls === "Schedule:Week:Compact") {
    const rules: Array<{ types: Set<DayType>; day: string }> = [], taken = new Set<DayType>();
    for (let i = 1; i + 1 < f.length; i += 2) rules.push({ types: dayTypesOf(f[i] ?? "", taken), day: f[i + 1] ?? "" });
    return rules.length ? { rules } : null;
  }
  return null;
}

const byNameIn = (lib: Library, cls: string, name: string, file?: string): IdfObject | null => {
  const all = (lib.byClass.get(cls) ?? []).filter((o) => lower(o.name) === lower(name));
  return all.find((o) => o.file === file) ?? all[0] ?? null;
};
const limitsOf = (lib: Library, name: string | null, file: string): ScheduleLimits | null => {
  if (!name) return null;
  const o = byNameIn(lib, "ScheduleTypeLimits", name, file);
  if (!o) return null;
  const lo = num(o.fields[1]), hi = num(o.fields[2]);
  return { name: o.name, lo: Number.isFinite(lo) ? lo : null, hi: Number.isFinite(hi) ? hi : null, discrete: /discrete/i.test(o.fields[3] ?? "") };
};

/** ONE schedule object → its profile: what the strips draw, what the writer emits */
export function readProfile(lib: Library, o: IdfObject): ScheduleProfile {
  const typeLimits = o.cls === "Schedule:Constant" || o.cls === "Schedule:Compact" || o.cls === "Schedule:Year" ? (o.fields[1] || null) : null;
  const limits = limitsOf(lib, typeLimits, o.file);
  const base = { name: o.name, file: o.file, cls: o.cls, typeLimits, limits };
  const chain: IdfObject[] = [];
  const addLimits = (name: string | null, file: string): void => { const l = name ? byNameIn(lib, "ScheduleTypeLimits", name, file) : null; if (l && !chain.includes(l)) chain.push(l); };
  const done = (weekday: number[], weekend: number[], blocks: number, dayTypes: string[], values: number[], periods: SchedulePeriod[], problem: string | null): ScheduleProfile => {
    const finite = values.filter(Number.isFinite);
    const min = finite.length ? Math.min(...finite) : NaN, max = finite.length ? Math.max(...finite) : NaN;
    return { ...base, weekday, weekend, blocks, dayTypes, min, max, constant: finite.length && min === max ? min : null, chain, periods, problem };
  };
  const unread = (why: string): ScheduleProfile => { chain.push(o); addLimits(typeLimits, o.file); return done(Array(24).fill(NaN), Array(24).fill(NaN), 0, [], [], [], why); };
  /** the strips: period 1's Monday and Saturday — the same rules the calendar evaluates */
  const strips = (periods: SchedulePeriod[]): { weekday: number[]; weekend: number[] } | null => { const p = periods[0]; const wd = p ? ruleWith(p.rules, "monday") : null, we = p ? ruleWith(p.rules, "saturday") : null; return wd && we ? { weekday: wd.hours, weekend: we.hours } : null; };
  if (o.cls === "Schedule:Constant") {
    const v = num(o.fields[2]);
    if (!Number.isFinite(v)) return unread("no value");
    addLimits(typeLimits, o.file); chain.push(o);
    return done(Array(24).fill(v), Array(24).fill(v), 1, ["AllDays"], [v], [{ from: 1, to: 365, rules: [{ types: new Set(DAY_TYPES), hours: Array(24).fill(v) }] }], null);
  }
  if (o.cls === "Schedule:Compact") {
    const r = readCompact(o);
    if (!r) return unread("a Through / For / Until form this reader does not know");
    const st = strips(r.periods);
    if (!st) return unread("no rule covers a Monday or a Saturday in its first date block");
    addLimits(typeLimits, o.file); chain.push(o);
    return done(st.weekday, st.weekend, r.periods.length, r.dayTypes, r.values, r.periods, null);
  }
  if (o.cls === "Schedule:Year") {
    const f = o.fields;
    // the week periods with their dates (2026-09-13): name, start month, start day, end month, end day
    const groups: Array<{ week: string; from: number; to: number }> = [];
    for (let i = 2; i + 4 < f.length; i += 5) if (f[i]) groups.push({ week: f[i]!, from: dayOfYear(num(f[i + 1]), num(f[i + 2])), to: dayOfYear(num(f[i + 3]), num(f[i + 4])) });
    const weeks = groups.map((g) => g.week);
    if (!weeks.length) return unread("names no week");
    const weekObjs = weeks.map((w) => byNameIn(lib, "Schedule:Week:Compact", w, o.file) ?? byNameIn(lib, "Schedule:Week:Daily", w, o.file));
    if (weekObjs.some((w) => !w)) return unread(`a week it names is not in the file (${weeks.find((_, i) => !weekObjs[i])})`);
    const reads = weekObjs.map((w) => readWeek(w!));
    if (reads.some((r) => !r)) return unread("a week form this reader does not know");
    const dayObj = (name: string): IdfObject | null => byNameIn(lib, "Schedule:Day:Hourly", name, o.file) ?? byNameIn(lib, "Schedule:Day:Interval", name, o.file) ?? byNameIn(lib, "Schedule:Day:List", name, o.file);
    const dayNames = [...new Set(reads.flatMap((r) => r!.rules.map((x) => x.day)))];
    const days = new Map<string, number[]>();
    for (const d of dayNames) { const obj = dayObj(d); const v = obj ? readDay(obj) : null; if (!obj || !v) return unread(`a day it names is not read (${d})`); days.set(lower(d), v); }
    // the chain: the type limits, every day, every week, the year — each once, in dependency order
    addLimits(typeLimits, o.file);
    for (const d of dayNames) { const obj = dayObj(d)!; addLimits(obj.fields[1] || null, o.file); if (!chain.includes(obj)) chain.push(obj); }
    for (const w of weekObjs) if (!chain.includes(w!)) chain.push(w!);
    chain.push(o);
    const periods: SchedulePeriod[] = groups.map((g, i) => ({ from: g.from, to: g.to, rules: reads[i]!.rules.map((x) => ({ types: x.types, hours: days.get(lower(x.day))! })) }));
    const st = strips(periods);
    if (!st) return unread("no rule covers a Monday or a Saturday in its first period");
    const values = [...days.values()].flat();
    return done(st.weekday, st.weekend, weeks.length, [...new Set(reads[0]!.rules.flatMap((x) => [...x.types]))], values, periods, null);
  }
  if (o.cls === "Schedule:File") return unread("a Schedule:File reads an external file the model does not carry");
  return unread(`a ${o.cls} is not read by itself`);
}

/** every schedule an object can name, from the files read into the library, in the files' order */
export function readProfiles(lib: Library): ScheduleProfile[] {
  return lib.objects.filter((o) => isTopLevelSchedule(o.cls)).map((o) => readProfile(lib, o));
}
export interface ScheduleRef { file: string; name: string }
/** the profile a ledger ruling names — by file (its base name) and name, case-insensitively as the engine reads names */
export function profileFor(lib: Library, ref: ScheduleRef): ScheduleProfile | null {
  const o = lib.objects.find((x) => isTopLevelSchedule(x.cls) && lower(x.name) === lower(ref.name) && (scheduleFileName(x.file) === scheduleFileName(ref.file) || !ref.file));
  return o ? readProfile(lib, o) : null;
}
/** does the schedule fit the role — by its TYPE LIMITS when the file states them, by its own values otherwise:
 *  a fraction role takes 0…1 (on/off included); a setpoint role takes a schedule whose every value reads as a ROOM
 *  temperature, 5…40 °C, whatever its type limit — the example's Temperature-typed water-heater, boiler and DOAS
 *  schedules (49 °C, 80 °C, the −60…200 °C limits themselves) are temperatures and not thermostat setpoints (measured 2026-09-09) */
export function fitsRole(p: ScheduleProfile, role: ScheduleRole): boolean {
  if (p.problem) return false;
  const temp = /temperature/i.test(p.typeLimits ?? "");
  if (ROLE_KIND[role] === "temperature") return (temp || !p.limits || (p.limits.lo === null && p.limits.hi === null)) && p.min >= 5 && p.max <= 40;
  if (temp) return false;
  if (p.limits && p.limits.lo !== null && p.limits.hi !== null) return p.limits.lo >= 0 && p.limits.hi <= 1;
  return p.min >= 0 && p.max <= 1;
}
/** the library's schedule census, in words */
export function formatScheduleCensus(profiles: ScheduleProfile[]): string {
  const byFile = new Map<string, ScheduleProfile[]>();
  for (const p of profiles) (byFile.get(scheduleFileName(p.file)) ?? byFile.set(scheduleFileName(p.file), []).get(scheduleFileName(p.file))!).push(p);
  return [...byFile].map(([f, ps]) => {
    const cls: Record<string, number> = {};
    for (const p of ps) cls[p.cls.replace(/^Schedule:/, "")] = (cls[p.cls.replace(/^Schedule:/, "")] ?? 0) + 1;
    const unread = ps.filter((p) => p.problem).length;
    return `${f} ${ps.length} (${Object.entries(cls).map(([c, n]) => `${c} ${n}`).join(" · ")}${unread ? `; not read ${unread}` : ""})`;
  }).join(" + ");
}
