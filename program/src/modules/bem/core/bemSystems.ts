// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SYSTEMS, RESOLVED (2026-09-10). A ruling per subsection of the SYSTEMS
// tab becomes the engine's own objects: every field taken from the schema in
// IDD order — the user's value, else a default read out of the file's type
// name, else a cited dataset value, else blank (the engine's own default) —
// with its source beside it. Nothing is authored: a kind the schema does not
// know, a zone the model does not have, a zone claimed twice, a required
// field nobody stated, a plant the memo wants and nobody added — each is
// REFUSED and named, never invented. The writer alone knows the emitted
// names, so a field that must name a zone, a thermostat, a system, a zone
// list or a schedule carries a `ref` for it to resolve.

import { UH_PEAK_VARIABLE } from "./eplusSql.js";
import type { BemInput } from "./bemInput.js";
import type { SystemsRuling, HvacRuling, HvacKind, SystemFields, FieldValue } from "./bemDb.js";
import type { Source } from "./bemIdf.js";
import type { EpSchema, EpField } from "./epSchema.js";
import { isConditioned, sanitizeIdfName } from "./bemIdf.js";
import { SECTION_TREE, CODE_DEFAULT_SYSTEM, type SystemSection } from "./mepFocus.js";
import { HVAC_KINDS } from "./bemDb.js";
import { loopFluidOf, GLYCOL_WORDS, loopDtOf, rhoCpOf, vsWaterAtDt, LOOP_DT_OPTIONS } from "./loopFluid.js";
import { generateAirLoop, generateLoop, groundHeatExchanger, loopSetpoint, waterToAirCurves, variableSpeedSet, GHX_CLASSES, type GenAirLoop, type GenPlantLoop } from "./epAssemble.js";
import { UH_WATER_REFUSAL, UH_FAN_DEFAULT, UH_MANAGER_FIELD } from "./componentForms.js";
import type { IdfObject } from "./idfLib.js";
import type { ScheduleRef } from "./schedules.js";
import { markerRef, markerWord } from "./scheduleMark.js";
import { bedroomsOfFaces, type BedroomMarks } from "./bemGains.js";

/** WHAT A ZONE'S EQUIPMENT CAN DO (user, 2026-09-14: "with the baseboard heater in the garage, the garage is heated but not cooled —
 *  shouldn't that configuration be checked?"): read from the ruling's kind and the fields that switch a coil off. A side the equipment
 *  cannot serve is put out of reach in the IDF and locked on the Zone card; the QA reads the written thermostat against the equipment. */
export type { ZoneCapability } from "./assembly.js";
import type { ZoneCapability } from "./assembly.js";
export { capabilityOf } from "./assembly.js";
import { capabilityOf } from "./assembly.js";
/** a reference the WRITER fills: a zone's emitted name, a thermostat, an emitted system object, the zone list, or a schedule — one of the
 *  writer's own (`always` on, `never` — a constant 0, the way a supplemental heater is switched off), a SCHEDULES role, or ONE OF THE
 *  LIBRARY'S OWN by file and name (user, 2026-09-14: a schedule dropdown on the component's inputs), emitted once and named here */
export interface FieldRef { zone?: string; thermostat?: string; system?: string; zoneList?: string; schedule?: "ventilation" | "always" | "never" | "hvac-availability" | ScheduleRef }
export { SCHEDULE_MARK, scheduleMark, scheduleRefOfMark, markerRef, markerWord } from "./scheduleMark.js";
export interface ResolvedField { key: string; label: string; value: string; source: Source; units: string | null; ref?: FieldRef; note?: string }
export interface ResolvedObject { cls: string; name: string; fields: ResolvedField[]; minFields: number | null }
export interface ResolvedSystem { id: string; section: SystemSection; kind: string; label: string; source: Source; zones: string[]; objects: ResolvedObject[]; refused: string[]; note: string; setting: string }
export interface ResolvedSystems {
  list: ResolvedSystem[];
  /** THE ERVS AGAINST THE CODE (user, 2026-10-07: "So long as the erv air flow exceeds required code OA, then the code OA is not used.
   *  IF the ERV is below OA, then the user needs a warning"): per rated core card, its flow and the ASHRAE 62.2 flow of the floor it serves */
  ervs?: Array<{ coreId: string; ratedCfm: number; codeCfm: number; units: number; areaM2: number; codeWords: string }>;
  /** zone → the hvac ruling that takes it; every other conditioned zone keeps ideal loads */
  zoneSystem: Map<string, string>;
  /** zone → the kind that takes it (an explicit ideal-loads ruling still wants the writer's Sizing:Zone: the expansion writes none for that template) */
  zoneKind: Map<string, HvacKind>;
  /** extra fields on the ideal-loads objects the writer still emits (whole-house heat recovery through the template's own outdoor-air fields), and the class's field keys in IDD order */
  idealLoadsFields: ResolvedField[] | null;
  idealLoadsOrder: string[] | null;
  needSystemSizing: boolean; needPlantSizing: boolean;
  /** the zones served WITHOUT a thermostat (2026-09-12): a Zone card's T off — fed through a terminal by a unit that follows another zone; the writer writes them no ZoneControl:Thermostat */
  uncontrolledZones: Set<string>;
  /** zone → the DesignSpecification:OutdoorAir its unit's outdoor-air system is sized on (2026-09-13); the writer names it on the zone's Sizing:Zone */
  zoneOaSpec: Map<string, string>;
  /** the LIBRARY schedules the systems' fields name by marker (2026-09-14) — the model resolves each to its profile, the writer emits it once */
  schedules: ScheduleRef[];
  /** zone → what its equipment can do (2026-09-14): a baseboard or a unit heater heats only — the writer puts the other side's setpoint out of reach */
  zoneCapability: Map<string, ZoneCapability>;
  unresolved: string[];
}

