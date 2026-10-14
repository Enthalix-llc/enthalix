// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE GROUND LOOP'S FLUID (user, 2026-10-08: "20% Propylene Glycol used for ground loop systems. The … GroundHeatExchanger:System card
// needs to show liquid used and any antifreeze added … give the user feedback on freeze protection used (type, percentage represents
// protection down to what temperature, and derated capacity % - this results in more flow required)"). Typed on the ground heat
// exchanger's card; the loop it sits on is written with the engine's own glycol (FluidProperties:GlycolConcentration, the loop's Fluid
// Type UserDefinedFluidType). The engine's heat pump coils have no glycol input — their curves read the entering water temperature and the
// flow; the glycol reaches the model through its properties in the loop and the borefield (its specific heat, density, viscosity, conductivity).
//
// Freezing points: Dow's own tables — DOWFROST™ Heat Transfer Fluid (propylene glycol), Form No. 180-01314-1019, "Typical Freezing and
// Boiling Points"; DOWTHERM™ SR-1 (ethylene glycol), Form No. 180-01485-01 — by WEIGHT % with the matching VOLUME %. Dow's note: "for an
// extended margin of protection, you should select a temperature in this table that is at least 3°C (5°F) lower than the expected lowest
// ambient temperature". The EnergyPlus documentation does not say whether its concentration is by weight or by volume; the weight fraction
// is written (the basis of the property tables).

// GENERATED 2026-10-08 from EnergyPlus 26.1 DataSets/GlycolPropertiesRefData.idf — the engine's BUILT-IN glycol properties (its own
// header: "All of these glycols are 'built in' properties to EnergyPlus"), at -10 … 20 °C by 5 K; 0 = no data (below the table's range)
export const GLYCOL_TEMPS_C = [-10, -5, 0, 5, 10, 15, 20] as const;
export const GLYCOL_PROPS: Record<"PropyleneGlycol" | "EthyleneGlycol", Record<"cp" | "rho" | "mu" | "k", Record<string, number[]>>> = {
  PropyleneGlycol: {
    cp: { "0.0": [0, 0, 4218, 4204, 4194, 4187, 4183], "0.1": [0, 0, 4042, 4050, 4058, 4067, 4075], "0.2": [0, 3918, 3929, 3940, 3951, 3962, 3973], "0.3": [3765, 3779, 3793, 3807, 3820, 3834, 3848], "0.4": [3603, 3619, 3636, 3652, 3669, 3685, 3702], "0.5": [3416, 3435, 3455, 3474, 3493, 3513, 3532], "0.6": [3206, 3228, 3250, 3272, 3295, 3317, 3339] },
    rho: { "0.0": [0, 0, 1000, 1000, 999.8, 999.2, 998.3], "0.1": [0, 0, 1014, 1013, 1011, 1010, 1008], "0.2": [0, 1027, 1026, 1024, 1023, 1021, 1019], "0.3": [1039, 1038, 1036, 1034, 1033, 1030, 1028], "0.4": [1049, 1047, 1045, 1043, 1041, 1039, 1036], "0.5": [1057, 1055, 1053, 1050, 1048, 1046, 1043], "0.6": [1064, 1061, 1059, 1056, 1054, 1051, 1048] },
    mu: { "0.0": [0, 0, 0.001791, 0.001518, 0.001306, 0.001137, 0.001001], "0.1": [0, 0, 0.00268, 0.00223, 0.00189, 0.00163, 0.00142], "0.2": [0, 0.00498, 0.00405, 0.00334, 0.00279, 0.00236, 0.00202], "0.3": [0.01187, 0.00908, 0.00708, 0.00561, 0.00452, 0.00369, 0.00306], "0.4": [0.02327, 0.01675, 0.01237, 0.00935, 0.00722, 0.00569, 0.00457], "0.5": [0.03478, 0.02499, 0.0184, 0.01385, 0.01065, 0.00834, 0.00665], "0.6": [0.06278, 0.04384, 0.03132, 0.02287, 0.01705, 0.01296, 0.01004] },
    k: { "0.0": [0, 0, 0.5612, 0.5707, 0.5802, 0.5895, 0.5986], "0.1": [0, 0, 0.51, 0.518, 0.527, 0.535, 0.543], "0.2": [0, 0.456, 0.464, 0.472, 0.479, 0.485, 0.492], "0.3": [0.41, 0.416, 0.423, 0.429, 0.434, 0.44, 0.445], "0.4": [0.375, 0.38, 0.385, 0.389, 0.394, 0.398, 0.402], "0.5": [0.342, 0.346, 0.349, 0.353, 0.356, 0.359, 0.362], "0.6": [0.312, 0.314, 0.317, 0.319, 0.321, 0.323, 0.325] },
  },
  EthyleneGlycol: {
    cp: { "0.0": [0, 0, 4218, 4204, 4194, 4187, 4183], "0.1": [0, 0, 3937, 3946, 3954, 3963, 3972], "0.2": [0, 3757, 3769, 3780, 3792, 3803, 3815], "0.3": [3560, 3574, 3589, 3603, 3617, 3631, 3645], "0.4": [3367, 3384, 3401, 3418, 3435, 3451, 3468], "0.5": [3165, 3184, 3203, 3223, 3242, 3261, 3281], "0.6": [2953, 2975, 2997, 3018, 3040, 3062, 3084] },
    rho: { "0.0": [0, 0, 1000, 1000, 999.8, 999.2, 998.3], "0.1": [0, 0, 1019, 1018, 1016, 1015, 1013], "0.2": [0, 1037, 1036, 1034, 1033, 1031, 1030], "0.3": [1054, 1053, 1052, 1050, 1049, 1047, 1045], "0.4": [1070, 1068, 1067, 1065, 1063, 1062, 1060], "0.5": [1084, 1083, 1081, 1079, 1077, 1075, 1073], "0.6": [1098, 1096, 1095, 1093, 1091, 1089, 1086] },
    mu: { "0.0": [0, 0, 0.001791, 0.001518, 0.001306, 0.001137, 0.001001], "0.1": [0, 0, 0.00208, 0.00179, 0.00156, 0.00137, 0.00121], "0.2": [0, 0.00365, 0.00302, 0.00254, 0.00218, 0.00189, 0.00165], "0.3": [0.00619, 0.00503, 0.00415, 0.00348, 0.00295, 0.00253, 0.0022], "0.4": [0.00906, 0.00718, 0.00583, 0.00482, 0.00404, 0.00344, 0.00296], "0.5": [0.01274, 0.01005, 0.00809, 0.00663, 0.0055, 0.00463, 0.00394], "0.6": [0.01962, 0.01525, 0.01205, 0.00966, 0.00785, 0.00646, 0.00538] },
    k: { "0.0": [0, 0, 0.5612, 0.5707, 0.5802, 0.5895, 0.5986], "0.1": [0, 0, 0.511, 0.52, 0.528, 0.537, 0.545], "0.2": [0, 0.46, 0.468, 0.476, 0.483, 0.49, 0.497], "0.3": [0.415, 0.422, 0.429, 0.436, 0.442, 0.448, 0.453], "0.4": [0.383, 0.389, 0.395, 0.4, 0.405, 0.41, 0.415], "0.5": [0.354, 0.359, 0.364, 0.368, 0.373, 0.377, 0.38], "0.6": [0.329, 0.333, 0.336, 0.34, 0.343, 0.346, 0.349] },
  },
};

