// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// TIE EVERY IDF SURFACE TO ONE SPACE.
//
// EnergyPlus does not have surfaces that belong to several zones; it has one
// surface per zone boundary. the development model collapses to 204 surfaces of which
// **129 (1,901 m², 77% of the model) touch more than one room** — one basement
// slab touches 22 of them. Until those are carved, idf.db is a shell, not a
// zone model, and no downstream BEM can read it.
//
// The carve is READ, never derived. An IfcSpace is a solid in the file, and
// the face of that solid lying against a surface IS the room's share of it:
//
//   segment(P, S) = P ∩ (the faces of S that lie on P's plane)
//
// Nothing is guessed about where a room ends — the file already drew it. What
// is left over after every adjacent room has taken its share is emitted with
// no space, so a surface bounding nothing outside (a soffit, a parapet) stays
// visible in the census instead of vanishing.
//
// A SURFACE HAS TWO SIDES, and both are asked. An interior wall separates two
// rooms; a storey slab is the ceiling of the room below and the floor of the
// room above. Intersecting with every adjacent room and emitting each result
// counts that shared area TWICE — measured: Σ segments came to 379.0 m² for a
// 205.8 m² slab, an identity error of 580 m² over the model (2026-09-01). The
// surface is therefore partitioned by the COMMON REFINEMENT of the two sides:
// each segment carries the room behind it (against −n) and the room it faces
// (along +n), either of which may be nothing. One plane, one partition, both
// zones named — which is what an inter-zone IDF surface needs, and what
// IfcRelSpaceBoundary itself says.
//
// This also settles the side question the local-mass centroid kept getting
// wrong: the room that claims a side is on that side, as a fact.
//
// The 2-D boolean is `polygon-clipping` (MIT). Robust polygon booleans with
// holes are a classic bug farm and the one place here where a library is
// cheaper than the mass it saves — the user ruled on that trade explicitly
// (2026-09-01).

import polygonClipping from "polygon-clipping";
import { basis } from "./extract.js";
import type { IdfFaceOut } from "./collapse.js";

type V3 = [number, number, number];
type Ring2 = Array<[number, number]>;

/** how far off a surface's plane a room's face may sit and still be its
 *  boundary: the thickest pair gap in the file, not a tuned distance */
const SLAB_M = 0.65;
/** how far behind a room's top or bottom face a plane may lie and still be claimed — a room drawn into a slab */
const BEHIND_M = 0.1;
const PARALLEL = 0.99;
const MIN_AREA = 1e-3;      // 10 cm² — below this a sliver is clipper noise
/** a poly whose effective width (2·area/perimeter) is under a centimetre is
 *  a hairline: a real overlap in the file — Basement grazes 7 mm of a
 *  Great-room wall — but a room boundary that close to a wall is the room
 *  misdrawn, not a surface. Absorbed into the segment it touches (see below);
 *  never dropped, which was measured to open seams.
 *
 *  This is a JUDGMENT CONSTANT, stated as one. Reading it from the file was
 *  tried — "the thinnest paired wall" — and this file has a 3 mm wall pair, so
 *  the read bound absorbed nothing and left 78 standalone patches. It is a
 *  representability floor below every construction tolerance, and it is not
 *  to be tuned against the census (principles.md #9). */
const SLIVER_W = 0.01;

export interface SpaceVolume {
  name: string;
  colorIndex: number;
  faces: Array<{ n: V3; outer: V3[] }>;
}

