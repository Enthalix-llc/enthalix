// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ENGINE'S OWN SCHEMA (2026-09-10). Energy+.schema.epJSON sits beside the
// binary: 858 object classes, every field with its IDD order, label,
// default, choices, units and note. The SYSTEMS tab renders an object's
// fields from it — never a hand-typed list — so what the screen offers is
// what the engine takes. Read once (10 MB), the ~30 classes SYSTEMS offers
// kept (~1 MB), the rest dropped. Two facts a screen must handle, both
// measured in the file: an autosizable field is a union of a number and the
// string "Autosize" (the IDF takes lowercase `autosize`), and every enum
// carries "" for blank and is sorted alphabetically, not in IDD key order.

import { readIddConversions, type IpConversions } from "./units.js";

export const SCHEMA_FILE = "Energy+.schema.epJSON";
export { IDD_FILE } from "./units.js";

export interface EpField {
  key: string; label: string; type: "a" | "n";
  kind: "enum" | "number" | "string" | "object";
  default: string | number | null;
  enum: string[] | null;
  units: string | null; ipUnits: string | null;
  autosizable: boolean; autocalculatable: boolean; required: boolean;
  note: string | null;
  min: number | null; max: number | null; exclusiveMin: boolean; exclusiveMax: boolean;
  objectList: string[] | null;
}
/** `extensibles` is the schema's own repeating group (a Branch's component quartet, a BranchList's names), so a positional
 *  IDF field past the fixed ones can be named: the system QA reads the written IDF back through it (2026-09-12) */
export interface EpClass { cls: string; group: string; memo: string; minFields: number | null; hasName: boolean; fields: EpField[]; extensibleSize: number | null; extensibles: string[] | null }
export interface EpSchema {
  version: string; classes: number; kept: number; bytes: number;
  has(cls: string): boolean;
  classOf(cls: string): EpClass | null;
  fieldsOf(cls: string): EpField[];
  defaultOf(cls: string, key: string): string | number | null;
  /** the IDD header's IP conversion tables (2026-09-13 night: every input in the user's units), read beside the schema; null when the IDD was not read */
  conversions: IpConversions | null;
  /** the engine's version as the IDD's own Version object defaults it ("25.2"); null when the IDD was not read */
  engineVersion: string | null;
  census: string;
}

