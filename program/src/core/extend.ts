// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// EXTEND ONE SURFACE TO MEET ANOTHER — the user's own correction.
//
// The refusal rule says this module lets the USER decide. Every automatic
// corrective pass so far has had to be bounded by some dimension the file
// states, because the code must not guess which surfaces belong together. A
// person looking at pane 3 does not have that problem: they can see it. So
// this is the same geometry with the bound removed and a human in its place.
//
// It is the ONE model again, stated without the (s, y) wall frame so it holds
// for a roof as well as a wall:
//
//   A boundary vertex of surface P that must meet surface Q belongs on the
//   line L = P ∩ Q. L lies IN P, so moving the vertex onto it keeps the
//   vertex on P: the plane, its normal and its direction are preserved by
//   construction, exactly as in matchVertices.
//
// In P's plane, take coordinates (a, t): `a` runs along L, `t` across it, with
// t = 0 ON L and the surface's own body at t > 0. The boundary that faces L is
// the LOWER ENVELOPE of the ring in t — for each vertex, the smallest t the
// ring reaches at that a. Those vertices, and only those, move to t = 0. A
// wall's end chain, a wall's raked top, a roof's eave: all the same operation,
// because "the edge facing Q" is one idea, not three.
//
// Edits are stored as an ORDERED LIST OF OPERATIONS, not as moved coordinates,
// and replayed after every rebuild — so a step ruling or a mode change does not
// silently discard work the user did by hand (the same contract as
// step_decisions).

import { basis } from "./extract.js";

const EPS = 1e-6;
const NQ = 1e-3;          // the normal quantisation collapse.ts groups by

type V3 = [number, number, number];
type V2 = [number, number];

