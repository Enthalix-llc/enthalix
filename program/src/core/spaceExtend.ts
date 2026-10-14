// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// EXTEND ONE SPACE'S FACE TO MEET ANOTHER SPACE'S FACE — the user's own hand,
// on the rooms.
//
// The carve cuts every surface at the rooms' OWN faces, and the rooms the file
// draws stop short of each other: at a partition by its thickness, at an
// open-plan boundary by wherever two room-separation lines happened to be
// drawn. The zone census reads every such seam as an open edge. Nothing here
// decides which seams should close — a person does, one pair of faces at a
// time, with the spaces overlay on so a click lands on a room and never on a
// wall or a floor (user, 2026-09-03).
//
// The one model, stated for a SOLID: a vertex of the moving face F also lies
// on the other faces of the same room that pass through it, and its one
// correct home is where the LINE of those faces meets the target plane Q.
//   · a room corner (F, a side, the floor): the three-plane point side ∩ floor ∩ Q;
//   · a vertex on one other face S: the point of the line S ∩ Q nearest to it;
//   · a vertex on F alone: straight out along F's normal to Q.
// Every face the vertex was on keeps it — asserted after the solve, never
// assumed — so the room stays a closed solid and every face stays planar by
// construction. F itself lands IN Q: a parallel target moves it whole across
// the gap, an oblique one gives it Q's slope, the way a cathedral room's side
// follows its roof.
//
// Refusals are reported, never invented: the face is no longer in the model;
// the target face does not reach where this face would land; a vertex whose
// faces run parallel to the target; a move that would fold a face, open the
// solid, or turn the room inside out.
//
// Ops are an ORDERED LIST replayed on every rebuild, keyed by space + face
// normal + plane offset — the same contract as the surface tool's ledger.

import pc from "polygon-clipping";
import { basis } from "./extract.js";

type V3 = [number, number, number];
type V2 = [number, number];

const NQ = 1e-3;        // normal quantisation, as everywhere in this module
const DQ = 1e-3;        // 1 mm plane-offset quantisation for the key
const ON = 1e-4;        // a vertex is ON a plane within 0.1 mm — the merge's own weld
const SAME = 2e-4;      // two ring points are one vertex within twice the weld

export interface SpaceFace { n: V3; outer: V3[]; holes: V3[][]; areaM2: number }
export interface SpaceSolid { expressId: number; faces: SpaceFace[] }

export interface SpaceExtendOp {
  /** the room face to move, as `spaceFaceKey()` makes it */
  from: string;
  /** the face to reach: another ROOM's face (`spaceFaceKey`) or an ELEMENT's own face
   *  (`surfaceTargetKey`) — a roof soffit, a wall's near side (2026-09-19) */
  to: string;
}

/** THE TARGET MAY BE AN ELEMENT'S FACE (user, 2026-09-19: "if a ceiling is removed the space is
 *  adjusted to fill that new volume"). A room whose ceiling the user deleted has nothing above it
 *  in ANOTHER ROOM to reach — the plane it belongs on is the roof's own soffit, which the file
 *  states. So a target key may name an element instead of a room; everything else — the one model,
 *  the containment test, the guards — is unchanged, because `extendFace` only ever read the target's
 *  PLANE and its OUTLINE, and an element's face has both. */
export interface SurfaceTarget { elementId: number; n: V3; outer: V3[] }

export function surfaceTargetKey(elementId: number, n: V3, d: number): string {
  const u = norm(n);
  return `surf|${elementId}|${Math.round(u[0] / NQ)}|${Math.round(u[1] / NQ)}|${Math.round(u[2] / NQ)}|${Math.round(d / DQ)}`;
}
export function parseSurfaceTargetKey(key: string): { elementId: number; n: V3; d: number } | null {
  const p = key.split("|");
  if (p.length !== 6 || p[0] !== "surf") return null;
  const v = p.slice(1).map(Number);
  if (v.some((x) => !Number.isFinite(x))) return null;
  return { elementId: v[0]!, n: [v[1]! * NQ, v[2]! * NQ, v[3]! * NQ], d: v[4]! * DQ };
}
export const isSurfaceTargetKey = (key: string): boolean => key.startsWith("surf|");

