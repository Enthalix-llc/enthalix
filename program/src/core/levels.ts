// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT A LEVEL IS, AND THE PROJECT'S ELEVATION (the user's rules, 2026-09-07):
// "elevation is set by the lowest occupied space (elevators are not occupied
// space)", and "the weather file's general data might be 0 elevation, so it
// should be identified as the PROJECT elevation". This house's IfcSite states
// RefElevation 0 and Pset_SiteCommon carries only a Reference, while its
// storeys carry absolute elevations in feet (Basement 30′). So the project's
// elevation is READ from the lowest storey that aggregates an occupied room;
// the IfcSite's own number is printed beside it, never silently replaced.
// The file states no occupancy on any space (Pset_SpaceCommon carries
// IsExternal and Reference only), so a shaft is read from its own name and
// named wherever it is excluded.

/** not occupied space: an elevator, a lift, a shaft — by the room's own name */
export const isShaft = (name: string): boolean => /^(elevator|lift|shaft)\b/i.test(name);

export interface ProjectElevation {
  elevM: number;
  /** where the number came from: the lowest occupied level, else the IfcSite */
  from: string;
  level: string | null;
  /** IfcSite.RefElevation as stated (metres), for the record */
  siteRefM: number | null;
}

export function projectElevation(run: {
  site: { elevationM: number } | null;
  spaces: Array<{ storey: string | null; storeyElevM: number | null; name: string | null; longName: string | null }>;
}): ProjectElevation {
  const siteRefM = run.site ? run.site.elevationM : null;
  let best: { name: string; elevM: number } | null = null;
  for (const sp of run.spaces) {
    const nm = sp.longName ?? sp.name ?? "";
    if (isShaft(nm) || sp.storey === null || sp.storeyElevM === null) continue;
    if (!best || sp.storeyElevM < best.elevM) best = { name: sp.storey, elevM: sp.storeyElevM };
  }
  if (best) return { elevM: best.elevM, from: `the lowest occupied level, ${best.name}`, level: best.name, siteRefM };
  if (siteRefM !== null) return { elevM: siteRefM, from: "IfcSite.RefElevation", level: null, siteRefM };
  return { elevM: 0, from: "not stated", level: null, siteRefM };
}
