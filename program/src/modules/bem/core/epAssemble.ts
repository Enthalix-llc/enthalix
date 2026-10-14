// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE WIRING (user, 2026-09-11: "generated, but we need a QA approach that
// identifies missing elements"). A drawn graph of components becomes the
// objects EnergyPlus needs to run it — and most of those objects are not
// equipment at all but PLUMBING: nodes, branches, branch lists, connector
// lists, splitters, mixers, supply and return paths, operation schemes and
// sizing. None of it holds a modelling decision, so none of it is drawn.
//
// There is no "connect A to B" object in EnergyPlus. Two components are joined
// because THEY NAME THE SAME NODE — one as its outlet, the other as its inlet.
// So the whole of this module is one discipline: invent each node name once,
// in `nodes` below, and use it exactly twice. Every Severe of the "node not
// found" family comes from breaking that.
//
// The shapes follow the engine's own examples, read rather than remembered:
// HeatPumpWaterToAirEquationFit.idf for an air loop with a water-to-air heat
// pump and for the condenser loop it stands on (pump branch · equipment branch ·
// bypass branch · outlet branch, gathered by a splitter and a mixer on each
// side), and UnitarySystem_VariableSpeedDX_SZVAV.idf for a variable-speed unit
// with VAV terminals under SingleZoneVAV control.

import type { SystemFields, WiredAirLoop } from "./bemDb.js";
import type { EpSchema } from "./epSchema.js";
import { rawObject, markerRef, type ResolvedObject, type FieldRef } from "./bemSystems.js";
import type { Source } from "./bemIdf.js";
import { sanitizeIdfName } from "./bemIdf.js";
import { TERMINAL_MIN_FRACTION } from "./assembly.js";
import type { LoopFluid } from "./loopFluid.js";
import { GHX_LAYOUT_FIELD, GHX_BOREHOLES_FIELD, GHX_GFUNCTIONS_FIELD, GHX_SIZING_YEAR, SLINKY_EXAMPLE, TRENCH_EXAMPLE, POND_EXAMPLE, SURFACE_EXAMPLE, HX_EXAMPLE, parsePairs, numOf } from "./componentForms.js";

/** what the sheet compiles to for one ducted system (the ruling's own shape, `WiredAirLoop`, with the ruling's id) */
export type GenAirLoop = WiredAirLoop & { id: string; fields?: SystemFields };
/** one fluid loop: its pump, what produces on its supply side, and (filled by the caller) what consumes on its demand side */
export interface GenPlantLoop {
  id: string;
  cls: "CondenserLoop" | "PlantLoop";
  fields?: SystemFields;
  pump: { cls: string; fields?: SystemFields };
  /** the producers: a ground heat exchanger, a boiler, a tower — each gets its own supply branch */
  supply: Array<{ cls: string; name: string; fields?: SystemFields; extra?: ResolvedObject[] }>;
  /** the consumers, as branches: each is one component's water side */
  demand: Array<{ cls: string; name: string; inlet: string; outlet: string }>;
  /** THE LOOP'S FLUID (2026-10-08): an antifreeze typed on the ground heat exchanger's card — water when absent */
  fluid?: LoopFluid | null;
  /** THE LOOP ΔT FOR FLOW SIZING (2026-10-08): typed on the pump card — Sizing:Plant's design temperature difference */
  dtK?: number;
}

const dataset: Source = "dataset", code: Source = "code-default";
/** THE NAMER: every node name is minted here and nowhere else, so a name exists in exactly one place */
export const nodes = {
  airReturn: (id: string) => `${id} Return Node`,
  /** the loop's SUPPLY side inlet. Measured 2026-09-11: the engine refuses an AirLoopHVAC whose supply inlet and demand
   *  outlet are one name ("duplicate node name"); it joins the two itself, so they must be told apart. */
  airSupplyIn: (id: string) => `${id} Supply Side Inlet Node`,
  airSupply: (id: string) => `${id} Supply Node`,
  zoneEquipInlet: (id: string) => `${id} Zone Equip Inlet Node`,
  /** the outdoor-air system's nodes (2026-09-13): the mixed air the unit takes, the outdoor node, the core's tempered outlet, the relief, the core's exhaust to outdoors */
  mixedAir: (id: string) => `${id} Mixed Air Node`,
  oaInlet: (id: string) => `${id} Outdoor Air Inlet Node`,
  hrOut: (id: string) => `${id} Heat Recovery Outlet Node`,
  relief: (id: string) => `${id} Relief Air Node`,
  hrExhaustOut: (id: string) => `${id} Heat Recovery Exhaust Outlet Node`,
  fanOut: (id: string) => `${id} Fan Outlet Node`,
  coolOut: (id: string) => `${id} Cooling Coil Outlet Node`,
  heatOut: (id: string) => `${id} Heating Coil Outlet Node`,
  coolWaterIn: (id: string) => `${id} Cooling Coil Water Inlet Node`,
  coolWaterOut: (id: string) => `${id} Cooling Coil Water Outlet Node`,
  heatWaterIn: (id: string) => `${id} Heating Coil Water Inlet Node`,
  heatWaterOut: (id: string) => `${id} Heating Coil Water Outlet Node`,
  atInlet: (z: string) => `${z} Terminal Inlet Node`,
  zoneInlet: (z: string) => `${z} Zone Inlet Node`,
  zoneAir: (z: string) => `${z} Zone Air Node`,
  zoneReturn: (z: string) => `${z} Zone Return Node`,
  supplyIn: (l: string) => `${l} Supply Inlet Node`,
  pumpOut: (l: string) => `${l} Pump Outlet Node`,
  supplyExit: (l: string) => `${l} Supply Exit Node`,
  supplyOut: (l: string) => `${l} Supply Outlet Node`,
  demandIn: (l: string) => `${l} Demand Inlet Node`,
  demandEntry: (l: string) => `${l} Demand Entrance Node`,
  demandExit: (l: string) => `${l} Demand Exit Node`,
  demandOut: (l: string) => `${l} Demand Outlet Node`,
  bypassIn: (l: string, side: string) => `${l} ${side} Bypass Inlet Node`,
  bypassOut: (l: string, side: string) => `${l} ${side} Bypass Outlet Node`,
  equipIn: (l: string, n: string) => `${l} ${n} Inlet Node`,
  equipOut: (l: string, n: string) => `${l} ${n} Outlet Node`,
};

/** a Branch holding ONE component, the only shape this generator makes */
const branch = (name: string, cls: string, comp: string, inlet: string, outlet: string): ResolvedObject =>
  rawObject("Branch", name, [
    ["name", name, code], ["pressure_drop_curve_name", "", code],
    ["component_object_type", cls, dataset], ["component_name", comp, code],
    ["component_inlet_node_name", inlet, code], ["component_outlet_node_name", outlet, code],
  ]);
const listOf = (cls: string, name: string, key: string, items: string[]): ResolvedObject =>
  rawObject(cls, name, [["name", name, code], ...items.map((x, i) => [`${key}_${i + 1}`, x, code] as [string, string, Source])]);
/** a splitter or a mixer: the one branch first, then the many */
const connector = (cls: string, name: string, one: string, many: string[]): ResolvedObject =>
  rawObject(cls, name, [["name", name, code], [cls === "Connector:Splitter" ? "inlet_branch_name" : "outlet_branch_name", one, code],
    ...many.map((x, i) => [`branch_${i + 1}`, x, code] as [string, string, Source])]);
const pipe = (name: string, inlet: string, outlet: string): ResolvedObject =>
  rawObject("Pipe:Adiabatic", name, [["name", name, code], ["inlet_node_name", inlet, code], ["outlet_node_name", outlet, code]]);

/** a field list built from the schema in IDD order, the given values placed by key and the rest left to the engine */
export function objectOf(schema: EpSchema, cls: string, name: string, ruled: SystemFields | undefined, given: Record<string, string | number>): ResolvedObject | null {
  const c = schema.classOf(cls);
  if (!c) return null;
  const entries = c.fields.map((f): [string, string | number, Source] | [string, string | number, Source, FieldRef] => {
    if (f.key === "name") return ["name", name, code];
    // a schedule MARKER on a ruled field (2026-09-14: `@schedule:file|name`, `@always`, `@never`, `@hvac-availability`) becomes a reference the writer fills
    if (ruled && f.key in ruled) {
      const mk = markerRef(ruled[f.key]);
      if (mk) return [f.key, "", "user", mk];
      // a ZONE a card names (a pump's Loc line, 2026-09-14) is a reference the writer resolves to the zone's emitted name
      if (f.key === "zone_name" && typeof ruled[f.key] === "string" && ruled[f.key]) return [f.key, "", "user", { zone: String(ruled[f.key]) }];
      return [f.key, ruled[f.key] as string | number, "user"];
    }
    if (f.key in given) return [f.key, given[f.key]!, given[f.key] === "autosize" ? code : dataset];
    return [f.key, "", code];
  });
  return { ...rawObject(cls, name, entries), minFields: c.minFields };
}

/** ONE FLUID LOOP: the pump on the supply inlet branch, each producer on its own branch, a bypass and an outlet pipe each
 *  side, gathered by a splitter and a mixer — the shape GSHPSimple-GLHE.idf and HeatPumpWaterToAirEquationFit.idf both use */