/** WHICH of an element's faces a room reaches: going along the moving face's own normal from its
 *  centre, the nearest face lying AHEAD of it. A room meets a roof's soffit, a wall's near side —
 *  never the far face, which is inside the solid. The app's click and the gate share this one rule. */
export function firstFaceReached(
  surfaces: SurfaceTarget[], elementId: number, face: { n: V3; outer: V3[] },
): string | null {
  const nP = norm(face.n), ring = face.outer;
  if (ring.length < 3) return null;
  const c: V3 = [0, 0, 0];
  for (const q of ring) { c[0] += q[0] / ring.length; c[1] += q[1] / ring.length; c[2] += q[2] / ring.length; }
  let best: { key: string; t: number } | null = null;
  for (const f of surfaces) {
    if (f.elementId !== elementId || f.outer.length < 3) continue;
    const nQ = norm(f.n), denom = dot(nQ, nP);
    if (Math.abs(denom) < 1e-6) continue;                 // parallel to the move: never reached
    const dQ = dot(nQ, f.outer[0]!);
    const t = (dQ - dot(nQ, c)) / denom;
    if (t <= 1e-4) continue;                              // behind the face, or already on it
    if (!best || t < best.t) best = { key: surfaceTargetKey(elementId, nQ, dQ), t };
  }
  return best?.key ?? null;
}

/** the element face a target key names in the CURRENT file: same element, same normal, the plane
 *  nearest the recorded offset — the same discipline `findSpaceFace` uses for a room's face */
export function findSurfaceTarget(surfaces: SurfaceTarget[], key: string): SurfaceTarget | null {
  const k = parseSurfaceTargetKey(key);
  if (!k) return null;
  const nk = (n: V3): string => norm(n).map((v) => Math.round(v / NQ)).join(",");
  const want = nk(k.n);
  let best: SurfaceTarget | null = null, bestD = Infinity;
  for (const f of surfaces) {
    if (f.elementId !== k.elementId || f.outer.length < 3 || nk(f.n) !== want) continue;
    const dd = Math.abs(dot(norm(f.n), f.outer[0]!) - k.d);
    if (dd < bestD) { bestD = dd; best = f; }
  }
  return bestD <= 1.0 ? best : null;
}

export interface SpaceExtendReport {
  applied: number;
  skipped: number;
  /** one line per operation, in order — the user's own audit trail */
  lines: string[];
  movedVertices: number;
  maxMoveM: number;
  volumeDeltaM3: number;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const same = (a: V3, b: V3): boolean =>
  Math.abs(a[0] - b[0]) <= SAME && Math.abs(a[1] - b[1]) <= SAME && Math.abs(a[2] - b[2]) <= SAME;

/** A space face is keyed by its room, its normal and its plane offset: an
 *  L-shaped room has two east faces, and the offset tells them apart. */
export function spaceFaceKey(spaceId: number, n: V3, d: number): string {
  return `${spaceId}|${Math.round(n[0] / NQ)}|${Math.round(n[1] / NQ)}|${Math.round(n[2] / NQ)}|${Math.round(d / DQ)}`;
}
export function faceKeyOf(spaceId: number, f: { n: V3; outer: V3[] }): string {
  const n = norm(f.n);
  return spaceFaceKey(spaceId, n, dot(n, f.outer[0]!));
}
export function parseSpaceFaceKey(key: string): { spaceId: number; n: V3; d: number } | null {
  const p = key.split("|").map(Number);
  if (p.length !== 5 || p.some((v) => !Number.isFinite(v))) return null;
  return { spaceId: p[0]!, n: [p[1]! * NQ, p[2]! * NQ, p[3]! * NQ], d: p[4]! * DQ };
}

/** The face a key names in the CURRENT model: same room, same normal, the
 *  plane nearest the recorded offset — an earlier op may have moved it. */
export function findSpaceFace<T extends SpaceSolid>(
  spaces: T[], key: string,
): { space: T; face: T["faces"][number]; index: number } | null {
  const k = parseSpaceFaceKey(key);
  if (!k) return null;
  const sp = spaces.find((s) => s.expressId === k.spaceId);
  if (!sp) return null;
  const nk = (n: V3): string => n.map((v) => Math.round(v / NQ)).join(",");
  const want = nk(k.n);
  let best: { space: T; face: T["faces"][number]; index: number } | null = null;
  let bestD = Infinity;
  sp.faces.forEach((f, i) => {
    const n = norm(f.n);
    if (nk(n) !== want) return;
    const dd = Math.abs(dot(n, f.outer[0]!) - k.d);
    if (dd < bestD) { bestD = dd; best = { space: sp, face: f, index: i }; }
  });
  return bestD <= 1.0 ? best : null;
}

/** how a person names a room's face: top, bottom, or its compass point on the
 *  project grid (north = −z in web-ifc's frame, as the wall QA reads it) */
export function faceWord(n: V3): string {
  const u = norm(n);
  if (Math.abs(u[1]) > 0.7) return u[1] > 0 ? "top" : "bottom";
  const deg = (Math.atan2(u[0], -u[2]) * 180) / Math.PI;
  const pt = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return pt[((Math.round(deg / 45) % 8) + 8) % 8]!;
}

function newell(ring: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n;   // length = 2 × area
}

function ringArea(ring: V3[], n: V3): number {
  const { u, v } = basis(n);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    a += dot(p, u) * dot(q, v) - dot(q, u) * dot(p, v);
  }
  return Math.abs(a / 2);
}
function faceArea(f: { n: V3; outer: V3[]; holes: V3[][] }): number {
  return ringArea(f.outer, f.n) - f.holes.reduce((t, h) => t + ringArea(h, f.n), 0);
}

