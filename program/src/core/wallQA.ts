// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WALL QA — the per-wall instrument (principles.md #10: the named object
// decides). Five rounds of pixel QC each found a real defect and every one was
// found by eye, because the census reported aggregates ("leak 2258 → 2047 m")
// while the user reports objects ("Laundry east wall, at the roof and at the
// adjoining Studio Bath wall"). This closes that gap: one row per exposed wall
// plane, named the way the FILE names it, with a verdict on each of its four
// boundaries.
//
// It reads ROWS FROM THE TWO DATABASES, not the in-memory pipeline, so a fault
// in the DB write is caught too — ifc.db and idf.db are the module contract
// and this is the comparison a downstream module would make.
//
// The join is exact, not heuristic: the shell only ever moves a vertex WITHIN
// its own surface plane (plan slides run along the wall line, vertical lifts
// stay in a vertical plane), so an idf.db wall's plane is identical to its
// source ifc.db face plane.
//
// Three extents per wall, and the differences between them are the story:
//   authored SOLID   every ifc.db face of the element — including the end, top
//                    and bottom bands the collapse drops. This is the wall's
//                    real reach, stated by the file.
//   authored FACE    the ifc.db faces on this plane — what the collapse kept.
//   idf              what is stored now, after collapse and shell.

import type { DbFaceRow } from "./db.js";
import type { OpenEdgeReport, OpenEdge } from "./openEdges.js";

const NQ = 1e-3, DQ = 5e-4;   // the plane quantisation collapse.ts groups by
const FLAT = 0.01;            // |n.y| below this = a vertical plane
const EPS = 1e-3;             // 1 mm — the file's own precision

type V3 = [number, number, number];
type V2 = [number, number];

export type Boundary = "start" | "end" | "bottom" | "top";
export type BoundaryState = "matched" | "contact" | "open";

export interface BoundaryVerdict {
  state: BoundaryState;
  /** metres of this boundary that leak (0 when matched or merely in contact) */
  openLenM: number;
  /** distance to the thing it should meet, and what that is */
  gapM: number;
  meets: string;
}

export interface WallQARow {
  elementId: number;
  /** the IfcSpace names the file gives it — "Laundry + Great" */
  spaces: string;
  /** compass point of the outward normal on the PROJECT grid — what the user
   *  reads off the drawing. `facingTrue` is the same against the file's
   *  TrueNorth, which on a rotated site is 22° away and reads NNE/ESE/SSW. */
  facing: string;
  facingTrue: string;
  /** run × height, metres */
  authoredSolid: { lengthM: number; heightM: number };
  authoredFace: { lengthM: number; heightM: number; areaM2: number };
  idf: { lengthM: number; heightM: number; areaM2: number };
  /** idf minus authored FACE, signed, per boundary (+ = extended outward) */
  delta: Record<Boundary, number>;
  /** how much run/height the collapse dropped and nothing has taken back */
  unclaimedM: { start: number; end: number };
  /** how far the wall's authored SOLID runs past its exterior FACE at each
   *  end — the corner material. If the file mitres the join this is 0; if the
   *  file stops the exterior face at the corner and fills with the end band,
   *  this is what the single-plane surface is missing. */
  cornerRunM: { start: number; end: number };
  /** the pair gap, for comparison: corner material of one thickness means the
   *  face stops at the neighbour's face rather than running through */
  thicknessM: number;
  boundaries: Record<Boundary, BoundaryVerdict>;
  /** boundaries in the `open` state — a boundary can be open with NOWHERE to
   *  meet (a wall bottom at ground level), so openness and gap are separate
   *  and the sort must not treat "open, nothing to meet" as closed */
  openCount: number;
  /** the worst open gap on this wall */
  worstGapM: number;
  /** authored face length that has gone missing from the idf surface — a
   *  narrow wall-end plane shortened to nothing shows up here as ~its whole
   *  length (found on #1765179 [Yard] and #1512686, 2026-08-31) */
  lostLengthM: number;
}

