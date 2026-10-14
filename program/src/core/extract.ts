// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ONE ALGORITHM (see ../../references/architecture.md): per element,
// merge coplanar triangles into face polygons (outer loop + hole loops) and
// report an AREA IDENTITY the caller can gate on. This module derives
// nothing else and repairs nothing: when a bucket's boundary won't walk into
// clean loops, its triangles are emitted verbatim as `tri-fallback` faces —
// the identity holds by construction and the defect stays VISIBLE as a
// fallback share, never silently "fixed".
//
// Pure TypeScript, no DOM, no three.js — runs identically in the renderer
// and in the developers' command-line test gates.

export interface ElementInput {
  /** stable per-file id (web-ifc expressID) */
  expressId: number;
  /** parts as web-ifc streams them: transform ALREADY APPLIED, metres */
  parts: Array<{ rgba: number; positions: Float64Array; indices: Uint32Array }>;
}

export interface FaceOut {
  expressId: number;
  rgba: number;
  /** unit normal */
  n: [number, number, number];
  /** net area (outer minus holes), m² */
  areaM2: number;
  /** [x,y,z][] metres, outer ring, wound CCW about n */
  outer: Array<[number, number, number]>;
  holes: Array<Array<[number, number, number]>>;
  /** "merged" | "tri-fallback" */
  source: "merged" | "tri-fallback";
}

export interface ExtractStats {
  elements: number;
  faces: number;
  mergedFaces: number;
  fallbackFaces: number;
  triangles: number;
  /** Σ triangle area, m² — the ground truth side of the identity */
  triAreaM2: number;
  /** Σ face net area, m² — must equal triAreaM2 within tolerance */
  faceAreaM2: number;
  fallbackAreaM2: number;
  /** worst per-element relative identity error */
  worstElementDelta: number;
  worstElementId: number;
}

const WELD = 1e-4;      // 0.1 mm vertex weld
const NQ = 1e-3;        // normal quantisation for plane bucketing
const DQ = 5e-4;        // 0.5 mm plane-offset quantisation
const AREA_EPS = 1e-10; // degenerate triangle cutoff (m²·2)

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** orthonormal basis (u,v) perpendicular to n */
export function basis(n: V3): { u: V3; v: V3 } {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0 = cross(a, n);
  const ul = len(u0) || 1;
  const u: V3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v = cross(n, u);
  return { u, v };
}