/** the volume of a closed solid by the divergence theorem */
export function solidVolume(faces: Array<{ n: V3; outer: V3[]; holes: V3[][] }>): number {
  let v = 0;
  for (const f of faces) {
    if (f.outer.length < 3) continue;
    const n = norm(f.n);
    v += (dot(n, f.outer[0]!) * faceArea({ n, outer: f.outer, holes: f.holes })) / 3;
  }
  return Math.abs(v);
}

/** edges not shared by exactly two rings of the solid — 0 for a closed,
 *  cleanly merged room; the tool may not raise it */
export function solidOpenEdges(faces: Array<{ outer: V3[]; holes: V3[][] }>): number {
  const q = (p: V3): string => p.map((c) => Math.round(c / ON)).join(",");
  const count = new Map<string, number>();
  for (const f of faces) for (const ring of [f.outer, ...f.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = q(ring[i]!), b = q(ring[(i + 1) % ring.length]!);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const c of count.values()) if (c !== 2) open++;
  return open;
}

/** planar area of the intersection of two rings lying in the plane with normal n */
function overlapArea(n: V3, a: V3[], b: V3[]): number {
  const { u, v } = basis(n);
  const to2 = (r: V3[]): V2[] => r.map((p) => [dot(p, u), dot(p, v)] as V2);
  let out: ReturnType<typeof pc.intersection>;
  try { out = pc.intersection([to2(a)], [to2(b)]); } catch { return 0; }
  const area2 = (r: V2[]): number => {
    let s = 0;
    for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; s += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(s / 2);
  };
  let area = 0;
  for (const poly of out) poly.forEach((ring, k) => { area += (k === 0 ? 1 : -1) * area2(ring as V2[]); });
  return area;
}

interface Plane { n: V3; d: number }

/** the point common to three planes, or null when their normals are coplanar */
function meet3(a: Plane, b: Plane, c: Plane): V3 | null {
  const det = dot(a.n, cross(b.n, c.n));
  if (Math.abs(det) < 1e-6) return null;
  const c1 = cross(b.n, c.n), c2 = cross(c.n, a.n), c3 = cross(a.n, b.n);
  return [
    (a.d * c1[0] + b.d * c2[0] + c.d * c3[0]) / det,
    (a.d * c1[1] + b.d * c2[1] + c.d * c3[1]) / det,
    (a.d * c1[2] + b.d * c2[2] + c.d * c3[2]) / det,
  ];
}

/** the point of the line a ∩ b nearest to v */
function nearestOnLine(a: Plane, b: Plane, v: V3): V3 | null {
  const c = dot(a.n, b.n);
  const det = 1 - c * c;
  if (Math.abs(det) < 1e-9) return null;
  const ra = a.d - dot(a.n, v), rb = b.d - dot(b.n, v);
  const al = (ra - c * rb) / det, be = (rb - c * ra) / det;
  return [v[0] + al * a.n[0] + be * b.n[0], v[1] + al * a.n[1] + be * b.n[1], v[2] + al * a.n[2] + be * b.n[2]];
}

interface MoveResult {
  moved: number; maxMoveM: number; parallel: boolean; gapM: number; volumeDeltaM3: number;
}

/** One op on one room, in place. Every check happens on a scratch copy; the
 *  room is touched only when all of them pass. */
function extendFace(
  space: SpaceSolid, F: SpaceFace, G: SpaceFace,
): { ok: true; r: MoveResult } | { ok: false; reason: string } {
  const nP = norm(F.n), dP = dot(nP, F.outer[0]!);
  const nQ = norm(G.n), dQ = dot(nQ, G.outer[0]!);
  const Q: Plane = { n: nQ, d: dQ };
  const parallel = len(cross(nP, nQ)) < 1e-6;
  let gap = 0;
  if (parallel) {
    // Q's plane written along this face's own normal
    const dQonP = dot(nP, nQ) > 0 ? dQ : -dQ;
    gap = dQonP - dP;
    if (Math.abs(gap) < 1e-4) return { ok: false, reason: "this face already lies on that plane" };
  }

  // the room's planes, one per distinct plane, F and anything coplanar with
  // it excluded — a vertex leaves F's plane by definition
  const planes: Array<Plane & { face: SpaceFace }> = [];
  for (const f of space.faces) {
    if (f === F || f.outer.length < 3) continue;
    const n = norm(f.n), d = dot(n, f.outer[0]!);
    if (Math.abs(dot(n, nP)) > 1 - 1e-6) continue;
    planes.push({ n, d, face: f });
  }

  // the face's own vertices, each once
  const verts: V3[] = [];
  for (const ring of [F.outer, ...F.holes]) for (const p of ring) if (!verts.some((q) => same(p, q))) verts.push(p);

  // A ROOM'S SIDE MAY BE MORE THAN ONE FACE IN ONE PLANE (2026-09-19). Faces coplanar with F are
  // excluded from `planes` by construction — a vertex leaves F's plane, so it leaves theirs — which
  // means a vertex SHARED with one of them is dragged out of it and the neighbour tilts, silently,
  // keeping its stored normal. Measured on the Laundry, whose top is a 9-vertex face and a triangle
  // in the same plane: the triangle came out 1.21 m off its own stored normal and the room LOST
  // 3.70 m³ on an extend. Moving one of them is not a move this tool can make; it says so.
  for (const f of space.faces) {
    if (f === F || f.outer.length < 3) continue;
    const n = norm(f.n);
    if (Math.abs(dot(n, nP)) < 1 - 1e-6) continue;                       // not parallel to F
    const dOnP = dot(n, nP) > 0 ? dot(n, f.outer[0]!) : -dot(n, f.outer[0]!);
    if (Math.abs(dOnP - dP) > ON) continue;                              // parallel but elsewhere
    if (f.outer.some((q) => verts.some((v) => same(q, v)))) {
      return { ok: false, reason: `the room's ${faceWord(F.n)} side is more than one face in this plane and they share vertices — moving one would tilt the other` };
    }
  }

  const target = new Map<V3, V3>();
  let maxMove = 0;
  for (const v of verts) {
    // the planes through this vertex, deduplicated
    const through: Plane[] = [];
    for (const pl of planes) {
      if (Math.abs(dot(pl.n, v) - pl.d) > ON) continue;
      if (through.some((t) => Math.abs(dot(t.n, pl.n)) > 1 - 1e-9 && Math.abs(Math.abs(t.d) - Math.abs(pl.d)) < ON)) continue;
      through.push(pl);
    }
    // a face through the vertex that runs parallel to the target cannot keep
    // it: nothing can be on both
    for (const t of through) {
      if (len(cross(t.n, nQ)) < 1e-6) {
        const tOnQ = dot(t.n, nQ) > 0 ? t.d : -t.d;
        if (Math.abs(tOnQ - dQ) > ON) return { ok: false, reason: `a ${faceWord(t.n)} face through one of its vertices runs parallel to the target` };
      }
    }
    const usable = through.filter((t) => len(cross(t.n, nQ)) >= 1e-6);
    let home: V3 | null = null;
    if (usable.length >= 2) {
      // the best-conditioned pair with Q
      let best = 0;
      for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
        const det = Math.abs(dot(nQ, cross(usable[i]!.n, usable[j]!.n)));
        if (det > best) { best = det; home = meet3(Q, usable[i]!, usable[j]!); }
      }
    }
    if (!home && usable.length >= 1) {
      // one line to slide along: the nearest point of it
      let bestD = Infinity;
      for (const t of usable) {
        const p = nearestOnLine(Q, t, v);
        if (!p) continue;
        const d = len([p[0] - v[0], p[1] - v[1], p[2] - v[2]]);
        if (d < bestD) { bestD = d; home = p; }
      }
    }
    if (!home) {
      // on F alone: straight out along F's normal
      const denom = dot(nQ, nP);
      if (Math.abs(denom) < 1e-6) return { ok: false, reason: "the target plane runs along this face's own normal — nothing to extend to" };
      const t = (dQ - dot(nQ, v)) / denom;
      home = [v[0] + nP[0] * t, v[1] + nP[1] * t, v[2] + nP[2] * t];
    }
    // asserted, not assumed: the vertex is still on every face it was on
    for (const t of through) {
      if (Math.abs(dot(t.n, home) - t.d) > 1e-3) {
        return { ok: false, reason: `a vertex would leave the room's ${faceWord(t.n)} face (${(Math.abs(dot(t.n, home) - t.d) * 1000).toFixed(1)} mm)` };
      }
    }
    const mv = len([home[0] - v[0], home[1] - v[1], home[2] - v[2]]);
    if (mv > maxMove) maxMove = mv;
    target.set(v, home);
  }

  // THE TARGET MUST BE THERE: the moved face has to overlap the target face's
  // own outline, not merely its infinite plane (the flaw the surface tool
  // had, 2026-09-02)
  const movedOuter = F.outer.map((p) => { for (const [v, h] of target) if (same(p, v)) return h; return p; });
  const nMoved = newell(movedOuter);
  if (len(nMoved) < 2e-6) return { ok: false, reason: "the face would collapse to nothing" };
  let nNew = norm(nMoved);
  if (dot(nNew, nP) < 0) nNew = [-nNew[0], -nNew[1], -nNew[2]];
  if (dot(nNew, nP) < 1e-3) return { ok: false, reason: "the face would turn edge-on to its room" };
  if (overlapArea(nQ, movedOuter, G.outer) < 1e-4) {
    return { ok: false, reason: "the face to reach does not extend to where this face would land" };
  }

  // the scratch copy: every ring of the room with the moved vertices, and
  // every touched face still facing its own way with area left
  const scratch = space.faces.map((f) => ({
    n: f === F ? nNew : norm(f.n),
    outer: f.outer.map((p) => { for (const [v, h] of target) if (same(p, v)) return h; return p; }),
    holes: f.holes.map((h) => h.map((p) => { for (const [v, hh] of target) if (same(p, v)) return hh; return p; })),
    src: f,
  }));
  for (const f of scratch) {
    const changed = f.src === F || f.outer.some((p, i) => p !== f.src.outer[i]) || f.holes.some((h, k) => h.some((p, i) => p !== f.src.holes[k]![i]));
    if (!changed) continue;
    const nw = newell(f.outer);
    if (len(nw) < 2e-6 || dot(nw, f.n) <= 0) {
      return { ok: false, reason: `the move would fold the room's ${faceWord(f.src.n)} face` };
    }
    // PLANARITY IS ASSERTED, NOT ASSUMED (2026-09-19). Every vertex of a moved face lands on the
    // target plane by construction, but a face of four or more vertices whose corners go to DIFFERENT
    // planes can still come out twisted — measured on the Laundry, whose own solid the file leaves
    // 0.44 mm out of true and 8 edges open: the move left a face 1.2 m out of its own plane and the
    // room LOST volume. The bound is the one this module already uses for "a vertex is still on the
    // face it was on": 1 mm, plus whatever the file's own face was out by.
    const nf = norm(nw), d0 = dot(nf, f.outer[0]!);
    let off = 0;
    for (const q of f.outer) off = Math.max(off, Math.abs(dot(nf, q) - d0));
    const n0 = norm(f.src.n), was = f.src.outer.reduce((m, q) => Math.max(m, Math.abs(dot(n0, q) - dot(n0, f.src.outer[0]!))), 0);
    if (off > 1e-3 + was) {
      return { ok: false, reason: `the move would twist the room's ${faceWord(f.src.n)} face out of its own plane by ${(off * 1000).toFixed(1)} mm` };
    }
  }
  const openBefore = solidOpenEdges(space.faces), openAfter = solidOpenEdges(scratch);
  if (openAfter > openBefore) return { ok: false, reason: `the move would open the room's solid (${openAfter - openBefore} edges)` };
  const volBefore = solidVolume(space.faces), volAfter = solidVolume(scratch);
  if (volAfter < 1e-6) return { ok: false, reason: "the move would leave the room no volume" };

  // commit
  for (const f of scratch) {
    for (let i = 0; i < f.outer.length; i++) { const p = f.src.outer[i]!, q = f.outer[i]!; p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; }
    f.holes.forEach((h, k) => h.forEach((q, i) => { const p = f.src.holes[k]![i]!; p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; }));
    if (f.src === F) { F.n[0] = nNew[0]; F.n[1] = nNew[1]; F.n[2] = nNew[2]; }
    f.src.areaM2 = faceArea(f.src);
  }
  return { ok: true, r: { moved: target.size, maxMoveM: maxMove, parallel, gapM: gap, volumeDeltaM3: volAfter - volBefore } };
}

