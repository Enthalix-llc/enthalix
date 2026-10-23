// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MECHANICAL ASSEMBLY (user, 2026-09-10): "the view for mechanical
// systems needs to show an assembly view … components are dragged from the
// bottom pane into the main view, which is then assembled into systems …
// Visio-like connectors". The assembly is the AUTHORING surface — nodes for
// the engine's own kinds, zones, plant loops and ventilation, connectors
// between them, coils and heat recovery ATTACHED inside a system — and the
// rulings the resolver already honours are COMPILED from it (`compile`), so
// the writer, the gate and bem.db are unchanged by how the ruling was made.
// A connection the engine cannot take (a DOAS on a unitary system, a hot-
// water coil with no loop, a zone on two systems) is refused and named on
// the node, never bent into something else.

import type { BemInput } from "./bemInput.js";
import type { SystemsRuling, HvacRuling, HvacKind, SystemFields, FromFile, VentilationRuling, WiredAirLoop, LoopRuling } from "./bemDb.js";
import { portMediumOf, OA_PARENTS, type PortMedium } from "./epCatalogue.js";
import { GHX_TYPES, UH_WATER_REFUSAL } from "./componentForms.js";
import { DEHUMIDIFY_RH_FIELD, DEHUMIDIFY_RH_DEFAULT } from "./epAssemble.js";
import type { SystemsDiagramRows } from "../../../core/db.js";

/** "component" is a card from the CATALOGUE (user, 2026-09-11): the node IS an EnergyPlus class, named in `cls`, and its
 *  connectors are that class's own node fields — every other kind is one of the sheet's own, hand-shaped cards */
export type NodeKind = "component" | "ashp" | "unitary" | "pthp" | "ptac" | "wshp" | "baseboard" | "euh" | "ideal" | "terminal" | "boiler" | "hwloop" | "tower" | "mwloop" | "doas" | "wholehouse" | "exhaust" | "ground" | "reclaim" | "solar" | "zone";
/** a primary RESOURCE on a loop (user, 2026-09-10): the ground, reclaimed heat, the sun */
export type Resource = "ground" | "reclaim" | "solar";
export type AttachKind = "coil-heat-electric" | "coil-heat-gas" | "coil-heat-hotwater" | "coil-cool-dx" | "coil-cool-none" | "hr-sensible" | "hr-enthalpy" | "availability";
/** a loop's two sides — the engine's own: what is on the SUPPLY side produces, what is on the DEMAND side consumes */
export type LoopSide = "supply" | "demand";
export type PaletteGroup = "ZONE EQUIPMENT" | "AIR LOOP" | "COILS" | "PLANT LOOP" | "RESOURCE" | "CONTROLS";
/** zone → the node ids serving it (one system at most, any exhaust fans) — assigned in the ZONES tab (user, 2026-09-10), never drawn on the sheet */
export type ZoneAssign = Record<string, string[]>;

export interface AsmNode {
  id: string; kind: NodeKind; x: number; y: number;
  /** the name the ruling and the IDF object carry; the palette label until typed */
  label?: string;
  /** the component's ID (user, 2026-09-10): typed beside the name in the column, shown under the name on the sheet, and the
   *  ruling's — the IDF object's — name when given */
  ident?: string;
  /** the engine's fields by epJSON key, the user's values only */
  fields?: SystemFields;
  /** coils and heat recovery dropped INTO a system node */
  attached?: AttachKind[];
  /** the file's equipment this node was made from */
  from?: FromFile;
  /** a CATALOGUE card: the EnergyPlus class this node is (kind === "component"); its ports come from the class's node fields */
  cls?: string;
  /** A ZONE (user, 2026-09-10): the rooms held — dragged in from LEVELS · SPACES, by the name the tree shows; one zone per room */
  rooms?: string[];
  /** a zone drawn closed: its rooms counted, not listed */
  collapsed?: boolean;
  /** THE THERMOSTAT (user, 2026-09-12: a T in a circle on the Zone card, clickable): absent = on — the zone has the thermostat and
   *  controls the unit that serves it; false = off — the zone is served, not controlled (it takes what the supply gives, and no
   *  ZoneControl:Thermostat is written for it: the engine's own HeatPump.idf, three zones on one unit, one thermostat) */
  thermostat?: boolean;
  /** a whole-house ventilation node: the kind and what the rate is computed from; an exhaust node: its cfm */
  vent?: { kind: "Exhaust" | "Intake" | "Balanced" | "HeatRecovery"; recovery?: "Sensible" | "Enthalpy"; bedrooms?: number; cfaM2?: number; cfm?: number };
}
/** a CONNECTOR on a component (user, 2026-09-10): a medium (water, air, outdoor air, exhaust), a direction relative to the box
 *  (out leaves it, in enters it), the side it sits on, and its label — `Wtr ‹` water out on the left, `Air ›` supply air out on
 *  the right, the arrow being the flow's direction on the sheet. A line joins an OUT port to an IN port of a compatible medium. */
/** "dc" / "ac": the ELECTRICAL sheet's connectors (2026-10-02) — an array's DC out to an inverter's DC in, its AC out to a load
 *  centre, the load centre to the utility; they join only their own medium (a DC line never reaches an AC connector) */
/** "hw": the PLUMBING sheet's (2026-10-02) — a water heater's hot water out to the use it supplies */
export type Medium = "wtr" | "air" | "oa" | "exh" | "loc" | "dc" | "ac" | "hw";
export type PortSide = "left" | "right" | "top";
export interface Port { id: string; medium: Medium; dir: "in" | "out"; side: PortSide; label: string }
const P = (id: string, medium: Medium, dir: "in" | "out", side: PortSide, label: string): Port => ({ id, medium, dir, side, label });
// THE LOCATION CONNECTOR (user, 2026-09-11): equipment that SITS IN a zone — a unit heater, a baseboard, a packaged
// terminal unit — is not ducted to it, so it says so with a connector at the TOP of its card joined to the one at the top
// of the Zone's. What the line carries is neither air nor water but the fact of being there, so its medium joins only itself.
const LOC_OUT: Port = P("loc-out", "loc", "out", "top", "Loc");
const LOC_IN: Port = P("loc-in", "loc", "in", "top", "Loc");
const WATER_L: Port[] = [P("wtr-in", "wtr", "in", "left", "Wtr"), P("wtr-out", "wtr", "out", "left", "Wtr")];
const AIR_R: Port[] = [P("air-out", "air", "out", "right", "Air"), P("air-in", "air", "in", "right", "Air")];
const WATER_R: Port[] = [P("wtr-out", "wtr", "out", "right", "Wtr"), P("wtr-in", "wtr", "in", "right", "Wtr")];
// ZONE-CONTAINED CARDS CARRY NO AIR CONNECTORS (user, 2026-09-13: "component cards that exist only in the zone should have no
// air connectors, just top connectors that connect with that zone, and water connectors if fed from boiler, chiller or
// condenser ground loops"). A unit that sits in a zone joins that zone's own air nodes, which the generator writes from the
// LOCATION line alone; only its water side is a drawn connector. The template DOAS, which used to land on an `OA ‹` here, now
// runs to the ZONE it ventilates (the Zone's Air in) and the zone's feeder takes it.
export const PORTS: Record<NodeKind, Port[]> = {
  wshp: [LOC_OUT, ...WATER_L],
  pthp: [LOC_OUT], ptac: [LOC_OUT], ideal: [LOC_OUT],
  baseboard: [LOC_OUT, ...WATER_L],
  // THE UNIT HEATER'S AIR (the user, 2026-09-14, citing the Input Output Reference: "the unit air inlet node should be the same as a zone
  // exhaust node and the unit outlet node should be the same as a zone inlet node"): its Air out runs to the Zone's Air in, its Air in from
  // the Zone's Air out — either line places it in that zone as its Loc does, and the nodes are the zone's own either way
  euh: [LOC_OUT, ...AIR_R],
  /** an older sheet's template terminal card: drawn, refused, and folded into its Zone by the button (foldTerminals) — never offered again */
  terminal: [P("air-in", "air", "in", "left", "Air"), P("air-out", "air", "out", "right", "Air")],
  exhaust: [LOC_OUT],
  wholehouse: [P("oa-in", "oa", "in", "left", "OA"), P("air-out", "air", "out", "right", "Air")],
  zone: [LOC_IN, P("air-in", "air", "in", "left", "Air"), P("air-out", "air", "out", "left", "Air")],   // equipment located in it on top; supply in from a terminal, return out
  ashp: [...WATER_L, ...AIR_R], unitary: [...WATER_L, ...AIR_R], doas: [...WATER_L, P("air-out", "air", "out", "right", "Air")],
  // a loop: its SUPPLY side on the left (out to the producer, back in from it), its DEMAND side on the right
  hwloop: [P("sup-out", "wtr", "out", "left", "Sup"), P("sup-in", "wtr", "in", "left", "Sup"), P("dem-out", "wtr", "out", "right", "Dem"), P("dem-in", "wtr", "in", "right", "Dem")],
  mwloop: [P("sup-out", "wtr", "out", "left", "Sup"), P("sup-in", "wtr", "in", "left", "Sup"), P("dem-out", "wtr", "out", "right", "Dem"), P("dem-in", "wtr", "in", "right", "Dem")],
  boiler: [...WATER_R], tower: [...WATER_R], ground: [...WATER_R], reclaim: [...WATER_R], solar: [...WATER_R],
  component: [],   // read from the catalogue instead — see portsOfNode
};
/** the EnergyPlus class a node is: a catalogue card says so itself, every other kind has one by its kind */
export const classOf = (n: AsmNode): string => (n.kind === "component" ? n.cls ?? "" : NODE_CLASS[n.kind]);
/** a component card that SERVES a Zone when its Loc or its Air out joins it — zone equipment, the ducted parents; a pump, an exchanger, a loop or a
 *  boiler joined by Loc is merely LOCATED there (2026-09-14) */
export const servesByClass = (cls: string): boolean => /^(ZoneHVAC:|Fan:ZoneExhaust|AirLoopHVAC:|HVACTemplate:)/.test(cls);
/** a node's connectors. A catalogue card's are the class's own node fields, read by epCatalogue; a card with none is
 *  zone-attached and carries the LOCATION connector instead, which is how it says which zone it is in. */
export function portsOfNode(n: AsmNode, cat?: { of(cls: string): { ports: Array<{ key: string; medium: string; dir: "in" | "out"; label: string }>; zoneAttached: boolean; narrow?: string; noLoc?: true } | null } | null): Port[] {
  if (n.kind !== "component") return PORTS[n.kind];
  const e = cat?.of(n.cls ?? "") ?? null;
  if (!e) return [];
  // an ELECTRICAL card (2026-10-02) is in no zone: no Loc, its inputs on the left and its outputs on the right
  // a PLUMBING card (2026-10-02) likewise: its room is picked in the column, not drawn
  if (e.ports.length && e.ports.every((q) => q.medium === "dc" || q.medium === "ac" || q.medium === "hw")) return e.ports.map((q) => ({ id: q.key, medium: q.medium as Medium, dir: q.dir, side: (q.dir === "in" ? "left" : "right") as PortSide, label: q.label }));
  if (e.noLoc && !e.ports.length) return [];
  if (e.zoneAttached) return [LOC_OUT];
  // a NARROW pass-through card (user, 2026-09-13: the pump at half width) reads left to right: its inlet on the left, its outlet on the right
  const ports = e.ports.map((q) => ({ id: q.key, medium: q.medium as Medium, dir: q.dir, side: (e.narrow ? (q.dir === "in" ? "left" : "right") : q.medium === "wtr" ? "left" : "right") as PortSide, label: q.label }));
  return [LOC_OUT, ...ports];
}
/** a card drawn at half width: the catalogue says so (a pump) */
export const isNarrow = (n: AsmNode, cat?: { of(cls: string): { narrow?: string } | null } | null): boolean => n.kind === "component" && !!cat?.of(n.cls ?? "")?.narrow;
export const portOf = (kind: NodeKind, id: string | undefined): Port | undefined => PORTS[kind].find((q) => q.id === id);
/** two ports may be joined when one leaves and the other enters and their media agree: water with water, air with air, outdoor air or exhaust */
export function compatible(a: Port, b: Port): boolean {
  if (a.dir === b.dir) return false;
  const g = (m: Medium): string => (m === "loc" || m === "wtr" || m === "dc" || m === "ac" || m === "hw" ? m : "air");
  return g(a.medium) === g(b.medium);
}
export interface AsmEdge { id: string; from: string; to: string;
  /** the ports the line joins (a port id of each kind; an old sheet's "supply" / "demand" still read as a loop's side) */
  fromPort?: string; toPort?: string;
  /** the corners of the line as the user routed them (canvas coordinates); absent = routed by the sheet */
  points?: Array<[number, number]> }
export interface Assembly { nodes: AsmNode[]; edges: AsmEdge[]; view?: { x: number; y: number } }

export interface PaletteItem { id: string; group: PaletteGroup; label: string; sub: string; node?: NodeKind; attach?: AttachKind; cls?: string;
  /** a CATALOGUE card carries the EnergyPlus class it places and how its border reads */
  tier?: "ideal" | "template" | "component" }
