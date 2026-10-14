// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PLUMBING SHEET (user, 2026-10-02: "the Plumbing system needs components for hot water heaters, both Heat Pump and Electric
// and Gas. These unit need to be assigned to a specific room for room heat gain and loss (with heat pump water heater)"; the
// rulings the same day: the draw is the CODE's reference use, and the sheet starts from the file's own heaters). The MECHANICAL and
// ELECTRICAL sheets' canvas, bench and column over its own cards: a WATER HEATER — heat pump, electric or gas — sits IN A ROOM
// (picked in the column), and that room's zone takes its skin losses and, for a heat pump, gives the air its evaporator cools; a
// HOT-WATER USE card ticks the rooms it serves, their bedrooms set the code's daily use, and its HW line runs from the heater that
// supplies it. The tanks are STAND-ALONE (the IDD's own use-side notes: a peak use flow and its schedule on the tank, the mains as
// the cold supply) — no plant loop. What the engine cannot take is refused and named on the card.

import { type Assembly, type AsmNode, addNode, addEdge, patchNode } from "./assembly.js";
import type { EpSchema } from "./epSchema.js";
import type { Catalogue, CatEntry, CatPort } from "./epCatalogue.js";
import type { SystemFields } from "./bemDb.js";
import { bedroomsByName, type BedroomMarks } from "./bemGains.js";

/** the cards. A gas tank is the electric tank's own class with its fuel — two tiles on the bench, one EnergyPlus object; the key
 *  after `#` keeps them apart on the sheet and is dropped when the object is written */
export const PLUMB_CLASS = { hpwh: "WaterHeater:HeatPump:WrappedCondenser", electric: "WaterHeater:Stratified", gas: "WaterHeater:Stratified#gas", use: "WaterUse:Equipment", well: "Exterior:FuelEquipment#well" } as const;
export type HeaterKind = "hpwh" | "electric" | "gas";
export const heaterKindOf = (cls: string | undefined): HeaterKind | null => cls === PLUMB_CLASS.hpwh ? "hpwh" : cls === PLUMB_CLASS.electric ? "electric" : cls === PLUMB_CLASS.gas ? "gas" : null;
/** the EnergyPlus class a card writes (the `#gas` key dropped) */
export const realClassOf = (cls: string): string => cls.split("#")[0]!;
export const PLUMB_SHELVES = ["WATER HEATERS", "HOT-WATER USE", "DOMESTIC WATER"];
const P = (key: string, dir: "in" | "out", label: string): CatPort => ({ key, medium: "hw", dir, label });
const SPECS: Array<{ cls: string; shelf: string; label: string; sub: string; tag?: string; ports: CatPort[]; noLoc?: true }> = [
  { cls: PLUMB_CLASS.well, shelf: "DOMESTIC WATER", label: "Well pump", noLoc: true, sub: "the house's whole water — cold and hot — lifted from the well: its electricity metered as exterior equipment (no room takes its heat), running as long as the day's water at its flow takes, on the SCHEDULES › domestic water shape", ports: [] },
  { cls: PLUMB_CLASS.hpwh, shelf: "WATER HEATERS", label: "Heat pump water heater", sub: "a wrapped-condenser heat pump on a stratified tank with its backup element: it draws the room's air over its evaporator — the room's zone is cooled and dried by it — and the tank's skin losses go to the same zone (the engine's SingleFamilyHouse_HP_Slab.idf shape)", ports: [P("hw-out", "out", "HW")] },
  { cls: PLUMB_CLASS.electric, shelf: "WATER HEATERS", label: "Electric water heater", sub: "a resistance-element storage tank (WaterHeater:Stratified, electricity — the heat pump's own tank without the heat pump): its skin losses go to the room's zone", ports: [P("hw-out", "out", "HW")] },
  { cls: PLUMB_CLASS.gas, shelf: "WATER HEATERS", label: "Gas water heater", sub: "a gas- or propane-fired storage tank (WaterHeater:Stratified, the fuel picked in the column): its skin and flue losses go to the room's zone", ports: [P("hw-out", "out", "HW")] },
  { cls: PLUMB_CLASS.use, shelf: "HOT-WATER USE", label: "Hot-water use", tag: "Per Dwelling", sub: "ONE DWELLING's hot water (the main house, or the ADU — an Auxiliary Dwelling Unit): the rooms it serves ticked in the column; the bedrooms among them (ticked on ZONES) set the code's reference daily use, drawn on the Building America hourly shape", ports: [P("hw-in", "in", "HW")] },
];