export type Glycol = "PropyleneGlycol" | "EthyleneGlycol";
export const GLYCOL_WORDS: Record<Glycol, string> = { PropyleneGlycol: "propylene glycol", EthyleneGlycol: "ethylene glycol" };

/** [weight %, volume %, freezing point °C] — Dow's rows as printed */
export const FREEZE_TABLE: Record<Glycol, { source: string; rows: Array<[number, number, number]> }> = {
  PropyleneGlycol: { source: "Dow, DOWFROST™ Heat Transfer Fluid, Form No. 180-01314-1019 (Typical Freezing and Boiling Points)", rows: [
    [0, 0, 0], [5, 4.8, -1.6], [10, 9.6, -3.3], [15, 14.5, -5.1], [20, 19.4, -7.1], [25, 24.4, -9.6], [30, 29.4, -12.7], [35, 34.4, -16.4],
    [40, 39.6, -21.1], [45, 44.7, -26.7], [50, 49.9, -33.5], [55, 55.0, -41.6], [60, 60.0, -51.1]] },
  EthyleneGlycol: { source: "Dow, DOWTHERM™ SR-1 and DOWTHERM™ 4000, Form No. 180-01485-01 (Typical Freezing and Boiling Points)", rows: [
    [0, 0, 0], [5, 4.4, -1.4], [10, 8.9, -3.2], [15, 13.6, -5.4], [20, 18.1, -7.8], [25, 22.9, -10.7], [30, 27.7, -14.1], [35, 32.6, -17.9],
    [40, 37.5, -22.3], [45, 42.5, -27.5], [50, 47.6, -33.8], [60, 57.8, -48.3]] },
};
/** Dow's stated margin: a freezing point at least 3 °C below the lowest temperature expected */
export const DOW_MARGIN_K = 3;