/** Replay the user's space extensions over a fresh set of rooms. `label`
 *  names a face the way the user saw it, for the audit line. */
export function applySpaceExtensions<T extends SpaceSolid>(
  spaces: T[],
  ops: SpaceExtendOp[],
  label: (key: string) => string = (k) => k,
  /** the FILE's own element faces, for an op whose target is an element rather than a room (2026-09-19) */
  surfaces: SurfaceTarget[] = [],
): { out: T[]; report: SpaceExtendReport } {
  const out = spaces.map((sp) => ({
    ...sp,
    faces: sp.faces.map((f) => ({
      ...f, n: [...f.n] as V3,
      outer: f.outer.map((p) => [...p] as V3),
      holes: f.holes.map((h) => h.map((p) => [...p] as V3)),
    })),
  })) as T[];
  const report: SpaceExtendReport = { applied: 0, skipped: 0, lines: [], movedVertices: 0, maxMoveM: 0, volumeDeltaM3: 0 };
  for (const op of ops) {
    const why = (m: string): void => { report.skipped++; report.lines.push(`✗ ${label(op.from)} → ${label(op.to)}: ${m}`); };
    const P = findSpaceFace(out, op.from);
    if (!P) { why("the space face to extend is no longer in the model"); continue; }
    let target: SpaceFace;
    if (isSurfaceTargetKey(op.to)) {
      const t = findSurfaceTarget(surfaces, op.to);
      if (!t) { why("the element face to reach is no longer in the file"); continue; }
      // only its PLANE and its OUTLINE are read; a target needs no holes and no area
      target = { n: [...t.n] as V3, outer: t.outer.map((q) => [...q] as V3), holes: [], areaM2: 0 };
    } else {
      const Q = findSpaceFace(out, op.to);
      if (!Q) { why("the space face to reach is no longer in the model"); continue; }
      if (P.space === Q.space) { why("both faces belong to the same space"); continue; }
      target = Q.face;
    }
    const res = extendFace(P.space, P.face, target);
    if (!res.ok) { why(res.reason); continue; }
    report.applied++;
    report.movedVertices += res.r.moved;
    if (res.r.maxMoveM > report.maxMoveM) report.maxMoveM = res.r.maxMoveM;
    report.volumeDeltaM3 += res.r.volumeDeltaM3;
    const dv = res.r.volumeDeltaM3;
    report.lines.push(
      `✓ ${label(op.from)} → ${label(op.to)}: ${res.r.moved} vertices, up to ${res.r.maxMoveM.toFixed(3)} m` +
      (res.r.parallel ? ` across a ${res.r.gapM.toFixed(3)} m gap` : " (oblique target)") +
      `, volume ${dv >= 0 ? "+" : "−"}${Math.abs(dv).toFixed(2)} m³`,
    );
  }
  return { out, report };
}

