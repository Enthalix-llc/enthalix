// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT FILLS A HOLE. The stored cells carry their openings as rings; the file
// carries the windows and doors as elements with their own geometry and their
// own names — "Window-Casement-Double:60\" x 54\"", "Door-Sliding-Marvin-2_Panel_
// French_Door", "Door-Exterior-Double-Full Glass-Wood_Clad", "Door-Screen-…".
// A hole is matched to the window or door whose extent contains its centre.
// WHAT IS GLASS is read in this order and the source is carried with the
// verdict: the FILE (an IfcWindow; Pset_DoorCommon.GlazingAreaFraction; a
// Pset_DoorWindowGlazingType attached), else a DEFAULT from the type name (a
// French, glass, lite or screen door), else the USER's checkbox in the space
// table — the fallback the user asked for when the file is silent (2026-09-04).
// The door's own Pset IsExternal says which side of the house it is on. A
// porch screen is a wall the file names "Screen Wall".

import type { DbFaceRow } from "../../core/db.js";

type V3 = [number, number, number];

export type OpeningKind = "window" | "door";
export type GlazingSource = "file" | "default" | "user";

export interface OpeningRef {
  elementId: number;
  globalId: string | null;
  kind: OpeningKind;
  name: string;
  /** the type part of the name, readable: "Casement-Double 60\" x 54\"" */
  label: string;
  isExternal: boolean | null;
  glazed: boolean;
  glazedSource: GlazingSource;
  min: V3;
  max: V3;
  /** the file's stated opening size (IfcDoor / IfcWindow OverallWidth × OverallHeight) */
  overallWidthM: number | null;
  overallHeightM: number | null;
  /** the element's own stored faces — the leaf, the frame, the tracks */
  faces: Array<{ n: V3; outer: V3[] }>;
}

export function openingKind(ifcClass: string): OpeningKind | null {
  const c = ifcClass.toUpperCase();
  if (c === "IFCWINDOW") return "window";
  if (c === "IFCDOOR") return "door";
  return null;
}

/** the file's own glazing facts on an element */
export interface GlazingFacts { glazingFraction: number | null; glazingPset: boolean }

/** the type name's word on glass — a DEFAULT, never the file's: "French_Door",
 *  "Full Glass", "Two_Lite", "Screen" */
export function glazedByName(name: string | null): boolean {
  return /french|glass|glazed|screen|(?<![a-z])lite(?![a-z])/i.test(name ?? "");
}

/** what fills the opening, and who says so: the user's ruling wins, then the
 *  file's word, then the type name; null for anything not a window or door */
export function glazingOf(ifcClass: string, name: string | null, facts: GlazingFacts, ruling: boolean | undefined): { glazed: boolean; source: GlazingSource } | null {
  const kind = openingKind(ifcClass);
  if (!kind) return null;
  if (ruling !== undefined) return { glazed: ruling, source: "user" };
  if (kind === "window") return { glazed: true, source: "file" };
  if (facts.glazingFraction !== null) return { glazed: facts.glazingFraction > 0, source: "file" };
  if (facts.glazingPset) return { glazed: true, source: "file" };
  return { glazed: glazedByName(name), source: "default" };
}

/** a porch screen: the file names the wall type "Screen Wall" */
export function isScreenWall(ifcClass: string, name: string | null): boolean {
  return /^IFCWALL/i.test(ifcClass) && /screen wall/i.test(name ?? "");
}

/** "Window-Casement-Double:60\" x 54\":1310984" → "Casement-Double 60\" x 54\"" */
export function typeLabel(name: string | null): string {
  if (!name) return "";
  const parts = name.split(":");
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1]!)) parts.pop();
  return parts.join(" ").replace(/^(Window|Door)-/i, "").replace(/_/g, " ").trim();
}

/** the type an element's name states, as the drawing set says it:
 *  "Basic Wall:Exterior - Wood Siding on Wood Stud:1234567" → "Wood Siding on
 *  Wood Stud" (the family and the instance id dropped; Interior / Exterior is
 *  already the row's Int / Ext) — user, 2026-09-04 */
export function elementTypeLabel(name: string | null): string {
  if (!name) return "";
  const parts = name.split(":");
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1]!)) parts.pop();
  if (parts.length >= 2) parts.shift();
  return parts.join(" ").replace(/^(Exterior|Interior)\s*-\s*/i, "").trim();
}

/** every window and door with the extent of its stored faces and its glazing verdict */
export function buildOpeningIndex(
  faces: DbFaceRow[],
  elements: Map<number, { globalId: string | null; ifcClass: string; name: string | null; isExternal: boolean | null; overallWidthM?: number | null; overallHeightM?: number | null } & GlazingFacts>,
  ruling: (globalId: string | null) => boolean | undefined = () => undefined,
): OpeningRef[] {
  const box = new Map<number, { min: V3; max: V3; faces: Array<{ n: V3; outer: V3[] }> }>();
  for (const f of faces) {
    const e = elements.get(f.elementId);
    if (!e || !openingKind(e.ifcClass)) continue;
    const b = box.get(f.elementId) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], faces: [] };
    for (const p of f.outer) for (let i = 0; i < 3; i++) { if (p[i]! < b.min[i]!) b.min[i] = p[i]!; if (p[i]! > b.max[i]!) b.max[i] = p[i]!; }
    b.faces.push({ n: f.n, outer: f.outer });
    box.set(f.elementId, b);
  }
  const out: OpeningRef[] = [];
  for (const [id, b] of box) {
    const e = elements.get(id)!;
    const g = glazingOf(e.ifcClass, e.name, e, ruling(e.globalId))!;
    out.push({ elementId: id, globalId: e.globalId, kind: openingKind(e.ifcClass)!, name: e.name ?? "", label: typeLabel(e.name), isExternal: e.isExternal, glazed: g.glazed, glazedSource: g.source,
      min: b.min, max: b.max, overallWidthM: e.overallWidthM ?? null, overallHeightM: e.overallHeightM ?? null, faces: b.faces });
  }
  return out;
}

export function ringCentroid(ring: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of ring) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = ring.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** the planar area of a ring about a normal (Newell) */
export function ringAreaM2(ring: V3[]): number {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(x, y, z) / 2;
}

/** the opening whose extent contains the hole's centre, the tightest when several */
export function matchOpening(index: OpeningRef[], ring: V3[], tolM: number): OpeningRef | null {
  const c = ringCentroid(ring);
  let best: OpeningRef | null = null, bestVol = Infinity;
  for (const o of index) {
    if (c[0] < o.min[0] - tolM || c[0] > o.max[0] + tolM || c[1] < o.min[1] - tolM || c[1] > o.max[1] + tolM || c[2] < o.min[2] - tolM || c[2] > o.max[2] + tolM) continue;
    const vol = (o.max[0] - o.min[0] + 2 * tolM) * (o.max[1] - o.min[1] + 2 * tolM) * (o.max[2] - o.min[2] + 2 * tolM);
    if (vol < bestVol) { bestVol = vol; best = o; }
  }
  return best;
}