/** the components, by the bottom pane's vertical headers */
export const PALETTE: PaletteItem[] = [
  { id: "ideal", group: "ZONE EQUIPMENT", node: "ideal", label: "Ideal loads", sub: "the code default, stated: 100 % efficient, district meters", cls: "HVACTemplate:Zone:IdealLoadsAirSystem" },
  { id: "pthp", group: "ZONE EQUIPMENT", node: "pthp", label: "Packaged terminal heat pump", sub: "a mini-split, one object per zone", cls: "HVACTemplate:Zone:PTHP" },
  { id: "ptac", group: "ZONE EQUIPMENT", node: "ptac", label: "Packaged terminal AC", sub: "a room AC with a heating coil, per zone", cls: "HVACTemplate:Zone:PTAC" },
  { id: "wshp", group: "ZONE EQUIPMENT", node: "wshp", label: "Water-to-air heat pump", sub: "per zone; its water side on a mixed-water loop's demand side", cls: "HVACTemplate:Zone:WaterToAirHeatPump" },
  { id: "baseboard", group: "ZONE EQUIPMENT", node: "baseboard", label: "Baseboard", sub: "electric, or hot water on a loop's demand side", cls: "HVACTemplate:Zone:BaseboardHeat" },
  { id: "euh", group: "ZONE EQUIPMENT", node: "euh", label: "Electric unit heater", sub: "a fan-forced heater: its Air out to the Zone's Air in and its Air in from the Zone's Air out (the zone's own nodes), or its Loc to the zone it is IN (a garage, a shop)", cls: "ZoneHVAC:UnitHeater" },
  { id: "exhaust", group: "ZONE EQUIPMENT", node: "exhaust", label: "Exhaust fan", sub: "local exhaust: join its Loc to the zone it is in, or assign its zones in ZONES; 100 cfm kitchen, 50 bath", cls: "ZoneVentilation:DesignFlowRate" },
  { id: "wholehouse", group: "ZONE EQUIPMENT", node: "wholehouse", label: "Whole-house ventilation", sub: "the ASHRAE 62.2 rate on the conditioned zones (or the zones assigned to it)", cls: "ZoneVentilation:DesignFlowRate" },
  { id: "zone", group: "ZONE EQUIPMENT", node: "zone", label: "Zone", sub: "a thermal zone: drag rooms from LEVELS · SPACES into it; a unit's Air out into its Air in serves it through the damper the zone carries (its settings); equipment IN it joins by Loc; the T is its thermostat", cls: "Zone" },
  { id: "ashp", group: "AIR LOOP", node: "ashp", label: "Air-source heat pump", sub: "an air loop: its terminals serve the zones; electric backup", cls: "HVACTemplate:System:UnitaryHeatPump:AirToAir" },
  { id: "unitary", group: "AIR LOOP", node: "unitary", label: "Furnace + split DX", sub: "an air loop: its terminals serve the zones; the heating coil is required", cls: "HVACTemplate:System:Unitary" },
  { id: "doas", group: "AIR LOOP", node: "doas", label: "Dedicated outdoor-air system", sub: "run its Air out to the Zones it ventilates (their zone equipment — PTHP, PTAC, WSHP, baseboard — takes it)", cls: "HVACTemplate:System:DedicatedOutdoorAir" },
  { id: "coil-heat-electric", group: "AIR LOOP", attach: "coil-heat-electric", label: "Electric heating coil", sub: "drop onto a system: its heating (or supplemental) coil" },
  { id: "coil-heat-gas", group: "AIR LOOP", attach: "coil-heat-gas", label: "Gas heating coil", sub: "drop onto a furnace, heat pump, PTHP, PTAC or DOAS" },
  { id: "coil-heat-hotwater", group: "AIR LOOP", attach: "coil-heat-hotwater", label: "Hot-water heating coil", sub: "drop onto a system, then connect the system to a hot-water loop's demand side" },
  { id: "coil-cool-dx", group: "AIR LOOP", attach: "coil-cool-dx", label: "DX cooling coil", sub: "single-speed; the default on every packaged kind" },
  { id: "coil-cool-none", group: "AIR LOOP", attach: "coil-cool-none", label: "No cooling", sub: "drop onto a furnace or DOAS: heating only" },
  { id: "hr-enthalpy", group: "AIR LOOP", attach: "hr-enthalpy", label: "Energy recovery (ERV)", sub: "drop onto a system or DOAS: enthalpy recovery" },
  { id: "hr-sensible", group: "AIR LOOP", attach: "hr-sensible", label: "Heat recovery (HRV)", sub: "drop onto a system or DOAS: sensible recovery" },
  { id: "hwloop", group: "PLANT LOOP", node: "hwloop", label: "Hot-water loop", sub: "supply side: a boiler (or a resource); demand side: hot-water coils and baseboards", cls: "HVACTemplate:Plant:HotWaterLoop" },
  { id: "mwloop", group: "PLANT LOOP", node: "mwloop", label: "Mixed-water loop", sub: "supply side: a boiler and a tower (or a resource); demand side: the water-to-air heat pumps", cls: "HVACTemplate:Plant:MixedWaterLoop" },
  { id: "boiler", group: "PLANT LOOP", node: "boiler", label: "Boiler", sub: "on a loop's supply side", cls: "HVACTemplate:Plant:Boiler" },
  { id: "tower", group: "PLANT LOOP", node: "tower", label: "Cooling tower", sub: "on a mixed-water loop's supply side", cls: "HVACTemplate:Plant:Tower" },
  { id: "ground", group: "RESOURCE", node: "ground", label: "Ground", sub: "a ground loop on a loop's supply side (GroundHeatExchanger:System)", cls: "GroundHeatExchanger:System" },
  { id: "reclaim", group: "RESOURCE", node: "reclaim", label: "Reclaim", sub: "heat reclaimed from the condenser onto a loop's supply side (a desuperheater coil)", cls: "Coil:Heating:Desuperheater" },
  { id: "solar", group: "RESOURCE", node: "solar", label: "Solar", sub: "solar hydronic: flat-plate collectors on a loop's supply side (SolarCollector:FlatPlate:Water)", cls: "SolarCollector:FlatPlate:Water" },
  { id: "availability", group: "CONTROLS", attach: "availability", label: "Availability schedule", sub: "drop onto a system or zone equipment: it runs on the SCHEDULES › HVAC availability role" },
];
export const PALETTE_GROUPS: PaletteGroup[] = ["ZONE EQUIPMENT", "AIR LOOP", "COILS", "PLANT LOOP", "RESOURCE", "CONTROLS"];
export const NODE_LABEL: Record<NodeKind, string> = {
  ashp: "Air-source heat pump", unitary: "Furnace + split DX", pthp: "Packaged terminal heat pump", ptac: "Packaged terminal AC", wshp: "Water-to-air heat pump", baseboard: "Baseboard", euh: "Electric unit heater", ideal: "Ideal loads", terminal: "Air terminal",
  boiler: "Boiler", hwloop: "Hot-water loop", tower: "Cooling tower", mwloop: "Mixed-water loop", doas: "Dedicated outdoor air", wholehouse: "Whole-house ventilation", exhaust: "Exhaust fan",
  ground: "Ground", reclaim: "Reclaim", solar: "Solar", zone: "Zone", component: "Component",
};
export const NODE_CLASS: Record<NodeKind, string> = {
  ashp: "HVACTemplate:System:UnitaryHeatPump:AirToAir", unitary: "HVACTemplate:System:Unitary", pthp: "HVACTemplate:Zone:PTHP", ptac: "HVACTemplate:Zone:PTAC", wshp: "HVACTemplate:Zone:WaterToAirHeatPump",
  baseboard: "HVACTemplate:Zone:BaseboardHeat", euh: "ZoneHVAC:UnitHeater", ideal: "HVACTemplate:Zone:IdealLoadsAirSystem", terminal: "HVACTemplate:Zone:Unitary", boiler: "HVACTemplate:Plant:Boiler", hwloop: "HVACTemplate:Plant:HotWaterLoop", tower: "HVACTemplate:Plant:Tower",
  mwloop: "HVACTemplate:Plant:MixedWaterLoop", doas: "HVACTemplate:System:DedicatedOutdoorAir", wholehouse: "ZoneVentilation:DesignFlowRate", exhaust: "ZoneVentilation:DesignFlowRate",
  ground: "GroundHeatExchanger:System", reclaim: "Coil:Heating:Desuperheater", solar: "SolarCollector:FlatPlate:Water", zone: "Zone", component: "",
};
export const ATTACH_LABEL: Record<AttachKind, string> = { "coil-heat-electric": "electric heating coil", "coil-heat-gas": "gas heating coil", "coil-heat-hotwater": "hot-water heating coil", "coil-cool-dx": "DX cooling coil", "coil-cool-none": "no cooling", "hr-sensible": "HRV (sensible)", "hr-enthalpy": "ERV (enthalpy)", availability: "availability schedule" };
/** the group a node kind belongs to — its colour bar */
export const GROUP_OF: Record<NodeKind, PaletteGroup> = { ashp: "AIR LOOP", unitary: "AIR LOOP", doas: "AIR LOOP", pthp: "ZONE EQUIPMENT", ptac: "ZONE EQUIPMENT", wshp: "ZONE EQUIPMENT", baseboard: "ZONE EQUIPMENT", euh: "ZONE EQUIPMENT", ideal: "ZONE EQUIPMENT", terminal: "ZONE EQUIPMENT", exhaust: "ZONE EQUIPMENT", wholehouse: "ZONE EQUIPMENT", boiler: "PLANT LOOP", hwloop: "PLANT LOOP", tower: "PLANT LOOP", mwloop: "PLANT LOOP", ground: "RESOURCE", reclaim: "RESOURCE", solar: "RESOURCE", zone: "ZONE EQUIPMENT", component: "ZONE EQUIPMENT" };
export const isLoop = (k: NodeKind): boolean => k === "hwloop" || k === "mwloop";
export const isAirLoop = (k: NodeKind): boolean => k === "ashp" || k === "unitary";
/** what ZONES assigns a zone to: zone equipment and the air loops (2026-09-13: an air loop serves the Zones its Air out reaches — the Zone's Air in is the terminal); an older sheet's terminal card still until folded; never a plant */
export const isAssignable = (k: NodeKind): boolean => ["ideal", "pthp", "ptac", "wshp", "baseboard", "euh", "terminal", "exhaust", "wholehouse", "ashp", "unitary"].includes(k);
/** the side of a loop a kind belongs on: producers on the supply side, consumers on the demand side */
export const SUPPLY_KINDS: readonly NodeKind[] = ["boiler", "tower", "ground", "reclaim", "solar"];
const RESOURCE_KINDS: readonly NodeKind[] = ["ground", "reclaim", "solar"];
export const isResource = (k: NodeKind): boolean => RESOURCE_KINDS.includes(k);
const SYSTEM_KINDS: readonly NodeKind[] = ["ashp", "unitary", "pthp", "ptac", "wshp", "baseboard", "euh", "ideal"];   // the kinds that become an hvac ruling
const ZONE_EQUIPMENT: readonly NodeKind[] = ["pthp", "ptac", "wshp", "baseboard"];   // the kinds with a dedicated_outdoor_air_system_name field
export const isSystem = (k: NodeKind): boolean => SYSTEM_KINDS.includes(k);
export const HVAC_KIND_OF: Partial<Record<NodeKind, HvacKind>> = { ashp: "HVACTemplate:System:UnitaryHeatPump:AirToAir", unitary: "HVACTemplate:System:Unitary", pthp: "HVACTemplate:Zone:PTHP", ptac: "HVACTemplate:Zone:PTAC", wshp: "HVACTemplate:Zone:WaterToAirHeatPump", baseboard: "HVACTemplate:Zone:BaseboardHeat", euh: "ZoneHVAC:UnitHeater", ideal: "HVACTemplate:Zone:IdealLoadsAirSystem" };
const NODE_OF_HVAC: Record<HvacKind, NodeKind> = { "HVACTemplate:System:UnitaryHeatPump:AirToAir": "ashp", "HVACTemplate:System:Unitary": "unitary", "HVACTemplate:Zone:PTHP": "pthp", "HVACTemplate:Zone:PTAC": "ptac", "HVACTemplate:Zone:WaterToAirHeatPump": "wshp", "HVACTemplate:Zone:BaseboardHeat": "baseboard", "ZoneHVAC:UnitHeater": "euh", "AirLoopHVAC:UnitaryHeatPump:WaterToAir": "component", "AirLoopHVAC:UnitarySystem": "component", "HVACTemplate:Zone:IdealLoadsAirSystem": "ideal" };

/** what an attachment SETS on each kind — the engine's own field and value; absent = the kind does not take it (refused, named) */
export const ATTACH_FIELD: Partial<Record<NodeKind, Partial<Record<AttachKind, [string, string] | "own">>>> = {
  unitary: { "coil-heat-electric": ["heating_coil_type", "Electric"], "coil-heat-gas": ["heating_coil_type", "Gas"], "coil-heat-hotwater": ["heating_coil_type", "HotWater"], "coil-cool-dx": ["cooling_coil_type", "SingleSpeedDX"], "coil-cool-none": ["cooling_coil_type", "None"], "hr-sensible": ["heat_recovery_type", "Sensible"], "hr-enthalpy": ["heat_recovery_type", "Enthalpy"] },
  ashp: { "coil-heat-electric": ["supplemental_heating_coil_type", "Electric"], "coil-heat-gas": ["supplemental_heating_coil_type", "Gas"], "coil-heat-hotwater": ["supplemental_heating_coil_type", "HotWater"], "coil-cool-dx": "own", "hr-sensible": ["heat_recovery_type", "Sensible"], "hr-enthalpy": ["heat_recovery_type", "Enthalpy"] },
  pthp: { "coil-heat-electric": ["supplemental_heating_coil_type", "Electric"], "coil-heat-gas": ["supplemental_heating_coil_type", "Gas"], "coil-heat-hotwater": ["supplemental_heating_coil_type", "HotWater"], "coil-cool-dx": "own" },
  ptac: { "coil-heat-electric": ["heating_coil_type", "Electric"], "coil-heat-gas": ["heating_coil_type", "Gas"], "coil-heat-hotwater": ["heating_coil_type", "HotWater"], "coil-cool-dx": "own" },
  wshp: { "coil-heat-electric": ["supplemental_heating_coil_type", "Electric"], "coil-heat-hotwater": ["supplemental_heating_coil_type", "HotWater"], "coil-cool-dx": "own" },
  baseboard: { "coil-heat-electric": ["baseboard_heating_type", "Electric"], "coil-heat-hotwater": ["baseboard_heating_type", "HotWater"] },
  doas: { "coil-heat-electric": ["heating_coil_type", "Electric"], "coil-heat-gas": ["heating_coil_type", "Gas"], "coil-heat-hotwater": ["heating_coil_type", "HotWater"], "coil-cool-dx": ["cooling_coil_type", "TwoSpeedDX"], "coil-cool-none": ["cooling_coil_type", "None"], "hr-sensible": ["heat_recovery_type", "Sensible"], "hr-enthalpy": ["heat_recovery_type", "Enthalpy"] },
  ideal: { "hr-sensible": ["heat_recovery_type", "Sensible"], "hr-enthalpy": ["heat_recovery_type", "Enthalpy"] },
};
/** the availability attachment names the SCHEDULES role through the field each kind has for it; "@hvac-availability" is resolved to the ruled schedule by the resolver */
const AVAIL_FIELD: Partial<Record<NodeKind, string>> = { unitary: "system_availability_schedule_name", ashp: "system_availability_schedule_name", pthp: "system_availability_schedule_name", ptac: "system_availability_schedule_name", wshp: "system_availability_schedule_name", baseboard: "baseboard_heating_availability_schedule_name", doas: "system_availability_schedule_name", ideal: "system_availability_schedule_name" };
/** an attachment's verdict on a node: the field it sets, "own" (the kind already has it), or the refusal */
export function attachVerdict(kind: NodeKind, a: AttachKind): { field?: [string, string]; own?: true; refused?: string } {
  if (a === "availability") { const f = AVAIL_FIELD[kind]; return f ? { field: [f, "@hvac-availability"] } : { refused: `${NODE_LABEL[kind]} has no availability schedule` }; }
  const t = ATTACH_FIELD[kind]?.[a];
  if (!t) return { refused: `${NODE_LABEL[kind]} does not take ${ATTACH_LABEL[a]}` };
  if (t === "own") return { own: true };
  return { field: t };
}
/** the fields the attachments of a node set, the LAST of a family winning (one heating coil, one cooling coil, one recovery) */
export function attachedFields(n: AsmNode): { fields: SystemFields; notes: string[] } {
  const fields: SystemFields = {}, notes: string[] = [];
  for (const a of n.attached ?? []) {
    const v = attachVerdict(n.kind, a);
    if (v.field) fields[v.field[0]] = v.field[1];
    else if (v.own) notes.push(`${ATTACH_LABEL[a]}: the kind's own coil, nothing to set`);
    else if (v.refused) notes.push(v.refused);
  }
  return { fields, notes };
}

export const GRID = 8;
export const NODE_W = 196, NODE_H = 56, PORT_STEP = 16;
/** THE "NOT WRITTEN" MARK (2026-09-15): what the SAVED model refused, per card. The resolver's refusals ride on the model's
 *  systems rows by ruling id (a unit's, a per-thermostat unit's, or a ring's loop — a loop that lost its demand is a row too);
 *  a card reaches its rows through rulingIds / splitIds exactly as the QA rows do. A card marked here is drawn on the sheet and
 *  absent from the IDF the model wrote — the column's "not written in the saved model" line, put on the card it belongs to. */
