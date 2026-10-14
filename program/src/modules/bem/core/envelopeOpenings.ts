// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// EVERY EXTERIOR OPENING REACHES THE MODEL (user, 2026-10-01: "ALL EXTERIOR DOORS MUST BE INCLUDED ... NO EXCEPTION").
// The writer used to make a subsurface only from a HOLE the carve left in a cell, matched to an opening by its centroid —
// and so dropped, without a word in the column, every opening the carve left as a NOTCH in the outline (a door to the
// floor, a garage door wider than the cell it was placed on: 4 exterior doors and 4 windows in the development model) and every hole
// whose outline is not 3 or 4 vertices (a Marvin slider's head is 2 cm wider than its jambs: 8 vertices, 3 sliders).
//
// Here the opening is the FILE'S rectangle (placeOpenings: OverallWidth × OverallHeight in the cell's plane), never the
// hole. Per plane of exterior cells:
//   1. an opening that overlaps one placed before it keeps only what is not already an opening (the file's two sliders
//      in the Great room overlap by 0.27 m; the engine refuses overlapping subsurfaces) — counted, not lost: the area
//      is in the model under the other opening;
//   2. a cell's WALL is its outline less its holes (an unclaimed remainder's holes are the rooms' cells it wraps, so its
//      filled outline would cover every opening in the wall); the part of the rectangle no cell's wall covers is the
//      opening's void — a hole or a notch alike — and joins the cell it touches most; a notch grows that cell's outline
//      (EnergyPlus wants the base GROSS and subtracts its subsurfaces itself);
//   3. the void a cell took, with any of the rectangle lying on the cell's own wall, is a subsurface on that cell — one
//      opening across two cells is two subsurfaces; a piece of more than 4 vertices is cut into triangles and convex
//      quads (the engine takes 3 or 4).
// Whatever of a rectangle is not written is a LOSS with its reason — the cell is in no zone, it is below grade, the
// rectangle runs outside every cell of its plane — and the column and the gate read the losses: none may pass silently.

import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import earcut from "earcut";
import { frame, type PlacedOpening } from "../../../core/placeOpenings.js";

type V3 = [number, number, number];
type P2 = [number, number];

/** the face shape this module reads — IdfFaceIn's fields it needs (bemIdf imports this module) */
export interface EnvFace {
  id?: number;
  category: string;
  n: V3;
  outer: V3[];
  holes: V3[][];
  openings?: PlacedOpening[];
}

export interface OpeningPiece { op: PlacedOpening; ring: V3[]; areaM2: number }
export interface OpeningAccount {
  op: PlacedOpening;
  /** the file's rectangle */
  placedM2: number;
  /** what the model carries for it */
  emittedM2: number;
  /** written under another opening that overlaps it in the file */
  overlapM2: number;
  /** the rectangle's area that is not the opening — on a cell's own wall, or for a HOLE past every cell's outline (the
   *  sky over a gable): the cut is smaller than OverallWidth × OverallHeight (a polygon window, a head wider than its
   *  jambs), and the opening is what was cut */
  overWallM2: number;
  losses: Array<{ m2: number; reason: string }>;
}
export interface EnvelopeOpenings<F extends EnvFace> {
  /** cells whose gross ring grows by a notch the carve cut out of it */
  base: Map<F, V3[]>;
  /** the subsurfaces each Outdoors cell carries */
  pieces: Map<F, OpeningPiece[]>;
  /** exterior cells whose holes are replaced by the openings — a hole on one of them no opening covers stays a hole */
  holeCovered: (f: F, k: number) => boolean;
  /** the cell lies in a plane whose openings were read here: a hole on it that no opening covers is matched to none */
  inPlane: (f: F) => boolean;
  accounts: OpeningAccount[];
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SNAP = 1e-4;
const snap = (x: number): number => Math.round(x / SNAP) * SNAP;
const ringArea = (r: Ring): number => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const polyArea = (p: Polygon): number => p.reduce((t, r, i) => t + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
const area = (m: MultiPolygon): number => m.reduce((t, p) => t + polyArea(p), 0);
const rect = (s0: number, t0: number, s1: number, t1: number): Polygon => [[[snap(s0), snap(t0)], [snap(s1), snap(t0)], [snap(s1), snap(t1)], [snap(s0), snap(t1)], [snap(s0), snap(t0)]]];
const bbox = (p: Polygon): [number, number, number, number] => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const q of p[0]!) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); } return [a, b, c, d]; };
/** below this a piece is under the engine's resolution (1 cm vertices): counted as a loss, named */
export const MIN_PIECE_M2 = 0.002;

