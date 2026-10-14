// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ABOVE AND BELOW GRADE. An exterior wall's kept face is cut along the ground
// line the terrain draws on it — sampled every six inches along the run,
// each sample marched outward across the excavation — into an above-grade
// part (outdoors) and a below-grade part (the earth). One plane, two
// surfaces, the same vertices where they meet; area identity holds. A slab
// is not cut: its perimeter is sampled the same way and its depth below
// grade recorded. Nothing here reads the file's IsExternal or storey — the
// terrain is the only witness.

import polygonClipping from "polygon-clipping";
import type { IdfFaceOut } from "./collapse.js";
import { gradeBeside, polygonField, STEP_M, type Terrain, type V3, type FillFace, type HeightField } from "./terrain.js";

/** CONCRETE ON FILL. "The exterior front stair and the garage slab have fill
 *  below them" (the user, 2026-09-03): where such an element abuts a wall,
 *  the earth reaches the element's top — and under the front steps "the fill
 *  follows the stair steps", so the element's upward faces are sampled as a
 *  height field, tread by tread. The terrain never shows this fill; the
 *  element does. Which elements: the user's ruling, with the candidates
 *  below as the default. */
export interface FillElement { elementId: number; name: string; topM: number; faces: FillFace[] }

/** one row per exterior wall element: what the databases show */
export interface WallGradeRow {
  elementId: number;
  /** the plane's normal — an element with a return has a row per plane */
  n: V3;
  aboveM2: number; belowM2: number;
  /** the part of belowM2 that fill, not terrain, put under ground */
  fillM2: number;
  gradeMinM: number; gradeMaxM: number; samples: number;
}

type P2 = [number, number];
type Ring2 = P2[];

export interface GradeReport {
  exteriorWalls: number;
  split: number;
  allBelow: number;
  allAbove: number;
  noTerrain: number;
  belowAreaM2: number;
  aboveAreaM2: number;
  slabs: Array<{ elementId: number; topM: number; gradeM: number; depthM: number; samples: number; noTerrain: number }>;
  /** the outward march: how far the samples had to go to clear the excavation */
  march: { samples: number; spanned: number; maxM: number; capped: number; histogram: Array<{ atM: number; n: number }> };
  identityDeltaM2: number;
  /** walls with the deepest below-grade part, for the census */
  deepest: Array<{ elementId: number; depthM: number; belowM2: number; aboveM2: number }>;
  fills: Array<{ elementId: number; name: string; topM: number }>;
  fillAreaM2: number;
  walls: WallGradeRow[];
}

const ringArea2 = (r: Ring2): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
/** a sampled ground line with its collinear points removed: a point within
 *  `tol` of the chord between its neighbours says nothing the chord does not.
 *  Flat ground sampled every six inches otherwise hands the engine hundreds
 *  of collinear vertices to strip one by one (513 warnings, 2026-09-03). */
export function simplifyLine(line: P2[], tol = 0.005): P2[] {
  if (line.length <= 2) return line;
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = true; keep[line.length - 1] = true;
  const rec = (i0: number, i1: number): void => {
    const a = line[i0]!, b = line[i1]!;
    let worst = -1, at = -1;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = line[i]!;
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol && at > 0) { keep[at] = true; rec(i0, at); rec(at, i1); }
  };
  rec(0, line.length - 1);
  return line.filter((_, i) => keep[i]);
}

const open = (r: Ring2): Ring2 =>
  r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.slice(0, -1) : r;

