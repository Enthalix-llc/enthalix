// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE COMPONENT CATALOGUE (user, 2026-09-11: "we need to confirm components
// match energyplus components … view cards that represent available system
// components"). A card on the MECHANICAL sheet is ONE EnergyPlus object, and
// everything the card needs is READ from the engine's own schema: its group
// (the IDD's own grouping), its fields, and — the part that makes a card
// wireable — its CONNECTORS.
//
// A component's connectors are its inlet and outlet NODE fields. The schema
// does not mark them (`air_inlet_node_name` is a plain string), but the field
// NAMES are strict, so the medium is read from the name: `air`, `outdoor_air`,
// `relief`/`exhaust`, `water`/`steam`/`condenser`… Measured over the engine's
// 200 HVAC equipment classes: 91 parse completely, 58 have at least one node
// field whose name does not say its medium (a water baseboard's bare
// `inlet_node_name`, a DX coil's `evaporator_*`), and 51 have no node fields
// at all because they attach to a ZONE rather than to a loop. The 58 take a
// STATED rule, one line each, and a class with neither a readable name nor a
// rule is LISTED, never guessed — the gate fails if a catalogue class is unread.
//
// What may attach to what is read the same way: a parent's `*_object_type`
// field carries the enum of the children it accepts, so a refusal names the
// engine's own list rather than a list of ours.

import type { EpSchema, EpClass } from "./epSchema.js";

/** the media a connector carries — the sheet's own words, `loc` being the LOCATION connector (a unit is IN a zone) */
export type PortMedium = "air" | "oa" | "exh" | "wtr" | "loc" | "dc" | "ac" | "hw";
export interface CatPort { key: string; medium: PortMedium; dir: "in" | "out"; label: string }
/** where a card sits on the bench, and how its border reads: ideal loads a full border, a template left + bottom, a component left only */
export type Tier = "ideal" | "template" | "component";
export interface CatEntry {
  cls: string; group: string; tier: Tier;
  /** the bench's own shelf for it — the engine's group name is long, this is the rail */
  shelf: string;
  label: string; sub: string;
  /** a word every card of the class carries after its own label (the hot-water use's METHOD, 2026-10-07: "Per Dwelling") */
  tag?: string;
  ports: CatPort[];
  /** a card in no zone and with no connector (the well pump, 2026-10-03): its settings are in the column */
  noLoc?: true;
  /** a pass-through card at half width (a pump): in on the left, out on the right, this word as its name */
  narrow?: string;
  /** read but not offered: an older sheet's card keeps its connectors; the bench and the substitute list leave it out */
  retired?: string;
  /** node fields neither the name nor a rule reads — named, never guessed */
  unread: string[];
  /** no node fields at all: it attaches to a zone, not to a loop */
  zoneAttached: boolean;
  /** field key → the classes that field accepts, the engine's own enum */
  accepts: Record<string, string[]>;
}

