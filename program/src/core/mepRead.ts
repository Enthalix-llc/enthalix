// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SERVICES MODEL, READ (2026-09-10). A Revit MEP export states almost no
// rating — measured on _MEP.ifc: 12 power values in 147 MB, no capacity,
// flow, COP, voltage or current anywhere — and exports every piece of
// equipment as IfcBuildingElementProxy / NOTDEFINED. What it DOES state, and
// what this reader takes verbatim: the Family:Type name, the type's own
// psets (Pset_LightFixtureTypeCommon.TotalWattage, a bounded Power,
// Pset_ManufacturerTypeInformation), the storey, the IfcDistributionSystem
// each element belongs to (VENTILATION, EXHAUST, DOMESTICHOTWATER, the
// ELECTRICAL circuits by number …), and the Uniformat classification code.
// A discipline is assigned from those facts as a DISPLAY grouping — by class
// first, by the system's type second, by a name rule last — and said to be
// one; nothing here is a model quantity.

import type * as WebIFC from "web-ifc";
import { IFCRELASSIGNSTOGROUP, IFCDISTRIBUTIONSYSTEM, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCBUILDINGSTOREY, IFCRELDEFINESBYTYPE, IFCRELDEFINESBYPROPERTIES,
  IFCRELASSOCIATESCLASSIFICATION, IFCPROPERTYSINGLEVALUE, IFCPROPERTYBOUNDEDVALUE } from "web-ifc";
import { readUnitScale } from "./ifcStream.js";

export type Discipline = "mechanical" | "electrical" | "plumbing" | "other";
export interface MepSystemRef { name: string; predefinedType: string }
export interface MepMeta {
  globalId: string | null;
  predefinedType: string | null;
  typeName: string | null;
  storey: string | null;
  systems: MepSystemRef[];
  uniformat: string | null;
  manufacturer: string | null;
  model: string | null;
  /** Pset_LightFixtureTypeCommon.TotalWattage, in watts (the file's POWERUNIT scaled to W) */
  wattageW: number | null;
  /** a bounded or single "Power" property, in watts */
  powerW: number | null;
  /** every other stated single value, name → value, verbatim */
  props: Record<string, string | number | boolean>;
}
export interface MepSystemMeta { expressId: number; name: string; longName: string | null; predefinedType: string; members: number[] }

const idOf = (v: unknown): number | null => (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : null);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(idOf).filter((x): x is number => x !== null) : [idOf(v)].filter((x): x is number => x !== null));
const str = (v: unknown): string | null => (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : null);
const val = (v: unknown): string | number | boolean | null => {
  if (!v || typeof v !== "object") return null;
  const x = (v as { value?: unknown }).value;
  return typeof x === "number" || typeof x === "string" || typeof x === "boolean" ? x : null;
};