function inRing(pt: V2, ring: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export interface ExtendOp {
  /** surface keys, as `surfaceKey()` makes them */
  from: string;
  to: string;
}

export interface ExtendReport {
  applied: number;
  skipped: number;
  /** one line per operation, in order — the user's own audit trail */
  lines: string[];
  movedVertices: number;
  maxMoveM: number;
}

/** A surface is an element's faces sharing one plane NORMAL. Keyed on the
 *  normal rather than the full plane so an edit survives a storey-step
 *  alignment, which slides a plane along that same normal. */
export function surfaceKey(elementId: number, n: V3): string {
  return `${elementId}|${Math.round(n[0] / NQ)}|${Math.round(n[1] / NQ)}|${Math.round(n[2] / NQ)}`;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** the ring's lowest t at position a — the boundary that faces L */
function loAt(ring: Array<[number, number]>, a: number): number {
  let lo = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    if (a < Math.min(p[0], q[0]) - 1e-4 || a > Math.max(p[0], q[0]) + 1e-4) continue;
    if (Math.abs(q[0] - p[0]) < 1e-9) lo = Math.min(lo, p[1], q[1]);
    else lo = Math.min(lo, p[1] + ((a - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
  }
  return lo;
}

interface Face { elementId: number; n: V3; outer: V3[]; holes: V3[][] }

/** planar area of a face with holes, in its own plane */
function faceArea(f: Face): number {
  const { u, v } = basis(f.n);
  const ring = (r: V3[]): number => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!, q = r[(i + 1) % r.length]!;
      a += dot(p, u) * dot(q, v) - dot(q, u) * dot(p, v);
    }
    return Math.abs(a / 2);
  };
  return ring(f.outer) - f.holes.reduce((t, h) => t + ring(h), 0);
}

/** Replay the user's extensions over a fresh set of surfaces. `label` names a
 *  surface the way the user saw it, for the audit line. */
export function applyExtensions<T extends Face>(
  faces: T[],
  ops: ExtendOp[],
  label: (key: string) => string = (k) => k,
): { out: T[]; report: ExtendReport } {
  const out = faces.map((f) => ({
    ...f, n: [...f.n] as V3,
    outer: f.outer.map((p) => [...p] as V3),
    holes: f.holes.map((h) => h.map((p) => [...p] as V3)),
  }));
  const report: ExtendReport = { applied: 0, skipped: 0, lines: [], movedVertices: 0, maxMoveM: 0 };

  for (const op of ops) {
    const groups = new Map<string, T[]>();
    for (const f of out) {
      const k = surfaceKey(f.elementId, f.n);
      const a = groups.get(k);
      if (a) a.push(f); else groups.set(k, [f]);
    }
    const P = groups.get(op.from), Q = groups.get(op.to);
    const why = (m: string): void => {
      report.skipped++;
      report.lines.push(`✗ ${label(op.from)} → ${label(op.to)}: ${m}`);
    };
    if (!P || P.length === 0) { why("the surface to extend is no longer in the model"); continue; }
    if (!Q || Q.length === 0) { why("the surface to reach is no longer in the model"); continue; }

    const nP = norm(P[0]!.n), nQ = norm(Q[0]!.n);
    const dP = dot(nP, P[0]!.outer[0]!), dQ = dot(nQ, Q[0]!.outer[0]!);
    const dir0 = cross(nP, nQ);
    let dir: V3, p0: V3, m: V3;
    let coplanar = false;
    if (Math.hypot(dir0[0], dir0[1], dir0[2]) < 1e-7) {
      // PARALLEL. Only a COPLANAR wall can be reached, and then at its nearest
      // edge in the shared plane: a top rises to the bottom of the wall above
      // it, a bottom drops to the top of the wall below. The Basement west
      // wall under the stair landing and the Great-room west wall above it are
      // one plane 0.267 m apart, and the tool refused the pair as "parallel"
      // (user, 2026-09-02).
      const dQonP = dot(nP, nQ) > 0 ? dQ : -dQ;
      if (Math.abs(dQonP - dP) > 0.02 || Math.abs(nP[1]) > 0.01) {
        why("the two surfaces are parallel — they have no line of intersection"); continue;
      }
      const py = P.flatMap((f) => f.outer.map((p) => p[1])), qy = Q.flatMap((f) => f.outer.map((p) => p[1]));
      const pTop = Math.max(...py), pBot = Math.min(...py), qTop = Math.max(...qy), qBot = Math.min(...qy);
      const run: V3 = norm([-nP[2], 0, nP[0]]);              // along the wall
      if (qBot >= pTop - EPS || qTop <= pBot + EPS) {
        // above or below: a top rises to the bottom of the wall above, a bottom
        // drops to the top of the wall below
        const up = qBot >= pTop - EPS;
        dir = run;
        p0 = [dP * nP[0], up ? qBot : qTop, dP * nP[2]];
        m = up ? [0, -1, 0] : [0, 1, 0];
      } else {
        // BESIDE: the two ADU north walls stand end to end in one plane, and
        // the tool refused the pair as "overlap in height" (user, 2026-09-02).
        // The target is Q's nearest END, a vertical line in the shared plane;
        // P's end chain moves along the run to reach it.
        const ps = P.flatMap((f) => f.outer.map((p) => dot(p, run))), qs = Q.flatMap((f) => f.outer.map((p) => dot(p, run)));
        const pMin = Math.min(...ps), pMax = Math.max(...ps), qMin = Math.min(...qs), qMax = Math.max(...qs);
        let sL: number, toward: 1 | -1;
        if (qMin >= pMax - EPS) { sL = qMin; toward = 1; }
        else if (qMax <= pMin + EPS) { sL = qMax; toward = -1; }
        else { why("the two surfaces lie in one plane and overlap — nothing to extend to"); continue; }
        dir = [0, 1, 0];
        p0 = [dP * nP[0] + run[0] * sL, 0, dP * nP[2] + run[2] * sL];
        m = [-run[0] * toward, 0, -run[2] * toward];            // the body is away from Q
      }
      coplanar = true;
    } else {
      dir = norm(dir0);
      // the point of L nearest the origin: the three-plane intersection of P, Q
      // and the plane through the origin normal to L
      const det = dot(nP, cross(nQ, dir));
      const c1 = cross(nQ, dir), c2 = cross(dir, nP);
      p0 = [
        (dP * c1[0] + dQ * c2[0]) / det,
        (dP * c1[1] + dQ * c2[1]) / det,
        (dP * c1[2] + dQ * c2[2]) / det,
      ];
      // (a, t) in P's plane, oriented so the surface's own body sits at t > 0
      m = norm(cross(dir, nP));
      let cx = 0, cy = 0, cz = 0, count = 0;
      for (const f of P) for (const p of f.outer) { cx += p[0]; cy += p[1]; cz += p[2]; count++; }
      const centre: V3 = [cx / count, cy / count, cz / count];
      if (dot([centre[0] - p0[0], centre[1] - p0[1], centre[2] - p0[2]], m) < 0) {
        m = [-m[0], -m[1], -m[2]];
      }
    }
    const at = (p: V3): [number, number] => {
      const w: V3 = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
      return [dot(w, dir), dot(w, m)];
    };

    // the ring in (a, t), across every face of the surface
    const ring2: Array<[number, number]> = [];
    for (const f of P) for (const p of f.outer) ring2.push(at(p));
    let tMax = -Infinity;
    for (const r of ring2) if (r[1] > tMax) tMax = r[1];
    if (tMax <= EPS) { why("the surface already reaches past that plane"); continue; }

    // THE TARGET MUST BE THERE. L is a line in space; Q covers only part of
    // it. A vertex may move only to a point of L inside Q's own outline. The
    // Laundry wall extended to the corridor roof — which covers its south end
    // only — had its bottom-NORTH corners flung 1.6 m up the roof's line and
    // 0.9 m past the wall's end, and the carve could no longer reconcile the
    // ring (Δ 0.26 m²). The automatic solver has always had this test; the
    // hand tool now does too (2026-09-02).
    const qb = basis(nQ);
    const qRings = Q.map((f) => f.outer.map((p): V2 => [dot(p, qb.u), dot(p, qb.v)]));
    // inside Q's outline, or within the join envelope of its edge: a wall
    // end sent to a wall's own END lands exactly on that outline, and the
    // solver has always accepted a corner within the two thicknesses
    const envelope = (P[0] as unknown as { thicknessM?: number }).thicknessM ?? 0
      + ((Q[0] as unknown as { thicknessM?: number }).thicknessM ?? 0);
    const nearRing = (pt: V2, r: V2[]): number => {
      let best = Infinity;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!, b = r[(i + 1) % r.length]!;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2));
        best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)));
      }
      return best;
    };
    const onQ = (p: V3): boolean => {
      const pt: V2 = [dot(p, qb.u), dot(p, qb.v)];
      return qRings.some((r) => inRing(pt, r) || nearRing(pt, r) <= envelope + EPS);
    };

    // THE CHAIN MOVES WHOLE, OR NOT AT ALL. Containment is decided for the
    // facing edge as one thing — Q must reach SOME of it — never vertex by
    // vertex. Per-vertex containment moved one end of the Basement north
    // wall's end edge and left the other, because the west wall it was sent
    // to stands 13 cm lower than the north wall: a triangle where an edge was
    // asked for (user, 2026-09-02). The automatic solver has always moved a
    // wall's whole end chain once the two walls share any height; this is
    // the same rule. A chain Q reaches none of — the Laundry wall's far
    // corners sent to the corridor roof — is still refused whole.
    // THE FACING EDGE IS AN EDGE, NOT A SET OF VERTICES. An edge faces L when
    // it is the nearest part of the ring over its own span (its midpoint is on
    // the envelope) and neither end is already past L; then BOTH its ends
    // move, each to L at its own position. Asking vertex by vertex left the
    // basement slab's inside corner behind: the slab continues west past the
    // wall line under the stair landing, so at that corner the ring's
    // envelope is the far edge, not the corner — one vertex moved, a triangle
    // (user, 2026-09-02). Edges that merely end at a moving corner shorten.
    const chain = new Map<V3, { target: V3; t: number; f: Face }>();
    let alreadyThere = 0;
    for (const f of P) {
      const r = f.outer;
      for (let i = 0; i < r.length; i++) {
        const p = r[i]!, q = r[(i + 1) % r.length]!;
        const [ap, tp] = at(p), [aq, tq] = at(q);
        if (tp <= EPS || tq <= EPS) { alreadyThere++; continue; }   // on or across L
        const lo = loAt(ring2, (ap + aq) / 2);
        if (!Number.isFinite(lo) || (tp + tq) / 2 - lo > 1e-3) continue;   // something nearer
        for (const [v, t] of [[p, tp], [q, tq]] as Array<[V3, number]>) {
          chain.set(v, { target: [v[0] - m[0] * t, v[1] - m[1] * t, v[2] - m[2] * t], t, f });
        }
      }
    }
    if (chain.size === 0) {
      why(alreadyThere > 0
        ? "that edge already reaches the plane — nothing to extend"
        : "no boundary of this surface faces that plane");
      continue;
    }
    // a coplanar target is reached exactly ON its edge, so the containment
    // test looks 1 mm inside it
    const reach = (t: V3): V3 => coplanar ? [t[0] - m[0] * 1e-3, t[1] - m[1] * 1e-3, t[2] - m[2] * 1e-3] : t;
    if (![...chain.values()].some((c) => onQ(reach(c.target)))) {
      why(`the surface to reach does not extend to where this edge would meet it (${chain.size} vertices)`);
      continue;
    }
    let worst = 0;
    const touched = new Set<Face>();
    for (const [v, c] of chain) {
      v[0] = c.target[0]; v[1] = c.target[1]; v[2] = c.target[2];
      touched.add(c.f);
      if (c.t > worst) worst = c.t;
    }
    // the stored area is part of the contract: a moved ring carries its own
    for (const f of touched) (f as unknown as { areaM2: number }).areaM2 = faceArea(f);
    report.applied++;
    report.movedVertices += chain.size;
    if (worst > report.maxMoveM) report.maxMoveM = worst;
    report.lines.push(
      `✓ ${label(op.from)} → ${label(op.to)}: ${chain.size} vertices, up to ${worst.toFixed(3)} m`,
    );
  }
  return { out, report };
}