export interface SplitReport {
  surfacesIn: number;
  surfacesOut: number;
  /** surfaces that were touched by more than one room and had to be carved */
  carved: number;
  assignedAreaM2: number;
  /** area no room claimed on either side — reported, never dropped */
  unassignedAreaM2: number;
  /** surfaces with a room on BOTH sides: an inter-zone boundary */
  interZone: number;
  /** area two rooms on the same side both claimed — the file's own room solids
   *  overlapping. Awarded to the first, counted here, never hidden. */
  roomOverlapM2: number;
  /** vertices inserted so a segment edge shares every vertex its neighbours
   *  have on it — what turns a carved contact into a MATCH */
  tJunctionsHealed: number;
  /** hairline polys (width < SLIVER_W) unioned into the neighbouring segment
   *  they touch — a room grazing a surface in a millimetre band cannot stand
   *  as a zone surface, and removing it outright opens a seam */
  sliverCount: number;
  sliverAreaM2: number;
  /** the hairline bound used (SLIVER_W) */
  sliverWidthM: number;
  /** faces conform() revealed as two regions joined by a zero-width bridge,
   *  split after the fact — see reclean() */
  bridgesSplit: number;
  /** |Σ segments − Σ parents| : the identity this pass must hold */
  areaDeltaM2: number;
  bySpace: Array<{ name: string; surfaces: number; areaM2: number }>;
  /** parents whose segments do not sum back, worst first */
  worst: Array<{ elementId: number; parentM2: number; sumM2: number }>;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function mpArea(mp: unknown): number {
  let a = 0;
  for (const poly of (mp as Ring2[][] | null) ?? []) {
    const rings = poly ?? [];
    a += ringArea(open(rings[0] ?? []));
    for (const h of rings.slice(1)) a -= ringArea(open(h));
  }
  return a;
}

function ringArea(r: Ring2): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

/** polygon-clipping closes its rings; a stored loop does not repeat its start */
const open = (r: Ring2): Ring2 =>
  r.length > 1 && Math.abs(r[0]![0] - r[r.length - 1]![0]) < 1e-12
    && Math.abs(r[0]![1] - r[r.length - 1]![1]) < 1e-12
    ? r.slice(0, -1) : r;

/** The clipper's rings sometimes fold back on themselves. Three shapes, each
 *  met in this file: a single-vertex SPIKE (out and back along one line); a
 *  REVERSAL (out along a line and back over the same line, the return leg a
 *  different length — face 51 of #1567472 went out 4.78 m and came back
 *  2.85 cm past its start); and a BRIDGE — two real regions joined by a
 *  zero-width line traversed up and back, the ghost of an absorbed sliver
 *  that once connected them (face 153 of #12068: a band and a 0.37 × 2 m
 *  patch, 2.9 m apart). Zero area every time, so the identity never saw
 *  them; but below the weld a doubled run reads as ONE line shared three and
 *  four times — that was the whole "3+ shared 161 m" census (2026-09-02).
 *
 *  A ring is PINCHED wherever two non-adjacent vertices sit within the weld.
 *  Of the two loops a pinch makes, one with no area is cut out; if BOTH have
 *  area the ring is two polygons and is split, each cleaned again. Nothing
 *  below the weld is distinguishable by any instrument here, so nothing
 *  observable is lost. Returns the rings largest first. */
const WELD = 1e-4;          // openEdges' weld, the file's precision
export function cleanRing(r: Ring2): Ring2[] {
  let ring = r;
  for (let pass = 0; pass < 64; pass++) {
    if (ring.length < 3) return [];
    let changed = false;
    const next: Ring2 = [];
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const cur = ring[i]!, nxt = ring[(i + 1) % ring.length]!;
      const dup = Math.hypot(cur[0] - nxt[0], cur[1] - nxt[1]) < WELD;
      const spike = Math.hypot(prev[0] - nxt[0], prev[1] - nxt[1]) < WELD;
      const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
      const bx = nxt[0] - cur[0], by = nxt[1] - cur[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      const reversal = la > WELD && lb > WELD &&
        ax * bx + ay * by < -0.999999 * la * lb &&
        Math.abs(ax * by - ay * bx) < WELD * Math.max(la, lb);
      if (dup || spike || reversal) { changed = true; continue; }
      next.push(cur);
    }
    ring = next;
    if (changed) continue;
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;        // neighbours across the wrap
        const p = ring[i]!, q = ring[j]!;
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= WELD) continue;
        const inner = ring.slice(i, j + 1);
        const rest = [...ring.slice(j), ...ring.slice(0, i + 1)];
        const ai = ringArea(inner), ar = ringArea(rest);
        if (ai < MIN_AREA) { ring = [...ring.slice(0, i + 1), ...ring.slice(j + 1)]; changed = true; }
        else if (ar < MIN_AREA) { ring = inner; changed = true; }
        else {
          return [...cleanRing(inner), ...cleanRing(rest)]
            .sort((x, y) => ringArea(y) - ringArea(x));
        }
        break;
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return ring.length >= 3 ? [ring] : [];
}

/** One clipper polygon → one or more stored faces. A bridged ring (see
 *  cleanRing) is two polygons: it is split and the clipper hands each part
 *  the holes that are its own. Returns the area stored. */
function emitPoly(
  tpl: IdfFaceOut,
  poly: Ring2[],
  to3: (p: [number, number]) => V3,
  attrs: { space: string | null; spaceFacing: string | null; spaceColorIndex: number },
  out: IdfFaceOut[],
  depth = 0,
): number {
  const outers = cleanRing(open(poly[0] ?? []));
  if (outers.length === 0) return 0;
  if (outers.length > 1 && depth < 3) {
    let area = 0;
    for (const o of outers) {
      try {
        const sub = polygonClipping.intersection([[o]] as never, [poly] as never) as Ring2[][];
        for (const sp of sub) area += emitPoly(tpl, sp, to3, attrs, out, depth + 1);
      } catch { /* a part the clipper cannot take is dropped, not invented */ }
    }
    return area;
  }
  const outer = outers[0]!;
  const holes = poly.slice(1).flatMap((h) => cleanRing(open(h))).filter((h) => h.length >= 3);
  const a = ringArea(outer) - holes.reduce((t, h) => t + ringArea(h), 0);
  if (a < MIN_AREA) return 0;
  const dedupe = (ring: V3[]): V3[] =>
    ring.filter((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= WELD;
    });
  out.push({
    ...tpl,
    areaM2: a,
    outer: dedupe(outer.map(to3)),
    holes: holes.map((h) => dedupe(h.map(to3))).filter((h) => h.length >= 3),
    ...attrs,
  });
  return a;
}

/** The clipper can close a ring with one long edge running straight back OVER
 *  two of its own earlier vertices — no coincident vertices, so nothing to
 *  pinch at emit time. conform() then inserts the face's own vertices into
 *  that edge and the bridge appears fully formed (face 153 of #12068,
 *  2026-09-02). So the faces conform touched are cleaned once more, in their
 *  own plane; a bridged one splits. Area-preserving by construction. */
function reclean(out: IdfFaceOut[], touched: Set<IdfFaceOut>): { out: IdfFaceOut[]; split: number } {
  const res: IdfFaceOut[] = [];
  let split = 0;
  for (const f of out) {
    if (!touched.has(f)) { res.push(f); continue; }
    const { u, v } = basis(f.n);
    const dP = dot(f.n, f.outer[0]!);
    const to2 = (p: V3): [number, number] => [dot(p, u), dot(p, v)];
    const to3 = (p: [number, number]): V3 => [
      p[0] * u[0] + p[1] * v[0] + dP * f.n[0],
      p[0] * u[1] + p[1] * v[1] + dP * f.n[1],
      p[0] * u[2] + p[1] * v[2] + dP * f.n[2],
    ];
    const before = res.length;
    emitPoly(f, [f.outer.map(to2), ...f.holes.map((h) => h.map(to2))], to3,
      { space: f.space ?? null, spaceFacing: f.spaceFacing ?? null, spaceColorIndex: f.spaceColorIndex ?? -1 },
      res);
    if (res.length === before) res.push(f);          // never lose area to a cleaning failure
    else if (res.length - before > 1) split++;
  }
  return { out: res, split };
}

export function splitBySpace(
  faces: IdfFaceOut[],
  spaces: SpaceVolume[],
): { out: IdfFaceOut[]; report: SplitReport } {
  const report: SplitReport = {
    surfacesIn: 0, surfacesOut: 0, carved: 0, assignedAreaM2: 0,
    unassignedAreaM2: 0, interZone: 0, roomOverlapM2: 0, tJunctionsHealed: 0,
    sliverCount: 0, sliverAreaM2: 0, sliverWidthM: 0, bridgesSplit: 0, areaDeltaM2: 0, bySpace: [], worst: [],
  };
  const perSpace = new Map<string, { surfaces: number; areaM2: number }>();
  const out: IdfFaceOut[] = [];
  const sliverW = SLIVER_W;
  report.sliverWidthM = sliverW;

  // group by element + plane: that is one surface — and by the side of the
  // ground line, once the site terrain has cut a wall: the above- and
  // below-grade parts share a plane and must NOT be merged back into one
  // surface here (they were, and every room cell then inherited the first
  // part's `below`; the user saw the stair's ground line vanish from the
  // Basement/Storage wall, 2026-09-03)
  const groups = new Map<string, IdfFaceOut[]>();
  for (const f of faces) {
    const d = dot(f.n, f.outer[0]!);
    const key = `${f.elementId}|${f.n.map((v) => Math.round(v / 1e-3)).join(",")}|${Math.round(d / 5e-4)}|${f.grade ?? ""}`;
    const a = groups.get(key);
    if (a) a.push(f); else groups.set(key, [f]);
  }
  report.surfacesIn = groups.size;

  // A ROOM'S TOP OR BOTTOM FACE CLAIMS THE FIRST PLANE IT MEETS, REGION BY
  // REGION — not every parallel plane within reach. The reach (SLAB_M) let a
  // room's ceiling face claim its ceiling covering 4 cm above AND the floor
  // structure 40 cm above that, once ceilings entered the model, so the attic
  // over the ceiling found its top taken (2026-09-02). Candidates are taken
  // from the nearest out, each clipped in plan to what the face has not yet
  // claimed; a plane that lies over only part of the face gets only that part.
  // Horizontal faces only, against floors, roofs and ceilings: a wall face
  // still claims every parallel wall plane within reach, as measured and
  // shipped, and a storey-step strip is never a room's ceiling.
  const planXZ = (q: V3): [number, number] => [q[0], q[2]];
  const areaMP2 = (mp: Ring2[][]): number => {
    const ring = (r: Ring2): number => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
    let a = 0;
    for (const poly of mp) { const [o, ...hs] = poly; if (o) a += ring(o); for (const h of hs) a -= ring(h); }
    return a;
  };
  const groupList = [...groups.entries()].map(([key, fs]) => ({
    key, n: fs[0]!.n, dP: dot(fs[0]!.n, fs[0]!.outer[0]!), category: fs[0]!.category,
    mp: fs.map((f) => [f.outer.map(planXZ), ...f.holes.map((h) => h.map(planXZ))]) as Ring2[][],
  }));
  /** space face → (group key → the plan region it claims there) */
  const regionOf = new Map<object, Map<string, Ring2[][]>>();
  /** a room's horizontal face → whether it is the room's top (by where it is, not its normal) */
  const topOf = new Map<object, boolean>();
  for (const sp of spaces) {
  // the room's mid-height: a horizontal face above it is the room's top, below it its bottom — read from where the face IS, never
  // from its normal, which a file may wind either way (the sample's hallways)
  const ys = sp.faces.flatMap((f) => f.outer.map((q) => q[1]));
  const yMid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  for (const sf of sp.faces) {
    if (Math.abs(sf.n[1]) < 0.5) continue;
    const isTop = sf.outer.reduce((t, q) => t + q[1], 0) / sf.outer.length > yMid;
    topOf.set(sf, isTop);
    // A SLOPED ceiling finish is cathedral: the room's ceiling is its roof
    // (the user's rule), so the finish is not a plane a room may claim —
    // the claim passes through it to the roof. Conveying ceilings had let
    // the finish intercept: Bed 1 claimed 0.7 m² of the main roof against
    // 32 m² of sloped finish, and 415 m² of roof faced no zone at all —
    // found by the engine's own census, not the eye (2026-09-03).
    const cands = groupList
      .filter((g) => (g.category === "floor" || g.category === "roof" || (g.category === "ceiling" && Math.abs(g.n[1]) >= 0.999)) &&
        Math.abs(dot(sf.n, g.n)) >= PARALLEL)
      .map((g) => ({ g, dist: Math.abs(dot(g.n, sf.outer[0]!) - g.dP) }))
      // OUTWARD ONLY (2026-10-16): a room's top claims what is above it, its bottom what is below — a hallway drawn through its own
      // ceiling up to the roof's underside took the ceiling 24 cm BELOW its top as the nearest plane, and the roof over it faced no
      // room. A room drawn a little into a slab still claims it: 10 cm of reach behind the face
      .filter((c) => { const p0 = sf.outer[0]!, yFace = p0[1], yPlane = (c.g.dP - c.g.n[0] * p0[0] - c.g.n[2] * p0[2]) / c.g.n[1];   /* the plane's height over the face's own point (a sloped roof too) */ return isTop ? yPlane >= yFace - BEHIND_M : yPlane <= yFace + BEHIND_M; })
      .filter((c) => c.dist <= SLAB_M)
      .sort((a, b) => a.dist - b.dist);
    // nothing outward in reach: the face claims nothing — never the old either-way reach below
    if (cands.length === 0) { regionOf.set(sf, new Map()); continue; }
    let remaining: Ring2[][] = [[sf.outer.map(planXZ)]];
    const per = new Map<string, Ring2[][]>();
    for (const c of cands) {
      if (areaMP2(remaining) < 1e-4) break;
      let hit: Ring2[][];
      try { hit = polygonClipping.intersection(remaining as never, c.g.mp as never) as Ring2[][]; } catch { continue; }
      if (areaMP2(hit) < 1e-4) continue;
      per.set(c.g.key, hit);
      try { remaining = polygonClipping.difference(remaining as never, hit as never) as Ring2[][]; } catch { break; }
    }
    regionOf.set(sf, per);
  }
  }

  for (const [gkey, fs] of groups.entries()) {
    const f0 = fs[0]!;
    const n = f0.n;
    const dP = dot(n, f0.outer[0]!);
    const { u, v } = basis(n);
    const to2 = (p: V3): [number, number] => [dot(p, u), dot(p, v)];
    const to3 = (p: [number, number]): V3 => [
      p[0] * u[0] + p[1] * v[0] + dP * n[0],
      p[0] * u[1] + p[1] * v[1] + dP * n[1],
      p[0] * u[2] + p[1] * v[2] + dP * n[2],
    ];

    const surfMP = fs.map((f) => [f.outer.map(to2), ...f.holes.map((h) => h.map(to2))]);
    const parentArea = fs.reduce((t, f) => t + f.areaM2, 0);

    // every room whose own face lies on this plane, and WHICH SIDE it is on.
    // The side is a fact, not a guess: the sign of the room's own centroid
    // against the plane.
    interface Claim { name: string; colorIndex: number; mp: Ring2[][] }
    const back: Claim[] = [];    // rooms behind the surface (against −n)
    const front: Claim[] = [];   // rooms the normal points at (+n)
    for (const sp of spaces) {
      const bRings: Ring2[][] = [], fRings: Ring2[][] = [];
      for (const sf of sp.faces) {
        if (Math.abs(dot(sf.n, n)) < PARALLEL) continue;
        if (Math.abs(dot(n, sf.outer[0]!) - dP) > SLAB_M) continue;
        const reg = regionOf.get(sf);
        if (reg) {
          // a horizontal face: only the region where THIS plane is the first met
          const mine = reg.get(gkey);
          if (!mine) continue;
          const lift = (q: [number, number]): [number, number] => to2([q[0], (dP - n[0] * q[0] - n[2] * q[1]) / n[1], q[1]]);
          for (const poly of mine) {
            const rings = poly.map((r) => r.map(lift));
            // the room is BELOW its top face and ABOVE its bottom face — behind P when P's normal points away from it
            const behind = topOf.has(sf) ? (topOf.get(sf) ? n[1] > 0 : n[1] < 0) : dot(sf.n, n) > 0;
            (behind ? bRings : fRings).push(rings as Ring2[]);
          }
          continue;
        }
        // A room solid's face normal points OUT of the room, so a contact face
        // agreeing with P's normal means the room lies BEHIND P. That is a
        // local fact about this very face. The room's centroid is not: "Great"
        // wraps around a corner and its centre lands on the far side of walls
        // it touches, which left 26 m² of surface claimed twice — the same
        // lesson the E/I centroid taught (2026-09-01).
        (dot(sf.n, n) > 0 ? bRings : fRings).push([sf.outer.map(to2)]);
      }
      if (bRings.length) back.push({ name: sp.name, colorIndex: sp.colorIndex, mp: bRings });
      if (fRings.length) front.push({ name: sp.name, colorIndex: sp.colorIndex, mp: fRings });
    }

    const emit = (
      mp: unknown, space: string | null, spaceFacing: string | null, colorIndex: number,
    ): number => {
      let area = 0;
      for (const poly of mp as Ring2[][]) {
        area += emitPoly(f0, poly, to3, { space, spaceFacing, spaceColorIndex: colorIndex }, out);
      }
      return area;
    };

    if (back.length === 0 && front.length === 0) {
      // no room on either side: keep the authored coordinates verbatim rather
      // than round-tripping them through the clipper for nothing
      for (const f of fs) out.push({ ...f, space: null, spaceFacing: null, spaceColorIndex: -1 });
      report.unassignedAreaM2 += parentArea;
      continue;
    }
    if (back.length > 0 && front.length > 0) report.interZone++;
    if (back.length + front.length > 1) report.carved++;

    /** one side's rooms as a true PARTITION of the surface: a part per room,
     *  plus whatever that side leaves over. Each room is clipped against what
     *  earlier rooms already took, because room solids in the file do overlap
     *  a little — without that they claim the same area twice and the identity
     *  drifts (18 m² across the model, worst #25068 at +5.9 m²). Which room
     *  wins an overlap is arbitrary, so the overlap is COUNTED and reported
     *  rather than hidden. */
    const partition = (claims: Claim[]): Array<{ c: Claim | null; mp: unknown }> => {
      if (claims.length === 0) return [{ c: null, mp: surfMP }];
      const parts: Array<{ c: Claim | null; mp: unknown }> = [];
      let taken: unknown = null;
      for (const c of claims) {
        try {
          let mp = polygonClipping.intersection(surfMP as never, c.mp as never) as never;
          if (taken) {
            const before = mpArea(mp);
            mp = polygonClipping.difference(mp, taken as never) as never;
            report.roomOverlapM2 += Math.max(0, before - mpArea(mp));
          }
          if (mpArea(mp) < MIN_AREA) continue;
          // union FIRST: if it throws, the claim must be skipped whole, or the
          // next room is no longer clipped against this one and the partition
          // silently overlaps
          const nowTaken = taken ? polygonClipping.union(taken as never, mp) : mp;
          parts.push({ c, mp });
          taken = nowTaken;
        } catch { /* a degenerate ring is skipped, never crashed on */ }
      }
      try {
        parts.push({
          c: null,
          mp: taken ? polygonClipping.difference(surfMP as never, taken as never) : surfMP,
        });
      } catch { /* the rooms covered it */ }
      return parts;
    };

    // the COMMON REFINEMENT of the two sides: every distinct region of the
    // surface, exactly once, naming the room behind it and the room it faces
    interface Cell { space: string | null; spaceFacing: string | null; colorIndex: number; mp: Ring2[][] }
    const cells: Cell[] = [];
    for (const a of partition(back)) {
      for (const b of partition(front)) {
        try {
          const mp = polygonClipping.intersection(a.mp as never, b.mp as never) as Ring2[][];
          if (mp.length > 0) {
            cells.push({
              space: a.c?.name ?? null, spaceFacing: b.c?.name ?? null,
              colorIndex: a.c?.colorIndex ?? b.c?.colorIndex ?? -1, mp,
            });
          }
        } catch { /* a degenerate ring is skipped */ }
      }
    }

    // HAIRLINES ARE ABSORBED, NOT KEPT AND NOT DROPPED. The file's rooms graze
    // surfaces in millimetre bands (Basement claims 7 mm of a Great-room wall,
    // 8 m long); kept, such a band's two long edges weld onto one line — the
    // whole "3+ shared 210 m" census. Dropped, its neighbours are left 3–7 mm
    // apart: measured, matched fell 113 m and leak rose 125 m. So a hairline
    // poly is UNIONED into the widest cell it touches — area conserved
    // exactly, the internal edge vanishes, and only the parent's true outline
    // remains (2026-09-01).
    const widthOf = (poly: Ring2[]): number => {
      const outer = cleanRing(open(poly[0] ?? []))[0];
      if (!outer || outer.length < 3) return 0;
      let perim = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i]!, q = outer[(i + 1) % outer.length]!;
        perim += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      const a = ringArea(outer) - poly.slice(1).reduce((t, h) => t + ringArea(open(h)), 0);
      return perim > 0 ? (2 * a) / perim : 0;
    };
    const strays: Ring2[][] = [];
    for (const c of cells) {
      const keep: Ring2[][] = [];
      for (const poly of c.mp) {
        const w = widthOf(poly);
        if (w > 0 && w < sliverW) strays.push(poly); else keep.push(poly);
      }
      c.mp = keep;
    }
    for (const poly of strays) {
      let placed = false;
      for (const c of [...cells].sort((x, y) => mpArea(y.mp) - mpArea(x.mp))) {
        if (c.mp.length === 0) continue;
        try {
          const u = polygonClipping.union(c.mp as never, [poly] as never) as Ring2[][];
          if (u.length <= c.mp.length) {           // it touched — the seam is gone
            c.mp = u; placed = true;
            report.sliverCount++; report.sliverAreaM2 += mpArea([poly]);
            break;
          }
        } catch { /* try the next neighbour */ }
      }
      // nothing touches it: keep it as its own row rather than invent a gap
      if (!placed) cells.push({ space: null, spaceFacing: null, colorIndex: -1, mp: [poly] });
    }

    let sum = 0;
    for (const c of cells) {
      const area = emit(c.mp, c.space, c.spaceFacing, c.colorIndex);
      if (area <= 0) continue;
      sum += area;
      if (c.space !== null || c.spaceFacing !== null) {
        report.assignedAreaM2 += area;
        for (const name of [c.space, c.spaceFacing]) {
          if (name === null) continue;
          const row = perSpace.get(name) ?? { surfaces: 0, areaM2: 0 };
          row.surfaces++; row.areaM2 += area;
          perSpace.set(name, row);
        }
      } else report.unassignedAreaM2 += area;
    }

    if (Math.abs(sum - parentArea) > 1e-3) {
      report.worst.push({ elementId: f0.elementId, parentM2: parentArea, sumM2: sum });
    }
    report.areaDeltaM2 += Math.abs(sum - parentArea);
  }

