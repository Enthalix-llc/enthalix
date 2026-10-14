// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE INTERNAL GAINS, PER ROOM (user, 2026-09-13, evening): People, Lights and ElectricEquipment on every room's Space —
// EMITTED BY DEFAULT from cited residential rules, editable per ZONE (every room of the zone takes the setting) and per
// ROOM (overrides its zone's). Nothing is authored: the count of occupants is the 2014 Building America House Simulation
// Protocols' rule, read from the document's own text; the lights are the file's fixtures where the file states a wattage,
// else the engine's own single-family example's W/m²; the appliances and plug loads are that example's rows, placed by a
// stated rule; every schedule is one of the engine's own (the example's Building America profiles, in the library).
// The rules live here so the frame, the writer and the gate share ONE arithmetic.

import type { BemInput } from "./bemInput.js";
import type { GainRulings, GainRuling, GainEquipmentRow, EquipmentGroup } from "./bemDb.js";
import type { Source, ResolvedSchedule } from "./bemIdf.js";
import { profileFor, type ScheduleProfile, type ScheduleRole, type ScheduleRef } from "./schedules.js";
import type { Library } from "./idfLib.js";
import { FOCUS } from "./mepFocus.js";
import { isVoidZone } from "../../../core/zones.js";

/** THE 2014 PROTOCOLS, read from NREL/TP-5500-60988's own text (fetched 2026-09-13 from docs.nlr.gov — the lab was renamed):
 *  §4.6 Occupancy, Equation 23, single-family: "Number of occupants = 0.59 × Nbr + 0.87"; the occupant heat gains "are based on
 *  ASHRAE (2009)" — the engine's example carries them as its activity schedule (117.28 W per person) */
export const BAHSP_2014 = {
  occupants: (nbr: number): number => 0.59 * nbr + 0.87,
  citation: "Building America House Simulation Protocols, NREL/TP-5500-60988 (March 2014), §4.6 Occupancy, Eq. 23: 0.59 × Nbr + 0.87",
} as const;
/** THE ENGINE'S OWN SINGLE-FAMILY EXAMPLE (ExampleFiles/SingleFamilyHouse_HP_Slab.idf, read 2026-09-13): its People, Lights and
 *  ElectricEquipment objects field by field, each on its Building America schedule — the dataset the defaults come from */
export const RESIDENTIAL_EXAMPLE = {
  file: "SingleFamilyHouse_HP_Slab.idf",
  people: { activityW: 117.28, activitySchedule: "activity_sch", schedule: "Occupancy", fractionRadiant: 0 },
  lights: { hardwiredWm2: 1.05216214401829, plugInWm2: 0.478467682251396, schedule: "InteriorLightingHE", returnAir: 0, radiant: 0.6, visible: 0.2, replaceable: 0 },
  exteriorLights: { schedule: "ExteriorLighting" },
  /** the rows, each placed by a STATED rule: `kitchen` = the room holding the file's dishwasher, `laundry` = the room holding its
   *  dryer, `share` = every conditioned room by its floor share, `perArea` = every conditioned room by its floor area (W/m²) */
  equipment: [
    { id: "dishwasher", name: "dishwasher", wattsW: 65.698787492023, latent: 0.15, radiant: 0.6, lost: 0.25, schedule: "DishWasher", subcategory: "dishwasher", place: "kitchen" },
    { id: "refrigerator", name: "refrigerator", wattsW: 91.0575745202123, latent: 0, radiant: 1, lost: 0, schedule: "Refrigerator", subcategory: "refrigerator", place: "kitchen" },
    { id: "clotheswasher", name: "clothes washer", wattsW: 28.4784377542718, latent: 0, radiant: 0.8, lost: 0.2, schedule: "ClothesWasher", subcategory: "clotheswasher", place: "laundry" },
    { id: "electric_dryer", name: "electric dryer", wattsW: 213.064557285022, latent: 0.05, radiant: 0.15, lost: 0.8, schedule: "ClothesDryer", subcategory: "electric_dryer", place: "laundry" },
    { id: "electric_range", name: "electric range", wattsW: 248.154224774405, latent: 0.3, radiant: 0.4, lost: 0.3, schedule: "CookingRange", subcategory: "electric_range", place: "kitchen" },
    { id: "electric_mels", name: "misc plug loads", wattsW: 567.464237516869, latent: 0.06, radiant: 0.69, lost: 0.25, schedule: "MiscPlugLoad", subcategory: "electric_mels", place: "share" },
    { id: "iecc_adj", name: "IECC adjustment", wm2: 1.54356736989469, latent: 0.0624390461422629, radiant: 0.41190936353998, lost: 0.251045347957769, schedule: "MiscPlugLoad", subcategory: "IECC_adj", place: "perArea" },
  ] as const,
  /** the television row's 0 W is the example's own zero: omitted, said here */
  omitted: "television (0 W in the example)",
  citation: "ExampleFiles/SingleFamilyHouse_HP_Slab.idf — the engine's single-family example, its objects field by field",
} as const;
/** THE EQUIPMENT GROUPS (user, 2026-10-03: "Cooking (range), Refrigeration, Dishwasher, Laundry (clothes washer and dryer), Charging
 *  (cars and tools), Entertainment (tv and stereo), Work (computers and printers)"). The example's rows fall into their groups; the
 *  example has no row for charging, entertainment or work (its television is 0 W) — those start at nothing, said, until a W is
 *  typed (the user's ruling: the engine example's numbers, no other source). A typed row of a group meters to the group's own
 *  end-use subcategory; the misc plug loads and the IECC adjustment are "other". Each group's schedule is its SCHEDULES role. */