/** the facts the file states about the targets: systems, storeys, types and their psets, the classification */
export function readMepMeta(api: WebIFC.IfcAPI, modelID: number, targets: Set<number>): { meta: Map<number, MepMeta>; systems: MepSystemMeta[] } {
  const meta = new Map<number, MepMeta>();
  const get = (id: number): MepMeta => {
    let m = meta.get(id);
    if (!m) { m = { globalId: null, predefinedType: null, typeName: null, storey: null, systems: [], uniformat: null, manufacturer: null, model: null, wattageW: null, powerW: null, props: {} }; meta.set(id, m); }
    return m;
  };
  const power = readUnitScale(api, modelID, "POWERUNIT").scale || 1;
  // 1 · the systems: IfcRelAssignsToGroup whose group is an IfcDistributionSystem
  const systems: MepSystemMeta[] = [];
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELASSIGNSTOGROUP);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatingGroup?: unknown; RelatedObjects?: unknown };
        const gId = idOf(rel.RelatingGroup);
        if (gId === null || api.GetLineType(modelID, gId) !== IFCDISTRIBUTIONSYSTEM) continue;
        const g = api.GetLine(modelID, gId) as { Name?: unknown; LongName?: unknown; PredefinedType?: unknown };
        const members = ids(rel.RelatedObjects);
        const sys: MepSystemMeta = { expressId: gId, name: str(g.Name) ?? "", longName: str(g.LongName), predefinedType: str(g.PredefinedType) ?? "NOTDEFINED", members };
        systems.push(sys);
        for (const e of members) if (targets.has(e)) get(e).systems.push({ name: sys.name, predefinedType: sys.predefinedType });
      } catch { /* an unreadable rel */ }
    }
  } catch { /* no groups */ }
  // 2 · the storey
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatingStructure?: unknown; RelatedElements?: unknown };
        const stId = idOf(rel.RelatingStructure);
        if (stId === null || api.GetLineType(modelID, stId) !== IFCBUILDINGSTOREY) continue;
        const st = api.GetLine(modelID, stId) as { Name?: unknown; LongName?: unknown };
        const name = str(st.Name) ?? str(st.LongName);
        if (!name) continue;
        for (const e of ids(rel.RelatedElements)) if (targets.has(e)) get(e).storey = name;
      } catch { /* skip */ }
    }
  } catch { /* no storeys */ }
  // 3 · the psets, on the instance and on its type: TotalWattage, Power, Manufacturer, ModelReference, and the rest verbatim
  const takeProps = (holder: MepMeta, psetId: number): void => {
    const pset = api.GetLine(modelID, psetId) as { Name?: unknown; HasProperties?: unknown };
    for (const hId of ids(pset.HasProperties)) {
      try {
        const kind = api.GetLineType(modelID, hId);
        const prop = api.GetLine(modelID, hId) as { Name?: unknown; NominalValue?: unknown; UpperBoundValue?: unknown; LowerBoundValue?: unknown; SetPointValue?: unknown };
        const pn = str(prop.Name);
        if (!pn) continue;
        let v: string | number | boolean | null = null;
        if (kind === IFCPROPERTYSINGLEVALUE) v = val(prop.NominalValue);
        else if (kind === IFCPROPERTYBOUNDEDVALUE) v = val(prop.UpperBoundValue) ?? val(prop.SetPointValue) ?? val(prop.LowerBoundValue);
        if (v === null) continue;
        if (pn === "TotalWattage" && typeof v === "number") holder.wattageW = v * power;
        else if (pn === "Power" && typeof v === "number") holder.powerW = v * power;
        else if (pn === "Manufacturer" && typeof v === "string") holder.manufacturer = v;
        else if ((pn === "ModelReference" || pn === "ModelLabel") && typeof v === "string") holder.model = v;
        else if (pn !== "Reference") holder.props[pn] = v;
      } catch { /* a property that does not read */ }
    }
  };
  const typeMeta = new Map<number, MepMeta>();          // per type, applied to its instances
  const typeOf = new Map<number, number>();
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatingType?: unknown; RelatedObjects?: unknown };
        const tId = idOf(rel.RelatingType);
        if (tId === null) continue;
        const hits = ids(rel.RelatedObjects).filter((e) => targets.has(e));
        if (!hits.length) continue;
        let tm = typeMeta.get(tId);
        if (!tm) {
          tm = { globalId: null, predefinedType: null, typeName: null, storey: null, systems: [], uniformat: null, manufacturer: null, model: null, wattageW: null, powerW: null, props: {} };
          const line = api.GetLine(modelID, tId) as { Name?: unknown; HasPropertySets?: unknown; PredefinedType?: unknown };
          tm.typeName = str(line.Name);
          tm.predefinedType = str(line.PredefinedType);
          for (const pId of ids(line.HasPropertySets)) { try { takeProps(tm, pId); } catch { /* skip */ } }
          typeMeta.set(tId, tm);
        }
        for (const e of hits) typeOf.set(e, tId);
      } catch { /* skip */ }
    }
  } catch { /* no types */ }
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatedObjects?: unknown; RelatingPropertyDefinition?: unknown };
        const hits = ids(rel.RelatedObjects).filter((e) => targets.has(e));
        if (!hits.length) continue;
        const pId = idOf(rel.RelatingPropertyDefinition);
        if (pId === null) continue;
        for (const e of hits) takeProps(get(e), pId);
      } catch { /* skip */ }
    }
  } catch { /* no psets */ }
  // 4 · the classification (Uniformat), on the instance or on its type
  const classOfObj = new Map<number, string>();
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELASSOCIATESCLASSIFICATION);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatingClassification?: unknown; RelatedObjects?: unknown };
        const cId = idOf(rel.RelatingClassification);
        if (cId === null) continue;
        const c = api.GetLine(modelID, cId) as { Identification?: unknown; ItemReference?: unknown; Name?: unknown };
        const code = str(c.Identification) ?? str(c.ItemReference);
        if (!code) continue;
        for (const o of ids(rel.RelatedObjects)) classOfObj.set(o, code);
      } catch { /* skip */ }
    }
  } catch { /* no classification */ }
  // 5 · fold the type's facts into each instance (the instance's own word wins), the GlobalId and PredefinedType from the line
  for (const e of targets) {
    const m = get(e);
    try {
      const line = api.GetLine(modelID, e) as { GlobalId?: unknown; PredefinedType?: unknown };
      m.globalId = str(line.GlobalId);
      m.predefinedType = str(line.PredefinedType) ?? m.predefinedType;
    } catch { /* geometry-only */ }
    const tId = typeOf.get(e);
    const tm = tId !== undefined ? typeMeta.get(tId) : undefined;
    if (tm) {
      m.typeName = tm.typeName;
      if (!m.predefinedType || m.predefinedType === "NOTDEFINED") m.predefinedType = tm.predefinedType ?? m.predefinedType;
      m.manufacturer ??= tm.manufacturer; m.model ??= tm.model; m.wattageW ??= tm.wattageW; m.powerW ??= tm.powerW;
      for (const [k, v] of Object.entries(tm.props)) if (!(k in m.props)) m.props[k] = v;
    }
    m.uniformat = classOfObj.get(e) ?? (tId !== undefined ? classOfObj.get(tId) : undefined) ?? null;
  }
  return { meta, systems };
}

