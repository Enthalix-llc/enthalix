// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PLUMBING SHEET, WRITTEN (user, 2026-10-02: water heaters "assigned to a specific room for room heat gain and loss (with heat
// pump water heater)"). Each heater card becomes a STAND-ALONE tank — no plant loop: the IDD's use-side notes, a peak use flow and its
// fraction schedule on the tank, the cold supply the mains (Site:WaterMainsTemperature, CorrelationFromWeatherFile — the engine's
// correlation from the weather file, the same Building America / ANSI-RESNET 301 formula) — on the shape the engine's own single-family
// example writes (SingleFamilyHouse_HP_Slab.idf): a WaterHeater:Stratified, its skin losses to the ROOM'S ZONE; a heat pump adds its
// wrapped-condenser coil and fan and joins that zone's equipment, drawing the zone's air through the zone's own exhaust and inlet
// nodes — the zone is cooled and dried by it. A zone on ideal loads (a template) can take no further equipment: refused, by name.

import type { EpSchema } from "./epSchema.js";
import type { ResolvedObject, ResolvedSystem, ResolvedSystems, ResolvedField, FieldRef } from "./bemSystems.js";
import { rawObject } from "./bemSystems.js";
import { objectOf } from "./epAssemble.js";
import { sanitizeIdfName, type Source } from "./bemIdf.js";
import { DHW_SHAPE, DHW_SHAPE_CITE, DHW_SETPOINT_C, DHW_SETPOINT_CITE, peakFlowM3s, weekShape, type PlumbCompiled } from "./plumbSheet.js";
import type { ScheduleProfile } from "./schedules.js";

const code: Source = "code-default", dataset: Source = "dataset";

/** THE ENGINE'S TANK SURFACE (2026-10-07): a VerticalCylinder of the stated volume and height — its side and both ends, the area the
 *  engine multiplies the skin loss coefficient by (WaterThermalTanks: the tank's own geometry, never the product's jacket) */
export function tankAreaM2(volumeM3: number, heightM: number): number {
  const d = Math.sqrt((4 * volumeM3) / (Math.PI * heightM));
  return Math.PI * d * heightM + (Math.PI * d * d) / 2;
}
/** A PRODUCT'S STANDBY LOSS AS THE ENGINE'S COEFFICIENT (user, 2026-10-07: "It states a loss rate of 25 Wh at 45 °F difference"): the
 *  loss over the difference is the tank's UA, W/K; over the engine's own tank area, the coefficient — so the engine loses what the
 *  product states, whatever the jacket's dimensions */
export const skinFromStandby = (lossW: number, deltaK: number, volumeM3: number, heightM: number): number => lossW / deltaK / tankAreaM2(volumeM3, heightM);
/** the example's (SingleFamilyHouse_HP_Slab.idf) tank and heat pump, the values every card starts from */
export const DHW_EXAMPLE = {
  tankHeightM: 1.594, heater1HeightM: 1.129, heater2HeightM: 0.266, deadbandC: 2, skinLossWm2K: 4.536492, parasiticW: 8.3,
  hpwh: { ratedCapacityW: 1500, ratedCop: 3.0, shr: 0.981, evapDbC: 19.7, evapWbC: 13.5, condWaterC: 48.89, evapFlowM3s: 0.189, minInletC: 10, maxInletC: 48.89,
    deadbandC: 5, condBottomM: 0.0664166667, condTopM: 0.8634166667, sensor1M: 1.262, sensor1Weight: 0.75, sensor2M: 0.464, fanEff: 0.7, fanDp: 100, motorEff: 0.9 },
  cite: "the engine's SingleFamilyHouse_HP_Slab.idf",
};
/** the tank's limit (the engine's WaterHeaterStandAlone.idf) and the recovery efficiencies — 2010 Building America House Simulation
 *  Protocols Table 6: electric 1.00, gas 0.78 */