/** shoelace signed area of a ring given in (u,v) coords */
function ringArea2D(pts: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function pointInRing(pt: [number, number], ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function extractElement(el: ElementInput, out: FaceOut[], stats: ExtractStats): void {
  stats.elements++;
  // group parts by rgba, weld vertices within a colour group so coplanar
  // parts of one finish merge, differently-painted ones stay distinct
  const byColor = new Map<number, Array<{ positions: Float64Array; indices: Uint32Array }>>();
  for (const p of el.parts) {
    const arr = byColor.get(p.rgba) ?? [];
    arr.push({ positions: p.positions, indices: p.indices });
    byColor.set(p.rgba, arr);
  }

  let elTriArea = 0;
  let elFaceArea = 0;

  for (const [rgba, parts] of byColor) {
    // ── weld ──────────────────────────────────────────────────────────
    const verts: V3[] = [];
    const vmap = new Map<string, number>();
    const tris: Array<[number, number, number]> = [];
    for (const part of parts) {
      const remap = new Map<number, number>();
      const P = part.positions;
      const idx = part.indices;
      const localVert = (li: number): number => {
        const got = remap.get(li);
        if (got !== undefined) return got;
        const x = P[li * 3]!, y = P[li * 3 + 1]!, z = P[li * 3 + 2]!;
        const key = `${Math.round(x / WELD)}|${Math.round(y / WELD)}|${Math.round(z / WELD)}`;
        let gi = vmap.get(key);
        if (gi === undefined) {
          gi = verts.length;
          verts.push([x, y, z]);
          vmap.set(key, gi);
        }
        remap.set(li, gi);
        return gi;
      };
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = localVert(idx[t]!), b = localVert(idx[t + 1]!), c = localVert(idx[t + 2]!);
        if (a === b || b === c || a === c) continue;
        tris.push([a, b, c]);
      }
    }

    // ── plane buckets ─────────────────────────────────────────────────
    interface Bucket { n: V3; tris: Array<[number, number, number]>; area: number }
    const buckets = new Map<string, Bucket>();
    for (const tri of tris) {
      const [a, b, c] = tri;
      const pa = verts[a]!, pb = verts[b]!, pc = verts[c]!;
      const nr = cross(sub(pb, pa), sub(pc, pa));
      const nl = len(nr);
      if (nl / 2 < AREA_EPS) continue; // degenerate
      const n: V3 = [nr[0] / nl, nr[1] / nl, nr[2] / nl];
      const d = dot(n, pa);
      const key =
        `${Math.round(n[0] / NQ)}|${Math.round(n[1] / NQ)}|${Math.round(n[2] / NQ)}|${Math.round(d / DQ)}`;
      let bk = buckets.get(key);
      if (!bk) { bk = { n, tris: [], area: 0 }; buckets.set(key, bk); }
      bk.tris.push(tri);
      bk.area += nl / 2;
      stats.triangles++;
      stats.triAreaM2 += nl / 2;
      elTriArea += nl / 2;
    }

    // ── per bucket: boundary walk → loops, or verbatim fallback ───────
    for (const bk of buckets.values()) {
      const emitFallback = (): void => {
        for (const [a, b, c] of bk.tris) {
          const ring = [verts[a]!, verts[b]!, verts[c]!] as V3[];
          const nr = cross(sub(ring[1]!, ring[0]!), sub(ring[2]!, ring[0]!));
          const nl = len(nr) || 1;
          const area = nl / 2;
          out.push({
            expressId: el.expressId, rgba,
            n: [nr[0] / nl, nr[1] / nl, nr[2] / nl],
            areaM2: area, outer: ring.map((p) => [...p] as V3), holes: [],
            source: "tri-fallback",
          });
          stats.faces++; stats.fallbackFaces++;
          stats.faceAreaM2 += area; stats.fallbackAreaM2 += area;
          elFaceArea += area;
        }
      };

      // net directed edges: interior edges cancel against their reverse
      const net = new Map<string, number>();
      const bump = (a: number, b: number): void => {
        const rev = `${b}>${a}`;
        const rc = net.get(rev) ?? 0;
        if (rc > 0) { rc === 1 ? net.delete(rev) : net.set(rev, rc - 1); return; }
        const k = `${a}>${b}`;
        net.set(k, (net.get(k) ?? 0) + 1);
      };
      for (const [a, b, c] of bk.tris) { bump(a, b); bump(b, c); bump(c, a); }

      // multimap start → targets
      const nexts = new Map<number, number[]>();
      let edgeCount = 0;
      for (const [k, c] of net) {
        const gt = k.indexOf(">");
        const a = Number(k.slice(0, gt)), b = Number(k.slice(gt + 1));
        for (let i = 0; i < c; i++) {
          const arr = nexts.get(a) ?? [];
          arr.push(b);
          nexts.set(a, arr);
          edgeCount++;
        }
      }

      // walk loops
      const loops: number[][] = [];
      let consumed = 0;
      let stuck = false;
      while (consumed < edgeCount && !stuck) {
        let start = -1;
        for (const [a, arr] of nexts) { if (arr.length > 0) { start = a; break; } }
        if (start < 0) break;
        const loop: number[] = [start];
        let cur = start;
        for (;;) {
          const arr = nexts.get(cur);
          if (!arr || arr.length === 0) { stuck = true; break; }
          const nxt = arr.pop()!;
          consumed++;
          if (nxt === start) break;
          loop.push(nxt);
          cur = nxt;
          if (loop.length > edgeCount + 1) { stuck = true; break; }
        }
        if (stuck) break;
        if (loop.length >= 3) loops.push(loop);
      }
      if (stuck || consumed < edgeCount || loops.length === 0) { emitFallback(); continue; }

      // classify loops in the plane basis
      const { u, v } = basis(bk.n);
      const to2D = (i: number): [number, number] => {
        const p = verts[i]!;
        return [dot(p, u), dot(p, v)];
      };
      interface L2 { idx: number[]; pts2: Array<[number, number]>; area: number }
      const l2: L2[] = loops.map((idx) => {
        const pts2 = idx.map(to2D);
        return { idx, pts2, area: ringArea2D(pts2) };
      });
      const outers = l2.filter((l) => l.area > 0).sort((a, b) => b.area - a.area);
      const holes = l2.filter((l) => l.area < 0);
      if (outers.length === 0) { emitFallback(); continue; }

      // assign each hole to the smallest outer containing it
      const holeOf = new Map<L2, L2[]>();
      let orphanHole = false;
      for (const h of holes) {
        let best: L2 | null = null;
        for (const o of outers) {
          if (Math.abs(o.area) <= Math.abs(h.area)) continue;
          if (pointInRing(h.pts2[0]!, o.pts2)) {
            if (!best || Math.abs(o.area) < Math.abs(best.area)) best = o;
          }
        }
        if (!best) { orphanHole = true; break; }
        const arr = holeOf.get(best) ?? [];
        arr.push(h);
        holeOf.set(best, arr);
      }
      if (orphanHole) { emitFallback(); continue; }

      // identity check INSIDE the bucket — the no-repair rule
      let netArea = 0;
      for (const o of outers) {
        let a = o.area;
        for (const h of holeOf.get(o) ?? []) a += h.area; // hole areas negative
        netArea += a;
      }
      if (Math.abs(netArea - bk.area) > Math.max(1e-6, 0.001 * bk.area)) {
        emitFallback(); continue;
      }

      for (const o of outers) {
        let a = o.area;
        const hs = holeOf.get(o) ?? [];
        for (const h of hs) a += h.area;
        out.push({
          expressId: el.expressId, rgba, n: [...bk.n] as V3, areaM2: a,
          outer: o.idx.map((i) => [...verts[i]!] as V3),
          holes: hs.map((h) => h.idx.map((i) => [...verts[i]!] as V3)),
          source: "merged",
        });
        stats.faces++; stats.mergedFaces++;
        stats.faceAreaM2 += a;
        elFaceArea += a;
      }
    }
  }

  const delta = elTriArea > 1e-9 ? Math.abs(elFaceArea - elTriArea) / elTriArea : 0;
  if (delta > stats.worstElementDelta) {
    stats.worstElementDelta = delta;
    stats.worstElementId = el.expressId;
  }
}

export function newStats(): ExtractStats {
  return {
    elements: 0, faces: 0, mergedFaces: 0, fallbackFaces: 0,
    triangles: 0, triAreaM2: 0, faceAreaM2: 0, fallbackAreaM2: 0,
    worstElementDelta: 0, worstElementId: 0,
  };
}