/** THE HOT-WATER USE METHOD (the user, 2026-10-07: "label the plumbing cards as to method (Per Dwelling and Per Fixture, and make them
 *  mutually exclusive to avoid confusion)"): ONE method for the whole sheet, every use card labelled with it. Per Dwelling is the
 *  code's rule — one card per dwelling unit, 30 + 10 × Nbr gal/day each. Per Fixture — a flow per bath, kitchen and laundry — is
 *  not built: it needs a per-fixture rule the user picks (it departs from the code's reference design), so it is shown, not offered */
export const DHW_METHODS = [
  { id: "dwelling", label: "Per Dwelling", built: true, words: "one hot-water use card per dwelling unit — the main house and the ADU each get the code's daily use once, from the bedrooms among the rooms the card serves" },
  { id: "fixture", label: "Per Fixture", built: false, words: "a flow per fixture room (each bath, the kitchen, the laundry) — not built: it needs a per-fixture rule you pick (e.g. ANSI/RESNET/ICC 301's fixture terms), and it departs from the code's reference design" },
] as const;

/** the sheet's catalogue: the four cards, their connectors stated */
export function readPlumbCatalogue(schema: EpSchema | null): Catalogue {
  const entries = new Map<string, CatEntry>(), missing: string[] = [];
  for (const s of SPECS) {
    const c = schema?.classOf(realClassOf(s.cls)) ?? null;
    if (schema && !c) missing.push(realClassOf(s.cls));
    entries.set(s.cls, { cls: s.cls, group: c?.group ?? "", tier: "component", shelf: s.shelf, label: s.label, sub: s.sub, ports: s.ports, unread: [], zoneAttached: false, accepts: {}, ...(s.tag ? { tag: s.tag } : {}), ...(s.noLoc ? { noLoc: true as const } : {}) });
  }
  return {
    entries, missing, census: `${entries.size} plumbing cards${missing.length ? ` · NOT IN THE SCHEMA ${missing.join(", ")}` : ""}`,
    of: (cls) => entries.get(cls) ?? null,
    byShelf: (shelf) => [...entries.values()].filter((e) => e.shelf === shelf),
  };
}