/** the ground heat exchanger card's fields (saved with the SYSTEMS sheet) */
export const FLUID_FIELD = { antifreeze: "loop_antifreeze", pct: "loop_antifreeze_pct", basis: "loop_antifreeze_basis" } as const;
export type FluidBasis = "volume" | "weight";

const lerp = (x: number, xs: number[], ys: number[]): number => {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]!) { const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!); return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!); }
  return ys[ys.length - 1]!;
};

/** the loop's fluid a card states; null = water */
export interface LoopFluid { glycol: Glycol; pct: number; basis: FluidBasis; weightPct: number; volumePct: number; freezeC: number; beyond: boolean }
export function loopFluidOf(fields: Record<string, unknown> | undefined): LoopFluid | null {
  const f = fields ?? {};
  const g = f[FLUID_FIELD.antifreeze];
  if (g !== "PropyleneGlycol" && g !== "EthyleneGlycol") return null;
  const pct = typeof f[FLUID_FIELD.pct] === "number" ? (f[FLUID_FIELD.pct] as number) : NaN;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const basis: FluidBasis = f[FLUID_FIELD.basis] === "weight" ? "weight" : "volume";
  const rows = FREEZE_TABLE[g].rows, wt = rows.map((r) => r[0]), vol = rows.map((r) => r[1]), fz = rows.map((r) => r[2]);
  const weightPct = basis === "weight" ? pct : lerp(pct, vol, wt), volumePct = basis === "volume" ? pct : lerp(pct, wt, vol);
  return { glycol: g, pct, basis, weightPct, volumePct, freezeC: lerp(weightPct, wt, fz), beyond: weightPct > wt[wt.length - 1]! };
}

/** a property of the engine's built-in table at a weight fraction and a temperature (linear in both); null below the table's range */
export function glycolProp(g: Glycol, prop: "cp" | "rho" | "mu" | "k", weightFrac: number, tC: number): number | null {
  const concs = Object.keys(GLYCOL_PROPS[g][prop]).map(Number).sort((a, b) => a - b);
  const at = (c: number): number | null => {
    const row = GLYCOL_PROPS[g][prop][c.toFixed(1)]!, ts = [...GLYCOL_TEMPS_C] as number[];
    const ok = ts.map((t, i) => [t, row[i]!] as const).filter(([, v]) => v > 0);
    if (!ok.length || tC < ok[0]![0]) return null;
    return lerp(tC, ok.map((x) => x[0]), ok.map((x) => x[1]));
  };
  const c = Math.min(Math.max(weightFrac, 0), concs[concs.length - 1]!);
  const hi = concs.find((x) => x >= c - 1e-9) ?? concs[concs.length - 1]!, lo = [...concs].reverse().find((x) => x <= c + 1e-9) ?? concs[0]!;
  const a = at(lo), b = at(hi);
  if (a === null || b === null) return null;
  return hi === lo ? a : a + ((c - lo) / (hi - lo)) * (b - a);
}

/** THE DERATE the user asked for: the mixture beside water at one loop temperature — the heat a litre carries per kelvin (ρ·cp), the
 *  extra flow for the same heat at the same ΔT, the viscosity (the pump's work, the pipe's film) */
export interface FluidDerate { tC: number; heatPerVolume: number; extraFlowPct: number; heatPerMass: number; viscosityX: number; conductivity: number }
export function fluidDerate(fl: LoopFluid, tC: number): FluidDerate | null {
  const w = fl.weightPct / 100;
  const cp = glycolProp(fl.glycol, "cp", w, tC), rho = glycolProp(fl.glycol, "rho", w, tC), mu = glycolProp(fl.glycol, "mu", w, tC), k = glycolProp(fl.glycol, "k", w, tC);
  // water at the same temperature; at or below 0 °C the table has no water row — water's 0 °C row is the reference
  const tw = Math.max(tC, 0);
  const cpW = glycolProp(fl.glycol, "cp", 0, tw), rhoW = glycolProp(fl.glycol, "rho", 0, tw), muW = glycolProp(fl.glycol, "mu", 0, tw), kW = glycolProp(fl.glycol, "k", 0, tw);
  if (cp === null || rho === null || mu === null || k === null || cpW === null || rhoW === null || muW === null || kW === null) return null;
  const hv = (rho * cp) / (rhoW * cpW);
  return { tC, heatPerVolume: hv, extraFlowPct: (1 / hv - 1) * 100, heatPerMass: cp / cpW, viscosityX: mu / muW, conductivity: k / kW };
}

