// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE OPEN-EDGE GATE (principles.md #4: the instrument BEFORE the fix, and
// never one that moves under the fix it measures).
//
// TWO numbers, because they answer two different questions and a single one
// would be a proxy (principles.md #12 — the discriminating measurement):
//
//   unmatched  an edge no OTHER surface's edge duplicates. This is the IDF /
//              EnergyPlus requirement: vertex-matched surfaces.
//   leak       an unmatched edge that is not even in CONTACT with another
//              surface — nothing on the far side within the weld. A wall top
//              lifted onto the roof plane stops being a leak (it lies in the
//              roof polygon) while staying unmatched (the roof has no edge
//              there). A wall end 300 mm short of its neighbour is both.
//
// This module knows nothing about corners, roofs or the seam solver, so the
// same code reports the baseline and the result. Conservative on purpose: an
// edge counts as sealed only if ALL THREE of its sample points are sealed, so
// a partly-sealed edge is reported as a full leak — the number never
// under-states the hole.
//
// Hole rings (window/door openings) are counted separately and never folded
// into the headline: an opening is open by design, not a leak.

const WELD = 1e-4;          // 0.1 mm — extract.ts's weld, the file's precision
const VERTICAL = 0.99;      // |dy|/len above this = a vertical edge
const HORIZONTAL = 0.01;    // |dy|/len below this = a horizontal edge

type V3 = [number, number, number];
type V2 = [number, number];

export interface EdgeSurfaceIn {
  elementId: number;
  category: string;
  n: V3;
  outer: V3[];
  holes: V3[][];
}

export type EdgeBucket = "vertical" | "top" | "bottom" | "sloped";

export interface OpenEdge {
  lenM: number;
  elementId: number;
  category: string;
  bucket: EdgeBucket;
  sealed: boolean;
  a: V3;
  b: V3;
}

export interface ElementEdges {
  matchedLenM: number;
  contactLenM: number;
  leakLenM: number;
  open: OpenEdge[];         // unmatched, whether sealed or leaking
}

export interface OpenEdgeReport {
  surfaces: number;
  edges: number;
  totalLenM: number;
  matchedLenM: number;      // shared by exactly 2 surfaces — airtight, IDF-clean
  shared3LenM: number;      // shared by 3+ — reported, never "fixed"
  /** of the 3+: lines where the owners' planes DIFFER — a wall end butting
   *  into a wall exactly on a room boundary, a wall bottom on a floor cut.
   *  Three surfaces really meet there; a zone model must have such lines. */
  junctionLenM: number;
  /** of the 3+: all owners COPLANAR — one face doubled on itself, a hairline
   *  strip: degenerate, and the only 3+ that is a defect */
  coplanar3LenM: number;
  unmatchedLenM: number;
  unmatchedCount: number;
  contactLenM: number;      // unmatched but sealed against another surface
  leakLenM: number;         // THE NUMBER: unmatched AND nothing on the far side
  leakCount: number;
  byBucket: Record<EdgeBucket, number>;              // leak length
  byCategory: Record<string, { lenM: number; count: number }>;  // leak length
  openingLenM: number;      // hole-ring perimeter — open BY DESIGN
  openingRings: number;
  worst: OpenEdge[];        // 10 longest leaks, for the user's judgement
  worstAll: OpenEdge[];     // every leak, longest first — so a caller can ask
                            // "which WALL is still open?" and get an el #
  /** per element: the length in each state, and every edge that is NOT
   *  matched (sealed or not). wallQA.ts pivots this by boundary — the
   *  classification is done once, here, and never recomputed. */
  byElement: Map<number, ElementEdges>;
}

/** Vertex weld. Rounding alone is not a weld: two points 1 nm apart straddle a
 *  cell boundary and read as two vertices, which would make the instrument
 *  report a seam that is not there. Probe the 27 neighbouring cells and match
 *  on the true distance. */