export interface WallQAReport {
  rows: WallQARow[];
  wallsClosed: number;
  /** open, with something measurably close that it ought to meet — the
   *  actionable list */
  wallsActionable: number;
  /** open with NOTHING to meet: a bottom at ground level, an eave. Reported,
   *  never counted as a defect. */
  wallsOpenToNothing: number;
  /** exposed wall planes in ifc.db that idf.db has no surface for */
  missingFromIdf: number[];
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

/** compass point of a plan direction, measured from the file's north. The
 *  handedness is fixed by one convention and validated against a wall the user
 *  has already named (see the gate) — never fudged per model. */
export function compassOf(nh: V2, north: V2 | null): string {
  if (!north) return "?";
  const dot = north[0] * nh[0] + north[1] * nh[1];
  const cross = north[0] * nh[1] - north[1] * nh[0];
  const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
  return COMPASS[((Math.round(deg / 22.5) % 16) + 16) % 16]!;
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

interface Frame { nh: V2; th: V2; c: number }
const sOf = (fr: Frame, p: V3): number => fr.th[0] * p[0] + fr.th[1] * p[2];

interface Plane { key: string; frame: Frame; rows: DbFaceRow[] }

/** group vertical faces by element + plane, exactly as collapse.ts does */
function verticalPlanes(rows: DbFaceRow[]): Map<string, Plane> {
  const out = new Map<string, Plane>();
  for (const f of rows) {
    if (Math.abs(f.n[1]) >= FLAT) continue;
    const p0 = f.outer[0];
    if (!p0) continue;
    const d = f.n[0] * p0[0] + f.n[1] * p0[1] + f.n[2] * p0[2];
    const key = `${f.elementId}|${Math.round(f.n[0] / NQ)}|${Math.round(f.n[2] / NQ)}|${Math.round(d / DQ)}`;
    const got = out.get(key);
    if (got) { got.rows.push(f); continue; }
    const hl = Math.hypot(f.n[0], f.n[2]) || 1;
    const nh: V2 = [f.n[0] / hl, f.n[2] / hl];
    out.set(key, {
      key,
      frame: { nh, th: [-nh[1], nh[0]], c: nh[0] * p0[0] + nh[1] * p0[2] },
      rows: [f],
    });
  }
  return out;
}

function extent(fr: Frame, rows: DbFaceRow[]): { s: V2; y: V2; areaM2: number } {
  let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity, a = 0;
  for (const f of rows) {
    a += f.areaM2;
    for (const p of f.outer) {
      const s = sOf(fr, p);
      if (s < s0) s0 = s;
      if (s > s1) s1 = s;
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return { s: [s0, s1], y: [y0, y1], areaM2: a };
}

/** the model's own +Y, i.e. plan north on the drawing. IFC +Y maps to web-ifc
 *  −Z. Room and wall names ("Laundry east wall") are read off the drawing, so
 *  this — not true north — is the label the user means. */
const PROJECT_NORTH: V2 = [0, -1];

export function wallQA(
  ifcRows: DbFaceRow[],
  idfRows: DbFaceRow[],
  edges: OpenEdgeReport,
  trueNorth: V2 | null,
): WallQAReport {
  // every ifc.db face of an element, so the AUTHORED SOLID extent includes the
  // end/top/bottom bands the collapse dropped
  const ifcByElement = new Map<number, DbFaceRow[]>();
  for (const f of ifcRows) {
    const a = ifcByElement.get(f.elementId);
    if (a) a.push(f); else ifcByElement.set(f.elementId, [f]);
  }
  const spacesOf = new Map<number, string>();
  for (const f of ifcRows) if (f.spaces) spacesOf.set(f.elementId, f.spaces);

  // the neighbours a boundary could meet: every idf surface
  const covers = idfRows.filter((f) => Math.abs(f.n[1]) >= FLAT);
  const wallPlanes = [...verticalPlanes(idfRows).values()];

  const rows: WallQARow[] = [];
  const seen = new Set<number>();

  for (const plane of verticalPlanes(idfRows.filter((f) => f.ifcClass === "exteriorWall")).values()) {
    const fr = plane.frame;
    const idf = extent(fr, plane.rows);
    const elementId = plane.rows[0]!.elementId;
    seen.add(elementId);

    const all = ifcByElement.get(elementId) ?? [];
    const solid = extent(fr, all);
    // the ifc.db faces on THIS plane — the collapse's own source
    const onPlane = all.filter((f) => {
      if (Math.abs(f.n[1]) >= FLAT) return false;
      const hl = Math.hypot(f.n[0], f.n[2]) || 1;
      if (Math.abs((f.n[0] / hl) * fr.nh[0] + (f.n[2] / hl) * fr.nh[1]) < 0.99) return false;
      const p0 = f.outer[0]!;
      return Math.abs(fr.nh[0] * p0[0] + fr.nh[1] * p0[2] - fr.c) <= 2 * DQ;
    });
    const face = onPlane.length ? extent(fr, onPlane) : idf;

    // ── pivot the open-edge verdicts onto the four boundaries ─────────────
    //    byElement is keyed by ELEMENT, and an element can own several planes
    //    (an L-wall, a wall with a jog). Keep only the edges lying ON THIS
    //    plane, or a neighbouring plane's open end is charged to this one.
    const onThisPlane = (p: V3): boolean =>
      Math.abs(fr.nh[0] * p[0] + fr.nh[1] * p[2] - fr.c) <= EPS;
    const open = (edges.byElement.get(elementId)?.open ?? [])
      .filter((e) => onThisPlane(e.a) && onThisPlane(e.b));
    const acc: Record<Boundary, { openLenM: number; contactLenM: number }> = {
      start: { openLenM: 0, contactLenM: 0 }, end: { openLenM: 0, contactLenM: 0 },
      bottom: { openLenM: 0, contactLenM: 0 }, top: { openLenM: 0, contactLenM: 0 },
    };
    const yMid = (idf.y[0] + idf.y[1]) / 2;
    const place = (e: OpenEdge): Boundary | null => {
      if (e.bucket === "vertical") {
        const s = (sOf(fr, e.a) + sOf(fr, e.b)) / 2;
        if (Math.abs(s - idf.s[0]) <= EPS) return "start";
        if (Math.abs(s - idf.s[1]) <= EPS) return "end";
        return null;
      }
      return (e.a[1] + e.b[1]) / 2 >= yMid ? "top" : "bottom";   // a rake is a top
    };
    for (const e of open) {
      const b = place(e);
      if (!b) continue;
      if (e.sealed) acc[b].contactLenM += e.lenM; else acc[b].openLenM += e.lenM;
    }

    // ── what each open boundary should meet, and how far away it is ───────
    const verdict = (b: Boundary): BoundaryVerdict => {
      const a = acc[b];
      if (a.openLenM <= EPS) {
        return { state: a.contactLenM > EPS ? "contact" : "matched", openLenM: 0, gapM: 0, meets: "" };
      }
      if (b === "start" || b === "end") {
        // nearest other wall plane to this end, in plan
        const s = b === "start" ? idf.s[0] : idf.s[1];
        const pt: V2 = [fr.nh[0] * fr.c + fr.th[0] * s, fr.nh[1] * fr.c + fr.th[1] * s];
        let gapM = Infinity, meets = "nothing";
        for (const w of wallPlanes) {
          if (w.key === plane.key) continue;
          const we = extent(w.frame, w.rows);
          const sp = Math.max(we.s[0], Math.min(we.s[1], w.frame.th[0] * pt[0] + w.frame.th[1] * pt[1]));
          const near: V2 = [w.frame.nh[0] * w.frame.c + w.frame.th[0] * sp,
                            w.frame.nh[1] * w.frame.c + w.frame.th[1] * sp];
          const d = Math.hypot(pt[0] - near[0], pt[1] - near[1]);
          if (d < gapM) { gapM = d; meets = `wall #${w.rows[0]!.elementId}`; }
        }
        return { state: "open", openLenM: a.openLenM, gapM: gapM === Infinity ? 0 : gapM, meets };
      }
      // top / bottom: the nearest roof or floor plane in that direction
      const yEdge = b === "top" ? idf.y[1] : idf.y[0];
      const sMid = (idf.s[0] + idf.s[1]) / 2;
      const x = fr.nh[0] * fr.c + fr.th[0] * sMid, z = fr.nh[1] * fr.c + fr.th[1] * sMid;
      let gapM = Infinity, meets = "nothing";
      for (const c of covers) {
        if (!inRing([x, z], c.outer.map((p): V2 => [p[0], p[2]]))) continue;
        const y = (c.n[0] * c.outer[0]![0] + c.n[1] * c.outer[0]![1] + c.n[2] * c.outer[0]![2]
                   - c.n[0] * x - c.n[2] * z) / c.n[1];
        const d = b === "top" ? y - yEdge : yEdge - y;
        if (d <= EPS || d >= gapM) continue;
        gapM = d; meets = `${c.ifcClass} #${c.elementId}`;
      }
      return { state: "open", openLenM: a.openLenM, gapM: gapM === Infinity ? 0 : gapM, meets };
    };

    const boundaries: Record<Boundary, BoundaryVerdict> = {
      start: verdict("start"), end: verdict("end"),
      bottom: verdict("bottom"), top: verdict("top"),
    };
    rows.push({
      elementId,
      spaces: spacesOf.get(elementId) ?? "",
      facing: compassOf(fr.nh, PROJECT_NORTH),
      facingTrue: compassOf(fr.nh, trueNorth),
      authoredSolid: { lengthM: solid.s[1] - solid.s[0], heightM: solid.y[1] - solid.y[0] },
      authoredFace: { lengthM: face.s[1] - face.s[0], heightM: face.y[1] - face.y[0], areaM2: face.areaM2 },
      idf: { lengthM: idf.s[1] - idf.s[0], heightM: idf.y[1] - idf.y[0], areaM2: idf.areaM2 },
      delta: {
        start: face.s[0] - idf.s[0], end: idf.s[1] - face.s[1],
        bottom: face.y[0] - idf.y[0], top: idf.y[1] - face.y[1],
      },
      // run the collapse dropped that nothing has taken back yet
      unclaimedM: { start: idf.s[0] - solid.s[0], end: solid.s[1] - idf.s[1] },
      cornerRunM: { start: face.s[0] - solid.s[0], end: solid.s[1] - face.s[1] },
      thicknessM: plane.rows[0]!.thicknessM ?? 0,
      boundaries,
      openCount: (["start", "end", "bottom", "top"] as Boundary[])
        .filter((b) => boundaries[b].state === "open").length,
      worstGapM: Math.max(...(["start", "end", "bottom", "top"] as Boundary[])
        .map((b) => (boundaries[b].state === "open" ? boundaries[b].gapM : 0))),
      lostLengthM: Math.max(0, (face.s[1] - face.s[0]) - (idf.s[1] - idf.s[0])),
    });
  }

  // a surface the solver shortened to nothing is the worst thing here, then
  // the biggest measurable gap, then merely-open boundaries
  rows.sort((a, b) =>
    (b.lostLengthM - a.lostLengthM) || (b.worstGapM - a.worstGapM) || (b.openCount - a.openCount));
  const missingFromIdf = [...new Set(ifcRows
    .filter((f) => f.isExternal === true && f.ifcClass.toUpperCase().startsWith("IFCWALL"))
    .map((f) => f.elementId))].filter((id) => !seen.has(id));
  return {
    rows,
    wallsClosed: rows.filter((r) => r.openCount === 0).length,
    wallsActionable: rows.filter((r) => r.worstGapM > EPS).length,
    wallsOpenToNothing: rows.filter((r) => r.openCount > 0 && r.worstGapM <= EPS).length,
    missingFromIdf,
  };
}

export function formatWallQA(r: WallQAReport, limit: number): string[] {
  const bs = (v: BoundaryVerdict): string =>
    v.state === "matched" ? "  ok  " : v.state === "contact" ? " seal "
      : v.gapM > 0 ? `${v.gapM.toFixed(2)}m`.padStart(6) : " OPEN ";
  const out = [
    `  WALL QA — ${r.rows.length} exposed wall planes · ${r.wallsClosed} closed · ` +
    `${r.wallsActionable} with a measurable gap · ${r.wallsOpenToNothing} open to nothing (ground, eave)` +
    (r.missingFromIdf.length ? ` · ${r.missingFromIdf.length} exposed walls MISSING from idf.db` : ""),
    `    ${"el #".padEnd(9)} ${"space".padEnd(26)} dir   ifc L×H      idf L×H      ${"start".padStart(6)} ${"end".padStart(6)} ${"bot".padStart(6)} ${"top".padStart(6)}   lost   meets`,
  ];
  for (const w of r.rows.slice(0, limit)) {
    const meets = (["top", "end", "start", "bottom"] as Boundary[])
      .filter((b) => w.boundaries[b].state === "open")
      .map((b) => `${b} → ${w.boundaries[b].meets}`).join(", ");
    out.push(
      `    #${String(w.elementId).padEnd(8)} ${w.spaces.slice(0, 26).padEnd(26)} ${w.facing.padEnd(4)} ` +
      `${w.authoredFace.lengthM.toFixed(2)}×${w.authoredFace.heightM.toFixed(2)}`.padEnd(13) +
      `${w.idf.lengthM.toFixed(2)}×${w.idf.heightM.toFixed(2)}`.padEnd(13) +
      `${bs(w.boundaries.start)} ${bs(w.boundaries.end)} ${bs(w.boundaries.bottom)} ${bs(w.boundaries.top)}  ` +
      `${w.lostLengthM > EPS ? `${w.lostLengthM.toFixed(2)}m` : "  -  "}  ${meets}`);
  }
  return out;
}
