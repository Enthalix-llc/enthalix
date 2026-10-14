// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE AIRTIGHT ASSESSMENT, per zone. EnergyPlus computes a zone's volume and
// air balance from its surfaces and warns when they do not enclose it. A zone
// is enclosed when every edge of every one of its surfaces is shared with
// exactly one other surface of the SAME zone — an inter-zone surface counts
// in both. Measured on the rows read back from idf.db, never on memory.
// Nothing here repairs anything: it counts, names, and classifies.

type V3 = [number, number, number];

export interface ZoneFaceIn {
  elementId: number;
  category: string;
  n: V3;
  outer: V3[];
  holes: V3[][];
  areaM2: number;
  grossAreaM2?: number;
  thicknessM?: number;
  /** the room behind the surface (−n side) and the one it faces (+n) */
  space: string | null;
  spaceFacing: string | null;
}

/** an open edge either has a parallel partner edge of the same zone within
 *  reach — a GAP, whose width names the cause (half a partition, a wall
 *  thickness, a floor structure) — or has none: a surface is MISSING */
export type OpenKind = "gap" | "missing" | "hairline";

export interface ZoneOpenEdge {
  lenM: number;
  elementId: number;
  category: string;
  a: V3;
  b: V3;
  kind: OpenKind;
  /** for a gap: the distance to the partner edge and the element it belongs to */
  gapM?: number;
  partnerId?: number;
}

export interface ZoneReport {
  name: string;
  surfaces: number;
  interZone: number;
  floors: number;
  /** ceilings that are a sloped or flat ROOF — a cathedral room's ceiling is its roof */
  ceilRoof: number;
  /** ceilings that are the floor structure of the storey above */
  ceilFloor: number;
  /** net area, and the outer rings' gross area with openings counted in */
  areaM2: number;
  grossAreaM2: number;
  openingAreaM2: number;
  edgeLenM: number;
  closedLenM: number;
  openLenM: number;
  degenerateLenM: number;
  openByKind: Record<OpenKind, number>;
  open: ZoneOpenEdge[];
  holes: number;
  maxVerts: number;
  /** enclosed volume from the zone's own surfaces (divergence theorem) */
  volumeM3: number;
  /** the IfcSpace solid's volume, the file's own number */
  spaceVolumeM3: number | null;
  closed: boolean;
}

export interface ZoneAssessment {
  zones: ZoneReport[];
  closedZones: number;
  edgeLenM: number;
  openLenM: number;
  openByKind: Record<OpenKind, number>;
  unclaimedSurfaces: number;
  unclaimedAreaM2: number;
  zonesWithoutFloor: string[];
  zonesWithoutCeiling: string[];
  /** open length by gap width (mm) — the widths ARE the causes */
  gapHistogram: Array<{ gapMm: number; lenM: number }>;
}

const WELD = 1e-4;
const key = (p: V3): string =>
  `${Math.round(p[0] / WELD)}|${Math.round(p[1] / WELD)}|${Math.round(p[2] / WELD)}`;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** unsigned area of a planar ring */
function ringArea(ring: V3[], n: V3): number {
  let s: V3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    const c = cross(a, b);
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  return Math.abs(dot(s, n)) / 2;
}

/** the volume of a closed solid from its outward-facing faces — an IfcSpace,
 *  an attic — by the divergence theorem; the file's own number, not the zone's */
/** the zone rows idf.db stores: every room and every attic, each with the
 *  volume of the solid it came from — ONE function for the gate and the app */
/** THE ZONE LIST, as the user's rulings leave it. A merge (`zones.spaces` / `zones.voids`) relabels the
 *  carved CELLS, and the writer takes its zone names from those cells — so a merged-away zone is never
 *  written. Its VOLUME, though, is the air the merged zone actually holds, and before 2026-09-19 this
 *  list kept each space's own solid: a room with a void ruled into it was written at the room's volume
 *  alone, understating its air by the void's (the Studio Bath's void is 7.98 m³ of its own). The rows
 *  are folded here through the SAME resolver the relabel uses, the volumes summed and the parts named,
 *  exactly as `mergeInputZones` does for the SYSTEMS sheet's Zone cards. */