export function generateLoop(schema: EpSchema, L: GenPlantLoop): { objects: ResolvedObject[]; refused: string[] } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const id = sanitizeIdfName(L.id);
  if (!L.supply.length) refused.push(`${L.id} has nothing on its supply side — a loop with no source moves heat from nowhere`);
  if (!L.demand.length) refused.push(`${L.id} has nothing on its demand side — nothing uses it`);
  // THE PUMP'S OWN NUMBERS (2026-09-14, the pump's inputs): an rpm or a pressure bound typed on the card is a constant schedule the pump
  // names — the engine takes a schedule in those fields; one type limits per loop, a constant per number
  const pumpFields: SystemFields = { ...(L.pump.fields ?? {}) };
  const pumpExtra: ResolvedObject[] = [];
  const pumpLimits = `${id} pump limits`;
  for (const k of ["pump_rpm_schedule_name", "minimum_pressure_schedule", "maximum_pressure_schedule", "minimum_rpm_schedule", "maximum_rpm_schedule"]) {
    const v = pumpFields[k];
    if (typeof v !== "number") continue;
    if (!pumpExtra.length) pumpExtra.push(rawObject("ScheduleTypeLimits", pumpLimits, [["name", pumpLimits, code], ["lower_limit_value", "", code], ["upper_limit_value", "", code], ["numeric_type", "Continuous", dataset], ["unit_type", "Dimensionless", dataset]]));
    const sn = `${id} Pump ${k.replace(/_schedule(_name)?$/, "").replace(/_/g, " ")}`;
    pumpExtra.push(rawObject("Schedule:Constant", sn, [["name", sn, code], ["schedule_type_limits_name", pumpLimits, code], ["hourly_value", v, "user"]]));
    pumpFields[k] = sn;
  }
  out.push(...pumpExtra);
  // the pump is the supply inlet branch; a fluid loop without one cannot move water (the user's own QA rule)
  const pumpObj = objectOf(schema, L.pump.cls, `${id} Pump`, pumpFields, {
    inlet_node_name: nodes.supplyIn(id), outlet_node_name: nodes.pumpOut(id),
    design_flow_rate: "autosize", design_maximum_flow_rate: "autosize", design_pump_head: 179352, design_power_consumption: "autosize",
    design_minimum_flow_rate: 0, motor_efficiency: 0.9, pump_control_type: "Intermittent", fraction_of_motor_inefficiencies_to_fluid_stream: 0,
  });
  if (pumpObj) out.push(pumpObj); else refused.push(`${L.pump.cls} is not in the schema`);
  const supplyBranches = [`${id} Supply Inlet Branch`];
  out.push(branch(`${id} Supply Inlet Branch`, L.pump.cls, `${id} Pump`, nodes.supplyIn(id), nodes.pumpOut(id)));
  for (const e of L.supply) {
    const bn = `${id} ${e.name} Branch`;
    supplyBranches.push(bn);
    for (const x of e.extra ?? []) out.push(x);
    out.push(branch(bn, e.cls, e.name, nodes.equipIn(id, e.name), nodes.equipOut(id, e.name)));
  }
  out.push(pipe(`${id} Supply Bypass`, nodes.bypassIn(id, "Supply"), nodes.bypassOut(id, "Supply")));
  out.push(branch(`${id} Supply Bypass Branch`, "Pipe:Adiabatic", `${id} Supply Bypass`, nodes.bypassIn(id, "Supply"), nodes.bypassOut(id, "Supply")));
  out.push(pipe(`${id} Supply Outlet Pipe`, nodes.supplyExit(id), nodes.supplyOut(id)));
  out.push(branch(`${id} Supply Outlet Branch`, "Pipe:Adiabatic", `${id} Supply Outlet Pipe`, nodes.supplyExit(id), nodes.supplyOut(id)));
  const supMiddle = [...supplyBranches.slice(1), `${id} Supply Bypass Branch`];
  out.push(listOf("BranchList", `${id} Supply Branches`, "branch_name", [...supplyBranches, `${id} Supply Bypass Branch`, `${id} Supply Outlet Branch`]));
  out.push(connector("Connector:Splitter", `${id} Supply Splitter`, `${id} Supply Inlet Branch`, supMiddle));
  out.push(connector("Connector:Mixer", `${id} Supply Mixer`, `${id} Supply Outlet Branch`, supMiddle));
  out.push(listOf("ConnectorList", `${id} Supply Connectors`, "connector", ["Connector:Splitter", `${id} Supply Splitter`, "Connector:Mixer", `${id} Supply Mixer`]));

  // the demand side: one branch per consumer, between an inlet pipe and an outlet pipe
  out.push(pipe(`${id} Demand Inlet Pipe`, nodes.demandIn(id), nodes.demandEntry(id)));
  out.push(branch(`${id} Demand Inlet Branch`, "Pipe:Adiabatic", `${id} Demand Inlet Pipe`, nodes.demandIn(id), nodes.demandEntry(id)));
  const demandBranches: string[] = [];
  for (const d of L.demand) {
    const bn = `${id} ${d.name} Branch`;
    demandBranches.push(bn);
    out.push(branch(bn, d.cls, d.name, d.inlet, d.outlet));
  }
  out.push(pipe(`${id} Demand Bypass`, nodes.bypassIn(id, "Demand"), nodes.bypassOut(id, "Demand")));
  out.push(branch(`${id} Demand Bypass Branch`, "Pipe:Adiabatic", `${id} Demand Bypass`, nodes.bypassIn(id, "Demand"), nodes.bypassOut(id, "Demand")));
  out.push(pipe(`${id} Demand Outlet Pipe`, nodes.demandExit(id), nodes.demandOut(id)));
  out.push(branch(`${id} Demand Outlet Branch`, "Pipe:Adiabatic", `${id} Demand Outlet Pipe`, nodes.demandExit(id), nodes.demandOut(id)));
  const demMiddle = [...demandBranches, `${id} Demand Bypass Branch`];
  out.push(listOf("BranchList", `${id} Demand Branches`, "branch_name", [`${id} Demand Inlet Branch`, ...demMiddle, `${id} Demand Outlet Branch`]));
  out.push(connector("Connector:Splitter", `${id} Demand Splitter`, `${id} Demand Inlet Branch`, demMiddle));
  out.push(connector("Connector:Mixer", `${id} Demand Mixer`, `${id} Demand Outlet Branch`, demMiddle));
  out.push(listOf("ConnectorList", `${id} Demand Connectors`, "connector", ["Connector:Splitter", `${id} Demand Splitter`, "Connector:Mixer", `${id} Demand Mixer`]));

  // the loop itself, its operation scheme and its sizing
  const loopFields: Record<string, string | number> = {
    // the antifreeze typed on the ground heat exchanger's card → the engine's own glycol at its weight fraction (2026-10-08)
    ...(L.fluid ? { fluid_type: "UserDefinedFluidType", user_defined_fluid_type: `${id} Fluid` } : { fluid_type: "Water" }),
    condenser_equipment_operation_scheme_name: `${id} Operation`, plant_equipment_operation_scheme_name: `${id} Operation`,
    condenser_loop_temperature_setpoint_node_name: nodes.supplyOut(id), loop_temperature_setpoint_node_name: nodes.supplyOut(id),
    maximum_loop_temperature: 40, minimum_loop_temperature: 1,
    maximum_loop_flow_rate: "autosize", minimum_loop_flow_rate: 0, condenser_loop_volume: "autocalculate", plant_loop_volume: "autocalculate",
    condenser_side_inlet_node_name: nodes.supplyIn(id), condenser_side_outlet_node_name: nodes.supplyOut(id),
    plant_side_inlet_node_name: nodes.supplyIn(id), plant_side_outlet_node_name: nodes.supplyOut(id),
    condenser_side_branch_list_name: `${id} Supply Branches`, condenser_side_connector_list_name: `${id} Supply Connectors`,
    plant_side_branch_list_name: `${id} Supply Branches`, plant_side_connector_list_name: `${id} Supply Connectors`,
    demand_side_inlet_node_name: nodes.demandIn(id), demand_side_outlet_node_name: nodes.demandOut(id),
    condenser_demand_side_branch_list_name: `${id} Demand Branches`, condenser_demand_side_connector_list_name: `${id} Demand Connectors`,
    demand_side_branch_list_name: `${id} Demand Branches`, demand_side_connector_list_name: `${id} Demand Connectors`,
    load_distribution_scheme: "SequentialLoad",
  };
  const loop = objectOf(schema, L.cls, id, L.fields, loopFields);
  if (loop) out.push(loop); else refused.push(`${L.cls} is not in the schema`);
  if (L.fluid) {
    // written whole (the program's schema subset carries no FluidProperties group): name, glycol type, user glycol name (blank), concentration
    out.push(rawObject("FluidProperties:GlycolConcentration", `${id} Fluid`, [["name", `${id} Fluid`, code], ["glycol_type", L.fluid.glycol, "user"],
      ["user_defined_glycol_name", "", code], ["glycol_concentration", Number((L.fluid.weightPct / 100).toFixed(4)), "user"]]));
  }
  // a CondenserLoop asks for its OWN operation classes, not the plant ones — the engine says so by name (measured 2026-09-11:
  // "CondenserLoop=… is expecting CondenserEquipmentOperationSchemes=…, but not found")
  const cond = L.cls === "CondenserLoop";
  out.push(rawObject(cond ? "CondenserEquipmentList" : "PlantEquipmentList", `${id} Equipment`, [["name", `${id} Equipment`, code],
    ...L.supply.flatMap((e, i) => [[`equipment_object_type_${i + 1}`, e.cls, dataset], [`equipment_name_${i + 1}`, e.name, code]] as Array<[string, string, Source]>)]));
  out.push(rawObject("PlantEquipmentOperation:Uncontrolled", `${id} Always On`, [["name", `${id} Always On`, code], ["equipment_list_name", `${id} Equipment`, code]]));
  out.push(rawObject(cond ? "CondenserEquipmentOperationSchemes" : "PlantEquipmentOperationSchemes", `${id} Operation`, [["name", `${id} Operation`, code],
    ["control_scheme_1_object_type", "PlantEquipmentOperation:Uncontrolled", dataset], ["control_scheme_1_name", `${id} Always On`, code],
    ["control_scheme_1_schedule_name", "", code, { schedule: "always" }]]));
  const sizing = objectOf(schema, "Sizing:Plant", `${id} sizing`, undefined, {
    plant_or_condenser_loop_name: id, loop_type: L.cls === "CondenserLoop" ? "Condenser" : "Heating",
    design_loop_exit_temperature: 29, loop_design_temperature_difference: Number((L.dtK ?? 5.6).toFixed(4)), sizing_option: "Coincident",
    zone_timesteps_in_averaging_window: 1, coincident_sizing_factor_mode: "GlobalHeatingSizingFactor",
  });
  if (sizing) out.push(sizing);
  return { objects: out, refused };
}

/** the setpoint the loop is controlled to: a ground loop follows the ground's own temperature, which is what a borefield does */
export function loopSetpoint(schema: EpSchema, id: string, groundCoupled: boolean): ResolvedObject | null {
  const n = sanitizeIdfName(id);
  return groundCoupled
    ? objectOf(schema, "SetpointManager:FollowGroundTemperature", `${n} setpoint`, undefined, {
        control_variable: "Temperature", reference_ground_temperature_object_type: "Site:GroundTemperature:Deep",
        offset_temperature_difference: 0, maximum_setpoint_temperature: 40, minimum_setpoint_temperature: 1,
        setpoint_node_or_nodelist_name: nodes.supplyOut(n),
      })
    : objectOf(schema, "SetpointManager:Scheduled", `${n} setpoint`, undefined, {
        control_variable: "Temperature", schedule_name: "", setpoint_node_or_nodelist_name: nodes.supplyOut(n),
      });
}

/** THE BOREFIELD (user, 2026-09-11: vertical boreholes, roughly known). The IFC draws no ground loop at all, so every number
 *  here is STATED. The engine's own default for `g-Function Calculation Method` is UHFcalc — it computes the field's response
 *  itself from the array, so the user says how many bores, how deep and how far apart, and the physics follows. Since 2026-09-14
 *  the card's own inputs (componentForms.ts) override every number, and the soil numbers serve the other exchanger types too. */
export interface Borefield { boresX: number; boresY: number; spacingM: number; lengthM: number; topM: number; diameterM: number;
  soilConductivity: number; soilHeatCapacity: number; soilDensity: number; soilSpecificHeat: number;
  surfaceTempC: number; amplitudeC: number; phaseDays: number }
export const BOREFIELD_DEFAULT: Borefield = {
  boresX: 4, boresY: 1, spacingM: 6, lengthM: 76.2, topM: 1, diameterM: 0.127,
  soilConductivity: 2.5, soilHeatCapacity: 2.5e6, soilDensity: 1500, soilSpecificHeat: 1667,
  surfaceTempC: 13.4, amplitudeC: 3.2, phaseDays: 8,
};
/** the ground heat exchanger classes the generator writes on a condenser loop's supply branch (user, 2026-09-14: the subsets) */
export const GHX_CLASSES: readonly string[] = ["GroundHeatExchanger:System", "GroundHeatExchanger:Slinky", "GroundHeatExchanger:Pond", "GroundHeatExchanger:Surface", "GroundHeatExchanger:HorizontalTrench"];
const KA_CLS = "Site:GroundTemperature:Undisturbed:KusudaAchenbach", XING_CLS = "Site:GroundTemperature:Undisturbed:Xing";
const VP_CLS = "GroundHeatExchanger:Vertical:Properties", VA_CLS = "GroundHeatExchanger:Vertical:Array", VSG_CLS = "GroundHeatExchanger:Vertical:Single", VSZ_CLS = "GroundHeatExchanger:Vertical:Sizing:Rectangle", RF_CLS = "GroundHeatExchanger:ResponseFactors";
/** THE GROUND HEAT EXCHANGER, by its class and the card's inputs — the vertical System with its borehole, its layout (an array ·
 *  boreholes one by one · designed by the engine from a rectangle over a sizing year) and stated response factors when given; the
 *  slinky and the trench with the ground model; the pond; the surface with its construction (the engine's own example's). Every
 *  number the card does not state is the borefield default's or the engine's example's, cited in componentForms.ts. */