// ── THE LOOP ΔT FOR FLOW SIZING (user, 2026-10-08: "Show on pump card the loop dT … for flow sizing. Let's show Energyplus basic as
//    dropdown option (10F), but show WaterFurnace Closed loop (8F) which we will use, and add option for custom"). Typed on the loop's
//    pump card. MEASURED 2026-10-08 on the user's model: the plant sizing ΔT alone moves no flow — the variable-speed coils size their
//    water from the example's per-speed reference flow (0.000381695 m³/s at every speed, whatever the capacity), the engine only
//    re-reports the loop's "design capacity" from it. So the ΔT is written into each speed's reference water flow: the heat the coil
//    moves through the loop at that speed (heating: capacity × (1 − 1/COP) drawn from the loop; cooling: capacity × (1 + 1/COP) rejected
//    to it) ÷ (ρ·cp of the loop's fluid × ΔT) — the engine's autosizing then scales it with the coil's capacity — and into Sizing:Plant.

export const LOOP_DT_FIELD = { source: "loop_dt_source", k: "loop_dt_k" } as const;
export type LoopDtSource = "energyplus" | "waterfurnace" | "custom";
export const LOOP_DT_OPTIONS: Array<{ id: LoopDtSource; k: number | null; label: string; words: string }> = [
  { id: "energyplus", k: 5.6, label: "EnergyPlus basic — 10 °F (5.6 °C)", words: "the Sizing:Plant loop design temperature difference the program has written since the loops were built (5.6 °C ≈ 10 °F, the engine's ground-loop examples)" },
  { id: "waterfurnace", k: 8 * 5 / 9, label: "WaterFurnace closed loop — 8 °F (4.4 °C)", words: "WaterFurnace's closed-loop ΔT" },
  { id: "custom", k: null, label: "custom", words: "typed on the card" },
];
/** the fluid's properties are read at this loop temperature for the sizing — the middle of the loop's year (its mean measured 12.6 °C on the house loop, 2026-10-08) */
export const SIZING_FLUID_C = 10;

/** the ΔT a pump card states; the EnergyPlus basic until typed */
export function loopDtOf(fields: Record<string, unknown> | undefined): { source: LoopDtSource; k: number; ruled: boolean } {
  const f = fields ?? {};
  const s = f[LOOP_DT_FIELD.source];
  if (s === "waterfurnace") return { source: s, k: LOOP_DT_OPTIONS[1]!.k!, ruled: true };
  if (s === "custom" && typeof f[LOOP_DT_FIELD.k] === "number" && (f[LOOP_DT_FIELD.k] as number) > 0) return { source: s, k: f[LOOP_DT_FIELD.k] as number, ruled: true };
  if (s === "energyplus") return { source: s, k: LOOP_DT_OPTIONS[0]!.k!, ruled: true };
  return { source: "energyplus", k: LOOP_DT_OPTIONS[0]!.k!, ruled: false };
}

/** ρ·cp (J/m³·K) of the loop's fluid at a temperature — water when no antifreeze — from the engine's built-in table */
export function rhoCpOf(fl: LoopFluid | null, tC = SIZING_FLUID_C): number {
  const g: Glycol = fl?.glycol ?? "PropyleneGlycol", w = fl ? fl.weightPct / 100 : 0;
  return (glycolProp(g, "rho", w, tC) ?? 1000) * (glycolProp(g, "cp", w, tC) ?? 4190);
}

/** a variable-speed coil's speed data with every speed's reference water flow set by the ΔT: the loop heat at that speed ÷ (ρ·cp·ΔT) */
export function vsWaterAtDt(set: Record<string, string>, mode: "heating" | "cooling", dtK: number, rhoCp: number): Record<string, string> {
  const out = { ...set };
  const n = Number(set.number_of_speeds ?? 0);
  for (let i = 1; i <= n; i++) {
    const cap = Number(set[`speed_${i}_reference_unit_gross_rated_${mode === "heating" ? "heating_capacity" : "total_cooling_capacity"}`]);
    const cop = Number(set[`speed_${i}_reference_unit_gross_rated_${mode}_cop`]);
    if (!(cap > 0) || !(cop > 0)) continue;
    const q = mode === "heating" ? cap * (1 - 1 / cop) : cap * (1 + 1 / cop);
    out[`speed_${i}_reference_unit_rated_water_flow_rate`] = (q / (rhoCp * dtK)).toPrecision(6);
  }
  return out;
}