const MECH_CLASS = /^Ifc(AirTerminal|AirTerminalBox|DuctSegment|DuctFitting|DuctSilencer|Damper|Fan|UnitaryEquipment|SpaceHeater|Coil|Boiler|Chiller|Compressor|Condenser|Evaporator|EvaporativeCooler|Humidifier|Burner|Engine|CoolingTower|CooledBeam|AirToAirHeatRecovery|TubeBundle|Filter|HeatExchanger|Controller|UnitaryControlElement|Sensor|Actuator)$/;
const PLUMB_CLASS = /^Ifc(PipeSegment|PipeFitting|FlowTerminal|SanitaryTerminal|WasteTerminal|StackTerminal|Valve|Tank|Pump|Interceptor|FlowMeter|FlowInstrument)$/;
const ELEC_CLASS = /^Ifc(LightFixture|Lamp|Outlet|SwitchingDevice|JunctionBox|CableCarrierSegment|CableCarrierFitting|CableSegment|ElectricDistributionBoard|ElectricAppliance|ElectricGenerator|ElectricFlowStorageDevice|ElectricMotor|Transformer|ProtectiveDevice|SolarDevice|Alarm|AudioVisualAppliance|CommunicationsAppliance)$/;
const PLUMB_NAME = /water[_ -]?heater|softener|manabloc|manifold|hydrant|expansion tank|propane|lpg|dishwasher|disposal|faucet|sink|toilet|shower|bath|drain/i;
const MECH_NAME = /heat[_ -]?pump|furnace|heater|unit heater|fan|damper|erv|hrv|thermostat|air handler|roof vent|dryer ?box|ventub/i;
const ELEC_NAME = /solar|panel|inverter|battery|generator|outlet|receptacle|switch|charger|camera|meter|breaker|combiner|disconnect|junction|drive/i;
/** a display grouping, in this order: the class, the system the element belongs to, the family name; `other` otherwise */
export function disciplineOf(ifcClass: string, name: string, systems: MepSystemRef[]): Discipline {
  if (MECH_CLASS.test(ifcClass)) return "mechanical";
  if (PLUMB_CLASS.test(ifcClass)) return "plumbing";
  if (ELEC_CLASS.test(ifcClass)) return "electrical";
  for (const s of systems) {
    const t = s.predefinedType.toUpperCase();
    if (/VENTILATION|EXHAUST|VENT|HEATING|COOLING|AIRCONDITIONING|REFRIGERATION|CONDITIONING/.test(t)) return "mechanical";
    if (/DOMESTIC|SEWAGE|WATER|DRAINAGE|GAS|FUEL/.test(t)) return "plumbing";
    if (/ELECTRICAL|LIGHTING|POWER|DATA|SIGNAL|CONTROL|SECURITY|AUDIOVISUAL|TELEPHONE/.test(t)) return "electrical";
  }
  if (PLUMB_NAME.test(name)) return "plumbing";
  if (MECH_NAME.test(name)) return "mechanical";
  if (ELEC_NAME.test(name)) return "electrical";
  return "other";
}
