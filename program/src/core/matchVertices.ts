// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ONE CORRECTIVE MODEL — match adjoining vertices by plane intersection.
//
// Replaces three separate passes (link-ends, stepped-ends, roof-bands), each
// of which was patched into existence by a defect seen on screen. They were
// the same operation stated three ways.
//
//   A boundary vertex of surface P that must meet surface Q has exactly one
//   correct home: the line L = P ∩ Q. Moving the vertex onto L puts it on Q
//   WITHOUT taking it off P, because L lies in P.
//
// So the plane's normal and direction are preserved by construction, not by
// care — the invariant the user asked for, and provable rather than
// incidental. Everything else falls out of it:
//
//   Q = another wall   L is a vertical line   -> the shared corner point
//   Q = a pitched roof L is a SLOPED line     -> the raked top, for free
//   Q = a slab         L is a horizontal line -> the wall meets the floor
//   Q parallel to P    no intersection        -> a storey step; the user
//                                                decides (see StepMismatch)
//
// Working frame. A vertical wall plane P is parameterised by (s, y): s runs
// along the wall, y is height. Substituting P's parameterisation into Q's
// plane equation gives a straight line in that frame:
//
//     A·s + B·y = C      A = n_Q·th,  B = n_Q.y,  C = d_Q − c_P·(n_Q·nh)
//
// B = 0 means Q is vertical, so s = C/A — a corner, at every height.
// A = 0 means Q is horizontal, so y = C/B. Otherwise the line is sloped and
// the wall's top follows the pitch exactly. A = B = 0 means Q is parallel:
// no intersection exists and nothing may be invented.
//
// Every bound below is a dimension the FILE states — the sum of two wall
// thicknesses for a join, an element's own pair thickness for a band — never
// a tuned distance (principles.md #9).

import { basis } from "./extract.js";
import type { Category, IdfFaceOut } from "./collapse.js";

const EPS = 1e-3;          // 1 mm — the file's own precision
const NQ = 1e-3, DQ = 5e-4; // the plane quantisation collapse.ts groups by
const FLAT = 0.01;         // |n.y| below this = a vertical plane

type V3 = [number, number, number];
type V2 = [number, number];

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export type Boundary = "start" | "end" | "bottom" | "top";

/** Two wall planes that are parallel but offset — a storey step. No projection
 *  can join them, so the user rules on each one. */
export interface StepMismatch {
  /** stable across runs, so a ruling the user made survives a rebuild */
  key: string;
  lowerId: number; upperId: number;
  offsetM: number;
  atHeightM: number;
  lowerThicknessM: number; upperThicknessM: number;
}

export type StepChoice = "keep" | "alignUpper" | "alignLower";

export interface MatchReport {
  planes: number;
  movable: number;
  /** vertices moved onto an intersection line, by what they were matched to */
  movedToWall: number;
  movedToRoof: number;
  movedToFloor: number;
  /** boundary chains split because different neighbours bound different parts */
  banded: number;
  /** vertices inserted so two chains share every vertex — what turns a contact
   *  into a MATCH */
  verticesInserted: number;
  /** refused because the move exceeded the bound the file states */
  beyondBound: number;
  /** wall tops that stopped SHORT of a roof soffit — by less than the wall's
   *  own thickness, with nothing else in the gap — and were taken to the
   *  roof. The unattached-wall outliers the user was closing by hand. */
  reachedShort: number;
  shortSample: Array<{ elementId: number; shortM: number; roofId: number }>;
  /** top edges split at a roof's plan edge into a run on the roof and a step */
  roofEdgeSteps: number;
  /** end edges whose neighbour changes with height, stepped at that height */
  endSteps: number;
  /** wall tops short of a COPLANAR wall's bottom by less than their own
   *  thickness, gap empty, raised to meet it */
  reachedCoplanar: number;
  /** floor outline edges moved out to the exterior wall standing on them */
  floorEdgesToWall: number;
  floorEdgeLenM: number;
  /** floor edges short of a wall by MORE than its thickness — left, named */
  floorEdgesBeyond: Array<{ floorId: number; wallId: number; distM: number; lenM: number }>;
  /** interior walls (partitions) whose ends were taken to an exterior wall's kept plane */
  partitions: number;
  partitionEnds: number;
  /** partition end vertices with no exterior wall within the join envelope — most
   *  ends meet another partition, which this pass does not touch */
  partitionEndsLeft: number;
  /** partition end vertices already on the exterior wall's plane (no move) */
  partitionEndsAlready: number;
  partitionMoves: Array<{ elementId: number; wallId: number; moveM: number; wallThicknessM: number }>;
  /** every wall-bottom vertex trimmed up into a floor, by name — few enough to print */
  trimSample: Array<{ elementId: number; floorId: number; liftM: number; at: V3 }>;
  /** bottom edges where only SOME vertices qualified for a trim — refused whole */
  trimPartialRefused: number;
  /** wall-end vertices whose nearest plane lay INSIDE another exterior wall's
   *  solid, redirected to that wall's own plane */
  endsThroughSolid: number;
  endsThroughSolidSample: Array<{ elementId: number; fromId: number; toId: number; moveM: number }>;
  /** wall bottoms that ran down inside a floor slab and were trimmed up to its
   *  kept top surface, by no more than the slab's own thickness */
  trimmedIntoFloor: number;
  /** top corners that also ended a notch: moved to the junction of the two
   *  roofs' lines (the notch's roof and the top's), the notch lifted onto its
   *  roof — or, with no roof under the notch, duplicated (the fallback) */
  notchJunctions: number;
  notchSplits: number;
  /** refused because it would have collapsed the surface's run */
  degenerate: number;
  maxMoveM: number;
  steps: StepMismatch[];
  stepsKept: number; stepsAligned: number; bandsEmitted: number;
  /** the largest moves, for the user's judgement (old ruling #20) */
  largest: Array<{ elementId: number; boundary: Boundary; moveM: number; toCategory: string }>;
}

interface Plane {
  key: string;
  elementId: number;
  category: Category;
  n: V3;
  d: number;
  /** vertical planes only: the (s, y) frame */
  nh: V2; th: V2; c: number;
  vertical: boolean;
  faces: IdfFaceOut[];
  thicknessM: number;
  s: [number, number];
  y: [number, number];
}

/** the face's nearest and farthest s at height y — the END envelope. The
 *  plane's single extreme s misses a JOGGED end: #257280 [ADU]'s east end
 *  stands 57 mm further in above the ADU floor than below it, and its whole
 *  upper end was invisible to the corner logic (user, 2026-09-02). */
function sEnvelope(ring: V3[], th: V2, y: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    if (y < Math.min(a[1], b[1]) - EPS || y > Math.max(a[1], b[1]) + EPS) continue;
    const sa = th[0] * a[0] + th[1] * a[2], sb = th[0] * b[0] + th[1] * b[2];
    if (Math.abs(b[1] - a[1]) < EPS) { lo = Math.min(lo, sa, sb); hi = Math.max(hi, sa, sb); }
    else { const sv = sa + ((y - a[1]) / (b[1] - a[1])) * (sb - sa); lo = Math.min(lo, sv); hi = Math.max(hi, sv); }
  }
  return [lo, hi];
}

/** the face's upper and lower boundary at parameter s */
function envelope(ring: V3[], th: V2, s: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const sa = th[0] * a[0] + th[1] * a[2], sb = th[0] * b[0] + th[1] * b[2];
    if (s < Math.min(sa, sb) - EPS || s > Math.max(sa, sb) + EPS) continue;
    if (Math.abs(sb - sa) < EPS) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); }
    else {
      const y = a[1] + ((s - sa) / (sb - sa)) * (b[1] - a[1]);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
  }
  return [lo, hi];
}

function faceArea(f: IdfFaceOut): number {
  const { u, v } = basis(f.n);
  const ring = (pts: V3[]): number => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
      a += dot(p, u) * dot(q, v) - dot(q, u) * dot(p, v);
    }
    return Math.abs(a / 2);
  };
  let a = ring(f.outer);
  for (const h of f.holes) a -= ring(h);
  return a;
}