export function groundHeatExchanger(schema: EpSchema, loopId: string, name: string, cls: string = "GroundHeatExchanger:System", f: SystemFields = {}): { objects: ResolvedObject[]; refused: string[]; words: string } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const id = sanitizeIdfName(loopId), b = BOREFIELD_DEFAULT;
  const num = (k: string, d: number): number => numOf(f[k]) ?? d;
  const str = (k: string, d: string): string => (typeof f[k] === "string" && f[k] ? String(f[k]) : d);
  const push = (o: ResolvedObject | null, c: string): void => { if (o) out.push(o); else refused.push(`${c} is not in the schema`); };
  const inlet = nodes.equipIn(id, name), outlet = nodes.equipOut(id, name);
  // the undisturbed ground temperature: the card's model, its own fields, the borefield default's soil until typed (the finite-difference
  // model's moisture and cover are the engine's own defaults when blank)
  const groundModel = (): { type: string; name: string } => {
    const type = str("undisturbed_ground_temperature_model_type", KA_CLS), temps = `${name} Ground Temps`;
    const soil = { soil_thermal_conductivity: num("soil_thermal_conductivity", b.soilConductivity), soil_density: num("soil_density", b.soilDensity), soil_specific_heat: num("soil_specific_heat", b.soilSpecificHeat) };
    const given = type === KA_CLS ? { ...soil, average_soil_surface_temperature: b.surfaceTempC, average_amplitude_of_surface_temperature: b.amplitudeC, phase_shift_of_minimum_surface_temperature: b.phaseDays }
      : type === XING_CLS ? { ...soil, average_soil_surface_temperature: b.surfaceTempC, soil_surface_temperature_amplitude_1: b.amplitudeC, soil_surface_temperature_amplitude_2: 0, phase_shift_of_temperature_amplitude_1: b.phaseDays, phase_shift_of_temperature_amplitude_2: 0 }
      : soil;
    push(objectOf(schema, type, temps, f, given), type);
    return { type, name: temps };
  };
  let words = "";
  if (cls === "GroundHeatExchanger:System") {
    const gm = groundModel();
    const props = `${name} Bore`;
    push(objectOf(schema, VP_CLS, props, f, {
      depth_of_top_of_borehole: b.topM, borehole_length: b.lengthM, borehole_diameter: b.diameterM,
      grout_thermal_conductivity: 0.744, grout_thermal_heat_capacity: 3.9e6, pipe_thermal_conductivity: 0.389, pipe_thermal_heat_capacity: 1.77e6,
      pipe_outer_diameter: 0.0267, pipe_thickness: 0.00243, u_tube_distance: 0.0511,
    }), VP_CLS);
    const layout = str(GHX_LAYOUT_FIELD, "array");
    let bores = 0, arr = "", sizing = "";
    const singles: string[] = [];
    const single = (sn: string, x: number, y: number): void => { singles.push(sn); push(objectOf(schema, VSG_CLS, sn, undefined, { ghe_vertical_properties_object_name: props, x_location: x, y_location: y }), VSG_CLS); };
    if (layout === "single") {
      const { pairs, bad } = parsePairs(f[GHX_BOREHOLES_FIELD]);
      if (bad.length) refused.push(`${name}: boreholes not read — ${bad.join("; ")} (one "x, y" per line)`);
      if (!pairs.length) refused.push(`${name} places no borehole — one "x, y" per line, or choose the array layout`);
      for (const [i, [x, y]] of pairs.entries()) single(`${name} Bore ${i + 1}`, x, y);
      bores = pairs.length;
      words = `${bores} borehole${bores === 1 ? "" : "s"} placed one by one, ${num("borehole_length", b.lengthM)} m deep`;
    } else if (layout === "sizing") {
      // THE FIELD DESIGNED BY THE ENGINE (GHEDesigner): one seed borehole, the rectangle it may use, over a sizing year — the engine's own
      // GSHP-GLHE-BoreholeFieldDesign.idf shape; the System's method is FullDesign
      sizing = `${name} Sizing`;
      const period = `${name} Sizing Year`;
      push(rawObject("SizingPeriod:WeatherFileDays", period, [["name", period, code], ["begin_month", 1, dataset], ["begin_day_of_month", 1, dataset], ["end_month", 12, dataset], ["end_day_of_month", 31, dataset], ["day_of_week_for_start_day", "Sunday", dataset], ["use_weather_file_daylight_saving_period", "No", dataset], ["use_weather_file_rain_and_snow_indicators", "No", dataset]]), "SizingPeriod:WeatherFileDays");
      single(`${name} Bore 1`, 0, 0);
      const missing = ["available_borehole_field_length", "available_borehole_field_width", "maximum_number_of_boreholes"].filter((k) => typeof f[k] !== "number");
      if (missing.length) refused.push(`${name}: the designed layout needs ${missing.map((k) => k.replace(/_/g, " ")).join(", ")} — type them, or choose the array layout`);
      push(objectOf(schema, VSZ_CLS, sizing, f, { sizingperiod_weatherfiledays_name: period }), VSZ_CLS);
      bores = 1;
      words = `designed by the engine within ${num("available_borehole_field_length", 0)} × ${num("available_borehole_field_width", 0)} m, at most ${num("maximum_number_of_boreholes", 0)} boreholes (a sizing year runs first)`;
    } else {
      arr = `${name} Array`;
      const nx = num("number_of_boreholes_in_x_direction", b.boresX), ny = num("number_of_boreholes_in_y_direction", b.boresY);
      const fa: SystemFields = { ...f, number_of_boreholes_in_x_direction: nx, number_of_boreholes_in_y_direction: ny };   // numeric text on the card reaches the object as a number
      push(objectOf(schema, VA_CLS, arr, fa, { ghe_vertical_properties_object_name: props, number_of_boreholes_in_x_direction: nx, number_of_boreholes_in_y_direction: ny, borehole_spacing: b.spacingM }), VA_CLS);
      bores = Math.max(1, Math.round(nx * ny));
      if (nx * ny < 1) refused.push(`${name} states no boreholes — a borefield of none exchanges nothing`);
      words = `borefield ${nx}×${ny} bores, ${num("borehole_length", b.lengthM)} m deep, ${num("borehole_spacing", b.spacingM)} m apart`;
    }
    if (num("borehole_length", b.lengthM) <= 0) refused.push(`${name} states no borehole depth`);
    // stated response factors: the object is written and the System names it (the engine ignores the calculation method then)
    let rf = "";
    const gf = parsePairs(f[GHX_GFUNCTIONS_FIELD]);
    if (gf.bad.length) refused.push(`${name}: g-functions not read — ${gf.bad.join("; ")} (one "ln(t/ts), g" per line)`);
    if (gf.pairs.length) {
      rf = `${name} Response Factors`;
      const o = objectOf(schema, RF_CLS, rf, undefined, { ghe_vertical_properties_object_name: props, number_of_boreholes: num("number_of_boreholes", bores), g_function_reference_ratio: num("g_function_reference_ratio", 0.0005) });
      if (o) { for (const [i, [t, g]] of gf.pairs.entries()) o.fields.push({ key: `g_function_ln_t_ts_value_${i + 1}`, label: `g-Function Ln(T/Ts) Value ${i + 1}`, value: String(t), source: "user", units: null }, { key: `g_function_g_value_${i + 1}`, label: `g-Function g Value ${i + 1}`, value: String(g), source: "user", units: null }); out.push(o); } else refused.push(`${RF_CLS} is not in the schema`);
      words += `, ${gf.pairs.length} response factors stated`;
    }
    const fs: SystemFields = { ...f };
    if (layout === "sizing") fs.g_function_calculation_method = "FullDesign";
    const sys = objectOf(schema, cls, name, fs, {
      inlet_node_name: inlet, outlet_node_name: outlet,
      design_flow_rate: layout === "sizing" ? GHX_SIZING_YEAR.designFlowM3s : Number((0.0005 * bores).toPrecision(4)),
      undisturbed_ground_temperature_model_type: gm.type, undisturbed_ground_temperature_model_name: gm.name,
      ground_thermal_conductivity: b.soilConductivity, ground_thermal_heat_capacity: b.soilHeatCapacity,
      ...(rf ? { ghe_vertical_responsefactors_object_name: rf } : {}),
      g_function_calculation_method: layout === "sizing" ? "FullDesign" : "UHFcalc",
      ...(sizing ? { ghe_vertical_sizing_object_type: VSZ_CLS, ghe_vertical_sizing_object_name: sizing } : {}),
      ...(arr ? { ghe_vertical_array_object_name: arr } : {}),
    });
    if (sys) { for (const [i, sn] of singles.entries()) sys.fields.push({ key: `ghe_vertical_single_object_name_${i + 1}`, label: `GHE:Vertical:Single Object Name ${i + 1}`, value: sn, source: code, units: null }); out.push(sys); } else refused.push(`${cls} is not in the schema`);
  } else if (cls === "GroundHeatExchanger:Slinky") {
    const gm = groundModel();
    // every number the engine requires is STATED from its own example (GATE_GHX, 2026-09-15: a required number left blank is a Severe); the card's own wins
    push(objectOf(schema, cls, name, f, { inlet_node_name: inlet, outlet_node_name: outlet, heat_exchanger_configuration: SLINKY_EXAMPLE.configuration, maximum_length_of_simulation: SLINKY_EXAMPLE.years,
      design_flow_rate: SLINKY_EXAMPLE.designFlowM3s, soil_thermal_conductivity: SLINKY_EXAMPLE.soilK, soil_density: SLINKY_EXAMPLE.soilDensity, soil_specific_heat: SLINKY_EXAMPLE.soilCp,
      pipe_thermal_conductivity: SLINKY_EXAMPLE.pipeK, pipe_density: SLINKY_EXAMPLE.pipeDensity, pipe_specific_heat: SLINKY_EXAMPLE.pipeCp, pipe_outer_diameter: SLINKY_EXAMPLE.pipeOuterM, pipe_thickness: SLINKY_EXAMPLE.pipeThicknessM,
      coil_diameter: SLINKY_EXAMPLE.coilDiameterM, coil_pitch: SLINKY_EXAMPLE.coilPitchM, trench_depth: SLINKY_EXAMPLE.trenchDepthM, trench_length: SLINKY_EXAMPLE.trenchLengthM, number_of_trenches: SLINKY_EXAMPLE.trenches, horizontal_spacing_between_pipes: SLINKY_EXAMPLE.spacingM, undisturbed_ground_temperature_model_type: gm.type, undisturbed_ground_temperature_model_name: gm.name }), cls);
    words = `slinky: ${num("number_of_trenches", SLINKY_EXAMPLE.trenches)} trench${num("number_of_trenches", SLINKY_EXAMPLE.trenches) === 1 ? "" : "es"} × ${num("trench_length", SLINKY_EXAMPLE.trenchLengthM)} m at ${num("trench_depth", SLINKY_EXAMPLE.trenchDepthM)} m, ${str("heat_exchanger_configuration", SLINKY_EXAMPLE.configuration).toLowerCase()} rings`;
  } else if (cls === "GroundHeatExchanger:HorizontalTrench") {
    const gm = groundModel();
    // the example's whole object stated (GATE_GHX, 2026-09-15: at the engine's own field defaults alone the fluid ran −60 … 209 °C over the year); the card's own wins
    push(objectOf(schema, cls, name, f, { inlet_node_name: inlet, outlet_node_name: outlet, design_flow_rate: TRENCH_EXAMPLE.designFlowM3s, undisturbed_ground_temperature_model_type: gm.type, undisturbed_ground_temperature_model_name: gm.name,
      trench_length_in_pipe_axial_direction: TRENCH_EXAMPLE.trenchLengthM, number_of_trenches: TRENCH_EXAMPLE.trenches, horizontal_spacing_between_pipes: TRENCH_EXAMPLE.spacingM, pipe_inner_diameter: TRENCH_EXAMPLE.pipeInnerM, pipe_outer_diameter: TRENCH_EXAMPLE.pipeOuterM, burial_depth: TRENCH_EXAMPLE.burialDepthM,
      soil_thermal_conductivity: TRENCH_EXAMPLE.soilK, soil_density: TRENCH_EXAMPLE.soilDensity, soil_specific_heat: TRENCH_EXAMPLE.soilCp, pipe_thermal_conductivity: TRENCH_EXAMPLE.pipeK, pipe_density: TRENCH_EXAMPLE.pipeDensity, pipe_specific_heat: TRENCH_EXAMPLE.pipeCp,
      soil_moisture_content_percent: TRENCH_EXAMPLE.moisturePct, soil_moisture_content_percent_at_saturation: TRENCH_EXAMPLE.moistureSatPct, evapotranspiration_ground_cover_parameter: TRENCH_EXAMPLE.groundCover }), cls);
    words = `horizontal trench: ${num("number_of_trenches", TRENCH_EXAMPLE.trenches)} × ${num("trench_length_in_pipe_axial_direction", TRENCH_EXAMPLE.trenchLengthM)} m at ${num("burial_depth", TRENCH_EXAMPLE.burialDepthM)} m`;
  } else if (cls === "GroundHeatExchanger:Pond") {
    push(objectOf(schema, cls, name, f, { fluid_inlet_node_name: inlet, fluid_outlet_node_name: outlet, pond_depth: POND_EXAMPLE.depthM, pond_area: POND_EXAMPLE.areaM2, hydronic_tubing_inside_diameter: POND_EXAMPLE.tubeInM, hydronic_tubing_outside_diameter: POND_EXAMPLE.tubeOutM, hydronic_tubing_thermal_conductivity: POND_EXAMPLE.tubeK, ground_thermal_conductivity: POND_EXAMPLE.groundK, number_of_tubing_circuits: POND_EXAMPLE.circuits, length_of_each_tubing_circuit: POND_EXAMPLE.circuitLengthM }), cls);
    words = `pond ${num("pond_depth", POND_EXAMPLE.depthM)} m deep × ${num("pond_area", POND_EXAMPLE.areaM2)} m², ${num("number_of_tubing_circuits", POND_EXAMPLE.circuits)} circuits of ${num("length_of_each_tubing_circuit", POND_EXAMPLE.circuitLengthM)} m`;
  } else if (cls === "GroundHeatExchanger:Surface") {
    // the slab's construction, written for it: the engine's own example's two layers of 4 in heavyweight concrete
    const mat = `${name} concrete`, con = `${name} slab`, k = SURFACE_EXAMPLE.concrete;
    out.push(rawObject("Material", mat, [["name", mat, code], ["roughness", k.roughness, dataset], ["thickness", k.thicknessM, dataset], ["conductivity", k.conductivity, dataset], ["density", k.density, dataset], ["specific_heat", k.specificHeat, dataset], ["thermal_absorptance", k.thermalAbs, dataset], ["solar_absorptance", k.solarAbs, dataset], ["visible_absorptance", k.visibleAbs, dataset]]));
    out.push(rawObject("Construction", con, [["name", con, code], ["outside_layer", mat, code], ["layer_2", mat, code]]));
    // the tubing IN the slab: the engine refuses a surface exchanger whose construction has no internal source (a Severe, measured 2026-09-15) — the example's own property
    const src = SURFACE_EXAMPLE.source;
    out.push(rawObject("ConstructionProperty:InternalHeatSource", `${con} source`, [["name", `${con} source`, code], ["construction_name", con, code], ["thermal_source_present_after_layer_number", src.afterLayer, dataset], ["temperature_calculation_requested_after_layer_number", src.temperatureAfterLayer, dataset], ["dimensions_for_the_ctf_calculation", src.ctfDimensions, dataset], ["tube_spacing", src.tubeSpacingM, dataset], ["two_dimensional_temperature_calculation_position", src.position, dataset]]));
    push(objectOf(schema, cls, name, f, { construction_name: con, fluid_inlet_node_name: inlet, fluid_outlet_node_name: outlet, hydronic_tubing_inside_diameter: SURFACE_EXAMPLE.tubeInM, number_of_tubing_circuits: SURFACE_EXAMPLE.circuits, hydronic_tube_spacing: SURFACE_EXAMPLE.spacingM, surface_length: SURFACE_EXAMPLE.lengthM, surface_width: SURFACE_EXAMPLE.widthM, lower_surface_environment: SURFACE_EXAMPLE.lower }), cls);
    words = `surface ${num("surface_length", SURFACE_EXAMPLE.lengthM)} × ${num("surface_width", SURFACE_EXAMPLE.widthM)} m, ${num("number_of_tubing_circuits", SURFACE_EXAMPLE.circuits)} circuits, ${str("lower_surface_environment", SURFACE_EXAMPLE.lower).toLowerCase()} below`;
  } else refused.push(`${cls} is not a ground heat exchanger the generator writes`);
  return { objects: out, refused, words };
}

