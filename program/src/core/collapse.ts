// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// PHASE 2 — single-plane collapse (user direction, 2026-08-31: per-category
// dropdowns "I" interior / "M" centerline / "E" exterior).
//
// Per element, faces are grouped by plane; opposite plane groups pair up
// (a wall's two sides, a roof pitch's top and underside, a slab's top and
// soffit — a multi-pitch roof yields one pair PER PITCH). The pair collapses
// to ONE plane:
//   E — the pair's outer face(s), VERBATIM (the file's own coordinates)
//   I — the pair's inner face(s), verbatim
//   M — the larger side's faces translated to the midplane (the only mode
//       that moves a vertex, and only by half the pair gap)
// Which side is "outer" is decided by the most LOCAL fact available:
//   roof   the upper face. A roof's exterior side is up, whatever the pitch —
//          the file already told us it is a roof, so nothing is inferred.
//   floor  the interior (walking) side is the upper face; exterior is the
//          soffit/ground side.
//   walls  the face whose outward normal points away from the NEARBY building
//          mass — the shell faces within the element's own bbox grown by half
//          its diagonal, a distance the element itself states.
// A single GLOBAL centroid was wrong twice, both caught in pane 3 by the user
// (2026-08-31): on a detached ADU the horizontal offset to the site centre
// swamps the vertical term and a roof pitch facing away from the house picks
// its soffit as "exterior"; and a slab 4 cm from the global mean flips on
// nothing. Locality is the fix, not a tolerance. Edge bands (a
// wall's ends, top, bottom) are not part of a single-plane abstraction and
// are dropped — visibly, in the census, never silently.
//
// The only classification is READ, not derived: walls split interior /
// exterior by the file's Pset IsExternal. Roof = IfcRoof, Floor = IfcSlab.

export type Category = "interiorWall" | "exteriorWall" | "roof" | "floor" | "ceiling";
export type Mode = "I" | "M" | "E";
export type Choices = Record<Category, Mode>;

export const DEFAULT_CHOICES: Choices = {
  interiorWall: "M",   // Revit authors interior boundaries at the centerline
  exteriorWall: "E",   // exterior surfaces keep the file's exposure dimensions
  roof: "E",
  floor: "I",          // the walking surface
  // an IfcCovering ceiling: its TOP is the floor of the attic void above it,
  // which is what the user builds attic zones from (2026-09-02)
  ceiling: "E",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  interiorWall: "Interior Wall",
  exteriorWall: "Exterior Wall",
  roof: "Roof",
  floor: "Floor",
  ceiling: "Ceiling",
};

type V3 = [number, number, number];

export interface CollapseFaceIn {
  elementId: number;
  n: V3;
  areaM2: number;
  rgba: number;
  outer: V3[];
  holes: V3[][];
}

export interface CollapseElementIn {
  expressId: number;
  ifcClass: string;
  isExternal: boolean | null;
  /** IfcCovering only: PredefinedType and the type name, both as the file states them */
  predefinedType?: string | null;
  name?: string | null;
}

export interface IdfFaceOut {
  elementId: number;
  category: Category;
  mode: Mode;
  n: V3;
  areaM2: number;
  rgba: number;
  outer: V3[];
  holes: V3[][];
  /** pair gap in metres; 0 for an unpaired principal plane */
  thicknessM: number;
  source: "pair" | "unpaired";
  /** the IfcSpace this surface bounds, once spaceSplit has carved it. null
   *  means no room claimed it — a soffit, a parapet, the back of a garage. */
  space?: string | null;
  /** the room on the other side, the way the normal points — an interior wall
   *  and a storey slab both have one */
  spaceFacing?: string | null;
  /** the IfcSpace each side came from BEFORE the user's zone rulings (idf.db schema 6) */
  spaceIfc?: string | null;
  spaceFacingIfc?: string | null;
  spaceColorIndex?: number;
  /** which side of the ground line this surface lies on, once the site
   *  terrain has cut it (gradeSplit); undefined when no terrain was read */
  grade?: "above" | "below";
  /** the ground's elevation beside the surface, metres, and how far below
   *  it the surface's centre sits (a slab's depth, a wall part's depth) */
  gradeM?: number;
  gradeDepthM?: number;
}