export function gradeSplit(faces: IdfFaceOut[], terrain: Terrain, fills: FillElement[] = [], stepM = STEP_M): { out: IdfFaceOut[]; report: GradeReport } {
  const report: GradeReport = {
    exteriorWalls: 0, split: 0, allBelow: 0, allAbove: 0, noTerrain: 0, belowAreaM2: 0, aboveAreaM2: 0, slabs: [],
    march: { samples: 0, spanned: 0, maxM: 0, capped: 0, histogram: [] }, identityDeltaM2: 0, deepest: [],
    fills: fills.map((f) => ({ elementId: f.elementId, name: f.name, topM: f.topM })), fillAreaM2: 0, walls: [],
  };
  const hist = new Map<number, number>();
  const fillField: HeightField = polygonField(fills.flatMap((f) => f.faces));
  const fillIds = new Set(fills.map((f) => f.elementId));
  /** the terrain, marched; the fill, read within the wall's OWN thickness of
   *  the face on either side (a slab inside the wall, a stair outside it —
   *  the front stair stands 0.14 m off the brick face of a 0.36 m wall, and
   *  a hand's width of 0.1 m missed every tread while catching the landing
   *  at 0.06 m, 2026-09-03). The reach is the file's dimension, floored at
   *  0.2 m for a thin wall. */
  const sample = (x: number, z: number, out: [number, number], withFill: boolean, reachM = 0.2): number | null => {
    const g = gradeBeside(terrain, x, z, out, stepM);
    if (g.gradeM === null) return null;
    report.march.samples++;
    if (g.atM > 1e-9) { report.march.spanned++; report.march.maxM = Math.max(report.march.maxM, g.atM); }
    if (g.capped) report.march.capped++;
    const k = Math.round(g.atM / stepM);
    hist.set(k, (hist.get(k) ?? 0) + 1);
    if (!withFill || fills.length === 0) return g.gradeM;
    let best = g.gradeM;
    const reach = Math.max(0.2, reachM);
    for (let d = -reach; d <= reach + 1e-9; d += 0.05) {
      const h = fillField.heightAt(x + out[0] * d, z + out[1] * d);
      if (h !== null && h > best) best = h;
    }
    return best;
  };
  const out: IdfFaceOut[] = [];
  for (const f of faces) {
    const vertical = Math.abs(f.n[1]) < 0.5;
    if (f.category === "exteriorWall" && vertical) {
      report.exteriorWalls++;
      // the wall's own frame: nh outward in plan, th along the run
      const hl = Math.hypot(f.n[0], f.n[2]) || 1;
      const nh: P2 = [f.n[0] / hl, f.n[2] / hl];
      const th: P2 = [-nh[1], nh[0]];
      const c = nh[0] * f.outer[0]![0] + nh[1] * f.outer[0]![2];
      const to2 = (p: V3): P2 => [th[0] * p[0] + th[1] * p[2], p[1]];
      const to3 = (q: P2): V3 => [nh[0] * c + th[0] * q[0], q[1], nh[1] * c + th[1] * q[0]];
      const outer2 = f.outer.map(to2), holes2 = f.holes.map((h) => h.map(to2));
      const ss = outer2.map((q) => q[0]), ys = outer2.map((q) => q[1]);
      const s0 = Math.min(...ss), s1 = Math.max(...ss), yLo = Math.min(...ys) - 1, yHi = Math.max(...ys);
      // the ground line along the run — the terrain's, and the terrain's
      // raised by any fill against the face; the difference is the fill's area
      const line: P2[] = [], lineTerrain: P2[] = [];
      let missing = 0;
      for (let s = s0; ; s += stepM) {
        const at = Math.min(s, s1);
        const p = to3([at, 0]);
        const gt = sample(p[0], p[2], nh, false);
        const g = fills.length ? sample(p[0], p[2], nh, true, f.thicknessM) : gt;
        if (g === null || gt === null) missing++; else { line.push([at, g]); lineTerrain.push([at, gt]); }
        if (at >= s1) break;
      }
      if (line.length < 2) { report.noTerrain++; out.push(f); continue; }
      for (const ln of [line, lineTerrain]) {
        if (ln[0]![0] > s0) ln.unshift([s0, ln[0]![1]]);
        if (ln[ln.length - 1]![0] < s1) ln.push([s1, ln[ln.length - 1]![1]]);
      }
      // the min/max and the areas are read from the full samples; the cut
      // itself uses the simplified line (the same line, fewer vertices)
      const lineCut = simplifyLine(line);
      /** the area of the wall under a ground line */
      const areaUnder = (ln: P2[]): number => {
        const ground: Ring2 = [[s0, yLo], ...ln, [s1, yLo]];
        try {
          const below = polygonClipping.intersection([[outer2, ...holes2]] as never, [[ground]] as never) as Ring2[][];
          let a = 0;
          for (const poly of below) { const [o, ...hs] = poly.map(open); if (o) a += Math.abs(ringArea2(o)); for (const h of hs) a -= Math.abs(ringArea2(h)); }
          return a;
        } catch { return 0; }
      };
      const belowWithFill = areaUnder(line), belowTerrain = fills.length ? areaUnder(lineTerrain) : belowWithFill;
      const fillM2 = Math.max(0, belowWithFill - belowTerrain);
      report.fillAreaM2 += fillM2;
      report.walls.push({ elementId: f.elementId, n: f.n, aboveM2: Math.max(0, f.areaM2 - belowWithFill), belowM2: belowWithFill, fillM2,
        gradeMinM: Math.min(...line.map((q) => q[1])), gradeMaxM: Math.max(...line.map((q) => q[1])), samples: line.length });
      const gMin = Math.min(...line.map((q) => q[1])), gMax = Math.max(...line.map((q) => q[1]));
      const gMean = line.reduce((t, q) => t + q[1], 0) / line.length;
      /** how far under the ground line a piece's AREA centroid sits — the
       *  area centroid, not the mean of the vertices: a cut piece carries
       *  dozens of vertices along its ground line and a few at its base */
      const depthOf = (ring: Ring2): number => {
        let a2 = 0, cx = 0, cy = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
          const w = p[0] * q[1] - q[0] * p[1];
          a2 += w; cx += (p[0] + q[0]) * w; cy += (p[1] + q[1]) * w;
        }
        if (Math.abs(a2) < 1e-12) { cy = ring.reduce((t, q) => t + q[1], 0) / ring.length; cx = ring.reduce((t, q) => t + q[0], 0) / ring.length; }
        else { cx /= 3 * a2; cy /= 3 * a2; }
        const cs = cx;
        let g = gMean;
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1]!, b = line[i]!;
          if (cs >= a[0] && cs <= b[0]) { const tt = b[0] > a[0] ? (cs - a[0]) / (b[0] - a[0]) : 0; g = a[1] + tt * (b[1] - a[1]); break; }
        }
        return g - cy;
      };
      if (gMin >= yHi - 1e-6) { report.allBelow++; report.belowAreaM2 += f.areaM2; out.push({ ...f, grade: "below", gradeM: gMean, gradeDepthM: depthOf(outer2) }); continue; }
      if (gMax <= Math.min(...ys) + 1e-6) { report.allAbove++; report.aboveAreaM2 += f.areaM2; out.push({ ...f, grade: "above", gradeM: gMean }); continue; }
      // the earth as a polygon under the ground line; clip the wall by it
      const ground: Ring2 = [[s0, yLo], ...lineCut, [s1, yLo]];
      const wall = [outer2, ...holes2];
      let below: Ring2[][], above: Ring2[][];
      try {
        below = polygonClipping.intersection([wall] as never, [[ground]] as never) as Ring2[][];
        above = polygonClipping.difference([wall] as never, [[ground]] as never) as Ring2[][];
      } catch { report.noTerrain++; out.push(f); continue; }
      let sum = 0;
      const emit = (polys: Ring2[][], grade: "above" | "below"): void => {
        for (const poly of polys) {
          const [o, ...hs] = poly.map(open);
          if (!o || o.length < 3) continue;
          let a = Math.abs(ringArea2(o));
          for (const h of hs) a -= Math.abs(ringArea2(h));
          if (a < 1e-6) continue;
          sum += a;
          if (grade === "below") report.belowAreaM2 += a; else report.aboveAreaM2 += a;
          out.push({ ...f, areaM2: a, outer: o.map(to3), holes: hs.filter((h) => h.length >= 3).map((h) => h.map(to3)),
            grade, gradeM: gMean, gradeDepthM: grade === "below" ? depthOf(o) : undefined });
        }
      };
      emit(below, "below"); emit(above, "above");
      report.split++;
      report.identityDeltaM2 += Math.abs(sum - f.areaM2);
      const bel = out.filter((g) => g.elementId === f.elementId && g.grade === "below" && g !== f);
      if (bel.length) report.deepest.push({ elementId: f.elementId, depthM: Math.max(...bel.map((g) => g.gradeDepthM ?? 0)),
        belowM2: bel.reduce((t, g) => t + g.areaM2, 0), aboveM2: out.filter((g) => g.elementId === f.elementId && g.grade === "above").reduce((t, g) => t + g.areaM2, 0) });
      continue;
    }
    if (f.category === "floor" && Math.abs(f.n[1]) > 0.9) {
      if (fillIds.has(f.elementId)) {
        // concrete on fill: on the ground by the user's rule, whatever the terrain beside it reads
        const top = f.outer.reduce((t, p) => t + p[1], 0) / f.outer.length;
        report.slabs.push({ elementId: f.elementId, topM: top, gradeM: top, depthM: 0, samples: 0, noTerrain: 0 });
        out.push({ ...f, gradeM: top, gradeDepthM: 0 });
        continue;
      }
      // the slab's perimeter, sampled outward from each edge
      const ring = f.outer.map((p): P2 => [p[0], p[2]]);
      const ccw = ringArea2(ring) > 0;
      const top = f.outer.reduce((t, p) => t + p[1], 0) / f.outer.length;
      let gs = 0, n = 0, miss = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const d: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const outward: P2 = ccw ? [d[1], -d[0]] : [-d[1], d[0]];
        for (let s = 0; s <= len; s += stepM) {
          const g = sample(a[0] + d[0] * s, a[1] + d[1] * s, outward, true);
          if (g === null) miss++; else { gs += g; n++; }
        }
      }
      if (n > 0) {
        const gradeM = gs / n;
        report.slabs.push({ elementId: f.elementId, topM: top, gradeM, depthM: gradeM - top, samples: n, noTerrain: miss });
        out.push({ ...f, gradeM, gradeDepthM: gradeM - top });
        continue;
      }
    }
    out.push(f);
  }
  report.march.histogram = [...hist].map(([k, n]) => ({ atM: k * stepM, n })).sort((a, b) => a.atM - b.atM);
  report.deepest.sort((a, b) => b.depthM - a.depthM);
  return { out, report };
}