export const DHW_LIMIT_C = 82.2222;
export const RECOVERY = { electric: 1.0, gas: 0.78, cite: "2010 Building America House Simulation Protocols Table 6 (recovery efficiency: electric 1.00, gas 0.78)" };
/** THE ENGINE'S OWN RESIDENTIAL SIZING (WaterHeater:Sizing's ResidentialHUD-FHAMinimum), read from its source —
 *  EnergyPlus src/EnergyPlus/WaterThermalTanks.cc, SizingMode::ResidentialMin: the tank in gallons and the heater in kW (electric) or
 *  kBtu/h (gas and every fuel like it) by bedrooms × bathrooms. Written as numbers rather than autosized: autosized, the stratified
 *  tank came out NaN in its zone's first sizing step (measured 2026-10-02 — "Unanticipated combination of heating and cooling loads …
 *  LoadToHeatingSetPoint=NAN"), the same tank at a stated size ran clean. The table starts at one bedroom: 0 reads as 1, said */
export function hudFha(bedrooms: number, bathrooms: number, gas: boolean): { gal: number; w: number; row: string } {
  const KBTU = 293.0711;
  const b = Math.max(1, Math.round(bedrooms)), ba = bathrooms;
  const pick = (eGal: number, eKw: number, gGal: number, gKbtu: number): { gal: number; w: number } => (gas ? { gal: gGal, w: gKbtu * KBTU } : { gal: eGal, w: eKw * 1000 });
  const band = ba <= 1.5 ? 0 : ba < 3 ? 1 : 2;
  let r: { gal: number; w: number };
  if (b === 1) r = pick(20, 2.5, 20, 27);
  else if (b === 2) r = [pick(30, 3.5, 30, 36), pick(40, 4.5, 30, 36), pick(50, 5.5, 40, 36)][band]!;
  else if (b === 3) r = [pick(40, 4.5, 30, 36), pick(50, 5.5, 40, 36), pick(50, 5.5, 40, 38)][band]!;
  else if (b === 4) r = [pick(50, 5.5, 40, 36), pick(50, 5.5, 40, 38), pick(66, 5.5, 50, 38)][band]!;
  else if (b === 5) r = pick(66, 5.5, 50, 47);
  else r = pick(66, 5.5, 50, 50);
  return { ...r, row: `${b} bedroom${b === 1 ? "" : "s"}${bedrooms < 1 ? " (0 counted — the table starts at 1)" : ""}, ${ba} bath${ba === 1 ? "" : "s"}` };
}
export const HUD_FHA_CITE = "the engine's own ResidentialHUD-FHAMinimum table (EnergyPlus WaterThermalTanks.cc)";
/** the backup element's setpoint under the compressor's: the engine's example runs its element at 44 °C under a 50 °C compressor —
 *  at or above the heat pump's cut-in the engine disables the heat pump all year (its own warning, measured 2026-10-02) */
export const HPWH_ELEMENT_OFFSET_K = 6;
const CURVES = [
  rawObject("Curve:Biquadratic", "HPWH-Htg-Cap-fT", [["name", "HPWH-Htg-Cap-fT", dataset], ...["0.563", "0.0437", "0.000039", "0.0055", "-.000148", "-.000145", "0", "100", "0", "100"].map((v, i) => [`c${i}`, v, dataset] as [string, string, Source])]),
  rawObject("Curve:Biquadratic", "HPWH-Htg-COP-fT", [["name", "HPWH-Htg-COP-fT", dataset], ...["1.1332", "0.063", "-.0000979", "-.00972", "-.0000214", "-.000686", "0", "100", "0", "100"].map((v, i) => [`c${i}`, v, dataset] as [string, string, Source])]),
  rawObject("Curve:Quadratic", "HPWH-COP-fPLR", [["name", "HPWH-COP-fPLR", dataset], ...["1", "0", "0", "0", "1"].map((v, i) => [`c${i}`, v, dataset] as [string, string, Source])]),
];

const num = (f: Record<string, unknown>, k: string): number | null => (typeof f[k] === "number" ? (f[k] as number) : null);
const setRef = (o: ResolvedObject | null, key: string, ref: FieldRef): void => { const f = o?.fields.find((x) => x.key === key); if (f) { f.ref = ref; f.value = ""; } };
const field = (key: string, value: string, source: Source, ref?: FieldRef): ResolvedField => ({ key, label: key.replace(/_/g, " "), value, source, units: null, ...(ref ? { ref } : {}) });

