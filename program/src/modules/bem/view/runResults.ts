// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE RESULTS SHAPED FOR THE EYE (2026-09-15): pure helpers the RUN column and the results frame share — the End Uses
// cells as a rows × fuels table, a fuel's or a meter's name in words and its colour, the sizing reports as one row per
// coil and per component. Nothing here reads a file; every number is bem.db's, read back by the pipeline.

import type { EndUseCell, SizingDetail } from "../core/eplusSql.js";

export const FUEL_ORDER = ["Electricity", "Natural Gas", "Propane", "Fuel Oil No 1", "Fuel Oil No 2", "District Heating Water", "District Heating Steam", "District Cooling", "Gasoline", "Diesel", "Coal", "Other Fuel 1", "Other Fuel 2", "Water"];
const FUEL_LABEL: Record<string, string> = {
  Electricity: "electricity", "Natural Gas": "natural gas", Propane: "propane",
  "District Heating Water": "district heating — what the ideal-loads zones draw", "District Cooling": "district cooling — what the ideal-loads zones draw",
  "District Heating Steam": "district steam", Water: "water",
};
const FUEL_SHORT: Record<string, string> = { Electricity: "elec", "Natural Gas": "gas", Propane: "propane", "District Heating Water": "district heat", "District Cooling": "district cool", "District Heating Steam": "steam" };
const FUEL_COLOR: Record<string, string> = { Electricity: "#e4b04a", "Natural Gas": "#d6553b", Propane: "#c9743a", "District Heating Water": "#d94f4f", "District Cooling": "#3b8fd6", "District Heating Steam": "#b04a8a", Water: "#3fb6a8" };
export const fuelLabel = (f: string): string => FUEL_LABEL[f] ?? f.toLowerCase();
export const fuelShort = (f: string): string => FUEL_SHORT[f] ?? f.toLowerCase();
export const fuelColor = (f: string): string => FUEL_COLOR[f] ?? "#8b93a7";

export const END_USE_ORDER = ["Heating", "Cooling", "Interior Lighting", "Exterior Lighting", "Interior Equipment", "Exterior Equipment", "Fans", "Pumps", "Heat Rejection", "Humidification", "Heat Recovery", "Water Systems", "Refrigeration", "Generators", "Total End Uses"];

export interface EndUseTable {
  /** the end-use rows present, in the engine's order, the total row left out */
  rows: string[];
  /** the fuels present (kWh only — Water in m³ is not an energy) */
  fuels: string[];
  at: (row: string, fuel: string) => number | null;
  rowTotal: (row: string) => number;
  fuelTotal: (fuel: string) => number;
}

/** the End Uses cells as a table: rows × fuels, kWh */
export function endUseTable(cells: EndUseCell[]): EndUseTable {
  const kwh = cells.filter((c) => c.units === "kWh");
  const order = (list: string[], seen: Set<string>): string[] => [...list.filter((x) => seen.has(x)), ...[...seen].filter((x) => !list.includes(x))];
  const rows = order(END_USE_ORDER, new Set(kwh.map((c) => c.row))).filter((r) => r !== "Total End Uses");
  const fuels = order(FUEL_ORDER, new Set(kwh.map((c) => c.fuel)));
  return {
    rows, fuels,
    at: (row, fuel) => { const c = kwh.find((x) => x.row === row && x.fuel === fuel); return c ? c.value : null; },
    rowTotal: (row) => kwh.filter((c) => c.row === row).reduce((t, c) => t + c.value, 0),
    fuelTotal: (fuel) => kwh.filter((c) => c.fuel === fuel && c.row !== "Total End Uses").reduce((t, c) => t + c.value, 0),
  };
}