/** ONE AIR LOOP: the parent on its supply branch, a terminal per zone through the supply path, the zones' return through the
 *  return path. Without an outdoor-air system the loop's supply inlet and its demand outlet are ONE node — the return. */
export function generateAirLoop(schema: EpSchema, A: GenAirLoop, sets: { vs?: VsSet } = {}): { objects: ResolvedObject[]; refused: string[]; waterBranches: GenPlantLoop["demand"]; usesVs: boolean; usesEquationFit: boolean; oaSpec?: string } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const id = sanitizeIdfName(A.id);
  const waterBranches: GenPlantLoop["demand"] = [];
  // with an outdoor-air system ahead of it the unit takes MIXED air; without one the loop's supply inlet is the unit's own inlet
  // a RATED ERV (2026-10-07) is its own unit in each zone — the heat pump then takes no outdoor or exhaust air at all
  const ervs = A.oa?.zoneM3s, throughUnit = !!A.oa && !ervs;
  const parentIn = throughUnit ? nodes.mixedAir(id) : nodes.airSupplyIn(id);
  if (!A.terminals.length) refused.push(`${A.id} has no air terminal — it reaches no zone`);
  const waterCoil = (cls: string): boolean => /WaterToAirHeatPump/.test(cls);
  const isVs = (cls: string): boolean => /VariableSpeedEquationFit$/.test(cls);
  const usesVs = isVs(A.cooling.cls) || isVs(A.heating.cls), usesEquationFit = /:EquationFit$/.test(A.cooling.cls) || /:EquationFit$/.test(A.heating.cls);
  // a variable-speed coil is rated by its SPEED SET — read from the engine's example (variableSpeedSet) — and is refused by name
  // when the set was not read, never written half-rated
  for (const [part, cls] of [["cooling", A.cooling.cls], ["heating", A.heating.cls]] as const) {
    if (isVs(cls) && !sets.vs?.[part]) refused.push(`${A.id}'s ${part} coil ${cls} needs a speed set and the engine's example (ExampleFiles/${VS_EXAMPLE.file}) was not read${sets.vs?.missing.length ? ` — missing ${sets.vs.missing.join(", ")}` : ""}`);
    // the ParameterEstimation model (2026-09-14) is rated by the unit's own physical parameters — compressor, exchangers, refrigerant charge —
    // which no dataset here states; refused by name, never written half-rated
    if (/ParameterEstimation$/.test(cls)) refused.push(`${A.id}'s ${part} coil ${cls} is rated by the unit's own physical parameters (compressor, heat exchangers, refrigerant) that no dataset here states — not written; pick EquationFit (the dataset's rated single-speed set) or VariableSpeedEquationFit (the engine's example's speed set)`);
  }
  // the supplemental heater switched OFF on the card (2026-09-14): the parent requires one, so the coil is written and never available
  const suppOff = !!A.supplemental && A.supplemental.fields?.availability_schedule_name === "@never";
  // CoolReheat dehumidification (the card's select, 2026-09-14): the engine wants a ZoneControl:Humidistat in the control zone (Furnaces.cc
  // GetFurnaceInput: "Did not find Air Node (Zone with Humidistat)" is a Severe) and reheats with the supplemental coil, so both are demanded here
  const dehumidify = String(A.fields?.dehumidification_control_type ?? "") === "CoolReheat";
  if (dehumidify && suppOff) refused.push(`${A.id}: CoolReheat dehumidification reheats with the supplemental coil — switch the supplemental heater on, or set dehumidification to None`);
  if (dehumidify && !A.controlZone) refused.push(`${A.id}: CoolReheat dehumidification needs one control zone for its humidistat — not under SetPoint control`);

  // the parts, emitted BEFORE the parent that names them: the writer resolves a reference through the names it has emitted
  const fanName = `${id} Supply Fan`, coolName = `${id} Cooling Coil`, heatName = `${id} Heating Coil`, suppName = `${id} Supplemental Coil`;
  const [c1, c2, c3, c4, c5] = FAN_VV_EXAMPLE.coefficients;
  const fan = objectOf(schema, A.fan.cls, fanName, A.fan.fields, {
    availability_schedule_name: "", air_inlet_node_name: parentIn, air_outlet_node_name: nodes.fanOut(id),
    fan_total_efficiency: 0.7, pressure_rise: 600, maximum_flow_rate: "autosize", motor_efficiency: 0.9, motor_in_airstream_fraction: 1,
    design_maximum_air_flow_rate: "autosize", speed_control_method: A.control === "SetPoint" ? "Continuous" : "Discrete", design_pressure_rise: 600,
    design_electric_power_consumption: "autosize", design_power_sizing_method: "TotalEfficiencyAndPressure",
    // Fan:VariableVolume (the SetPoint shape's fan, 2026-09-13): the power curve and the minimum fraction of the engine's own VAV example
    fan_power_minimum_flow_rate_input_method: "Fraction", fan_power_minimum_flow_fraction: FAN_VV_EXAMPLE.minimumFlowFraction,
    fan_power_coefficient_1: c1, fan_power_coefficient_2: c2, fan_power_coefficient_3: c3, fan_power_coefficient_4: c4, fan_power_coefficient_5: c5,
  });
  if (fan) out.push(fan); else refused.push(`${A.fan.cls} is not in the schema`);
  // the cooling coil: its nodes, then EITHER the dataset-rated single-speed set (EquationFit) OR the example's speed set (variable
  // speed) with the nominal level's capacity and flows left to the engine to size
  const coolNodes: Record<string, string | number> = {
    air_inlet_node_name: nodes.fanOut(id), air_outlet_node_name: nodes.coolOut(id),
    indoor_air_inlet_node_name: nodes.fanOut(id), indoor_air_outlet_node_name: nodes.coolOut(id),
    water_inlet_node_name: nodes.coolWaterIn(id), water_outlet_node_name: nodes.coolWaterOut(id),
    water_to_refrigerant_hx_water_inlet_node_name: nodes.coolWaterIn(id), water_to_refrigerant_hx_water_outlet_node_name: nodes.coolWaterOut(id),
  };
  const cool = objectOf(schema, A.cooling.cls, coolName, A.cooling.fields, isVs(A.cooling.cls) ? {
    ...coolNodes, ...(sets.vs?.cooling ?? {}),
    gross_rated_total_cooling_capacity_at_selected_nominal_speed_level: "autosize", rated_air_flow_rate_at_selected_nominal_speed_level: "autosize", rated_water_flow_rate_at_selected_nominal_speed_level: "autosize",
  } : {
    ...coolNodes,
    rated_air_flow_rate: "autosize", rated_water_flow_rate: "autosize",
    gross_rated_total_cooling_capacity: "autosize", gross_rated_sensible_cooling_capacity: "autosize",
    total_cooling_capacity_curve_name: GLHP_CURVES.coolCap, sensible_cooling_capacity_curve_name: GLHP_CURVES.coolSens,
    cooling_power_consumption_curve_name: GLHP_CURVES.coolPower, part_load_fraction_correlation_curve_name: GLHP_CURVES.coolPlf,
    rated_entering_water_temperature: GLHP_RATED.coolWaterC, rated_entering_air_dry_bulb_temperature: GLHP_RATED.coolAirDbC,
    rated_entering_air_wet_bulb_temperature: GLHP_RATED.coolAirWbC, gross_rated_cooling_cop: GLHP_RATED.coolCop,
  });
  if (cool) out.push(cool); else refused.push(`${A.cooling.cls} is not in the schema`);
  const heatNodes: Record<string, string | number> = {
    air_inlet_node_name: nodes.coolOut(id), air_outlet_node_name: nodes.heatOut(id),
    indoor_air_inlet_node_name: nodes.coolOut(id), indoor_air_outlet_node_name: nodes.heatOut(id),
    water_inlet_node_name: nodes.heatWaterIn(id), water_outlet_node_name: nodes.heatWaterOut(id),
    water_to_refrigerant_hx_water_inlet_node_name: nodes.heatWaterIn(id), water_to_refrigerant_hx_water_outlet_node_name: nodes.heatWaterOut(id),
  };
  const heat = objectOf(schema, A.heating.cls, heatName, A.heating.fields, isVs(A.heating.cls) ? {
    ...heatNodes, ...(sets.vs?.heating ?? {}),
    rated_heating_capacity_at_selected_nominal_speed_level: "autosize", rated_air_flow_rate_at_selected_nominal_speed_level: "autosize", rated_water_flow_rate_at_selected_nominal_speed_level: "autosize",
  } : {
    ...heatNodes,
    rated_air_flow_rate: "autosize", rated_water_flow_rate: "autosize", gross_rated_heating_capacity: "autosize",
    heating_capacity_curve_name: GLHP_CURVES.heatCap, heating_power_consumption_curve_name: GLHP_CURVES.heatPower,
    part_load_fraction_correlation_curve_name: GLHP_CURVES.heatPlf,
    rated_entering_water_temperature: GLHP_RATED.heatWaterC, rated_entering_air_dry_bulb_temperature: GLHP_RATED.heatAirDbC,
    gross_rated_heating_cop: GLHP_RATED.heatCop, ratio_of_rated_heating_capacity_to_rated_cooling_capacity: GLHP_RATED.heatToCoolCapacityRatio,
  });
  if (heat) out.push(heat); else refused.push(`${A.heating.cls} is not in the schema`);
  const supp = A.supplemental ? objectOf(schema, A.supplemental.cls, suppName, A.supplemental.fields, {
    // switched off (user, 2026-10-02: "the units specifically exclude electric supplemental heat"): never available AND 0 W — autosized,
    // the engine sized a heater the unit does not have and the sizing reports listed it (660–2,233 W on _House, 0.0 kWh drawn)
    availability_schedule_name: "", efficiency: 1, nominal_capacity: suppOff ? 0 : "autosize",
    air_inlet_node_name: nodes.heatOut(id), air_outlet_node_name: nodes.airSupply(id),
  }) : null;
  if (supp) out.push(supp);
  // the coils' water side becomes the loop's demand branches — the plant connection a heat pump's PARENT does not carry
  if (waterCoil(A.cooling.cls)) waterBranches.push({ cls: A.cooling.cls, name: coolName, inlet: nodes.coolWaterIn(id), outlet: nodes.coolWaterOut(id) });
  if (waterCoil(A.heating.cls)) waterBranches.push({ cls: A.heating.cls, name: heatName, inlet: nodes.heatWaterIn(id), outlet: nodes.heatWaterOut(id) });
  if (waterBranches.length && !A.loop) refused.push(`${A.id}'s coils take water and it is on no loop — connect its water side to a ground or plant loop`);

  const parentGiven: Record<string, string | number> = {
    availability_schedule_name: "", air_inlet_node_name: parentIn, air_outlet_node_name: nodes.airSupply(id),
    controlling_zone_or_thermostat_location: A.controlZone,
    supply_air_flow_rate: "autosize", supply_air_fan_object_type: A.fan.cls, supply_air_fan_name: fanName,
    supply_fan_object_type: A.fan.cls, supply_fan_name: fanName, fan_placement: "BlowThrough",
    // the convergence of the part-load iteration: 1/n on a card written as n units (the user's rule, 2026-09-14), else the engine's 0.001
    heating_coil_object_type: A.heating.cls, heating_coil_name: heatName, heating_convergence: A.convergence ?? 0.001,
    cooling_coil_object_type: A.cooling.cls, cooling_coil_name: coolName, cooling_convergence: A.convergence ?? 0.001,
    ...(A.supplemental ? { supplemental_heating_coil_object_type: A.supplemental.cls, supplemental_heating_coil_name: suppName } : {}),
    maximum_supply_air_temperature_from_supplemental_heater: 50, maximum_supply_air_temperature: 50,
    maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation: 21,
    control_type: A.control ?? "Load",
    cooling_supply_air_flow_rate_method: "SupplyAirFlowRate", cooling_supply_air_flow_rate: "autosize",
    heating_supply_air_flow_rate_method: "SupplyAirFlowRate", heating_supply_air_flow_rate: "autosize",
    no_load_supply_air_flow_rate_method: "SupplyAirFlowRate", no_load_supply_air_flow_rate: "autosize",
  };
  const parent = objectOf(schema, A.parent, id, A.fields, parentGiven);
  if (parent) out.push(parent); else refused.push(`${A.parent} is not in the schema`);
  // THE HUMIDISTAT for CoolReheat (2026-09-14): in the control zone, humidifying 0 % (no humidifier in the unit), dehumidifying at the
  // card's setpoint or the engine's own example's (HeatPumpWaterToAirWithRHControl.idf, its dehumidifying schedule's first block: 50 %)
  if (dehumidify && !suppOff && A.controlZone) {
    const rh = typeof A.fields?.[DEHUMIDIFY_RH_FIELD] === "number" ? (A.fields[DEHUMIDIFY_RH_FIELD] as number) : DEHUMIDIFY_RH_DEFAULT.percent;
    out.push(rawObject("Schedule:Constant", `${id} humidify RH`, [["name", `${id} humidify RH`, code], ["schedule_type_limits_name", "", code], ["hourly_value", 0, dataset]]));
    out.push(rawObject("Schedule:Constant", `${id} dehumidify RH`, [["name", `${id} dehumidify RH`, code], ["schedule_type_limits_name", "", code], ["hourly_value", rh, typeof A.fields?.[DEHUMIDIFY_RH_FIELD] === "number" ? "user" : dataset]]));
    out.push(rawObject("ZoneControl:Humidistat", `${id} Humidistat`, [["name", `${id} Humidistat`, code], ["zone_name", "", code, { zone: A.controlZone }],
      ["humidifying_relative_humidity_setpoint_schedule_name", `${id} humidify RH`, code], ["dehumidifying_relative_humidity_setpoint_schedule_name", `${id} dehumidify RH`, code]]));
  }

  // the loop, its one supply branch — the outdoor-air system ahead of the unit when a core is drawn — and the paths that reach the zones
  let oaSpec: string | undefined;
  if (A.oa && ervs) {
    // the zones are still SIZED on the ventilation the ERVs bring (the same Flow/Area the shares come from)
    const spec = `${id} outdoor air`;
    const ds = objectOf(schema, "DesignSpecification:OutdoorAir", spec, undefined, { outdoor_air_method: "Flow/Area", outdoor_air_flow_per_zone_floor_area: A.oa.perAreaM3sM2 ?? 0 });
    if (ds) { out.push(ds); oaSpec = spec; } else refused.push("DesignSpecification:OutdoorAir is not in the schema");
  }
  if (throughUnit) {
    const oa = outdoorAirSystem(schema, A, id);
    out.push(...oa.objects); refused.push(...oa.refused); oaSpec = oa.spec;
    out.push(rawObject("Branch", `${id} Main Branch`, [
      ["name", `${id} Main Branch`, code], ["pressure_drop_curve_name", "", code],
      ["component_1_object_type", "AirLoopHVAC:OutdoorAirSystem", dataset], ["component_1_name", `${id} OA System`, code],
      ["component_1_inlet_node_name", nodes.airSupplyIn(id), code], ["component_1_outlet_node_name", nodes.mixedAir(id), code],
      ["component_2_object_type", A.parent, dataset], ["component_2_name", id, code],
      ["component_2_inlet_node_name", nodes.mixedAir(id), code], ["component_2_outlet_node_name", nodes.airSupply(id), code],
    ]));
  } else out.push(branch(`${id} Main Branch`, A.parent, id, nodes.airSupplyIn(id), nodes.airSupply(id)));
  out.push(listOf("BranchList", `${id} Branches`, "branch_name", [`${id} Main Branch`]));
  out.push(rawObject("AvailabilityManager:Scheduled", `${id} Availability`, [["name", `${id} Availability`, code], ["schedule_name", "", code, { schedule: "always" }]]));
  out.push(rawObject("AvailabilityManagerAssignmentList", `${id} Availability Managers`, [["name", `${id} Availability Managers`, code],
    ["availability_manager_object_type_1", "AvailabilityManager:Scheduled", dataset], ["availability_manager_name_1", `${id} Availability`, code]]));
  // the loop object's name is NOT the parent's: the writer dedupes names, and two objects called the same thing became
  // "HP-GATE" and "HP-GATE#2", which broke every reference to the loop (measured 2026-09-11)
  const loopName = `${id} Air Loop`;
  const loop = objectOf(schema, "AirLoopHVAC", loopName, undefined, {
    availability_manager_list_name: `${id} Availability Managers`, design_supply_air_flow_rate: "autosize",
    branch_list_name: `${id} Branches`, supply_side_inlet_node_name: nodes.airSupplyIn(id),
    demand_side_outlet_node_name: nodes.airReturn(id), demand_side_inlet_node_names: nodes.zoneEquipInlet(id),
    supply_side_outlet_node_names: nodes.airSupply(id),
  });
  if (loop) out.push(loop);
  const zs = A.terminals.map((t) => sanitizeIdfName(t.zone));
  out.push(rawObject("AirLoopHVAC:ZoneSplitter", `${id} Supply Splitter`, [["name", `${id} Supply Splitter`, code], ["inlet_node_name", nodes.zoneEquipInlet(id), code],
    ...zs.map((z, i) => [`outlet_${i + 1}_node_name`, nodes.atInlet(z), code] as [string, string, Source])]));
  out.push(rawObject("AirLoopHVAC:SupplyPath", `${id} Supply Path`, [["name", `${id} Supply Path`, code], ["supply_air_path_inlet_node_name", nodes.zoneEquipInlet(id), code],
    ["component_object_type_1", "AirLoopHVAC:ZoneSplitter", dataset], ["component_name_1", `${id} Supply Splitter`, code]]));
  out.push(rawObject("AirLoopHVAC:ZoneMixer", `${id} Return Mixer`, [["name", `${id} Return Mixer`, code], ["outlet_node_name", nodes.airReturn(id), code],
    ...zs.map((z, i) => [`inlet_${i + 1}_node_name`, nodes.zoneReturn(z), code] as [string, string, Source])]));
  out.push(rawObject("AirLoopHVAC:ReturnPath", `${id} Return Path`, [["name", `${id} Return Path`, code], ["return_air_path_outlet_node_name", nodes.airReturn(id), code],
    ["component_object_type_1", "AirLoopHVAC:ZoneMixer", dataset], ["component_name_1", `${id} Return Mixer`, code]]));
  const sz = objectOf(schema, "Sizing:System", `${id} sizing`, undefined, {
    airloop_name: loopName, type_of_load_to_size_on: "Sensible", design_outdoor_air_flow_rate: "autosize",
    central_heating_maximum_system_air_flow_ratio: "autosize", preheat_design_temperature: 7, preheat_design_humidity_ratio: 0.008,
    precool_design_temperature: 12.8, precool_design_humidity_ratio: 0.008,
    central_cooling_design_supply_air_temperature: 12.8, central_heating_design_supply_air_temperature: 40,
    type_of_zone_sum_to_use: "NonCoincident", "100_outdoor_air_in_cooling": "No", "100_outdoor_air_in_heating": "No",
    central_cooling_design_supply_air_humidity_ratio: 0.0085, central_heating_design_supply_air_humidity_ratio: 0.008,
    cooling_supply_air_flow_rate_method: "DesignDay", heating_supply_air_flow_rate_method: "DesignDay",
    system_outdoor_air_method: "ZoneSum", zone_maximum_outdoor_air_fraction: 1,
    cooling_design_capacity_method: "CoolingDesignCapacity", cooling_design_capacity: "autosize",
    heating_design_capacity_method: "HeatingDesignCapacity", heating_design_capacity: "autosize",
    central_cooling_capacity_control_method: A.control === "SetPoint" ? "VAV" : "OnOff",
  });
  if (sz) out.push(sz);
  // SETPOINT CONTROL (2026-09-13): the two reset managers and the changeover arbiter, after the loop they name
  if (A.control === "SetPoint") { const sp = setPointControl(schema, A, id, loopName); out.push(...sp.objects); refused.push(...sp.refused); }

  // each zone: its terminal, the distribution unit that wraps it, its equipment list and its connections
  for (const t of A.terminals) {
    const z = sanitizeIdfName(t.zone);
    // the damper's two fields are the Zone's typed values (2026-09-13), else the max flow autosized and the engine's example's
    // minimum fraction; a plain VAV:NoReheat spells the fraction `constant_minimum_air_flow_fraction`
    const tf: SystemFields = { ...(t.fields ?? {}) };
    if (t.cls === "AirTerminal:SingleDuct:VAV:NoReheat" && tf.zone_minimum_air_flow_fraction !== undefined) { tf.constant_minimum_air_flow_fraction = tf.zone_minimum_air_flow_fraction; delete tf.zone_minimum_air_flow_fraction; }
    const term = objectOf(schema, t.cls, `${z} Terminal`, tf, {
      availability_schedule_name: "", air_inlet_node_name: nodes.atInlet(z), air_outlet_node_name: nodes.zoneInlet(z),
      maximum_air_flow_rate: "autosize", zone_minimum_air_flow_input_method: "Constant", constant_minimum_air_flow_fraction: TERMINAL_MIN_FRACTION, zone_minimum_air_flow_fraction: TERMINAL_MIN_FRACTION,
    });
    if (term) out.push(term); else refused.push(`${t.cls} is not in the schema`);
    out.push(rawObject("ZoneHVAC:AirDistributionUnit", `${z} ADU`, [["name", `${z} ADU`, code],
      ["air_distribution_unit_outlet_node_name", nodes.zoneInlet(z), code], ["air_terminal_object_type", t.cls, dataset], ["air_terminal_name", `${z} Terminal`, code]]));
    const q = ervs?.[t.zone];
    const erv = A.oa && q !== undefined && q > 0 ? standaloneErv(schema, A.oa.core, `${z} ERV`, q, A.oa.cardName) : null;
    if (erv) { out.push(...erv.objects); refused.push(...erv.refused); }
    out.push(rawObject("ZoneHVAC:EquipmentList", `${z} Equipment`, [["name", `${z} Equipment`, code], ["load_distribution_scheme", "SequentialLoad", dataset],
      ["zone_equipment_object_type", "ZoneHVAC:AirDistributionUnit", dataset], ["zone_equipment_name", `${z} ADU`, code],
      ["zone_equipment_cooling_sequence", "1", dataset], ["zone_equipment_heating_or_no_load_sequence", "1", dataset],
      ...(erv ? [["zone_equipment_cooling_fraction_schedule_name", "", code], ["zone_equipment_heating_fraction_schedule_name", "", code],
        ["zone_equipment_object_type_2", "ZoneHVAC:EnergyRecoveryVentilator", dataset], ["zone_equipment_name_2", erv.name, code],
        ["zone_equipment_cooling_sequence_2", "2", dataset], ["zone_equipment_heating_or_no_load_sequence_2", "2", dataset]] as Array<[string, string, Source]> : [])]));
    if (erv) out.push(rawObject("NodeList", `${z} inlet nodes`, [["name", `${z} inlet nodes`, code], ["node_1_name", nodes.zoneInlet(z), code], ["node_2_name", erv.supplyNode, code]]));
    out.push(rawObject("ZoneHVAC:EquipmentConnections", `${z} Connections`, [
      ["zone_name", "", code, { zone: t.zone }], ["zone_conditioning_equipment_list_name", `${z} Equipment`, code],
      erv ? ["zone_air_inlet_node_or_nodelist_name", "", code, { system: `${z} inlet nodes` }] : ["zone_air_inlet_node_or_nodelist_name", nodes.zoneInlet(z), code],
      ["zone_air_exhaust_node_or_nodelist_name", erv ? erv.exhaustNode : "", code],
      ["zone_air_node_name", nodes.zoneAir(z), code], ["zone_return_air_node_or_nodelist_name", nodes.zoneReturn(z), code]]));
  }
  return { objects: out, refused, waterBranches, usesVs, usesEquationFit, ...(oaSpec ? { oaSpec } : {}) };
}

