// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHERE EACH WINDOW AND DOOR STANDS. A hole-based reading misses 29 of the
// 41 doors in the development model: a door that runs to the floor, or out of the end
// of its wall, is a NOTCH in the wall's outline, not a hole ring — and one
// door in the Great room survived as a hole only because a 2-D boolean
// resolved a zero-width coincidence its way (measured 2026-09-04). So the
// opening is placed by the element's OWN geometry: its stored faces' extent
// projected into a cell's plane frame gives a rectangle; the cell whose ring
// (outer or hole) runs along that rectangle's edges — the jambs, the head,
// the sill — is the cell it cuts. Nothing is derived from a hole; a hole is
// merely one of the two ways a wall's ring can go around an opening.
//
// The rectangle is the FILE'S: measured on this file, every ring runs along
// OverallWidth × OverallHeight (38.5" × 81.25" for a passage door, 98" × 85"
// for the garage door) while the leaf's geometry sits 13–31 mm inside the
// jambs and a sectional door's box holds 2.6 m of track. So the width and
// height are the stated attributes, the horizontal centre is the centre of
// the element's faces lying IN the cell's plane, and the sill is the lowest
// point of the element. The faces' own extent is the fallback when the file
// states no size.

import type { DbFaceRow } from "./db.js";

type V3 = [number, number, number];

export interface OpeningIn {
  elementId: number;
  globalId: string | null;
  kind: string;
  name: string;
  isExternal: boolean | null;
  glazed: boolean;
  glazedSource: string;
  /** the extent of the element's stored faces */
  min: V3;
  max: V3;
  /** the file's stated opening size, when it states one */
  overallWidthM: number | null;
  overallHeightM: number | null;
  /** the element's own faces — the leaf and frame lie in the wall's plane, tracks and swings do not */
  faces: Array<{ n: V3; outer: V3[] }>;
}

export type OpeningFit = "hole" | "notch" | "clear";

export interface PlacedOpening {
  elementId: number;
  globalId: string | null;
  kind: string;
  name: string;
  isExternal: boolean | null;
  glazed: boolean;
  glazedSource: string;
  /** the idf.db surface (cell) the opening cuts */
  surfaceId: number;
  /** how the cell's ring goes around it: a hole ring, a notch in the outer ring, or not cut at all */
  fit: OpeningFit;
  /** the rectangle in the cell's plane frame (s along the plane, t up it) */
  s0: number; s1: number; t0: number; t1: number;
  areaM2: number;
  /** the rectangle's four corners on the cell's plane, world coordinates */
  quad: V3[];
  /** ring length (m) coincident with the rectangle's edges — the evidence */
  coincidentM: number;
}

export interface PlaceReport {
  placed: PlacedOpening[];
  unplaced: Array<{ opening: OpeningIn; reason: string }>;
  byFit: Record<OpeningFit, number>;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** the plane frame: t is "up" within the plane, s across it */
export function frame(n: V3): { th: V3; up: V3 } | null {
  const upRaw: V3 = [-n[0] * n[1], 1 - n[1] * n[1], -n[2] * n[1]];
  if (Math.hypot(upRaw[0], upRaw[1], upRaw[2]) < 1e-3) return null;   // a horizontal plane has no "up" in it
  const up = norm(upRaw);
  return { th: norm(cross(n, up)), up };
}

/** length of a segment lying along one of the rectangle's four edges, within tol */
function coincident(a: [number, number], b: [number, number], r: { s0: number; s1: number; t0: number; t1: number }, tol: number): number {
  const ov = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(Math.max(a0, a1), b1) - Math.max(Math.min(a0, a1), b0));
  let len = 0;
  if (Math.abs(a[0] - b[0]) < tol) {           // an edge running up the plane: a jamb
    const s = (a[0] + b[0]) / 2;
    if (Math.abs(s - r.s0) < tol || Math.abs(s - r.s1) < tol) len += ov(a[1], b[1], r.t0, r.t1);
  }
  if (Math.abs(a[1] - b[1]) < tol) {           // an edge running along the plane: a sill or a head
    const t = (a[1] + b[1]) / 2;
    if (Math.abs(t - r.t0) < tol || Math.abs(t - r.t1) < tol) len += ov(a[0], b[0], r.s0, r.s1);
  }
  return len;
}