export function refusedByNode(compiled: CompiledAssembly, rows: ReadonlyArray<{ id: string; refused?: string[] }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byRuling = new Map<string, string[]>();
  for (const r of rows) if (r.refused?.length) byRuling.set(r.id, r.refused);
  for (const [node, rid] of Object.entries(compiled.rulingIds)) { const m = byRuling.get(rid); if (m) out.set(node, [...m]); }
  for (const [node, ids] of Object.entries(compiled.splitIds ?? {})) { const m = ids.flatMap((rid) => byRuling.get(rid) ?? []); if (m.length) out.set(node, m); }
  return out;
}
/** a node is as tall as its taller side of ports needs */
export const nodeSize = (n: AsmNode, ports: Port[] = PORTS[n.kind], narrow = false): { w: number; h: number } => {
  const l = ports.filter((q) => q.side === "left").length, r = ports.filter((q) => q.side === "right").length;
  const rooms = n.kind === "zone" ? 16 + (n.collapsed ? 0 : Math.max(1, n.rooms?.length ?? 0) * 14) : 0;   // a zone's rooms below its title
  // a LOAD CENTER's zones (ELECTRICAL, 2026-10-23: kept in its fields as "|"-joined names) below its title
  const held = n.cls === "ElectricLoadCenter:Distribution" ? 16 + Math.max(1, String(n.fields?.zones ?? "").split("|").filter((x) => x.trim()).length) * 14 + (n.fields?.zones ? 0 : 14) : 0;
  return { w: narrow ? NODE_W / 2 : NODE_W, h: Math.max(NODE_H, 22 + Math.max(l, r) * PORT_STEP + 8, 24 + rooms + 8, 24 + held + 8) };
};
/** a port's vertical position on its node: stacked from the top under the title, in the order declared */
export const portX = (n: AsmNode, id: string, ports: Port[] = PORTS[n.kind]): number => {
  const list = ports.filter((q) => q.side === "top");
  const i = Math.max(0, list.findIndex((q) => q.id === id));
  return NODE_W / 2 + (i - (list.length - 1) / 2) * 52;
};
export const portY = (n: AsmNode, id: string, ports: Port[] = PORTS[n.kind]): number => {
  const side = ports.find((q) => q.id === id)?.side ?? "left";
  const list = ports.filter((q) => q.side === side);
  const i = Math.max(0, list.findIndex((q) => q.id === id));
  return 22 + i * PORT_STEP + PORT_STEP / 2;
};
export const snap = (v: number): number => Math.round(v / GRID) * GRID;
const uid = (prefix: string, taken: Set<string>): string => { let i = 1; while (taken.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; };

/** A TEMPLATE CLASS LANDS AS ITS KIND (2026-09-12): the catalogue bench offers the HVACTemplate cards and the unit heater by
 *  class, but the sheet, the compile and the resolver know them as kinds (`pthp`, `wshp`, `euh` …) with hand-shaped
 *  connectors — a card dropped as a `component` with a template class compiled to nothing. Every other class is a component. */
export const KIND_OF_CLASS: Record<string, NodeKind> = Object.fromEntries(
  (Object.entries(NODE_CLASS) as Array<[NodeKind, string]>).filter(([k, c]) => k !== "component" && (c.startsWith("HVACTemplate:") || c === "ZoneHVAC:UnitHeater")).map(([k, c]) => [c, k]),
) as Record<string, NodeKind>;
/** the kind a dropped item becomes: a template class its kind, anything else as given */
export const kindOfItem = (item: { node: NodeKind; cls?: string }): { node: NodeKind; cls?: string } => {
  const k = item.node === "component" && item.cls ? KIND_OF_CLASS[item.cls] : undefined;
  return k ? { node: k } : item;
};
/** add a node from a palette item at a canvas point */
export function addNode(asm: Assembly, itemIn: { node: NodeKind; label?: string; from?: FromFile; cls?: string }, x: number, y: number): { asm: Assembly; id: string } {
  const item = { ...itemIn, ...kindOfItem(itemIn) };
  if (item.node !== "component") delete item.cls;
  const taken = new Set(asm.nodes.map((n) => n.id));
  // a catalogue card's id reads as its class's last word, so a sheet says what it holds: `unitarysystem-1`, `pump-2`
  const stem = item.node === "component" && item.cls ? (item.cls.split(":").pop() ?? "component").replace(/[^A-Za-z0-9]/g, "").toLowerCase() : item.node;
  const id = uid(`${stem}-`, taken);
  const n: AsmNode = { id, kind: item.node, x: snap(x), y: snap(y) };
  if (item.cls) n.cls = item.cls;
  if (item.label) n.label = item.label;
  if (item.from) n.from = item.from;
  if (item.node === "wholehouse") n.vent = { kind: "Exhaust" };
  if (item.node === "exhaust") n.vent = { kind: "Exhaust" };
  return { asm: { ...asm, nodes: [...asm.nodes, n] }, id };
}
export function removeNode(asm: Assembly, id: string): Assembly {
  return { ...asm, nodes: asm.nodes.filter((n) => n.id !== id), edges: asm.edges.filter((e) => e.from !== id && e.to !== id) };
}

// ── SUBSTITUTION (user, 2026-09-12: "the diagram in the current model was built using wrong components (as in air terminals
// need to be VAV terminals) — can we right-click on the component in the view to see a substitute list to change the
// component"). A card is changed IN PLACE: its id, position, ID and lines are kept, and each line is re-hung on the new
// card's connector of the same medium and direction (the one whose label matches first — a heat pump's "Wtr" goes to the
// unitary system's coil water, not its "HR" heat-recovery water). A line the new card cannot take is NAMED and dropped,
// never silently; the old card's fields and attachments are keyed to its class and are dropped and named too.
export interface CatalogueLike { of(cls: string): { ports: Array<{ key: string; medium: string; dir: "in" | "out"; label: string }>; zoneAttached: boolean; label: string; sub: string; shelf: string; tier: "ideal" | "template" | "component"; retired?: string } | null; entries: Map<string, unknown> }
export interface Substitute {
  node: NodeKind; cls?: string; label: string; sub: string; group: PaletteGroup; tier: "ideal" | "template" | "component" | "kind";
  /** how many of the card's lines the new card keeps, and which it cannot take */
  keeps: number; drops: Array<{ edge: AsmEdge; other: string; port: string }>;
}
interface PortLike { id: string; medium: Medium; dir: "in" | "out"; label: string }
/** the lines on a node, each with the node's own port on it */
function linesWithPorts(asm: Assembly, n: AsmNode, cat: CatalogueLike | null): Array<{ edge: AsmEdge; port: PortLike | null; other: string }> {
  const ports = portsOfNode(n, cat);
  return asm.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => {
    const pid = e.from === n.id ? e.fromPort : e.toPort;
    const port = ports.find((q) => q.id === pid) ?? (pid === undefined ? ports.find((q) => (e.from === n.id ? q.dir === "out" : q.dir === "in")) ?? null : null);
    return { edge: e, port, other: e.from === n.id ? e.to : e.from };
  });
}
/** re-hang the lines on the new card's ports, CONNECTOR BY CONNECTOR: every line on one old connector follows it to one new
 *  connector of the same medium and direction (the matching label first — "Wtr" to "Wtr", not to "HR"), each new connector
 *  taken once. A supply connector fans out to several terminals by design (the splitter is generated), so its lines move together. */
function rehang(lines: ReturnType<typeof linesWithPorts>, target: PortLike[]): { map: Map<string, string>; drops: Substitute["drops"] } {
  const map = new Map<string, string>(), drops: Substitute["drops"] = [];
  const free = [...target];
  const take = (q: PortLike): void => { const i = free.indexOf(q); if (i >= 0) free.splice(i, 1); };
  const byPort = new Map<string, typeof lines>();
  for (const l of lines) { const k = l.port?.id ?? "?"; (byPort.get(k) ?? byPort.set(k, []).get(k)!).push(l); }
  for (const [, ls] of byPort) {
    const port = ls[0]!.port;
    if (!port) { for (const l of ls) drops.push({ edge: l.edge, other: l.other, port: "?" }); continue; }
    const fits = (q: PortLike): boolean => q.dir === port.dir && (q.medium === port.medium || (q.medium !== "loc" && q.medium !== "wtr" && port.medium !== "loc" && port.medium !== "wtr"));
    const q = free.find((x) => fits(x) && x.label === port.label) ?? free.find((x) => fits(x) && x.medium === port.medium) ?? free.find(fits);
    if (q) { for (const l of ls) map.set(l.edge.id, q.id); take(q); } else for (const l of ls) drops.push({ edge: l.edge, other: l.other, port: port.label });
  }
  return { map, drops };
}
/** every card the palette and the catalogue offer as a replacement for this one, ranked: the ones that keep every line first */
export function substitutesFor(asm: Assembly, id: string, cat: CatalogueLike | null, paletteKinds = true): Substitute[] {
  const n = asm.nodes.find((x) => x.id === id);
  if (!n || n.kind === "zone") return [];
  const lines = linesWithPorts(asm, n, cat);
  const out: Substitute[] = [];
  const consider = (t: { node: NodeKind; cls?: string; label: string; sub: string; group: PaletteGroup; tier: Substitute["tier"] }): void => {
    if (t.node === n.kind && (t.node !== "component" || t.cls === n.cls)) return;   // itself
    const probe: AsmNode = { ...n, kind: t.node, ...(t.cls ? { cls: t.cls } : {}) };
    if (!t.cls) delete probe.cls;
    const ports = portsOfNode(probe, cat);
    const { map, drops } = rehang(lines, ports);
    out.push({ ...t, keeps: map.size, drops });
  };
  // the catalogue's cards first (a template class as its KIND, under the catalogue's own label), then the palette's kinds the
  // catalogue does not carry (the template systems, loops, boiler, tower, the resources)
  const seen = new Set<string>();
  if (cat) for (const cls of cat.entries.keys()) {
    const e = cat.of(cls); if (!e || e.retired) continue;   // a retired class (a terminal card) is never offered
    const k = KIND_OF_CLASS[cls];
    const key = k ?? `component:${cls}`;
    if (seen.has(key)) continue; seen.add(key);
    consider(k ? { node: k, label: e.label, sub: e.sub, group: e.shelf as PaletteGroup, tier: e.tier } : { node: "component", cls, label: e.label, sub: e.sub, group: e.shelf as PaletteGroup, tier: e.tier });
  }
  if (paletteKinds) for (const it of PALETTE) if (it.node && it.node !== "zone" && it.node !== "component" && !seen.has(it.node)) { seen.add(it.node); consider({ node: it.node, label: it.label, sub: it.sub, group: it.group, tier: "kind" }); }
  const g = GROUP_OF[n.kind];
  const rank = (x: Substitute): number => (x.group === g ? -1 : PALETTE_GROUPS.indexOf(x.group));
  out.sort((a, b) => (b.keeps - a.keeps) || (a.drops.length - b.drops.length) || (rank(a) - rank(b)) || a.label.localeCompare(b.label));
  return out;
}
/** the card changed in place; what could not come along is returned by name */
export function substitute(asm: Assembly, id: string, to: { node: NodeKind; cls?: string; label: string }, cat: CatalogueLike | null): { asm: Assembly; dropped: Array<{ edge: AsmEdge; other: string; port: string }>; fieldsDropped: string[]; attachmentsDropped: AttachKind[] } {
  const n = asm.nodes.find((x) => x.id === id);
  if (!n) return { asm, dropped: [], fieldsDropped: [], attachmentsDropped: [] };
  const lines = linesWithPorts(asm, n, cat);
  const next: AsmNode = { id: n.id, kind: to.node, x: n.x, y: n.y, label: to.label };
  if (to.cls) next.cls = to.cls;
  if (n.ident) next.ident = n.ident;
  if (n.from) next.from = n.from;
  if (n.vent && (to.node === "exhaust" || to.node === "wholehouse")) next.vent = n.vent;
  const { map, drops } = rehang(lines, portsOfNode(next, cat));
  const dropIds = new Set(drops.map((d) => d.edge.id));
  const edges = asm.edges.filter((e) => !dropIds.has(e.id)).map((e) => {
    const q = map.get(e.id);
    if (!q) return e;
    const m = { ...e };
    if (e.from === id) m.fromPort = q; else m.toPort = q;
    delete m.points;   // a line re-hung on another connector is routed by the sheet again
    return m;
  });
  return {
    asm: { ...asm, nodes: asm.nodes.map((x) => (x.id === id ? next : x)), edges },
    dropped: drops, fieldsDropped: Object.keys(n.fields ?? {}), attachmentsDropped: [...(n.attached ?? [])],
  };
}
export function moveNode(asm: Assembly, id: string, x: number, y: number): Assembly {
  return { ...asm, nodes: asm.nodes.map((n) => (n.id === id ? { ...n, x: snap(x), y: snap(y) } : n)) };
}
export function patchNode(asm: Assembly, id: string, f: (n: AsmNode) => AsmNode): Assembly {
  return { ...asm, nodes: asm.nodes.map((n) => (n.id === id ? f(n) : n)) };
}
/** connect two nodes once; a node to itself never */
export function addEdge(asm: Assembly, from: string, to: string, fromPort?: string, toPort?: string): Assembly {
  if (from === to || asm.edges.some((e) => e.from === from && e.to === to && e.fromPort === fromPort && e.toPort === toPort)) return asm;
  const taken = new Set(asm.edges.map((e) => e.id));
  const e: AsmEdge = { id: uid("e", taken), from, to };
  if (fromPort) e.fromPort = fromPort;
  if (toPort) e.toPort = toPort;
  return { ...asm, edges: [...asm.edges, e] };
}
/** the line's corners as the user routed them; an empty list puts the sheet's own routing back */
export function setEdgePoints(asm: Assembly, id: string, points: Array<[number, number]>): Assembly {
  return { ...asm, edges: asm.edges.map((e) => { if (e.id !== id) return e; const n = { ...e }; if (points.length) n.points = points.map(([x, y]) => [snap(x), snap(y)] as [number, number]); else delete n.points; return n; }) };
}
/** the side of a loop a connector lands on: its port (sup-* / dem-*, or an old sheet's "supply" / "demand"), else the side the other kind belongs on */
export function loopSide(asm: Assembly, e: AsmEdge, loopId: string): LoopSide {
  const port = e.from === loopId ? e.fromPort : e.toPort;
  if (port) return port.startsWith("sup") ? "supply" : port.startsWith("dem") ? "demand" : port === "supply" ? "supply" : "demand";
  const other = asm.nodes.find((n) => n.id === (e.from === loopId ? e.to : e.from));
  return other && SUPPLY_KINDS.includes(other.kind) ? "supply" : "demand";
}
export function removeEdge(asm: Assembly, id: string): Assembly { return { ...asm, edges: asm.edges.filter((e) => e.id !== id) }; }
export function attach(asm: Assembly, id: string, a: AttachKind): Assembly {
  // one of each family: a new heating coil replaces the old, a new cooling coil the old, a new recovery the old
  const family = (k: AttachKind): string => k.startsWith("coil-heat") ? "heat" : k.startsWith("coil-cool") ? "cool" : k.startsWith("hr-") ? "hr" : k;
  return patchNode(asm, id, (n) => ({ ...n, attached: [...(n.attached ?? []).filter((k) => family(k) !== family(a)), a] }));
}
export function detach(asm: Assembly, id: string, a: AttachKind): Assembly {
  return patchNode(asm, id, (n) => { const rest = (n.attached ?? []).filter((k) => k !== a); const m = { ...n }; if (rest.length) m.attached = rest; else delete m.attached; return m; });
}
/** THE ERV ON A UNIT'S INTAKE (user, 2026-10-03: "the Energy Recovery Ventilator will not drop onto systems view"; ruled: the ERV
 *  sits on the heat pump's outdoor-air intake). The ERV/HRV tile is an attachment of the template kinds; dropped on a catalogue
 *  unit that takes outdoor air (a water-to-air heat pump, a unitary system) it PLACES the heat-recovery core beside the unit with
 *  its Air out on the unit's OA ‹ — the one path the compile writes as an outdoor-air system. An HRV is the same core with latent
 *  recovery 0. A core already on the intake is switched between ERV and HRV; any other line on the intake is refused, named. */
export const HX_CORE_CLASS = "HeatExchanger:AirToAir:SensibleAndLatent";
const LATENT_KEYS = ["latent_effectiveness_at_100_heating_air_flow", "latent_effectiveness_at_100_cooling_air_flow"] as const;
export function recoveryOnUnit(asm: Assembly, unitId: string, a: "hr-enthalpy" | "hr-sensible"): { asm: Assembly; id: string } | { refused: string } {
  const u = asm.nodes.find((n) => n.id === unitId);
  const name = (n: AsmNode): string => n.ident || n.label || n.id;
  if (!u || u.kind !== "component" || !OA_PARENTS.includes(u.cls ?? "")) return { refused: `${u ? name(u) : unitId} takes no outdoor air — an ${a === "hr-enthalpy" ? "ERV" : "HRV"} goes on a water-to-air heat pump's or a unitary system's intake (OA ‹), or on a template system` };
  const latent = (n: AsmNode): AsmNode => {
    const f: SystemFields = { ...(n.fields ?? {}) };
    for (const k of LATENT_KEYS) { if (a === "hr-sensible") f[k] = 0; else if (f[k] === 0) delete f[k]; }
    const m: AsmNode = { ...n, fields: f }; if (!Object.keys(f).length) delete m.fields; return m;
  };
  const onIntake = asm.edges.filter((e) => e.to === unitId && e.toPort === "outdoor_air_inlet_node_name");
  if (onIntake.length) {
    const other = asm.nodes.find((n) => n.id === onIntake[0]!.from);
    if (onIntake.length > 1 || !other || other.cls !== HX_CORE_CLASS) return { refused: `${name(u)}'s outdoor-air intake already has a line from ${other ? name(other) : "a card"} — take it off first` };
    return { asm: patchNode(asm, other.id, latent), id: other.id };
  }
  const made = addNode(asm, { node: "component", cls: HX_CORE_CLASS, label: a === "hr-enthalpy" ? "ERV" : "HRV" }, u.x - NODE_W - 64, u.y);
  const withCore = patchNode(made.asm, made.id, latent);
  return { asm: addEdge(withCore, made.id, unitId, "supply_air_outlet_node_name", "outdoor_air_inlet_node_name"), id: made.id };
}
/** the neighbours of a node, by kind */
export const neighbours = (asm: Assembly, id: string): AsmNode[] => asm.edges.filter((e) => e.from === id || e.to === id).map((e) => asm.nodes.find((n) => n.id === (e.from === id ? e.to : e.from))).filter((n): n is AsmNode => !!n);