/** a closed ring's distinct, non-collinear vertices */
function clean(r: Ring): P2[] {
  let pts = r.slice() as P2[];
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!, b = pts[i]!, c = pts[(i + 1) % pts.length]!;
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      // a vertex within 1 mm of the line through its neighbours is collinear to the engine (it removes it, with a warning)
      if (Math.abs(cr) < 0.001 * Math.max(Math.hypot(c[0] - a[0], c[1] - a[1]), 1e-9) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}
const convex = (q: P2[]): boolean => {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!, b = q[(i + 1) % q.length]!, c = q[(i + 2) % q.length]!;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
};
/** a polygon (no holes) as rings of 3 or 4 vertices: itself when it is a convex quad or a triangle, else earcut's
 *  triangles, adjacent pairs merged into convex quads */
export function subsurfaceRings(poly: Polygon): P2[][] {
  if (poly.length > 1) {
    // a piece with a hole in it: triangulate with the hole
    const flat: number[] = [], holes: number[] = [];
    const rings = poly.map(clean);
    for (const [i, r] of rings.entries()) { if (i) holes.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); }
    const ix = earcut(flat, holes);
    const pt = (k: number): P2 => [flat[k * 2]!, flat[k * 2 + 1]!];
    const tris: P2[][] = [];
    for (let i = 0; i < ix.length; i += 3) tris.push([pt(ix[i]!), pt(ix[i + 1]!), pt(ix[i + 2]!)]);
    return mergeTris(tris);
  }
  const r = clean(poly[0]!);
  if (r.length === 3 || (r.length === 4 && convex(r))) return [r];
  const flat = r.flatMap((p) => [p[0], p[1]]);
  const ix = earcut(flat);
  const tris: P2[][] = [];
  for (let i = 0; i < ix.length; i += 3) tris.push([r[ix[i]!]!, r[ix[i + 1]!]!, r[ix[i + 2]!]!]);
  return mergeTris(tris);
}
function mergeTris(tris: P2[][]): P2[][] {
  const out: P2[][] = [];
  const used = new Set<number>();
  const same = (a: P2, b: P2): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  for (let i = 0; i < tris.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let merged: P2[] | null = null;
    for (let j = i + 1; j < tris.length && !merged; j++) {
      if (used.has(j)) continue;
      const a = tris[i]!, b = tris[j]!;
      for (let e = 0; e < 3 && !merged; e++) {
        const p = a[e]!, q = a[(e + 1) % 3]!;
        const k = b.findIndex((x) => same(x, q)), l = b.findIndex((x) => same(x, p));
        if (k < 0 || l < 0) continue;
        const other = b.find((_, m) => m !== k && m !== l)!;
        // the quad runs q, a's third vertex, p, then b's — a's ring with b's vertex between p and q
        const qd: P2[] = [q, a[(e + 2) % 3]!, p, other];
        if (convex(qd)) { merged = qd; used.add(j); }
      }
    }
    out.push(merged ?? tris[i]!);
  }
  // a merged quad may carry a vertex on a straight edge: written without it (a triangle then)
  return out.map((q) => clean([...q, q[0]!]));
}

/**
 * The exterior openings, cell by cell. `outdoorsOf(f)` is the writer's own word on a cell: null when it is written with
 * an Outdoors side (a subsurface may stand on it), else why not ("unclaimed by any zone", "below grade", …).
 */