/** the COP fields are not named alike across the residential kinds (measured in the IDD, 2026-09-10) */
export const COP_FIELDS: Record<HvacKind, { cooling?: string; heating?: string }> = {
  "HVACTemplate:Zone:IdealLoadsAirSystem": {},
  "HVACTemplate:Zone:PTHP": { cooling: "cooling_coil_gross_rated_cop", heating: "heat_pump_heating_coil_gross_rated_cop" },
  "HVACTemplate:Zone:PTAC": { cooling: "cooling_coil_gross_rated_cooling_cop" },
  "HVACTemplate:Zone:BaseboardHeat": {},
  "HVACTemplate:System:Unitary": { cooling: "cooling_coil_gross_rated_cop" },
  "HVACTemplate:System:UnitaryHeatPump:AirToAir": { cooling: "cooling_coil_gross_rated_cop", heating: "heat_pump_heating_coil_rated_cop" },
  "HVACTemplate:Zone:WaterToAirHeatPump": { cooling: "cooling_coil_gross_rated_cop", heating: "heat_pump_heating_coil_gross_rated_cop" },
  "ZoneHVAC:UnitHeater": {},   // electric resistance: an efficiency on its coil, not a COP
  // a ducted parent carries no COP of its own: its COILS do, and the generator sets them from the dataset's rated point
  "AirLoopHVAC:UnitaryHeatPump:WaterToAir": {}, "AirLoopHVAC:UnitarySystem": {},
};
export const HVAC_LABELS: Record<HvacKind, string> = {
  "HVACTemplate:Zone:IdealLoadsAirSystem": "ideal loads",
  "HVACTemplate:Zone:PTHP": "packaged terminal heat pump (a mini-split, one object per zone)",
  "HVACTemplate:Zone:PTAC": "packaged terminal air conditioner (a room AC with a heating coil)",
  "HVACTemplate:Zone:BaseboardHeat": "baseboard heat (electric by ruling; hot water needs a loop)",
  "HVACTemplate:System:Unitary": "furnace + split DX (one system, a zone unit per zone; the heating coil type is required)",
  "HVACTemplate:System:UnitaryHeatPump:AirToAir": "air-source heat pump (one system, a zone unit per zone, electric backup)",
  "HVACTemplate:Zone:WaterToAirHeatPump": "water-to-air heat pump per zone on a mixed-water loop (the WaterFurnace units; the loop's boiler and tower must be stated)",
  "ZoneHVAC:UnitHeater": "electric unit heater, fan-forced, in the zone its Loc connector names (the engine offers no template for one)",
  "AirLoopHVAC:UnitaryHeatPump:WaterToAir": "ducted water-to-air heat pump on its own air loop, its coils on a plant or ground loop",
  "AirLoopHVAC:UnitarySystem": "ducted unitary system on its own air loop: any coils, and Load, SetPoint or SingleZoneVAV control",
};
/** the zones a ducted air system serves, READ: the rooms its air terminals sit in, mapped to the model's zones through the cells (spaceIfc → space) */
export function zonesServedBy(systemName: string, input: BemInput): { zones: string[]; rooms: string[]; terminals: number } {
  const roomToZone = new Map<string, string>();
  for (const f of input.faces) {
    if (f.spaceIfc && f.space) roomToZone.set(f.spaceIfc, f.space);
    if (f.spaceFacingIfc && f.spaceFacing) roomToZone.set(f.spaceFacingIfc, f.spaceFacing);
  }
  const terms = input.mep.elements.filter((e) => e.ifcClass === "IfcAirTerminal" && e.systems.some((s) => s.name === systemName));
  const rooms = [...new Set(terms.map((e) => e.room).filter((r): r is string => r !== null))];
  const zones = [...new Set(rooms.map((r) => roomToZone.get(r) ?? r))].filter((z) => input.zones.some((q) => q.name === z));
  return { zones, rooms, terminals: terms.length };
}

const idfNum = (v: FieldValue): string => (typeof v === "number" ? String(Number(v.toPrecision(10))) : /^auto(size|calculate)$/i.test(v) ? v.toLowerCase() : v);
const CFM = 4.719474e-4;   // m³/s per cfm
const FT2 = 10.7639;       // ft² per m²

/** an object's fields from the schema, in IDD order: the ruling's value (user), a default handed in (with its source), else blank = the engine's default */
function objectFrom(schema: EpSchema, cls: string, name: string, ruled: SystemFields | undefined, given: Record<string, { value: FieldValue; source: Source; note?: string; ref?: FieldRef }>): ResolvedObject | null {
  const c = schema.classOf(cls);
  if (!c) return null;
  const fields: ResolvedField[] = c.fields.map((f: EpField) => {
    if (f.key === "name") return { key: f.key, label: f.label, value: name, source: "code-default" as Source, units: null };
    const g = given[f.key];
    // a schedule MARKER ("@hvac-availability": the availability attachment — the SCHEDULES role; "@schedule:file|name": one of the library's
    // own, picked in the component's inputs; "@always" / "@never") becomes a reference the writer resolves to the emitted name
    const mk = ruled ? markerRef(ruled[f.key]) : null;
    if (mk) return { key: f.key, label: f.label, value: "", source: "user", units: f.units, ref: mk, note: markerWord(ruled![f.key]) ?? undefined };
    if (ruled && f.key in ruled) return { key: f.key, label: f.label, value: idfNum(ruled[f.key]!), source: "user", units: f.units };
    if (g) return { key: f.key, label: f.label, value: idfNum(g.value), source: g.source, units: f.units, ref: g.ref, note: g.note };
    return { key: f.key, label: f.label, value: "", source: "code-default", units: f.units, note: f.default !== null ? `the engine's default ${f.default}` : undefined };
  });
  return { cls, name, fields, minFields: c.minFields };
}

/** an object built by hand rather than from the schema: the only way to write a class whose fields REPEAT (an equipment
 *  list's group), which the schema declares as an extensible set and `objectFrom` therefore cannot lay out */
export function rawObject(cls: string, name: string, entries: Array<[string, FieldValue, Source] | [string, FieldValue, Source, FieldRef]>): ResolvedObject {
  const fields: ResolvedField[] = entries.map(([key, value, source, ref]) => ({ key, label: key.replace(/_/g, " "), value: typeof value === "number" ? String(value) : value, source, units: null, ...(ref ? { ref } : {}) }));
  return { cls, name, fields, minFields: null };
}

export interface ResolveOpts {
  schema: EpSchema | null;
  /** the engine's dataset objects beside the binary (2026-09-12): the water-to-air coils' performance curves are read from them */
  datasets?: IdfObject[];
  /** the zone overrides of the ZONES ledger — conditioned by ruling, else by name */
  conditioned: (zone: string) => boolean;
  /** the SCHEDULES ventilation role is ruled (local exhaust waits on it) */
  ventilationScheduled: boolean;
  /** the bedroom ticks on ZONES (2026-10-07); absent, by name */
  bedroomMarks?: BedroomMarks;
  /** each zone's floor, its rooms' summed (the gains' rooms, 2026-10-07) — an ERV's rated flow is shared by it */
  zoneFloorM2?: ReadonlyMap<string, number>;
}

/** what the boiler and tower templates leave blank the EXPANSION leaves blank too (measured: a Boiler:HotWater with no fuel type is a
 *  Severe), so the writer states them: the boiler kind and tower kind, and the fuel — READ from the file when it names a propane
 *  tank (the glazedByName precedent), NaturalGas as a stated default otherwise; the user's field wins over both */
function plantGiven(input: BemInput): { boiler: Record<string, { value: FieldValue; source: Source; note?: string }>; tower: Record<string, { value: FieldValue; source: Source; note?: string }> } {
  const propane = input.mep.elements.some((e) => /propane|\bLPG\b/i.test(e.name));
  return {
    boiler: { boiler_type: { value: "HotWaterBoiler", source: "dataset", note: "the template leaves it blank and the expansion writes none" },
      fuel_type: propane ? { value: "Propane", source: "file", note: "the file names a propane tank" } : { value: "NaturalGas", source: "dataset", note: "the expansion writes no fuel type for a blank template field; NaturalGas until stated" } },
    tower: { tower_type: { value: "SingleSpeed", source: "dataset", note: "the template leaves it blank and the expansion writes none" } },
  };
}