/** the zones assigned to a node */
export const zonesOf = (assign: ZoneAssign, id: string): string[] => Object.entries(assign).filter(([, ids]) => ids.includes(id)).map(([z]) => z);
/** an assignment with the nodes no longer on the sheet dropped */
export function pruneAssign(assign: ZoneAssign, asm: Assembly): ZoneAssign {
  const ids = new Set(asm.nodes.map((n) => n.id));
  const out: ZoneAssign = {};
  for (const [z, list] of Object.entries(assign)) { const keep = list.filter((x) => ids.has(x)); if (keep.length) out[z] = keep; }
  return out;
}

// ── THE COMPILE: the graph → the rulings the resolver honours
// ── THE ZONES DRAWN ON THE SHEET (user, 2026-09-10: "a Zone component … with an expandable container and Air In and Out connectors.
// We want to drag rooms to these zones, which are saved with these zone arrangements"). A Zone node holds rooms; a room is in
// one zone; the zone's name is its ID, else its label, else "Zone n"; what connects to its Air in (a terminal, zone equipment)
// serves it and an exhaust fan on its Air out exhausts it — the ZONES tab's assignment, drawn. The model merges a zone's rooms
// into one thermal zone (mergeInputZones); its thermostat rides on the node's fields.
export function addRoom(asm: Assembly, zoneId: string, room: string): Assembly {
  return { ...asm, nodes: asm.nodes.map((n) => {
    if (n.kind !== "zone") return n;
    const rooms = (n.rooms ?? []).filter((r) => r !== room);   // out of every other zone
    if (n.id === zoneId) rooms.push(room);
    return rooms.length === (n.rooms ?? []).length && (n.id !== zoneId || n.rooms?.includes(room)) ? n : { ...n, rooms };
  }) };
}
export function removeRoom(asm: Assembly, zoneId: string, room: string): Assembly {
  return patchNode(asm, zoneId, (n) => { const rooms = (n.rooms ?? []).filter((r) => r !== room); const m = { ...n }; if (rooms.length) m.rooms = rooms; else delete m.rooms; return m; });
}
export function toggleZone(asm: Assembly, id: string): Assembly {
  return patchNode(asm, id, (n) => { const m = { ...n }; if (n.collapsed) delete m.collapsed; else m.collapsed = true; return m; });
}
export function toggleThermostat(asm: Assembly, id: string): Assembly {
  return patchNode(asm, id, (n) => { const m = { ...n }; if (n.thermostat === false) delete m.thermostat; else m.thermostat = false; return m; });
}
/** THE DAMPER THE ZONE CARRIES (user, 2026-09-13: "the zone component could incorporate that expectation without having to add an
 *  air terminal component"). EnergyPlus has ONE terminal object per zone per air loop, on the supply — the return and the exhaust
 *  are nodes the generator writes — so the Zone's Air in IS the terminal, and its type and two fields are the Zone's own settings.
 *  None of the three has a coil in it: the engine's "HeatAndCool" names the DAMPER ACTION (it opens on a heating call as on a
 *  cooling call — SimCBVAV, SingleDuct.cc), "NoReheat" says nothing sits in the box; a plain "VAV:NoReheat" damper holds its
 *  minimum on a heating call (SingleDuct.cc:3489), which is why it is the cooling-only one. */
export const TERMINAL_CLASSES = [
  { cls: "AirTerminal:SingleDuct:VAV:HeatAndCool:NoReheat", label: "VAV damper, opens for heating and cooling", sub: "no coil in the box: the damper modulates on a heating call as on a cooling call — a heat pump's zone damper" },
  { cls: "AirTerminal:SingleDuct:VAV:NoReheat", label: "VAV damper, cooling only", sub: "no coil in the box: modulates on a cooling call, holds its minimum on a heating call" },
  { cls: "AirTerminal:SingleDuct:ConstantVolume:NoReheat", label: "constant-volume outlet", sub: "a fixed share of the unit's flow, no damper — the engine's own shape under one thermostat" },
] as const;
/** the Zone card's own fields for its damper (the engine's keys, prefixed so they sit beside the setpoints in `fields`) */
export const TERMINAL_FIELD = { cls: "terminal_object_type", maxFlow: "terminal_maximum_air_flow_rate", minFraction: "terminal_zone_minimum_air_flow_fraction" } as const;
/** THE MINIMUM FRACTION a damper closes to — the engine's own changeover example (ChangeoverBypassVAV.idf: 0.25); the field is required and has no default */
export const TERMINAL_MIN_FRACTION = 0.25;
/** THE TWO SIDES OF A ZONE'S THERMOSTAT (user, 2026-09-14): a Zone card's field per side, `off` = that setpoint is put out of reach in the IDF */
export const THERMOSTAT_SIDE_FIELD = { heating: "thermostat_heating", cooling: "thermostat_cooling" } as const;
/** the damper a parent's zones take when the Zone says nothing: the damper that opens both ways under a UnitarySystem, the
 *  engine's own constant-volume outlet under a UnitaryHeatPump:WaterToAir (HeatPumpWaterToAirEquationFit.idf) */
export const defaultTerminalFor = (parentCls: string): string => (parentCls === "AirLoopHVAC:UnitarySystem" ? "AirTerminal:SingleDuct:VAV:HeatAndCool:NoReheat" : "AirTerminal:SingleDuct:ConstantVolume:NoReheat");
/** the damper a Zone card states: its class and the engine's two fields, only what is typed */
export function terminalOfZone(n: AsmNode): { cls?: string; fields?: SystemFields } | undefined {
  const f = n.fields ?? {};
  const out: { cls?: string; fields?: SystemFields } = {};
  if (typeof f[TERMINAL_FIELD.cls] === "string" && f[TERMINAL_FIELD.cls]) out.cls = String(f[TERMINAL_FIELD.cls]);
  const tf: SystemFields = {};
  if (f[TERMINAL_FIELD.maxFlow] !== undefined && f[TERMINAL_FIELD.maxFlow] !== "") tf.maximum_air_flow_rate = f[TERMINAL_FIELD.maxFlow]!;
  if (typeof f[TERMINAL_FIELD.minFraction] === "number") tf.zone_minimum_air_flow_fraction = f[TERMINAL_FIELD.minFraction]!;
  if (Object.keys(tf).length) out.fields = tf;
  return Object.keys(out).length ? out : undefined;
}
export interface CompiledZone { id: string; name: string; rooms: string[]; fedBy: string | null; fans: string[]; thermostat: boolean;
  /** the damper the Zone states (2026-09-13); absent = the parent's default */
  terminal?: { cls?: string; fields?: SystemFields };
  /** a template DOAS whose Air out runs to this Zone: its feeder takes the outdoor air */
  oaFrom?: string }
/** the zones drawn on the sheet, compiled: each named and holding its rooms of the model; the model's zone names as the
 *  sheet leaves them (the rooms not held, plus the zones drawn); the assignment the air connections make, over the ZONES
 *  tab's word for the rooms the sheet does not hold */
export function compiledZones(asm: Assembly, modelZones: string[]): { zones: CompiledZone[]; roomZone: Record<string, string>; zoneNames: string[]; refusals: Array<{ node: string; text: string }>; assignOf: (manual: ZoneAssign) => ZoneAssign; locations: Record<string, string> } {
  const refusals: Array<{ node: string; text: string }> = [], zones: CompiledZone[] = [], roomZone: Record<string, string> = {}, locations: Record<string, string> = {};
  const held = new Set<string>(), names = new Set<string>();
  const byId = new Map(asm.nodes.map((n) => [n.id, n]));
  const nm = (x: AsmNode): string => x.ident?.trim() || x.label || NODE_LABEL[x.kind];
  const intakeOf = new Map<string, string>();   // a zone unit → the Zone whose Air out feeds its Air in
  for (const n of asm.nodes.filter((x) => x.kind === "zone")) {
    const base = n.ident?.trim() || n.label?.trim() || "Zone";
    let name = base, i = 2;
    while (names.has(name)) name = `${base} ${i++}`;
    names.add(name);
    const rooms: string[] = [];
    for (const r of n.rooms ?? []) {
      // a name that is no room of the model — an attic merged on ZONES into another, a void's old name — holds no air and no
      // surface: skipped, never refused (the user, 2026-10-07: the cards cannot show it, so it cannot be taken out). A room
      // left out of every card is still named by the check "room-zone".
      if (!modelZones.includes(r)) continue;
      if (held.has(r)) { refusals.push({ node: n.id, text: `${r} is in two zones — a room is in one` }); continue; }
      held.add(r); rooms.push(r); roomZone[r] = name;
    }
    if (!rooms.length) refusals.push({ node: n.id, text: `${name} holds no room — drag rooms from LEVELS · SPACES into it` });
    if (modelZones.includes(name) && !rooms.includes(name)) refusals.push({ node: n.id, text: `${name} is named like a room it does not hold — give it an ID, or drag ${name} into it` });
    // what serves a zone arrives two ways: DUCTED into its Air in (a terminal), or LOCATED in it — a line from the equipment's
    // Loc connector to the zone's (user, 2026-09-11), which is how a unit heater, a baseboard or a packaged unit says it is there
    const into = asm.edges.filter((e) => e.to === n.id && ((e.toPort ?? "air-in") === "air-in" || e.toPort === "loc-in")).map((e) => byId.get(e.from)).filter((x): x is AsmNode => !!x);
    // a feeder: a ducted parent's Air out (the Zone's Air in is its damper, 2026-09-13), zone equipment by its Loc, or — until
    // folded — an older sheet's terminal card; a DOAS on the Air in is not a feeder but the zone's outdoor air
    const isUnit = (x: AsmNode): boolean => (isAssignable(x.kind) && x.kind !== "exhaust" && x.kind !== "wholehouse") || (x.kind === "component" && servesByClass(x.cls ?? ""));
    // THE ZONE'S AIR OUT feeds a unit's Air in too (the user, 2026-09-14, citing the reference: a unit heater's inlet IS a zone exhaust node) —
    // a zone unit drawing air from this Zone is IN it, as its Air out into the Zone's Air in or its Loc says; drawn from two zones, refused
    const outTo = asm.edges.filter((e) => e.from === n.id && (e.fromPort ?? "air-out") === "air-out").map((e) => byId.get(e.to)).filter((x): x is AsmNode => !!x);
    const drawsFrom = outTo.filter((x) => x.kind !== "exhaust" && isUnit(x));
    for (const x of drawsFrom) { const prev = intakeOf.get(x.id); if (prev && prev !== name) refusals.push({ node: x.id, text: `${nm(x)} draws air from ${prev} and from ${name} — a zone unit's air is one zone's` }); intakeOf.set(x.id, name); }
    const feeders = [...into.filter(isUnit), ...drawsFrom.filter((x) => !into.includes(x))];
    // a pump, an exchanger, a loop or a boiler joined by its Loc is merely LOCATED in the zone (2026-09-14: the pump's skin losses go there) — never a feeder
    for (const x of into) if (x.kind === "component" && !servesByClass(x.cls ?? "")) locations[x.id] = name;
    const fans = [
      ...outTo.filter((x) => x.kind === "exhaust"),
      ...into.filter((x) => x.kind === "exhaust"),
    ];
    const oa = into.filter((x) => x.kind === "doas");
    if (feeders.length > 1) refusals.push({ node: n.id, text: `${name} is fed by ${feeders.length} components — one unit serves a zone` });
    if (oa.length > 1) refusals.push({ node: n.id, text: `${name} takes outdoor air from ${oa.length} dedicated outdoor-air systems — one` });
    const z: CompiledZone = { id: n.id, name, rooms, fedBy: feeders[0]?.id ?? null, fans: fans.map((f) => f.id), thermostat: n.thermostat !== false };
    const t = terminalOfZone(n); if (t) z.terminal = t;
    if (oa[0]) z.oaFrom = oa[0].id;
    zones.push(z);
  }
  // a unit that supplies one Zone and draws its air from another is drawn wrong: its air is one zone's
  for (const z of zones) { const src = z.fedBy ? intakeOf.get(z.fedBy) : undefined; if (z.fedBy && src && src !== z.name) refusals.push({ node: z.fedBy, text: `${nm(byId.get(z.fedBy)!)} supplies ${z.name} and draws air from ${src} — a zone unit's air is one zone's` }); }
  const zoneNames = [...modelZones.filter((z) => !held.has(z)), ...zones.map((z) => z.name).filter((z) => !modelZones.includes(z) || held.has(z))];
  const assignOf = (manual: ZoneAssign): ZoneAssign => {
    const out: ZoneAssign = {};
    for (const [z, ids] of Object.entries(manual)) if (!held.has(z)) out[z] = ids;   // a room the sheet holds is served through its zone
    for (const z of zones) { const ids = [...(z.fedBy ? [z.fedBy] : []), ...z.fans]; if (ids.length) out[z.name] = ids; }
    return out;
  };
  return { zones, roomZone, zoneNames, refusals, assignOf, locations };
}
/** `cautions` (2026-09-12): legal input the engine will run but the user should know about, named on the node — a unitary system on several zones follows one thermostat */
export interface CompiledAssembly { hvac: HvacRuling[]; ventilation?: VentilationRuling; loops: LoopRuling[]; refusals: Array<{ node: string; text: string }>; cautions: Array<{ node: string; text: string }>; notes: string[]; zoneOf: Map<string, string>; zones: CompiledZone[]; roomZone: Record<string, string>;
  /** card id → the ruling it compiles into or belongs to (a system's own, a ring member's loop) — what the QA rows are read back onto (2026-09-13) */
  rulingIds: Record<string, string>;
  /** ONE HEAT PUMP PER THERMOSTAT (the user's ruling, 2026-09-13 night): a UnitaryHeatPump:WaterToAir card on several T-on zones is written
   *  as one unit per zone, named card + zone — the ids of those units, per card (the first of them is the card's rulingIds entry) */
  splitIds: Record<string, string[]>;
  /** card id → the Zone a card that serves nothing is LOCATED in by its Loc line (a pump's skin losses, 2026-09-14) */
  locations: Record<string, string> }
/** what a zone's equipment can do (2026-09-14): a baseboard or a unit heater heats only — the sides of its thermostat follow */
export interface ZoneCapability { heat: boolean; cool: boolean; why: string }
export function capabilityOf(kind: string, fields?: SystemFields): ZoneCapability {
  if (kind === "HVACTemplate:Zone:BaseboardHeat") return { heat: true, cool: false, why: "the baseboard heats only" };
  if (kind === "ZoneHVAC:UnitHeater") return { heat: true, cool: false, why: "the unit heater heats only" };
  if (kind === "HVACTemplate:System:Unitary" && fields?.cooling_coil_type === "None") return { heat: true, cool: false, why: "its cooling coil is None" };
  if (kind === "HVACTemplate:Zone:PTAC" && fields?.heating_coil_type === "None") return { heat: false, cool: true, why: "its heating coil is None" };
  return { heat: true, cool: true, why: "" };
}