// ── THE CODE'S REFERENCE USE (the user's ruling, 2026-10-02). Read 2026-10-02 (the ICC's own pages refused the reader; the text was
//    read on state adoptions of the model code and in the 2009 edition's full text):
//    IECC 2009 (Table 405.5.2(1)), 2015 and 2018 (Table R405.5.2(1)), "Service water heating" — "Use, in units of gal/day = 30 + (10 × Nbr)
//    where: Nbr = number of bedrooms"; IECC 2021 (Table R405.4.2(1)) — the standard reference design's "gal/day = 25.5 + (8.5 × Nbr)"
//    (the proposed design's (1 − HWDS) compactness factor is not applied: 0 for a distribution not rated). 2012 was not read (2009 and
//    2015 read the same); 2024 was not read — 2021's is used and the card says so.
export interface DhwUseRule { edition: string; gpd: (nbr: number) => number; words: string; cite: string; read: boolean }
export function dhwUseRule(edition: string | undefined): DhwUseRule {
  const e = edition ?? "IECC-2018";
  const old = { gpd: (n: number) => 30 + 10 * n, words: "30 + 10 × Nbr gal/day" };
  const new21 = { gpd: (n: number) => 25.5 + 8.5 * n, words: "25.5 + 8.5 × Nbr gal/day" };
  if (/2021/.test(e)) return { edition: e, ...new21, cite: "IECC 2021 Table R405.4.2(1), Service water heating (standard reference design)", read: true };
  if (/2024/.test(e)) return { edition: e, ...new21, cite: "IECC 2024 NOT READ — the 2021 edition's Table R405.4.2(1) is used", read: false };
  if (/2012/.test(e)) return { edition: e, ...old, cite: "IECC 2012 NOT READ — the 2009 and 2015 editions' rule (Table R405.5.2(1)), which read the same", read: false };
  return { edition: e, ...old, cite: `${/2009/.test(e) ? "IECC 2009 Table 405.5.2(1)" : /2015/.test(e) ? "IECC 2015 Table R405.5.2(1)" : "IECC 2018 Table R405.5.2(1)"}, Service water heating`, read: true };
}
/** THE HOURLY SHAPE: none of the codes gives the hours as numbers (ANSI/RESNET/ICC 301-2019 has none; the 2010 Building America
 *  House Simulation Protocols draw it, Figure 13, its numbers in the BA Analysis Spreadsheet). The engine's own single-family example
 *  carries the Building America showers, sinks and baths schedules (SingleFamilyHouse_HP_Slab.idf: BA_shower_sch, BA_sink_sch,
 *  BA_bath_sch); their sum weighted by each one's peak flow there, scaled to 1 at its highest hour, is the shape — 0–1 h first */
export const DHW_SHAPE = [0.1362, 0.0654, 0.0452, 0.0559, 0.1191, 0.39, 0.8944, 1.0, 0.9116, 0.7692, 0.64, 0.5364, 0.4565, 0.3999, 0.3743, 0.3595, 0.4411, 0.5794, 0.6846, 0.6872, 0.6303, 0.5513, 0.4342, 0.2932];
export const DHW_SHAPE_CITE = "the Building America showers, sinks and baths schedules as the engine's SingleFamilyHouse_HP_Slab.idf carries them, weighted by their peak flows there";
const M3_PER_GAL = 0.003785411784;
/** the tank's peak use flow for a daily volume on the shape: V / (3600 s × Σ shape) */
export const peakFlowM3s = (gpd: number, shape: readonly number[] = DHW_SHAPE): number => (gpd * M3_PER_GAL) / (3600 * shape.reduce((t, v) => t + v, 0));
/** a ruled profile's hours as one day: the week's average of its weekday and weekend (first date block) — what its draw sums to a day */
export const weekShape = (p: { weekday: number[]; weekend: number[] }): number[] => Array.from({ length: 24 }, (_, h) => ((p.weekday[h] ?? 0) * 5 + (p.weekend[h] ?? 0) * 2) / 7);
/** the tank setpoint: 125 °F — ANSI/RESNET/ICC 301-2019 Table 4.2.2(1) "Tank temperature: 125 °F" (the IECC tables state none) */
export const DHW_SETPOINT_C = 51.67;
export const DHW_SETPOINT_CITE = "ANSI/RESNET/ICC 301-2019 Table 4.2.2(1), tank temperature 125 °F";
/** a bathroom by name: "Hall Bath", "ADU Bath" — never a void over one ("Attic – Hall Bath") nor its WC */
export const bathroomsByName = (rooms: Iterable<string>): number => [...rooms].filter((r) => /\bbath$/i.test(r) && !/^(attic|interstitial)/i.test(r)).length;

/** the rooms a card holds (a use card: the rooms it serves; a heater: the one it sits in) */
export const ROOMS_OF = (n: AsmNode): string[] => n.rooms ?? [];
export function withRooms(asm: Assembly, id: string, rooms: string[]): Assembly {
  return patchNode(asm, id, (n) => { const m = { ...n }; const r = [...new Set(rooms)]; if (r.length) m.rooms = r; else delete m.rooms; return m; });
}