export function zoneRows(
  spaces: Array<{ expressId: number; name: string | null; longName: string | null; colorIndex: number; storey: string | null; faces: Array<{ n: V3; outer: V3[] }> }>,
  attics: Array<{ name: string; colorIndex: number; room: string; faces: Array<{ n: V3; outer: V3[] }> }>,
  /** the zone rulings' own resolver (`zoneResolver`); absent = no merge */
  resolve?: (name: string) => string,
): Array<{ name: string; kind: "room" | "attic"; colorIndex: number; storey: string | null; volumeM3: number; volumeSource: string }> {
  const rooms = spaces.map((sp) => ({
    name: sp.longName ?? sp.name ?? `#${sp.expressId}`, kind: "room" as const, colorIndex: sp.colorIndex,
    storey: sp.storey, volumeM3: solidVolumeM3(sp.faces), volumeSource: "IfcSpace solid",
  }));
  const storeyOf = new Map(rooms.map((r) => [r.name, r.storey]));
  const all = [
    ...rooms,
    ...attics.map((a) => ({
      name: a.name, kind: "attic" as const, colorIndex: a.colorIndex,
      storey: storeyOf.get(a.room) ?? null, volumeM3: solidVolumeM3(a.faces), volumeSource: "attic solid",
    })),
  ];
  if (!resolve) return all;
  const out: typeof all = [];
  const byName = new Map<string, typeof all[number]>();
  for (const z of all) {
    const to = resolve(z.name);
    if (to === z.name) { const row = { ...z }; byName.set(z.name, row); out.push(row); }
  }
  for (const z of all) {
    const to = resolve(z.name);
    if (to === z.name) continue;
    const host = byName.get(to);
    // a ruling naming a zone that is not in this build is left alone rather than dropped
    if (!host) { out.push({ ...z }); continue; }
    host.volumeM3 += z.volumeM3;
    host.volumeSource = `${host.volumeSource} + ${z.name} (${z.volumeSource})`;
    if (z.kind === "room") host.kind = "room";
  }
  return out;
}

export function solidVolumeM3(faces: Array<{ n: V3; outer: V3[] }>): number {
  let v = 0;
  for (const f of faces) if (f.outer.length >= 3) v += volumeShare(f.n, f.outer, []);
  return Math.abs(v);
}

/** the flux of position through a planar face: n·p is constant on the plane,
 *  so the divergence-theorem volume share is d × area / 3 */
function volumeShare(nOut: V3, outer: V3[], holes: V3[][]): number {
  const d = dot(nOut, outer[0]!);
  let a = ringArea(outer, nOut);
  for (const h of holes) a -= ringArea(h, nOut);
  return (d * a) / 3;
}