  const healed = conform(out);
  report.tJunctionsHealed = healed.inserted;
  const cleaned = reclean(out, healed.touched);
  report.bridgesSplit = cleaned.split;
  report.surfacesOut = cleaned.out.length;
  report.bySpace = [...perSpace].map(([name, r]) => ({ name, ...r }))
    .sort((a, b) => b.areaM2 - a.areaM2);
  report.worst.sort((a, b) => Math.abs(b.parentM2 - b.sumM2) - Math.abs(a.parentM2 - a.sumM2));
  report.worst = report.worst.slice(0, 8);
  return { out: cleaned.out, report };
}

/** THE CONFORMING PASS. Carving multiplies edges, and two segments that meet
 *  along one line still make two different edges unless they share every
 *  vertex — the same lesson matchVertices' vertex union taught. Measured
 *  before writing this: 313 edges (730.9 m) had a neighbour's vertex sitting
 *  INSIDE them, each read as leak. Every such vertex is inserted, PROJECTED
 *  onto the edge so it stays exactly in the surface's plane (the foreign
 *  vertex itself can be up to the weld tolerance off it). Insertion subdivides,
 *  never moves — area and planarity are untouched by construction. */
function conform(out: IdfFaceOut[]): { inserted: number; touched: Set<IdfFaceOut> } {
  const touched = new Set<IdfFaceOut>();
  const CELL = 0.25, TOL = 1e-4, END = 1e-3;
  const cellOf = (x: number, y: number, z: number): string =>
    `${Math.floor(x / CELL)}|${Math.floor(y / CELL)}|${Math.floor(z / CELL)}`;
  const grid = new Map<string, V3[]>();
  for (const f of out) for (const ring of [f.outer, ...f.holes]) for (const p of ring) {
    const k = cellOf(p[0], p[1], p[2]);
    const arr = grid.get(k);
    if (arr) arr.push(p); else grid.set(k, [p]);
  }
  let inserted = 0;
  for (const f of out) {
    for (const ring of [f.outer, ...f.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const L = Math.hypot(ab[0], ab[1], ab[2]);
        if (L < 2 * END) continue;
        const d: V3 = [ab[0] / L, ab[1] / L, ab[2] / L];
        const hits: number[] = [];
        const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
        const hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
        for (let cx = Math.floor((lo[0]! - TOL) / CELL); cx <= Math.floor((hi[0]! + TOL) / CELL); cx++)
        for (let cy = Math.floor((lo[1]! - TOL) / CELL); cy <= Math.floor((hi[1]! + TOL) / CELL); cy++)
        for (let cz = Math.floor((lo[2]! - TOL) / CELL); cz <= Math.floor((hi[2]! + TOL) / CELL); cz++) {
          for (const v of grid.get(`${cx}|${cy}|${cz}`) ?? []) {
            const w: V3 = [v[0] - a[0], v[1] - a[1], v[2] - a[2]];
            const t = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
            if (t < END || t > L - END) continue;
            const off = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
            if (off >= TOL) continue;
            if (hits.every((h) => Math.abs(h - t) > END)) hits.push(t);
          }
        }
        if (hits.length === 0) continue;
        hits.sort((x, y) => x - y);
        const pts = hits.map((t): V3 => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]);
        ring.splice(i + 1, 0, ...pts);
        inserted += pts.length;
        touched.add(f);
        i += pts.length;   // the new sub-edges cannot hold further hits
      }
    }
  }
  return { inserted, touched };
}