export interface CollapseCensus {
  byCategory: Record<Category, { elements: number; faces: number; areaM2: number }>;
  wallsUnclassified: number;   // walls the file gives no IsExternal verdict
  /** wall pairs whose exterior side was READ from a bounded space's boundary,
   *  vs decided by the local-mass-centroid fallback */
  wallSideBySpace: number;
  wallSideByCentroid: number;
  /** exterior walls with a room on BOTH sides, whose side was settled by the
   *  envelope continuing through a neighbour's exterior face */
  wallSideByEnvelope: number;
  pairs: number;
  unpaired: number;
  droppedEdgeAreaM2: number;   // edge bands, dropped by design
}

const NQ = 1e-3, DQ = 5e-4;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function categoryOf(el: CollapseElementIn): Category | null {
  const c = el.ifcClass.toUpperCase();
  if (c.startsWith("IFCWALL")) return el.isExternal === true ? "exteriorWall" : "interiorWall";
  if (c === "IFCROOF") return "roof";
  // a slab the file types .ROOF. is a roof (2026-10-16: Revit writes a roof as an IfcRoof aggregating an IfcSlab .ROOF. that holds the
  // geometry — read as a floor before, the roof was lost to the model)
  if (c === "IFCSLAB") return (el.predefinedType ?? "").toUpperCase() === "ROOF" ? "roof" : "floor";
  // a ceiling covering — READ from PredefinedType, or from the type name the
  // file gives it when PredefinedType is unset. A roof soffit is a covering
  // too and is not a ceiling; it bounds no room.
  if (c === "IFCCOVERING") {
    const pt = (el.predefinedType ?? "").toUpperCase();
    if (pt === "CEILING") return "ceiling";
    if (!pt || pt === "NOTDEFINED" || pt === "USERDEFINED") return /ceiling/i.test(el.name ?? "") ? "ceiling" : null;
    return null;
  }
  return null;
}

/** a face of an IfcSpace solid — the room's own boundary, used to settle
 *  which side of a wall is the interior */
export interface SpaceFaceIn {
  n: V3;
  outer: V3[];
  areaM2: number;
}