export function assessZones(
  faces: ZoneFaceIn[],
  spaces: Array<{ name: string; faces: Array<{ n: V3; outer: V3[] }> }>,
): ZoneAssessment {
  const byZone = new Map<string, ZoneFaceIn[]>();
  for (const f of faces) {
    // both sides in one zone: an internal partition of a merged zone, not
    // part of its boundary
    if (f.space && f.space === f.spaceFacing) continue;
    for (const z of [f.space, f.spaceFacing]) {
      if (!z) continue;
      const a = byZone.get(z);
      if (a) a.push(f); else byZone.set(z, [f]);
    }
  }
  const spaceVol = new Map<string, number>();
  for (const sp of spaces) {
    let v = 0;
    for (const f of sp.faces) if (f.outer.length >= 3) v += volumeShare(f.n, f.outer, []);
    spaceVol.set(sp.name, Math.abs(v));
  }

  const zones: ZoneReport[] = [];
  const openByKindAll: Record<OpenKind, number> = { gap: 0, missing: 0, hairline: 0 };
  let edgeLenAll = 0, openLenAll = 0;
  const names = [...new Set([...spaces.map((s) => s.name), ...byZone.keys()])];
  for (const name of names) {
    const zf = byZone.get(name) ?? [];
    interface Rec { count: number; lenM: number; f: ZoneFaceIn; a: V3; b: V3 }
    const edges = new Map<string, Rec>();
    let holes = 0, maxVerts = 0, area = 0, gross = 0, vol = 0, inter = 0, floors = 0, ceilRoof = 0, ceilFloor = 0;
    for (const f of zf) {
      if (f.space && f.spaceFacing) inter++;
      holes += f.holes.length;
      maxVerts = Math.max(maxVerts, f.outer.length);
      area += f.areaM2;
      gross += f.grossAreaM2 ?? ringArea(f.outer, f.n);
      const nOut: V3 = f.space === name ? f.n : [-f.n[0], -f.n[1], -f.n[2]];
      vol += volumeShare(nOut, f.outer, f.holes);
      if ((f.category === "floor" || f.category === "roof" || f.category === "ceiling") && Math.abs(f.n[1]) > 0.3) {
        if (nOut[1] < 0) floors++;                                     // outward down = a floor
        else if (f.category === "roof") ceilRoof++; else ceilFloor++;  // a ceiling covering counts with the flat ones
      }
      const r = f.outer;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        if (!a || !b) continue;
        const lenM = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (lenM < WELD) continue;
        const ka = key(a), kb = key(b);
        const k = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
        const rec = edges.get(k);
        if (rec) rec.count++; else edges.set(k, { count: 1, lenM, f, a, b });
      }
    }
    let edgeLen = 0, closed = 0, open = 0, degenerate = 0;
    const openEdges: ZoneOpenEdge[] = [];
    const byKind: Record<OpenKind, number> = { gap: 0, missing: 0, hairline: 0 };
    for (const rec of edges.values()) {
      edgeLen += rec.lenM;
      if (rec.count === 2) { closed += rec.lenM; continue; }
      if (rec.count > 2) { degenerate += rec.lenM; continue; }
      open += rec.lenM;
      openEdges.push({ lenM: rec.lenM, elementId: rec.f.elementId, category: rec.f.category, a: rec.a, b: rec.b, kind: "missing" });
    }
    // PARTNERS. Two open edges of one zone, parallel, overlapping along their
    // run and a small distance apart, are the two sides of one gap: a cell
    // cut at the room's own face while its neighbour sits at the kept plane.
    for (const e of openEdges) {
      if (e.lenM < 0.01) { e.kind = "hairline"; continue; }
      const d: V3 = [(e.b[0] - e.a[0]) / e.lenM, (e.b[1] - e.a[1]) / e.lenM, (e.b[2] - e.a[2]) / e.lenM];
      let best: { gap: number; id: number } | null = null;
      for (const o of openEdges) {
        if (o === e || o.lenM < 0.01) continue;
        const d2: V3 = [(o.b[0] - o.a[0]) / o.lenM, (o.b[1] - o.a[1]) / o.lenM, (o.b[2] - o.a[2]) / o.lenM];
        if (Math.abs(dot(d, d2)) < 0.999) continue;
        const w: V3 = [o.a[0] - e.a[0], o.a[1] - e.a[1], o.a[2] - e.a[2]];
        const along = dot(w, d);
        const perp = Math.hypot(w[0] - along * d[0], w[1] - along * d[1], w[2] - along * d[2]);
        if (perp > 0.5 || perp < 1e-3) continue;
        const t0 = along, t1 = along + dot(d2, d) * o.lenM;
        if (Math.min(Math.max(t0, t1), e.lenM) - Math.max(Math.min(t0, t1), 0) <= 0.01) continue;
        if (!best || perp < best.gap) best = { gap: perp, id: o.elementId };
      }
      if (best) { e.kind = "gap"; e.gapM = best.gap; e.partnerId = best.id; }
    }
    for (const e of openEdges) byKind[e.kind] += e.lenM;
    openEdges.sort((x, y) => y.lenM - x.lenM);
    for (const k of Object.keys(byKind) as OpenKind[]) openByKindAll[k] += byKind[k];
    edgeLenAll += edgeLen; openLenAll += open;
    zones.push({
      name, surfaces: zf.length, interZone: inter, floors, ceilRoof, ceilFloor,
      areaM2: area, grossAreaM2: gross, openingAreaM2: Math.max(0, gross - area),
      edgeLenM: edgeLen, closedLenM: closed, openLenM: open, degenerateLenM: degenerate,
      openByKind: byKind, open: openEdges, holes, maxVerts,
      volumeM3: Math.abs(vol), spaceVolumeM3: spaceVol.get(name) ?? null,
      closed: zf.length > 0 && open < WELD && degenerate < WELD,
    });
  }
  zones.sort((a, b) => b.openLenM - a.openLenM);
  const unclaimed = faces.filter((f) => !f.space && !f.spaceFacing);
  return {
    zones, closedZones: zones.filter((z) => z.closed).length,
    edgeLenM: edgeLenAll, openLenM: openLenAll, openByKind: openByKindAll,
    unclaimedSurfaces: unclaimed.length,
    unclaimedAreaM2: unclaimed.reduce((t, f) => t + f.areaM2, 0),
    zonesWithoutFloor: zones.filter((z) => z.floors === 0).map((z) => z.name),
    zonesWithoutCeiling: zones.filter((z) => z.ceilRoof + z.ceilFloor === 0).map((z) => z.name),
    gapHistogram: (() => {
      const h = new Map<number, number>();
      for (const z of zones) for (const e of z.open) if (e.kind === "gap" && e.gapM !== undefined) {
        const mm = Math.round(e.gapM * 1000);
        h.set(mm, (h.get(mm) ?? 0) + e.lenM);
      }
      return [...h].map(([gapMm, lenM]) => ({ gapMm, lenM })).sort((a, b) => b.lenM - a.lenM);
    })(),
  };
}

