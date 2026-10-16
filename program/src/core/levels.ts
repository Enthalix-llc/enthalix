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

/** A SPACE ON THE ROOF (user, 2026-10-16: "There shouldn't be a Roof room, just a roof over the 2nd level"): an IfcSpace whose floor
 *  stands at or above the top of a roof that lies under it is outside the envelope — the roof is the building's top, and the space
 *  over it (a roof area drawn as a space) is no room. Read from the geometry: the space's lowest point against each roof element's
 *  highest point, where their plans overlap. Returns the spaces' express ids, with the roof each stands on. */
export function spacesOnRoof(
  spaces: Array<{ expressId: number; faces: Array<{ outer: Array<[number, number, number]> }> }>,
  roofs: Array<{ expressId: number; faces: Array<{ outer: Array<[number, number, number]> }> }>,
  tolM = 0.05,
): Map<number, number> {
  type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  const box = (fs: Array<{ outer: Array<[number, number, number]> }>): Box | null => {
    const pts = fs.flatMap((f) => f.outer);
    if (!pts.length) return null;
    // the geometry is Y-UP (the viewer's frame): x and z are the plan, y the height — z0/z1 here hold the height, y0/y1 the plan's z
    const xs = pts.map((p) => p[0]), hs = pts.map((p) => p[1]), ps = pts.map((p) => p[2]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ps), y1: Math.max(...ps), z0: Math.min(...hs), z1: Math.max(...hs) };
  };
  const rb = roofs.map((r) => ({ id: r.expressId, b: box(r.faces) })).filter((r): r is { id: number; b: Box } => r.b !== null);
  const out = new Map<number, number>();
  for (const sp of spaces) {
    const s = box(sp.faces);
    if (!s) continue;
    // the plans overlap by more than a sliver, and the space's floor is at or above the roof's top — or, for a FLAT roof (under a metre
    // from its lowest to its highest point), at or above its underside: a space drawn from the roof's level, through its thickness.
    // A pitched roof is held to its top, so an attic under it stays a room
    const under = rb.find(({ b }) => Math.min(s.x1, b.x1) - Math.max(s.x0, b.x0) > 0.3 && Math.min(s.y1, b.y1) - Math.max(s.y0, b.y0) > 0.3
      && (s.z0 >= b.z1 - tolM || (b.z1 - b.z0 < 1 && s.z0 >= b.z0 - tolM)));
    if (under) out.set(sp.expressId, under.id);
  }
  return out;
}