const NODE_FIELD = /(^|_)(inlet|outlet)_node_name$/;
/** the medium the field's own name states */
export function mediumFromName(key: string): PortMedium | null {
  if (/outdoor_air/.test(key)) return "oa";
  if (/relief|exhaust/.test(key)) return "exh";
  if (/air/.test(key)) return "air";
  if (/water|steam|glycol|brine|fluid|condenser|chilled|refrigerant/.test(key)) return "wtr";
  return null;
}
/** THE STATED RULES: a node field whose name does not say its medium. One line per class, the reason in the comment. */
const MEDIUM_RULES: Record<string, PortMedium> = {
  // a pump moves the loop's own fluid; the loop says which, the pump does not
  "Pump:VariableSpeed": "wtr", "Pump:ConstantSpeed": "wtr",
  "HeaderedPumps:ConstantSpeed": "wtr", "HeaderedPumps:VariableSpeed": "wtr",
  // a hydronic baseboard's bare inlet/outlet are its water connections
  "ZoneHVAC:Baseboard:Convective:Water": "wtr", "ZoneHVAC:Baseboard:RadiantConvective:Water": "wtr",
  "ZoneHVAC:Baseboard:RadiantConvective:Steam": "wtr",
  // a LOOP's own sides — `plant_side_*` / `demand_side_*` — carry the loop's fluid; `fluid_type` says which, and
  // water, steam and a glycol all join water on the sheet
  "PlantLoop": "wtr", "CondenserLoop": "wtr",
  // the ground loop's own connections are water
  "GroundHeatExchanger:System": "wtr", "GroundHeatExchanger:Slinky": "wtr", "GroundHeatExchanger:HorizontalTrench": "wtr",
  "GroundHeatExchanger:Pond": "wtr", "GroundHeatExchanger:Surface": "wtr",
  // a fluid-to-fluid exchanger's four nodes are a loop's supply side and another loop's demand side — hydronic fluids only (the reference)
  "HeatExchanger:FluidToFluid": "wtr",
};
const LABEL: Record<PortMedium, string> = { air: "Air", oa: "OA", exh: "Exh", wtr: "Wtr", loc: "Loc", dc: "DC", ac: "AC", hw: "HW" };
/** the medium of a card's connector from its key alone — the name, else the class's stated rule; the compile reads a line's medium this way */
export function portMediumOf(cls: string, key: string): PortMedium | null {
  if (key === "loc-out" || key === "loc-in") return "loc";
  return mediumFromName(key) ?? MEDIUM_RULES[cls] ?? null;
}

/** ZONE-CONTAINED EQUIPMENT (user, 2026-09-11: "can we infer its inclusion into a specific zone by the top connector?").
 *  Yes — and further: a unit that SITS IN a zone joins that zone's own air nodes, so those connections have no decision in
 *  them and are generated from the LOCATION connector alone. Only what LEAVES the zone stays a drawn connector: a hydronic
 *  baseboard's water side goes to a plant loop, and that is a real choice. So a ZoneHVAC:* card (and a zone exhaust fan,
 *  whose inlet is the zone's exhaust node) shows its water and exhaust connectors and hides its air ones. */
const zoneContained = (cls: string): boolean => cls.startsWith("ZoneHVAC:") || cls === "Fan:ZoneExhaust";
const leavesTheZone = (m: PortMedium): boolean => m === "wtr";
/** THE WATER SIDE OF A HEAT PUMP IS ITS COILS' (measured 2026-09-11): a water-to-air heat pump parent —
 *  `AirLoopHVAC:UnitaryHeatPump:WaterToAir`, `ZoneHVAC:WaterToAirHeatPump`, `AirLoopHVAC:UnitarySystem` — carries air nodes
 *  and NO plant nodes of its own; the `Coil:*:WaterToAirHeatPump:*` objects it names hold the water connection. (What water
 *  nodes `AirLoopHVAC:UnitarySystem` does have are for HEAT RECOVERY, which is a different thing again.) The card therefore
 *  shows a water connector that STANDS FOR its coils', and the generator wires the coils' own nodes to the loop. */