export function envelopeOpenings<F extends EnvFace>(faces: F[], outdoorsOf: (f: F) => string | null): EnvelopeOpenings<F> {
  const base = new Map<F, V3[]>();
  const pieces = new Map<F, OpeningPiece[]>();
  const covered = new Map<F, Set<number>>();
  const accounts: OpeningAccount[] = [];
  const ext = faces.filter((f) => f.category === "exteriorWall" || f.category === "roof");
  const byId = new Map<number, F>();
  for (const f of ext) if (f.id !== undefined) byId.set(f.id, f);
  // the planes: each exterior opening's host plane, and every exterior cell lying in it
  type Plane = { n: V3; d: number; th: V3; up: V3; faces: F[]; ops: PlacedOpening[] };
  const planes: Plane[] = [];
  for (const host of ext) {
    for (const op of host.openings ?? []) {
      const d = dot(host.n, host.outer[0]!);
      let pl = planes.find((p) => dot(p.n, host.n) > 0.9995 && Math.abs(p.d - d) < 0.02);
      if (!pl) {
        const fr = frame(host.n);
        if (!fr) continue;   // a horizontal plane (a flat roof's skylight): the hole path keeps it, counted by the writer
        pl = { n: host.n, d, ...fr, faces: ext.filter((f) => dot(f.n, host.n) > 0.9995 && Math.abs(dot(f.n, f.outer[0]!) - d) < 0.02), ops: [] };
        planes.push(pl);
      }
      pl.ops.push(op);
    }
  }
  for (const pl of planes) {
    const to2 = (p: V3): P2 => [snap(dot(p, pl.th)), snap(dot(p, pl.up))];
    const to3 = (q: P2): V3 => [pl.th[0] * q[0] + pl.up[0] * q[1] + pl.n[0] * pl.d, pl.th[1] * q[0] + pl.up[1] * q[1] + pl.n[1] * pl.d, pl.th[2] * q[0] + pl.up[2] * q[1] + pl.n[2] * pl.d];
    const ring = (pts: V3[]): Ring => { const r = pts.map(to2); return [...r, r[0]!]; };
    const gross = new Map<F, Polygon>();   // the outline, filled — what the engine takes as the base
    const wall = new Map<F, MultiPolygon>();   // the outline less its holes — the cell's own material
    for (const f of pl.faces) {
      const o: Polygon = [ring(f.outer)];
      gross.set(f, o);
      wall.set(f, f.holes.length ? polygonClipping.difference(o, ...f.holes.map((h): Polygon => [ring(h)])) : [o]);
    }
    const all = polygonClipping.union(...([...wall.values()].flat() as [Polygon, ...Polygon[]]));
    const outlines = polygonClipping.union(...([...gross.values()] as [Polygon, ...Polygon[]]));
    // 1. the rectangles, an overlap kept by the opening placed first (by element id: the same answer every run)
    const ops = [...pl.ops].sort((a, b) => a.elementId - b.elementId);
    let taken: MultiPolygon = [];
    const mine: Array<{ op: PlacedOpening; acc: OpeningAccount; r: MultiPolygon }> = [];
    for (const op of ops) {
      // the placer's rectangle is in the HOST cell's frame, the same frame(n) — s along th, t along up
      const R = rect(op.s0, op.t0, op.s1, op.t1);
      const r = taken.length ? polygonClipping.difference(R, taken) : [R];
      const acc: OpeningAccount = { op, placedM2: polyArea(R), emittedM2: 0, overlapM2: polyArea(R) - area(r), overWallM2: 0, losses: [] };
      accounts.push(acc);
      taken = taken.length ? polygonClipping.union(taken, R) : [R];
      mine.push({ op, acc, r });
    }
    // 2. the voids: what of each rectangle no cell's wall covers joins the cell it touches most. The rest of the
    //    rectangle lies on wall: for an opening the carve CUT (hole, notch) it is not the opening — the cut is the
    //    opening's own outline; for one placed on a cell not cut for it ("clear") the rectangle is all there is
    for (const m of mine) {
      if (m.op.fit === "clear") {
        for (const [f, w] of wall) { const x = polygonClipping.intersection(m.r, w); if (area(x) > 1e-6) (m as { on?: Array<[F, MultiPolygon]> }).on = [...((m as { on?: Array<[F, MultiPolygon]> }).on ?? []), [f, x]]; }
      } else m.acc.overWallM2 = all.length ? area(polygonClipping.intersection(m.r, all)) : 0;
      const notch = all.length ? polygonClipping.difference(m.r, all) : m.r;
      for (let comp of notch) {
        // a cut that is a rectangle but for steps of a few centimetres (a slider's head 2 cm wider than its jambs:
        // 8 vertices) — every vertex within 3 cm of its bounding rectangle, filling 95 % of it — is written as that
        // rectangle, the steps counted back as wall; a polygon window (a triangle fills half) keeps its own outline
        if (comp.length === 1 && clean(comp[0]!).length > 4) {
          const [a0, b0, a1, b1] = bbox(comp);
          const box = rect(a0, b0, a1, b1), boxA = polyArea(box), ca = polyArea(comp);
          const near = comp[0]!.every((q) => Math.min(q[0] - a0, a1 - q[0], q[1] - b0, b1 - q[1]) <= 0.03);
          if (near && ca >= 0.95 * boxA) { m.acc.overWallM2 -= boxA - ca; comp = box; }
        }
        const a = polyArea(comp);
        if (a < 1e-6) continue;
        // a HOLE is closed all round by wall: a part of its rectangle past every cell's outline is not the opening
        if (m.op.fit === "hole" && area(polygonClipping.intersection(comp, outlines)) < 1e-6) { m.acc.overWallM2 += a; continue; }
        const [s0, t0, s1, t1] = bbox(comp);
        const box = rect(s0 - 0.03, t0 - 0.03, s1 + 0.03, t1 + 0.03);
        // the cell it touches most AMONG THOSE IN THE MODEL; a cell no zone writes only when no written cell touches it
        // (the ADU crawl's access door touches a 0.34 m² sliver no room claimed and the crawl's own wall beside it)
        let best: F | null = null, bestA = 1e-5, bestIn = false;
        for (const [f, w] of wall) {
          const x = area(polygonClipping.intersection(box, w));
          const isIn = outdoorsOf(f) === null;
          if (x > 1e-5 && ((isIn && !bestIn) || (isIn === bestIn && x > bestA))) { bestA = x; best = f; bestIn = isIn; }
        }
        if (!best) { m.acc.losses.push({ m2: a, reason: "outside every wall or roof piece in its plane" }); continue; }
        (m as { on?: Array<[F, MultiPolygon]> }).on = [...((m as { on?: Array<[F, MultiPolygon]> }).on ?? []), [best, [comp]]];
        // a void outside the cell's outline is a notch: the outline grows by it
        const outside = polygonClipping.difference(comp, gross.get(best)!);
        if (area(outside) < 1e-6) continue;
        const u = polygonClipping.union(gross.get(best)!, comp);
        if (u.length !== 1) { m.acc.losses.push({ m2: a, reason: "its notch would split the wall piece it is in" }); continue; }
        gross.set(best, [u[0]![0]!]);   // the gross ring is the outline: a ring enclosed by the union is not a hole in a base surface
        base.set(best, []);
      }
    }
    for (const f of base.keys()) if (gross.has(f)) base.set(f, clean(gross.get(f)![0]!).map(to3));
    // 3. the pieces: what each cell carries of the rectangle
    for (const m of mine) {
      const on = new Map<F, MultiPolygon>();
      for (const [f, x] of (m as { on?: Array<[F, MultiPolygon]> }).on ?? []) on.set(f, on.has(f) ? polygonClipping.union(on.get(f)!, x) : x);
      for (const [f, x] of on) {
        const a = area(x);
        if (a < 1e-6) continue;
        const why = outdoorsOf(f);
        if (why) { m.acc.losses.push({ m2: a, reason: `on a ${f.category === "roof" ? "roof" : "wall"} piece not in the model: ${why}` }); continue; }
        for (const poly of x) {
          for (const ring of subsurfaceRings(poly)) {
            const ra = ringArea(ring);
            if (ra < MIN_PIECE_M2) { m.acc.losses.push({ m2: ra, reason: "a sliver under the engine's 1 cm resolution" }); continue; }
            (pieces.get(f) ?? pieces.set(f, []).get(f)!).push({ op: m.op, ring: ring.map(to3), areaM2: ra });
            m.acc.emittedM2 += ra;
          }
        }
      }
      // what fell in no cell's ring after the notches joined (a rectangle running past its wall's end)
      const left = m.acc.placedM2 - m.acc.overlapM2 - m.acc.overWallM2 - m.acc.emittedM2 - m.acc.losses.reduce((t, l) => t + l.m2, 0);
      if (left > 0.005) m.acc.losses.push({ m2: left, reason: "outside every wall or roof piece in its plane" });
    }
    // the holes the openings replace: a hole whose centroid lies in an opening's rectangle
    for (const f of pl.faces) {
      const set = new Set<number>();
      f.holes.forEach((h, k) => {
        const c = h.map(to2).reduce<P2>((s, p) => [s[0] + p[0] / h.length, s[1] + p[1] / h.length], [0, 0]);
        if (ops.some((o) => c[0] >= o.s0 - 0.02 && c[0] <= o.s1 + 0.02 && c[1] >= o.t0 - 0.02 && c[1] <= o.t1 + 0.02)) set.add(k);
      });
      covered.set(f, set);
    }
  }
  return { base, pieces, holeCovered: (f, k) => covered.get(f)?.has(k) ?? false, inPlane: (f) => covered.has(f), accounts };
}