export function compileAssembly(asm: Assembly, zoneNames: string[], assign: ZoneAssign = {}): CompiledAssembly {
  const refusals: Array<{ node: string; text: string }> = [], cautions: Array<{ node: string; text: string }> = [], notes: string[] = [];
  const hvac: HvacRuling[] = [];
  const zoneOf = new Map<string, string>();
  const rulingIds: Record<string, string> = {}, splitIds: Record<string, string[]> = {};
  const byId = new Map(asm.nodes.map((n) => [n.id, n]));
  const label = (n: AsmNode): string => n.label ?? NODE_LABEL[n.kind];
  const name = (n: AsmNode): string => n.ident?.trim() || label(n);   // the ID names the ruling when given
  // the zones drawn on the sheet come first: the model's zone names as the sheet leaves them, the assignment its air connections make
  const drawn = compiledZones(asm, zoneNames);
  for (const r of drawn.refusals) refusals.push(r);
  zoneNames = drawn.zoneNames; assign = drawn.assignOf(assign);
  const idsTaken = new Set<string>();
  const ruleIdFor = (base: string): string => { let id = base, i = 2; while (idsTaken.has(id)) id = `${base} ${i++}`; idsTaken.add(id); return id; };
  const ruleId = (n: AsmNode): string => ruleIdFor(name(n));
  const systems = asm.nodes.filter((n) => isSystem(n.kind));
  // the loops: what sits on each SIDE — producers on the supply side, consumers on the demand side (the engine's own rule); a thing on the wrong side is refused
  const loops = new Map<string, { id: string; kind: "hwloop" | "mwloop"; node: AsmNode; boiler: AsmNode | null; tower: AsmNode | null; resources: Resource[]; demand: Set<string> }>();
  for (const n of asm.nodes.filter((x) => isLoop(x.kind))) {
    const supply: AsmNode[] = [], demand = new Set<string>();
    for (const e of asm.edges.filter((x) => x.from === n.id || x.to === n.id)) {
      const other = byId.get(e.from === n.id ? e.to : e.from);
      if (!other) continue;
      const side = loopSide(asm, e, n.id);
      const producer = SUPPLY_KINDS.includes(other.kind);
      if (producer && side === "demand") refusals.push({ node: other.id, text: `${label(other)} produces — connect it to ${label(n)}'s SUPPLY side` });
      else if (!producer && side === "supply") refusals.push({ node: other.id, text: `${label(other)} consumes — connect it to ${label(n)}'s DEMAND side` });
      else if (producer) supply.push(other); else demand.add(other.id);
    }
    loops.set(n.id, { id: ruleId(n), kind: n.kind as "hwloop" | "mwloop", node: n, boiler: supply.find((x) => x.kind === "boiler") ?? null, tower: supply.find((x) => x.kind === "tower") ?? null, resources: supply.filter((x) => isResource(x.kind)).map((x) => x.kind as Resource), demand });
    rulingIds[n.id] = loops.get(n.id)!.id;
  }
  // an older sheet's terminal cards (2026-09-13: the Zone's Air in is the terminal now): refused, and folded by the button
  const foldWord = "the Zone's Air in is the terminal now — fold it into its Zone (the button in the settings) and the unit's Air out runs straight to the Zone";
  for (const t of asm.nodes.filter((x) => x.kind === "terminal")) refusals.push({ node: t.id, text: `${label(t)} is a terminal card: ${foldWord}` });
  const doasIds = new Map<string, string>();
  for (const n of asm.nodes.filter((x) => x.kind === "doas")) doasIds.set(n.id, ruleId(n));
  for (const n of systems) {
    const nb = neighbours(asm, n.id);
    const zones: string[] = [];
    // a system's zones: the Zone cards its Air out reaches (an air loop) or its Loc joins (zone equipment), and the ZONES tab's word
    for (const zn of zonesOf(assign, n.id)) {
      if (!zoneNames.includes(zn)) { refusals.push({ node: n.id, text: `"${zn}" is not a zone of the model` }); continue; }
      const other = zoneOf.get(zn);
      if (other && other !== n.id) { refusals.push({ node: n.id, text: `${zn} is served twice (${label(byId.get(other)!)} and ${label(n)}) — a zone is in at most one system` }); continue; }
      zoneOf.set(zn, n.id); zones.push(zn);
    }
    if (isAirLoop(n.kind) && !zones.length) refusals.push({ node: n.id, text: `${label(n)} reaches no zone — run its Air out to each Zone's Air in, or assign zones to it in ZONES` });
    const att = attachedFields(n);
    for (const t of att.notes) if (!/nothing to set/.test(t)) refusals.push({ node: n.id, text: t }); else notes.push(`${label(n)}: ${t}`);
    const fields: SystemFields = { ...att.fields, ...(n.fields ?? {}) };
    const kind = HVAC_KIND_OF[n.kind]!;
    const h: HvacRuling = { id: ruleId(n), kind, zones, fields: Object.keys(fields).length ? fields : undefined };
    rulingIds[n.id] = h.id;
    if (n.from) h.from = n.from;
    if (!zones.length && !isAirLoop(n.kind)) refusals.push({ node: n.id, text: `${label(n)} serves no zone — ${PORTS[n.kind].some((q) => q.id === "air-out") ? "run its Air out to a Zone's Air in (its Air in from the Zone's Air out), or join its Loc to the Zone's" : "join its Loc to a Zone's"}, or assign one in ZONES` });
    // a unit heater's water or steam coil (2026-09-14): offered on the card, refused until its water side is written
    if (n.kind === "euh" && /Water|Steam/.test(String(fields.heating_coil_object_type ?? ""))) refusals.push({ node: n.id, text: `${label(n)}: ${UH_WATER_REFUSAL}` });
    // the loops
    const wantsHotWater = Object.values(fields).includes("HotWater");
    const onDemand = (k: "hwloop" | "mwloop"): AsmNode | undefined => nb.find((x) => x.kind === k && loops.get(x.id)?.demand.has(n.id));
    const hw = onDemand("hwloop"), mw = onDemand("mwloop");
    if (n.kind === "wshp") {
      if (!mw) refusals.push({ node: n.id, text: `${label(n)} needs a mixed-water loop — connect one` });
      else { const L = loops.get(mw.id)!; h.plant = { loop: mw.fields, boiler: L.boiler ? { ...(L.boiler.fields ?? {}) } : undefined, tower: L.tower ? { ...(L.tower.fields ?? {}) } : undefined, resources: L.resources.length ? L.resources : undefined }; }
    } else if (mw) refusals.push({ node: n.id, text: `${label(n)} does not take a mixed-water loop (only the water-to-air heat pump does)` });
    // a coil's availability names the SCHEDULES role: the resolver turns the marker into the ruled schedule

    if (wantsHotWater) {
      if (!hw) refusals.push({ node: n.id, text: `${label(n)} has a hot-water coil and no hot-water loop — connect a loop with a boiler` });
      else { const L = loops.get(hw.id)!; h.plant = { ...(h.plant ?? {}), hotWater: { id: L.id, loop: hw.fields, boiler: L.boiler ? { ...(L.boiler.fields ?? {}) } : undefined, resources: L.resources.length ? L.resources : undefined } }; if (!L.boiler) refusals.push({ node: hw.id, text: `${L.id} has no boiler — connect one` }); }
    } else if (hw) refusals.push({ node: n.id, text: `${label(n)} is on a hot-water loop but has no hot-water coil — drop one onto it` });
    // the DOAS runs to the ZONE it ventilates (2026-09-13); the zone's feeder — this equipment — takes it
    const doasOn = [...new Set(drawn.zones.filter((z) => z.fedBy === n.id && z.oaFrom).map((z) => z.oaFrom!))];
    const doas = doasOn[0] ? byId.get(doasOn[0]) : undefined;
    if (doas) {
      if (doasOn.length > 1) refusals.push({ node: n.id, text: `${label(n)}'s zones take outdoor air from ${doasOn.length} dedicated outdoor-air systems — one per unit` });
      if (!ZONE_EQUIPMENT.includes(n.kind)) refusals.push({ node: doas.id, text: `a dedicated outdoor-air system ventilates zone equipment (PTHP, PTAC, WSHP, baseboard); ${label(n)}, which serves ${drawn.zones.find((z) => z.oaFrom === doas.id)?.name ?? "that zone"}, takes its outdoor air itself` });
      else { const da = attachedFields(doas); h.doas = { id: doasIds.get(doas.id)!, fields: { ...da.fields, ...(doas.fields ?? {}) } }; for (const t of da.notes) if (!/nothing to set/.test(t)) refusals.push({ node: doas.id, text: t }); }
    }
    hvac.push(h);
  }
  // ── COMPONENT CARDS (2026-09-12): the catalogue's classes compile into the generator's own inputs — an AIR LOOP per ducted
  //    parent (a UnitarySystem or a UnitaryHeatPump:WaterToAir) with the terminals on its Air out and the zones they feed, and
  //    a FLUID LOOP per WATER RING: the closed set of water lines through a pump, what produces (a ground heat exchanger, a
  //    boiler, a tower) and what consumes (the heat pump's coils). The ring is the user's own drawing of a loop ("a pump in
  //    the system connections either side of the flow direction"); an explicit PlantLoop / CondenserLoop card with the same
  //    things on its two sides reads the same. The wiring itself — branches, splitters, mixers, paths, nodes — is generated.
  const wiredLoops: LoopRuling[] = [];
  {
    const comps = asm.nodes.filter((n) => n.kind === "component");
    const cOf = (n: AsmNode): string => n.cls ?? "";
    const isAirParent = (c: string): boolean => c === "AirLoopHVAC:UnitarySystem" || c === "AirLoopHVAC:UnitaryHeatPump:WaterToAir";
    const isTerminal = (c: string): boolean => c.startsWith("AirTerminal:");
    const isPump = (c: string): boolean => /^(Pump:|HeaderedPumps:)/.test(c);
    const isLoopCard = (c: string): boolean => c === "PlantLoop" || c === "CondenserLoop";
    // a ground heat exchanger of any type (2026-09-14: the borefield, the slinky, the pond, the surface, the trench) stands on a condenser loop's supply
    const LOOP_OF_PRODUCER: Record<string, "CondenserLoop" | "PlantLoop"> = { "GroundHeatExchanger:System": "CondenserLoop", "GroundHeatExchanger:Slinky": "CondenserLoop", "GroundHeatExchanger:Pond": "CondenserLoop", "GroundHeatExchanger:Surface": "CondenserLoop", "GroundHeatExchanger:HorizontalTrench": "CondenserLoop", "CoolingTower:SingleSpeed": "CondenserLoop", "Boiler:HotWater": "PlantLoop" };
    const isProducer = (c: string): boolean => c in LOOP_OF_PRODUCER;
    const hasWaterSide = (c: string): boolean => isAirParent(c) || isPump(c) || isProducer(c) || isLoopCard(c);
    const compIds = new Set(comps.map((n) => n.id));
    const endMedium = (n: AsmNode | undefined, port: string | undefined): PortMedium | null => (!n ? null : n.kind === "component" ? portMediumOf(cOf(n), port ?? "") : ((PORTS[n.kind].find((q) => q.id === (port ?? ""))?.medium as PortMedium | undefined) ?? null));
    const edgeMedium = (e: AsmEdge): PortMedium | null => endMedium(byId.get(e.from), e.fromPort) ?? endMedium(byId.get(e.to), e.toPort);
    // the air side (2026-09-13): a parent feeds the Zone cards its Air out reaches, and each Zone carries its own damper — the
    // terminal object per zone is the Zone's word or the parent's default. A terminal CARD left on the sheet is refused and
    // folded by the button, never read.
    const airParents = comps.filter((n) => isAirParent(cOf(n)));
    for (const t of comps.filter((n) => isTerminal(cOf(n)))) refusals.push({ node: t.id, text: `${label(t)} is a terminal card: ${foldWord}` });
    const rulingOf = new Map<string, HvacRuling[]>();  // parent node id → its rulings: one, or one per thermostat (the split below)
    const coreOf = new Map<string, string>();         // heat-recovery core id → the parent it tempers outdoor air for
    for (const p of airParents) {
      const cls = cOf(p), unitary = cls === "AirLoopHVAC:UnitarySystem";
      const fed = drawn.zones.filter((z) => z.fedBy === p.id);
      const zoneCard = (zn: string): CompiledZone | undefined => drawn.zones.find((q) => q.name === zn);
      const zones: string[] = [], term: WiredAirLoop["terminals"] = [];
      for (const z of fed) {
        const zn = z.name;
        if (!zoneNames.includes(zn)) { refusals.push({ node: z.id, text: `"${zn}" is not a zone of the model` }); continue; }
        const other = zoneOf.get(zn);
        if (other && other !== p.id) { refusals.push({ node: z.id, text: `${zn} is served twice (${label(byId.get(other)!)} and ${label(p)}) — a zone is in at most one system` }); continue; }
        zoneOf.set(zn, p.id); zones.push(zn);
        term.push({ zone: zn, cls: z.terminal?.cls ?? defaultTerminalFor(cls), ...(z.terminal?.fields ? { fields: z.terminal.fields } : {}) });
      }
      if (!fed.length) refusals.push({ node: p.id, text: `${label(p)} reaches no zone — run its Air out to each Zone's Air in (the Zone carries the damper)` });
      // THE CONTROL (2026-09-13, read from the engine's source — the three it offers): SETPOINT when the unit feeds several
      // zones — every zone its own thermostat driving its own damper, the supply temperature reset to the neediest zone in the
      // mode in force (Warmest on the cooling coil's outlet, Coldest on the heating coil's) or held at a typed setpoint per mode, the
      // CHANGEOVER between the two on the zones' vote (the arbiter, the engine's own zoning-unit arithmetic), and the unit OFF while
      // every thermostat is satisfied (the user's controller, 2026-09-13 evening); SingleZoneVAV for one zone on a
      // VAV damper; Load for one zone on a constant-volume outlet. A UnitaryHeatPump:WaterToAir has no control field: Load on
      // ONE thermostat — the engine's HeatPump.idf shape — the other zones served, not controlled (the user's rule of 2026-09-12).
      const f = p.fields ?? {};
      const pick = (key: string, dflt: string): string => (typeof f[key] === "string" && f[key] ? String(f[key]) : dflt);
      const vav = term.some((t) => /VAV/.test(t.cls));
      const control = unitary ? pick("control_type", zones.length > 1 ? "SetPoint" : vav ? "SingleZoneVAV" : "Load") : "Load";
      const setPoint = unitary && control === "SetPoint";
      const tOn = zones.filter((z) => zoneCard(z)?.thermostat !== false);
      const uncontrolled = zones.filter((z) => !tOn.includes(z));
      let split = false;   // a WaterToAir heat pump on several thermostats → one unit per thermostat (below)
      if (setPoint) {
        // every zone reports; a T off leaves its damper at minimum with nothing to report — said on the Zone
        for (const z of uncontrolled) cautions.push({ node: zoneCard(z)!.id, text: `${z}'s thermostat is off under ${name(p)}'s SetPoint control — its damper holds minimum flow and it reports no demand; switch its T on to be served` });
        // a damper that cannot open for heating starves a heat pump's zone all winter (SingleDuct.cc:3489): refused, never softened
        for (const t of term) {
          if (t.cls === "AirTerminal:SingleDuct:VAV:NoReheat") refusals.push({ node: zoneCard(t.zone)!.id, text: `${t.zone}'s damper is "VAV damper, cooling only" (AirTerminal:SingleDuct:VAV:NoReheat), which holds its minimum flow on a heating call — a heat pump's zone heats through "VAV damper, opens for heating and cooling" (…:VAV:HeatAndCool:NoReheat, no coil in it): pick it in the Zone's settings` });
          else if (/ConstantVolume/.test(t.cls)) cautions.push({ node: zoneCard(t.zone)!.id, text: `${t.zone} takes a constant-volume outlet under ${name(p)}'s SetPoint control — its flow does not follow its thermostat` });
        }
      } else {
        // ONE THERMOSTAT PER UNIT under Load / SingleZoneVAV (measured 2026-09-12; the user's rule the same day: "thermostat off does
        // not mean unconditioned, just not controlled"): the unit follows the zone whose T is ON — its control zone — and every
        // other zone it feeds is served, not controlled, and gets no thermostat (HeatPump.idf: three zones, one unit, one thermostat)
        if (zones.length && !tOn.length) cautions.push({ node: p.id, text: `${name(p)} feeds ${zones.length === 1 ? zones[0] : `${zones.length} zones`} and none has its thermostat on — the unit follows ${zones[0]} (the first) until a Zone's T is switched on` });
        else if (tOn.length > 1 && unitary) cautions.push({ node: p.id, text: `${tOn.length} zones on ${name(p)} have their thermostat on (${tOn.join(", ")}) — under ${control} control the unit follows ONE; ${tOn[0]} is used, the rest are served as drawn. Set the control to SetPoint for a thermostat in every zone, or switch the others' T off.` });
        else if (tOn.length > 1) split = true;
        else if (uncontrolled.length) notes.push(`${name(p)} follows ${tOn[0]}; ${uncontrolled.join(", ")} ${uncontrolled.length === 1 ? "is" : "are"} served, not controlled`);
      }
      // the parts: the parent's own field names the class when the user picked one in its settings (the engine's enum), else the
      // STATED default — the VARIABLE-SPEED water-to-air coils (the speed set read from the engine's own example and autosized;
      // the single-speed EquationFit pair a pick away), an electric supplemental coil, and the fan: Fan:VariableVolume under
      // SetPoint (the schema's own note: "Specify a Fan:SystemModel or a Fan:VariableVolume when modeling VAV systems which
      // used setpoint based control"), Fan:OnOff otherwise
      const wired: WiredAirLoop = {
        parent: cls,
        fan: { cls: pick(unitary ? "supply_fan_object_type" : "supply_air_fan_object_type", setPoint ? "Fan:VariableVolume" : "Fan:OnOff") },
        cooling: { cls: pick("cooling_coil_object_type", "Coil:Cooling:WaterToAirHeatPump:VariableSpeedEquationFit") },
        heating: { cls: pick("heating_coil_object_type", "Coil:Heating:WaterToAirHeatPump:VariableSpeedEquationFit") },
        // the supplemental heater switched off on the card (2026-09-14): the parent requires one, so it is written never available
        supplemental: { cls: pick("supplemental_heating_coil_object_type", "Coil:Heating:Electric"), ...(f[SUPPLEMENTAL_FIELD] === "none" ? { fields: { availability_schedule_name: "@never" } } : {}) },
        controlZone: setPoint ? "" : pick("controlling_zone_or_thermostat_location", tOn[0] ?? zones[0] ?? ""),
        terminals: term,
      };
      if (uncontrolled.length) wired.uncontrolled = uncontrolled;
      if (unitary) wired.control = control;
      if (setPoint) {
        // THE CONTROLLER (user, 2026-09-13, evening): "receives a cooling or heating mode signal (based on polling) with setpoints per
        // mode; if all thermostats are satisfied the unit stops" — a supply setpoint typed per mode is HELD (a Scheduled manager on a
        // constant); blank, the coil resets to the neediest zone (Warmest / Coldest); the vote defaults to the count of zones calling
        const csp = f[SUPPLY_SETPOINT_FIELD.cooling], hsp = f[SUPPLY_SETPOINT_FIELD.heating];
        wired.setpoints = { cooling: typeof csp === "number" ? "Scheduled" : "Warmest", heating: typeof hsp === "number" ? "Scheduled" : "Coldest" };
        if (typeof csp === "number") wired.setpoints.coolingSupplyC = csp;
        if (typeof hsp === "number") wired.setpoints.heatingSupplyC = hsp;
        const co = String(f.changeover ?? "");
        wired.changeover = (CHANGEOVERS.some((c) => c.id === co) ? co : "ZonePriority") as NonNullable<WiredAirLoop["changeover"]>;
      }
      if (wired.controlZone && !zones.includes(wired.controlZone)) refusals.push({ node: p.id, text: `${label(p)}'s control zone "${wired.controlZone}" is not a zone it serves` });
      // the coil MODEL (2026-09-14): the parent's three; ParameterEstimation is rated by parameters no dataset states — the generator refuses it by name
      if (/ParameterEstimation$/.test(wired.cooling.cls) || /ParameterEstimation$/.test(wired.heating.cls)) refusals.push({ node: p.id, text: `${label(p)}'s coil model ParameterEstimation is rated by the unit's own physical parameters that no dataset here states — pick EquationFit or VariableSpeedEquationFit` });
      // CoolReheat dehumidification (2026-09-14): a humidistat in the control zone, the supplemental coil reheating — said on the card
      if (f.dehumidification_control_type === "CoolReheat") {
        if (f[SUPPLEMENTAL_FIELD] === "none") refusals.push({ node: p.id, text: `${label(p)}: CoolReheat dehumidification reheats with the supplemental coil — switch the supplemental heater on, or set dehumidification to None` });
        else if (setPoint) refusals.push({ node: p.id, text: `${label(p)}: CoolReheat dehumidification needs one control zone for its humidistat — not under SetPoint control` });
        else cautions.push({ node: p.id, text: `${name(p)} dehumidifies (CoolReheat): a humidistat is written in ${split ? "each unit's zone" : wired.controlZone || "the control zone"}, dehumidifying at ${typeof f[DEHUMIDIFY_RH_FIELD] === "number" ? f[DEHUMIDIFY_RH_FIELD] : DEHUMIDIFY_RH_DEFAULT.percent} % RH (the input on the card), never humidifying; the cooling coil runs past the dry-bulb setpoint and the supplemental coil reheats` });
      }
      // THE OUTDOOR-AIR CORE (user, 2026-09-13): a static heat-recovery core whose SUPPLY outlet runs to this parent's OA in becomes an
      // outdoor-air system ahead of the unit — the core first, the mixer, the controller, the outdoor node — all generated; its
      // outdoor-air inlet is the outdoor node and its exhaust side is the unit's relief, so nothing lands on those connectors
      const oaLines = asm.edges.filter((e) => e.to === p.id && e.toPort === "outdoor_air_inlet_node_name").map((e) => ({ e, n: byId.get(e.from) })).filter((x): x is { e: AsmEdge; n: AsmNode } => !!x.n);
      const cores = oaLines.filter((x) => x.n.kind === "component" && cOf(x.n) === "HeatExchanger:AirToAir:SensibleAndLatent");
      for (const x of oaLines) if (!cores.includes(x)) refusals.push({ node: x.n.id, text: `${label(x.n)} feeds ${label(p)}'s outdoor air — only a heat-recovery core (HeatExchanger:AirToAir:SensibleAndLatent) does, from its supply outlet (Air out)` });
      for (const x of cores.slice(1)) refusals.push({ node: x.n.id, text: `${label(p)} takes outdoor air through ${cores.length} cores — one` });
      const core = cores[0];
      if (core) {
        if (core.e.fromPort !== "supply_air_outlet_node_name") refusals.push({ node: core.n.id, text: `${label(core.n)} feeds ${label(p)} from its ${core.e.fromPort?.replace(/_node_name$/, "").replace(/_/g, " ")} — the SUPPLY outlet (Air out, the outdoor air it tempered) runs to a unit's OA in; its exhaust side is the unit's relief, generated` });
        else { wired.oa = { core: { cls: cOf(core.n), ...(core.n.fields ? { fields: core.n.fields } : {}) }, coreId: core.n.id }; coreOf.set(core.n.id, p.id); }
      }
      // ONE HEAT PUMP PER THERMOSTAT (the user's ruling, 2026-09-13 night, from the I/O reference — one controlling thermostat per
      // AirLoopHVAC:UnitaryHeatPump:WaterToAir): a WaterToAir card on several T-on zones is written as ONE UNIT PER ZONE, named this
      // card + the zone, each with the card's settings (its fields, its fan and coils, its water side on the card's ring, its
      // outdoor-air core if drawn), each following its own zone's thermostat through the damper the Zone carries. A T-off zone
      // rides on the first unit, served and not controlled, as before. The card carries the clarification note — a caution, never
      // a refusal — and rulingIds names the first unit; splitIds names them all.
      const units: HvacRuling[] = [];
      if (split) {
        for (const zn of tOn) {
          const first = zn === tOn[0], mine = first ? [zn, ...uncontrolled] : [zn];
          // the convergence of each unit's part-load iteration: 1/n, the reciprocal of the number of identical units (the user's rule, 2026-09-14),
          // unless the card types its own (a typed field rides on every unit through its fields)
          const w: WiredAirLoop = { ...wired, controlZone: zn, terminals: term.filter((t) => mine.includes(t.zone)), convergence: Number((1 / tOn.length).toPrecision(6)) };
          delete w.uncontrolled;
          if (first && uncontrolled.length) w.uncontrolled = uncontrolled;
          const u: HvacRuling = { id: ruleIdFor(`${name(p)} ${zn}`), kind: cls as HvacKind, zones: mine, wired: w };
          if (Object.keys(f).length) u.fields = f;
          units.push(u);
        }
        cautions.push({ node: p.id, text: `EnergyPlus only allows one controlling thermostat per unitary heat pump, so separate heat pump systems will be created for each separate zone with thermostat control: ${units.map((u) => u.id).join(", ")} — each with this card's settings${uncontrolled.length ? `; ${uncontrolled.join(", ")} (T off) ${uncontrolled.length === 1 ? "rides" : "ride"} on ${units[0]!.id}, served and not controlled` : ""}` });
        splitIds[p.id] = units.map((u) => u.id);
      } else {
        const h: HvacRuling = { id: ruleId(p), kind: cls as HvacKind, zones, wired };
        if (Object.keys(f).length) h.fields = f;
        units.push(h);
      }
      rulingOf.set(p.id, units);
      rulingIds[p.id] = units[0]!.id;
      if (core && wired.oa) rulingIds[core.n.id] = units[0]!.id;
      hvac.push(...units);
    }
    // a core on nothing, or with a line on a connector the generator fills, is named
    for (const n of comps.filter((x) => cOf(x) === "HeatExchanger:AirToAir:SensibleAndLatent")) {
      if (!coreOf.has(n.id)) refusals.push({ node: n.id, text: `${label(n)} is on no unit — run its Air out (the supply it tempered) to a unitary system's or heat pump's OA in; its outdoor-air inlet and its exhaust side are generated` });
      for (const e of asm.edges.filter((x) => (x.from === n.id && x.fromPort !== "supply_air_outlet_node_name") || x.to === n.id)) {
        const port = (e.from === n.id ? e.fromPort : e.toPort) ?? "";
        refusals.push({ node: n.id, text: `${label(n)}'s ${port.replace(/_node_name$/, "").replace(/_/g, " ")} is generated — its outdoor-air inlet is the outdoor node, its exhaust side the unit's relief air; take the line off it` });
      }
    }
    // the water side: the connected sets of water lines among the component cards — each one loop
    const waterNodes = comps.filter((n) => hasWaterSide(cOf(n)));
    const waterEdges = asm.edges.filter((e) => compIds.has(e.from) && compIds.has(e.to) && edgeMedium(e) === "wtr");
    const groupOf = new Map<string, number>();
    let g = 0;
    for (const n of waterNodes) {
      if (groupOf.has(n.id)) continue;
      const stack = [n.id]; groupOf.set(n.id, g);
      while (stack.length) {
        const id = stack.pop()!;
        for (const e of waterEdges) {
          const o = e.from === id ? e.to : e.to === id ? e.from : null;
          if (o && !groupOf.has(o) && waterNodes.some((w) => w.id === o)) { groupOf.set(o, g); stack.push(o); }
        }
      }
      g++;
    }
    for (let k = 0; k < g; k++) {
      const members = waterNodes.filter((n) => groupOf.get(n.id) === k);
      const loopCards = members.filter((n) => isLoopCard(cOf(n))), pumps = members.filter((n) => isPump(cOf(n)));
      const producers = members.filter((n) => isProducer(cOf(n))), consumers = members.filter((n) => isAirParent(cOf(n)));
      const ring = members.map(label).join(", ");
      if (members.length === 1) {
        const n = members[0]!, c = cOf(n);
        refusals.push({ node: n.id, text: `${label(n)}'s water side is connected to nothing — ${isProducer(c) ? "run its water to what it serves, with a pump in the ring" : isPump(c) ? "put it in a water ring between a source and what it serves" : isLoopCard(c) ? "connect a source and a pump to its supply side and what it serves to its demand side" : "run its water side to a ground heat exchanger, a boiler or a loop, with a pump in the ring"}` });
        continue;
      }
      if (loopCards.length > 1) { for (const n of loopCards.slice(1)) refusals.push({ node: n.id, text: `${label(n)} is a second loop card on one water ring (${ring}) — one loop per ring` }); continue; }
      const card = loopCards[0] ?? null;
      if (card) for (const e of waterEdges.filter((x) => x.from === card.id || x.to === card.id)) {
        const port = e.from === card.id ? e.fromPort ?? "" : e.toPort ?? "", other = byId.get(e.from === card.id ? e.to : e.from)!;
        const supplySide = /^(plant_side|condenser_side)/.test(port), producer = isProducer(cOf(other)) || isPump(cOf(other));
        if (producer && !supplySide) refusals.push({ node: other.id, text: `${label(other)} produces — connect it to ${label(card)}'s SUPPLY side (its plant-side connectors)` });
        else if (!producer && supplySide) refusals.push({ node: other.id, text: `${label(other)} consumes — connect it to ${label(card)}'s DEMAND side` });
      }
      if (!pumps.length) for (const n of [...producers, ...(producers.length ? [] : consumers)]) refusals.push({ node: n.id, text: `the water ring through ${ring} has no pump — drop a Pump card into it, either side of the flow` });
      if (pumps.length > 1) for (const n of pumps.slice(1)) refusals.push({ node: n.id, text: `the water ring through ${ring} has ${pumps.length} pumps — the generator puts one on the supply inlet branch; take the others out` });
      if (!producers.length) for (const n of consumers) refusals.push({ node: n.id, text: `the water ring through ${ring} has no source — a ground heat exchanger, a boiler or a cooling tower belongs on it` });
      if (!consumers.length) for (const n of producers) refusals.push({ node: n.id, text: `the water ring through ${ring} serves nothing — a heat pump's water side belongs on it` });
      if (!pumps.length || !producers.length || !consumers.length) continue;   // refused above; nothing written for the ring
      const cls: LoopRuling["cls"] = card ? (cOf(card) as LoopRuling["cls"]) : producers.every((n) => LOOP_OF_PRODUCER[cOf(n)] === "CondenserLoop") ? "CondenserLoop" : "PlantLoop";
      const id = card ? ruleId(card) : ruleIdFor(`${name(producers[0]!)} loop`);
      // the pump's zone (2026-09-14): its Loc line names the Zone its skin losses go to — the engine's own optional field
      const pumpFields: SystemFields = { ...(pumps[0]!.fields ?? {}), ...(drawn.locations[pumps[0]!.id] ? { zone_name: drawn.locations[pumps[0]!.id]! } : {}) };
      const L: LoopRuling = { id, cls, pump: { cls: cOf(pumps[0]!), ...(Object.keys(pumpFields).length ? { fields: pumpFields } : {}) }, producers: producers.map((n) => ({ cls: cOf(n), name: name(n), ...(n.fields ? { fields: n.fields } : {}) })), consumers: [] };
      if (card?.fields) L.fields = card.fields;
      for (const c of consumers) for (const h of rulingOf.get(c.id) ?? []) if (h.wired) { h.wired.loop = id; L.consumers.push(h.id); }
      for (const m of members) if (!isAirParent(cOf(m))) rulingIds[m.id] = id;
      wiredLoops.push(L);
    }
    for (const p of airParents) { const hs = rulingOf.get(p.id) ?? []; if (hs.some((h) => h.wired && !h.wired.loop) && !refusals.some((r) => r.node === p.id && /water/.test(r.text))) refusals.push({ node: p.id, text: `${label(p)}'s coils take water and it is on no water ring — run its water side through a pump to a ground heat exchanger` }); }
    // every other catalogue class: named, not yet written
    for (const n of comps) {
      const c = cOf(n);
      if (isAirParent(c) || isTerminal(c) || isPump(c) || isProducer(c) || isLoopCard(c) || c === "HeatExchanger:AirToAir:SensibleAndLatent") continue;
      if (c === "HeatExchanger:FluidToFluid") { refusals.push({ node: n.id, text: `${label(n)} ${GHX_TYPES.find((t) => t.cls === c)?.refused ?? "is not written yet"}` }); continue; }
      if (/^(Coil:|Fan:(?!ZoneExhaust))/.test(c)) refusals.push({ node: n.id, text: `${c} is not written as a card — a unitary system's or heat pump's settings pick its fan and coils (cooling_coil_object_type, heating_coil_object_type, supply fan); take the loose card off the sheet` });
      else refusals.push({ node: n.id, text: `${c} is drawn but not written yet — the air loop, its terminals, the pump, the ground heat exchanger and the loop cards reach the IDF; zone equipment and heat recovery are the next slice` });
    }
  }
  for (const n of asm.nodes) {
    const nb = neighbours(asm, n.id);
    if (n.kind === "boiler" && !nb.some((x) => isLoop(x.kind))) refusals.push({ node: n.id, text: `${label(n)} is on no loop — connect it to a hot-water or mixed-water loop's supply side` });
    if (n.kind === "tower" && !nb.some((x) => x.kind === "mwloop")) refusals.push({ node: n.id, text: `${label(n)} is on no loop — connect it to a mixed-water loop's supply side` });
    if (n.kind === "doas" && !drawn.zones.some((z) => z.oaFrom === n.id)) refusals.push({ node: n.id, text: `${label(n)} ventilates no zone — run its Air out to the Zones it serves (their PTHP, PTAC, WSHP or baseboard takes it)` });
    if (isLoop(n.kind) && !(loops.get(n.id)?.demand.size)) refusals.push({ node: n.id, text: `${label(n)} has nothing on its demand side — connect what it serves there` });
    // a RESOURCE is carried on its loop and REFUSED with the reason until the plant loop is written in full: none of the three is an HVACTemplate object
    if (isResource(n.kind)) {
      if (!nb.some((x) => isLoop(x.kind))) refusals.push({ node: n.id, text: `${label(n)} is on no loop — connect it to a loop's supply side` });
      else refusals.push({ node: n.id, text: `${label(n)} (${NODE_CLASS[n.kind]}) is not an HVACTemplate object — carried on the loop, written when the plant loop is written in full (tier 2); the loop runs on its boiler and tower until then` });
    }
  }
  for (const [z, ids] of Object.entries(assign)) for (const id of ids) if (!byId.has(id)) notes.push(`${z}: assigned to a node no longer on the sheet (${id})`);
  // ventilation
  let ventilation: VentilationRuling | undefined;
  const wh = asm.nodes.filter((n) => n.kind === "wholehouse");
  if (wh.length > 1) refusals.push({ node: wh[1]!.id, text: "one whole-house ventilation node is enough — the rate is for the house" });
  if (wh[0]) {
    const n = wh[0], v = n.vent ?? { kind: "Exhaust" as const };
    const zs = zonesOf(assign, n.id).filter((z) => zoneNames.includes(z));
    const hr = (n.attached ?? []).find((a) => a.startsWith("hr-"));
    ventilation = { wholeHouse: { kind: hr ? "HeatRecovery" : v.kind, recovery: hr === "hr-enthalpy" ? "Enthalpy" : hr === "hr-sensible" ? "Sensible" : v.recovery, bedrooms: v.bedrooms, cfaM2: v.cfaM2, fields: n.fields, zones: zs.length ? zs : undefined, from: n.from } };
  }
  const ex = asm.nodes.filter((n) => n.kind === "exhaust");
  const local: NonNullable<VentilationRuling["local"]> = [];
  for (const n of ex) {
    const zs = zonesOf(assign, n.id).filter((z) => zoneNames.includes(z));
    if (!zs.length) refusals.push({ node: n.id, text: `${label(n)} exhausts no zone — assign one in ZONES` });
    for (const z of zs) local.push({ id: `${n.id}:${z}`, zone: z, cfm: n.vent?.cfm, from: n.from });
  }
  if (local.length) ventilation = { ...(ventilation ?? {}), local };
  // AN EXPECTED SIDE SWITCHED OFF (the user, 2026-10-06: Office/Bed2's heating off on a heat pump that heats): a Zone card whose equipment
  // can heat or cool, with that side unchecked, is said on the card — the zone will not be heated (or cooled) unless the side is checked
  for (const r of hvac) {
    const cap = capabilityOf(r.kind, r.fields);
    for (const z of r.zones) {
      const card = drawn.zones.find((x) => x.name === z), f = card ? asm.nodes.find((n) => n.id === card.id)?.fields ?? {} : {};
      if (!card) continue;
      const off = [cap.heat && f[THERMOSTAT_SIDE_FIELD.heating] === "off" ? "heating" : "", cap.cool && f[THERMOSTAT_SIDE_FIELD.cooling] === "off" ? "cooling" : ""].filter(Boolean);
      if (off.length && !cautions.some((c) => c.node === card.id && /switched off on this Zone card/.test(c.text)))
        cautions.push({ node: card.id, text: `${z}: ${off.join(" and ")} switched off on this Zone card, though ${r.id} can ${off.map((x) => (x === "heating" ? "heat" : "cool")).join(" and ")} — the zone will not be ${off.map((x) => (x === "heating" ? "heated" : "cooled")).join(" or ")}. Check ${off.join(" and ")} on the card if it should be.` });
    }
  }
  return { hvac, ventilation, loops: wiredLoops, refusals, cautions, notes, zoneOf, zones: drawn.zones, roomZone: drawn.roomZone, rulingIds, splitIds, locations: drawn.locations };
}
/** THE CHANGEOVER RULES (2026-09-13) — the engine's own four words, from its zoning unit's `priority_control_mode`, in the user's words */
/** THE SUPPLEMENTAL HEATER's switch on a heat-pump card (user, 2026-09-14: "a checkbox to disable inputs if no supplemental heater is
 *  involved"): the field carries `none`; the parent class requires a supplemental coil, so it is written with an availability of 0 */