/** a meter's name in words — "DistrictHeatingWater:Facility" → "district heating (ideal loads)" */
export function meterLabel(name: string): string {
  const [use, fuel] = name.split(":");
  if (fuel === "Facility") {
    return use === "DistrictHeatingWater" ? "district heating (ideal loads)" : use === "DistrictCooling" ? "district cooling (ideal loads)"
      : use === "Electricity" ? "electricity, all uses" : use === "Propane" ? "propane, all uses" : use === "NaturalGas" ? "natural gas, all uses" : (use ?? name).toLowerCase();
  }
  const useWord = (use ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const fuelWord = fuel === "Electricity" ? "electric" : fuel === "NaturalGas" ? "gas" : (fuel ?? "").toLowerCase();
  return `${useWord} (${fuelWord})`;
}
export function meterColor(name: string): string {
  const [use, fuel] = name.split(":");
  if (use === "DistrictHeatingWater" || use === "Heating") return "#d94f4f";
  if (use === "DistrictCooling" || use === "Cooling") return "#3b8fd6";
  if (use === "InteriorLights" || use === "ExteriorLights") return "#e4b04a";
  if (use === "InteriorEquipment") return "#c9743a";
  if (use === "Fans") return "#2e9e5e";
  if (use === "Pumps" || use === "HeatRejection") return "#3fb6a8";
  if (fuel === "Facility") return "#cfd6e4";
  return "#8b93a7";
}

/** one coil of the CoilSizingDetails report — the numbers a unit is picked from */
export interface CoilRow {
  name: string; type: string; kind: string; hvacType: string; hvac: string; zones: string; plant: string;
  capacityW: number | null; sensibleW: number | null; ratedW: number | null;
  /** the LOAD the coil met at its design-day peak (the ideal loads it was sized from) — a variable-speed heat pump's heating and cooling
   *  coils are sized to one capacity, the larger side's, so the coil can stand well above its own side's load */
  peakW: number | null; peakSensibleW: number | null;
  airM3s: number | null; waterM3s: number | null; fanM3s: number | null;
  day: string; time: string;
  enteringDbC: number | null; enteringWbC: number | null; leavingDbC: number | null; enteringWaterC: number | null; leavingWaterC: number | null; outdoorDbC: number | null; zoneDbC: number | null;
  autosized: string;
}

/** the coil's role in words, from its class */
export function coilKind(type: string): string {
  if (/WaterToAirHeatPump/i.test(type)) return /Cooling/i.test(type) ? "heat-pump cooling" : "heat-pump heating";
  if (/Cooling/i.test(type)) return "cooling";
  if (/Heating:Electric/i.test(type)) return "electric heating";
  if (/Heating:Fuel|Heating:Gas/i.test(type)) return "fuel heating";
  if (/Heating:Water/i.test(type)) return "hot-water heating";
  if (/Heating/i.test(type)) return "heating";
  return type.toLowerCase();
}

/** THE COIL'S WATER FLOW from the engine's MASS flow (kg/s ÷ water's 998.2 kg/m³ at 20 °C), its volume column only when no mass
 *  is reported. Measured 2026-10-02 on run 20261002T175458 (EnergyPlus 26.1): for a Coil:*:WaterToAirHeatPump:VariableSpeed-
 *  EquationFit, CoilSizingDetails' "Coil Final Reference Plant Fluid Volume Flow Rate" holds the MASS number under m3/s
 *  (HP-ADU Cooling Coil: 0.10006 "m3/s" beside 0.10046 kg/s) — read as volume it showed 1,586 gpm for a 6 MBH coil */
export function waterFlowM3s(massKgS: number | null, volumeM3s: number | null): number | null {
  if (massKgS !== null && massKgS > 0) return massKgS / 998.2;
  return volumeM3s;
}

export function coilRows(d: SizingDetail[]): CoilRow[] {
  const byCoil = new Map<string, Map<string, SizingDetail>>();
  for (const s of d) { if (s.kind !== "coil") continue; const m = byCoil.get(s.subject) ?? new Map<string, SizingDetail>(); m.set(s.field, s); byCoil.set(s.subject, m); }
  const out: CoilRow[] = [];
  for (const [name, m] of byCoil) {
    const num = (f: string): number | null => m.get(f)?.value ?? null;
    const txt = (f: string): string => m.get(f)?.text ?? (m.get(f)?.value !== null && m.get(f)?.value !== undefined ? String(m.get(f)!.value) : "");
    const type = txt("Coil Type");
    out.push({
      name, type, kind: coilKind(type), hvacType: txt("HVAC Type"), hvac: txt("HVAC Name"), zones: txt("Zone Name(s)"), plant: txt("Plant Name for Coil"),
      capacityW: num("Coil Final Gross Total Capacity"), sensibleW: num("Coil Final Gross Sensible Capacity"), ratedW: num("Coil Total Capacity at Rating Conditions"),
      peakW: num("Coil Total Capacity at Ideal Loads Peak"), peakSensibleW: num("Coil Sensible Capacity at Ideal Loads Peak"),
      airM3s: num("Coil Final Reference Air Volume Flow Rate"), waterM3s: waterFlowM3s(num("Coil Plant Fluid Mass Flow Rate at Ideal Loads Peak"), num("Coil Final Reference Plant Fluid Volume Flow Rate")), fanM3s: num("Supply Fan Maximum Air Volume Flow Rate"),
      day: txt("Design Day Name at Sensible Ideal Loads Peak"), time: txt("Date/Time at Sensible Ideal Loads Peak"),
      enteringDbC: num("Coil Entering Air Drybulb at Ideal Loads Peak"), enteringWbC: num("Coil Entering Air Wetbulb at Ideal Loads Peak"), leavingDbC: num("Coil Leaving Air Drybulb at Ideal Loads Peak"),
      enteringWaterC: num("Coil Entering Plant Fluid Temperature at Ideal Loads Peak"), leavingWaterC: num("Coil Leaving Plant Fluid Temperature at Ideal Loads Peak"),
      outdoorDbC: num("Outdoor Air Drybulb at Ideal Loads Peak"), zoneDbC: num("Zone Air Drybulb at Ideal Loads Peak"),
      autosized: [txt("Autosized Coil Capacity?") === "Yes" ? "capacity" : "", txt("Autosized Coil Airflow?") === "Yes" ? "air flow" : "", txt("Autosized Coil Water Flow?") === "Yes" ? "water flow" : ""].filter(Boolean).join(", "),
    });
  }
  return out.sort((a, b) => a.hvac.localeCompare(b.hvac) || a.name.localeCompare(b.name));
}

/** ONE UNIT's sizing (user, 2026-10-02: "unit sizing needs to have peak load for each unit in heating and cooling with cfm"): its
 *  coils from CoilSizingDetails grouped by the engine's HVAC Name — the cooling coil's total (and sensible) capacity and air flow, the
 *  heating coil's capacity and air flow, the zones it serves. A supplemental coil switched off on the card is written at 0 W
 *  (it is required by the parent class); a coil sized to 0 W is no part of the unit and is left out, its name kept in `none` */
export interface UnitRow {
  unit: string; zones: string;
  cooling: CoilRow | null; heating: CoilRow | null;
  /** further coils with a capacity — a supplemental heater switched on, a reheat */
  others: CoilRow[];
  /** coils written to satisfy the class and sized to 0 W — the supplemental heater switched off */
  none: CoilRow[];
}
export function unitRows(coils: CoilRow[]): UnitRow[] {
  const by = new Map<string, CoilRow[]>();
  for (const c of coils) { const k = c.hvac || c.name; by.set(k, [...(by.get(k) ?? []), c]); }
  const out: UnitRow[] = [];
  for (const [unit, list] of by) {
    const sized = list.filter((c) => (c.capacityW ?? 0) > 0), none = list.filter((c) => !((c.capacityW ?? 0) > 0));
    const cooling = sized.find((c) => /Cooling/i.test(c.type)) ?? null;
    const heating = sized.find((c) => /Heating/i.test(c.type) && !/Supplemental/i.test(c.name)) ?? sized.find((c) => /Heating/i.test(c.type)) ?? null;
    out.push({ unit, zones: list.map((c) => c.zones).find(Boolean) ?? "", cooling, heating, others: sized.filter((c) => c !== cooling && c !== heating), none });
  }
  return out.sort((a, b) => a.unit.localeCompare(b.unit));
}

/** one object of the ComponentSizingSummary report with every field the engine sized for it */
export interface ComponentRow { cls: string; name: string; fields: Array<{ field: string; value: number | null; text: string | null; units: string }> }
export function componentRows(d: SizingDetail[]): ComponentRow[] {
  const by = new Map<string, ComponentRow>();
  for (const s of d) {
    if (s.kind !== "component") continue;
    const id = `${s.cls}|${s.subject}`;
    const r = by.get(id) ?? { cls: s.cls, name: s.subject, fields: [] };
    r.fields.push({ field: s.field, value: s.value, text: s.text, units: s.units });
    by.set(id, r);
  }
  return [...by.values()].sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
}

/** the engine's design-day stamp "7/21 16:00:00" in words — "21 Jul 16:00"; a weather-year stamp passes through decodeTime */
export function designStamp(t: string): string {
  const m = /^\s*(\d+)\/(\d+)\s+(\d+):(\d+)/.exec(t);
  if (!m) return t;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[2]} ${MON[+m[1]! - 1] ?? m[1]} ${m[3]!.padStart(2, "0")}:${m[4]}`;
}

/** a design day's name shortened: "GOLDEN-NREL ANN HTG 99.6% CONDNS DB" → "Ann Htg 99.6% Condns DB" */
export function designDayShort(name: string): string {
  const i = name.search(/ (ANN|JULY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|WINTER|SUMMER)\b/i);
  const s = i > 0 ? name.slice(i + 1) : name;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bDb\b/g, "DB").replace(/\bMcwb\b/g, "MCWB").replace(/\bWb\b/g, "WB");
}

/** THE STRUCTURE'S PEAK (user, 2026-10-11: "Because of mechanical system limitation, the zones of the house are set as individual units for
 *  energyplus modeling … we need each structure to sum the loads for each zone at each structure's peak load (capturing zone loads at
 *  structure's peak), and show Structure Peak as a line (so we can make sure the structure's actual equipment is sized correctly)"). A
 *  structure is one card on the sheet — the house's heat pump, written as a unit per thermostat zone, or the ADU's own. At every instant the
 *  rates of all its units' coils are summed; the instant the SUM is largest is the structure's peak, and each unit's own rate at that instant
 *  is what it adds to it — never the units' own peaks added up. Two bases: the design days at each zone timestep (the sizing basis — the
 *  heating side on the winter day, the cooling side on the summer day) and the weather year by the hour. Cooling is the coil's total. */
export interface StructurePeakSide { w: number; at: string; byUnit: Array<{ unit: string; zones: string; w: number; ownPeakW: number }> }
export interface StructurePeak { name: string; units: string[]; design: { heating: StructurePeakSide | null; cooling: StructurePeakSide | null }; year: { heating: StructurePeakSide | null; cooling: StructurePeakSide | null } }
export function structurePeaks(structures: Array<{ name: string; units: string[] }>, coils: CoilRow[], rates: { design: Array<{ coil: string; kind: "heating" | "cooling"; day: "summer" | "winter"; minute: number; w: number }>; year: Array<{ coil: string; kind: "heating" | "cooling"; values: number[] }> },
  yearStamp: (hour: number) => string): StructurePeak[] {
  // the engine names a unit's coils by its AIR LOOP ("HP-HOUSE MASTER AIR LOOP"); the sheet names the unit ("HP-HOUSE Master")
  const unitKey = (h: string): string => h.toUpperCase().replace(/ AIR LOOP$/, "");
  const unitOfCoil = new Map(coils.map((c) => [c.name.toUpperCase(), unitKey(c.hvac || c.name)] as const));
  const zonesOf = new Map(coils.map((c) => [unitKey(c.hvac || c.name), c.zones] as const));
  const clock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const side = (units: string[], kind: "heating" | "cooling", series: Map<string, Map<number, number>>, stamp: (t: number) => string): StructurePeakSide | null => {
    const U = new Set(units.map((u) => u.toUpperCase()));
    // per unit, its coils of this side summed at each instant
    const per = new Map<string, Map<number, number>>();
    for (const [coil, s] of series) {
      const u = unitOfCoil.get(coil);
      if (!u || !U.has(u)) continue;
      const m = per.get(u) ?? per.set(u, new Map()).get(u)!;
      for (const [t, w] of s) m.set(t, (m.get(t) ?? 0) + w);
    }
    if (!per.size) return null;
    const total = new Map<number, number>();
    for (const m of per.values()) for (const [t, w] of m) total.set(t, (total.get(t) ?? 0) + w);
    let best: [number, number] | null = null;
    for (const [t, w] of total) if (!best || w > best[1]) best = [t, w];
    if (!best || best[1] <= 0) return null;
    const t0 = best[0];
    return { w: best[1], at: stamp(t0), byUnit: [...per].map(([u, m]) => ({ unit: units.find((x) => x.toUpperCase() === u) ?? u, zones: zonesOf.get(u) ?? "", w: m.get(t0) ?? 0, ownPeakW: Math.max(0, ...m.values()) })).sort((a, b) => b.w - a.w) };
  };
  const dd = (kind: "heating" | "cooling"): Map<string, Map<number, number>> => {
    const day = kind === "heating" ? "winter" : "summer", out = new Map<string, Map<number, number>>();
    for (const r of rates.design) if (r.kind === kind && r.day === day) (out.get(r.coil) ?? out.set(r.coil, new Map()).get(r.coil)!).set(r.minute, r.w);
    return out;
  };
  const yr = (kind: "heating" | "cooling"): Map<string, Map<number, number>> => new Map(rates.year.filter((r) => r.kind === kind).map((r) => [r.coil, new Map(r.values.map((w, i) => [i, w] as const))] as const));
  const ddStamp = (kind: "heating" | "cooling") => (t: number): string => `${kind === "heating" ? "winter" : "summer"} design day ${clock(t)}`;
  return structures.map((s) => ({ name: s.name, units: s.units,
    design: { heating: side(s.units, "heating", dd("heating"), ddStamp("heating")), cooling: side(s.units, "cooling", dd("cooling"), ddStamp("cooling")) },
    year: { heating: side(s.units, "heating", yr("heating"), yearStamp), cooling: side(s.units, "cooling", yr("cooling"), yearStamp) } }));
}