/** A cell's OWN area — its outline less its holes (for an unclaimed remainder, the rooms' cells it wraps) — as polygons of 3 or
 *  4 vertices in the cell's plane: what a shading surface takes (2026-10-01, the roof outside conditioned space). Convex
 *  pieces, so either shadow method takes them as casters. A plane with no "up" in it (a flat roof) is framed on x and z. */
export function roofShadePolys(f: EnvFace): V3[][] {
  const fr = frame(f.n) ?? { th: [1, 0, 0] as V3, up: [0, 0, 1] as V3 };
  const d = dot(f.n, f.outer[0]!);
  const to2 = (p: V3): P2 => [snap(dot(p, fr.th)), snap(dot(p, fr.up))];
  const to3 = (q: P2): V3 => [fr.th[0] * q[0] + fr.up[0] * q[1] + f.n[0] * d, fr.th[1] * q[0] + fr.up[1] * q[1] + f.n[1] * d, fr.th[2] * q[0] + fr.up[2] * q[1] + f.n[2] * d];
  const ring = (pts: V3[]): Ring => { const r = pts.map(to2); return [...r, r[0]!]; };
  const own: MultiPolygon = f.holes.length ? polygonClipping.difference([ring(f.outer)], ...f.holes.map((h): Polygon => [ring(h)])) : [[ring(f.outer)]];
  return own.flatMap((poly) => subsurfaceRings(poly).map((r) => r.map(to3)));
}