export const SUPPLEMENTAL_FIELD = "supplemental_heater";
/** THE COIL MODELS of a water-to-air heat pump (the parent's own three, 2026-09-14) — one select on the card sets both coils' object types */
export const COIL_MODELS: ReadonlyArray<{ id: "EquationFit" | "VariableSpeedEquationFit" | "ParameterEstimation"; label: string; sub: string; refused?: string }> = [
  { id: "VariableSpeedEquationFit", label: "Variable speed, equation fit", sub: "a curve-fit model rated speed by speed (the engine's example's 10-speed set, the nominal level autosized): the unit modulates air and water flow with the load — the WaterFurnace 7 Series' shape; the default" },
  { id: "EquationFit", label: "Single speed, equation fit", sub: "a curve-fit model rated at one point (the dataset's ClimateMaster GLHP curves, capacity autosized): the compressor cycles on and off against the load" },
  { id: "ParameterEstimation", label: "Parameter estimation", sub: "a physical model from the unit's own compressor, heat-exchanger and refrigerant parameters (Jin & Spitler); it needs a parameter set no dataset here states", refused: "not written — needs the unit's parameter set; pick one of the equation-fit models" },
];
export const coilModelOf = (cls: string | undefined): (typeof COIL_MODELS)[number]["id"] | null => { const m = /WaterToAirHeatPump:(\w+)$/.exec(cls ?? ""); return m ? (m[1] as (typeof COIL_MODELS)[number]["id"]) : null; };
/** the supply setpoint a unit card may state per mode (°C in the fields, the user's units at the eye): typed = held; blank = reset to the neediest zone */
export const SUPPLY_SETPOINT_FIELD = { cooling: "supply_setpoint_cooling_c", heating: "supply_setpoint_heating_c" } as const;
export const CHANGEOVERS: ReadonlyArray<{ id: NonNullable<WiredAirLoop["changeover"]>; label: string; sub: string }> = [
  { id: "ZonePriority", label: "by the number of zones calling", sub: "the mode more zones ask for; a tie goes to the larger total demand, then to heating (the user's controller, 2026-09-13)" },
  { id: "LoadPriority", label: "by total demand", sub: "the mode whose zones ask for more heat or cold in total; a tie goes to the count of zones, then to heating" },
  { id: "CoolingPriority", label: "cooling whenever any zone calls", sub: "cooling as soon as one zone asks for it" },
  { id: "HeatingPriority", label: "heating whenever any zone calls", sub: "heating as soon as one zone asks for it" },
];
/** THE TERMINAL CARDS FOLD INTO THEIR ZONES (user, 2026-09-13: the damper lives inside the Zone card). A terminal card with one
 *  air line in from a ducted parent and one out to a Zone is folded: the card removed, the parent's line drawn to the Zone's
 *  Air in, the damper's class and fields taken onto the Zone; an older sheet's template terminal folds the same way, its
 *  ZONES-tab assignments re-pointed to its air loop. Pressed by the user — a button that names what it folds; the load never
 *  rewrites a drawing. A card that is not simply between one parent and one Zone is left and named. */