// ── THE DOMESTIC WATER (user, 2026-10-03: "a Domestic Water component set (overall plumbing) which will have Well Pump"; the daily
//    use by a cited rule the user sees before it is used). Read 2026-10-03 from the Water Research Foundation's executive report:
//    "Per capita average water use has decreased 15 percent, from 69.3 gpcd (REU1999) to 58.6 gpcd (REU2016)" — indoor use of
//    single-family homes, 2.65 people a household, 138 gphd (p. 8); hot water 45.5 gphd, 33.2 % of indoor use (p. 5). Outdoor use
//    (irrigation) is left out: the report gives it by climate, not as a rule. The occupants are the model's own (BAHSP 2014 Eq. 23).
export const REU2016 = { gpcd: 58.6, cite: "Water Research Foundation, Residential End Uses of Water, Version 2 — Executive Report (2016), p. 8: indoor use 58.6 gal per person per day (138 gal per household at 2.65 people); outdoor use not included" } as const;
/** the well pump card's own keys (not the engine's fields): how the day's water is stated, the pump's electric power and its flow */
export const WELL_RULE_FIELD = "water_use_rule", WELL_GPD_FIELD = "gallons_per_day", WELL_W_FIELD = "pump_power_w", WELL_GPM_FIELD = "pump_flow_gpm";
export interface DwWell { node: string; name: string; gpd: number; gpdWords: string; pumpW: number; gpm: number; runHours: number }
export interface DhwUse { node: string; name: string; rooms: string[]; bedrooms: number; bedroomsTyped: boolean; bathrooms: number; gpd: number }
export interface DhwHeater { node: string; name: string; kind: HeaterKind; room: string; fields: SystemFields; uses: DhwUse[]; gpd: number }
export interface PlumbCompiled { heaters: DhwHeater[]; uses: DhwUse[]; wells: DwWell[]; rule: DhwUseRule; refusals: Array<{ node: string; text: string }>; cautions: Array<{ node: string; text: string }> }

const nameOf = (n: AsmNode): string => n.ident?.trim() || n.label || SPECS.find((s) => s.cls === n.cls)?.label || n.id;
export const BEDROOMS_FIELD = "bedrooms";