const COIL_PLANT: readonly string[] = ["AirLoopHVAC:UnitaryHeatPump:WaterToAir", "ZoneHVAC:WaterToAirHeatPump", "AirLoopHVAC:UnitarySystem"];
export const OA_PARENTS: readonly string[] = ["AirLoopHVAC:UnitaryHeatPump:WaterToAir", "AirLoopHVAC:UnitarySystem"];
/** a class's connectors, read from its node fields; the medium from the name, else the stated rule */
export function portsOf(c: EpClass): { ports: CatPort[]; unread: string[] } {
  const ports: CatPort[] = [], unread: string[] = [];
  const rule = MEDIUM_RULES[c.cls] ?? null;
  for (const f of c.fields) {
    if (!NODE_FIELD.test(f.key)) continue;
    const medium = mediumFromName(f.key) ?? rule;
    if (!medium) { unread.push(f.key); continue; }
    ports.push({ key: f.key, medium, dir: /(^|_)inlet_node_name$/.test(f.key) ? "in" : "out", label: LABEL[medium] });
  }
  // two ports of one medium and direction are told apart by the word their keys do not share
  for (const m of ["air", "oa", "exh", "wtr"] as PortMedium[]) {
    for (const d of ["in", "out"] as const) {
      const same = ports.filter((p) => p.medium === m && p.dir === d);
      if (same.length < 2) continue;
      for (const p of same) {
        const word = p.key.replace(/_(inlet|outlet)_node_name$/, "").split("_").filter((w) => !/^(air|water|node|name|the)$/.test(w))[0];
        if (word) p.label = `${LABEL[m]} ${word.slice(0, 6)}`;
      }
    }
  }
  for (const q of ports) if (/heat_recovery/.test(q.key)) q.label = "HR";   // a unitary system's own water nodes are heat recovery
  if (c.cls === "HeatExchanger:FluidToFluid") for (const q of ports) q.label = /demand/.test(q.key) ? "Dem" : "Sup";   // its two sides, the loops' own words
  if (COIL_PLANT.includes(c.cls)) ports.push(
    { key: "coil_water_inlet_node_name", medium: "wtr", dir: "in", label: "Wtr" },
    { key: "coil_water_outlet_node_name", medium: "wtr", dir: "out", label: "Wtr" },
  );
  // THE OUTDOOR AIR OF A DUCTED PARENT (2026-09-13) is not a field of the parent but an AirLoopHVAC:OutdoorAirSystem ahead of it on the
  // supply branch, so the card carries a stated `OA ‹` — a heat-recovery core's supply outlet runs to it and the OA system is generated
  if (OA_PARENTS.includes(c.cls)) ports.push({ key: "outdoor_air_inlet_node_name", medium: "oa", dir: "in", label: "OA" });
  if (zoneContained(c.cls)) return { ports: ports.filter((q) => leavesTheZone(q.medium)), unread };
  return { ports, unread };
}

/** the children a parent accepts, from the engine's own enums: every `*_object_type` field that lists classes */
export function acceptsOf(c: EpClass): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of c.fields) {
    if (!/_object_type$/.test(f.key) || !f.enum?.length) continue;
    if (!f.enum.some((x) => x.includes(":"))) continue;   // an enum of classes, not of words
    out[f.key] = f.enum;
  }
  return out;
}

export const tierOf = (cls: string): Tier =>
  cls === "HVACTemplate:Zone:IdealLoadsAirSystem" ? "ideal" : cls.startsWith("HVACTemplate:") ? "template" : "component";

/** THE CURATED SET (the user's ruling, 2026-09-11): the general reader above, this much of it on the bench now. */
export interface CatSpec { cls: string; shelf: string; label: string; sub: string;
  /** a PASS-THROUGH card drawn at half width (user, 2026-09-13: the pump): its inlet on the left, its outlet on the right, and this short word as its name */
  narrow?: string;
  /** a class read for the cards already drawn but no longer offered — the reason, in words */
  retired?: string }