class Welder {
  private cells = new Map<string, number[]>();
  private pts: V3[] = [];
  id(p: V3): number {
    const cx = Math.round(p[0] / WELD), cy = Math.round(p[1] / WELD), cz = Math.round(p[2] / WELD);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this.cells.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
      if (!arr) continue;
      for (const i of arr) {
        const q = this.pts[i]!;
        if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= WELD) return i;
      }
    }
    const id = this.pts.length;
    this.pts.push(p);
    const k = `${cx}|${cy}|${cz}`;
    const arr = this.cells.get(k);
    if (arr) arr.push(id); else this.cells.set(k, [id]);
    return id;
  }
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function basis(n: V3): { u: V3; v: V3 } {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = a[1] * n[2] - a[2] * n[1], uy = a[2] * n[0] - a[0] * n[2], uz = a[0] * n[1] - a[1] * n[0];
  const l = Math.hypot(ux, uy, uz) || 1;
  const u: V3 = [ux / l, uy / l, uz / l];
  return { u, v: [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]] };
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

interface Prepped { d: number; u: V3; v: V3; n: V3; ring: V2[]; holes: V2[][]; lo: V2; hi: V2 }

function prep(s: EdgeSurfaceIn): Prepped | null {
  const p0 = s.outer[0];
  if (!p0 || s.outer.length < 3) return null;
  const { u, v } = basis(s.n);
  const to2 = (p: V3): V2 => [dot(p, u), dot(p, v)];
  const ring = s.outer.map(to2);
  const lo: V2 = [Infinity, Infinity], hi: V2 = [-Infinity, -Infinity];
  for (const q of ring) {
    if (q[0] < lo[0]) lo[0] = q[0]; if (q[0] > hi[0]) hi[0] = q[0];
    if (q[1] < lo[1]) lo[1] = q[1]; if (q[1] > hi[1]) hi[1] = q[1];
  }
  return { d: dot(s.n, p0), u, v, n: s.n, ring, holes: s.holes.map((h) => h.map(to2)), lo, hi };
}

/** does point p lie ON surface k (its plane, inside its outer ring, not in a hole)? */
function onSurface(p: V3, k: Prepped): boolean {
  if (Math.abs(dot(k.n, p) - k.d) > WELD) return false;
  const q: V2 = [dot(p, k.u), dot(p, k.v)];
  if (q[0] < k.lo[0] - WELD || q[0] > k.hi[0] + WELD || q[1] < k.lo[1] - WELD || q[1] > k.hi[1] + WELD) return false;
  if (!inRing(q, k.ring)) return false;
  for (const h of k.holes) if (inRing(q, h)) return false;
  return true;
}