export interface DhwWritten { row: ResolvedSystem | null; refused: string[]; zones: string[];
  /** THE WELL PUMPS (Domestic Water, the user 2026-10-05), their own row after the heaters' — the same objects, in the same order */
  wellRow?: ResolvedSystem | null }

/** the heaters → one systems row the writer emits AHEAD of the others (a zone's list names the heat pump, so it must be written first);
 *  a heat pump's zone list and connections are patched in `sys` where that zone's equipment already lives */
/** `water`: the SCHEDULES roles ruled (2026-10-03) — the domestic hot water's profile on every tank's draw, the domestic water's on the well pump */
export function writeDhw(c: PlumbCompiled, schema: EpSchema | null, sys: ResolvedSystems, zoneOfRoom: ReadonlyMap<string, string>, conditioned: (zone: string) => boolean,
  water: { hotWater?: ScheduleProfile | null; domestic?: ScheduleProfile | null; mains?: { annualC: number; maxDiffC: number; words: string } | null } = {}): DhwWritten {
  const refused: string[] = c.refusals.map((r) => r.text);
  if (!c.heaters.length && !c.wells.length) return { row: null, refused, zones: [] };
  if (!schema) return { row: null, refused: [...refused, "Energy+.schema.epJSON is not read — no water heater can be written"], zones: [] };
  const out: ResolvedObject[] = [], zones: string[] = [];
  const push = (o: ResolvedObject | null, what: string): void => { if (o) out.push(o); else refused.push(`${what} is not in the schema`); };
  // the schedules every tank shares: the setpoint, the use shape; the mains once
  out.push(rawObject("ScheduleTypeLimits", "DHW fraction", [["name", "DHW fraction", code], ["lower_limit_value", "0", code], ["upper_limit_value", "1", code], ["numeric_type", "Continuous", code]]));
  if (c.heaters.length) out.push(rawObject("ScheduleTypeLimits", "DHW temperature", [["name", "DHW temperature", code], ["lower_limit_value", "-60", code], ["upper_limit_value", "200", code], ["numeric_type", "Continuous", code], ["unit_type", "Temperature", code]]));
  const setpoint = `DHW setpoint ${DHW_SETPOINT_C}C`;
  if (c.heaters.length) out.push({ cls: "Schedule:Constant", name: setpoint, minFields: null, fields: [field("name", setpoint, code), field("schedule_type_limits_name", "", code, { system: "DHW temperature" }), field("hourly_value", String(DHW_SETPOINT_C), dataset)] });
  const elementSp = `DHW element setpoint ${(DHW_SETPOINT_C - HPWH_ELEMENT_OFFSET_K).toFixed(2)}C`;
  if (c.heaters.some((h) => h.kind === "hpwh")) out.push({ cls: "Schedule:Constant", name: elementSp, minFields: null, fields: [field("name", elementSp, code), field("schedule_type_limits_name", "", code, { system: "DHW temperature" }), field("hourly_value", (DHW_SETPOINT_C - HPWH_ELEMENT_OFFSET_K).toFixed(2), dataset)] });
  const shape = "DHW use shape";
  // THE DOMESTIC HOT WATER ROLE (2026-10-03): ruled, every tank draws on its profile and the peak flow is sized so the day still sums to the
  // heater's gallons on the profile's week-averaged day; unruled, the Building America shape as before
  const hw = water.hotWater ?? null, hwShape = hw ? weekShape(hw) : DHW_SHAPE;
  if (hw && !(hwShape.reduce((t, v) => t + v, 0) > 0)) refused.push(`SCHEDULES › domestic hot water: ${hw.name} reads 0 all day — the tanks keep the Building America shape`);
  const hwRuled = !!hw && hwShape.reduce((t, v) => t + v, 0) > 0;
  if (c.heaters.length && !hwRuled) out.push({ cls: "Schedule:Compact", name: shape, minFields: null, fields: [field("name", shape, code), field("schedule_type_limits_name", "", code, { system: "DHW fraction" }), field("f1", "Through: 12/31", dataset), field("f2", "For: AllDays", dataset),
    ...DHW_SHAPE.flatMap((v, h) => [field(`u${h}`, `Until: ${String(h + 1).padStart(2, "0")}:00`, dataset), field(`v${h}`, String(v), dataset)])] });
  // an actual year that is not a calendar year: the engine's own reading of the file is wrong (epwRead `mainsCorrelation`) — the same
  // correlation on the file's own whole months
  const mains = water.mains ?? null;
  if (c.heaters.length) out.push(rawObject("Site:WaterMainsTemperature", "mains", mains
    ? [["calculation_method", "Correlation", code], ["temperature_schedule_name", "", code], ["annual_average_outdoor_air_temperature", mains.annualC.toFixed(2), "file"],
      ["maximum_difference_in_monthly_average_outdoor_air_temperatures", mains.maxDiffC.toFixed(2), "file"]]
    : [["calculation_method", "CorrelationFromWeatherFile", dataset]]));
  if (c.heaters.some((h) => h.kind === "hpwh")) out.push(...CURVES.map((o) => ({ ...o, fields: o.fields.map((f) => ({ ...f })) })));

  for (const h of c.heaters) {
    const id = sanitizeIdfName(h.name), f = h.fields as Record<string, unknown>;
    const zone = zoneOfRoom.get(h.room);
    if (!zone) { refused.push(`${h.name}: its room ${h.room} is in no zone of the model`); continue; }
    const tankName = h.kind === "hpwh" ? `${id} Tank` : id;
    const gas = h.kind === "gas";
    const size = hudFha(h.uses.reduce((t, u) => t + u.bedrooms, 0), Math.max(1, h.uses.reduce((t, u) => t + u.bathrooms, 0)), gas);
    const fuel = gas ? (f.heater_fuel_type === "NaturalGas" ? "NaturalGas" : "Propane") : "Electricity";
    const volM3 = num(f, "tank_volume") ?? Number((size.gal * 0.003785411784).toFixed(6));
    const standbyW = num(f, "standby_loss_w"), standbyK = num(f, "standby_loss_delta_k");
    const skin = standbyW !== null && standbyW !== undefined && standbyK ? Number(skinFromStandby(standbyW, standbyK, volM3, DHW_EXAMPLE.tankHeightM).toPrecision(6)) : num(f, "skin_loss_coefficient") ?? DHW_EXAMPLE.skinLossWm2K;
    const tank = objectOf(schema, "WaterHeater:Stratified", tankName, undefined, {
      end_use_subcategory: "Domestic Hot Water", tank_volume: volM3, tank_height: DHW_EXAMPLE.tankHeightM, tank_shape: "VerticalCylinder",
      maximum_temperature_limit: DHW_LIMIT_C, heater_priority_control: "MasterSlave",
      heater_1_deadband_temperature_difference: DHW_EXAMPLE.deadbandC, heater_1_capacity: num(f, "heater_1_capacity") ?? Number(size.w.toFixed(1)), heater_1_height: DHW_EXAMPLE.heater1HeightM,
      heater_2_deadband_temperature_difference: DHW_EXAMPLE.deadbandC, heater_2_capacity: 0, heater_2_height: DHW_EXAMPLE.heater2HeightM,
      heater_fuel_type: fuel, heater_thermal_efficiency: num(f, "heater_thermal_efficiency") ?? (gas ? RECOVERY.gas : RECOVERY.electric),
      off_cycle_parasitic_fuel_consumption_rate: h.kind === "hpwh" ? DHW_EXAMPLE.parasiticW : 0, off_cycle_parasitic_fuel_type: "Electricity", off_cycle_parasitic_heat_fraction_to_tank: 0, off_cycle_parasitic_height: 1,
      on_cycle_parasitic_fuel_consumption_rate: h.kind === "hpwh" ? DHW_EXAMPLE.parasiticW : 0, on_cycle_parasitic_fuel_type: "Electricity", on_cycle_parasitic_heat_fraction_to_tank: 0, on_cycle_parasitic_height: 1,
      ambient_temperature_indicator: "Zone",
      uniform_skin_loss_coefficient_per_unit_area_to_ambient_temperature: skin, skin_loss_fraction_to_zone: 1, off_cycle_flue_loss_fraction_to_zone: 1,
      peak_use_flow_rate: h.gpd > 0 ? Number(peakFlowM3s(h.gpd, hwRuled ? hwShape : DHW_SHAPE).toPrecision(6)) : 0,
      use_side_effectiveness: 1, use_side_inlet_height: 0, use_side_outlet_height: "autocalculate", source_side_effectiveness: 1, source_side_inlet_height: 0.7, source_side_outlet_height: 0,
      inlet_mode: "Fixed", indirect_water_heating_recovery_time: 1.5, number_of_nodes: 1,
    });
    setRef(tank, "heater_1_setpoint_temperature_schedule_name", { system: h.kind === "hpwh" ? elementSp : setpoint });
    setRef(tank, "heater_2_setpoint_temperature_schedule_name", { system: h.kind === "hpwh" ? elementSp : setpoint });
    setRef(tank, "ambient_temperature_zone_name", { zone });
    if (h.gpd > 0) setRef(tank, "use_flow_rate_fraction_schedule_name", hwRuled ? { schedule: { file: hw!.file, name: hw!.name } } : { system: shape });
    if (h.kind !== "hpwh") { push(tank, "WaterHeater:Stratified"); }
    if (h.kind === "hpwh") {
      // the zone's equipment: the heat pump draws the zone's air — a ZoneAirOnly inlet through the zone's own nodes
      const kind = sys.zoneKind.get(zone);
      if (kind?.startsWith("HVACTemplate:")) { refused.push(`${h.name}: ${zone} is on ${kind} (a template) — its equipment list is the expansion's and cannot take the heat pump; give the zone a system on MECHANICAL, or place the heater in another room`); continue; }
      if (!kind && conditioned(zone)) { refused.push(`${h.name}: ${zone} is conditioned on ideal loads — a template whose equipment list cannot take the heat pump; give the zone a system on MECHANICAL, or place the heater in another room`); continue; }
      const nIn = `${id} HPWH Air Inlet Node`, nFan = `${id} HPWH Fan Inlet Node`, nOut = `${id} HPWH Air Outlet Node`;
      const coilName = `${id} HPWH Evaporator`, fanName = `${id} HPWH Fan`;
      push(tank, "WaterHeater:Stratified");
      const coil = objectOf(schema, "Coil:WaterHeating:AirToWaterHeatPump:Wrapped", coilName, undefined, {
        rated_heating_capacity: num(f, "rated_heating_capacity") ?? DHW_EXAMPLE.hpwh.ratedCapacityW, rated_cop: num(f, "rated_cop") ?? DHW_EXAMPLE.hpwh.ratedCop,
        rated_sensible_heat_ratio: DHW_EXAMPLE.hpwh.shr, rated_evaporator_inlet_air_dry_bulb_temperature: DHW_EXAMPLE.hpwh.evapDbC, rated_evaporator_inlet_air_wet_bulb_temperature: DHW_EXAMPLE.hpwh.evapWbC,
        rated_condenser_water_temperature: DHW_EXAMPLE.hpwh.condWaterC, rated_evaporator_air_flow_rate: DHW_EXAMPLE.hpwh.evapFlowM3s, evaporator_fan_power_included_in_rated_cop: "Yes",
        evaporator_air_inlet_node_name: nIn, evaporator_air_outlet_node_name: nFan, maximum_ambient_temperature_for_crankcase_heater_operation: 10,
        evaporator_air_temperature_type_for_curve_objects: "WetBulbTemperature", heating_capacity_function_of_temperature_curve_name: "HPWH-Htg-Cap-fT",
        heating_cop_function_of_temperature_curve_name: "HPWH-Htg-COP-fT", part_load_fraction_correlation_curve_name: "HPWH-COP-fPLR",
      });
      push(coil, "Coil:WaterHeating:AirToWaterHeatPump:Wrapped");
      // THE HEAT IT TAKES FROM THE ROOM (user, 2026-10-07: the peak graph showed no heat pump water heater in the Garage): the evaporator's
      // sensible cooling of the zone air, every time step — the engine's Zone Component Load Summary counts zone equipment as no load
      // component, so RUN reads this beside it
      out.push(rawObject("Output:Variable", `${coilName} sensible cooling`, [["key_value", coilName, code], ["variable_name", "Cooling Coil Sensible Cooling Rate", dataset], ["reporting_frequency", "Timestep", dataset]]));
      const fan = objectOf(schema, "Fan:OnOff", fanName, undefined, {
        fan_total_efficiency: DHW_EXAMPLE.hpwh.fanEff, pressure_rise: DHW_EXAMPLE.hpwh.fanDp, maximum_flow_rate: "autosize", motor_efficiency: DHW_EXAMPLE.hpwh.motorEff, motor_in_airstream_fraction: 1,
        air_inlet_node_name: nFan, air_outlet_node_name: nOut, end_use_subcategory: "Domestic Hot Water",
      });
      setRef(fan, "availability_schedule_name", { schedule: "always" });
      push(fan, "Fan:OnOff");
      const hp = objectOf(schema, "WaterHeater:HeatPump:WrappedCondenser", id, undefined, {
        dead_band_temperature_difference: DHW_EXAMPLE.hpwh.deadbandC, condenser_bottom_location: DHW_EXAMPLE.hpwh.condBottomM, condenser_top_location: DHW_EXAMPLE.hpwh.condTopM,
        evaporator_air_flow_rate: "autocalculate", inlet_air_configuration: "ZoneAirOnly", air_inlet_node_name: nIn, air_outlet_node_name: nOut,
        tank_object_type: "WaterHeater:Stratified", dx_coil_object_type: "Coil:WaterHeating:AirToWaterHeatPump:Wrapped",
        minimum_inlet_air_temperature_for_compressor_operation: num(f, "minimum_inlet_air_temperature_for_compressor_operation") ?? DHW_EXAMPLE.hpwh.minInletC,
        maximum_inlet_air_temperature_for_compressor_operation: DHW_EXAMPLE.hpwh.maxInletC, compressor_location: "Zone",
        fan_object_type: "Fan:OnOff", fan_placement: "DrawThrough", on_cycle_parasitic_electric_load: 0, off_cycle_parasitic_electric_load: 0,
        tank_element_control_logic: "MutuallyExclusive", control_sensor_1_height_in_stratified_tank: DHW_EXAMPLE.hpwh.sensor1M,
        control_sensor_1_weight: DHW_EXAMPLE.hpwh.sensor1Weight, control_sensor_2_height_in_stratified_tank: DHW_EXAMPLE.hpwh.sensor2M,
      });
      setRef(hp, "availability_schedule_name", { schedule: "always" });
      setRef(hp, "compressor_setpoint_temperature_schedule_name", { system: setpoint });
      setRef(hp, "inlet_air_zone_name", { zone });
      setRef(hp, "tank_name", { system: tankName });
      setRef(hp, "dx_coil_name", { system: coilName });
      setRef(hp, "fan_name", { system: fanName });
      push(hp, "WaterHeater:HeatPump:WrappedCondenser");
      if (hp) { const w = joinZone(sys, out, zone, id, nIn, nOut); if (w) refused.push(`${h.name}: ${w}`); else zones.push(zone); }
    }
  }
  // THE WELL PUMP (2026-10-03): the house's whole water lifted from the well — Exterior:FuelEquipment on electricity (the user's ruling:
  // outside, no room takes its heat), its own end use "Well Pump"; it runs as long as the day's water at its flow takes, spread over the
  // day on the domestic water shape (the SCHEDULES role, else the hot water's), each hour's run fraction capped at 1
  const dwP = water.domestic ?? null, dwShape = dwP ? weekShape(dwP) : hwShape, dwSum = dwShape.reduce((t, v) => t + v, 0);
  const wellAt = out.length, wellRefusedAt = refused.length;
  for (const wl of c.wells) {
    const id = sanitizeIdfName(wl.name), sched = `${id} run`;
    if (!(dwSum > 0)) { refused.push(`${wl.name}: the domestic water shape reads 0 all day — nothing to run on`); continue; }
    const frac = dwShape.map((v) => Math.min(1, (wl.runHours * v) / dwSum));
    if (frac.some((v, i) => v < (wl.runHours * dwShape[i]!) / dwSum - 1e-9)) refused.push(`${wl.name}: ${wl.gpd.toFixed(0)} gal/day at ${wl.gpm} gpm runs longer than the shape's busiest hours hold — capped at the full hour, the day's run is short; check the pump's flow`);
    out.push({ cls: "Schedule:Compact", name: sched, minFields: null, fields: [field("name", sched, code), field("schedule_type_limits_name", "", code, { system: "DHW fraction" }), field("f1", "Through: 12/31", dataset), field("f2", "For: AllDays", dataset),
      ...frac.flatMap((v, hr) => [field(`u${hr}`, `Until: ${String(hr + 1).padStart(2, "0")}:00`, dataset), field(`v${hr}`, String(Number(v.toPrecision(6))), "user" as Source)])] });
    const pump = objectOf(schema, "Exterior:FuelEquipment", id, undefined, { fuel_use_type: "Electricity", design_level: wl.pumpW, end_use_subcategory: "Well Pump" });
    setRef(pump, "schedule_name", { system: sched });
    push(pump, "Exterior:FuelEquipment");
  }
  const wellNote = c.wells.map((wl) => `${wl.name}: ${wl.gpdWords} = ${wl.gpd.toFixed(0)} gal/day at ${wl.gpm} gpm → ${wl.runHours.toFixed(2)} h/day at ${wl.pumpW} W = ${((wl.runHours * wl.pumpW) / 1000).toFixed(2)} kWh/day on ${dwP ? dwP.name : "the hot water's shape"}`).join(" · ");
  // two rows (2026-10-05): the heaters under Domestic Hot Water, the well pumps under Domestic Water — the objects split where the wells
  // begin, so the IDF is written in the same order; with no heater the shared fraction limits go with the wells
  const heatNote = `${c.heaters.length} water heater${c.heaters.length === 1 ? "" : "s"}: ${c.heaters.map((h) => `${h.name} (${h.kind === "hpwh" ? "heat pump" : h.kind}) in ${h.room}${zoneOfRoom.get(h.room) && zoneOfRoom.get(h.room) !== h.room ? ` (zone ${zoneOfRoom.get(h.room)})` : ""} · ${h.gpd.toFixed(1)} gal/day`).join(" · ")} — the use ${c.rule.words} (${c.rule.cite}) on ${DHW_SHAPE_CITE}; the tank at ${DHW_SETPOINT_CITE}; stand-alone tanks on the mains (${mains ? `Correlation on ${mains.words}` : "CorrelationFromWeatherFile"})${hwRuled ? ` — the draw on SCHEDULES › domestic hot water: ${hw!.name}` : ""}`;
  const wellRefused = refused.slice(wellRefusedAt), heatRefused = refused.slice(0, wellRefusedAt);
  const row: ResolvedSystem | null = c.heaters.length ? { id: "DHW", section: "dhw", kind: "WaterHeater:Stratified", label: `${c.heaters.length} water heater${c.heaters.length === 1 ? "" : "s"}`, source: "user", zones: [...new Set(c.heaters.map((h) => zoneOfRoom.get(h.room) ?? h.room))], objects: out.slice(0, wellAt), refused: heatRefused, note: heatNote, setting: heatNote } : null;
  const wellRow: ResolvedSystem | null = c.wells.length ? { id: "DW", section: "water", kind: "Exterior:FuelEquipment", label: `${c.wells.length} well pump${c.wells.length === 1 ? "" : "s"}`, source: "user", zones: [], objects: row ? out.slice(wellAt) : out, refused: row ? wellRefused : refused, note: wellNote, setting: wellNote } : null;
  return { row, wellRow, refused, zones };
}