export const EQUIPMENT_GROUPS: ReadonlyArray<{ id: EquipmentGroup; label: string; items: string; subcategory: string; rows: readonly string[]; newName: string }> = [
  { id: "cooking", label: "Cooking", items: "range", subcategory: "Cooking", rows: ["electric_range"], newName: "range" },
  { id: "refrigeration", label: "Refrigeration", items: "refrigerator, freezer", subcategory: "Refrigeration", rows: ["refrigerator"], newName: "refrigerator" },
  { id: "dishwasher", label: "Dishwasher", items: "dishwasher", subcategory: "Dishwasher", rows: ["dishwasher"], newName: "dishwasher" },
  { id: "laundry", label: "Laundry", items: "clothes washer and dryer", subcategory: "Laundry", rows: ["clotheswasher", "electric_dryer"], newName: "laundry" },
  { id: "charging", label: "Charging", items: "cars and tools", subcategory: "Charging", rows: [], newName: "car charging" },
  { id: "entertainment", label: "Entertainment", items: "TV and stereo", subcategory: "Entertainment", rows: [], newName: "TV and stereo" },
  { id: "work", label: "Work", items: "computers and printers", subcategory: "Work", rows: [], newName: "computers and printers" },
  { id: "other", label: "Other plug loads", items: "the example's misc plug loads and IECC adjustment, and yours", subcategory: "user", rows: ["electric_mels", "iecc_adj"], newName: "a load" },
];
/** a row's group: its own, else the example row's, else other */
export const groupOfRow = (r: { id: string; group?: EquipmentGroup }): EquipmentGroup => r.group ?? EQUIPMENT_GROUPS.find((g) => g.rows.includes(r.id))?.id ?? "other";
/** the end-use subcategory a group meters to — RUN reads Charging's */
export const CHARGING_SUBCATEGORY = "Charging";
/** the standard's own form for interior lighting, cited beside the example's W/m² (references/systems-organisation.md) */
export const LIGHTING_STANDARD = "ANSI/RESNET/ICC 301: interior lighting 455 + 0.8 × CFA kWh/yr — the example's 1.052 + 0.478 W/m² is used";

/** a room's floor area: the cells whose outward normal, seen from the room, points down — the space table's own rule
 *  (spaceTable.ts: `out[1] < −0.5` is a floor); a room behind a face sees `n`, a room faced sees `−n` */
