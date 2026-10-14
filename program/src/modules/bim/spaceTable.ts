// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SPACE TABLE. The IDF-DB reading is organised by ROOM, not by vertex:
// for one space, its floor, its walls by orientation (Int / Ext and the
// outward-facing bearing from true north), its ceiling and its roof — each
// the sum of the stored cells that bound it, with the openings they carry.
// A cell names the room behind it (against −n) and the room it faces (+n),
// so the outward normal FROM a room is +n when the room is behind and −n
// when it is faced. Every number is a stored row's; nothing is re-derived.

import type { DbFaceRow } from "../../core/db.js";
import type { PlacedOpening, OpeningFit } from "../../core/placeOpenings.js";
import { ringAreaM2, typeLabel, elementTypeLabel, type OpeningRef, type GlazingSource } from "./openings.js";

type V3 = [number, number, number];

/** what the table needs from outside the rows: the file's IsExternal per
 *  element, the window or door a hole is filled with, which rooms are crawl spaces */
export interface SpaceTableCtx {
  isExternalOf?: (elementId: number) => boolean | null;
  /** the window or door a hole ring belongs to — only to tell a claimed hole from an unmatched one */
  matchHole?: (ring: V3[], thicknessM: number) => OpeningRef | null;
  isCrawl?: (room: string) => boolean;
  /** the openings placed on a stored cell by their own geometry — hole or notch alike (idf.db.openings) */
  openingsOn?: (rowId: number) => PlacedOpening[];
  /** the element's name as the file states it, for the type beside the row */
  nameOf?: (elementId: number) => string | null;
}

export interface OpeningItem {
  kind: string; label: string; areaM2: number; rowId: number | null; holeIndex: number;
  elementId: number | null; globalId: string | null;
  /** glass or not, and who said so; null when no element was matched */
  glazed: boolean | null; glazedSource: GlazingSource | null;
  /** the opening's own rectangle on the cell (or an unmatched hole's ring), for the outline */
  ring: V3[];
  /** how the cell's ring goes around it */
  fit: OpeningFit;
}

export type SurfaceKind = "floor" | "wall" | "ceiling" | "roof";

export interface Compass { label: string; deg: number | null; text: string }

/** 8-point compass on the project grid plus degrees clockwise from the file's
 *  TRUE north — the convention the wall QA validated on the Laundry east wall */
export function compass(n: V3, trueNorth: [number, number] | null): Compass {
  const hl = Math.hypot(n[0], n[2]);
  if (hl < 0.05) { const w = n[1] > 0 ? "up" : "down"; return { label: w, deg: null, text: w }; }
  const nh: [number, number] = [n[0] / hl, n[2] / hl];
  const pt = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const degGrid = (Math.atan2(nh[0], -nh[1]) * 180) / Math.PI;
  const label = pt[((Math.round(degGrid / 45) % 8) + 8) % 8]!;
  if (!trueNorth) return { label, deg: null, text: label };
  const dT = (Math.atan2(trueNorth[0] * nh[1] - trueNorth[1] * nh[0], trueNorth[0] * nh[0] + trueNorth[1] * nh[1]) * 180) / Math.PI;
  const deg = Math.round(((dT % 360) + 360) % 360) % 360;
  return { label, deg, text: `${label} ${deg}°` };
}

export interface SpaceSurface {
  kind: SurfaceKind;
  /** Ext when nothing claimed the other side of an exterior wall, a roof or a floor; Int otherwise */
  side: "Ext" | "Int";
  /** the outward-facing bearing, walls only */
  orient: Compass | null;
  /** the room on the other side, or what the other side is */
  facing: string;
  areaM2: number;
  grossM2: number;
  openings: number;
  openingM2: number;
  /** the windows and doors in this surface, each named by the file */
  items: OpeningItem[];
  cells: number;
  rowIds: number[];
  elementIds: number[];
  belowGradeM2: number;
  /** the types the file names for the elements in this row — "Wood Siding on Wood Stud" */
  types: string[];
}

/** the stored cells that bound a space, on either side */
export function relatedCells(rows: DbFaceRow[], space: string): DbFaceRow[] {
  return rows.filter((r) => r.space === space || r.spaceFacing === space);
}

/** the spaces an element's cells name */
export function spacesOfElement(rows: DbFaceRow[], elementId: number): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.elementId !== elementId) continue;
    if (r.space) out.add(r.space);
    if (r.spaceFacing) out.add(r.spaceFacing);
  }
  return [...out];
}