/** the heat pump into its zone's equipment: appended to the list the zone already has (its sequences after the others'), the zone's
 *  inlet and exhaust widened to NodeLists — or, for a zone with no equipment (unconditioned: a garage, a crawl), a list and connections
 *  of its own. Returns why it cannot, or null */
function joinZone(sys: ResolvedSystems, out: ResolvedObject[], zone: string, hp: string, nIn: string, nOut: string): string | null {
  const all = sys.list.flatMap((s) => s.objects);
  const zoneOf = (o: ResolvedObject): string | undefined => { const f = o.fields.find((x) => x.key === "zone_name"); return f?.ref?.zone ?? (f?.value || undefined); };
  const conn = all.find((o) => o.cls === "ZoneHVAC:EquipmentConnections" && zoneOf(o) === zone);
  const zn = sanitizeIdfName(zone);
  if (!conn) {
    const list = `${zn} DHW equipment`;
    out.push(rawObject("ZoneHVAC:EquipmentList", list, [["name", list, code], ["load_distribution_scheme", "SequentialLoad", dataset],
      ["zone_equipment_object_type", "WaterHeater:HeatPump:WrappedCondenser", dataset], ["zone_equipment_name", "", code, { system: hp }],
      ["zone_equipment_cooling_sequence", "1", dataset], ["zone_equipment_heating_or_no_load_sequence", "1", dataset]]));
    out.push(rawObject("ZoneHVAC:EquipmentConnections", `${zn} DHW connections`, [["zone_name", "", code, { zone }], ["zone_conditioning_equipment_list_name", "", code, { system: list }],
      ["zone_air_inlet_node_or_nodelist_name", nOut, code], ["zone_air_exhaust_node_or_nodelist_name", nIn, code], ["zone_air_node_name", `${zn} DHW Zone Air Node`, code]]));
    return null;
  }
  const listField = conn.fields.find((x) => x.key === "zone_conditioning_equipment_list_name");
  const listName = listField?.ref?.system ?? listField?.value ?? "";
  const list = all.find((o) => o.cls === "ZoneHVAC:EquipmentList" && o.name === listName);
  if (!list) return `${zone}'s equipment list (${listName}) is not found — the heat pump cannot join it`;
  // the list: the heat pump FIRST in both sequences — the engine's own rule ("Heat pump water heaters should be simulated first, before
  // other space conditioning equipment … Poor temperature control may result if the Heating/Cooling sequence number is not 1", its
  // warning, measured 2026-10-02; the example's list does so) — every other unit one later; its last entry's fraction fields padded
  const n = Math.floor((list.fields.length - 2 + 5) / 6);
  for (let i = 0; i < n; i++) for (const k of [4, 5]) { const f = list.fields[2 + i * 6 + k - 2]; if (f && /^\d+$/.test(f.value)) f.value = String(Number(f.value) + 1); }
  while ((list.fields.length - 2) % 6 !== 0) list.fields.push(field(`pad_${list.fields.length}`, "", code));
  list.fields.push(field(`zone_equipment_object_type_${n + 1}`, "WaterHeater:HeatPump:WrappedCondenser", dataset), field(`zone_equipment_name_${n + 1}`, "", code, { system: hp }),
    field(`zone_equipment_cooling_sequence_${n + 1}`, "1", dataset), field(`zone_equipment_heating_or_no_load_sequence_${n + 1}`, "1", dataset));
  // the zone's inlet and exhaust: a NodeList holding the zone's own and the heat pump's
  const widen = (key: string, node: string, word: string): void => {
    const f = conn.fields.find((x) => x.key === key);
    if (!f) return;
    if (!f.value && !f.ref?.system) { f.value = node; return; }
    // already a NodeList (a stand-alone ERV's, 2026-10-07): the heat pump's node joins it — a NodeList holds nodes, never lists
    const held = f.ref?.system ? [...all, ...out].find((o) => o.cls === "NodeList" && o.name === f.ref!.system) : undefined;
    if (held) { held.fields.push(field(`node_${held.fields.length}_name`, node, code)); return; }
    const nl = `${zn} ${word} nodes`;
    out.push(rawObject("NodeList", nl, [["name", nl, code], ["node_1_name", f.value, code], ["node_2_name", node, code]]));
    f.value = ""; f.ref = { system: nl };
  };
  widen("zone_air_inlet_node_or_nodelist_name", nOut, "inlet");
  widen("zone_air_exhaust_node_or_nodelist_name", nIn, "exhaust");
  return null;
}