export function floorAreaOf(faces: BemInput["faces"], room: string): number {
  let a = 0;
  for (const f of faces) {
    if ((f.spaceIfc ?? f.space) === room && f.n[1] < -0.5) a += f.areaM2;
    else if ((f.spaceFacingIfc ?? f.spaceFacing) === room && f.n[1] > 0.5) a += f.areaM2;
  }
  return a;
}
/** A BEDROOM (2026-10-07): the room's tick on ZONES (`gains.rooms[room].bedroom`), else by its name — "Bed 1", never "Bed 1 Bath" */
export type BedroomMarks = Readonly<Record<string, boolean>>;
export const bedroomByName = (room: string): boolean => /^Bed \d+$/i.test(room);
export const isBedroom = (room: string, marks?: BedroomMarks): boolean => marks?.[room] ?? bedroomByName(room);
/** the ticks the gain rulings hold, by room */
export const bedroomMarksOf = (g: GainRulings | undefined): Record<string, boolean> =>
  Object.fromEntries(Object.entries(g?.rooms ?? {}).filter(([, r]) => typeof r?.bedroom === "boolean").map(([k, r]) => [k, r.bedroom!]));
export const bedroomsIn = (rooms: Iterable<string>, marks?: BedroomMarks): string[] => [...rooms].filter((r) => isBedroom(r, marks));
/** the bedrooms, by the ticks on ZONES else by name */
export const bedroomsByName = (rooms: Iterable<string>, marks?: BedroomMarks): number => bedroomsIn(rooms, marks).length;
/** the bedrooms of a model, by its ROOMS (the IfcSpace each side came from), never its zones: a Zone drawn on the sheet takes its
 *  rooms' names away ("Master" holds Bed 1) and a count by zone read 0 (user, 2026-10-02) */
export const bedroomsOfFaces = (faces: ReadonlyArray<{ space?: string | null; spaceFacing?: string | null; spaceIfc?: string | null; spaceFacingIfc?: string | null }>, marks?: BedroomMarks): number =>
  bedroomsByName(new Set(faces.flatMap((f) => [f.spaceIfc ?? f.space, f.spaceFacingIfc ?? f.spaceFacing]).filter((r): r is string => !!r)), marks);

export interface ResolvedEquipment { id: string; name: string; group: EquipmentGroup; wattsW: number; subcategory: string; latent: number; radiant: number; lost: number; schedule: ScheduleProfile | null; scheduleName: string; source: Source; note: string }
export interface ResolvedRoom {
  room: string; zone: string; floorM2: number; conditioned: boolean;
  people: { count: number; source: Source; note: string; activityW: number; activitySource: Source; fractionRadiant: number };
  lights: { wattsW: number; source: Source; note: string; fixtures: number; fixturesStated: number; fixturesW: number };
  equipment: ResolvedEquipment[];
  /** the schedules the room's objects run on: the ruled role's, else the example's */
  schedules: { occupancy: ScheduleProfile | null; lighting: ScheduleProfile | null; activity: ScheduleProfile | null };
}
export interface ResolvedGains {
  rooms: ResolvedRoom[];
  /** every schedule the gains name, once — the writer emits them ahead of the objects */
  profiles: ScheduleProfile[];
  /** the file's fixtures in no room (exterior, by the file's placement) with a stated wattage → one Exterior:Lights on the astronomical clock */
  exterior: { wattsW: number; fixtures: number; stated: number; schedule: ScheduleProfile | null } | null;
  unresolved: string[];
  nbr: number; nocc: number; cfaM2: number;
  /** the rooms counted as bedrooms — ticked on ZONES, else by name (2026-10-07) */
  bedrooms: string[];
  /** where the appliances went, said */
  placed: { kitchen: string | null; laundry: string | null; rule: string };
}

export interface GainOpts { conditioned: (zone: string) => boolean; schedules: Map<ScheduleRole, ResolvedSchedule> }