/** the classes the SYSTEMS tab offers or emits — the residential map of the report, tier 1 */
export const SYSTEM_CLASSES: readonly string[] = [
  "HVACTemplate:Thermostat", "HVACTemplate:Zone:IdealLoadsAirSystem", "HVACTemplate:Zone:PTHP", "HVACTemplate:Zone:PTAC", "HVACTemplate:Zone:BaseboardHeat",
  "HVACTemplate:Zone:Unitary", "HVACTemplate:System:Unitary", "HVACTemplate:System:UnitaryHeatPump:AirToAir", "HVACTemplate:Zone:WaterToAirHeatPump", "HVACTemplate:Plant:MixedWaterLoop",
  "HVACTemplate:Plant:Boiler", "HVACTemplate:Plant:Tower", "HVACTemplate:Plant:HotWaterLoop", "HVACTemplate:System:DedicatedOutdoorAir",
  "ZoneVentilation:DesignFlowRate", "ZoneList", "DesignSpecification:OutdoorAir",
  "Lights", "Exterior:Lights", "ElectricEquipment", "Exterior:FuelEquipment",
  "Generator:PVWatts", "ElectricLoadCenter:Distribution", "ElectricLoadCenter:Generators", "ElectricLoadCenter:Inverter:PVWatts", "ElectricLoadCenter:Storage:Simple",
  "WaterHeater:Mixed", "WaterHeater:Stratified", "WaterHeater:HeatPump:WrappedCondenser", "WaterHeater:Sizing", "Coil:WaterHeating:AirToWaterHeatPump:Wrapped", "Fan:OnOff",
  // the engine offers no HVACTemplate for a unit heater (user, 2026-09-11: the garage EUH), so its objects are written in full
  "ZoneHVAC:UnitHeater", "Coil:Heating:Electric",
  // THE COMPONENT CATALOGUE (user, 2026-09-11): a card is one EnergyPlus object, so the classes the bench offers are kept whole —
  // see epCatalogue.ts, whose CATALOGUE must be a subset of this list (the gate asserts it)
  "ZoneHVAC:WaterToAirHeatPump", "ZoneHVAC:Baseboard:Convective:Electric", "ZoneHVAC:Baseboard:Convective:Water", "ZoneHVAC:IdealLoadsAirSystem",
  "AirLoopHVAC:UnitarySystem", "AirLoopHVAC:UnitaryHeatPump:WaterToAir",
  "AirTerminal:SingleDuct:VAV:NoReheat", "AirTerminal:SingleDuct:ConstantVolume:NoReheat", "Fan:SystemModel",
  // THE MULTI-THERMOSTAT SHAPE (2026-09-13): the damper that opens for heating too (no coil in it), the variable-volume fan the
  // schema's own note asks for under setpoint control, the two reset managers, and the changeover arbiter's EMS objects
  "AirTerminal:SingleDuct:VAV:HeatAndCool:NoReheat", "Fan:VariableVolume", "SetpointManager:Warmest", "SetpointManager:Coldest",
  "EnergyManagementSystem:Sensor", "EnergyManagementSystem:Actuator", "EnergyManagementSystem:GlobalVariable", "EnergyManagementSystem:Program",
  "EnergyManagementSystem:ProgramCallingManager", "EnergyManagementSystem:OutputVariable", "Output:EnergyManagementSystem", "Output:Variable",
  "Coil:Cooling:WaterToAirHeatPump:EquationFit", "Coil:Heating:WaterToAirHeatPump:EquationFit",
  "Coil:Cooling:WaterToAirHeatPump:VariableSpeedEquationFit", "Coil:Heating:WaterToAirHeatPump:VariableSpeedEquationFit", "Coil:Heating:Fuel",
  "PlantLoop", "CondenserLoop", "Pump:ConstantSpeed", "Pump:VariableSpeed", "Boiler:HotWater", "CoolingTower:SingleSpeed",
  "GroundHeatExchanger:System", "GroundHeatExchanger:Vertical:Properties", "GroundHeatExchanger:Vertical:Array",
  "Site:GroundTemperature:Undisturbed:KusudaAchenbach",
  // THE EXCHANGER'S SUBSETS and the other types (user, 2026-09-14): the boreholes one by one, the field designed by the engine, stated response
  // factors, the two other ground models; the slinky, the pond, the surface, the trench; the fluid-to-fluid exchanger (offered, refused)
  "GroundHeatExchanger:Vertical:Single", "GroundHeatExchanger:Vertical:Sizing:Rectangle", "GroundHeatExchanger:ResponseFactors", "SizingPeriod:WeatherFileDays",
  "Site:GroundTemperature:Undisturbed:FiniteDifference", "Site:GroundTemperature:Undisturbed:Xing",
  "GroundHeatExchanger:Slinky", "GroundHeatExchanger:Pond", "GroundHeatExchanger:Surface", "GroundHeatExchanger:HorizontalTrench", "HeatExchanger:FluidToFluid",
  // the unit heater's inputs (2026-09-14): the fans it takes and the night-cycle manager on its assignment list
  "Fan:ConstantVolume", "AvailabilityManager:NightCycle",
  // heat recovery and exhaust (user, 2026-09-11): the core, the zone ERV that wraps one, the zone exhaust fan, and the
  // outdoor-air system a central core sits in — the core's EXHAUST side is fed by RELIEF air, which is return air
  "HeatExchanger:AirToAir:SensibleAndLatent", "ZoneHVAC:EnergyRecoveryVentilator", "ZoneHVAC:EnergyRecoveryVentilator:Controller", "Fan:ZoneExhaust",
  "AirLoopHVAC:OutdoorAirSystem", "AirLoopHVAC:OutdoorAirSystem:EquipmentList", "OutdoorAir:Mixer", "OutdoorAir:Node",
  "Controller:OutdoorAir", "AirLoopHVAC:ControllerList", "ZoneAirMassFlowConservation",
  // the WIRING the generator writes — never a card on the bench, always derived from what is drawn
  "AirLoopHVAC", "AirLoopHVAC:SupplyPath", "AirLoopHVAC:ReturnPath", "AirLoopHVAC:ZoneSplitter", "AirLoopHVAC:ZoneMixer",
  "ZoneHVAC:AirDistributionUnit", "ZoneHVAC:EquipmentList", "ZoneHVAC:EquipmentConnections", "NodeList",
  "Branch", "BranchList", "ConnectorList", "Connector:Splitter", "Connector:Mixer",
  "AvailabilityManagerAssignmentList", "AvailabilityManager:Scheduled",
  "PlantEquipmentOperationSchemes", "PlantEquipmentOperation:Uncontrolled", "PlantEquipmentList",
  "CondenserEquipmentOperationSchemes", "CondenserEquipmentList", "Pipe:Adiabatic",
  "SetpointManager:Scheduled", "SetpointManager:SingleZone:Reheat", "SetpointManager:FollowGroundTemperature", "SetpointManager:MixedAir",
  "Sizing:System", "Sizing:Plant", "Sizing:Zone",
  "ZoneControl:Thermostat", "ThermostatSetpoint:DualSetpoint", "ThermostatSetpoint:SingleHeating", "Schedule:Constant", "ScheduleTypeLimits",
  "Curve:QuadLinear", "Curve:QuintLinear", "Curve:Quadratic", "Curve:Biquadratic",
  "WaterUse:Equipment", "Site:WaterMainsTemperature", "Output:Meter",
];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const strOf = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function readField(key: string, f: Json, info: Json | null, required: Set<string>): EpField {
  const fi = obj(info?.[key]);
  const label = strOf(fi?.field_name) ?? key.replace(/_/g, " ");
  const ftype = (strOf(fi?.field_type) === "n" ? "n" : "a") as "a" | "n";
  // an autosizable field is `anyOf: [{number…}, {string, enum: ["", "Autosize"]}]`
  const anyOf = Array.isArray(f.anyOf) ? (f.anyOf as unknown[]).map(obj).filter((x): x is Json => x !== null) : null;
  const numPart = anyOf?.find((x) => x.type === "number") ?? (f.type === "number" ? f : null);
  const strPart = anyOf?.find((x) => x.type === "string") ?? (f.type === "string" ? f : null);
  const en = Array.isArray(strPart?.enum) ? (strPart!.enum as unknown[]).filter((x): x is string => typeof x === "string") : null;
  const autosizable = !!en?.some((x) => /^autosize$/i.test(x)), autocalculatable = !!en?.some((x) => /^autocalculate$/i.test(x));
  const choices = en ? en.filter((x) => x !== "" && !/^auto(size|calculate)$/i.test(x)) : null;
  const dv = f.default;
  const dflt = typeof dv === "number" ? dv : typeof dv === "string" ? dv : null;
  const kind: EpField["kind"] = choices && choices.length && !numPart ? "enum" : numPart ? "number" : strOf(f.data_type) === "object_list" ? "object" : "string";
  const ol = Array.isArray(f.object_list) ? (f.object_list as unknown[]).filter((x): x is string => typeof x === "string") : null;
  return {
    key, label, type: ftype, kind, default: dflt, enum: choices && choices.length ? choices : null,
    units: strOf(f.units), ipUnits: strOf(f["ip-units"]), autosizable, autocalculatable, required: required.has(key), note: strOf(f.note),
    min: numOf(numPart?.minimum) ?? numOf(numPart?.exclusiveMinimum), max: numOf(numPart?.maximum) ?? numOf(numPart?.exclusiveMaximum),
    exclusiveMin: numOf(numPart?.exclusiveMinimum) !== null, exclusiveMax: numOf(numPart?.exclusiveMaximum) !== null, objectList: ol,
  };
}