export function resolveSystems(r: SystemsRuling | undefined, input: BemInput, opts: ResolveOpts): ResolvedSystems {
  const list: ResolvedSystem[] = [], unresolved: string[] = [];
  const zoneSystem = new Map<string, string>(), zoneKind = new Map<string, HvacKind>(), uncontrolledZones = new Set<string>(), zoneOaSpec = new Map<string, string>();
  let needSystemSizing = false, needPlantSizing = false;
  let idealLoadsFields: ResolvedField[] | null = null, idealLoadsOrder: string[] | null = null;
  const schema = opts.schema;
  const zoneNames = new Set(input.zones.map((z) => z.name));
  const refuse = (what: string): void => { unresolved.push(what); };
  const zoneCapability = new Map<string, ZoneCapability>();
  if (!r) return { list, zoneSystem, zoneKind, idealLoadsFields, idealLoadsOrder, needSystemSizing, needPlantSizing, uncontrolledZones, zoneOaSpec, schedules: [], zoneCapability, unresolved };
  if (!schema) { refuse(`Energy+.schema.epJSON is not read — no system can be resolved`); return { list, zoneSystem, zoneKind, idealLoadsFields, idealLoadsOrder, needSystemSizing, needPlantSizing, uncontrolledZones, zoneOaSpec, schedules: [], zoneCapability, unresolved }; }
  // the zones a wired unit ventilates through its own outdoor-air system (2026-09-13): they leave the whole-house list, or the air would be counted twice
  const oaZones = new Set((r.hvac ?? []).flatMap((h) => (h.wired?.oa ? h.zones : [])));

  // ── VENTILATION first: heat recovery rides on the hvac objects' own outdoor-air fields
  const cfaM2 = (() => {
    let a = 0;
    for (const f of input.faces) if (f.category === "floor" && ((f.space && opts.conditioned(f.space)) || (f.spaceFacing && opts.conditioned(f.spaceFacing)))) a += f.areaM2;
    return a;
  })();
  const ervs: NonNullable<ResolvedSystems["ervs"]> = [];
  // the bedrooms ticked on ZONES, else by name ("Bed 1", never "Bed 1 Bath") — by the rooms, never the zones (2026-10-02, 2026-10-07)
  const bedroomsByName = bedroomsOfFaces(input.faces, opts.bedroomMarks);
  let oaGiven: Record<string, { value: FieldValue; source: Source; note?: string }> = {};
  const vent = r.ventilation;
  if (vent?.wholeHouse) {
    const w = vent.wholeHouse;
    // ONE PLACE (2026-10-07): a number typed on the ventilation card before the ZONES tick is retired — the ticks count
    const nbr = bedroomsByName, cfa = w.cfaM2 ?? cfaM2;
    const qCfm = 0.03 * cfa * FT2 + 7.5 * (nbr + 1);
    const perArea = (qCfm * CFM) / Math.max(cfa, 1e-9);
    const citation = `Qtot = 0.03 cfm/ft² × ${(cfa * FT2).toFixed(0)} ft² + 7.5 cfm × (${nbr} bedrooms + 1) = ${qCfm.toFixed(1)} cfm — ANSI/RESNET/ICC 301-2022 (ASHRAE 62.2) · ${bedroomsByName} bedrooms — ticked on ZONES, else by name}${w.cfaM2 === undefined ? ` · CFA = Σ floor cells of the conditioned zones ${cfa.toFixed(1)} m²` : ""}`;
    if (w.kind === "HeatRecovery") {
      oaGiven = { outdoor_air_method: { value: "Flow/Area", source: "dataset", note: citation }, outdoor_air_flow_rate_per_zone_floor_area: { value: Number(perArea.toPrecision(6)), source: "dataset", note: citation },
        heat_recovery_type: { value: w.recovery ?? "Sensible", source: w.recovery ? "user" : "dataset", note: "an ERV recovers enthalpy, an HRV sensible heat; the file names a Renewaire (an ERV maker) with no model" } };
      const o = objectFrom(schema, "HVACTemplate:Zone:IdealLoadsAirSystem", "ideal loads", w.fields, { ...oaGiven, zone_name: { value: "", source: "code-default", ref: { zone: "*" } } });
      idealLoadsFields = o ? o.fields.filter((f) => f.key in oaGiven || (w.fields && f.key in w.fields)) : null;
      idealLoadsOrder = o ? o.fields.map((f) => f.key) : null;
      list.push({ id: "ventilation:whole-house", section: "ventilation", kind: "HeatRecovery", label: `whole-house heat recovery through the templates' own outdoor-air fields · ${qCfm.toFixed(0)} cfm`, source: "user", zones: input.zones.filter((z) => opts.conditioned(z.name)).map((z) => z.name), objects: [], refused: [], note: citation, setting: `heat recovery (${w.recovery ?? "Sensible"}) · ${qCfm.toFixed(0)} cfm over ${cfa.toFixed(0)} m² · ${citation}` });
    } else {
      const wPerCfm = w.kind === "Balanced" ? 0.70 : 0.35;
      const dp = wPerCfm / CFM;   // Pa at a total efficiency of 1: the same watts per cfm
      const zones = (w.zones?.length ? w.zones.filter((z) => zoneNames.has(z)) : input.zones.filter((z) => opts.conditioned(z.name)).map((z) => z.name)).filter((z) => !oaZones.has(z));
      const oaNote = oaZones.size ? ` · ${[...oaZones].filter((z) => zoneNames.has(z)).length} zones ventilated through their unit's outdoor-air system, off the list` : "";
      // the schema lists ZoneList's zones as an EXTENSION, not fields: one field per zone, resolved to its emitted name by the writer
      const zl: ResolvedObject | null = schema.has("ZoneList") ? { cls: "ZoneList", name: "conditioned zones", minFields: null, fields: [
        { key: "name", label: "Name", value: "conditioned zones", source: "code-default", units: null },
        ...zones.map((z, i): ResolvedField => ({ key: `zone_name_${i + 1}`, label: `Zone ${i + 1} Name`, value: "", source: "code-default", units: null, ref: { zone: z } })) ] } : null;
      const zv = objectFrom(schema, "ZoneVentilation:DesignFlowRate", "whole-house ventilation", w.fields, {
        zone_or_zonelist_or_space_or_spacelist_name: { value: "", source: "code-default", ref: { zoneList: "conditioned zones" } },
        schedule_name: { value: "", source: "code-default", ref: { schedule: "always" } },
        design_flow_rate_calculation_method: { value: "Flow/Area", source: "dataset", note: citation },
        flow_rate_per_floor_area: { value: Number(perArea.toPrecision(6)), source: "dataset", note: citation },
        ventilation_type: { value: w.kind, source: "user" },
        fan_pressure_rise: { value: Number(dp.toPrecision(5)), source: "dataset", note: `${wPerCfm} W/cfm — ANSI/RESNET/ICC 301-2022, as ${dp.toFixed(0)} Pa at a fan total efficiency of 1` },
        fan_total_efficiency: { value: 1, source: "dataset", note: "the fan's watts are stated per cfm; the efficiency is folded into the pressure rise" },
      });
      if (!zl || !zv) refuse("ventilation: ZoneList / ZoneVentilation:DesignFlowRate are not in the schema");
      else list.push({ id: "ventilation:whole-house", section: "ventilation", kind: `ZoneVentilation:DesignFlowRate ${w.kind}`, label: `whole-house ${w.kind.toLowerCase()} ventilation · ${qCfm.toFixed(0)} cfm on ${zones.length} conditioned zones${oaNote}`, source: "user", zones, objects: [zl, zv], refused: [], note: citation, setting: `${w.kind} · ${qCfm.toFixed(0)} cfm over ${cfa.toFixed(0)} m² · ${wPerCfm} W/cfm · ${citation}${oaNote}` });
    }
  }
  for (const l of vent?.local ?? []) {
    const isBath = /bath|wc|powder/i.test(l.zone);
    const cfm = l.cfm ?? (isBath ? 50 : 100);
    const refused: string[] = [];
    if (!zoneNames.has(l.zone)) refused.push(`zone "${l.zone}" is not in the model`);
    if (!opts.ventilationScheduled) refused.push("no ventilation schedule ruled — SCHEDULES › ventilation (the library has no 1 h/day profile; nothing is authored)");
    const dp = 0.3 / CFM;
    const zv = refused.length ? null : objectFrom(schema, "ZoneVentilation:DesignFlowRate", `${l.zone} local exhaust`, undefined, {
      zone_or_zonelist_or_space_or_spacelist_name: { value: "", source: "code-default", ref: { zone: l.zone } },
      schedule_name: { value: "", source: "code-default", ref: { schedule: "ventilation" } },
      design_flow_rate_calculation_method: { value: "Flow/Zone", source: "dataset" },
      design_flow_rate: { value: Number((cfm * CFM).toPrecision(6)), source: l.cfm !== undefined ? "user" : "dataset", note: `${cfm} cfm — ${isBath ? "bath 50 cfm" : "kitchen 100 cfm"}, 2010 Building America House Simulation Protocols` },
      ventilation_type: { value: "Exhaust", source: "dataset" },
      fan_pressure_rise: { value: Number(dp.toPrecision(5)), source: "dataset", note: `0.3 W/cfm — 2010 BAHSP, as ${dp.toFixed(0)} Pa at a fan total efficiency of 1` },
      fan_total_efficiency: { value: 1, source: "dataset" },
    });
    list.push({ id: `ventilation:local:${l.id}`, section: "ventilation", kind: "ZoneVentilation:DesignFlowRate Exhaust", label: `local exhaust ${l.zone} · ${cfm} cfm`, source: "user", zones: [l.zone], objects: zv ? [zv] : [], refused, note: refused.join("; "), setting: `${l.zone} ${cfm} cfm exhaust${refused.length ? ` — not emitted: ${refused.join("; ")}` : ""}` });
    for (const x of refused) refuse(`ventilation ${l.zone}: ${x}`);
  }

  // ── the SHARED objects first, each once by its id, so the rulings that name them find an emitted name:
  //    a dedicated outdoor-air system, a hot-water loop with its boiler (the assembly's connectors)
  const doasDone = new Set<string>(), hwDone = new Set<string>();
  for (const h of r.hvac ?? []) {
    if (h.doas && !doasDone.has(h.doas.id)) {
      doasDone.add(h.doas.id);
      const o = objectFrom(schema, "HVACTemplate:System:DedicatedOutdoorAir", h.doas.id, h.doas.fields, {});
      if (o) { list.push({ id: h.doas.id, section: "ventilation", kind: "HVACTemplate:System:DedicatedOutdoorAir", label: "dedicated outdoor-air system (feeds the zone equipment connected to it)", source: "user", zones: [], objects: [o], refused: [], note: "", setting: `dedicated outdoor air · ${h.doas.id}` }); needSystemSizing = true; }
      else refuse(`${h.doas.id}: HVACTemplate:System:DedicatedOutdoorAir is not in the schema`);
    }
    const hw = h.plant?.hotWater;
    if (hw && !hwDone.has(hw.id)) {
      hwDone.add(hw.id);
      const objs: ResolvedObject[] = [];
      const loop = objectFrom(schema, "HVACTemplate:Plant:HotWaterLoop", hw.id, hw.loop, {});
      if (loop) objs.push(loop);
      const refused: string[] = [];
      if (hw.boiler) { const b = objectFrom(schema, "HVACTemplate:Plant:Boiler", `${hw.id} boiler`, hw.boiler, { ...plantGiven(input).boiler, template_plant_loop_type: { value: "HotWater", source: "dataset" } }); if (b) objs.push(b); }
      else refused.push("the hot-water loop wants a boiler; none stated — the loop is emitted alone");
      for (const res of hw.resources ?? []) refused.push(`${res} on the hot-water loop: not an HVACTemplate object — carried, not written, until the plant loop is written in full (tier 2)`);
      needPlantSizing = true;
      list.push({ id: hw.id, section: "heating", kind: "HVACTemplate:Plant:HotWaterLoop", label: "hot-water loop (serves the hot-water coils and baseboards connected to it)", source: "user", zones: [], objects: objs, refused, note: refused.join("; "), setting: `hot-water loop · ${hw.id}${hw.boiler ? " · boiler" : " · no boiler"}` });
      for (const x of refused) refuse(`${hw.id}: ${x}`);
    }
  }
  // ── HEATING / COOLING: one hvac list
  const wiredWater = new Map<string, GenPlantLoop["demand"]>();   // a wired ruling's coil water branches, for the loop it stands on
  let curvesDone = false, vsCurvesDone = false;
  const vs = schema ? variableSpeedSet(schema, opts.datasets ?? []) : null;   // the variable-speed speed set, read from the engine's example
  // each loop's sizing (2026-10-08): the pump card's ΔT and the ρ·cp of the fluid its ground heat exchanger states — only a loop whose
  // pump card has a ΔT typed re-sizes its coils' water; untyped, the example's reference flows stand as before
  const loopSizing = new Map<string, { dtK: number; rhoCp: number }>();
  for (const L of r.loops ?? []) {
    const dt = loopDtOf(L.pump.fields);
    if (!dt.ruled) continue;
    const fl = L.producers.filter((p) => GHX_CLASSES.includes(p.cls)).map((p) => loopFluidOf(p.fields)).find((x) => x) ?? null;
    loopSizing.set(L.id, { dtK: dt.k, rhoCp: rhoCpOf(fl) });
  }
  for (const h of r.hvac ?? []) {
    const refused: string[] = [];
    let curveNote = "";
    if (!HVAC_KINDS.includes(h.kind)) { refuse(`${h.id}: "${h.kind}" is not a kind SYSTEMS offers`); continue; }
    if (!schema.has(h.kind)) { refuse(`${h.id}: "${h.kind}" is not in the schema`); continue; }
    const zones: string[] = [];
    for (const z of h.zones) {
      if (!zoneNames.has(z)) { refused.push(`zone "${z}" is not in the model`); continue; }
      const other = zoneSystem.get(z);
      if (other && other !== h.id) { refused.push(`zone "${z}" is already in "${other}"`); continue; }
      zones.push(z);
    }
    if (!zones.length) refused.push("no zone named");
    const objects: ResolvedObject[] = [];
    const thermostat = (z: string): { value: FieldValue; source: Source; ref: FieldRef } => ({ value: "", source: "code-default", ref: { thermostat: z } });
    const zoneRef = (z: string): { value: FieldValue; source: Source; ref: FieldRef } => ({ value: "", source: "code-default", ref: { zone: z } });
    const named = h.from ? { note: `from the file: ${h.from.name}` } : {};
    if (h.doas && (h.kind === "HVACTemplate:Zone:IdealLoadsAirSystem" || h.kind.startsWith("HVACTemplate:System:"))) refused.push(`a dedicated outdoor-air system feeds zone equipment (PTHP, PTAC, WSHP, baseboard); ${h.kind} takes its outdoor air itself`);
    if (h.kind === "HVACTemplate:Zone:IdealLoadsAirSystem" || h.kind === "HVACTemplate:Zone:PTHP" || h.kind === "HVACTemplate:Zone:PTAC" || h.kind === "HVACTemplate:Zone:BaseboardHeat" || h.kind === "HVACTemplate:Zone:WaterToAirHeatPump") {
      for (const z of zones) {
        const given: Record<string, { value: FieldValue; source: Source; note?: string; ref?: FieldRef }> = { zone_name: zoneRef(z), template_thermostat_name: thermostat(z), ...oaGiven };
        if (h.doas && h.kind !== "HVACTemplate:Zone:IdealLoadsAirSystem") given.dedicated_outdoor_air_system_name = { value: "", source: "user", ref: { system: h.doas.id } };
        if (h.kind === "HVACTemplate:Zone:BaseboardHeat" && !(h.fields && "baseboard_heating_type" in h.fields)) given.baseboard_heating_type = { value: "Electric", source: "dataset", note: "electric baseboard (hot water needs a loop the ruling does not state)" };
        const o = objectFrom(schema, h.kind, `${z} ${HVAC_LABELS[h.kind].split(" ")[0]}`, { ...h.zoneFields, ...h.fields }, given);
        if (o) objects.push(o);
      }
      if (h.kind === "HVACTemplate:Zone:WaterToAirHeatPump") {
        const loop = objectFrom(schema, "HVACTemplate:Plant:MixedWaterLoop", `${h.id} loop`, h.plant?.loop, {});
        if (loop) objects.push(loop);
        needPlantSizing = true;
        if (h.plant?.boiler) { const b = objectFrom(schema, "HVACTemplate:Plant:Boiler", `${h.id} boiler`, h.plant.boiler, { ...plantGiven(input).boiler, template_plant_loop_type: { value: "MixedWater", source: "dataset" } }); if (b) objects.push(b); }
        if (h.plant?.tower) { const t = objectFrom(schema, "HVACTemplate:Plant:Tower", `${h.id} tower`, h.plant.tower, { ...plantGiven(input).tower, template_plant_loop_type: { value: "MixedWater", source: "dataset" } }); if (t) objects.push(t); }
        if (!h.plant?.boiler || !h.plant?.tower) refused.push(`the mixed-water loop wants a boiler and a tower (the engine's memo); ${!h.plant?.boiler ? "no boiler" : ""}${!h.plant?.boiler && !h.plant?.tower ? ", " : ""}${!h.plant?.tower ? "no tower" : ""} stated — the loop is emitted alone, the converter says whether it stands`);
        for (const res of h.plant?.resources ?? []) refused.push(`${res} on the mixed-water loop: not an HVACTemplate object — carried, not written, until the plant loop is written in full (tier 2)`);
      }
    } else if (h.kind === "ZoneHVAC:UnitHeater") {
      // THE ELECTRIC UNIT HEATER (user, 2026-09-11: the garage). The engine has no HVACTemplate for one, so the whole set is
      // written: the unit, its fan and electric coil, and the zone's equipment list and connections. The air path is the zone's
      // own — exhaust node → fan → coil → inlet node — and the thermostat is the writer's (it alone knows the zone's setpoint,
      // and a unit heater takes a HEATING-ONLY one: a garage is not cooled).
      // THE CARD'S PICKS (user, 2026-09-14: the unit heater's inputs): the fan's class, the coil's class and fuel, the flow, the fan without a
      // load, the convergence, an availability manager — each honoured here; a water or steam coil is refused by name (no ring for it yet)
      const uf = h.fields ?? {};
      const FANS = ["Fan:OnOff", "Fan:ConstantVolume", "Fan:VariableVolume", "Fan:SystemModel"], COILS = ["Coil:Heating:Electric", "Coil:Heating:Fuel", "Coil:Heating:Water", "Coil:Heating:Steam"];
      const fanCls = FANS.includes(String(uf.supply_air_fan_object_type ?? "")) ? String(uf.supply_air_fan_object_type) : "Fan:OnOff";
      const coilCls = COILS.includes(String(uf.heating_coil_object_type ?? "")) ? String(uf.heating_coil_object_type) : "Coil:Heating:Electric";
      if (/Water|Steam/.test(coilCls)) refused.push(UH_WATER_REFUSAL);
      const flow: FieldValue = typeof uf.maximum_supply_air_flow_rate === "number" ? uf.maximum_supply_air_flow_rate : "autosize";
      const flowSrc: Source = typeof uf.maximum_supply_air_flow_rate === "number" ? "user" : "code-default";
      const eff = typeof uf.efficiency === "number" ? uf.efficiency : null;
      const fuel = plantGiven(input).boiler.fuel_type!;
      for (const z of zones) {
        if (refused.length) break;
        const zn = sanitizeIdfName(z);
        const nSupply = `${zn} UH Supply Node`, nReturn = `${zn} UH Return Node`, nFanOut = `${zn} UH Fan Outlet Node`;
        const unit = `${z} unit heater`, fan = `${z} unit heater fan`, coil = `${z} unit heater coil`, managers = `${z} unit heater managers`, night = `${z} unit heater night cycle`;
        const manager = uf[UH_MANAGER_FIELD] === "AvailabilityManager:NightCycle";
        const o = objectFrom(schema, "ZoneHVAC:UnitHeater", unit, h.fields, {
          availability_schedule_name: { value: "", source: "code-default", ref: { schedule: "always" } },
          air_inlet_node_name: { value: nReturn, source: "code-default" }, air_outlet_node_name: { value: nSupply, source: "code-default" },
          supply_air_fan_object_type: { value: fanCls, source: fanCls === "Fan:OnOff" && !uf.supply_air_fan_object_type ? "dataset" : "user" }, supply_air_fan_name: { value: "", source: "code-default", ref: { system: fan } },
          maximum_supply_air_flow_rate: { value: flow, source: flowSrc, note: flow === "autosize" ? "the engine sizes the fan to the design load" : undefined },
          heating_coil_object_type: { value: coilCls, source: coilCls === "Coil:Heating:Electric" && !uf.heating_coil_object_type ? "dataset" : "user" }, heating_coil_name: { value: "", source: "code-default", ref: { system: coil } },
          supply_air_fan_operation_during_no_heating: { value: "No", source: "dataset", note: "a unit heater's fan runs only when it heats" },
          ...(manager ? { availability_manager_list_name: { value: "", source: "user", ref: { system: managers } } } : {}),
        });
        // the fan by its class: the card's pressure rise and efficiency on whichever it is (the system model's own keys differ), the unit's flow on it too
        const fanGiven: Record<string, { value: FieldValue; source: Source; note?: string; ref?: FieldRef }> = {
          availability_schedule_name: { value: "", source: "code-default", ref: { schedule: "always" } },
          air_inlet_node_name: { value: nReturn, source: "code-default" }, air_outlet_node_name: { value: nFanOut, source: "code-default" },
          fan_total_efficiency: { value: typeof uf.fan_total_efficiency === "number" ? uf.fan_total_efficiency : UH_FAN_DEFAULT.totalEfficiency, source: typeof uf.fan_total_efficiency === "number" ? "user" : "dataset", note: UH_FAN_DEFAULT.citation },
          pressure_rise: { value: typeof uf.pressure_rise === "number" ? uf.pressure_rise : UH_FAN_DEFAULT.pressureRisePa, source: typeof uf.pressure_rise === "number" ? "user" : "dataset", note: UH_FAN_DEFAULT.citation },
          design_pressure_rise: { value: typeof uf.pressure_rise === "number" ? uf.pressure_rise : UH_FAN_DEFAULT.pressureRisePa, source: typeof uf.pressure_rise === "number" ? "user" : "dataset", note: UH_FAN_DEFAULT.citation },
          maximum_flow_rate: { value: flow, source: flowSrc }, design_maximum_air_flow_rate: { value: flow, source: flowSrc },
          design_electric_power_consumption: { value: "autosize", source: "code-default" },
        };
        const fanFields: SystemFields = { ...(h.fields ?? {}) }; delete fanFields.pressure_rise; delete fanFields.fan_total_efficiency;   // placed above by class, not by key
        const f = objectFrom(schema, fanCls, fan, fanFields, fanGiven);
        const c = coilCls === "Coil:Heating:Fuel"
          ? objectFrom(schema, coilCls, coil, h.fields, {
            availability_schedule_name: { value: "", source: "code-default", ref: { schedule: "always" } },
            fuel_type: fuel, burner_efficiency: eff !== null ? { value: eff, source: "user" } : { value: 0.8, source: "code-default", note: "the engine's default" },
            nominal_capacity: { value: "autosize", source: "code-default" },
            air_inlet_node_name: { value: nFanOut, source: "code-default" }, air_outlet_node_name: { value: nSupply, source: "code-default" },
          })
          : objectFrom(schema, "Coil:Heating:Electric", coil, h.fields, {
            availability_schedule_name: { value: "", source: "code-default", ref: { schedule: "always" } },
            efficiency: eff !== null ? { value: eff, source: "user" } : { value: 1, source: "dataset", note: "electric resistance: every watt in is a watt out" },
            nominal_capacity: { value: "autosize", source: "code-default" },
            air_inlet_node_name: { value: nFanOut, source: "code-default" }, air_outlet_node_name: { value: nSupply, source: "code-default" },
          });
        // the fan and the coil are emitted BEFORE the unit that names them: the writer resolves a reference through the names
        // it has already emitted, so an object must follow the ones it points at
        if (manager) {
          // NIGHT CYCLE (the card's availability manager): the unit brought on when the zone falls below its setpoint while scheduled off —
          // the engine's own manager on the unit's assignment list, cycling on any zone it serves for the engine's default run time
          objects.push(rawObject("AvailabilityManager:NightCycle", night, [
            ["name", night, "code-default"], ["applicability_schedule_name", "", "code-default", { schedule: "always" }], ["fan_schedule_name", "", "code-default", { schedule: "always" }],
            ["control_type", "CycleOnAny", "dataset"], ["thermostat_tolerance", "1", "dataset"], ["cycling_run_time_control_type", "FixedRunTime", "dataset"], ["cycling_run_time", "3600", "dataset"],
            ["control_zone_or_zone_list_name", "", "code-default", { zone: z }],
          ]));
          objects.push(rawObject("AvailabilityManagerAssignmentList", managers, [["name", managers, "code-default"], ["availability_manager_object_type_1", "AvailabilityManager:NightCycle", "dataset"], ["availability_manager_name_1", "", "code-default", { system: night }]]));
        }
        for (const x of [f, c, o]) if (x) objects.push(x);
        // THE RUN'S PEAK (user, 2026-10-08: "report peak"): the coil's heating rate each timestep — the run reads its maximum and when
        objects.push(rawObject("Output:Variable", `${coil} heating rate`, [["key_value", "", "code-default", { system: coil }], ["variable_name", UH_PEAK_VARIABLE, "dataset"], ["reporting_frequency", "Timestep", "dataset"]]));
        objects.push(rawObject("ZoneHVAC:EquipmentList", `${z} equipment`, [
          ["name", `${z} equipment`, "code-default"],   // the writer replaces field 0 with its own unique name
          ["load_distribution_scheme", "SequentialLoad", "dataset"],
          ["zone_equipment_object_type", "ZoneHVAC:UnitHeater", "dataset"],
          ["zone_equipment_name", "", "code-default", { system: unit }],
          ["zone_equipment_cooling_sequence", "1", "dataset"], ["zone_equipment_heating_or_no_load_sequence", "1", "dataset"],
        ]));
        objects.push(rawObject("ZoneHVAC:EquipmentConnections", `${z} connections`, [
          ["zone_name", "", "code-default", { zone: z }],
          ["zone_conditioning_equipment_list_name", "", "code-default", { system: `${z} equipment` }],
          ["zone_air_inlet_node_or_nodelist_name", nSupply, "code-default"],
          ["zone_air_exhaust_node_or_nodelist_name", nReturn, "code-default"],
          ["zone_air_node_name", `${zn} Zone Air Node`, "code-default"],
          ["zone_return_air_node_or_nodelist_name", `${zn} Return Node`, "code-default"],
        ]));
      }
    } else if (h.wired) {
      // A COMPONENT CARD'S AIR LOOP (2026-09-12): the generator writes the parent with its fan and coils, the AirLoopHVAC, its
      // supply and return paths, its sizing, and a terminal, distribution unit, equipment list and connections per zone; the
      // coils' water side is kept for the loop it stands on (below). The coils' curves come from the engine's own dataset,
      // emitted once. A generator refusal writes nothing — a half-written loop is a Severe, not a system.
      const A: GenAirLoop = { id: h.id, ...h.wired, terminals: h.wired.terminals.filter((t) => zones.includes(t.zone)) };
      if (h.fields) A.fields = h.fields;
      // the outdoor-air rate for the unit's core: the house's ASHRAE 62.2 rate per floor area (the whole-house ruling's own arithmetic), sized on every zone the unit serves
      // THE ERV'S OWN FLOW (user, 2026-10-07: "the ADU ERV uses 50 cfm OA and EA, and the House ERV uses 175 cfm OA and EA"): a core card
      // with its rated flow typed runs at it, outdoor and exhaust air alike — shared by floor area across every unit that card feeds
      // (the house's one ERV on the six heat pumps), each unit's controller minimum and core nominal its share, the shares summing to
      // the rating. A core with no rating keeps the house's ASHRAE 62.2 rate.
      const rated = A.oa?.core.fields?.nominal_supply_air_flow_rate;
      // the card a unit's core comes from: its id, or — a sheet applied before 2026-10-07 stored no id — the card's own settings, which every
      // unit the card feeds carries alike
      const coreKey = (oa: NonNullable<GenAirLoop["oa"]>): string => oa.coreId ?? `${oa.core.cls}|${JSON.stringify(oa.core.fields ?? {})}`;
      if (A.oa && typeof rated === "number" && rated > 0) {
        const areaOf = (zs: readonly string[]): number => zs.reduce((t, z) => t + (opts.zoneFloorM2?.get(z) ?? 0), 0);
        const peers = (r.hvac ?? []).filter((x) => x.wired?.oa && coreKey(x.wired.oa) === coreKey(A.oa!));
        const mine = areaOf(A.terminals.map((t) => t.zone)), all = peers.reduce((t, x) => t + areaOf(x.wired!.terminals.map((t2) => t2.zone)), 0);
        const share = all > 0 ? mine / all : 1 / Math.max(peers.length, 1);
        const cfmR = rated / CFM;
        // the code's flow for the same floor: the house's 62.2 rate per floor area (the whole-house ruling's arithmetic) on the ERV's floor
        const code62 = (0.03 * cfaM2 * FT2 + 7.5 * (bedroomsByName + 1)) / Math.max(cfaM2, 1e-9) * all;
        if (!ervs.some((e) => e.coreId === coreKey(A.oa!))) ervs.push({ coreId: coreKey(A.oa), ratedCfm: cfmR, codeCfm: code62, units: peers.length, areaM2: all,
          codeWords: `ASHRAE 62.2 (ANSI/RESNET/ICC 301-2022): (0.03 cfm/ft² × ${(cfaM2 * FT2).toFixed(0)} ft² + 7.5 cfm × (${bedroomsByName} bedrooms + 1)) over the house's floor, on the ${(all * FT2).toFixed(0)} ft² this ERV serves = ${code62.toFixed(1)} cfm` });
        const zoneM3s: Record<string, number> = {};
        for (const t of A.terminals) zoneM3s[t.zone] = Number((rated * (all > 0 ? areaOf([t.zone]) / all : share / A.terminals.length)).toPrecision(6));
        const card = (r.assembly?.nodes ?? []).find((n) => n.id === A.oa!.coreId || (n.kind === "component" && `${n.cls}|${JSON.stringify(n.fields ?? {})}` === coreKey(A.oa!)));
        const cardName = card?.ident || card?.label || undefined;
        A.oa = { ...A.oa, zoneM3s, ...(cardName ? { cardName } : {}), minM3s: Number((rated * share).toPrecision(6)), perAreaM3sM2: Number((rated / Math.max(all, 1e-9)).toPrecision(6)),
          citation: `a stand-alone ERV in each zone, on its own fans and schedule, the heat pump taking no outdoor or exhaust air — the rated ${cfmR.toFixed(0)} cfm outdoor and exhaust air (its card)${peers.length > 1 ? `, shared by floor area across the ${peers.length} units it feeds — this one ${mine.toFixed(1)} of ${all.toFixed(1)} m², ${(cfmR * share).toFixed(1)} cfm` : ""}` };
      } else if (A.oa) {
        const qCfmH = 0.03 * cfaM2 * FT2 + 7.5 * (bedroomsByName + 1), perArea = (qCfmH * CFM) / Math.max(cfaM2, 1e-9);
        A.oa = { ...A.oa, perAreaM3sM2: Number(perArea.toPrecision(6)), citation: `Qtot = 0.03 cfm/ft² × ${(cfaM2 * FT2).toFixed(0)} ft² + 7.5 cfm × (${bedroomsByName} bedrooms + 1) = ${qCfmH.toFixed(1)} cfm over ${cfaM2.toFixed(1)} m² — ANSI/RESNET/ICC 301-2022 (ASHRAE 62.2), per floor area on the zones the unit serves` };
      }
      // THE LOOP ΔT (2026-10-08): the coils' water sized by the pump card's ΔT and the loop's fluid — each speed's reference flow
      const sizing = h.wired?.loop ? loopSizing.get(h.wired.loop) : undefined;
      const vsU = vs && sizing ? { ...vs, cooling: vs.cooling && vsWaterAtDt(vs.cooling, "cooling", sizing.dtK, sizing.rhoCp), heating: vs.heating && vsWaterAtDt(vs.heating, "heating", sizing.dtK, sizing.rhoCp) } : vs;
      const gen = generateAirLoop(schema, A, vsU ? { vs: vsU } : {});
      if (gen.refused.length) refused.push(...gen.refused);
      else {
        // the single-speed coils' curves from the DataSets, the variable-speed set's curves from the example — each emitted once
        const notes: string[] = [];
        if (gen.usesEquationFit && !curvesDone) {
          const cv = waterToAirCurves(opts.datasets ?? []);
          if (cv.missing.length) refused.push(`the water-to-air coils' curves ${cv.missing.join(", ")} are not in the engine's dataset (DataSets/WaterToAirHeatPumps.idf) — nothing to rate the coils with`);
          else { objects.push(...cv.objects); curvesDone = true; notes.push(`single-speed curves: ${cv.citation}`); }
        }
        if (gen.usesVs && vs && !vsCurvesDone) {
          if (vs.missing.length) refused.push(`the variable-speed set is incomplete — ${vs.missing.join(", ")}`);
          else { objects.push(...vs.curves); vsCurvesDone = true; notes.push(`variable-speed set: ${vs.citation}`); }
        }
        if (notes.length) curveNote = notes.join(" · ");
        if (!refused.length) { objects.push(...gen.objects); wiredWater.set(h.id, gen.waterBranches); if (gen.oaSpec) for (const z of zones) zoneOaSpec.set(z, gen.oaSpec); if (A.oa?.citation) notes.push(`outdoor air: ${A.oa.citation}`); }
      }
      needSystemSizing = true;
    } else {
      // a System kind: one system object named for the ruling, a Zone:Unitary per zone naming it
      const given: Record<string, { value: FieldValue; source: Source; note?: string; ref?: FieldRef }> = { control_zone_or_thermostat_location_name: zoneRef(zones[0] ?? "") };
      if (h.kind === "HVACTemplate:System:Unitary" && !(h.fields && "heating_coil_type" in h.fields)) refused.push("heating_coil_type is required and nobody stated it (Electric · Gas · HotWater)");
      const sysObj = objectFrom(schema, h.kind, h.id, h.fields, given);
      if (sysObj) objects.push(sysObj);
      for (const z of zones) {
        const o = objectFrom(schema, "HVACTemplate:Zone:Unitary", `${z} unit`, h.zoneFields, { zone_name: zoneRef(z), template_unitary_system_name: { value: "", source: "code-default", ref: { system: h.id } }, template_thermostat_name: thermostat(z), ...oaGiven });
        if (o) objects.push(o);
      }
      needSystemSizing = true;
    }
    // a wired ruling that wrote nothing takes no zone: its zones stay on ideal loads rather than on a thermostat with no equipment
    const emit = (!refused.some((x) => /required|not in the model|no zone|already in/.test(x)) || (zones.length > 0 && !refused.some((x) => /required/.test(x)))) && !((h.wired || h.kind === "ZoneHVAC:UnitHeater") && !objects.length);
    for (const z of zones) if (emit) { zoneSystem.set(z, h.id); zoneKind.set(z, h.kind); zoneCapability.set(z, capabilityOf(h.kind, h.fields)); if (h.wired?.uncontrolled?.includes(z)) uncontrolledZones.add(z); }
    const cop = COP_FIELDS[h.kind];
    const copText = cop.heating || cop.cooling ? ` · COP ${[cop.heating && (h.fields?.[cop.heating] ?? schema.defaultOf(h.kind, cop.heating)), cop.cooling && (h.fields?.[cop.cooling] ?? schema.defaultOf(h.kind, cop.cooling))].filter((x) => x !== undefined && x !== null && x !== "").join(" / ")}` : "";
    list.push({ id: h.id, section: "heating", kind: h.kind, label: HVAC_LABELS[h.kind], source: "user", zones: emit ? zones : [], objects: emit ? objects : [], refused, note: [named.note, curveNote, ...refused].filter(Boolean).join(" · "),
      setting: `${HVAC_LABELS[h.kind].split(" (")[0]} · ${zones.length} zone${zones.length === 1 ? "" : "s"}${copText}${h.from ? ` · ${h.from.name}` : ""}${refused.length ? ` · refused: ${refused.join("; ")}` : ""}` });
    for (const x of refused) refuse(`${h.id}: ${x}`);
  }
  // ── THE FLUID LOOPS the sheet compiled (2026-09-12): a water ring, or a loop card, written in full — the pump on the supply
  //    inlet branch, each producer on its own branch, the consumers' coil branches on the demand side, splitters and mixers,
  //    the operation scheme, the setpoint manager and Sizing:Plant. The borefield is STATED (BOREFIELD_DEFAULT) until the
  //    settings slice lets the user state it.
  for (const L of r.loops ?? []) {
    const refused: string[] = [], objects: ResolvedObject[] = [];
    if (!schema.has(L.cls)) { refuse(`${L.id}: "${L.cls}" is not in the schema`); continue; }
    const demand = L.consumers.flatMap((id) => wiredWater.get(id) ?? []);
    const missing = L.consumers.filter((id) => !wiredWater.has(id));
    if (missing.length) refused.push(`${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not written, so the loop has no demand from ${missing.length === 1 ? "it" : "them"}`);
    const supply: GenPlantLoop["supply"] = [];
    let ground = false;
    const groundWords: string[] = [];
    for (const p of L.producers) {
      // a ground heat exchanger of any type (2026-09-14): the card's inputs on it, the borefield default or the engine's own example for the rest
      if (GHX_CLASSES.includes(p.cls)) {
        const ghx = groundHeatExchanger(schema, L.id, p.name, p.cls, p.fields);
        supply.push({ cls: p.cls, name: p.name, extra: ghx.objects });
        refused.push(...ghx.refused);
        ground = true; groundWords.push(`${p.name}: ${ghx.words}`);
      } else refused.push(`${p.cls} "${p.name}" is not written on a generated loop yet — the ground heat exchangers are; a boiler and a tower are the next slice`);
    }
    // THE LOOP'S FLUID (2026-10-08): the antifreeze typed on a ground heat exchanger's card; two cards stating different fluids are refused
    const fluids = L.producers.filter((p) => GHX_CLASSES.includes(p.cls)).map((p) => loopFluidOf(p.fields));
    const fluid = fluids.find((x) => x) ?? null;
    if (fluids.some((x) => JSON.stringify(x) !== JSON.stringify(fluid))) refused.push("its ground heat exchangers state different fluids — one loop holds one fluid");
    if (fluid) groundWords.push(`the loop's fluid ${fluid.pct}% ${GLYCOL_WORDS[fluid.glycol]} by ${fluid.basis} (${fluid.weightPct.toFixed(1)} wt%), freezes at ${fluid.freezeC.toFixed(1)} °C`);
    const dt = loopDtOf(L.pump.fields);
    groundWords.push(`the flow sized at ΔT ${dt.k.toFixed(2)} °C (${(dt.k * 9 / 5).toFixed(1)} °F, ${LOOP_DT_OPTIONS.find((o) => o.id === dt.source)!.label}${dt.ruled ? "" : " — until typed on the pump card"})`);
    const gen = generateLoop(schema, { id: L.id, cls: L.cls, ...(L.fields ? { fields: L.fields } : {}), pump: L.pump, supply, demand, fluid, dtK: dt.k });
    refused.push(...gen.refused);
    const sp = loopSetpoint(schema, L.id, ground);
    if (!refused.length) { objects.push(...gen.objects); if (sp) objects.push(sp); needPlantSizing = true; }
    const bf = groundWords.length ? ` · ${groundWords.join(" · ")}` : "";
    list.push({ id: L.id, section: "heating", kind: L.cls, label: `${L.cls === "CondenserLoop" ? "condenser" : "plant"} loop, generated: the pump on its supply inlet branch, ${L.producers.map((p) => p.name).join(", ")} on supply, ${L.consumers.join(", ") || "nothing"} on demand`, source: "user", zones: [], objects, refused,
      note: [...refused, ...groundWords].join("; "), setting: `${L.cls} · ${L.id} · pump ${L.pump.cls} · supply ${L.producers.map((p) => p.name).join(", ")} · demand ${L.consumers.join(", ") || "none"}${bf}${refused.length ? ` · refused: ${refused.join("; ")}` : ""}` });
    for (const x of refused) refuse(`${L.id}: ${x}`);
  }
  // every library schedule a field names by marker, once each — the model reads their profiles, the writer emits them ahead of the systems
  const schedules: ScheduleRef[] = [], seenSched = new Set<string>();
  for (const s of list) for (const o of s.objects) for (const f of o.fields) {
    const sc = f.ref?.schedule;
    if (sc && typeof sc === "object") { const k = `${sc.file}|${sc.name}`.toLowerCase(); if (!seenSched.has(k)) { seenSched.add(k); schedules.push(sc); } }
  }
  return { list, zoneSystem, zoneKind, idealLoadsFields, idealLoadsOrder, needSystemSizing, needPlantSizing, uncontrolledZones, zoneOaSpec, schedules, zoneCapability, unresolved, ervs };
}