/** THE OUTDOOR-AIR SYSTEM (user, 2026-09-13: "a heat reclaim unit for outside air, with a static media exchanger and not a separate
 *  conditioning process. It is not a DOAS unit"). The engine's own shape (TermRhGenericOAHeatRecMinExh.idf): an
 *  AirLoopHVAC:OutdoorAirSystem on the supply branch AHEAD of the unit, its equipment list holding the core FIRST and then the
 *  OutdoorAir:Mixer, a Controller:OutdoorAir with no economizer, and the outdoor node declared. The core's supply side is the
 *  outdoor air (outdoor node → core → the mixer's outdoor-air stream); its exhaust side is the mixer's RELIEF (the return air the
 *  mixer lets go) → core → outdoors — no exhaust fan, no zone plumbing: the relief node is named by the mixer, the controller and
 *  the core. A static core: no outlet-temperature control, no economizer lockout (the engine's default would lock it out), no
 *  power of its own (the main fan draws through it). THE OUTDOOR AIR IS SIZED, never left to autosize alone: with no
 *  DesignSpecification:OutdoorAir on the zones the engine sizes it silently to zero (SimAirServingZones.cc:4605-5053), so one is
 *  written per air loop at the resolver's rate and every zone the unit serves is sized on it. */
export { HX_EXAMPLE };