// ── THE INSTRUMENT: where two rooms face each other across a gap ──────────
// Every pair of anti-parallel room faces that overlap in plan within
// `maxGapM` of each other: the gap's width, the overlap's area, and whether
// the width is a wall pair thickness the file states (a partition between
// them — the cells belong at its kept plane, not at each other) or not (an
// open-plan seam, the tool's population).

export interface SpaceGap {
  a: string; b: string;
  from: string; to: string;
  faceWord: string;
  gapM: number;
  overlapM2: number;
  /** the pair thickness from the file this gap matches within 3 mm, or null */
  thicknessM: number | null;
}

export function spaceGaps(
  spaces: Array<{ expressId: number; name: string; faces: Array<{ n: V3; outer: V3[] }> }>,
  thicknesses: number[],
  maxGapM = 0.6,
): SpaceGap[] {
  const out: SpaceGap[] = [];
  const ts = [...new Set(thicknesses.filter((t) => t > 1e-3).map((t) => Math.round(t * 1e4) / 1e4))];
  for (let i = 0; i < spaces.length; i++) for (let j = 0; j < spaces.length; j++) {
    if (i === j) continue;
    const A = spaces[i]!, B = spaces[j]!;
    for (const F of A.faces) {
      if (F.outer.length < 3) continue;
      const nF = norm(F.n), dF = dot(nF, F.outer[0]!);
      for (const G of B.faces) {
        if (G.outer.length < 3) continue;
        const nG = norm(G.n);
        if (dot(nF, nG) > -0.999) continue;                   // must face each other
        const gap = -dot(nG, G.outer[0]!) - dF;               // G's plane along nF, minus F's
        if (gap < -0.02 || gap > maxGapM) continue;
        const ov = overlapArea(nF, F.outer, G.outer);
        if (ov < 0.01) continue;
        let th: number | null = null;
        for (const t of ts) if (Math.abs(gap - t) <= 3e-3 && (th === null || Math.abs(gap - t) < Math.abs(gap - th))) th = t;
        out.push({
          a: A.name, b: B.name, from: faceKeyOf(A.expressId, F), to: faceKeyOf(B.expressId, G),
          faceWord: faceWord(nF), gapM: gap, overlapM2: ov, thicknessM: th,
        });
      }
    }
  }
  // each pair once, from the room with the lower id
  const seen = new Set<string>();
  return out.filter((g) => {
    const k = [g.from, g.to].sort().join("→");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((x, y) => y.overlapM2 - x.overlapM2);
}

export function formatSpaceGaps(gaps: SpaceGap[]): string[] {
  const lines: string[] = [];
  const wall = gaps.filter((g) => g.thicknessM !== null && g.gapM > 0.02);
  const touching = gaps.filter((g) => g.gapM <= 0.02 && g.gapM >= -0.02);
  const open = gaps.filter((g) => g.thicknessM === null && g.gapM > 0.02);
  const overlapping = gaps.filter((g) => g.gapM < -0.02);
  const sum = (gs: SpaceGap[]): number => gs.reduce((t, g) => t + g.overlapM2, 0);
  lines.push(`  ROOM-TO-ROOM SEAMS (facing room faces within 0.6 m, overlap ≥ 0.01 m²): ${gaps.length} pairs · ` +
    `touching (≤ 2 cm) ${touching.length} (${sum(touching).toFixed(1)} m²) · ` +
    `a wall pair thickness apart ${wall.length} (${sum(wall).toFixed(1)} m²) · ` +
    `OPEN — no stated thickness fits ${open.length} (${sum(open).toFixed(1)} m²) · overlapping ${overlapping.length}`);
  const byWidth = new Map<string, { n: number; m2: number }>();
  for (const g of gaps) {
    if (g.gapM <= 0.02) continue;
    const k = `${(g.gapM * 1000).toFixed(0)} mm${g.thicknessM !== null ? " = wall" : ""}`;
    const r = byWidth.get(k) ?? { n: 0, m2: 0 };
    r.n++; r.m2 += g.overlapM2; byWidth.set(k, r);
  }
  const widths = [...byWidth].sort((x, y) => y[1].m2 - x[1].m2).slice(0, 10);
  lines.push(`    widths (top 10 by area): ${widths.map(([k, r]) => `${k} ×${r.n} (${r.m2.toFixed(1)} m²)`).join(" · ")}`);
  const named = open.slice(0, 10).map((g) => `${g.a} ${g.faceWord} → ${g.b} ${(g.gapM * 1000).toFixed(0)} mm over ${g.overlapM2.toFixed(1)} m²`);
  if (named.length) lines.push(`    open seams, by name: ${named.join(" · ")}`);
  return lines;
}
