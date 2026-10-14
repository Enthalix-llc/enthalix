// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT A TREE LETS THROUGH, by month (user, 2026-09-05: "model deciduous
// trees such that they lose opacity depending on time of year — use
// EnergyPlus guidelines"). EnergyPlus models a tree as a shading surface with
// a TRANSMITTANCE SCHEDULE (Shading:Site:Detailed, field 2): 0 opaque, 1
// clear. Its own example SolarShadingTest.idf holds two trees at 0.2 all year
// and calls that "non-seasonal"; its Input/Output Reference says the schedule
// "can be used to allow for seasonal transmittance change, such as for
// deciduous trees that have a higher transmittance in winter than in summer"
// and states no number for winter. So:
//   leaf-on   0.2  — the engine's example (dataset)
//   leaf-off  0.8  — a stated default: a bare canopy passes most of the beam
//   April and October are the transitions in climate zone 4 (leaf-out, leaf-fall)
// Whether a tree is deciduous is READ from the site file's own name
// ("RPC Tree - Deciduous:Scarlet Oak"); anything else is held at the example's
// 0.2. The same twelve numbers will be the IDF's Schedule:Compact when the
// site elements are emitted as shading surfaces.

export const LEAF_ON_TRANSMITTANCE = 0.2;      // dataset: EnergyPlus SolarShadingTest.idf, ShadingTransmittance:0002
export const LEAF_OFF_TRANSMITTANCE = 0.8;     // code default, stated
export const TRANSITION_TRANSMITTANCE = 0.5;   // code default, stated

/** Jan..Dec */
export const DECIDUOUS_TRANSMITTANCE: number[] = [
  LEAF_OFF_TRANSMITTANCE, LEAF_OFF_TRANSMITTANCE, LEAF_OFF_TRANSMITTANCE,
  TRANSITION_TRANSMITTANCE,
  LEAF_ON_TRANSMITTANCE, LEAF_ON_TRANSMITTANCE, LEAF_ON_TRANSMITTANCE, LEAF_ON_TRANSMITTANCE, LEAF_ON_TRANSMITTANCE,
  TRANSITION_TRANSMITTANCE,
  LEAF_OFF_TRANSMITTANCE, LEAF_OFF_TRANSMITTANCE,
];

export const isTree = (name: string): boolean => /tree|oak|maple|pine|shrub|plant/i.test(name);
export const isDeciduous = (name: string): boolean => /deciduous/i.test(name);

/** the transmittance of a site element in a month: a deciduous tree by the
 *  schedule, any other tree at the example's constant, anything else opaque */
export function treeTransmittance(month: number, name = "Deciduous"): number {
  if (!isTree(name)) return 0;
  return isDeciduous(name) ? DECIDUOUS_TRANSMITTANCE[month - 1] ?? LEAF_ON_TRANSMITTANCE : LEAF_ON_TRANSMITTANCE;
}

export function formatShadingSchedule(): string {
  return DECIDUOUS_TRANSMITTANCE.map((t, i) => `${["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]} ${t.toFixed(1)}`).join(" ");
}