/** A STAND-ALONE ERV (user, 2026-10-07: the ERV runs continuously on its own fans, exhausting the baths and supplying outdoor air that
 *  migrates into the space through the idle heat pump's return; "There should be no EA or OA adjustment to the conditioning heat pump").
 *  The engine's own shape (SingleFamilyHouse_HP_Slab.idf, ERV_unit1): ZoneHVAC:EnergyRecoveryVentilator — outdoors → the core → the
 *  supply fan → the zone; the zone's exhaust → the core → the exhaust fan → outdoors, balanced, on the card's own availability schedule.
 *  The card's effectiveness as typed; its electric power, scaled to this zone's share of the rated flow, is the two fans' (half each,
 *  the pressure rise back-solved at the example's 0.6 total efficiency), the core itself drawing none — the power counted once. */
export function standaloneErv(schema: EpSchema, core: { cls: string; fields?: SystemFields }, name: string, q: number, card?: string): { objects: ResolvedObject[]; refused: string[]; name: string; supplyNode: string; exhaustNode: string } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const f = core.fields ?? {};
  const rated = typeof f.nominal_supply_air_flow_rate === "number" ? f.nominal_supply_air_flow_rate : q;
  const watts = typeof f.nominal_electric_power === "number" ? f.nominal_electric_power * (q / rated) : 0;
  const eff = 0.6, dp = watts > 0 ? (watts / 2) * eff / q : 0;
  const sched = typeof f.availability_schedule_name === "string" ? f.availability_schedule_name : "";
  // the card's schedule (a marker, `@schedule:file|name`) on the fans and the unit as on the core — the writer resolves it
  const schedRuled: SystemFields | undefined = sched ? { availability_schedule_name: sched } : undefined;
  const n = { oa: `${name} OA Node`, supFanIn: `${name} Sup Fan Inlet`, supply: `${name} Supply Node`, zoneEx: `${name} Zone Exhaust Node`, exFanIn: `${name} Exh Fan Inlet`, exOut: `${name} Exh Outlet Node` };
  out.push(rawObject("OutdoorAir:NodeList", `${name} outdoor air nodes`, [["node_or_nodelist_name_1", n.oa, code]]));
  const hx = objectOf(schema, core.cls, `${name} Core`, { ...f, nominal_supply_air_flow_rate: q, nominal_electric_power: 0 }, {
    availability_schedule_name: "", sensible_effectiveness_at_100_heating_air_flow: HX_EXAMPLE.sensible, latent_effectiveness_at_100_heating_air_flow: HX_EXAMPLE.latent,
    sensible_effectiveness_at_100_cooling_air_flow: HX_EXAMPLE.sensible, latent_effectiveness_at_100_cooling_air_flow: HX_EXAMPLE.latent,
    supply_air_inlet_node_name: n.oa, supply_air_outlet_node_name: n.supFanIn, exhaust_air_inlet_node_name: n.zoneEx, exhaust_air_outlet_node_name: n.exFanIn,
    supply_air_outlet_temperature_control: "No", heat_exchanger_type: "Plate", frost_control_type: "None", economizer_lockout: "No",
  });
  if (hx) out.push(hx); else refused.push(`${core.cls} is not in the schema`);
  const fan = (fname: string, inN: string, outN: string, inAir: number): void => {
    const o = objectOf(schema, "Fan:OnOff", fname, schedRuled, {
      fan_total_efficiency: eff, pressure_rise: Number(dp.toPrecision(6)), maximum_flow_rate: q, motor_efficiency: 1,
      motor_in_airstream_fraction: inAir, air_inlet_node_name: inN, air_outlet_node_name: outN, end_use_subcategory: card ? sanitizeIdfName(card) : "Ventilation",
    });
    if (o) out.push(o); else refused.push("Fan:OnOff is not in the schema");
  };
  fan(`${name} Sup Fan`, n.supFanIn, n.supply, 1);
  fan(`${name} Exh Fan`, n.exFanIn, n.exOut, 0);
  const erv = objectOf(schema, "ZoneHVAC:EnergyRecoveryVentilator", name, schedRuled, {
    heat_exchanger_name: `${name} Core`, supply_air_flow_rate: q, exhaust_air_flow_rate: q,
    supply_air_fan_name: `${name} Sup Fan`, exhaust_air_fan_name: `${name} Exh Fan`,
  });
  if (erv) out.push(erv); else refused.push("ZoneHVAC:EnergyRecoveryVentilator is not in the schema");
  return { objects: out, refused, name, supplyNode: n.supply, exhaustNode: n.zoneEx };
}
export function outdoorAirSystem(schema: EpSchema, A: GenAirLoop, id: string): { objects: ResolvedObject[]; refused: string[]; spec: string } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const core = A.oa!.core, coreName = `${id} Heat Recovery Core`, spec = `${id} outdoor air`;
  if (A.oa!.perAreaM3sM2 === undefined) refused.push(`${A.id}'s outdoor-air rate is not stated — the engine would size its outdoor air to zero`);
  out.push(rawObject("OutdoorAir:NodeList", `${id} outdoor air nodes`, [["node_or_nodelist_name_1", nodes.oaInlet(id), code]]));
  // a rated ERV (2026-10-07): the core's nominal flow is this unit's share of the rating, the controller's minimum the same — OA = EA
  const share = A.oa!.minM3s;
  const hx = objectOf(schema, core.cls, coreName, share !== undefined ? { ...core.fields, nominal_supply_air_flow_rate: share } : core.fields, {
    availability_schedule_name: "", nominal_supply_air_flow_rate: "autosize",
    sensible_effectiveness_at_100_heating_air_flow: HX_EXAMPLE.sensible, latent_effectiveness_at_100_heating_air_flow: HX_EXAMPLE.latent,
    sensible_effectiveness_at_100_cooling_air_flow: HX_EXAMPLE.sensible, latent_effectiveness_at_100_cooling_air_flow: HX_EXAMPLE.latent,
    supply_air_inlet_node_name: nodes.oaInlet(id), supply_air_outlet_node_name: nodes.hrOut(id),
    exhaust_air_inlet_node_name: nodes.relief(id), exhaust_air_outlet_node_name: nodes.hrExhaustOut(id),
    nominal_electric_power: 0, supply_air_outlet_temperature_control: "No", heat_exchanger_type: "Plate", frost_control_type: "None", economizer_lockout: "No",
  });
  if (hx) out.push(hx); else refused.push(`${core.cls} is not in the schema`);
  const mixer = objectOf(schema, "OutdoorAir:Mixer", `${id} OA Mixer`, undefined, {
    mixed_air_node_name: nodes.mixedAir(id), outdoor_air_stream_node_name: nodes.hrOut(id), relief_air_stream_node_name: nodes.relief(id), return_air_stream_node_name: nodes.airSupplyIn(id),
  });
  if (mixer) out.push(mixer); else refused.push("OutdoorAir:Mixer is not in the schema");
  const ctl = objectOf(schema, "Controller:OutdoorAir", `${id} OA Controller`, undefined, {
    relief_air_outlet_node_name: nodes.relief(id), return_air_node_name: nodes.airSupplyIn(id), mixed_air_node_name: nodes.mixedAir(id), actuator_node_name: nodes.oaInlet(id),
    minimum_outdoor_air_flow_rate: share ?? "autosize", maximum_outdoor_air_flow_rate: "autosize", economizer_control_type: "NoEconomizer",
    lockout_type: "NoLockout", minimum_limit_type: "FixedMinimum", heat_recovery_bypass_control_type: "BypassWhenOAFlowGreaterThanMinimum",
  });
  if (ctl) out.push(ctl); else refused.push("Controller:OutdoorAir is not in the schema");
  out.push(rawObject("AirLoopHVAC:ControllerList", `${id} OA Controllers`, [["name", `${id} OA Controllers`, code], ["controller_1_object_type", "Controller:OutdoorAir", dataset], ["controller_1_name", `${id} OA Controller`, code]]));
  out.push(rawObject("AirLoopHVAC:OutdoorAirSystem:EquipmentList", `${id} OA Equipment`, [["name", `${id} OA Equipment`, code],
    ["component_1_object_type", core.cls, dataset], ["component_1_name", coreName, code], ["component_2_object_type", "OutdoorAir:Mixer", dataset], ["component_2_name", `${id} OA Mixer`, code]]));
  out.push(rawObject("AirLoopHVAC:OutdoorAirSystem", `${id} OA System`, [["name", `${id} OA System`, code], ["controller_list_name", `${id} OA Controllers`, code], ["outdoor_air_equipment_list_name", `${id} OA Equipment`, code]]));
  const ds = objectOf(schema, "DesignSpecification:OutdoorAir", spec, undefined, { outdoor_air_method: "Flow/Area", outdoor_air_flow_per_zone_floor_area: A.oa!.perAreaM3sM2 ?? 0 });
  if (ds) out.push(ds); else refused.push("DesignSpecification:OutdoorAir is not in the schema");
  return { objects: out, refused, spec };
}