export function formatGrade(r: GradeReport, name: (id: number) => string = () => ""): string[] {
  const h = r.march.histogram;
  const lines = [
    `  GRADE from the site terrain — ${r.exteriorWalls} exterior wall planes: ${r.split} cut at the ground line, ${r.allBelow} wholly below, ${r.allAbove} wholly above, ${r.noTerrain} with no terrain beside them · ` +
      `below grade ${r.belowAreaM2.toFixed(1)} m² · above ${r.aboveAreaM2.toFixed(1)} m² · identity Δ ${r.identityDeltaM2.toFixed(4)} m²`,
    `    the outward march (6-inch steps): ${r.march.samples} samples, ${r.march.spanned} had to cross an excavation (${(100 * r.march.spanned / Math.max(1, r.march.samples)).toFixed(0)}%), farthest ${r.march.maxM.toFixed(2)} m, capped at 3 m ${r.march.capped} · ` +
      `by distance: ${h.slice(0, 10).map((b) => `${b.atM.toFixed(2)} m ×${b.n}`).join(" · ")}${h.length > 10 ? " …" : ""}`,
    `    slabs (${r.slabs.length}): ` + r.slabs.slice().sort((a, b) => b.depthM - a.depthM).slice(0, 8).map((s) =>
      `#${s.elementId} top ${s.topM.toFixed(2)} grade ${s.gradeM.toFixed(2)} → ${s.depthM >= 0 ? `${s.depthM.toFixed(2)} m below` : `${(-s.depthM).toFixed(2)} m above`}${name(s.elementId)}`).join(" · "),
    `    fill (concrete on earth, the user's rule): ${r.fills.length ? r.fills.map((f) => `#${f.elementId} ${f.name.slice(0, 40)} top ${f.topM.toFixed(2)}`).join(" · ") : "none"} → ${r.fillAreaM2.toFixed(1)} m² of wall below grade by fill`,
    `    deepest walls: ` + r.deepest.slice(0, 8).map((d) => `#${d.elementId} ${d.depthM.toFixed(2)} m (below ${d.belowM2.toFixed(1)} / above ${d.aboveM2.toFixed(1)} m²)${name(d.elementId)}`).join(" · "),
  ];
  return lines;
}