export function collapse(
  faces: CollapseFaceIn[],
  elements: CollapseElementIn[],
  choices: Choices,
  spaceFaces: SpaceFaceIn[] = [],
): { out: IdfFaceOut[]; census: CollapseCensus } {
  const census: CollapseCensus = {
    byCategory: {
      interiorWall: { elements: 0, faces: 0, areaM2: 0 },
      exteriorWall: { elements: 0, faces: 0, areaM2: 0 },
      roof: { elements: 0, faces: 0, areaM2: 0 },
      floor: { elements: 0, faces: 0, areaM2: 0 },
      ceiling: { elements: 0, faces: 0, areaM2: 0 },
    },
    wallsUnclassified: 0,
    wallSideBySpace: 0,
    wallSideByCentroid: 0,
    wallSideByEnvelope: 0,
    pairs: 0,
    unpaired: 0,
    droppedEdgeAreaM2: 0,
  };
  const out: IdfFaceOut[] = [];

  // the room boundaries, distilled: plane + bbox + area. A wall face is the
  // INTERIOR face when a room's own boundary lies coincident on it, facing
  // into it — a READ fact, where the centroid was a guess that pointed 14 of
  // 61 exterior walls into the very room they bound (2026-09-01).
  const spacePlanes = spaceFaces.map((sf) => {
    const p0 = sf.outer[0] ?? [0, 0, 0];
    let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of sf.outer) for (let k = 0; k < 3; k++) {
      if (p[k]! < lo[k]!) lo[k] = p[k]!;
      if (p[k]! > hi[k]!) hi[k] = p[k]!;
    }
    return { n: sf.n, d: dot(sf.n, p0 as V3), lo, hi, areaM2: sf.areaM2 };
  });

  interface Grp { n: V3; d: number; area: number; faces: CollapseFaceIn[]; center: V3; used: boolean }

  // exterior walls with a room against BOTH faces — a basement wall against
  // the elevator shaft, a game-room wall against the mechanical room. The
  // file marks them external and marks every space internal (all 31 carry
  // Pset_SpaceCommon.IsExternal = false, read), so the rooms cannot say which
  // side is out. Decided provisionally by contact area, then re-decided
  // below by ENVELOPE CONTINUITY.
  interface Ambiguous {
    elementId: number; A: Grp; B: Grp; aOut: boolean; gap: number;
    emit: (grp: Grp, translate: number, thickness: number, source: "pair" | "unpaired") => void;
    mode: Mode;
    /** the faces the provisional decision emitted — the ONLY ones a re-decision
     *  may remove; an element can carry other pairs (#1930218 has a return) */
    faces: IdfFaceOut[];
  }
  const ambiguous: Ambiguous[] = [];

  const byElement = new Map<number, CollapseFaceIn[]>();
  for (const f of faces) {
    const arr = byElement.get(f.elementId) ?? [];
    arr.push(f);
    byElement.set(f.elementId, arr);
  }

  // the shell mass a wall asks about: only categorised elements, each face
  // reduced to its centre and area
  const catOf = new Map<number, Category | null>();
  for (const el of elements) catOf.set(el.expressId, categoryOf(el));
  const shellPts: Array<{ c: V3; a: number }> = [];
  for (const f of faces) {
    if (!catOf.get(f.elementId)) continue;
    let px = 0, py = 0, pz = 0;
    for (const p of f.outer) { px += p[0]; py += p[1]; pz += p[2]; }
    const m = f.outer.length || 1;
    shellPts.push({ c: [px / m, py / m, pz / m], a: f.areaM2 });
  }

  for (const el of elements) {
    const cat = categoryOf(el);
    if (!cat) continue;
    if (cat === "interiorWall" && el.isExternal === null &&
        el.ifcClass.toUpperCase().startsWith("IFCWALL")) census.wallsUnclassified++;
    const efaces = byElement.get(el.expressId);
    if (!efaces || efaces.length === 0) continue;
    const mode = choices[cat];

    // plane groups
    const groups = new Map<string, Grp>();
    for (const f of efaces) {
      const p0 = f.outer[0];
      if (!p0) continue;
      const d = dot(f.n, p0);
      const key = `${Math.round(f.n[0] / NQ)}|${Math.round(f.n[1] / NQ)}|${Math.round(f.n[2] / NQ)}|${Math.round(d / DQ)}`;
      let g = groups.get(key);
      if (!g) { g = { n: f.n, d, area: 0, faces: [], center: [0, 0, 0], used: false }; groups.set(key, g); }
      g.area += f.areaM2;
      g.faces.push(f);
      let px = 0, py = 0, pz = 0;
      for (const p of f.outer) { px += p[0]; py += p[1]; pz += p[2]; }
      const m = f.outer.length || 1;
      g.center = [g.center[0] + (px / m) * f.areaM2, g.center[1] + (py / m) * f.areaM2, g.center[2] + (pz / m) * f.areaM2];
    }
    const glist = [...groups.values()].sort((a, b) => b.area - a.area);
    for (const g of glist) {
      g.center = [g.center[0] / (g.area || 1), g.center[1] / (g.area || 1), g.center[2] / (g.area || 1)];
    }
    const maxArea = glist[0]?.area ?? 0;
    if (maxArea <= 0) continue;

    // ── the LOCAL mass this element sits in: shell faces whose centre falls
    //    inside its own bbox grown by half its diagonal. Self-scaling — the
    //    reach is a dimension the element itself states.
    let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const f of efaces) for (const p of f.outer) {
      for (let k = 0; k < 3; k++) {
        if (p[k]! < lo[k]!) lo[k] = p[k]!;
        if (p[k]! > hi[k]!) hi[k] = p[k]!;
      }
    }
    const grow = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    let lx = 0, ly = 0, lz = 0, lw = 0;
    for (const sp of shellPts) {
      if (sp.c[0] < lo[0] - grow || sp.c[0] > hi[0] + grow ||
          sp.c[1] < lo[1] - grow || sp.c[1] > hi[1] + grow ||
          sp.c[2] < lo[2] - grow || sp.c[2] > hi[2] + grow) continue;
      lx += sp.c[0] * sp.a; ly += sp.c[1] * sp.a; lz += sp.c[2] * sp.a; lw += sp.a;
    }
    const C: V3 = lw > 0 ? [lx / lw, ly / lw, lz / lw]
      : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];

    // Room contact per side — the question is WHICH SIDE of the wall the room
    // is on, not whether its boundary lies on a face. A room's boundary face
    // whose outward normal points INTO the wall (antiparallel to this face's)
    // and which sits within the pair's own thickness of this face is a room
    // on this side. The earlier test demanded the room face lie ON the face
    // within 2 cm; #1930138 [Basement], a 12" concrete wall with furring, has
    // its IfcSpace drawn to the concrete, 6 cm inside the furring face, so the
    // test missed, the centroid fallback inverted it, and the true exterior —
    // coincident with the Great-room wall above — was thrown away
    // (2026-09-02). Extent overlap is tested in the face's OWN plane only (the
    // normal axis is exactly where the room boundary may sit off), the
    // shared-run lesson from the phantom storey steps. Weighted by area.
    const spaceContact = (g: Grp, gap: number): number => {
      const tol = gap + Math.max(DQ, Math.min(0.02, gap / 2));
      const axis = [0, 1, 2].reduce((b, k) => (Math.abs(g.n[k]!) > Math.abs(g.n[b]!) ? k : b), 0);
      let glo: V3 = [Infinity, Infinity, Infinity], ghi: V3 = [-Infinity, -Infinity, -Infinity];
      for (const f of g.faces) for (const p of f.outer) for (let k = 0; k < 3; k++) {
        if (p[k]! < glo[k]!) glo[k] = p[k]!;
        if (p[k]! > ghi[k]!) ghi[k] = p[k]!;
      }
      let area = 0;
      for (const sp of spacePlanes) {
        if (dot(sp.n, g.n) > -0.99) continue;              // must face INTO the wall
        if (Math.abs(sp.d + g.d) > tol) continue;          // within the wall's own thickness
        let apart = false;
        for (let k = 0; k < 3; k++) {
          if (k === axis) continue;
          if (sp.lo[k]! > ghi[k]! + 0.05 || sp.hi[k]! < glo[k]! - 0.05) { apart = true; break; }
        }
        if (apart) continue;
        area += sp.areaM2;
      }
      return area;
    };

    const emit = (grp: Grp, translate: number, thickness: number, source: "pair" | "unpaired"): void => {
      for (const f of grp.faces) {
        const mv = (p: V3): V3 => [
          p[0] + grp.n[0] * translate, p[1] + grp.n[1] * translate, p[2] + grp.n[2] * translate,
        ];
        out.push({
          elementId: el.expressId, category: cat, mode,
          n: [...f.n] as V3, areaM2: f.areaM2, rgba: f.rgba,
          outer: f.outer.map(mv), holes: f.holes.map((h) => h.map(mv)),
          thicknessM: thickness, source,
        });
        census.byCategory[cat].faces++;
        census.byCategory[cat].areaM2 += f.areaM2;
      }
    };

    let emitted = false;
    for (const A of glist) {
      if (A.used || A.area < 0.25 * maxArea) continue;
      // best opposite partner within 1 m
      let B: Grp | null = null;
      let bestGap = Infinity;
      for (const cand of glist) {
        if (cand === A || cand.used) continue;
        if (dot(A.n, cand.n) > -0.99) continue;
        const gap = Math.abs(dot(A.n, cand.center) - A.d);
        if (gap < bestGap && gap <= 1.0 && cand.area >= 0.25 * A.area) { bestGap = gap; B = cand; }
      }
      if (B) {
        A.used = true; B.used = true;
        census.pairs++;
        // outer side — the most local fact that settles it. For a wall that is
        // a READ: the face a bounded room lies against is the INTERIOR face
        // (IfcRelSpaceBoundary's own model, and the same side the per-space
        // carve assigns). The local-mass centroid pointed 14 of 61 exterior
        // walls into the very room they bound — #1764804 [Bed 1] kept the
        // z = −4.352 plane, which is exactly where IfcSpace Bed 1 ends
        // (2026-09-01). The centroid stays only as the fallback for planes no
        // room touches, and the census counts each path.
        let aOut: boolean;
        if (cat === "roof") aOut = A.center[1] > B.center[1];        // a roof's exterior is up
        else if (cat === "ceiling") aOut = A.center[1] > B.center[1]; // the attic side is up
        else if (cat === "floor") aOut = A.center[1] < B.center[1];  // walking surface = interior
        else {
          let bySpace: boolean | null = null;
          let bothSides = false;
          if (cat === "exteriorWall") {
            const aIn = spaceContact(A, bestGap), bIn = spaceContact(B, bestGap);
            if (aIn > bIn) bySpace = false;        // the room is against A → A interior
            else if (bIn > aIn) bySpace = true;
            bothSides = aIn > 0 && bIn > 0;
          }
          if (bySpace !== null) {
            aOut = bySpace; census.wallSideBySpace++;
            if (bothSides) ambiguous.push({ elementId: el.expressId, A, B, aOut, gap: bestGap, emit, mode, faces: [] });
          }
          else {
            aOut = dot(A.n, [A.center[0] - C[0], A.center[1] - C[1], A.center[2] - C[2]]) > 0;
            if (cat === "exteriorWall") census.wallSideByCentroid++;
          }
        }
        const outer = aOut ? A : B;
        const inner = aOut ? B : A;
        const before = out.length;
        if (mode === "E") emit(outer, 0, bestGap, "pair");
        else if (mode === "I") emit(inner, 0, bestGap, "pair");
        else {
          const big = A.area >= B.area ? A : B;
          // move toward the partner: the partner's plane sits at gap along -n
          emit(big, -bestGap / 2, bestGap, "pair");
        }
        const amb = ambiguous[ambiguous.length - 1];
        if (amb && amb.A === A && amb.faces.length === 0) amb.faces = out.slice(before);
        emitted = true;
      } else {
        A.used = true;
        census.unpaired++;
        emit(A, 0, 0, "unpaired");
        emitted = true;
      }
    }
    for (const g of glist) if (!g.used) census.droppedEdgeAreaM2 += g.area;
    if (emitted) census.byCategory[cat].elements++;
  }

  // ── ENVELOPE CONTINUITY. For a wall with a room on both sides, the outside
  //    is the face that CONTINUES the envelope: coplanar, same facing, and
  //    adjacent (beside or stacked) to an exterior face already decided from
  //    a single-sided room. #1930218 [Basement] had the Basement on one face
  //    and the Elevator shaft on the other, larger, so the shaft was called
  //    the room and the wall's exterior landed a full thickness inside the
  //    Great-room wall stacked above it; #1765268 [Game] the same against
  //    the MER. Both read as one-thickness "storey steps". The user saw them
  //    as recessed against their neighbours, which is exactly this test
  //    (2026-09-02). No neighbour, or neighbours on both sides: the area
  //    decision stands, counted as such.
  if (ambiguous.length) {
    const ambIds = new Set(ambiguous.map((a) => a.elementId));
    const confident = out.filter((f) => f.category === "exteriorWall" && !ambIds.has(f.elementId));
    const continues = (g: Grp): boolean => {
      let glo: V3 = [Infinity, Infinity, Infinity], ghi: V3 = [-Infinity, -Infinity, -Infinity];
      for (const f of g.faces) for (const p of f.outer) for (let k = 0; k < 3; k++) {
        if (p[k]! < glo[k]!) glo[k] = p[k]!;
        if (p[k]! > ghi[k]!) ghi[k] = p[k]!;
      }
      for (const f of confident) {
        if (dot(f.n, g.n) < 0.999) continue;                        // same facing
        if (Math.abs(dot(f.n, f.outer[0]!) - g.d) > 0.02) continue;  // same plane
        let apart = false;
        for (let k = 0; k < 3; k++) {
          let lo = Infinity, hi = -Infinity;
          for (const p of f.outer) { if (p[k]! < lo) lo = p[k]!; if (p[k]! > hi) hi = p[k]!; }
          if (lo > ghi[k]! + 0.3 || hi < glo[k]! - 0.3) { apart = true; break; }
        }
        if (!apart) return true;
      }
      return false;
    };
    for (const amb of ambiguous) {
      const aCont = continues(amb.A), bCont = continues(amb.B);
      const want = aCont && !bCont ? true : bCont && !aCont ? false : null;
      if (want === null || want === amb.aOut) continue;
      // the provisional faces come out and the census forgets them; the other
      // side goes in through the same emit, so nothing else can differ
      for (const f of amb.faces) {
        const i = out.indexOf(f);
        if (i < 0) continue;
        census.byCategory.exteriorWall.faces--;
        census.byCategory.exteriorWall.areaM2 -= f.areaM2;
        out.splice(i, 1);
      }
      const outer = want ? amb.A : amb.B, inner = want ? amb.B : amb.A;
      if (amb.mode === "E") amb.emit(outer, 0, amb.gap, "pair");
      else if (amb.mode === "I") amb.emit(inner, 0, amb.gap, "pair");
      else amb.emit(amb.A.area >= amb.B.area ? amb.A : amb.B, -amb.gap / 2, amb.gap, "pair");
      census.wallSideBySpace--;
      census.wallSideByEnvelope++;
    }
  }

  return { out, census };
}