/** THE COILS' PERFORMANCE CURVES ARE READ, NOT AUTHORED. `DataSets/WaterToAirHeatPumps.idf` beside the engine carries a
 *  ClimateMaster TCH072 in three duties; the GLHP set is the ground-loop one (15 % methanol), and its banner is the citation.
 *  NOTE the dataset's own name for the heating power curve is `TCH07_GLHP_HTG_PWRFT` — missing its "2" — so the lookup matches
 *  the FILE, not the pattern. The part-load fraction curves are not in the dataset; they are the engine's own example values
 *  (HeatPumpWaterToAirEquationFit.idf: 0.75 + 0.25·PLR, the standard cycling loss), stated as such. */
/** the dataset's OWN rated conditions for the ground-loop set, read from its banner — a curve is normalised to 1.0 at the
 *  conditions its author rated it at, and with the schema's defaults instead the engine reported the heating capacity curve
 *  54 % out at rated (measured 2026-09-11). Cooling 70.29 kBtu/h at 77 °F water, 80.6/66.2 °F air, EER 14.35 → COP 4.21;
 *  heating 56.14 kBtu/h at 32 °F water, 68 °F air, COP 3.42. */
export const GLHP_RATED = {
  coolWaterC: 25, coolAirDbC: 27, coolAirWbC: 19, coolCop: 4.21,
  heatWaterC: 0, heatAirDbC: 20, heatCop: 3.42,
  heatToCoolCapacityRatio: 0.799,
} as const;
export const GLHP_CURVES = {
  coolCap: "TCH072_GLHP_CLG_CAPFT", coolSens: "TCH072_GLHP_CLG_SENSCAPFT", coolPower: "TCH072_GLHP_CLG_PWRFT",
  heatCap: "TCH072_GLHP_HTG_CAPFT", heatPower: "TCH07_GLHP_HTG_PWRFT",
  coolPlf: "WaterToAir PLF Cooling", heatPlf: "WaterToAir PLF Heating",
} as const;
/** THE VARIABLE-SPEED SPEED SET IS READ FROM THE ENGINE'S OWN EXAMPLE (2026-09-12; user: "I am not sure we can force variable
 *  airflow"). A `VariableSpeedEquationFit` coil is rated speed by speed — per speed a reference-unit capacity, COP, air and water
 *  flow and six curves — and the engine's DataSets state no such set for a residential unit. `ExampleFiles/
 *  VSHeatPumpWaterToAirEquationFit.idf` does: two 10-speed coils under exactly this parent (`AirLoopHVAC:UnitaryHeatPump:
 *  WaterToAir`), which Furnaces.cc runs through SimVariableSpeedHP — the compressor speed AND the supply air flow follow the
 *  load, speed by speed (CoolMassFlowRate(SpeedNum), the Fan:OnOff at FanSpeedRatio). The example's reference unit is small
 *  (1.5–6.8 kW cooling across its speeds); the engine autosizes the capacity at the nominal speed level and scales every
 *  speed to it (MulSpeedFlowScale), so the set is a SHAPE and the house's design load gives it its size. The unit's own
 *  per-speed data, typed in the settings, replaces it field by field. */
export const VS_EXAMPLE = { file: "VSHeatPumpWaterToAirEquationFit.idf", cooling: "Sys 1 Heat Pump Cooling Mode", heating: "Sys 1 Heat Pump Heating Mode" } as const;
/** THE SIZING MARGIN of a wired unit's zones (2026-09-12): sized to the design load exactly (factor 1.0) the variable-speed
 *  unit hit the engine's own Fatal in the weather year — "VS WSHP unit compressor speed calculation failed: speed limits
 *  exceeded" (Furnaces.cc: no speed meets a load past the top speed) — and with the example's own `Sizing:Parameters`
 *  1.3 / 1.3 it ran the year clean (measured). The factor is put on the Sizing:Zone of the zones a wired unit serves, so the
 *  standing model and its design-load instrument never move. */
/** the card's field for the dehumidifying setpoint (% RH) and its default — the first block of the engine's own RH-control example */
export const DEHUMIDIFY_RH_FIELD = "dehumidification_setpoint_rh";
export const DEHUMIDIFY_RH_DEFAULT = { percent: 50, citation: "ExampleFiles/HeatPumpWaterToAirWithRHControl.idf, Dehumidification Seasonal Relative Humidity Sch, through 3/31: 50" } as const;
export const WIRED_SIZING_FACTOR = { heating: 1.3, cooling: 1.3, citation: "ExampleFiles/VSHeatPumpWaterToAirEquationFit.idf, Sizing:Parameters 1.3 / 1.3" } as const;