export function formatSplit(r: SplitReport): string[] {
  return [
    `  PER-SPACE SPLIT — ${r.surfacesIn} surfaces → ${r.surfacesOut} zone surfaces ` +
      `(${r.carved} carved · ${r.interZone} with a room on BOTH sides)`,
    `    claimed by a room ${r.assignedAreaM2.toFixed(1)} m² · claimed by none ` +
      `${r.unassignedAreaM2.toFixed(1)} m² · rooms overlapping each other ` +
      `${r.roomOverlapM2.toFixed(2)} m² · AREA IDENTITY Δ ${r.areaDeltaM2.toFixed(4)} m²`,
    `    conforming: ${r.tJunctionsHealed} vertices inserted into neighbouring edges · ` +
      `${r.sliverCount} hairlines under ${(r.sliverWidthM * 1000).toFixed(0)} mm absorbed by a neighbour (${r.sliverAreaM2.toFixed(2)} m²) · ` +
      `${r.bridgesSplit} bridged rings split after conforming`,
    `    top rooms: ${r.bySpace.slice(0, 8)
      .map((s) => `${s.name} ${s.areaM2.toFixed(0)}m²/${s.surfaces}`).join(" · ")}`,
    ...(r.worst.length
      ? [`    parents whose segments do not sum back:`,
         ...r.worst.map((w) =>
           `      #${w.elementId} parent ${w.parentM2.toFixed(3)} vs Σ ${w.sumM2.toFixed(3)} m²`)]
      : [`    every parent's segments sum back to it`]),
  ];
}
