// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// AN ESTIMATED GROUND TEMPERATURE (user, 2026-09-15, S5): "employ the spreadsheet's logic to derive an estimated ground
// temperature at the depths it offers (3', 10' and 30'), and flag it for later investigation." The spreadsheet is
// GroundTempResIP-SI14.xlsm (geokiss.com, free design software; not included here), sheet AnnualGroundTemperatures: its
// monthly values are the VBA function SoilTemp(Tavg, Tamp, DayToMin, Depth, Day, ThermDiff), fitted here against the
// sheet's own 39 stored values to 0.000 °F — it is the Kusuda–Achenbach undisturbed-ground equation with π written
// as 3.1416 (Math.PI misses by 2e-4 °F; the gate holds the sheet's numbers):
//
//   T(z, t) = Tavg − Tamp · exp(−z · √(π / (365 α))) · cos( 2π/365 · ( t − t0 − (z / 2) · √(365 / (π α)) ) )
//
// with z the depth, t the day of the year, t0 the day of the minimum surface temperature (the sheet's DayToMin, 15),
// α the soil's thermal diffusivity per DAY (the sheet: 24 · k / (ρ · cp) with k 1.45 Btu/h·ft·°F, ρ 100 lb/ft³,
// cp 0.215 Btu/lb·°F = 1.6186 ft²/day). The sheet's month M is the value at the LAST day of M (31, 59, 90 … 365).
// z / √α is unit-free, so the arithmetic here runs in SI on the sheet's constants converted exactly.
//
// WHAT IS READ AND WHAT IS STATED: Tavg and Tamp come from the WEATHER FILE's own 8,760 dry-bulb rows — the annual mean,
// and half the swing between the warmest and the coldest monthly mean (the sheet's MaxAirTemp / MinAirTemp are typed
// by hand; this is the file's word for them) — while the soil (α) and the phase (15 days) are the sheet's stated
// defaults. Two things are OPEN and flagged on the screen: the sheet's Max/Min are not defined in it, and the engine's
// own IDD cautions that an undisturbed ground temperature is too extreme under a conditioned building
// (Site:GroundTemperature:BuildingSurface's memo) — so this is an ESTIMATE for the user to compare, under investigation,
// and the borefield's Site:GroundTemperature:Undisturbed:KusudaAchenbach takes the same three parameters.

export const GEOKISS = {
  source: "GroundTempResIP-SI14.xlsm (geokiss.com free design software), sheet AnnualGroundTemperatures — SoilTemp() = Kusuda–Achenbach with π 3.1416",
  file: "GroundTempResIP-SI14.xlsm (geokiss.com, free design software — not included with BIM-BEM-BOM)",
  /** the sheet's soil: k 1.45 Btu/h·ft·°F · ρ 100 lb/ft³ · cp 0.215 Btu/lb·°F → α = 24 k / (ρ cp) ft²/day */
  soil: { kBtuHFtF: 1.45, rhoLbFt3: 100, cpBtuLbF: 0.215 },
  alphaFt2Day: 24 * 1.45 / (100 * 0.215),
  /** the sheet's DayToMin: the day of the year the surface is coldest */
  dayToMin: 15,
  /** the depths the sheet offers, feet */
  depthsFt: [3, 10, 30] as const,
  /** the sheet's own π */
  pi: 3.1416,
  /** the sheet's sample day per month: the cumulative day at the END of the month */
  monthEndDay: [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365] as const,
} as const;

const FT2_TO_M2 = 0.09290304, FT_TO_M = 0.3048;
export const GEOKISS_ALPHA_M2_DAY = GEOKISS.alphaFt2Day * FT2_TO_M2;

/** the sheet's SoilTemp: the temperature at depth z (m) on day t, from the annual mean and amplitude (°C, or any linear unit), the phase (days) and α (m²/day) */
export function soilTemp(tavg: number, tamp: number, dayToMin: number, depthM: number, day: number, alphaM2Day: number, pi = GEOKISS.pi): number {
  const z = depthM, a = alphaM2Day;
  return tavg - tamp * Math.exp(-z * Math.sqrt(pi / (a * 365))) * Math.cos((2 * pi / 365) * (day - dayToMin - (z / 2) * Math.sqrt(365 / (pi * a))));
}

export interface GroundEstimateInputs {
  /** the annual mean air temperature, °C — read from the weather file's rows */
  tavgC: number;
  /** half the swing between the warmest and the coldest monthly mean, °C — read from the rows */
  tampC: number;
  /** the day the surface is coldest — the sheet's 15 unless typed */
  dayToMin?: number;
  /** the soil's diffusivity, m²/day — the sheet's unless typed */
  alphaM2Day?: number;
}

/** the twelve monthly ground temperatures at a depth, by the sheet's logic (month M at its last day) */
export function estimateGroundTemps(inp: GroundEstimateInputs, depthM: number): number[] {
  const t0 = inp.dayToMin ?? GEOKISS.dayToMin, a = inp.alphaM2Day ?? GEOKISS_ALPHA_M2_DAY;
  return GEOKISS.monthEndDay.map((d) => soilTemp(inp.tavgC, inp.tampC, t0, depthM, d, a));
}

/** the sheet's inputs read from a weather file's monthly mean dry-bulbs (°C): the annual mean and half the swing; null without rows */
export function groundInputsFromAir(monthlyMeanC: number[] | null | undefined, annualMeanC: number | null | undefined): GroundEstimateInputs | null {
  if (!monthlyMeanC || monthlyMeanC.length !== 12 || !monthlyMeanC.every((v) => Number.isFinite(v))) return null;
  const tavg = annualMeanC ?? monthlyMeanC.reduce((t, v) => t + v, 0) / 12;
  return { tavgC: tavg, tampC: (Math.max(...monthlyMeanC) - Math.min(...monthlyMeanC)) / 2 };
}

export const ftToM = (ft: number): number => ft * FT_TO_M;