/** the sheet → the heaters the writer emits. `rooms` = the model's rooms (a heater's room must be one) */
/** `occupants` = the model's own count (BAHSP 2014, the gains' rule) — the REU2016 rule's people */
/** `marks` = the bedroom ticks on ZONES (2026-10-07) — the one place a bedroom is said; absent, by name */
export function compilePlumbing(asm: Assembly, rooms: readonly string[], edition: string | undefined, occupants?: number, marks?: BedroomMarks): PlumbCompiled {
  const refusals: PlumbCompiled["refusals"] = [], cautions: PlumbCompiled["cautions"] = [];
  const rule = dhwUseRule(edition);
  const known = new Set(rooms);
  const refuse = (n: AsmNode, text: string): void => { refusals.push({ node: n.id, text: `${nameOf(n)} ${text}` }); };
  const comps = asm.nodes.filter((n) => n.kind === "component");
  const into = (n: AsmNode): AsmNode[] => asm.edges.filter((e) => e.to === n.id && e.toPort === "hw-in").map((e) => asm.nodes.find((x) => x.id === e.from)).filter((x): x is AsmNode => !!x);
  // the uses: their rooms, the bedrooms counted from them (or typed), the code's daily volume, the ONE heater feeding them
  const uses: DhwUse[] = [], useHeater = new Map<string, string>();
  const claimed = new Map<string, string>();
  for (const n of comps.filter((x) => x.cls === PLUMB_CLASS.use)) {
    const rs = ROOMS_OF(n).filter((r) => known.has(r)), gone = ROOMS_OF(n).filter((r) => !known.has(r));
    // a number typed on the card before 2026-10-07 is retired: the bedrooms are ticked on ZONES, one place (read, not used)
    const typed = null as number | null;
    const feeders = into(n).filter((x) => heaterKindOf(x.cls));
    let ok = true;
    if (!rs.length) { refuse(n, "serves no room — tick the rooms of its dwelling in the column (the bedrooms among them, ticked on ZONES, set the use)"); ok = false; }
    if (gone.length) cautions.push({ node: n.id, text: `${nameOf(n)}: ${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} not in the model — left out of the count` });
    const twice = rs.filter((r) => claimed.has(r) && claimed.get(r) !== n.id);
    if (twice.length) cautions.push({ node: n.id, text: `${nameOf(n)}: ${twice.join(", ")} also served by ${claimed.get(twice[0]!) ? nameOf(asm.nodes.find((x) => x.id === claimed.get(twice[0]!))!) : "another use"} — its bedrooms are counted twice` });
    for (const r of rs) if (!claimed.has(r)) claimed.set(r, n.id);
    if (!feeders.length) { refuse(n, "— no water heater feeds its HW in: connect a heater's HW out to it"); ok = false; }
    if (feeders.length > 1) { refuse(n, "— two water heaters feed it: a use is drawn from one heater (split the rooms over two use cards)"); ok = false; }
    const bedrooms = bedroomsByName(rs, marks);
    if (!ok) continue;
    const u: DhwUse = { node: n.id, name: nameOf(n), rooms: rs, bedrooms, bedroomsTyped: typed !== null, bathrooms: bathroomsByName(rs), gpd: rule.gpd(bedrooms) };
    if (!rule.read) cautions.push({ node: n.id, text: `${u.name}: ${rule.cite}` });
    uses.push(u); useHeater.set(n.id, feeders[0]!.id);
  }
  // the heaters: the room they sit in (one, in the model), the uses they feed
  const heaters: DhwHeater[] = [];
  for (const n of comps) {
    const kind = heaterKindOf(n.cls);
    if (!kind) continue;
    const r = ROOMS_OF(n);
    if (!r.length) { refuse(n, "sits in no room — pick its room in the column (the room's zone takes its losses" + (kind === "hpwh" ? " and gives it its air)" : ")")); continue; }
    if (!known.has(r[0]!)) { refuse(n, `sits in ${r[0]}, which is not in the model — pick a room of the model`); continue; }
    const mine = uses.filter((u) => useHeater.get(u.node) === n.id);
    if (!mine.length) cautions.push({ node: n.id, text: `${nameOf(n)} feeds no hot-water use — written with no draw: its standby losses alone (connect its HW out to a use)` });
    heaters.push({ node: n.id, name: nameOf(n), kind, room: r[0]!, fields: { ...(n.fields ?? {}) }, uses: mine, gpd: mine.reduce((t, u) => t + u.gpd, 0) });
  }
  // the well pumps: the day's water by the rule picked (or typed), the pump's power and flow typed — nothing assumed
  const wells: DwWell[] = [];
  for (const n of comps.filter((x) => x.cls === PLUMB_CLASS.well)) {
    const f = n.fields ?? {};
    const numF = (k: string): number | null => (typeof f[k] === "number" && (f[k] as number) > 0 ? (f[k] as number) : null);
    let gpd: number | null = null, gpdWords = "";
    if (f[WELL_RULE_FIELD] === "reu2016") {
      if (occupants === undefined || !(occupants > 0)) refuse(n, "— the REU2016 rule needs the model's occupants, and there are none");
      else { gpd = REU2016.gpcd * occupants; gpdWords = `${REU2016.gpcd} gal/person/day × ${occupants.toFixed(2)} occupants (REU2016)`; }
    } else if (numF(WELL_GPD_FIELD) !== null) { gpd = numF(WELL_GPD_FIELD)!; gpdWords = `${gpd} gal/day, typed`; }
    else refuse(n, "— the day's water is not stated: pick the REU2016 rule or type gal/day in the column");
    const w = numF(WELL_W_FIELD), q = numF(WELL_GPM_FIELD);
    if (w === null) refuse(n, "— its electric power is not stated (the pump's nameplate W)");
    if (q === null) refuse(n, "— its flow is not stated (the pump's gpm at the system's pressure)");
    if (gpd === null || w === null || q === null) continue;
    wells.push({ node: n.id, name: nameOf(n), gpd, gpdWords, pumpW: w, gpm: q, runHours: gpd / q / 60 });
  }
  return { heaters, uses, wells, rule, refusals, cautions };
}