/** THE DEFAULT FILL LIST — concrete the file draws standing on the ground:
 *  a cast-in-place stair (its treads are the fill's profile), the landing
 *  slab that belongs to it, and a concrete floor slab whose top is within
 *  1.5 m above the terrain beside it with no room beneath (a slab on fill;
 *  a framed floor over a crawl space is not). Each is named in the census;
 *  the ruling is the user's. */
export function fillCandidates(
  elements: Array<{ expressId: number; ifcClass: string; name: string | null }>,
  faces: Array<{ expressId: number; n: V3; outer: V3[]; areaM2: number }>,
  rooms: Array<{ faces: Array<{ n: V3; outer: V3[] }> }>,
  terrain: Terrain,
): FillElement[] {
  const byEl = new Map<number, typeof faces>();
  for (const f of faces) { const a = byEl.get(f.expressId); if (a) a.push(f); else byEl.set(f.expressId, [f]); }
  const topOf = (fs: typeof faces): number => Math.max(...fs.flatMap((f) => f.outer.map((p) => p[1])));
  const inRing = (x: number, z: number, ring: V3[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a[2] > z) !== (b[2] > z) && x < ((b[0] - a[0]) * (z - a[2])) / (b[2] - a[2]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const out: FillElement[] = [];
  // the stair's name without its "Run 1" / "Landing 1" suffix — the aggregate
  // IfcStair carries no geometry of its own, so its flights name it here
  const stairKeys = [...new Set(elements
    .filter((e) => /^IFCSTAIR(FLIGHT)?$/.test(e.ifcClass.toUpperCase()) && /cast-in-place/i.test(e.name ?? ""))
    .map((s) => (s.name ?? "").replace(/\s*(Run|Landing)\s*\d*.*$/i, "").trim())
    .filter((k) => k.length > 0))];
  for (const e of elements) {
    const fs = byEl.get(e.expressId);
    if (!fs || fs.length === 0) continue;
    const cls = e.ifcClass.toUpperCase();
    const nm = e.name ?? "";
    let why: string | null = null;
    if (cls === "IFCSTAIR" || cls === "IFCSTAIRFLIGHT") { if (/cast-in-place/i.test(nm)) why = "cast-in-place stair"; }
    else if (cls === "IFCSLAB") {
      if (/landing/i.test(nm) && stairKeys.some((k) => k && nm.startsWith(k))) why = "landing of a cast-in-place stair";
      else if (/concrete/i.test(nm)) {
        // a concrete slab: on fill when the terrain beside it is within 1.5 m below its top and no room lies under it
        const top = topOf(fs);
        const ups = fs.filter((f) => f.n[1] > 0.9);
        const cx = ups.reduce((t, f) => t + f.outer.reduce((u, p) => u + p[0], 0) / f.outer.length, 0) / Math.max(1, ups.length);
        const cz = ups.reduce((t, f) => t + f.outer.reduce((u, p) => u + p[2], 0) / f.outer.length, 0) / Math.max(1, ups.length);
        const g = terrain.tris.length ? gradeBeside(terrain, cx, cz, [1, 0]).gradeM : null;
        const roomBelow = rooms.some((r) => r.faces.some((rf) =>
          rf.n[1] > 0.9 && rf.outer[0]![1] < top - 0.05 && rf.outer[0]![1] > top - 4 && inRing(cx, cz, rf.outer)));
        if (g !== null && top - g > -0.1 && top - g <= 1.5 && !roomBelow) why = `concrete slab ${(top - g).toFixed(2)} m above the terrain, nothing beneath`;
      }
    }
    if (!why) continue;
    out.push({ elementId: e.expressId, name: `${nm} (${why})`, topM: topOf(fs), faces: fs.map((f) => ({ n: f.n, outer: f.outer })) });
  }
  return out;
}