export function foldTerminals(asm: Assembly, assign: ZoneAssign = {}): { asm: Assembly; assign: ZoneAssign; folded: string[]; left: string[] } {
  const byId = new Map(asm.nodes.map((n) => [n.id, n]));
  const isTerm = (n: AsmNode): boolean => n.kind === "terminal" || (n.kind === "component" && (n.cls ?? "").startsWith("AirTerminal:"));
  const isParent = (n: AsmNode): boolean => (n.kind === "component" ? n.cls === "AirLoopHVAC:UnitarySystem" || n.cls === "AirLoopHVAC:UnitaryHeatPump:WaterToAir" : isAirLoop(n.kind));
  let out = asm;
  const nextAssign: ZoneAssign = JSON.parse(JSON.stringify(assign)) as ZoneAssign;
  const folded: string[] = [], left: string[] = [];
  for (const t of asm.nodes.filter(isTerm)) {
    const ins = asm.edges.filter((e) => e.to === t.id), outs = asm.edges.filter((e) => e.from === t.id);
    const parent = ins.length === 1 ? byId.get(ins[0]!.from) : undefined, zone = outs.length === 1 ? byId.get(outs[0]!.to) : undefined;
    if (!parent || !isParent(parent) || !zone || zone.kind !== "zone") { left.push(t.ident?.trim() || t.label || t.id); continue; }
    const fromPort = ins[0]!.fromPort ?? (parent.kind === "component" ? "air_outlet_node_name" : "air-out");
    out = { ...out, nodes: out.nodes.filter((n) => n.id !== t.id), edges: out.edges.filter((e) => e.from !== t.id && e.to !== t.id) };
    out = addEdge(out, parent.id, zone.id, fromPort, "air-in");
    if (t.kind === "component" && t.cls) {
      const tCls = t.cls, tf = t.fields ?? {};
      out = patchNode(out, zone.id, (z) => {
        const fz: SystemFields = { ...(z.fields ?? {}) };
        fz[TERMINAL_FIELD.cls] = tCls;
        if (tf.maximum_air_flow_rate !== undefined) fz[TERMINAL_FIELD.maxFlow] = tf.maximum_air_flow_rate;
        const mf = tf.zone_minimum_air_flow_fraction ?? tf.constant_minimum_air_flow_fraction;
        if (mf !== undefined) fz[TERMINAL_FIELD.minFraction] = mf;
        return { ...z, fields: fz };
      });
    }
    for (const [z, ids] of Object.entries(nextAssign)) if (ids.includes(t.id)) nextAssign[z] = [...new Set(ids.map((x) => (x === t.id ? parent.id : x)))];
    folded.push(t.ident?.trim() || t.label || t.id);
  }
  return { asm: out, assign: nextAssign, folded, left };
}
/** an assembly with only the kinds this build knows (a ledger written by an earlier build may carry others — dropped, never
 *  drawn) and only the CONNECTORS this build draws: a line on a connector a card no longer has is moved to what it meant, or
 *  dropped — each named in `notes` when the caller wants them (2026-09-13: zone-contained cards lost their air connectors) */
export function sanitizeAssembly(asm: Assembly, notes?: string[]): Assembly {
  const nodes = asm.nodes.filter((n) => n.kind in NODE_LABEL);
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nm = (n: AsmNode): string => n.ident?.trim() || n.label || NODE_LABEL[n.kind];
  const hasPort = (n: AsmNode, id: string | undefined): boolean => n.kind === "component" || id === undefined || PORTS[n.kind].some((q) => q.id === id);
  const edges: AsmEdge[] = [];
  for (const e of asm.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    if (hasPort(a, e.fromPort) && hasPort(b, e.toPort)) { edges.push(e); continue; }
    // a line from zone equipment's old Air out into a Zone's Air in said "this unit serves that zone" — its Loc says so now
    if (!hasPort(a, e.fromPort) && b.kind === "zone" && (e.toPort ?? "air-in") === "air-in" && PORTS[a.kind].some((q) => q.id === "loc-out")) {
      edges.push({ id: e.id, from: e.from, to: e.to, fromPort: "loc-out", toPort: "loc-in" });
      notes?.push(`${nm(a)} → ${nm(b)}: the air line became a Loc line (zone equipment joins its zone by its Loc connector)`);
      continue;
    }
    // a DOAS into zone equipment's old OA connector now runs to the Zone that equipment serves
    if (a.kind === "doas" && !hasPort(b, e.toPort)) {
      const zl = asm.edges.find((x) => x.from === b.id && byId.get(x.to)?.kind === "zone");
      if (zl) { edges.push({ id: e.id, from: a.id, to: zl.to, fromPort: "air-out", toPort: "air-in" }); notes?.push(`${nm(a)} → ${nm(b)}: the outdoor-air line now runs to ${nm(byId.get(zl.to)!)}, the zone it ventilates`); continue; }
    }
    notes?.push(`${nm(a)} → ${nm(b)}: a line on a connector this build no longer draws — dropped`);
  }
  return { ...asm, nodes, edges };
}
// ── SAVED (user, 2026-09-10: "How do we save the system diagram? It should be saved in a database (idf db Systems), and the Apply
// button should be Save button"): the sheet goes to the BEM ledger keyed to the file (its source, replayed on every load) AND into
// idf.db's system_components / system_connectors / system_zones — one row per component, connector and zone assignment — through
// these two functions, so the rows and the sheet never drift.
export function diagramRows(asm: Assembly, assign: ZoneAssign): SystemsDiagramRows {
  const j = (x: unknown): string | null => (x === undefined ? null : JSON.stringify(x));
  return {
    components: asm.nodes.map((n) => ({ id: n.id, kind: n.kind, ident: n.ident ?? null, label: n.label ?? null, x: n.x, y: n.y, fields: j(n.fields), attached: j(n.attached), vent: j(n.vent), fromFile: j(n.from), rooms: j(n.rooms), collapsed: n.collapsed ? 1 : 0, cls: n.cls ?? null, thermostat: n.thermostat === false ? 0 : 1 })),
    connectors: asm.edges.map((e) => ({ id: e.id, fromId: e.from, fromPort: e.fromPort ?? null, toId: e.to, toPort: e.toPort ?? null, points: j(e.points) })),
    zones: Object.entries(assign).flatMap(([zone, ids]) => ids.map((component) => ({ zone, component }))),
    rooms: asm.nodes.filter((n) => n.kind === "zone").flatMap((n) => (n.rooms ?? []).map((room) => ({ room, component: n.id }))),
  };
}
/** the sheet read back from the rows — a kind the palette no longer has is dropped with its connectors, as on any load */
export function diagramFromRows(d: SystemsDiagramRows): { assembly: Assembly; assign: ZoneAssign } {
  const p = <T,>(s: string | null): T | undefined => (s === null ? undefined : (JSON.parse(s) as T));
  const nodes: AsmNode[] = d.components.map((c) => {
    const n: AsmNode = { id: c.id, kind: c.kind as NodeKind, x: c.x, y: c.y };
    if (c.label !== null) n.label = c.label;
    if (c.ident !== null) n.ident = c.ident;
    const fields = p<SystemFields>(c.fields); if (fields) n.fields = fields;
    const attached = p<AttachKind[]>(c.attached); if (attached) n.attached = attached;
    const vent = p<AsmNode["vent"]>(c.vent); if (vent) n.vent = vent;
    const from = p<FromFile>(c.fromFile); if (from) n.from = from;
    const rooms = p<string[]>(c.rooms); if (rooms?.length) n.rooms = rooms;
    if (c.collapsed) n.collapsed = true;
    if (c.cls !== null) n.cls = c.cls;
    if (c.thermostat === 0) n.thermostat = false;
    return n;
  });
  const edges: AsmEdge[] = d.connectors.map((k) => {
    const e: AsmEdge = { id: k.id, from: k.fromId, to: k.toId };
    if (k.fromPort !== null) e.fromPort = k.fromPort;
    if (k.toPort !== null) e.toPort = k.toPort;
    const points = p<XY[]>(k.points); if (points) e.points = points;
    return e;
  });
  const assign: ZoneAssign = {};
  for (const z of d.zones) (assign[z.zone] ??= []).push(z.component);
  return { assembly: sanitizeAssembly({ nodes, edges }), assign };
}
/** what a Save writes that the last Save did not: a component added, removed or changed in any way (a move, an ID, a field, an
 *  attachment), a connector likewise, a zone whose assignment moved — each one change, named */
