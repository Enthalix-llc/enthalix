// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SYSTEMS TAB'S SECTIONS (user, 2026-09-10): MECHANICAL (Heating · Cooling
// · Ventilation) · ELECTRICAL (Power · Lighting · Generation) · PLUMBING
// (Domestic Hot Water · Water) — and which of the services inventory's
// elements each subsection LIGHTS in the view. The focus rules here are a
// display grouping over what the file states (class, system membership,
// Uniformat code, the family name) and nothing more: an element may light in
// two subsections (a duct carries heating and ventilation), and lighting an
// element never puts it in the model.

import type { MepElementRow, MepSystemRow } from "../../../core/db.js";

export type MainSection = "mechanical" | "electrical" | "plumbing";
export type SystemSection = "heating" | "cooling" | "ventilation" | "power" | "lighting" | "generation" | "dhw" | "water";
/** a subsection is a SYSTEM (an object the engine runs), a LOAD (per zone) or DEMAND (what the fixtures draw) — HPXML's split, visible in the headers */
export interface SubDef { id: SystemSection; label: string; kind: "system" | "load" | "demand"; consumer: string; defaultKind: string }
export const SECTION_TREE: Array<{ id: MainSection; label: string; subs: SubDef[] }> = [
  { id: "mechanical", label: "MECHANICAL", subs: [
    { id: "heating", label: "Heating", kind: "system", consumer: "HVACTemplate:Zone:* / System:*", defaultKind: "HVACTemplate:Zone:IdealLoadsAirSystem" },
    { id: "cooling", label: "Cooling", kind: "system", consumer: "HVACTemplate:Zone:* / System:*", defaultKind: "HVACTemplate:Zone:IdealLoadsAirSystem" },
    { id: "ventilation", label: "Ventilation", kind: "system", consumer: "ZoneVentilation:DesignFlowRate", defaultKind: "ZoneVentilation:DesignFlowRate" },
  ] },
  { id: "electrical", label: "ELECTRICAL", subs: [
    { id: "power", label: "Power", kind: "load", consumer: "ElectricEquipment", defaultKind: "ElectricEquipment" },
    { id: "lighting", label: "Lighting", kind: "load", consumer: "Lights", defaultKind: "Lights" },
    { id: "generation", label: "Generation", kind: "system", consumer: "Generator:PVWatts + ElectricLoadCenter:*", defaultKind: "Generator:PVWatts" },
  ] },
  { id: "plumbing", label: "PLUMBING", subs: [
    { id: "dhw", label: "Domestic Hot Water", kind: "system", consumer: "WaterHeater:Mixed", defaultKind: "WaterHeater:Mixed" },
    { id: "water", label: "Domestic Water", kind: "demand", consumer: "Exterior:FuelEquipment (the well pump)", defaultKind: "WaterUse:Equipment" },
  ] },
];
export const SECTION_LABELS: Record<SystemSection, string> = Object.fromEntries(SECTION_TREE.flatMap((m) => m.subs.map((s) => [s.id, s.label]))) as Record<SystemSection, string>;
export const MAIN_OF: Record<SystemSection, MainSection> = Object.fromEntries(SECTION_TREE.flatMap((m) => m.subs.map((s) => [s.id, m.id]))) as Record<SystemSection, MainSection>;
export const subDef = (s: SystemSection): SubDef => SECTION_TREE.flatMap((m) => m.subs).find((x) => x.id === s)!;

/** what the model runs on for a subsection with no ruling — the writer's own defaults, in words */
export const CODE_DEFAULT_SYSTEM: Record<SystemSection, string> = {
  heating: "ideal loads — every conditioned zone met at 100 % efficiency, reported as district heating (HVACTemplate:Zone:IdealLoadsAirSystem)",
  cooling: "ideal loads — every conditioned zone met at 100 % efficiency, reported as district cooling (HVACTemplate:Zone:IdealLoadsAirSystem)",
  ventilation: "none — infiltration only (3 ACH50 ÷ 20); no whole-house or local ventilation until ruled",
  power: "the engine's residential example's appliances and plug loads on every room's Space (ZONES › LOADS)",
  lighting: "lights on every room's Space — the file's fixtures where a wattage is stated, else the example's W/m² (ZONES › LIGHTING)",
  generation: "none — no PV, storage or generator until ruled",
  dhw: "none — no water heater until ruled",
  water: "none — no well pump until ruled",
};