export function openEdges(surfaces: EdgeSurfaceIn[]): OpenEdgeReport {
  const prepped = surfaces.map(prep);
  const weld = new Welder();
  interface Rec { lenM: number; count: number; owner: OpenEdge; ownerIdx: number; normals: V3[] }
  const edges = new Map<string, Rec>();
  let openingLenM = 0, openingRings = 0;

  for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si]!;
    if (s.outer.length < 3) continue;
    let yMin = Infinity, yMax = -Infinity;
    for (const p of s.outer) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
    const yMid = (yMin + yMax) / 2;

    for (let i = 0; i < s.outer.length; i++) {
      const a = s.outer[i]!, b = s.outer[(i + 1) % s.outer.length]!;
      const lenM = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (lenM < WELD) continue;
      const vert = Math.abs(b[1] - a[1]) / lenM;
      const bucket: EdgeBucket =
        vert > VERTICAL ? "vertical"
        : vert < HORIZONTAL ? ((a[1] + b[1]) / 2 >= yMid ? "top" : "bottom")
        : "sloped";
      const ia = weld.id(a), ib = weld.id(b);
      const k = ia < ib ? `${ia}~${ib}` : `${ib}~${ia}`;
      const rec = edges.get(k);
      if (rec) { rec.count++; rec.normals.push(s.n); continue; }
      edges.set(k, {
        lenM, count: 1, ownerIdx: si, normals: [s.n],
        owner: { lenM, elementId: s.elementId, category: s.category, bucket, sealed: false, a, b },
      });
    }

    for (const h of s.holes) {
      openingRings++;
      for (let i = 0; i < h.length; i++) {
        const a = h[i]!, b = h[(i + 1) % h.length]!;
        openingLenM += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      }
    }
  }

  const rep: OpenEdgeReport = {
    surfaces: surfaces.length, edges: edges.size,
    totalLenM: 0, matchedLenM: 0, shared3LenM: 0, junctionLenM: 0, coplanar3LenM: 0,
    unmatchedLenM: 0, unmatchedCount: 0,
    contactLenM: 0, leakLenM: 0, leakCount: 0,
    byBucket: { vertical: 0, top: 0, bottom: 0, sloped: 0 },
    byCategory: {}, openingLenM, openingRings, worst: [], worstAll: [],
    byElement: new Map<number, ElementEdges>(),
  };
  const elRec = (id: number): ElementEdges => {
    let r = rep.byElement.get(id);
    if (!r) { r = { matchedLenM: 0, contactLenM: 0, leakLenM: 0, open: [] }; rep.byElement.set(id, r); }
    return r;
  };
  const leaks: OpenEdge[] = [];
  for (const rec of edges.values()) {
    rep.totalLenM += rec.lenM;
    if (rec.count === 2) {
      rep.matchedLenM += rec.lenM;
      elRec(rec.owner.elementId).matchedLenM += rec.lenM;
      continue;
    }
    if (rec.count > 2) {
      rep.shared3LenM += rec.lenM;
      const n0 = rec.normals[0]!;
      const coplanar = rec.normals.every((n) => Math.abs(dot(n, n0)) > 0.999);
      if (coplanar) rep.coplanar3LenM += rec.lenM; else rep.junctionLenM += rec.lenM;
      continue;
    }
    const e = rec.owner;
    rep.unmatchedLenM += rec.lenM;
    rep.unmatchedCount++;
    // sealed? every sample point must lie on SOME other surface
    const mid: V3 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
    e.sealed = [e.a, mid, e.b].every((p) =>
      prepped.some((k, ki) => k !== null && ki !== rec.ownerIdx && onSurface(p, k)));
    const er = elRec(e.elementId);
    er.open.push(e);
    if (e.sealed) { rep.contactLenM += rec.lenM; er.contactLenM += rec.lenM; continue; }
    er.leakLenM += rec.lenM;
    rep.leakLenM += rec.lenM;
    rep.leakCount++;
    rep.byBucket[e.bucket] += rec.lenM;
    const c = (rep.byCategory[e.category] ??= { lenM: 0, count: 0 });
    c.lenM += rec.lenM; c.count++;
    leaks.push(e);
  }
  leaks.sort((a, b) => b.lenM - a.lenM);
  rep.worstAll = leaks;
  rep.worst = leaks.slice(0, 10);
  return rep;
}

export function formatOpenEdges(r: OpenEdgeReport, label: string): string[] {
  const pct = (v: number): string => `${(100 * v / Math.max(1e-9, r.totalLenM)).toFixed(1)}%`;
  return [
    `  OPEN EDGES (${label}) — boundary ${r.totalLenM.toFixed(1)} m over ${r.edges} edges, ${r.surfaces} surfaces`,
    `    matched (IDF-clean) ${r.matchedLenM.toFixed(1)} m (${pct(r.matchedLenM)}) · 3+ shared ${r.shared3LenM.toFixed(1)} m ` +
      `(junction lines ${r.junctionLenM.toFixed(1)} · coplanar/degenerate ${r.coplanar3LenM.toFixed(1)})`,
    `    unmatched ......... ${r.unmatchedLenM.toFixed(1)} m / ${r.unmatchedCount} edges (${pct(r.unmatchedLenM)})` +
      `   of which in contact ${r.contactLenM.toFixed(1)} m`,
    `    LEAK .............. ${r.leakLenM.toFixed(2)} m / ${r.leakCount} edges (${pct(r.leakLenM)})`,
    `      by direction  vertical ${r.byBucket.vertical.toFixed(1)} · top ${r.byBucket.top.toFixed(1)} · ` +
      `bottom ${r.byBucket.bottom.toFixed(1)} · sloped ${r.byBucket.sloped.toFixed(1)} m`,
    `      by category   ` + (Object.entries(r.byCategory)
      .sort((a, b) => b[1].lenM - a[1].lenM)
      .map(([c, v]) => `${c} ${v.lenM.toFixed(1)} m/${v.count}`).join(" · ") || "—"),
    `    openings (by design, not leaks): ${r.openingRings} rings, ${r.openingLenM.toFixed(1)} m`,
  ];
}