function inside(poly: Array<[number, number]>, p: [number, number]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** the engine's own resolution: a ring edge within this of the rectangle's edge lies on it */
const TOL = 0.01;

export function placeOpenings(openings: OpeningIn[], cells: DbFaceRow[]): PlaceReport {
  const placed: PlacedOpening[] = [];
  const unplaced: PlaceReport["unplaced"] = [];
  const byFit: Record<OpeningFit, number> = { hole: 0, notch: 0, clear: 0 };
  // the cells' frames, once
  const framed = cells.flatMap((c) => {
    if (c.id === undefined) return [];
    const f = frame(c.n);
    if (!f) return [];
    const to2 = (p: V3): [number, number] => [dot(p, f.th), dot(p, f.up)];
    const outer = c.outer.map(to2), holes = c.holes.map((h) => h.map(to2));
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const q of outer) { s0 = Math.min(s0, q[0]); s1 = Math.max(s1, q[0]); t0 = Math.min(t0, q[1]); t1 = Math.max(t1, q[1]); }
    return [{ c, ...f, outer, holes, d: dot(c.n, c.outer[0]!), box: { s0, s1, t0, t1 } }];
  });
  for (const o of openings) {
    const corners: V3[] = [];
    for (const x of [o.min[0], o.max[0]]) for (const y of [o.min[1], o.max[1]]) for (const z of [o.min[2], o.max[2]]) corners.push([x, y, z]);
    type Cand = { fc: (typeof framed)[number]; rect: { s0: number; s1: number; t0: number; t1: number }; score: number; holeM: number; outerM: number };
    let best: Cand | null = null;
    let fallback: Cand | null = null;
    // the refusal's evidence: the nearest cell whose extent the rectangle overlaps, and the best ring coincidence seen
    let nearest: { dist: number; bound: number; id: number } | null = null, bestScore = 0;
    for (const fc of framed) {
      const bound = (fc.c.thicknessM ?? 0.2) / 2 + 0.15;
      // the element's faces lying IN this cell's plane (parallel, within the
      // wall's thickness and a hand's width): the leaf and frame, never the
      // tracks or a swing; their s-extent centres the rectangle
      const inPlane = o.faces.filter((f) => Math.abs(dot(f.n, fc.c.n)) > 0.9);
      let dist = Infinity, ps0 = Infinity, ps1 = -Infinity, pt1 = -Infinity;
      for (const f of inPlane) {
        const dd = Math.abs(dot(fc.c.n, f.outer[0]!) - fc.d);
        dist = Math.min(dist, dd);
        if (dd > bound) continue;
        for (const p of f.outer) { const s = dot(p, fc.th); ps0 = Math.min(ps0, s); ps1 = Math.max(ps1, s); pt1 = Math.max(pt1, dot(p, fc.up)); }
      }
      let t0 = Infinity;
      for (const p of corners) t0 = Math.min(t0, dot(p, fc.up));
      if (!Number.isFinite(ps0)) {
        // nothing of the element lies in this plane: note the nearest face for the refusal
        if (Number.isFinite(dist)) { let bs0 = Infinity, bs1 = -Infinity, bt1 = -Infinity; for (const p of corners) { const s = dot(p, fc.th); bs0 = Math.min(bs0, s); bs1 = Math.max(bs1, s); bt1 = Math.max(bt1, dot(p, fc.up)); }
          if (!(bs1 < fc.box.s0 - TOL || bs0 > fc.box.s1 + TOL || bt1 < fc.box.t0 - TOL || t0 > fc.box.t1 + TOL) && (!nearest || dist < nearest.dist)) nearest = { dist, bound, id: fc.c.elementId }; }
        continue;
      }
      const mid = (ps0 + ps1) / 2, halfW = o.overallWidthM !== null ? o.overallWidthM / 2 : (ps1 - ps0) / 2;
      const rect = { s0: mid - halfW, s1: mid + halfW, t0, t1: o.overallHeightM !== null ? t0 + o.overallHeightM : pt1 };
      const { s0, s1, t1 } = rect;
      // the rectangle must lie within the cell's own extent — a plane runs the whole house
      if (s1 < fc.box.s0 - TOL || s0 > fc.box.s1 + TOL || t1 < fc.box.t0 - TOL || t0 > fc.box.t1 + TOL) continue;
      if (!nearest || dist < nearest.dist) nearest = { dist, bound, id: fc.c.elementId };
      let outerM = 0, holeM = 0;
      for (let i = 0; i < fc.outer.length; i++) outerM += coincident(fc.outer[i]!, fc.outer[(i + 1) % fc.outer.length]!, rect, TOL);
      for (const h of fc.holes) for (let i = 0; i < h.length; i++) holeM += coincident(h[i]!, h[(i + 1) % h.length]!, rect, TOL);
      const score = outerM + holeM;
      bestScore = Math.max(bestScore, score);
      if (score > 0.05) { if (!best || score > best.score) best = { fc, rect, score, holeM, outerM }; }
      else if (!fallback && inside(fc.outer, [(s0 + s1) / 2, (t0 + t1) / 2])) fallback = { fc, rect, score: 0, holeM: 0, outerM: 0 };
    }
    const pick = best ?? fallback;
    if (!pick) {
      const size = `${(o.max[0] - o.min[0]).toFixed(2)} × ${(o.max[1] - o.min[1]).toFixed(2)} × ${(o.max[2] - o.min[2]).toFixed(2)} m`;
      unplaced.push({ opening: o, reason: nearest
        ? `extent ${size}; nearest cell #${nearest.id} plane ${nearest.dist.toFixed(3)} m off its centre (bound ${nearest.bound.toFixed(3)}) · best ring coincidence ${bestScore.toFixed(2)} m`
        : `extent ${size}; no cell's extent overlaps it` });
      continue;
    }
    const fit: OpeningFit = best ? (pick.holeM >= pick.outerM ? "hole" : "notch") : "clear";
    const { fc, rect } = pick;
    const lift = 0.004;   // the pane sits a hair proud of the cell, so a cell not cut for it does not fight it
    const at = (s: number, t: number): V3 => [fc.th[0] * s + fc.up[0] * t + fc.c.n[0] * (fc.d + lift), fc.th[1] * s + fc.up[1] * t + fc.c.n[1] * (fc.d + lift), fc.th[2] * s + fc.up[2] * t + fc.c.n[2] * (fc.d + lift)];
    placed.push({
      elementId: o.elementId, globalId: o.globalId, kind: o.kind, name: o.name, isExternal: o.isExternal, glazed: o.glazed, glazedSource: o.glazedSource,
      surfaceId: fc.c.id!, fit, ...rect, areaM2: (rect.s1 - rect.s0) * (rect.t1 - rect.t0),
      quad: [at(rect.s0, rect.t0), at(rect.s1, rect.t0), at(rect.s1, rect.t1), at(rect.s0, rect.t1)],
      coincidentM: pick.score,
    });
    byFit[fit]++;
  }
  return { placed, unplaced, byFit };
}

export function formatPlacement(rep: PlaceReport, label: (o: OpeningIn) => string): string[] {
  const windows = rep.placed.filter((p) => p.kind === "window").length, doors = rep.placed.filter((p) => p.kind === "door").length;
  const out = [`  openings placed on the cells they cut: ${rep.placed.length} (${windows} windows · ${doors} doors) — through a hole ring ${rep.byFit.hole} · a notch in the outline ${rep.byFit.notch} · a cell not cut for it ${rep.byFit.clear} · unplaced ${rep.unplaced.length}`];
  for (const u of rep.unplaced) out.push(`    unplaced ${label(u.opening)}: ${u.reason}`);
  return out;
}