/** the tank volume a file's name states: Bradford White's "RE2H80…" (an AeroTherm's 80 gal), or "50 gal" / "50-gallon" spelled out */
export function gallonsInName(name: string): number | null {
  const bw = /\bRE\d?H(\d{2,3})/i.exec(name);
  if (bw) return Number(bw[1]);
  const g = /(\d{2,3})\s*-?\s*gal(lon)?s?\b/i.exec(name);
  return g ? Number(g[1]) : null;
}
/** a water heater of the file, by its name: heat pump (an AeroTherm, "heat pump"), gas (gas, propane), else electric */
export function heaterKindInName(name: string): HeaterKind {
  if (/aerotherm|heat[_ -]?pump|hpwh/i.test(name)) return "hpwh";
  if (/gas|propane|natural|lp\b/i.test(name)) return "gas";
  return "electric";
}
export const isFileWaterHeater = (name: string): boolean => /water[_ -]?heater/i.test(name) && !/expansion/i.test(name);

/** A FIRST SHEET FROM THE FILE (the user's ruling, 2026-10-02): a card per water heater the file places, in the room the file puts
 *  it in, its tank volume from its name; a hot-water use card under each, connected. Which rooms each heater serves the file does not
 *  say: a FIRST GUESS by zone is ticked — a heater in a zone named ADU serves that zone's rooms, the others share every other
 *  conditioned room (the first heater takes them) — said on the card, for the user to check */
export function sheetFromFile(heaters: Array<{ name: string; room: string | null }>, zoneOfRoom: ReadonlyMap<string, string>, conditionedRooms: readonly string[]): Assembly {
  let asm: Assembly = { nodes: [], edges: [] };
  const add = (cls: string, label: string, x: number, y: number): string => { const r = addNode(asm, { node: "component", cls, label }, x, y); asm = r.asm; return r.id; };
  const zoneOf = (r: string | null): string => (r ? zoneOfRoom.get(r) ?? "" : "");
  // a room of the ADU by its own name or its zone's ("ADU Crawl" in zone ADU, or a zone of its own)
  const isAdu = (r: string | null): boolean => !!r && (/\badu\b/i.test(r) || /\badu\b/i.test(zoneOf(r)));
  let restTaken = false;
  heaters.forEach((h, i) => {
    const kind = heaterKindInName(h.name), cls = PLUMB_CLASS[kind];
    const gal = gallonsInName(h.name);
    const short = h.name.split(":")[0]!.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const id = add(cls, short.length > 40 ? `${SPECS.find((s) => s.cls === cls)!.label} ${i + 1}` : short, 0, i * 160);
    if (h.room) asm = withRooms(asm, id, [h.room]);
    if (gal) asm = patchNode(asm, id, (n) => ({ ...n, fields: { ...(n.fields ?? {}), tank_volume: Number((gal * M3_PER_GAL).toFixed(5)) } }));
    const adu = isAdu(h.room);
    const serves = adu ? conditionedRooms.filter(isAdu) : restTaken ? [] : conditionedRooms.filter((r) => !isAdu(r));
    if (!adu) restTaken = true;
    const use = add(PLUMB_CLASS.use, `Hot-water use · ${adu ? "the ADU" : "the house"}`, 330, i * 160);
    if (serves.length) asm = withRooms(asm, use, serves);
    asm = addEdge(asm, id, use, "hw-out", "hw-in");
  });
  return asm;
}