export const CATALOGUE: CatSpec[] = [
  // ZONE EQUIPMENT — what sits in a room
  { cls: "HVACTemplate:Zone:IdealLoadsAirSystem", shelf: "ZONE EQUIPMENT", label: "Ideal loads", sub: "the code default: a perfect system, district meters — what every zone falls back to" },
  { cls: "HVACTemplate:Zone:PTHP", shelf: "ZONE EQUIPMENT", label: "Packaged terminal heat pump", sub: "a mini-split, one object per zone" },
  { cls: "HVACTemplate:Zone:PTAC", shelf: "ZONE EQUIPMENT", label: "Packaged terminal AC", sub: "a room AC with a heating coil" },
  { cls: "HVACTemplate:Zone:BaseboardHeat", shelf: "ZONE EQUIPMENT", label: "Baseboard (template)", sub: "electric, or hot water on a loop" },
  { cls: "HVACTemplate:Zone:WaterToAirHeatPump", shelf: "ZONE EQUIPMENT", label: "Water-to-air heat pump (template)", sub: "per zone, on a template mixed-water loop" },
  { cls: "ZoneHVAC:UnitHeater", shelf: "ZONE EQUIPMENT", label: "Unit heater (electric)", sub: "a fan-forced heater: its Air out to the Zone's Air in and its Air in from the Zone's Air out (the zone's own nodes), or its Loc to the zone it is in" },
  { cls: "ZoneHVAC:WaterToAirHeatPump", shelf: "ZONE EQUIPMENT", label: "Water-to-air heat pump (zone unit)", sub: "a console unit: its water side on a plant loop's demand" },
  { cls: "ZoneHVAC:Baseboard:Convective:Electric", shelf: "ZONE EQUIPMENT", label: "Baseboard (electric)", sub: "convective electric baseboard, in the zone" },
  { cls: "ZoneHVAC:Baseboard:Convective:Water", shelf: "ZONE EQUIPMENT", label: "Baseboard (hot water)", sub: "convective hydronic baseboard: its water side on a loop" },
  { cls: "ZoneHVAC:IdealLoadsAirSystem", shelf: "ZONE EQUIPMENT", label: "Ideal loads (component)", sub: "the same perfect system, written in full rather than expanded" },
  { cls: "ZoneHVAC:EnergyRecoveryVentilator", shelf: "ZONE EQUIPMENT", label: "Energy recovery ventilator (zone)", sub: "a standalone HRV/ERV in one zone: its own core and two fans, drawing that zone's stale air" },
  { cls: "Fan:ZoneExhaust", shelf: "ZONE EQUIPMENT", label: "Exhaust fan (zone)", sub: "a bath or kitchen fan: it takes air from the zone straight out of the building" },
  // AIR LOOP
  { cls: "AirLoopHVAC:UnitarySystem", shelf: "AIR LOOP", label: "Unitary system", sub: "the modern parent: any coils, any control — Load, SetPoint or SingleZoneVAV" },
  { cls: "AirLoopHVAC:UnitaryHeatPump:WaterToAir", shelf: "AIR LOOP", label: "Unitary heat pump, water-to-air", sub: "a ducted water-source heat pump, controlled by one zone's thermostat" },
  // THE AIR TERMINALS ARE RETIRED TILES (user, 2026-09-13): the Zone card's Air in IS the terminal — the damper's type and its two
  // fields are the Zone's settings — so a unit's Air out runs straight to the Zones it serves. The classes stay READABLE (their
  // connectors from the schema) so a card drawn before that day still shows its lines until it is folded; they are never on the bench
  { cls: "AirTerminal:SingleDuct:VAV:NoReheat", shelf: "AIR LOOP", label: "VAV terminal, no reheat", sub: "a terminal card of an earlier sheet: fold it into its Zone", retired: "the Zone's Air in is the terminal now" },
  { cls: "AirTerminal:SingleDuct:ConstantVolume:NoReheat", shelf: "AIR LOOP", label: "Constant-volume terminal", sub: "a terminal card of an earlier sheet: fold it into its Zone", retired: "the Zone's Air in is the terminal now" },
  { cls: "AirTerminal:SingleDuct:VAV:HeatAndCool:NoReheat", shelf: "AIR LOOP", label: "VAV terminal, heats and cools", sub: "a terminal card of an earlier sheet: fold it into its Zone", retired: "the Zone's Air in is the terminal now" },
  { cls: "Fan:OnOff", shelf: "AIR LOOP", label: "Fan (on/off)", sub: "cycles with its unit — the residential supply fan" },
  { cls: "Fan:SystemModel", shelf: "AIR LOOP", label: "Fan (system model)", sub: "the general fan: constant, variable or multi-speed" },
  { cls: "HeatExchanger:AirToAir:SensibleAndLatent", shelf: "AIR LOOP", label: "Heat recovery core (ERV/HRV)", sub: "a static core on a unit's outdoor air: run its Air out (the outdoor air it tempered) to the unit's OA in — its outdoor-air inlet and its exhaust side (the unit's relief) are generated" },
  // COILS
  { cls: "Coil:Cooling:WaterToAirHeatPump:EquationFit", shelf: "COILS", label: "Cooling coil, water-to-air", sub: "single speed, curves from the engine's own dataset" },
  { cls: "Coil:Heating:WaterToAirHeatPump:EquationFit", shelf: "COILS", label: "Heating coil, water-to-air", sub: "single speed, curves from the engine's own dataset" },
  { cls: "Coil:Cooling:WaterToAirHeatPump:VariableSpeedEquationFit", shelf: "COILS", label: "Cooling coil, water-to-air (variable speed)", sub: "a variable-speed ground-source coil, speed by speed" },
  { cls: "Coil:Heating:WaterToAirHeatPump:VariableSpeedEquationFit", shelf: "COILS", label: "Heating coil, water-to-air (variable speed)", sub: "a variable-speed ground-source coil, speed by speed" },
  { cls: "Coil:Heating:Electric", shelf: "COILS", label: "Electric heating coil", sub: "resistance heat: a supplemental coil, or a unit heater's own" },
  { cls: "Coil:Heating:Fuel", shelf: "COILS", label: "Fuel heating coil", sub: "a gas or propane burner" },
  // PLANT LOOP
  { cls: "PlantLoop", shelf: "PLANT LOOP", label: "Plant loop", sub: "a hot- or chilled-water loop: producers on supply, consumers on demand" },
  { cls: "CondenserLoop", shelf: "PLANT LOOP", label: "Condenser loop", sub: "the water loop a water-source heat pump stands on" },
  { cls: "Pump:ConstantSpeed", shelf: "PLANT LOOP", label: "Pump (constant speed)", sub: "every fluid loop needs a pump on its supply side", narrow: "Pump" },
  { cls: "Pump:VariableSpeed", shelf: "PLANT LOOP", label: "Pump (variable speed)", sub: "flow follows the load — the usual ground-loop pump", narrow: "Pump" },
  { cls: "Boiler:HotWater", shelf: "PLANT LOOP", label: "Boiler", sub: "on a loop's supply side" },
  { cls: "CoolingTower:SingleSpeed", shelf: "PLANT LOOP", label: "Cooling tower", sub: "on a condenser loop's supply side" },
  // RESOURCE
  { cls: "GroundHeatExchanger:System", shelf: "RESOURCE", label: "Ground heat exchanger", sub: "a vertical borefield: the engine computes its response from the array you state, or designs the field itself" },
  // THE EXCHANGER'S TYPES (user, 2026-09-14: "a subset approach"): one card, its class the type — changed in place by the type select in its
  // inputs (the lines re-hung by medium, the numbers both kinds share kept); each on a condenser loop's supply side as the borefield is
  { cls: "GroundHeatExchanger:Slinky", shelf: "RESOURCE", label: "Ground heat exchanger, slinky", sub: "coiled tubing in trenches: the engine computes the response itself" },
  { cls: "GroundHeatExchanger:Pond", shelf: "RESOURCE", label: "Pond heat exchanger", sub: "a shallow pond with submerged tubing circuits" },
  { cls: "GroundHeatExchanger:Surface", shelf: "RESOURCE", label: "Surface heat exchanger", sub: "a hydronic slab — pavement with embedded tubes, ground-coupled or exposed below" },
  { cls: "GroundHeatExchanger:HorizontalTrench", shelf: "RESOURCE", label: "Ground heat exchanger, horizontal trench", sub: "straight pipes in trenches: a transient soil simulation" },
  { cls: "HeatExchanger:FluidToFluid", shelf: "RESOURCE", label: "Fluid-to-fluid exchanger", sub: "couples the supply side of one loop to the demand side of another — drawn and refused until a second ring can hold its other side" },
];
export const SHELVES: string[] = ["ZONE EQUIPMENT", "AIR LOOP", "COILS", "PLANT LOOP", "RESOURCE"];