/** the schema's text → the classes kept, each with its fields in IDD order; the raw object is dropped */
export function parseEpSchema(text: string, keep: readonly string[] = SYSTEM_CLASSES, iddText?: string | null): EpSchema {
  const conversions = iddText ? readIddConversions(iddText) : null;
  const engineVersion = iddText ? (/^Version,[\s\S]{0,800}?\\default\s+([\d.]+)/m.exec(iddText)?.[1] ?? null) : null;
  const root = JSON.parse(text) as Json;
  const props = obj(root.properties) ?? {};
  const all = Object.keys(props);
  const classes = new Map<string, EpClass>();
  for (const cls of keep) {
    const c = obj(props[cls]);
    if (!c) continue;
    const pp = obj(c.patternProperties);
    const inner = pp ? obj(Object.values(pp)[0]) : null;
    const fieldDefs = obj(inner?.properties) ?? {};
    const required = new Set(Array.isArray(inner?.required) ? (inner!.required as unknown[]).filter((x): x is string => typeof x === "string") : []);
    const legacy = obj(c.legacy_idd);
    const order = Array.isArray(legacy?.fields) ? (legacy!.fields as unknown[]).filter((x): x is string => typeof x === "string") : Object.keys(fieldDefs);
    const info = obj(legacy?.field_info);
    const hasName = obj(c.name) !== null;
    const fields: EpField[] = [];
    if (hasName) fields.push({ key: "name", label: "Name", type: "a", kind: "string", default: null, enum: null, units: null, ipUnits: null, autosizable: false, autocalculatable: false, required: true, note: null, min: null, max: null, exclusiveMin: false, exclusiveMax: false, objectList: null });
    for (const k of order) { const f = obj(fieldDefs[k]); if (f) fields.push(readField(k, f, info, required)); }
    const ext = Array.isArray(legacy?.extensibles) ? (legacy!.extensibles as unknown[]).filter((x): x is string => typeof x === "string") : null;
    classes.set(cls, { cls, group: strOf(c.group) ?? "", memo: strOf(c.memo) ?? "", minFields: numOf(c.min_fields), hasName, fields, extensibleSize: numOf(c.extensible_size), extensibles: ext && ext.length ? ext : null });
  }
  const bytes = text.length;
  const version = strOf(obj(root.epJSON_schema_version) ?? undefined) ?? strOf(root.epJSON_schema_version) ?? "";
  const missing = keep.filter((k) => !classes.has(k));
  const census = `${all.length} classes · the ${keep.length} SYSTEMS offers resolve ${classes.size}/${keep.length}${missing.length ? ` (missing ${missing.join(", ")})` : " ✓"} · fields ${[...classes.values()].reduce((t, c) => t + c.fields.length, 0)}${conversions ? ` · IP conversions ${conversions.list.length} (the IDD's header)` : " · the IDD not read: SI at the eye"}${engineVersion ? ` · engine ${engineVersion} (the IDD's Version default)` : ""}`;
  return {
    version, classes: all.length, kept: classes.size, bytes,
    has: (cls) => classes.has(cls),
    classOf: (cls) => classes.get(cls) ?? null,
    fieldsOf: (cls) => classes.get(cls)?.fields ?? [],
    defaultOf: (cls, key) => classes.get(cls)?.fields.find((f) => f.key === key)?.default ?? null,
    conversions, engineVersion,
    census,
  };
}
/** a field's default the way the IDF writes it: the schema's "Autosize" as `autosize`, a number as its text */
export const idfValue = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : /^auto(size|calculate)$/i.test(v) ? v.toLowerCase() : v);