function inRing(pt: V2, ring: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Q's line in P's (s, y) frame: A·s + B·y = C. Null when Q is parallel to P. */
function lineOf(P: Plane, Q: Plane): { A: number; B: number; C: number } | null {
  const A = Q.n[0] * P.th[0] + Q.n[2] * P.th[1];
  const B = Q.n[1];
  if (Math.abs(A) < 1e-9 && Math.abs(B) < 1e-9) return null;      // parallel
  return { A, B, C: Q.d - P.c * (Q.n[0] * P.nh[0] + Q.n[2] * P.nh[1]) };
}

export const stepKey = (lowerId: number, upperId: number, atHeightM: number): string =>
  `${lowerId}|${upperId}|${Math.round(atHeightM * 1e3)}`;

export function matchVertices(
  faces: IdfFaceOut[],
  /** the user's ruling per step. Absent = "keep", which invents nothing. */
  decisions: Map<string, StepChoice> = new Map(),
): { out: IdfFaceOut[]; report: MatchReport } {
  const out: IdfFaceOut[] = faces.map((f) => ({
    ...f, n: [...f.n] as V3,
    outer: f.outer.map((p) => [...p] as V3),
    holes: f.holes.map((h) => h.map((p) => [...p] as V3)),
  }));
  const rep: MatchReport = {
    planes: 0, movable: 0, movedToWall: 0, movedToRoof: 0, movedToFloor: 0,
    banded: 0, verticesInserted: 0, beyondBound: 0, reachedShort: 0, shortSample: [], roofEdgeSteps: 0, notchJunctions: 0, notchSplits: 0, trimmedIntoFloor: 0, endSteps: 0, reachedCoplanar: 0, floorEdgesToWall: 0, floorEdgeLenM: 0, floorEdgesBeyond: [], partitions: 0, partitionEnds: 0, partitionEndsLeft: 0, partitionEndsAlready: 0, partitionMoves: [], trimSample: [], trimPartialRefused: 0, endsThroughSolid: 0, endsThroughSolidSample: [], degenerate: 0, maxMoveM: 0,
    steps: [], stepsKept: 0, stepsAligned: 0, bandsEmitted: 0, largest: [],
  };

  // ── planes, keyed as collapse.ts keys them ───────────────────────────────
  const byKey = new Map<string, IdfFaceOut[]>();
  for (const f of out) {
    const p0 = f.outer[0];
    if (!p0) continue;
    const d = dot(f.n, p0);
    const key = `${f.elementId}|${Math.round(f.n[0] / NQ)}|${Math.round(f.n[1] / NQ)}|` +
      `${Math.round(f.n[2] / NQ)}|${Math.round(d / DQ)}`;
    const a = byKey.get(key);
    if (a) a.push(f); else byKey.set(key, [f]);
  }
  const planes: Plane[] = [];
  for (const [key, fs] of byKey) {
    const f0 = fs[0]!;
    const vertical = Math.abs(f0.n[1]) < FLAT;
    const hl = Math.hypot(f0.n[0], f0.n[2]) || 1;
    const nh: V2 = [f0.n[0] / hl, f0.n[2] / hl];
    const th: V2 = [-nh[1], nh[0]];
    const c = nh[0] * f0.outer[0]![0] + nh[1] * f0.outer[0]![2];
    let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of fs) for (const p of f.outer) {
      const t = th[0] * p[0] + th[1] * p[2];
      if (t < s0) s0 = t; if (t > s1) s1 = t;
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    planes.push({
      key, elementId: f0.elementId, category: f0.category, n: f0.n, d: dot(f0.n, f0.outer[0]!),
      nh, th, c, vertical, faces: fs, thicknessM: f0.thicknessM, s: [s0, s1], y: [y0, y1],
    });
  }
  rep.planes = planes.length;
  const movable = planes.filter((p) => p.category === "exteriorWall" && p.vertical);
  rep.movable = movable.length;

  // plan outlines of the horizontal surfaces, for "is Q actually overhead?"
  const planOf = new Map<Plane, V2[]>();
  for (const q of planes) {
    if (q.vertical) continue;
    planOf.set(q, q.faces[0]!.outer.map((p): V2 => [p[0], p[2]]));
  }

  // Is the vertical segment at plan (x, z) from y0 up to y1 crossed by any
  // surface of another element? A horizontal plane crosses at one height; a
  // vertical one counts when the point lies within its thickness and its run
  // and their heights overlap. This is what makes "the wall stops short of the
  // roof" distinguishable from "the wall is under an eave, with air above it".
  const occupied = (x: number, z: number, y0: number, y1: number, skipA: number, skipB: number): boolean => {
    for (const K of planes) {
      if (K.elementId === skipA || K.elementId === skipB) continue;
      if (!K.vertical) {
        const ring = planOf.get(K);
        if (!ring || Math.abs(K.n[1]) < 1e-6 || !inRing([x, z], ring)) continue;
        const y = (K.d - K.n[0] * x - K.n[2] * z) / K.n[1];
        if (y > y0 + EPS && y < y1 - EPS) return true;
      } else {
        // a wall's solid lies on ONE side of its kept face: behind an
        // exterior face (mode E), ahead of an interior one (mode I), either
        // side of a midplane (mode M). Testing both sides read the Laundry
        // wall as "above" the corner of the wall it merely stands beside.
        const sd = K.nh[0] * x + K.nh[1] * z - K.c;
        const mode = K.faces[0]?.mode;
        const inSolid = mode === "M" ? Math.abs(sd) <= K.thicknessM / 2 + 0.02
          : mode === "I" ? sd >= -0.02 && sd <= K.thicknessM + 0.02
          : sd <= 0.02 && sd >= -K.thicknessM - 0.02;
        if (!inSolid) continue;
        const sk = K.th[0] * x + K.th[1] * z;
        if (sk < K.s[0] - EPS || sk > K.s[1] + EPS) continue;
        if (K.y[1] <= y0 + EPS || K.y[0] >= y1 - EPS) continue;
        return true;
      }
    }
    return false;
  };

  const stepPairs: Array<{ step: StepMismatch; lower: Plane; upper: Plane }> = [];
  // ── storey steps: parallel, offset, sharing height. Reported, never guessed
  for (let i = 0; i < movable.length; i++) {
    for (let j = i + 1; j < movable.length; j++) {
      const A = movable[i]!, B = movable[j]!;
      if (Math.abs(A.nh[0] * B.nh[0] + A.nh[1] * B.nh[1]) < 0.999) continue;   // not parallel
      const offset = Math.abs(A.c - B.c * (A.nh[0] * B.nh[0] + A.nh[1] * B.nh[1] > 0 ? 1 : -1));
      if (offset <= EPS || offset > A.thicknessM + B.thicknessM + EPS) continue;
      // they must stack: one's top meets the other's bottom
      const meet = Math.abs(A.y[1] - B.y[0]) <= EPS ? A.y[1]
        : Math.abs(B.y[1] - A.y[0]) <= EPS ? B.y[1] : null;
      if (meet === null) continue;
      // AND THEY MUST BE THE SAME WALL LINE. Parallel, offset and stacked is
      // not enough: a house has many walls on one grid line. #11276 [Yard]
      // (x 2.20…9.86) and #12102 [Basement + Storage + Great] (x −17.07…−8.79)
      // are both at z ≈ −11 and their heights meet exactly, so they were
      // offered as a step — 11 m apart, with no run in common. The user ruled
      // on that phantom and the wall it moved was not the one under it
      // (2026-09-01). Runs are compared in A's frame; B's own s runs backwards
      // when the two face opposite ways.
      const toA = (sv: number): number =>
        A.th[0] * (B.nh[0] * B.c + B.th[0] * sv) + A.th[1] * (B.nh[1] * B.c + B.th[1] * sv);
      const b0 = Math.min(toA(B.s[0]), toA(B.s[1])), b1 = Math.max(toA(B.s[0]), toA(B.s[1]));
      if (Math.min(A.s[1], b1) - Math.max(A.s[0], b0) <= EPS) continue;
      const lower = A.y[0] < B.y[0] ? A : B, upper = lower === A ? B : A;
      const step: StepMismatch = {
        key: stepKey(lower.elementId, upper.elementId, meet),
        lowerId: lower.elementId, upperId: upper.elementId, offsetM: offset, atHeightM: meet,
        lowerThicknessM: lower.thicknessM, upperThicknessM: upper.thicknessM,
      };
      rep.steps.push(step);
      stepPairs.push({ step, lower, upper });
    }
  }

  // ── the user's ruling on each step, applied BEFORE anything is projected,
  //    because aligning moves a whole plane and every later intersection is
  //    computed from it. Translating a plane along its own normal keeps the
  //    normal — the direction is maintained, only the offset changes.
  const slide = (pl: Plane, toC: number): void => {
    const dc = toC - pl.c;
    for (const f of pl.faces) {
      for (const ring of [f.outer, ...f.holes]) {
        for (const p of ring) { p[0] += pl.nh[0] * dc; p[2] += pl.nh[1] * dc; }
      }
      f.n = [...f.n] as V3;
    }
    pl.c = toC;
    pl.d = dot(pl.n, pl.faces[0]!.outer[0]!);
  };
  // `c` is measured along each plane's OWN nh, and a stacked neighbour very
  // often faces the other way (10 of the 18 steps here): nh negates, so the
  // same physical plane has c of the opposite sign. Assigning the neighbour's c
  // raw did not nudge a wall by the offset, it MIRRORED it through the origin —
  // "align to lower" threw #1764730 [Laundry + Great] from z −10.981 to +11.168,
  // 22 m to the far side of the house, which is why a ruling looked like it did
  // nothing: the wall left the view entirely (2026-09-01).
  const alignTo = (pl: Plane, other: Plane): void =>
    slide(pl, pl.nh[0] * other.nh[0] + pl.nh[1] * other.nh[1] > 0 ? other.c : -other.c);
  for (const { step, lower, upper } of stepPairs) {
    const choice = decisions.get(step.key) ?? "keep";
    if (choice === "alignUpper") { alignTo(lower, upper); rep.stepsAligned++; }
    else if (choice === "alignLower") { alignTo(upper, lower); rep.stepsAligned++; }
    else rep.stepsKept++;
  }

  // ── FLOOR EDGES TO THE WALLS THAT STAND ON THEM. Walls are the only movable
  //    set, so a wall's bottom was brought to its floor but a floor's edge was
  //    never brought to a wall — and the file draws slabs to the wall's
  //    INTERIOR face or centreline while the kept wall plane is the exterior
  //    face. Measured: 48 of 87 floor outline edges have an exterior wall
  //    beside them, at 0.184 in a 0.184 wall, 0.282 in a 0.305 wall, at the
  //    centreline 0.152 / 0.086–0.117 — a band one wall thickness wide around
  //    every slab, which the user saw on the basement and crawl slabs (2026-
  //    09-02). The one model again, P the floor, Q the wall: an edge running
  //    along a wall, lying inside the wall's OWN thickness of its face, the
  //    wall standing at the floor's level and the runs overlapping, moves to
  //    the wall's plane — both ends, a corner taking both its walls. Edges
  //    short of a wall by MORE than its thickness are left and named.
  //    This runs AFTER the user's step rulings: a ruling slides a whole wall,
  //    and the slab must be measured against the wall where the user put it.
  //    The ADU crawl slab stopped 0.340 m short of #80607's authored face
  //    (a 0.305 wall) and was refused BEFORE "align to upper" moved that
  //    face to 0.220 m; the ruling was applied and the edge stayed open
  //    (user, 2026-09-02).
  {
    const walls = planes.filter((q) => q.vertical && q.category === "exteriorWall");
    for (const F of planes) {
      if (F.vertical || F.category !== "floor" || Math.abs(F.n[1]) < 0.999) continue;
      for (const f of F.faces) {
        const r = f.outer;
        const ring2 = r.map((p): V2 => [p[0], p[2]]);
        const moves = new Map<V3, { dx: number; dz: number }>();
        for (let i = 0; i < r.length; i++) {
          const a = r[i]!, b = r[(i + 1) % r.length]!;
          const ex = b[0] - a[0], ez = b[2] - a[2];
          const L = Math.hypot(ex, ez);
          if (L < 0.05) continue;
          let best: { Q: Plane; dist: number } | null = null;
          let beyond: { Q: Plane; dist: number } | null = null;
          for (const Q of walls) {
            if (Math.abs((ex * Q.n[0] + ez * Q.n[2]) / L) > 0.02) continue;       // runs along the wall
            const da = Q.n[0] * a[0] + Q.n[2] * a[2] - Q.d, db = Q.n[0] * b[0] + Q.n[2] * b[2] - Q.d;
            if (Math.abs(da - db) > 0.01) continue;
            const dist = -(da + db) / 2;                                          // > 0: inside the exterior face
            if (dist <= EPS || dist > 0.5) continue;
            if (a[1] < Q.y[0] - 0.3 || a[1] > Q.y[1] + 0.3) continue;              // the wall stands at this level
            const sa = Q.th[0] * a[0] + Q.th[1] * a[2], sb = Q.th[0] * b[0] + Q.th[1] * b[2];
            if (Math.min(Math.max(sa, sb), Q.s[1]) - Math.max(Math.min(sa, sb), Q.s[0]) <= EPS) continue;
            if (dist > Q.thicknessM + EPS) { if (!beyond || dist < beyond.dist) beyond = { Q, dist }; continue; }
            if (!best || dist < best.dist) best = { Q, dist };
          }
          if (!best) {
            if (beyond && rep.floorEdgesBeyond.length < 8) {
              rep.floorEdgesBeyond.push({ floorId: F.elementId, wallId: beyond.Q.elementId, distM: beyond.dist, lenM: L });
            }
            continue;
          }
          // extend only: the moved edge must lie OUTSIDE the slab as it is
          const mx = (a[0] + b[0]) / 2 + best.Q.n[0] * best.dist * 1.001;
          const mz = (a[2] + b[2]) / 2 + best.Q.n[2] * best.dist * 1.001;
          if (inRing([mx, mz], ring2)) continue;
          for (const v of [a, b]) {
            const mv = moves.get(v) ?? { dx: 0, dz: 0 };
            const dx = best.Q.n[0] * best.dist, dz = best.Q.n[2] * best.dist;
            if (Math.abs(dx) > Math.abs(mv.dx)) mv.dx = dx;
            if (Math.abs(dz) > Math.abs(mv.dz)) mv.dz = dz;
            moves.set(v, mv);
          }
          rep.floorEdgesToWall++;
          rep.floorEdgeLenM += L;
        }
        for (const [v, mv] of moves) { v[0] += mv.dx; v[2] += mv.dz; }
      }
    }
    for (const q of planes) {
      if (q.vertical) continue;
      planOf.set(q, q.faces[0]!.outer.map((p): V2 => [p[0], p[2]]));
    }
  }

  // ── the pass: every boundary chain onto the line of the plane that bounds it
  //
  //    INTERIOR WALLS REACH THE EXTERIOR WALL'S PLANE TOO. A partition is kept
  //    at its midplane and the exterior wall at its outer face, but the file
  //    draws the partition's end at the exterior wall's INNER face — so the
  //    collapse leaves a slot one exterior-wall thickness deep at every such
  //    end, and the zone behind it is open there. The same one model, s phase
  //    only, Q restricted to exterior walls (user, 2026-09-02).
  const partitions = planes.filter((p) => p.category === "interiorWall" && p.vertical);
  rep.partitions = partitions.length;
  for (const P of [...movable, ...partitions]) {
    const partition = P.category === "interiorWall";
    for (const f of P.faces) {
      // s and y are INDEPENDENT in this frame: a corner fixes s, a roof fixes
      // y, and a top-of-wall corner vertex needs both. Treating a vertex as
      // belonging to one chain only left every wall end unable to reach its
      // roof. Do s first — the roof's line is y = f(s), so it must be
      // evaluated at the vertex's FINAL s.
      //
      // But WHICH plane bounds a vertex is a fact about where the file put it,
      // so eligibility is judged on the AUTHORED vertex and only the target is
      // taken from the moved one. See the y branch below for the defect that
      // proved it.
      const authored = f.outer.map((p) => [...p] as V3);
      // authored coordinates by vertex OBJECT, so a splice later in this pass
      // cannot misalign them
      const auOf = new Map<V3, V3>();
      f.outer.forEach((p, i) => auOf.set(p, authored[i]!));
      for (const phase of (partition ? (["s"] as const) : (["s", "y"] as const))) {
        const wantVertical = phase === "s";
        for (const f2 of [f]) {
          type Alt = { q: Plane; target: number; move: number; gone: Set<Plane> };
          const picks: Array<{ p: V3; target: number; q: Plane; move: number; b: Boundary; short: number; trim: number;
            strictQs: Array<{ q: Plane; target: number; move: number }>; alt: Alt | null }> = [];
          let bottomVerts = 0;
          const endVerts = { start: 0, end: 0 };
          for (let vi = 0; vi < f2.outer.length; vi++) {
            const p = f2.outer[vi]!;
            const au = authored[vi] ?? p;
            const sv = P.th[0] * p[0] + P.th[1] * p[2];
            const [lo, hi] = envelope(f2.outer, P.th, sv);
            // at a jog both corners share one height: ask just above and just below
            const [sLoA, sHiA] = sEnvelope(f2.outer, P.th, p[1] + 2 * EPS);
            const [sLoB, sHiB] = sEnvelope(f2.outer, P.th, p[1] - 2 * EPS);
            const atStart = Math.abs(sv - sLoA) <= EPS || Math.abs(sv - sLoB) <= EPS;
            const atEnd = Math.abs(sv - sHiA) <= EPS || Math.abs(sv - sHiB) <= EPS;
            const atTop = Math.abs(p[1] - hi) <= EPS, atBot = Math.abs(p[1] - lo) <= EPS;
            const b: Boundary | null = wantVertical
              ? (atStart ? "start" : atEnd ? "end" : null)
              : (atTop ? "top" : atBot ? "bottom" : null);
            if (!b) continue;
            if (b === "bottom") bottomVerts++;
            if (b === "start" || b === "end") endVerts[b]++;

            type Pick = { target: number; q: Plane; move: number; score: number; short: number; trim?: number; covers?: boolean; coplanar?: boolean };
            let best: Pick | null = null;
            let bestCovering: Pick | null = null;
            const strictQs: Array<{ q: Plane; target: number; move: number }> = [];
            const cands: Array<{ q: Plane; target: number; move: number; covers: boolean }> = [];
            let bestCoplanar: Pick | null = null;
            for (const Q of planes) {
              if (Q === P || Q.elementId === P.elementId) continue;
              if (partition && Q.category !== "exteriorWall") continue;
              if (!wantVertical && Q.vertical && b === "top" && Q.category === "exteriorWall") {
                // A COPLANAR WALL ABOVE. The Basement west wall stops at 11.366
                // under the stair landing; the Great-room west wall stands in
                // the SAME plane from 11.633 up, 0.267 m higher, with nothing
                // in the file between them — a rim the model never drew. No
                // intersection line exists between coplanar faces, so this is
                // its own case: a top short of a coplanar wall's bottom by less
                // than the wall's own thickness, the gap empty, rises to it,
                // and the two faces weld into one. The user tried to close it
                // by hand and the tool refused it as "parallel" (2026-09-02).
                if (dot(Q.n, P.n) < 0.999 || Math.abs(Q.d - P.d) > 0.02) continue;
                const gap = Q.y[0] - au[1];
                if (gap <= EPS || gap > P.thicknessM + EPS) continue;
                const toP = (sq: number): number =>
                  P.th[0] * (Q.nh[0] * Q.c + Q.th[0] * sq) + P.th[1] * (Q.nh[1] * Q.c + Q.th[1] * sq);
                const q0 = Math.min(toP(Q.s[0]), toP(Q.s[1])), q1 = Math.max(toP(Q.s[0]), toP(Q.s[1]));
                if (sv < q0 - EPS || sv > q1 + EPS) continue;        // Q must be above THIS run
                const sIn = sv - P.s[0] < P.s[1] - sv
                  ? Math.min(sv + P.thicknessM, P.s[1]) : Math.max(sv - P.thicknessM, P.s[0]);
                const xi = P.nh[0] * P.c + P.th[0] * sIn, zi = P.nh[1] * P.c + P.th[1] * sIn;
                if (occupied(xi, zi, au[1], Q.y[0], P.elementId, Q.elementId)) continue;
                if (!bestCoplanar || gap < bestCoplanar.move) {
                  bestCoplanar = { target: Q.y[0], q: Q, move: gap, score: gap, short: 0, coplanar: true };
                }
                continue;
              }
              if (Q.vertical !== wantVertical) continue;
              const L = lineOf(P, Q);
              if (!L) continue;
              if (wantVertical) {
                if (Math.abs(L.A) < 1e-9) continue;
                // Q MUST BE THERE AT THIS VERTEX'S HEIGHT. Two walls that merely
                // share some height are not enough: the elevator east wall's
                // north end sits on the MER wall at z −13.562, which starts at
                // y 9.14, while the pit band below it belongs to the low pit
                // wall 22 mm away — and "share height" let the MER wall win the
                // pit vertices with a zero move, leaving a 22 mm slot (user,
                // 2026-09-02). A wall covering the vertex outright is preferred
                // over one covering it only within the join envelope (the west
                // wall stands 13 cm lower than the north wall's top and must
                // still take that corner).
                // they must share height, or they are different storeys. Asking
                // this per VERTEX instead — so the elevator pit band could take
                // the low pit wall 22 mm away rather than the MER wall that ends
                // above it — was measured three ways and regressed the model
                // every time (the strict form: matched −15 m, leak +28 m; the
                // narrow form: leak +6 m and the pit vertex unmoved). The 22 mm
                // slot stays a wall-QA item, closable by one ledger extension
                // (2026-09-02).
                if (Math.min(P.y[1], Q.y[1]) - Math.max(P.y[0], Q.y[0]) <= EPS) continue;
                const target = (L.C - L.B * p[1]) / L.A;
                const move = Math.abs(target - sv);
                if (move > P.thicknessM + Q.thicknessM + EPS) continue;
                // does Q reach this vertex's own height? Two neighbours can
                // stand 0.225 m apart on the same corner line at different
                // storeys — the Garage's thin north wall under the Studio's —
                // and "nearest wins" left the Studio's west wall ending at the
                // garage wall, open for the 2.8 m above it (user, 2026-09-02)
                const covers = p[1] >= Q.y[0] - EPS && p[1] <= Q.y[1] + EPS;
                // Q must ACTUALLY be there: the crossing inside its run, or at
                // its own end within the same join envelope. Without this a
                // wall gets pulled to a plane whose surface is metres away.
                const x = P.nh[0] * P.c + P.th[0] * target, z = P.nh[1] * P.c + P.th[1] * target;
                const sq = Q.th[0] * x + Q.th[1] * z;
                const inside = sq > Q.s[0] - EPS && sq < Q.s[1] + EPS;
                const atQEnd = Math.min(Math.abs(sq - Q.s[0]), Math.abs(sq - Q.s[1]))
                  <= P.thicknessM + Q.thicknessM + EPS;
                if (!inside && !atQEnd) continue;
                if (covers) strictQs.push({ q: Q, target, move });
                cands.push({ q: Q, target, move, covers });
                if (!best || move < best.move) best = { target, q: Q, move, score: move, short: 0, covers };
                if (covers && (!bestCovering || move < bestCovering.move)) {
                  bestCovering = { target, q: Q, move, score: move, short: 0, covers };
                }
              } else {
                if (Math.abs(L.B) < 1e-9) continue;
                // ELIGIBILITY ON THE AUTHORED VERTEX, TARGET ON THE MOVED ONE.
                // The s phase has already slid this vertex along the wall, and
                // under a pitch that slide changes the lift the roof asks for
                // (0.667 m per metre of run on #80667). Bed 1's east wall
                // needed 0.390 m at the vertex the file authored — exactly the
                // roof's own thickness, the vertex sitting 0.5 mm off the
                // soffit — and 0.512 m after a 0.184 m corner move, so the band
                // bound refused it and that wall's south top never reached the
                // roof while its north top and its apex both did (2026-09-01).
                // Two independent corrections were being charged to one budget.
                const sa = P.th[0] * au[0] + P.th[1] * au[2];
                const aim = (L.C - L.A * sa) / L.B;
                const move = Math.abs(aim - au[1]);
                const band = Q.thicknessM / Math.max(1e-6, Math.abs(Q.n[1]));
                const plan = planOf.get(Q);
                // coverage is asked where the vertex ENDS UP (sv, after the
                // corner move), the lift where the file put it (sa): #1764730's
                // west top authored 0.184 m short of its corner sat just outside
                // the corridor roof whose edge is that very corner line
                const x = P.nh[0] * P.c + P.th[0] * sv, z = P.nh[1] * P.c + P.th[1] * sv;
                if (!plan || !inRing([x, z], plan)) continue;
                let short = 0;
                if (move > band + EPS) {
                  // THE WALL STOPS SHORT OF THE SOFFIT. Measured on this file:
                  // 32 refused wall tops have nothing above them, but they are
                  // two populations — fourteen sit 3–19 cm under their roof
                  // (nominal-height walls never attached to it; 0.123 m recurs
                  // on wall after wall under #80667 and #12686), eighteen sit
                  // 0.45–6.5 m under a higher roof's eave or an open storey.
                  // Emptiness alone would extend garage knee walls six metres
                  // into the air. The two are separated by the wall's OWN
                  // thickness — a bound the file states, the same family as the
                  // corner join envelope — with emptiness kept as the safety
                  // (user, 2026-09-02).
                  if (b !== "top" || Q.category !== "roof") continue;
                  short = (aim - band) - au[1];
                  if (short <= EPS || short > P.thicknessM + EPS) continue;
                  // test the gap a wall-thickness in from the vertex, so a
                  // corner neighbour's end does not read as "above"
                  const sIn = sv - P.s[0] < P.s[1] - sv
                    ? Math.min(sv + P.thicknessM, P.s[1]) : Math.max(sv - P.thicknessM, P.s[0]);
                  const xi = P.nh[0] * P.c + P.th[0] * sIn, zi = P.nh[1] * P.c + P.th[1] * sIn;
                  if (occupied(xi, zi, au[1], aim - band, P.elementId, Q.elementId)) continue;
                }
                // extend only — with ONE exception: a wall bottom that runs down
                // INSIDE a floor slab (below its kept top surface by no more than
                // the slab's own thickness) trims UP to that surface. The elevator
                // east wall runs to the pit slab's underside at 8.839; the slab's
                // top is 8.941 and it is 0.102 thick. The wall's lowest 0.102 m is
                // concrete inside concrete, not envelope; the mirror of the roof
                // band, counted separately (user, 2026-09-02).
                const ext = (aim - au[1]) * (b === "top" ? 1 : -1);
                let trim = 0;
                if (ext <= EPS) {
                  if (b !== "bottom" || Q.category !== "floor" || -ext > band + EPS || -ext <= EPS) continue;
                  // THE SLAB MUST CONTINUE PAST THE WALL'S OUTER FACE. Once the
                  // floor-edge pass put every slab edge ON its wall's plane, a
                  // wall bottom corner sat exactly on the slab's outline and
                  // "inside the slab" became a parity coin toss: the corridor
                  // west wall #12137 [Great] lost ONE bottom corner, 0.457 m up
                  // into the framed floor #1930248, and read as a diagonal with
                  // the rim band gone (user, 2026-09-02). A floor the wall
                  // BOUNDS is not a slab the wall STANDS IN: the pit slab runs
                  // on beyond the elevator wall's face; the Main floor stops at
                  // the corridor wall. Asked 2 cm beyond the wall's own solid.
                  const mode = P.faces[0]?.mode;
                  const beyond = (mode === "M" ? P.thicknessM / 2 : mode === "I" ? P.thicknessM : 0) + 0.02;
                  if (!inRing([x + P.nh[0] * beyond, z + P.nh[1] * beyond], plan)) continue;
                  trim = -ext;
                }
                const target = (L.C - L.A * sv) / L.B;
                // A roof is chosen by ATTACHMENT, not by the smallest lift: the
                // roof whose soffit the authored top sits at is the one the
                // wall was cut to. Two roofs pass over the south end of the
                // Laundry east wall; its top sits 4 cm off the main roof's
                // soffit and 33 cm off the corridor roof's, and smallest-lift
                // took the corridor roof, 0.24 m too low (2026-09-02).
                const score = Q.category === "roof" ? Math.abs(au[1] - (aim - band)) : move;
                if (!best || score < best.score) best = { target, q: Q, move, score, short, trim };
              }
            }
            // A WALL END DOES NOT STOP INSIDE ANOTHER EXTERIOR WALL'S SOLID. The
            // garage's west knee wall #1760725 ended at the thin garage-door
            // wall's plane — nearest, move zero, covering — 0.228 m short of the
            // concrete foundation wall #12444 whose face is the envelope there,
            // and that stopping point lies INSIDE the concrete. The lower
            // north-west corner stood open with the foundation wall's end edge
            // meeting nothing (user, 2026-09-02). A candidate plane whose point
            // on this wall's line lies within another candidate's solid — its
            // thickness, its run, its height, all read from the file — is not
            // where a wall ends; that other wall's plane is, PROVIDED nothing
            // stands beyond it (the double-wall clusters around the elevator and
            // the MER have "exterior" faces with another wall behind them, and
            // pushing ends through those regressed the model, measured: leak
            // +17 m). Decided below for the WHOLE END, never per vertex: one
            // corner through the concrete and the other not is a diagonal.
            let alt: Alt | null = null;
            if (wantVertical && cands.length > 1) {
              const gone = new Set<Plane>();
              for (const a of cands) {
                const ax = P.nh[0] * P.c + P.th[0] * a.target, az = P.nh[1] * P.c + P.th[1] * a.target;
                for (const c of cands) {
                  const K = c.q;
                  if (K === a.q || K.category !== "exteriorWall") continue;
                  const sd = K.nh[0] * ax + K.nh[1] * az - K.c;
                  const mode = K.faces[0]?.mode;
                  const inSolid = mode === "M" ? Math.abs(sd) > EPS && Math.abs(sd) <= K.thicknessM / 2 + 0.02
                    : mode === "I" ? sd > EPS && sd <= K.thicknessM + 0.02
                    : sd < -EPS && sd >= -K.thicknessM - 0.02;
                  if (!inSolid) continue;
                  const sk = K.th[0] * ax + K.th[1] * az;
                  if (sk < K.s[0] - EPS || sk > K.s[1] + EPS) continue;
                  if (p[1] < K.y[0] - EPS || p[1] > K.y[1] + EPS) continue;
                  // nothing beyond K's plane, on the side the end travels toward
                  const kx = P.nh[0] * P.c + P.th[0] * c.target, kz = P.nh[1] * P.c + P.th[1] * c.target;
                  const dir = Math.sign(K.nh[0] * (kx - ax) + K.nh[1] * (kz - az)) || 1;
                  if (occupied(kx + dir * K.nh[0] * 0.02, kz + dir * K.nh[1] * 0.02, p[1] - 0.05, p[1] + 0.05, P.elementId, K.elementId)) continue;
                  gone.add(a.q);
                }
              }
              if (gone.size > 0 && gone.size < cands.length) {
                const keep = cands.filter((c) => !gone.has(c.q));
                let nb: typeof keep[number] | null = null;
                for (const c of keep) if (c.covers && (!nb || c.move < nb.move)) nb = c;
                if (!nb) for (const c of keep) if (!nb || c.move < nb.move) nb = c;
                alt = { q: nb!.q, target: nb!.target, move: nb!.move, gone };
              }
            }
            // a neighbour that covers the vertex's height beats a nearer one
            // that does not — but ONLY then. Measured as a general preference
            // it regressed the model; measured as this exception with the
            // step below, it closes the corners it was meant to.
            if (best && wantVertical && !best.covers && bestCovering) best = bestCovering;
            if (bestCoplanar) best = bestCoplanar;          // the wall continues in its own plane
            if (!best) { if (partition) rep.partitionEndsLeft++; else rep.beyondBound++; continue; }
            if (best.coplanar) rep.reachedCoplanar++;
            if (best.short > 0) {
              rep.reachedShort++;
              if (!rep.shortSample.some((x) => x.elementId === P.elementId)) {
                rep.shortSample.push({ elementId: P.elementId, shortM: best.short, roofId: best.q.elementId });
              }
            }
            picks.push({ p, target: best.target, q: best.q, move: best.move, b, short: best.short, trim: best.trim ?? 0, strictQs, alt });
          }
          // the redirect above, applied only when EVERY vertex of the end has
          // the same wall to go through to
          if (wantVertical) {
            for (const bnd of ["start", "end"] as const) {
              const group = picks.filter((pk) => pk.b === bnd);
              if (group.length === 0 || group.length < endVerts[bnd]) continue;
              const K = group[0]!.alt?.q;
              if (!K || !group.every((pk) => pk.alt && pk.alt.q === K)) continue;
              for (const pk of group) {
                const a = pk.alt!;
                if (pk.q !== a.q) {
                  rep.endsThroughSolid++;
                  if (rep.endsThroughSolidSample.length < 24) {
                    rep.endsThroughSolidSample.push({ elementId: P.elementId, fromId: pk.q.elementId, toId: a.q.elementId, moveM: a.move });
                  }
                }
                pk.q = a.q; pk.target = a.target; pk.move = a.move;
                pk.strictQs = pk.strictQs.filter((x) => !a.gone.has(x.q));
              }
            }
          }
          // A BOTTOM EDGE IS TRIMMED AS ONE THING OR NOT AT ALL. One corner up
          // and the other left makes a diagonal the file never drew — the same
          // partial-chain artifact the hand tool and the end step both paid for.
          if (!wantVertical) {
            const trims = picks.filter((pk) => pk.trim > 0);
            if (trims.length > 0 && (trims.length < bottomVerts || new Set(trims.map((t) => t.q)).size > 1)) {
              for (const t of trims) picks.splice(picks.indexOf(t), 1);
              rep.trimPartialRefused += trims.length;
            }
          }
          // ONE NEIGHBOUR FOR THE WHOLE END when one can. The garage foundation
          // wall's east end had the MER wall covering all of it at 0.562 and
          // the thin garage wall covering its top metre at 0.435; nearest-wins
          // sent the top metre to the garage wall and stepped the end, 127 mm
          // inside the face the rest of it reached (user, 2026-09-02). Among
          // neighbours that cover EVERY vertex of an end, the one with the
          // smallest worst move takes them all; the step remains for ends no
          // single neighbour covers.
          if (wantVertical) {
            for (const bnd of ["start", "end"] as const) {
              const group = picks.filter((pk) => pk.b === bnd);
              if (group.length < 2) continue;
              const common = group[0]!.strictQs.map((x) => x.q)
                .filter((q) => group.every((pk) => pk.strictQs.some((x) => x.q === q)));
              if (common.length === 0) continue;
              let bestQ: Plane | null = null, bestWorst = Infinity;
              for (const q of common) {
                const worst = Math.max(...group.map((pk) => pk.strictQs.find((x) => x.q === q)!.move));
                if (worst < bestWorst) { bestWorst = worst; bestQ = q; }
              }
              if (!bestQ) continue;
              for (const pk of group) {
                const x = pk.strictQs.find((c) => c.q === bestQ)!;
                pk.q = bestQ; pk.target = x.target; pk.move = x.move;
              }
            }
          }
          if (picks.length > 1 && new Set(picks.map((x) => x.q.key)).size > 1) rep.banded++;
          for (const pk of picks) {
            if (!wantVertical && pk.b === "top") {
              // A TOP VERTEX THAT ALSO ENDS A NOTCH IS SPLIT, NOT MOVED. The
              // Laundry east wall's south corner ends its top edge AND the
              // sloped edge where the corridor roof cuts the face. Lifting it
              // to the main roof rotated that notch edge off the corridor roof
              // and opened a wedge (user, 2026-09-02). The vertex-union rule
              // again: two boundaries meeting at one vertex with different
              // homes get two vertices. A vertical end edge just gets taller;
              // a raked top's own vertices all lift together; only an edge to a
              // vertex that is NOT on the top chain is a notch.
              const vi = f2.outer.indexOf(pk.p);
              if (vi >= 0) {
                const sp = P.th[0] * pk.p[0] + P.th[1] * pk.p[2];
                for (const dir of [-1, 1]) {
                  const nbI = (vi + dir + f2.outer.length) % f2.outer.length;
                  const nb = f2.outer[nbI]!;
                  const nbAu = auOf.get(nb) ?? nb;
                  // ONE FRAME PER TEST. "Same plan point" compares the two
                  // vertices as they are NOW — the s phase slid the bottom
                  // corner along with the top one, and comparing the top's
                  // current s against the bottom's authored s read every
                  // moved corner as a notch: 33 splits, 4 of them real
                  // (2026-09-02). "On the top chain" is asked entirely in the
                  // authored frame.
                  const snNow = P.th[0] * nb[0] + P.th[1] * nb[2];
                  if (Math.abs(snNow - sp) <= 1e-4) continue;             // vertical end edge
                  const snAu = P.th[0] * nbAu[0] + P.th[1] * nbAu[2];
                  if (Math.abs(nbAu[1] - envelope(authored, P.th, snAu)[1]) <= EPS) continue;   // top chain
                  // THE CORNER GOES WHERE THE TWO ROOF LINES MEET. The notch edge
                  // is the lower roof cutting the wall; the top edge is the upper
                  // roof. The wall's exposed strip between them ends where the
                  // lower roof's top line, followed along its slope, meets the
                  // upper roof's — P ∩ Q1 ∩ Q2, three planes the file states.
                  // The Laundry east wall: notch onto the corridor roof's top,
                  // corner at (−9.790, 16.091), 0.36 m past the authored tip
                  // (user, 2026-09-02). The split below is only the fallback
                  // when no roof carries the notch.
                  let placed = false;
                  let Q1: Plane | null = null, L1: { A: number; B: number; C: number } | null = null;
                  let lift1 = Infinity;
                  for (const Q of planes) {
                    if (Q === P || Q.vertical || Q.category !== "roof" || Q === pk.q) continue;
                    const plan1 = planOf.get(Q);
                    if (!plan1 || !inRing([nb[0], nb[2]], plan1)) continue;
                    const L = lineOf(P, Q);
                    if (!L || Math.abs(L.B) < 1e-9) continue;
                    const lift = (L.C - L.A * snNow) / L.B - nb[1];
                    const band1 = Q.thicknessM / Math.max(1e-6, Math.abs(Q.n[1]));
                    if (lift < -EPS || lift > band1 + EPS) continue;     // the notch sits in Q's own band
                    if (lift < lift1) { lift1 = lift; Q1 = Q; L1 = L; }
                  }
                  const L2 = lineOf(P, pk.q);
                  if (Q1 && L1 && L2) {
                    const det = L1.A * L2.B - L2.A * L1.B;
                    if (Math.abs(det) > 1e-9) {
                      const sJ = (L1.C * L2.B - L2.C * L1.B) / det;
                      const yJ = (L1.A * L2.C - L2.A * L1.C) / det;
                      const xJ = P.nh[0] * P.c + P.th[0] * sJ, zJ = P.nh[1] * P.c + P.th[1] * sJ;
                      const plan1 = planOf.get(Q1), plan2 = planOf.get(pk.q);
                      if (plan1 && plan2 && inRing([xJ, zJ], plan1) && inRing([xJ, zJ], plan2)) {
                        pk.p[0] = xJ; pk.p[2] = zJ; pk.target = yJ;      // y is applied below
                        nb[1] = (L1.C - L1.A * snNow) / L1.B;             // the notch onto its roof
                        rep.notchJunctions++;
                        placed = true;
                      }
                    }
                  }
                  if (!placed) {
                    const keep: V3 = [pk.p[0], pk.p[1], pk.p[2]];
                    f2.outer.splice(dir === 1 ? vi + 1 : vi, 0, keep);
                    rep.notchSplits++;
                  }
                  break;
                }
              }
            }
            if (wantVertical) {
              // AN END MAY NOT MOVE PAST THE RING'S OTHER SIDE AT ITS OWN HEIGHT.
              // The far end of the whole wall is not the bound: near a gable
              // peak #12020 narrows to a 12 cm column, and its east end there,
              // sent to a neighbour's plane 2 cm west of the column's west side,
              // was dragged through the face and folded the ring (2026-09-02).
              const [oLoA, oHiA] = sEnvelope(f2.outer, P.th, pk.p[1] + 2 * EPS);
              const [oLoB, oHiB] = sEnvelope(f2.outer, P.th, pk.p[1] - 2 * EPS);
              const far = pk.b === "start"
                ? Math.min(Number.isFinite(oHiA) ? oHiA : Infinity, Number.isFinite(oHiB) ? oHiB : Infinity)
                : Math.max(Number.isFinite(oLoA) ? oLoA : -Infinity, Number.isFinite(oLoB) ? oLoB : -Infinity);
              const crosses = pk.b === "start" ? pk.target >= far - EPS : pk.target <= far + EPS;
              if (crosses) { rep.degenerate++; continue; }
              pk.p[0] = P.nh[0] * P.c + P.th[0] * pk.target;
              pk.p[2] = P.nh[1] * P.c + P.th[1] * pk.target;
            } else {
              pk.p[1] = pk.target;
            }
            const cat = pk.q.category;
            if (pk.trim > 0) {
              rep.trimmedIntoFloor++;
              const au = auOf.get(pk.p) ?? pk.p;
              rep.trimSample.push({ elementId: P.elementId, floorId: pk.q.elementId, liftM: pk.trim, at: [au[0], au[1], au[2]] });
            }
            if (partition) {
              if (pk.move <= EPS) rep.partitionEndsAlready++;
              else rep.partitionEnds++;
              rep.partitionMoves.push({ elementId: P.elementId, wallId: pk.q.elementId, moveM: pk.move, wallThicknessM: pk.q.thicknessM });
            }
            else if (cat === "roof") rep.movedToRoof++;
            else if (cat === "floor") rep.movedToFloor++;
            else rep.movedToWall++;
            if (pk.move > rep.maxMoveM) rep.maxMoveM = pk.move;
            rep.largest.push({ elementId: P.elementId, boundary: pk.b, moveM: pk.move, toCategory: cat });
          }
          // AN END WHOSE NEIGHBOUR CHANGES WITH HEIGHT. When two vertices of one
          // end edge went to different planes, the edge between them would run
          // DIAGONALLY between the two — the partial-chain artifact that made
          // the general height preference regress the model. The neighbour's
          // own limit says where the change is: a step is inserted there, one
          // vertex on each plane, so the end is closed against both walls and
          // no invented diagonal remains (2026-09-02).
          if (wantVertical) {
            const done = new Set<V3>();
            for (const pk of picks) {
              if (done.has(pk.p)) continue;
              const vi = f2.outer.indexOf(pk.p);
              if (vi < 0) continue;
              for (const dir of [-1, 1]) {
                const nbI = (vi + dir + f2.outer.length) % f2.outer.length;
                const nb = f2.outer[nbI]!;
                const other = picks.find((x) => x.p === nb);
                if (!other || other.q === pk.q || Math.abs(other.target - pk.target) <= 1e-4) continue;
                const up = pk.p[1] > nb[1] ? pk : other, lo = pk.p[1] > nb[1] ? other : pk;
                const yLo = lo.p[1], yHi = up.p[1];
                const at = (sx: number, y: number): V3 =>
                  [P.nh[0] * P.c + P.th[0] * sx, y, P.nh[1] * P.c + P.th[1] * sx];
                let yb = up.q.y[0];
                if (!(yb > yLo + EPS && yb < yHi - EPS)) yb = lo.q.y[1];
                // no height strictly between the two vertices to step at: the
                // garage-door wall's authored 9 mm jog at the Studio floor
                // leaves a 1 cm slant over 1.09 m here. Two fixes were measured
                // (insert at the vertex's own height: 48 insertions, matched
                // −8 m; retarget the vertex at the limit: matched −2 m) and
                // neither earned its place. Named residue (2026-09-02).
                if (!(yb > yLo + EPS && yb < yHi - EPS)) continue;
                const onPk = at(pk.target, yb), onNb = at(other.target, yb);
                f2.outer.splice(dir === 1 ? vi + 1 : vi, 0, ...(dir === 1 ? [onPk, onNb] : [onNb, onPk]));
                rep.endSteps++;
                done.add(pk.p); done.add(nb);
                break;
              }
            }
          }
          // A ROOF THAT COVERS ONLY PART OF THE TOP. When a shortfall lift takes
          // one top corner to the roof and the other corner is under a different,
          // higher roof (refused), the top edge would run DIAGONALLY between
          // them — #1764730's east end at 15.174 sloping down to 14.681 at the
          // west, which is nothing the file drew. The roof's own plan edge says
          // where its cover ends: the top is split there into a flat run on the
          // roof and a vertical step down to the authored height. Both new
          // vertices share the plan point, so they sit in the wall's plane by
          // construction (2026-09-02).
          if (!wantVertical) {
            for (const pk of picks) {
              if (pk.short <= 0 || pk.b !== "top") continue;
              const plan = planOf.get(pk.q);
              if (!plan) continue;
              const vi = f2.outer.indexOf(pk.p);
              if (vi < 0) continue;
              for (const dir of [-1, 1]) {
                const nbI = (vi + dir + f2.outer.length) % f2.outer.length;
                const nb = f2.outer[nbI]!;
                if (picks.some((x) => x.p === nb && x.q === pk.q)) continue;   // same roof: the edge lies on it
                if (inRing([nb[0], nb[2]], plan)) continue;                     // neighbour is under it too
                if (Math.hypot(nb[0] - pk.p[0], nb[2] - pk.p[2]) < EPS) continue;   // a corner, not a top edge
                let t0 = 0, t1 = 1;
                for (let it = 0; it < 24; it++) {
                  const tm = (t0 + t1) / 2;
                  const mx = pk.p[0] + (nb[0] - pk.p[0]) * tm, mz = pk.p[2] + (nb[2] - pk.p[2]) * tm;
                  if (inRing([mx, mz], plan)) t0 = tm; else t1 = tm;
                }
                const bx = pk.p[0] + (nb[0] - pk.p[0]) * t0, bz = pk.p[2] + (nb[2] - pk.p[2]) * t0;
                const yRoof = (pk.q.d - pk.q.n[0] * bx - pk.q.n[2] * bz) / pk.q.n[1];
                const sb = P.th[0] * bx + P.th[1] * bz;
                const yLow = envelope(authored, P.th, sb)[1];
                if (!Number.isFinite(yLow) || yRoof - yLow <= EPS) continue;
                const onRoof: V3 = [bx, yRoof, bz], low: V3 = [bx, yLow, bz];
                // walking from pk.p toward nb: roof point first, then the step down
                const at = dir === 1 ? vi + 1 : vi;
                f2.outer.splice(at, 0, ...(dir === 1 ? [onRoof, low] : [low, onRoof]));
                rep.roofEdgeSteps++;
              }
            }
          }
        }
        // the plane's run has moved; later phases must see the new extent
        let a0 = Infinity, a1 = -Infinity;
        for (const g of P.faces) for (const p of g.outer) {
          const t = P.th[0] * p[0] + P.th[1] * p[2];
          if (t < a0) a0 = t; if (t > a1) a1 = t;
        }
        P.s = [a0, a1];
      }
    }
    // the plane's extent has moved; keep it current for the next chain
    let s0 = Infinity, s1 = -Infinity;
    for (const f of P.faces) for (const p of f.outer) {
      const t = P.th[0] * p[0] + P.th[1] * p[2];
      if (t < s0) s0 = t; if (t > s1) s1 = t;
    }
    P.s = [s0, s1];
  }

  // ── "keep": close the step with the strip between the two walls. Its four
  //    corners are the two walls' own vertices, so it matches both by
  //    construction — better than re-deriving the authored band, which would
  //    share vertices with neither.
  for (const { step, lower, upper } of stepPairs) {
    if ((decisions.get(step.key) ?? "keep") !== "keep") continue;
    // s is measured in each plane's OWN frame, and two stacked walls very often
    // face OPPOSITE ways — 10 of the 18 steps in the development model did, a basement wall
    // showing its south face under a storey wall showing its north one. Their
    // th axes then run backwards to each other, so comparing the two s ranges
    // directly is comparing mirrored coordinates: it emitted no strip at all
    // for 8 of the 18, and placed the rest mirrored about the origin — which is
    // why the Bed 1 / foundation step was ruled on and still never closed
    // (2026-09-01). Work the whole strip in the LOWER plane's frame.
    const toLower = (sv: number): number =>
      lower.th[0] * (upper.nh[0] * upper.c + upper.th[0] * sv) +
      lower.th[1] * (upper.nh[1] * upper.c + upper.th[1] * sv);
    const ua = toLower(upper.s[0]), ub = toLower(upper.s[1]);
    const s0 = Math.max(lower.s[0], Math.min(ua, ub));
    const s1 = Math.min(lower.s[1], Math.max(ua, ub));
    if (s1 - s0 <= EPS) continue;
    const y = step.atHeightM;
    // the run axis is the lower plane's; only the perpendicular offset differs
    const pt = (pl: Plane, sv: number): V3 =>
      [pl.nh[0] * pl.c + lower.th[0] * sv, y, pl.nh[1] * pl.c + lower.th[1] * sv];
    const ring = [pt(lower, s0), pt(lower, s1), pt(upper, s1), pt(upper, s0)];
    const band: IdfFaceOut = {
      elementId: lower.elementId, category: lower.category, mode: lower.faces[0]!.mode,
      n: [0, 1, 0], areaM2: 0, rgba: lower.faces[0]!.rgba,
      outer: ring, holes: [], thicknessM: step.offsetM, source: "pair",
    };
    band.areaM2 = faceArea(band);
    if (band.areaM2 > EPS) { out.push(band); rep.bandsEmitted++; }
  }

  // ── VERTEX UNION — what turns a contact into a MATCH ─────────────────────
  //    Two chains that merely lie on the same line still produce two different
  //    edges unless they share every vertex. So at each plan point where two
  //    or more wall planes end, take the UNION of their heights and give every
  //    one of them a vertex at each. Insertion subdivides an edge; it never
  //    moves a vertex, so it is shape-preserving and safe on interior walls
  //    the brief says must not be touched.
  {
    const key = (x: number, z: number): string =>
      `${Math.round(x / EPS)}|${Math.round(z / EPS)}`;
    interface Site { planes: Set<Plane>; ys: number[] }
    const sites = new Map<string, Site>();
    const vertical = planes.filter((p) => p.vertical);
    for (const P of vertical) {
      for (const f of P.faces) for (const p of f.outer) {
        const t = P.th[0] * p[0] + P.th[1] * p[2];
        if (Math.abs(t - P.s[0]) > EPS && Math.abs(t - P.s[1]) > EPS) continue;
        const k = key(p[0], p[2]);
        let site = sites.get(k);
        if (!site) { site = { planes: new Set(), ys: [] }; sites.set(k, site); }
        site.planes.add(P);
        site.ys.push(p[1]);
      }
    }
    for (const [k, site] of sites) {
      if (site.planes.size < 2) continue;
      const ys = [...site.ys].sort((a, b) => a - b)
        .filter((y, i, arr) => i === 0 || y - arr[i - 1]! > EPS);
      if (ys.length < 3) continue;                 // nothing to share
      for (const P of site.planes) {
        for (const f of P.faces) {
          const ring = f.outer;
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
            if (key(a[0], a[2]) !== k || key(b[0], b[2]) !== k) continue;
            const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
            const mid = ys.filter((y) => y > lo + EPS && y < hi - EPS);
            if (mid.length === 0) continue;
            const asc = a[1] < b[1];
            const ins = (asc ? mid : [...mid].reverse())
              .map((y): V3 => [a[0], y, a[2]]);
            ring.splice(i + 1, 0, ...ins);
            rep.verticesInserted += ins.length;
            i += ins.length;
          }
        }
      }
    }
  }

  for (const f of out) f.areaM2 = faceArea(f);
  rep.largest.sort((a, b) => b.moveM - a.moveM);
  rep.largest = rep.largest.slice(0, 10);
  return { out, report: rep };
}