export function diagramDiff(stage: SystemsRuling, applied: SystemsRuling | undefined): { pending: number; words: string[] } {
  const j = (x: unknown): string => JSON.stringify(x ?? null);
  const sa = stage.assembly ?? { nodes: [], edges: [] }, aa = applied?.assembly ?? { nodes: [], edges: [] };
  const nm = (n: AsmNode): string => n.ident?.trim() || n.label || NODE_LABEL[n.kind];
  const words: string[] = [];
  for (const id of new Set([...sa.nodes.map((n) => n.id), ...aa.nodes.map((n) => n.id)])) {
    const s = sa.nodes.find((n) => n.id === id), a = aa.nodes.find((n) => n.id === id);
    if (j(s) !== j(a)) words.push(!a ? `+ ${nm(s!)}` : !s ? `− ${nm(a)}` : `~ ${nm(s)}`);
  }
  for (const id of new Set([...sa.edges.map((e) => e.id), ...aa.edges.map((e) => e.id)])) {
    const s = sa.edges.find((e) => e.id === id), a = aa.edges.find((e) => e.id === id);
    if (j(s) !== j(a)) words.push(!a ? "+ a connector" : !s ? "− a connector" : "~ a connector");
  }
  const sz = stage.assign ?? {}, az = applied?.assign ?? {};
  for (const z of new Set([...Object.keys(sz), ...Object.keys(az)])) if (j(sz[z]) !== j(az[z])) words.push(`zone ${z}`);
  // THE SAME SHEET, COMPILED DIFFERENTLY (2026-09-13 night): the rulings ride on the saved sheet as compiled at its Save, so when this
  // build compiles the unchanged sheet to other rulings (a WaterToAir card split into a unit per thermostat) Save has a change to
  // write although no card moved — named, so the model is never left on the old rulings without a word
  if (!words.length && applied && (j(stage.hvac) !== j(applied.hvac) || j(stage.loops) !== j(applied.loops))) words.push(`~ the rulings the sheet compiles to under this build: ${(stage.hvac ?? []).map((h) => h.id).join(", ") || "none"} — Save writes them`);
  return { pending: words.length, words };
}
/** a stage as it was saved (the ledger's or the journal's): the assembly limited to the kinds this build draws, the
 *  assignment pruned to it, the compiled parts KEPT — seeding never recompiles against a model that is not there yet
 *  (2026-09-10: it did, against no zones, and the next edit wrote the emptied zones back over the disk) */
export function sanitizeStage(st: SystemsRuling, notes?: string[]): SystemsRuling {
  if (!st.assembly) return st;
  const asm = sanitizeAssembly(st.assembly, notes);
  const a = pruneAssign(st.assign ?? {}, asm);
  const next: SystemsRuling = { ...st, assembly: asm };
  if (Object.keys(a).length) next.assign = a; else delete next.assign;
  return next;
}
/** the stage with the assembly and what it compiles to (the rulings the writer reads) — one function, so the two never drift */
export function stageAssembly(stage: SystemsRuling, asmIn: Assembly, zoneNames: string[], assign?: ZoneAssign): SystemsRuling {
  const asm = sanitizeAssembly(asmIn);
  const a = pruneAssign(assign ?? stage.assign ?? {}, asm);
  const c = compileAssembly(asm, zoneNames, a);
  const next: SystemsRuling = { ...stage, assembly: asm };
  if (Object.keys(a).length) next.assign = a; else delete next.assign;
  if (c.hvac.length) next.hvac = c.hvac; else delete next.hvac;
  if (c.ventilation) next.ventilation = c.ventilation; else delete next.ventilation;
  if (c.loops.length) next.loops = c.loops; else delete next.loops;
  return next;
}

// ── ROUTING: a Visio-like connector — orthogonal, a thick stub out of the port, the corners the sheet routes or the user drags.
// The corners between the two stubs ALTERNATE: the line leaves the source stub's end level (H), turns (V), runs (H) … and
// enters the target stub level (H) — so a corner set has an even count, the segment j between the stubs is H when j is even
// and V when j is odd, and a joint on a V segment shifts its x, on an H segment its y. The ends are PINNED to the stubs at
// every render, so a node that moves carries its lines' ends with it and nothing goes diagonal (user, 2026-09-10: "clean up
// on lines to maintain orthogonal"); a segment collapsed to a point takes its partner with it, two collinear runs becoming
// one; an END segment, tied to its port, is dragged into a JOG — two corners more, the pattern kept.
export type XY = [number, number];
export const STUB = 20;
/** the direction a stub leaves its port — a left/right port runs horizontally, a TOP port (the location connector) upward.
 *  A boolean still reads as it always did: true = right, false = left, so every caller written before the top edge existed
 *  keeps its meaning. */
export type Dir = "left" | "right" | "up" | "down";
export type DirLike = Dir | boolean;
export const asDir = (d: DirLike): Dir => (typeof d === "boolean" ? (d ? "right" : "left") : d);
const horiz = (d: Dir): boolean => d === "left" || d === "right";
const stepOf = (d: Dir): XY => (d === "right" ? [STUB, 0] : d === "left" ? [-STUB, 0] : d === "up" ? [0, -STUB] : [0, STUB]);
/** run i of the polyline (0 = out of the source stub) lies along the SOURCE's axis when i is even and across it when odd */
const runH = (sDir: Dir, i: number): boolean => (horiz(sDir) ? i % 2 === 0 : i % 2 === 1);
const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
/** every run of the polyline is horizontal or vertical */
export function orthogonal(pts: XY[]): boolean { for (let i = 1; i < pts.length; i++) if (!same(pts[i]![0], pts[i - 1]![0]) && !same(pts[i]![1], pts[i - 1]![1])) return false; return true; }
/** the stub's end: STUB out of the port along its own direction */
export const stubEnd = (port: XY, dir: DirLike): XY => { const [dx, dy] = stepOf(asDir(dir)); return [port[0] + dx, port[1] + dy]; };
/** the corners between the two stubs when nothing is routed by hand: an H-V-H when the ports face each other, a bus beside
 *  them when they face the same way, a lane above when the target is behind the source — and the same three, turned a
 *  quarter, when the stubs are vertical (two location connectors leave upward, so the line runs up, across and back down) */
export function autoCorners(sp: XY, sDirL: DirLike, tp: XY, tDirL: DirLike): XY[] {
  const sDir = asDir(sDirL), tDir = asDir(tDirL);
  const [sx, sy] = sp, [tx, ty] = tp;
  if (horiz(sDir) && horiz(tDir)) {
    const sRight = sDir === "right", tRight = tDir === "right";
    if (sRight !== tRight) {
      if ((sRight && tx >= sx + 8) || (!sRight && tx <= sx - 8)) { const mx = Math.round((sx + tx) / 2); return [[mx, sy], [mx, ty]]; }
      const lane = Math.min(sy, ty) - 40;
      return [[sx, lane], [tx, lane]];
    }
    const bx = sRight ? Math.max(sx, tx) + 24 : Math.min(sx, tx) - 24;
    return [[bx, sy], [bx, ty]];
  }
  if (!horiz(sDir) && !horiz(tDir)) {
    const sDown = sDir === "down", tDown = tDir === "down";
    if (sDown !== tDown) {
      if ((sDown && ty >= sy + 8) || (!sDown && ty <= sy - 8)) { const my = Math.round((sy + ty) / 2); return [[sx, my], [tx, my]]; }
      const lane = Math.min(sx, tx) - 40;
      return [[lane, sy], [lane, ty]];
    }
    const by = sDown ? Math.max(sy, ty) + 24 : Math.min(sy, ty) - 24;
    return [[sx, by], [tx, by]];
  }
  return horiz(sDir) ? [[tx, sy]] : [[sx, ty]];   // one axis each: a single corner turns the line once
}
/** the corners as the sheet draws them: the first run leaves the source stub along the stub's own axis, the runs alternate
 *  from there, and the last run enters the target stub along ITS axis (a hand set of the wrong parity takes one corner more);
 *  a first or last corner behind its own port is held at the stub's end — a line never doubles back over its stub */
export function pinCorners(sp: XY, sDirL: DirLike, corners: XY[], tp: XY, tDirL: DirLike): XY[] {
  const sDir = asDir(sDirL), tDir = asDir(tDirL);
  const c = corners.map(([x, y]) => [x, y] as XY);
  if (c.length === 0) return c;
  // the last run must lie along the target's axis: with both ends on one axis that wants an even corner count, else an odd one
  const wantEven = horiz(sDir) === horiz(tDir);
  if ((c.length % 2 === 0) !== wantEven) { const l = c[c.length - 1]!; c.push(horiz(tDir) ? [l[0], tp[1]] : [tp[0], l[1]]); }
  if (horiz(sDir)) {
    c[0]![1] = sp[1];
    c[0]![0] = sDir === "right" ? Math.max(c[0]![0], sp[0]) : Math.min(c[0]![0], sp[0]);
  } else {
    c[0]![0] = sp[0];
    c[0]![1] = sDir === "down" ? Math.max(c[0]![1], sp[1]) : Math.min(c[0]![1], sp[1]);
  }
  for (let i = 1; i < c.length; i++) { if (runH(sDir, i)) c[i]![1] = c[i - 1]![1]; else c[i]![0] = c[i - 1]![0]; }
  const last = c.length - 1;
  if (horiz(tDir)) {
    const lx = tDir === "right" ? Math.max(c[last]![0], tp[0]) : Math.min(c[last]![0], tp[0]);
    if (c.length > 2 || !horiz(sDir) || (sDir === "right" ? lx >= sp[0] : lx <= sp[0])) { c[last]![0] = lx; if (last > 0) c[last - 1]![0] = lx; }
    c[last]![1] = tp[1];
  } else {
    const ly = tDir === "down" ? Math.max(c[last]![1], tp[1]) : Math.min(c[last]![1], tp[1]);
    if (c.length > 2 || horiz(sDir) || (sDir === "down" ? ly >= sp[1] : ly <= sp[1])) { c[last]![1] = ly; if (last > 0) c[last - 1]![1] = ly; }
    c[last]![0] = tp[0];
  }
  return c;
}
/** collapsed runs go: two consecutive corners at one point are a zero-length run between two collinear ones, so both leave */
export function cleanCorners(corners: XY[]): XY[] {
  const c = corners.map(([x, y]) => [x, y] as XY);
  let i = 0;
  while (i + 1 < c.length) { if (same(c[i]![0], c[i + 1]![0]) && same(c[i]![1], c[i + 1]![1])) { c.splice(i, 2); i = Math.max(0, i - 1); } else i++; }
  return c;
}
/** a joint on an interior segment moves it as one: a V segment to x = v, an H segment to y = v */
export function shiftSegment(corners: XY[], j: number, v: number, sDirL: DirLike = "right"): XY[] {
  const sDir = asDir(sDirL);
  const c = corners.map(([x, y]) => [x, y] as XY);
  if (j < 1 || j >= c.length) return c;
  if (runH(sDir, j)) { c[j - 1]![1] = v; c[j]![1] = v; } else { c[j - 1]![0] = v; c[j]![0] = v; }
  return c;
}
/** an end segment dragged across itself becomes a JOG: the run splits at its middle and the middle part goes to v — two
 *  corners more, the pattern kept; a straight line (no corners) jogs into four. v is a y for a horizontal end, an x for a vertical one */
export function jogCorners(sp: XY, corners: XY[], tp: XY, atStart: boolean, v: number, sDirL: DirLike = "right"): XY[] {
  const sDir = asDir(sDirL);
  const c = corners.map(([x, yy]) => [x, yy] as XY);
  const endH = runH(sDir, atStart ? 0 : c.length);
  if (c.length === 0) {
    if (endH) { const m1 = snap(sp[0] + (tp[0] - sp[0]) / 3), m2 = snap(sp[0] + (2 * (tp[0] - sp[0])) / 3); return [[m1, sp[1]], [m1, v], [m2, v], [m2, tp[1]]]; }
    const m1 = snap(sp[1] + (tp[1] - sp[1]) / 3), m2 = snap(sp[1] + (2 * (tp[1] - sp[1])) / 3);
    return [[sp[0], m1], [v, m1], [v, m2], [tp[0], m2]];
  }
  if (atStart) {
    if (endH) { const mx = snap((sp[0] + c[0]![0]) / 2); c[0]![1] = v; return [[mx, sp[1]], [mx, v], ...c]; }
    const my = snap((sp[1] + c[0]![1]) / 2); c[0]![0] = v; return [[sp[0], my], [v, my], ...c];
  }
  const last = c.length - 1;
  if (endH) { const mx = snap((c[last]![0] + tp[0]) / 2); c[last]![1] = v; return [...c, [mx, v], [mx, tp[1]]]; }
  const my = snap((c[last]![1] + tp[1]) / 2); c[last]![0] = v; return [...c, [v, my], [tp[0], my]];
}
/** the segment a joint sits on among the n + 1 between the stubs: "end" is tied to a port (a drag makes a jog), "v" shifts in x, "h" in y */
export const segmentKind = (n: number, j: number, sDirL: DirLike = "right"): "end" | "v" | "h" => (j === 0 || j === n ? "end" : runH(asDir(sDirL), j) ? "h" : "v");
/** the whole polyline: the port, its stub, the corners, the other stub, the other port. Stored corners are pinned to the stubs
 *  and, unless a drag is live, cleaned of collapsed runs; none — or a set that cleaned away between ports that are not level
 *  and facing — takes the sheet's own route */
export function routePoints(s: XY, sDirL: DirLike, t: XY, tDirL: DirLike, corners?: XY[], live = false): XY[] {
  const sDir = asDir(sDirL), tDir = asDir(tDirL);
  const sp = stubEnd(s, sDir), tp = stubEnd(t, tDir);
  let c = corners ? pinCorners(sp, sDir, corners, tp, tDir) : autoCorners(sp, sDir, tp, tDir);
  if (!live) c = cleanCorners(c);
  const straightOk = horiz(sDir) && horiz(tDir)
    ? same(sp[1], tp[1]) && sDir !== tDir && (sDir === "right" ? tp[0] >= sp[0] : tp[0] <= sp[0])
    : !horiz(sDir) && !horiz(tDir)
      ? same(sp[0], tp[0]) && sDir !== tDir && (sDir === "down" ? tp[1] >= sp[1] : tp[1] <= sp[1])
      : false;
  if (c.length === 0 && !straightOk) c = cleanCorners(autoCorners(sp, sDir, tp, tDir));
  return [s, sp, ...c, tp, t];
}
/** an SVG path through the points with rounded corners */
export function orthoPathFrom(pts: XY[]): string {
  const r = 6;
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const nxt = pts[i + 1];
    if (!nxt) { d += ` L ${x1} ${y1}`; continue; }
    const [x2, y2] = nxt;
    const dx1 = Math.sign(x1 - x0), dy1 = Math.sign(y1 - y0), dx2 = Math.sign(x2 - x1), dy2 = Math.sign(y2 - y1);
    const len1 = Math.hypot(x1 - x0, y1 - y0), len2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, len1 / 2, len2 / 2);
    if (rr < 0.5 || (dx1 === dx2 && dy1 === dy2)) { d += ` L ${x1} ${y1}`; continue; }
    d += ` L ${x1 - dx1 * rr} ${y1 - dy1 * rr} Q ${x1} ${y1} ${x1 + dx2 * rr} ${y1 + dy2 * rr}`;
  }
  return d;
}