/** the default rows the tab always reads back: a subsection with no ruling runs on the writer's own default */
export function defaultSystemRows(resolved: ResolvedSystems): Array<{ id: string; section: SystemSection; kind: string; label: string; source: Source; zones: string[]; note: string }> {
  const out: Array<{ id: string; section: SystemSection; kind: string; label: string; source: Source; zones: string[]; note: string }> = [];
  for (const main of SECTION_TREE) for (const sub of main.subs) {
    const has = resolved.list.some((s) => s.section === sub.id || (sub.id === "cooling" && s.section === "heating"));
    if (!has) out.push({ id: `${sub.id}:default`, section: sub.id, kind: sub.defaultKind, label: CODE_DEFAULT_SYSTEM[sub.id], source: "code-default", zones: [], note: "the writer's own" });
  }
  return out;
}
export { isConditioned };

// ── THE STAGE (the screen's arithmetic, shared by the column and the options table)
export interface StageDiff { pending: number; words: Partial<Record<SystemSection, string>> }
/** what waits on Apply: each hvac ruling added, removed or changed counts one; every other subsection one when it moved */
export function stageDiff(stage: SystemsRuling, applied: SystemsRuling | undefined): StageDiff {
  const j = (x: unknown): string => JSON.stringify(x ?? null);
  let pending = 0;
  const words: Partial<Record<SystemSection, string>> = {};
  const sh = stage.hvac ?? [], ah = applied?.hvac ?? [];
  const hv: string[] = [];
  for (const id of new Set([...sh.map((h) => h.id), ...ah.map((h) => h.id)])) {
    const a = ah.find((h) => h.id === id), s = sh.find((h) => h.id === id);
    if (j(a) !== j(s)) { pending++; hv.push(!a ? `+ ${id}` : !s ? `− ${id}` : `~ ${id}`); }
  }
  if (hv.length) { words.heating = hv.join(" · "); words.cooling = words.heating; }
  const one = (k: keyof SystemsRuling, sec: SystemSection): void => { if (j(stage[k]) !== j(applied?.[k])) { pending++; words[sec] = stage[k] ? "staged" : "staged: back to the code default"; } };
  one("ventilation", "ventilation"); one("power", "power"); one("lighting", "lighting"); one("generation", "generation"); one("dhw", "dhw"); one("water", "water");
  return { pending, words };
}
/** the fields a ruling usually states, shown first; the rest behind "show all" */
export const KEY_FIELD = /cop|efficiency|capacity|_type$|fuel|eer|seer|hspf|coil|supply_fan|fan_|outdoor_air|heat_recovery|setpoint|flow_rate|ventilation_type|pressure_rise|bedrooms|zone_name/;
/** a short id for a ruling made from the file's kind name: the family up to its first colon, the digits and units kept */
export const rulingIdFor = (kindName: string, taken: string[]): string => {
  // the TYPE after the family's colon ("…:NVV060LR_Top 2" → "NVV060LR Top 2"), the family when the type says nothing
  const parts = kindName.split(":"), type = parts.length > 1 ? parts[parts.length - 1]!.trim() : "";
  const base = ((type && !/^(standard|default|\d+)$/i.test(type) ? type : parts[0]!) ?? kindName).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 32) || "system";
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base} ${n++}`;
  return id;
};