export interface Catalogue {
  entries: Map<string, CatEntry>;
  of(cls: string): CatEntry | null;
  byShelf(shelf: string, tiers: Tier[]): CatEntry[];
  census: string;
  missing: string[];
}

/** the catalogue over a schema: every curated class read, its ports derived, what it accepts read from its enums */
export function readCatalogue(schema: EpSchema): Catalogue {
  const entries = new Map<string, CatEntry>();
  const missing: string[] = [];
  let unreadFields = 0, zoneAttached = 0, withPorts = 0;
  for (const spec of CATALOGUE) {
    const c = schema.classOf(spec.cls);
    if (!c) { missing.push(spec.cls); continue; }
    const { ports, unread } = portsOf(c);
    if (unread.length) unreadFields += unread.length;
    if (!ports.length && !unread.length) zoneAttached++; else if (ports.length) withPorts++;
    entries.set(spec.cls, {
      cls: spec.cls, group: c.group, tier: tierOf(spec.cls), shelf: spec.shelf, label: spec.label, sub: spec.sub,
      ports, unread, zoneAttached: !ports.length && !unread.length, accepts: acceptsOf(c), ...(spec.narrow ? { narrow: spec.narrow } : {}), ...(spec.retired ? { retired: spec.retired } : {}),
    });
  }
  const tiers = (t: Tier): number => [...entries.values()].filter((e) => e.tier === t).length;
  const census = `${entries.size} of ${CATALOGUE.length} curated classes read (template ${tiers("template")} · component ${tiers("component")} · ideal ${tiers("ideal")}) · with connectors ${withPorts} · zone-attached ${zoneAttached} · node fields no name or rule reads ${unreadFields}${missing.length ? ` · NOT IN THE SCHEMA ${missing.join(", ")}` : ""}`;
  return {
    entries, missing, census,
    of: (cls) => entries.get(cls) ?? null,
    byShelf: (shelf, ts) => [...entries.values()].filter((e) => e.shelf === shelf && ts.includes(e.tier) && !e.retired),
  };
}