export function formatZones(a: ZoneAssessment, name: (id: number) => string = () => ""): string[] {
  const pct = (x: number, t: number): string => (t > 0 ? `${((100 * x) / t).toFixed(0)}%` : "—");
  const out = [
    `  ZONE ENCLOSURE (EnergyPlus acceptance) — ${a.zones.length} zones · ${a.closedZones} closed · ` +
      `open ${a.openLenM.toFixed(1)} m of ${a.edgeLenM.toFixed(1)} m (${pct(a.openLenM, a.edgeLenM)}) = ` +
      `gaps between the zone's own cells ${a.openByKind.gap.toFixed(1)} · missing a surface ${a.openByKind.missing.toFixed(1)} · hairline ${a.openByKind.hairline.toFixed(1)}`,
    `    gap widths (the causes): ` + a.gapHistogram.slice(0, 8).map((g) => `${g.gapMm} mm ${g.lenM.toFixed(1)} m`).join(" · "),
    `    unclaimed by any zone: ${a.unclaimedSurfaces} surfaces, ${a.unclaimedAreaM2.toFixed(1)} m² · zones without a floor surface: ${a.zonesWithoutFloor.length}${a.zonesWithoutFloor.length ? ` (${a.zonesWithoutFloor.join(", ")})` : ""} · without a ceiling: ${a.zonesWithoutCeiling.length}${a.zonesWithoutCeiling.length ? ` (${a.zonesWithoutCeiling.join(", ")})` : ""}`,
    `    ${"zone".padEnd(16)} ${"surf".padStart(4)} ${"iz".padStart(3)} ${"flr".padStart(3)} ${"roof".padStart(4)} ${"ceil".padStart(4)} ${"open m²".padStart(7)} ` +
      `${"edges m".padStart(8)} ${"closed".padStart(6)} ${"gap m".padStart(6)} ${"miss m".padStart(6)} ${"deg m".padStart(5)} ` +
      `${"holes".padStart(5)} ${"maxV".padStart(4)} ${"vol m³".padStart(7)} ${"ifc m³".padStart(7)}  verdict`,
  ];
  for (const z of a.zones) {
    const ratio = z.spaceVolumeM3 && z.spaceVolumeM3 > 0 ? z.volumeM3 / z.spaceVolumeM3 : null;
    out.push(
      `    ${z.name.slice(0, 16).padEnd(16)} ${String(z.surfaces).padStart(4)} ${String(z.interZone).padStart(3)} ${String(z.floors).padStart(3)} ${String(z.ceilRoof).padStart(4)} ${String(z.ceilFloor).padStart(4)} ${z.openingAreaM2.toFixed(1).padStart(7)} ` +
      `${z.edgeLenM.toFixed(1).padStart(8)} ${pct(z.closedLenM, z.edgeLenM).padStart(6)} ${z.openByKind.gap.toFixed(1).padStart(6)} ${z.openByKind.missing.toFixed(1).padStart(6)} ${z.degenerateLenM.toFixed(1).padStart(5)} ` +
      `${String(z.holes).padStart(5)} ${String(z.maxVerts).padStart(4)} ${z.volumeM3.toFixed(1).padStart(7)} ${(z.spaceVolumeM3 ?? 0).toFixed(1).padStart(7)}  ` +
      (z.closed ? "CLOSED" : z.surfaces === 0 ? "NO SURFACES" : `open${ratio !== null ? ` · vol ${(100 * ratio).toFixed(0)}% of ifc` : ""}`),
    );
  }
  out.push(`    longest MISSING per zone (no partner edge — a surface the zone does not have):`);
  for (const z of a.zones) {
    const top = z.open.filter((e) => e.kind === "missing").slice(0, 3);
    if (top.length === 0) continue;
    out.push(`      ${z.name.padEnd(16)} ` + top.map((e) =>
      `${e.lenM.toFixed(2)} m ${e.category} #${e.elementId}${name(e.elementId)}`).join(" · "));
  }
  return out;
}