export function spaceSurfaces(rows: DbFaceRow[], space: string, trueNorth: [number, number] | null, ctx: SpaceTableCtx = {}): SpaceSurface[] {
  const groups = new Map<string, SpaceSurface>();
  for (const r of rows) {
    const behind = r.space === space, faced = r.spaceFacing === space;
    if (!behind && !faced) continue;
    const out: V3 = behind ? r.n : [-r.n[0], -r.n[1], -r.n[2]];
    const other = behind ? r.spaceFacing : r.space;
    const kind: SurfaceKind = out[1] < -0.5 ? "floor" : out[1] > 0.5 ? (r.ifcClass === "roof" ? "roof" : "ceiling") : "wall";
    const side: SpaceSurface["side"] = other ? "Int" : (r.ifcClass === "interiorWall" || r.ifcClass === "ceiling") ? "Int" : "Ext";
    const c = kind === "wall" ? compass(out, trueNorth) : null;
    // WHAT IS UNDER A FLOOR is read, never assumed (user, 2026-09-04): the
    // terrain's word puts a slab on the ground or over outdoor air; a room
    // below names itself, a crawl space by its name; a floor the file calls
    // external with no terrain word faces outdoors; the rest is unclaimed.
    let facing: string;
    if (kind === "floor") {
      if (other) facing = ctx.isCrawl?.(other) ? `crawl · ${other}` : other;
      else if (r.gradeDepthM !== null && r.gradeDepthM !== undefined) facing = r.gradeDepthM >= -0.1 ? "ground" : "outdoors";
      else if (ctx.isExternalOf?.(r.elementId) === true) facing = "outdoors";
      else facing = "—";
    } else facing = other ?? (r.grade === "below" ? "ground" : side === "Ext" ? "outdoors" : "—");
    const key = `${kind}|${side}|${c ? (c.deg ?? c.label) : ""}|${facing}`;
    const gross = r.grossAreaM2 ?? r.areaM2;
    const g = groups.get(key) ?? { kind, side, orient: c, facing, areaM2: 0, grossM2: 0, openings: 0, openingM2: 0, items: [], cells: 0, rowIds: [], elementIds: [], belowGradeM2: 0, types: [] };
    g.areaM2 += r.areaM2; g.grossM2 += gross; g.cells++;
    // the openings on this cell: every window and door placed here by its own
    // geometry, then any hole ring no element claims (a stair well, a chase)
    const placedHere = r.id !== undefined ? ctx.openingsOn?.(r.id) ?? [] : [];
    for (const o of placedHere) {
      g.items.push({ kind: o.kind, label: typeLabel(o.name), areaM2: o.areaM2, rowId: r.id ?? null, holeIndex: -1,
        elementId: o.elementId, globalId: o.globalId, glazed: o.glazed, glazedSource: o.glazedSource as GlazingSource, ring: o.quad, fit: o.fit });
      g.openings++; g.openingM2 += o.areaM2;
    }
    r.holes.forEach((h, k) => {
      if (ctx.matchHole?.(h, r.thicknessM ?? 0.2)) return;
      g.items.push({ kind: "opening", label: "", areaM2: ringAreaM2(h), rowId: r.id ?? null, holeIndex: k,
        elementId: null, globalId: null, glazed: null, glazedSource: null, ring: h, fit: "hole" });
      g.openings++; g.openingM2 += ringAreaM2(h);
    });
    if (r.id !== undefined) g.rowIds.push(r.id);
    if (!g.elementIds.includes(r.elementId)) {
      g.elementIds.push(r.elementId);
      const t = elementTypeLabel(ctx.nameOf?.(r.elementId) ?? null);
      if (t && !g.types.includes(t)) g.types.push(t);
    }
    if (r.grade === "below") g.belowGradeM2 += r.areaM2;
    groups.set(key, g);
  }
  const order: Record<SurfaceKind, number> = { floor: 0, wall: 1, ceiling: 2, roof: 3 };
  return [...groups.values()].sort((a, b) =>
    order[a.kind] - order[b.kind] || (a.side === b.side ? 0 : a.side === "Ext" ? -1 : 1) || ((a.orient?.deg ?? 0) - (b.orient?.deg ?? 0)) || a.facing.localeCompare(b.facing));
}

export interface SpaceSummary { floorM2: number; ceilingM2: number; roofM2: number; extWallM2: number; intWallM2: number; openingM2: number; openings: number; cells: number }

export function spaceSummary(list: SpaceSurface[]): SpaceSummary {
  const s: SpaceSummary = { floorM2: 0, ceilingM2: 0, roofM2: 0, extWallM2: 0, intWallM2: 0, openingM2: 0, openings: 0, cells: 0 };
  for (const r of list) {
    if (r.kind === "floor") s.floorM2 += r.areaM2;
    else if (r.kind === "ceiling") s.ceilingM2 += r.areaM2;
    else if (r.kind === "roof") s.roofM2 += r.areaM2;
    else if (r.side === "Ext") s.extWallM2 += r.areaM2;
    else s.intWallM2 += r.areaM2;
    s.openingM2 += r.openingM2; s.openings += r.openings; s.cells += r.cells;
  }
  return s;
}