/** the whole engine measured, for the report and the gate: how far the name rule reaches over every HVAC class */
export const HVAC_GROUPS: readonly string[] = [
  "Coils", "Fans", "Pumps", "Zone HVAC Forced Air Units", "Zone HVAC Air Loop Terminal Units", "Zone HVAC Radiative/Convective Units",
  "Plant Heating and Cooling Equipment", "Condenser Equipment and Heat Exchangers", "Solar Collectors", "Water Heaters and Thermal Storage",
  "Heat Recovery", "Humidifiers and Dehumidifiers", "Non-Zone Equipment", "Air Distribution",
];
export const isNodeField = (key: string): boolean => NODE_FIELD.test(key);
export function surveyClasses(classes: Array<{ cls: string; group: string; keys: string[] }>): { total: number; clean: number; partial: number; zoneAttached: number } {
  let total = 0, clean = 0, partial = 0, zoneAttached = 0;
  for (const c of classes) {
    if (!HVAC_GROUPS.includes(c.group)) continue;
    total++;
    const nodes = c.keys.filter(isNodeField);
    if (!nodes.length) { zoneAttached++; continue; }
    if (nodes.every((k) => mediumFromName(k) !== null || MEDIUM_RULES[c.cls])) clean++; else partial++;
  }
  return { total, clean, partial, zoneAttached };
}