/** every room's gains, resolved: the room's ruling, else its zone's, else the cited default */
export function resolveGains(input: BemInput, rulings: GainRulings | undefined, library: Library | null, opts: GainOpts): ResolvedGains {
  const unresolved: string[] = [];
  // the rooms, as the writer's Space loop finds them: every IfcSpace a zone's surfaces came from, with the zone it is in
  const zoneOf = new Map<string, string>();
  for (const f of input.faces) {
    if (f.space) zoneOf.set(f.spaceIfc ?? f.space, f.space);
    if (f.spaceFacing) zoneOf.set(f.spaceFacingIfc ?? f.spaceFacing, f.spaceFacing);
  }
  const rooms = [...zoneOf.keys()].sort((a, b) => a.localeCompare(b));
  // A VOID (an attic, a floor cavity) IS AIR IN ITS ZONE, NOT FLOOR (user, 2026-10-02): no floor area, so no share of the people, no
  // lights or plug loads by area, and the conditioned floor area is the rooms' alone — 2,452 ft² of cavities had raised it by 32 %
  const floor = new Map(rooms.map((r) => [r, isVoidZone(r) ? 0 : floorAreaOf(input.faces, r)]));
  const cond = (r: string): boolean => opts.conditioned(zoneOf.get(r)!);
  const condRooms = rooms.filter(cond);
  const cfaM2 = condRooms.reduce((t, r) => t + (floor.get(r) ?? 0), 0);
  const zoneFloor = new Map<string, number>();
  for (const r of rooms) zoneFloor.set(zoneOf.get(r)!, (zoneFloor.get(zoneOf.get(r)!) ?? 0) + (floor.get(r) ?? 0));
  const bedrooms = bedroomsIn(rooms, bedroomMarksOf(rulings));
  const nbr = bedrooms.length;
  const nocc = BAHSP_2014.occupants(nbr);
  // the schedules: the ruled role's profile, else the example's — every one of the engine's own
  const profiles = new Map<string, ScheduleProfile>();
  const ex = (name: string): ScheduleProfile | null => {
    if (!library) return null;
    const p = profileFor(library, { file: RESIDENTIAL_EXAMPLE.file, name });
    if (!p) { if (!unresolved.includes(`"${name}" is not in the library (${RESIDENTIAL_EXAMPLE.file})`)) unresolved.push(`"${name}" is not in the library (${RESIDENTIAL_EXAMPLE.file})`); return null; }
    if (p.problem) { unresolved.push(`"${name}": ${p.problem}`); return null; }
    profiles.set(p.name.toLowerCase(), p);
    return p;
  };
  const role = (r: ScheduleRole): ScheduleProfile | null => { const s = opts.schedules.get(r); if (s) profiles.set(s.profile.name.toLowerCase(), s.profile); return s?.profile ?? null; };
  const ref = (x: ScheduleRef | undefined): ScheduleProfile | null => { if (!x || !library) return null; const p = profileFor(library, x); if (!p || p.problem) { unresolved.push(`"${x.name}" is not in the library`); return null; } profiles.set(p.name.toLowerCase(), p); return p; };
  if (!library) unresolved.push("the schedule library is not read — no gain is written");
  const occupancyS = library ? (role("occupancy") ?? ex(RESIDENTIAL_EXAMPLE.people.schedule)) : null;
  const lightingS = library ? (role("lighting") ?? ex(RESIDENTIAL_EXAMPLE.lights.schedule)) : null;
  const activityS = library ? ex(RESIDENTIAL_EXAMPLE.people.activitySchedule) : null;
  const equipmentRole = role("equipment");
  // a group's role, ruled, takes its rows ahead of the equipment role (2026-10-03); "other" has none of its own
  const groupRole = new Map<EquipmentGroup, ScheduleProfile | null>(EQUIPMENT_GROUPS.filter((g) => g.id !== "other").map((g) => [g.id, role(g.id as ScheduleRole)] as const));
  // WHERE THE APPLIANCES GO, read from the file's own placement: the room holding its dishwasher, the room holding its dryer;
  // neither in the file → the largest conditioned room, said
  const largest = condRooms.slice().sort((a, b) => (floor.get(b) ?? 0) - (floor.get(a) ?? 0))[0] ?? null;
  const roomOfEl = (re: RegExp): string | null => input.mep.elements.find((e) => re.test(e.name) && e.room && zoneOf.has(e.room))?.room ?? null;
  const kitchen = roomOfEl(/dishwasher/i) ?? largest, laundry = roomOfEl(/dryer/i) ?? largest;
  const placedRule = `kitchen appliances in ${kitchen ?? "no room"} (${roomOfEl(/dishwasher/i) ? "the room holding the file's dishwasher" : "no dishwasher in the file: the largest conditioned room"}), laundry in ${laundry ?? "no room"} (${roomOfEl(/dryer/i) ? "the room holding the file's dryer" : "no dryer in the file: the largest conditioned room"}), plug loads over every conditioned room by floor share`;
  // the file's light fixtures, by room
  const fixturesIn = (room: string | null) => input.mep.elements.filter((e) => FOCUS.lighting(e) && e.room === room);
  const statedW = (e: { wattageW: number | null; powerW: number | null }): number | null => e.wattageW ?? e.powerW;
  const ruleFor = (room: string): { own: GainRuling | undefined; zone: GainRuling | undefined } => ({ own: rulings?.rooms?.[room], zone: rulings?.zones?.[zoneOf.get(room)!] });
  const share = (room: string, ofZone: boolean): number => { const a = floor.get(room) ?? 0; const t = ofZone ? (zoneFloor.get(zoneOf.get(room)!) ?? 0) : cfaM2; return t > 0 ? a / t : 0; };

  const out: ResolvedRoom[] = rooms.map((room): ResolvedRoom => {
    const zone = zoneOf.get(room)!, a = floor.get(room) ?? 0, c = cond(room);
    const { own, zone: zr } = ruleFor(room);
    // ── people
    let people: ResolvedRoom["people"];
    const pp = own?.people, pz = zr?.people;
    if (pp?.none) people = { count: 0, source: "user", note: "none — this room's ruling", activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (pp?.count !== undefined) people = { count: pp.count, source: "user", note: "typed for this room", activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (pp?.perAreaM2 !== undefined) people = { count: pp.perAreaM2 * a, source: "user", note: `${pp.perAreaM2} per m² × ${a.toFixed(1)} m², typed for this room`, activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (pz?.none) people = { count: 0, source: "user", note: `none — ${zone}'s ruling`, activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (pz?.count !== undefined) people = { count: pz.count * share(room, true), source: "user", note: `${zone}'s ${pz.count} people by floor share (${(share(room, true) * 100).toFixed(0)} %)`, activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (pz?.perAreaM2 !== undefined) people = { count: pz.perAreaM2 * a, source: "user", note: `${pz.perAreaM2} per m² × ${a.toFixed(1)} m², ${zone}'s ruling`, activityW: 0, activitySource: "user", fractionRadiant: 0 };
    else if (isVoidZone(room)) people = { count: 0, source: "code-default", note: "a void (an attic or a floor cavity): air in its zone, no people", activityW: 0, activitySource: "code-default", fractionRadiant: 0 };
    else if (!c) people = { count: 0, source: "code-default", note: "unconditioned — no people", activityW: 0, activitySource: "code-default", fractionRadiant: 0 };
    else people = { count: nocc * share(room, false), source: "dataset", note: `${nocc.toFixed(2)} occupants for ${nbr} bedroom${nbr === 1 ? "" : "s"} (${BAHSP_2014.citation}) × this room's floor share ${(share(room, false) * 100).toFixed(1)} % of ${cfaM2.toFixed(1)} m²`, activityW: 0, activitySource: "dataset", fractionRadiant: 0 };
    const actW = pp?.activityW ?? pz?.activityW;
    people.activityW = actW ?? RESIDENTIAL_EXAMPLE.people.activityW; people.activitySource = actW !== undefined ? "user" : "dataset";
    people.fractionRadiant = pp?.fractionRadiant ?? pz?.fractionRadiant ?? RESIDENTIAL_EXAMPLE.people.fractionRadiant;
    // ── lights
    const fx = fixturesIn(room), fxStated = fx.filter((e) => statedW(e) !== null), fxW = fxStated.reduce((t, e) => t + (statedW(e) ?? 0), 0);
    const lp = own?.lights, lz = zr?.lights;
    const fixturesNote = `${fx.length} fixture${fx.length === 1 ? "" : "s"} in the file, ${fxStated.length} state a wattage: ${fxW.toFixed(0)} W`;
    let lights: ResolvedRoom["lights"];
    const base = { fixtures: fx.length, fixturesStated: fxStated.length, fixturesW: fxW };
    if (lp?.none) lights = { wattsW: 0, source: "user", note: "none — this room's ruling", ...base };
    else if (lp?.wattsW !== undefined) lights = { wattsW: lp.wattsW, source: "user", note: "typed for this room", ...base };
    else if (lp?.wm2 !== undefined) lights = { wattsW: lp.wm2 * a, source: "user", note: `${lp.wm2} W/m² × ${a.toFixed(1)} m², typed for this room`, ...base };
    else if (lp?.fixtures) lights = { wattsW: fxW, source: "file", note: `the file's fixtures (this room's ruling): ${fixturesNote}`, ...base };
    else if (lz?.none) lights = { wattsW: 0, source: "user", note: `none — ${zone}'s ruling`, ...base };
    else if (lz?.wattsW !== undefined) lights = { wattsW: lz.wattsW * share(room, true), source: "user", note: `${zone}'s ${lz.wattsW} W by floor share (${(share(room, true) * 100).toFixed(0)} %)`, ...base };
    else if (lz?.wm2 !== undefined) lights = { wattsW: lz.wm2 * a, source: "user", note: `${lz.wm2} W/m² × ${a.toFixed(1)} m², ${zone}'s ruling`, ...base };
    else if (lz?.fixtures) lights = { wattsW: fxW, source: "file", note: `the file's fixtures (${zone}'s ruling): ${fixturesNote}`, ...base };
    else if (fxStated.length) lights = { wattsW: fxW, source: "file", note: fixturesNote, ...base };
    else if (c && !isVoidZone(room)) lights = { wattsW: (RESIDENTIAL_EXAMPLE.lights.hardwiredWm2 + RESIDENTIAL_EXAMPLE.lights.plugInWm2) * a, source: "dataset", note: `no fixture states a wattage (${fx.length} in the file): the example's ${(RESIDENTIAL_EXAMPLE.lights.hardwiredWm2 + RESIDENTIAL_EXAMPLE.lights.plugInWm2).toFixed(3)} W/m² × ${a.toFixed(1)} m² (${RESIDENTIAL_EXAMPLE.citation}; ${LIGHTING_STANDARD})`, ...base };
    else lights = { wattsW: 0, source: "code-default", note: `${isVoidZone(room) ? "a void (an attic or a floor cavity), no lights" : "unconditioned"}, no fixture states a wattage (${fx.length} in the file)`, ...base };
    // ── equipment: the example's rows placed, the rulings' rows, each once by id
    const eq: ResolvedEquipment[] = [];
    const override = (id: string): { row: GainEquipmentRow | undefined; from: "room" | "zone" | null } => {
      const r = own?.equipment?.find((x) => x.id === id); if (r) return { row: r, from: "room" };
      const z = zr?.equipment?.find((x) => x.id === id); if (z) return { row: z, from: "zone" };
      return { row: undefined, from: null };
    };
    const schedOf = (row: GainEquipmentRow | undefined, dflt: string, group: EquipmentGroup): { p: ScheduleProfile | null; name: string } => {
      const p = ref(row?.schedule) ?? groupRole.get(group) ?? equipmentRole ?? (library ? ex(dflt) : null);
      return { p, name: p?.name ?? dflt };
    };
    if (library) for (const e of RESIDENTIAL_EXAMPLE.equipment) {
      const here = !isVoidZone(room) && (e.place === "kitchen" ? kitchen === room : e.place === "laundry" ? laundry === room : c);
      if (!here) continue;
      const o = override(e.id);
      if (o.row && !o.row.enabled) continue;
      const w = o.row?.wattsW !== undefined ? (o.from === "zone" ? o.row.wattsW * share(room, true) : o.row.wattsW) : o.row?.wm2 !== undefined ? o.row.wm2 * a : "wattsW" in e ? (e.place === "share" ? e.wattsW * share(room, false) : e.wattsW) : e.wm2 * a;
      const g = groupOfRow(e);
      const s = schedOf(o.row, e.schedule, g);
      eq.push({ id: e.id, name: o.row?.name ?? e.name, group: g, wattsW: w, subcategory: o.row?.subcategory ?? e.subcategory, latent: o.row?.latent ?? e.latent, radiant: o.row?.radiant ?? e.radiant, lost: o.row?.lost ?? e.lost, schedule: s.p, scheduleName: s.name,
        source: o.row ? "user" : "dataset", note: o.row ? `${o.from === "zone" ? `${zone}'s ruling` : "this room's ruling"}` : `${RESIDENTIAL_EXAMPLE.citation}: ${e.place === "share" ? `${e.wattsW} W by floor share ${(share(room, false) * 100).toFixed(1)} %` : e.place === "perArea" ? `${e.wm2} W/m² × ${a.toFixed(1)} m²` : `placed here (${e.place === "kitchen" ? "the kitchen" : "the laundry"})`}` });
    }
    const mels = RESIDENTIAL_EXAMPLE.equipment.find((e) => e.id === "electric_mels")!;
    const userRows = (list: GainEquipmentRow[] | undefined, from: "room" | "zone"): void => {
      for (const r of list ?? []) {
        if (RESIDENTIAL_EXAMPLE.equipment.some((e) => e.id === r.id) || !r.enabled || eq.some((x) => x.id === r.id)) continue;
        const w = r.wattsW !== undefined ? (from === "zone" ? r.wattsW * share(room, true) : r.wattsW) : r.wm2 !== undefined ? r.wm2 * a : 0;
        const g = groupOfRow(r);
        const s = schedOf(r, mels.schedule, g);
        eq.push({ id: r.id, name: r.name, group: g, wattsW: w, subcategory: r.subcategory || "user", latent: r.latent ?? mels.latent, radiant: r.radiant ?? mels.radiant, lost: r.lost ?? mels.lost, schedule: s.p, scheduleName: s.name, source: "user", note: from === "zone" ? `${zone}'s ruling, by floor share` : "this room's ruling" });
      }
    };
    userRows(own?.equipment, "room"); userRows(zr?.equipment, "zone");
    return { room, zone, floorM2: a, conditioned: c, people, lights, equipment: eq, schedules: { occupancy: occupancyS, lighting: lightingS, activity: activityS } };
  });
  // the exterior fixtures: in no room, a wattage stated
  const exFx = fixturesIn(null), exStated = exFx.filter((e) => statedW(e) !== null), exW = exStated.reduce((t, e) => t + (statedW(e) ?? 0), 0);
  const exterior = exStated.length && library ? { wattsW: exW, fixtures: exFx.length, stated: exStated.length, schedule: ex(RESIDENTIAL_EXAMPLE.exteriorLights.schedule) } : null;
  return { rooms: out, profiles: [...profiles.values()], exterior, unresolved, nbr, nocc, cfaM2, bedrooms, placed: { kitchen, laundry, rule: placedRule } };
}

/** the count of rulings, for the settings and the counted Apply */
export const gainRulingCount = (g: GainRulings | undefined): number => Object.keys(g?.zones ?? {}).length + Object.keys(g?.rooms ?? {}).length;