/** the fields of an element the focus rules read (a db row, or the projection) */
export interface MepLike { name: string; kind: string; ifcClass: string; discipline: string; systems: Array<{ name: string; predefinedType: string }>; uniformat: string | null; room: string | null; interior: boolean }
const inSys = (e: MepLike, re: RegExp): boolean => e.systems.some((s) => re.test(s.predefinedType));
const nm = (e: MepLike, re: RegExp): boolean => re.test(e.name);
const AIR_RUN = /^Ifc(AirTerminal|AirTerminalBox|DuctSegment|DuctFitting|DuctSilencer)$/;
const VENT_ONLY = /exhaust|hooded|roof vent|ventub|dryer ?box|louver|renewaire|erv|hrv/i;
export const FOCUS: Record<SystemSection, (e: MepLike) => boolean> = {
  heating: (e) => e.discipline === "mechanical" && !inSys(e, /EXHAUST|^VENT$/) && !nm(e, VENT_ONLY) && !/^IfcDamper$/.test(e.ifcClass),
  cooling: (e) => e.discipline === "mechanical" && !inSys(e, /EXHAUST|^VENT$/) && !nm(e, VENT_ONLY) && !/^IfcDamper$/.test(e.ifcClass) && !nm(e, /wall[_ -]?heater|unit heater|bromic|berko|ceiling[_ -]?mounted/i),
  ventilation: (e) => inSys(e, /VENTILATION|EXHAUST/) || AIR_RUN.test(e.ifcClass) || /^Ifc(Damper|Fan|AirToAirHeatRecovery)$/.test(e.ifcClass) || nm(e, VENT_ONLY) || nm(e, /ceiling fan|haiku/i),
  power: (e) => e.discipline === "electrical" && !FOCUS.lighting(e) && !FOCUS.generation(e),
  lighting: (e) => /^Ifc(LightFixture|Lamp)$/.test(e.ifcClass) || nm(e, /^Switches|-LTG|Ltg\b|lighting/i),
  generation: (e) => nm(e, /solar|photovolt|inverter|battery|generator|combiner|\bATS\b|electric meter/i) || (e.uniformat ?? "").startsWith("D5010"),
  dhw: (e) => nm(e, /water[_ -]?heater|aerotherm|red coil|hot water/i) || inSys(e, /DOMESTICHOTWATER/) || nm(e, /expansion tank/i),
  water: (e) => inSys(e, /DOMESTICCOLDWATER|SEWAGE|^VENT$|USERDEFINED/) || /^Ifc(FlowTerminal|SanitaryTerminal|WasteTerminal|StackTerminal|Valve|Pump|Tank|Interceptor)$/.test(e.ifcClass) || nm(e, /softener|manabloc|manifold|hydrant|blue coil|dwv|propane|lpg|gas\b|well/i),
};

export interface KindSummary { kind: string; ifcClass: string; count: number; rooms: string[]; storeys: string[]; systems: string[]; manufacturer: string | null; wattageW: number | null; wattageStated: number; uniformat: string | null; interior: number; ids: number[] }
/** the inventory in focus, grouped by the file's kind (the Family:Type), the way the column and the options table list it */
export function kindSummary(els: MepElementRow[], section: SystemSection): KindSummary[] {
  const f = FOCUS[section];
  const by = new Map<string, KindSummary>();
  for (const e of els) {
    if (!f(e)) continue;
    let k = by.get(e.kind);
    if (!k) { k = { kind: e.kind, ifcClass: e.ifcClass, count: 0, rooms: [], storeys: [], systems: [], manufacturer: e.manufacturer, wattageW: null, wattageStated: 0, uniformat: e.uniformat, interior: 0, ids: [] }; by.set(e.kind, k); }
    k.count++; k.ids.push(e.expressId);
    if (e.interior) k.interior++;
    if (e.room && !k.rooms.includes(e.room)) k.rooms.push(e.room);
    if (e.storey && !k.storeys.includes(e.storey)) k.storeys.push(e.storey);
    for (const s of e.systems) { const t = `${s.predefinedType.toLowerCase()} ${s.name}`; if (!k.systems.includes(t)) k.systems.push(t); }
    const w = e.wattageW ?? e.powerW;
    if (w !== null) { k.wattageW = (k.wattageW ?? 0) + w; k.wattageStated++; }
    k.manufacturer ??= e.manufacturer; k.uniformat ??= e.uniformat;
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}
/** the distribution systems a subsection is about, with the rooms their members lie in */
export function systemsFor(systems: MepSystemRow[], section: SystemSection): MepSystemRow[] {
  const want: Record<SystemSection, RegExp | null> = { heating: /VENTILATION/, cooling: /VENTILATION/, ventilation: /VENTILATION|EXHAUST/, power: /ELECTRICAL/, lighting: null, generation: null, dhw: /DOMESTICHOTWATER/, water: /DOMESTICCOLDWATER|SEWAGE|^VENT$|USERDEFINED/ };
  const re = want[section];
  return re ? systems.filter((s) => re.test(s.predefinedType)).sort((a, b) => b.members - a.members) : [];
}
/** a number READ OUT OF A TYPE NAME (the glazedByName precedent): shown as a default in the inherited colour, adopted only by a ruling */
const RUN_CLASS = /^Ifc(DuctSegment|DuctFitting|DuctSilencer|PipeSegment|PipeFitting|CableCarrierSegment|CableCarrierFitting|CableSegment|AirTerminal|AirTerminalBox|FlowSegment|FlowFitting)$/;
export function ratingFromName(name: string, ifcClass?: string): { value: number; unit: "W" | "kW" | "kWh" | "A" | "VA" | "gal" | "HP"; text: string } | null {
  if (ifcClass && RUN_CLASS.test(ifcClass)) return null;      // a duct elbow's "Radius:1.5W" is a shape, not a rating
  const m = /(\d+(?:\.\d+)?)\s*(kwh|kw|w|va|a|gal|hp)\b/i.exec(name.replace(/(\d)(?=[A-Za-z])/g, "$1 ").replace(/[_-]/g, " "));
  if (!m) return null;
  const v = Number(m[1]);
  const u = m[2]!.toLowerCase();
  const unit = u === "kwh" ? "kWh" : u === "kw" ? "kW" : u === "w" ? "W" : u === "va" ? "VA" : u === "a" ? "A" : u === "gal" ? "gal" : "HP";
  return { value: v, unit, text: `${m[1]} ${unit} from the type name` };
}