// ── SETPOINT CONTROL — ONE UNIT, MANY THERMOSTATS (user, 2026-09-13; read from the engine's source). Under `control_type =
// SetPoint` an AirLoopHVAC:UnitarySystem lets the DAMPERS set the flow (each on its own zone's thermostat) and drives each coil to
// the setpoint on that coil's OWN outlet node when a manager names it (UnitarySystem.cc: the coil outlet has priority over the
// unit outlet). Two managers reset the supply to the neediest zone in the mode in force — SetpointManager:Warmest on the cooling
// coil's outlet, SetpointManager:Coldest on the heating coil's — and their RAILS make the other coil idle: with no cooling load
// Warmest gives its maximum, so the maximum sits ABOVE the return air; with no heating load Coldest gives its minimum, so the
// minimum sits BELOW it (SetPointManager.cc:3185-3259). A heat-pump pair is locked out from running both coils in one call
// (UnitarySystem.cc:12779, :14603), cooling first — which is not the zones' VOTE, so:
//
// THE CHANGEOVER ARBITER. The engine has the vote in one object only, its changeover-bypass zoning unit's `priority_control_mode`
// (HVACUnitaryBypassVAV.cc GetZoneLoads: per zone the predicted load, deadband skipped, two signed sums and two counts, a four-way
// tiebreak, a minimum time in a mode) — and that unit takes DX coils only. The same arithmetic is an EMS program: a sensor per
// controlled zone on "Zone Predicted Sensible Load to Setpoint Heat Transfer Rate" (positive = heating, negative = cooling, 0 in
// deadband), an actuator "System Node Setpoint · Temperature Setpoint" on each coil's outlet, and at AfterPredictorAfterHVACManagers
// — once per system timestep, right after the managers have written the nodes — the losing coil's node is forced to its rail
// and the winning coil's is SET … = Null, which hands it back to its manager (EMSManager.cc:343). The unit's control node is bound
// by a real manager only (SetPointManager.cc NodeHasSPMCtrlVarType), so the managers stay and the arbiter sits over them —
// exactly ASHRAE901_OfficeLarge_STD2019_Denver.idf's EMS over its heating-coil manager, NULL to release.
//
// THE CONTROLLER (user, 2026-09-13, evening: "receives a cooling or heating mode signal (based on polling) with setpoints per mode;
// if all thermostats are satisfied, the unit stops until it receives a demand"). Three things follow. The vote defaults to the COUNT
// of zones calling (a tie to the larger total, then heating). A supply setpoint typed per mode is HELD — a SetpointManager:Scheduled
// on a constant, the shape of the engine's own 5Zone_Unitary_*.idf — in place of the reset. And while no zone calls the arbiter
// FORCES THE LOOP OFF through a third actuator, "AirLoopHVAC · <loop> · Availability Status" (EMSManager.cc:1650-1656; ForceOff sets
// TurnFansOff in SimAirServingZones.cc:2533, so the fan and everything on the loop stop; 0 NoAction · 1 ForceOff · 2 CycleOn,
// SystemAvailabilityManager.hh:73 — written as numbers, as the engine's EMSDemandManager_LargeOffice.idf:8336 defines them).
/** the supply-air rails: 12.8 °C (55 °F) the usual cooling supply, 30 above any return air; 10 below any return air, 45 the warm end of a water-to-air unit's supply */
export const SETPOINT_RAILS = { coolingMinC: 12.8, coolingMaxC: 30, heatingMinC: 10, heatingMaxC: 45 } as const;
/** the variable-volume fan's power curve and minimum fraction: the engine's own multi-zone VAV example */
export const FAN_VV_EXAMPLE = { coefficients: [0.0015302446, 0.0052080574, 1.1086242, -0.11635563, 0] as const, minimumFlowFraction: 0.25, citation: "ExampleFiles/5Zone_Unitary_HXAssistedCoil.idf, Fan:VariableVolume Supply Fan 1" } as const;
/** the least time in a mode before the vote may flip it — the zoning unit's own `minimum_runtime_before_operating_mode_change` default */
export const CHANGEOVER_MIN_HOURS = 0.25;
export const CHANGEOVER_CITATION = "the engine's zoning unit (AirLoopHVAC:UnitaryHeatCool:VAVChangeoverBypass priority_control_mode, HVACUnitaryBypassVAV.cc GetZoneLoads) transcribed to an EMS program";
/** an Erl name: letters, digits and underscores, starting with a letter — the identifier the runtime language takes */
export const erlName = (s: string): string => { const x = s.replace(/[^A-Za-z0-9_]/g, "_"); return /^[A-Za-z]/.test(x) ? x : `E_${x}`; };
/** THE ARBITER'S PROGRAM, line by line — the zoning unit's arithmetic, for n controlled zones; no comma anywhere (a comma ends an IDF field) */
export function arbiterLines(erl: string, n: number, changeover: NonNullable<WiredAirLoop["changeover"]>, coolAct: string, heatAct: string, mode: string, last: string, avail: string, on: string): string[] {
  const v = (s: string): string => `${erl}_${s}`;
  const QC = v("QC"), QH = v("QH"), NC = v("NC"), NH = v("NH"), AC = v("AC"), WANT = v("WANT"), NOW = v("NOW");
  const L: string[] = [`SET ${QC} = 0`, `SET ${QH} = 0`, `SET ${NC} = 0`, `SET ${NH} = 0`];
  // the zones' demands, summed by sign and counted; a load under 1 W (the engine's SmallLoad) is no call
  for (let i = 1; i <= n; i++) { const q = `${erl}_Q${i}`; L.push(`IF ${q} < -1`, `SET ${QC} = ${QC} + ${q}`, `SET ${NC} = ${NC} + 1`, `ELSEIF ${q} > 1`, `SET ${QH} = ${QH} + ${q}`, `SET ${NH} = ${NH} + 1`, `ENDIF`); }
  L.push(`SET ${AC} = @Abs ${QC}`, `SET ${WANT} = 0`);
  const cool = `SET ${WANT} = -1`, heat = `SET ${WANT} = 1`;
  // every tie ends in HEATING (the user's rule, 2026-09-13: "if tied heating wins"); the engine's zoning unit ends its in cooling
  if (changeover === "LoadPriority") L.push(`IF (${AC} > ${QH}) && (${QC} < 0)`, cool, `ELSEIF (${QH} > ${AC}) && (${QH} > 0)`, heat, `ELSEIF ${NH} > ${NC}`, heat, `ELSEIF ${NC} > ${NH}`, cool, `ELSEIF ${QH} > 0`, heat, `ELSEIF ${QC} < 0`, cool, `ENDIF`);
  else if (changeover === "ZonePriority") L.push(`IF (${NH} > ${NC}) && (${QH} > 0)`, heat, `ELSEIF (${NC} > ${NH}) && (${QC} < 0)`, cool, `ELSEIF (${AC} > ${QH}) && (${QC} < 0)`, cool, `ELSEIF (${QH} > ${AC}) && (${QH} > 0)`, heat, `ELSEIF ${QH} > 0`, heat, `ELSEIF ${QC} < 0`, cool, `ENDIF`);
  else if (changeover === "CoolingPriority") L.push(`IF ${QC} < 0`, cool, `ELSEIF ${QH} > 0`, heat, `ENDIF`);
  else L.push(`IF ${QH} > 0`, heat, `ELSEIF ${QC} < 0`, cool, `ENDIF`);
  // the mode: taken at once from idle, held for the minimum time otherwise; no call at all releases both coils to their managers
  L.push(`SET ${NOW} = (DayOfYear * 24) + CurrentTime`,
    `IF ${WANT} == 0`, `SET ${mode} = 0`,
    `ELSEIF ${mode} == 0`, `SET ${mode} = ${WANT}`, `SET ${last} = ${NOW}`,
    `ELSEIF (${WANT} <> ${mode}) && ((${NOW} - ${last}) >= ${CHANGEOVER_MIN_HOURS})`, `SET ${mode} = ${WANT}`, `SET ${last} = ${NOW}`,
    `ENDIF`);
  // the losing coil to its rail, the winning coil handed back to its manager; the LOOP FORCED OFF while no zone calls (the
  // controller: "if all thermostats are satisfied the unit stops") — Availability Status 0 NoAction · 1 ForceOff
  // (`on` is the plain running flag reported beside the signed mode: a changeover inside an hour averages the MODE to zero
  // while the unit ran the whole hour — measured 2026-09-13, 16 such hours — so the fan is tested against the flag)
  L.push(`IF ${mode} < 0`, `SET ${heatAct} = ${SETPOINT_RAILS.heatingMinC}`, `SET ${coolAct} = Null`, `SET ${avail} = 0`, `SET ${on} = 1`,
    `ELSEIF ${mode} > 0`, `SET ${coolAct} = ${SETPOINT_RAILS.coolingMaxC}`, `SET ${heatAct} = Null`, `SET ${avail} = 0`, `SET ${on} = 1`,
    `ELSE`, `SET ${coolAct} = Null`, `SET ${heatAct} = Null`, `SET ${avail} = 1`, `SET ${on} = 0`, `ENDIF`);
  return L;
}
/** the managers, the arbiter and its hourly mode — everything SetPoint control needs beyond the parent and the dampers */
export function setPointControl(schema: EpSchema, A: GenAirLoop, id: string, loopName: string): { objects: ResolvedObject[]; refused: string[] } {
  const out: ResolvedObject[] = [], refused: string[] = [];
  const mgr = (cls: "SetpointManager:Warmest" | "SetpointManager:Coldest", name: string, node: string): void => {
    const cold = cls === "SetpointManager:Coldest";
    const o = objectOf(schema, cls, name, undefined, {
      control_variable: "Temperature", hvac_air_loop_name: loopName,
      minimum_setpoint_temperature: cold ? SETPOINT_RAILS.heatingMinC : SETPOINT_RAILS.coolingMinC, maximum_setpoint_temperature: cold ? SETPOINT_RAILS.heatingMaxC : SETPOINT_RAILS.coolingMaxC,
      strategy: cold ? "MinimumTemperature" : "MaximumTemperature", setpoint_node_or_nodelist_name: node,
    });
    if (o) out.push(o); else refused.push(`${cls} is not in the schema`);
  };
  // a setpoint HELD per mode (the controller's own): a Scheduled manager on a constant, the shape of the engine's 5Zone_Unitary_*.idf
  const limits = `${id} supply temperature`, made = new Set<string>();
  const held = (mode: "cooling" | "heating", name: string, node: string, valueC: number): void => {
    if (!made.has(limits)) { made.add(limits); out.push(rawObject("ScheduleTypeLimits", limits, [["name", limits, code], ["lower_limit_value", -60, dataset], ["upper_limit_value", 200, dataset], ["numeric_type", "Continuous", dataset], ["unit_type", "Temperature", dataset]])); }
    const sched = `${id} ${mode} supply`;
    if (!made.has(sched)) { made.add(sched); out.push(rawObject("Schedule:Constant", sched, [["name", sched, code], ["schedule_type_limits_name", limits, code], ["hourly_value", valueC, "user"]])); }
    const o = objectOf(schema, "SetpointManager:Scheduled", name, undefined, { control_variable: "Temperature", schedule_name: sched, setpoint_node_or_nodelist_name: node });
    if (o) out.push(o); else refused.push("SetpointManager:Scheduled is not in the schema");
  };
  // a manager on EACH coil's outlet (the precedent: SingleFamilyHouse_TwoSpeed_MultiStageElectricSuppCoil_SPControl.idf — the
  // heating manager on the heating coil's outlet and on the unit's, for the supplemental coil): held when typed, else the reset
  const sp = A.setpoints ?? { cooling: "Warmest", heating: "Coldest" };
  if (sp.cooling === "Scheduled" && sp.coolingSupplyC !== undefined) held("cooling", `${id} cooling setpoint`, nodes.coolOut(id), sp.coolingSupplyC);
  else mgr("SetpointManager:Warmest", `${id} cooling setpoint`, nodes.coolOut(id));
  if (sp.heating === "Scheduled" && sp.heatingSupplyC !== undefined) { held("heating", `${id} heating setpoint`, nodes.heatOut(id), sp.heatingSupplyC); if (A.supplemental) held("heating", `${id} supplemental setpoint`, nodes.airSupply(id), sp.heatingSupplyC); }
  else { mgr("SetpointManager:Coldest", `${id} heating setpoint`, nodes.heatOut(id)); if (A.supplemental) mgr("SetpointManager:Coldest", `${id} supplemental setpoint`, nodes.airSupply(id)); }
  // the arbiter: the controlled zones report (a T-off zone has no thermostat and nothing to report)
  const erl = erlName(id);
  const zones = A.terminals.map((t) => t.zone).filter((z) => !(A.uncontrolled ?? []).includes(z));
  const q = (i: number): string => `${erl}_Q${i + 1}`;
  for (const [i, z] of zones.entries()) out.push(rawObject("EnergyManagementSystem:Sensor", q(i), [["name", q(i), code], ["output_variable_or_output_meter_index_key_name", "", code, { zone: z }], ["output_variable_or_output_meter_name", "Zone Predicted Sensible Load to Setpoint Heat Transfer Rate", dataset]]));
  const coolAct = `${erl}_CoolSP`, heatAct = `${erl}_HeatSP`, mode = `${erl}_Mode`, last = `${erl}_LastChange`;
  for (const [act, node] of [[coolAct, nodes.coolOut(id)], [heatAct, nodes.heatOut(id)]] as const) out.push(rawObject("EnergyManagementSystem:Actuator", act, [["name", act, code], ["actuated_component_unique_name", node, code], ["actuated_component_type", "System Node Setpoint", dataset], ["actuated_component_control_type", "Temperature Setpoint", dataset]]));
  // the loop's availability — the unit STOPS while no zone calls (the controller); 0 NoAction · 1 ForceOff
  const availAct = `${erl}_Avail`;
  out.push(rawObject("EnergyManagementSystem:Actuator", availAct, [["name", availAct, code], ["actuated_component_unique_name", loopName, code], ["actuated_component_type", "AirLoopHVAC", dataset], ["actuated_component_control_type", "Availability Status", dataset]]));
  out.push(rawObject("EnergyManagementSystem:GlobalVariable", `${id} arbiter`, [["erl_variable_name_1", mode, code], ["erl_variable_name_2", last, code]]));
  const prog = `${erl}_changeover`;   // an EMS program's NAME is an Erl identifier too — the engine refuses a space or a hyphen in it (measured 2026-09-13)
  out.push(rawObject("EnergyManagementSystem:Program", prog, [["name", prog, code], ...arbiterLines(erl, zones.length, A.changeover ?? "ZonePriority", coolAct, heatAct, mode, last, availAct, `${erl}_On`).map((l, i) => [`program_line_${i + 1}`, l, dataset] as [string, string, Source])]));
  out.push(rawObject("EnergyManagementSystem:ProgramCallingManager", `${prog} manager`, [["name", `${prog} manager`, code], ["energyplus_model_calling_point", "AfterPredictorAfterHVACManagers", dataset], ["program_name_1", "", code, { system: prog }]]));
  // the mode read back hour by hour (key "EMS" in the run's SQL): −1 cooling · 0 idle · +1 heating
  const ov = `${id} mode`;
  out.push(rawObject("EnergyManagementSystem:OutputVariable", ov, [["name", ov, code], ["ems_variable_name", mode, code], ["type_of_data_in_variable", "Averaged", dataset], ["update_frequency", "SystemTimestep", dataset], ["ems_program_or_subroutine_name", "", code, { system: prog }]]));
  out.push(rawObject("Output:Variable", `${ov} hourly`, [["key_value", "EMS", dataset], ["variable_name", "", code, { system: ov }], ["reporting_frequency", "Hourly", dataset]]));
  const run = `${id} running`;   // 1 in a mode, 0 idle — the fraction of the hour the unit ran
  out.push(rawObject("EnergyManagementSystem:OutputVariable", run, [["name", run, code], ["ems_variable_name", `${erl}_On`, code], ["type_of_data_in_variable", "Averaged", dataset], ["update_frequency", "SystemTimestep", dataset], ["ems_program_or_subroutine_name", "", code, { system: prog }]]));
  out.push(rawObject("Output:Variable", `${run} hourly`, [["key_value", "EMS", dataset], ["variable_name", "", code, { system: run }], ["reporting_frequency", "Hourly", dataset]]));
  if (!zones.length) refused.push(`${A.id} is SetPoint-controlled and no zone it feeds has its thermostat on — the arbiter has no demand to read; switch a Zone's T on`);
  return { objects: out, refused };
}
export interface VsSet { cooling: Record<string, string> | null; heating: Record<string, string> | null; curves: ResolvedObject[]; missing: string[]; citation: string }
export function variableSpeedSet(schema: EpSchema, objects: Array<{ cls: string; name: string; fields: string[]; file?: string }>): VsSet {
  const keyed = (cls: string, name: string): Record<string, string> | null => {
    const o = objects.find((x) => x.cls === cls && x.name === name), c = schema.classOf(cls);
    if (!o || !c) return null;
    const out: Record<string, string> = {};
    c.fields.forEach((f, i) => { const v = o.fields[i]; if (v !== undefined) out[f.key] = v; });
    return out;
  };
  // the speed data: every field from `number_of_speeds` on, the nominal level's capacity and flows left to the engine (autosized)
  const speeds = (o: Record<string, string> | null): Record<string, string> | null => {
    if (!o) return null;
    const out: Record<string, string> = {};
    let on = false;
    for (const [k, v] of Object.entries(o)) {
      if (k === "number_of_speeds") on = true;
      if (!on || /at_selected_nominal_speed_level$/.test(k)) continue;
      out[k] = v;
    }
    return out;
  };
  const cool = speeds(keyed("Coil:Cooling:WaterToAirHeatPump:VariableSpeedEquationFit", VS_EXAMPLE.cooling));
  const heat = speeds(keyed("Coil:Heating:WaterToAirHeatPump:VariableSpeedEquationFit", VS_EXAMPLE.heating));
  const missing: string[] = [];
  if (!cool) missing.push(`${VS_EXAMPLE.cooling} (the example's cooling coil)`);
  if (!heat) missing.push(`${VS_EXAMPLE.heating} (the example's heating coil)`);
  const curveNames = new Set<string>();
  for (const o of [cool, heat]) if (o) for (const [k, v] of Object.entries(o)) if (/_curve_name$/.test(k) && v) curveNames.add(v);
  const curves: ResolvedObject[] = [];
  for (const n of curveNames) {
    const o = objects.find((x) => x.name === n && x.cls.startsWith("Curve:"));
    if (!o) { missing.push(`curve ${n}`); continue; }
    curves.push(rawObject(o.cls, o.name, o.fields.map((v, i) => [i === 0 ? "name" : `field_${i}`, v, dataset] as [string, string, Source])));
  }
  return { cooling: cool, heating: heat, curves, missing, citation: `the engine's own example ExampleFiles/${VS_EXAMPLE.file} (${VS_EXAMPLE.cooling} / ${VS_EXAMPLE.heating}: 10 speeds, autosized at the nominal speed and scaled)` };
}
export function waterToAirCurves(objects: Array<{ cls: string; name: string; fields: string[]; provenance?: string }>): { objects: ResolvedObject[]; missing: string[]; citation: string } {
  const out: ResolvedObject[] = [], missing: string[] = [];
  const wanted = [GLHP_CURVES.coolCap, GLHP_CURVES.coolSens, GLHP_CURVES.coolPower, GLHP_CURVES.heatCap, GLHP_CURVES.heatPower];
  let citation = "";
  for (const want of wanted) {
    const o = objects.find((x) => x.name.toUpperCase() === want.toUpperCase());
    if (!o) { missing.push(want); continue; }
    if (!citation && o.provenance) citation = o.provenance;
    out.push(rawObject(o.cls, o.name, o.fields.map((v, i) => [i === 0 ? "name" : `field_${i}`, v, dataset] as [string, string, Source])));
  }
  // the cycling-loss curves the dataset does not carry: the engine's own example, stated
  for (const n of [GLHP_CURVES.coolPlf, GLHP_CURVES.heatPlf]) {
    out.push(rawObject("Curve:Quadratic", n, [["name", n, dataset], ["coefficient1_constant", "0.75", dataset], ["coefficient2_x", "0.25", dataset],
      ["coefficient3_x_2", "0.0", dataset], ["minimum_value_of_x", "0.0", dataset], ["maximum_value_of_x", "1.0", dataset]]));
  }
  return { objects: out, missing, citation: citation || "DataSets/WaterToAirHeatPumps.idf (ClimateMaster TCH072, ground loop)" };
}