/** `name` labels an element the way the FILE names it (its IfcSpace names) —
 *  a step is reported to the user as "Bed 1", never as an express id alone. */
export function formatMatch(r: MatchReport, name: (id: number) => string = () => ""): string[] {
  return [
    `  VERTEX MATCH — ${r.planes} planes, ${r.movable} movable (exterior wall)`,
    `    onto a neighbour's intersection line: ${r.movedToWall} to a wall · ` +
      `${r.movedToRoof} to a roof · ${r.movedToFloor} to a floor · largest ${r.maxMoveM.toFixed(3)} m`,
    `    vertices inserted so two chains share every one: ${r.verticesInserted}`,
    `    chains bounded by more than one neighbour: ${r.banded} · ` +
      `refused (beyond the bound the file states) ${r.beyondBound} · degenerate ${r.degenerate}`,
    `    wall bottoms inside a floor slab, trimmed up to its top surface: ${r.trimmedIntoFloor}` +
      (r.trimSample.length ? ` (${r.trimSample.map((t) => `#${t.elementId}${name(t.elementId)} at (${t.at[0].toFixed(3)}, ${t.at[1].toFixed(3)}, ${t.at[2].toFixed(3)}) +${t.liftM.toFixed(3)} into floor #${t.floorId}`).join("; ")})` : "") + ` · partial trims refused ${r.trimPartialRefused} · ` +
      `end edges stepped where the neighbour changes with height: ${r.endSteps} · ` +
      `tops raised to a coplanar wall's bottom: ${r.reachedCoplanar}`,
    `    wall ends redirected past a plane lying inside another exterior wall's solid: ${r.endsThroughSolid}` +
      (r.endsThroughSolidSample.length
        ? ` — ` + r.endsThroughSolidSample.map((x) => `#${x.elementId}${name(x.elementId)} from #${x.fromId} to #${x.toId} (${x.moveM.toFixed(3)} m)`).join(" · ")
        : ""),
    `    interior wall ends taken to the exterior wall's plane: ${r.partitionEnds} vertices on ${new Set(r.partitionMoves.map((m) => m.elementId)).size} of ${r.partitions} partitions` +
      ` · ${r.partitionEndsAlready} already on it · ${r.partitionEndsLeft} end vertices with no exterior wall in reach` +
      (r.partitionMoves.length
        ? ` · moves: ` + (() => {
            const h = new Map<string, number>();
            for (const m of r.partitionMoves) { const k = m.moveM.toFixed(3); h.set(k, (h.get(k) ?? 0) + 1); }
            return [...h].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} m ×${n}`).join(", ");
          })()
        : ""),
    `    floor edges moved out to the wall standing on them: ${r.floorEdgesToWall} (${r.floorEdgeLenM.toFixed(1)} m)` +
      (r.floorEdgesBeyond.length
        ? ` · left, short by more than the wall's thickness: ` + r.floorEdgesBeyond
            .map((x) => `floor #${x.floorId} → #${x.wallId}${name(x.wallId)} ${x.distM.toFixed(3)} m (${x.lenM.toFixed(1)} m)`).join(" · ")
        : ""),
    `    wall tops short of a roof soffit by less than their own thickness, gap empty, taken to the roof: ` +
      `${r.reachedShort} vertices on ${r.shortSample.length} walls (${r.roofEdgeSteps} tops stepped at the roof's edge · notch corners: ${r.notchJunctions} to the two roofs' junction, ${r.notchSplits} split)` +
      (r.shortSample.length ? ` — ${r.shortSample.map((x) => `#${x.elementId}${name(x.elementId)} ${x.shortM.toFixed(3)} m`).join(" · ")}` : ""),
    `    storey steps (parallel planes, offset — the USER rules on these): ${r.steps.length} · ` +
      `${r.stepsKept} kept (${r.bandsEmitted} connecting strips emitted) · ${r.stepsAligned} aligned`,
    ...r.steps.map((s) =>
      `      #${s.lowerId}${name(s.lowerId)} under #${s.upperId}${name(s.upperId)} · ` +
      `offset ${s.offsetM.toFixed(3)} m at y ${s.atHeightM.toFixed(2)}`),
    `    10 largest moves:`,
    ...r.largest.map((l) =>
      `      ${l.moveM.toFixed(3)} m  ${l.boundary.padEnd(6)} → ${l.toCategory.padEnd(13)} el #${l.elementId}`),
  ];
}
