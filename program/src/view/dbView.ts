// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// Shaded wireframe FROM THE DATABASE ROWS — the recommended option of
// references/wireframe-analysis.md: one merged fill mesh (earcut, per-vertex
// colour, polygonOffset) + one merged LineSegments of the stored loops
// (edges = fill hue × 0.65). No renderOrder, no depthWrite tricks.

import * as THREE from "three";
import earcut from "earcut";
import type { DbFaceRow } from "../core/db.js";

const EDGE_DARKEN = 0.65;

function basis(n: [number, number, number]): { u: [number, number, number]; v: [number, number, number] } {
  const a: [number, number, number] = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = a[1] * n[2] - a[2] * n[1];
  const uy = a[2] * n[0] - a[0] * n[2];
  const uz = a[0] * n[1] - a[1] * n[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const u: [number, number, number] = [ux / ul, uy / ul, uz / ul];
  const v: [number, number, number] = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return { u, v };
}

export interface DbViewResult {
  group: THREE.Group;
  facesDrawn: number;
  fillTriangles: number;
  lineSegments: number;
}

/** `hidden`: elements the user has hidden (right-click → Hide). Their rows are
 *  skipped but row indexes are preserved, so a pick still names the stored row. */
/** `hideRow`: a further test per stored row — a level or a space the user has
 *  hidden takes its rows out of the view the same way; row indexes preserved. */
/** `colorOf` is THE LENS: a module paints the same stored rows by zone,
 *  boundary condition, construction or a run result by returning an rgba
 *  per row (null = the row's own colour). The builder and the per-triangle
 *  row map are unchanged, so a click under any lens still names a stored row. */
/** what a surface or an opening is MADE of, for the eye: a screen wall or a
 *  window is see-through, a door is wood — read from the file's classes and
 *  names (user, 2026-09-04) */
export interface DbViewStyle {
  /** a row drawn as glass (a porch screen) */
  rowGlass?: (row: DbFaceRow) => boolean;
  /** the panes standing in a row's openings — each a quad on the cell's
   *  plane, glass or wood, PICKED AS ITS OWN ELEMENT (the window or door)
   *  while naming the row it cuts; a notch gets its pane like a hole does */
  panes?: (row: DbFaceRow) => Array<{ quad: Array<[number, number, number]>; rgba: number; glass: boolean; elementId: number }>;
}

export function buildDbView(rows: DbFaceRow[], fillOpacity: number, hidden?: ReadonlySet<number>, hideRow?: (row: DbFaceRow) => boolean, colorOf?: (row: DbFaceRow) => number | null, style?: DbViewStyle): DbViewResult {
  const fillPos: number[] = [];
  const fillCol: number[] = [];
  // the glass: its own transparent mesh, with the same pick maps
  const glassPos: number[] = [];
  const glassCol: number[] = [];
  const glassEl: number[] = [];
  const glassRow: number[] = [];
  // which element and which stored ROW each fill triangle belongs to, so a
  // click in the pane is answered with a row from the DB rather than a guess.
  // The row is what names the exact PLANE the user clicked — an element can
  // carry several (a wall's two faces, a roof's pitches).
  const triEl: number[] = [];
  const triRow: number[] = [];
  const linePos: number[] = [];
  const lineCol: number[] = [];
  let fillTriangles = 0;
  let lineSegments = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    if (hidden?.has(row.elementId) || (hideRow && hideRow(row))) continue;
    const rgba = colorOf?.(row) ?? row.rgba;
    const r = ((rgba >>> 24) & 255) / 255;
    const g = ((rgba >>> 16) & 255) / 255;
    const b = ((rgba >>> 8) & 255) / 255;
    const er = r * EDGE_DARKEN, eg = g * EDGE_DARKEN, eb = b * EDGE_DARKEN;

    // lines: every stored loop, verbatim
    for (const loop of [row.outer, ...row.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
        linePos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
        lineCol.push(er, eg, eb, er, eg, eb);
        lineSegments++;
      }
    }

    // fill: project to the face plane, earcut with holes, lift back
    const { u, v } = basis(row.n);
    const all: Array<[number, number, number]> = [...row.outer];
    const holeIdx: number[] = [];
    for (const h of row.holes) { holeIdx.push(all.length); all.push(...h); }
    const flat: number[] = [];
    for (const p of all) {
      flat.push(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    }
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
    const glassRowHere = style?.rowGlass?.(row) === true;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      for (const ti of [tris[t]!, tris[t + 1]!, tris[t + 2]!]) {
        const p = all[ti]!;
        if (glassRowHere) { glassPos.push(p[0], p[1], p[2]); glassCol.push(r, g, b); }
        else { fillPos.push(p[0], p[1], p[2]); fillCol.push(r, g, b); }
      }
      if (glassRowHere) { glassEl.push(row.elementId); glassRow.push(rowIndex); }
      else { triEl.push(row.elementId); triRow.push(rowIndex); }
      fillTriangles++;
    }
    // the panes standing in the openings: glass or wood, each answering a
    // click with the window's or door's own element id and this row
    if (style?.panes) {
      for (const pane of style.panes(row)) {
        const q = pane.quad;
        if (q.length < 3 || hidden?.has(pane.elementId)) continue;
        const pr = ((pane.rgba >>> 24) & 255) / 255, pg = ((pane.rgba >>> 16) & 255) / 255, pb = ((pane.rgba >>> 8) & 255) / 255;
        for (let i = 1; i + 1 < q.length; i++) {
          for (const p of [q[0]!, q[i]!, q[i + 1]!]) {
            if (pane.glass) { glassPos.push(p[0], p[1], p[2]); glassCol.push(pr, pg, pb); }
            else { fillPos.push(p[0], p[1], p[2]); fillCol.push(pr, pg, pb); }
          }
          if (pane.glass) { glassEl.push(pane.elementId); glassRow.push(rowIndex); }
          else { triEl.push(pane.elementId); triRow.push(rowIndex); }
          fillTriangles++;
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = "ifc-db-view";
  if (glassPos.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(glassPos, 3));
    gg.setAttribute("color", new THREE.Float32BufferAttribute(glassCol, 3));
    gg.computeVertexNormals();
    const glass = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: Math.min(0.32, fillOpacity), depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    glass.renderOrder = 1;
    glass.userData.elementOfTri = new Int32Array(glassEl);
    glass.userData.rowOfTri = new Int32Array(glassRow);
    group.add(glass);
  }

  const fillGeom = new THREE.BufferGeometry();
  fillGeom.setAttribute("position", new THREE.Float32BufferAttribute(fillPos, 3));
  fillGeom.setAttribute("color", new THREE.Float32BufferAttribute(fillCol, 3));
  fillGeom.computeVertexNormals();
  const fillMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: fillOpacity < 1,
    opacity: fillOpacity,
    depthWrite: fillOpacity >= 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const fillMesh = new THREE.Mesh(fillGeom, fillMat);
  fillMesh.userData.elementOfTri = Int32Array.from(triEl);
  fillMesh.userData.rowOfTri = Int32Array.from(triRow);
  group.add(fillMesh);

  // The edges MUST fade with the fill. Left opaque, 150,050 line segments pile
  // into a white wash that buries anything drawn behind them — which is why
  // the room overlay was invisible in panes 2 and 3 (2026-09-01). They stay a
  // little stronger than the fill so the wireframe still reads.
  const edgeOpacity = Math.min(1, fillOpacity * 1.6);
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
  lineGeom.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
  group.add(new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: edgeOpacity < 1,
    opacity: edgeOpacity,
    depthWrite: edgeOpacity >= 1,
  })));

  return { group, facesDrawn: rows.filter((r) => !(hidden?.has(r.elementId) || (hideRow && hideRow(r)))).length, fillTriangles, lineSegments };
}

/** REPAINT the fill mesh in place (2026-09-05): a colour per row, the rows
 *  with none left as they are. The triangle → row map the builder left is the
 *  key, so nothing is re-derived and a running sun can paint at 8 Hz. */
export function repaintFill(group: THREE.Group, rows: DbFaceRow[], colorOf: (row: DbFaceRow) => number | null): number {
  let painted = 0;
  for (const o of group.children) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const rowOf = mesh.userData.rowOfTri as Int32Array | undefined;
    const col = mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!rowOf || !col) continue;
    for (let t = 0; t < rowOf.length; t++) {
      const row = rows[rowOf[t]!];
      if (!row) continue;
      const c = colorOf(row);
      if (c === null) continue;
      const r = ((c >>> 24) & 255) / 255, g = ((c >>> 16) & 255) / 255, b = ((c >>> 8) & 255) / 255;
      for (let k = 0; k < 3; k++) col.setXYZ(3 * t + k, r, g, b);
      painted++;
    }
    col.needsUpdate = true;
  }
  return painted;
}

/** A hot outline over the surfaces of the given elements, drawn over
 *  everything else. This is how a row in the storey-step or wall-QA table
 *  points at the wall it is talking about — and how a click in the pane points
 *  back at the row. Built from the same stored loops as the view itself. */
export function buildHighlight(rows: DbFaceRow[], ids: Set<number>): THREE.Group {
  const pos: number[] = [];
  for (const row of rows) {
    if (!ids.has(row.elementId)) continue;
    for (const loop of [row.outer, ...row.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
        pos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
    }
  }
  const group = new THREE.Group();
  group.name = "highlight";
  if (pos.length === 0) return group;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const line = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
    color: 0xffd166, depthTest: false, transparent: true, opacity: 0.95,
  }));
  line.renderOrder = 20;
  group.add(line);
  return group;
}

/** The same outline over particular ROWS — one cell, or the cells that
 *  bound one room — so a click on a cell outlines that cell alone, and a
 *  room named in the tree outlines every cell that bounds it. */
export function buildRowHighlight(rows: DbFaceRow[], rowIds: ReadonlySet<number>): THREE.Group {
  const loops: Array<Array<[number, number, number]>> = [];
  // the cells FILLED as well as outlined — an outline alone is a thin line
  // among many, and the wall, roof or floor selected must read as lit the
  // way Fragments lights it in the IFC view (user, 2026-09-04)
  const pos: number[] = [];
  for (const row of rows) {
    if (row.id === undefined || !rowIds.has(row.id)) continue;
    loops.push(row.outer, ...row.holes);
    const { u, v } = basis(row.n);
    const all: Array<[number, number, number]> = [...row.outer];
    const holeIdx: number[] = [];
    for (const h of row.holes) { holeIdx.push(all.length); all.push(...h); }
    const flat: number[] = [];
    for (const p of all) flat.push(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
    for (const ti of tris) { const p = all[ti]!; pos.push(p[0], p[1], p[2]); }
  }
  const group = buildLoopHighlight(loops);
  if (pos.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: 0xffd166, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.35,
    }));
    mesh.renderOrder = 19;
    group.add(mesh);
  }
  return group;
}

/** several outlines in one pane: one group holding them all */
export function combineHighlights(groups: THREE.Group[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "highlight";
  for (const x of groups) g.add(x);
  return g;
}

/** A hot outline around the given loops — the selected ROOM face, drawn in
 *  every pane from that pane's own stored rows. */
export function buildLoopHighlight(loops: Array<Array<[number, number, number]>>): THREE.Group {
  const pos: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
      pos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  const group = new THREE.Group();
  group.name = "space-highlight";
  if (pos.length === 0) return group;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const line = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
    color: 0xffd166, depthTest: false, transparent: true, opacity: 0.95, linewidth: 2,
  }));
  line.renderOrder = 21;
  group.add(line);
  return group;
}

/** A selected window or door: its pane FILLED in the selection colour and
 *  outlined — an outline alone coincides with the wall's notch on three
 *  sides and cannot be told from the cell's own (user, 2026-09-04) */
export function buildQuadHighlight(quads: Array<Array<[number, number, number]>>): THREE.Group {
  const group = buildLoopHighlight(quads);
  group.name = "opening-highlight";
  const pos: number[] = [];
  for (const q of quads) for (let i = 1; i + 1 < q.length; i++) for (const p of [q[0]!, q[i]!, q[i + 1]!]) pos.push(p[0], p[1], p[2]);
  if (pos.length === 0) return group;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: 0xffd166, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.45,
  }));
  mesh.renderOrder = 20;
  group.add(mesh);
  return group;
}

/** The stored ring as a reviewer reads it off a drawing: counter-clockwise
 *  seen from OUTSIDE the surface (looking along −n), starting at the
 *  upper-left corner. The stored order is whatever the merge produced, which
 *  is correct but arbitrary; this is the order that can be checked by eye
 *  against a plan. Vertical surfaces take world +Y as up; a floor or roof
 *  takes −Z, so a plan reads north-up. */
export function ringForReading(
  n: [number, number, number],
  outer: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const up: [number, number, number] = Math.abs(n[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  const vl = Math.hypot(up[0] - d * n[0], up[1] - d * n[1], up[2] - d * n[2]) || 1;
  const v: [number, number, number] =
    [(up[0] - d * n[0]) / vl, (up[1] - d * n[1]) / vl, (up[2] - d * n[2]) / vl];
  // screen right for a viewer looking along −n with v up: u = v × n
  const u: [number, number, number] = [
    v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0],
  ];
  const uv = outer.map((p): [number, number] =>
    [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]]);
  let twice = 0;
  for (let i = 0; i < uv.length; i++) {
    const a = uv[i]!, b = uv[(i + 1) % uv.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const ring = twice < 0 ? [...outer].reverse() : [...outer];
  const proj = twice < 0 ? [...uv].reverse() : uv;
  let start = 0, best = Infinity;
  for (let i = 0; i < proj.length; i++) {
    const score = proj[i]![0] - proj[i]![1];       // least u, greatest v
    if (score < best - 1e-9) { best = score; start = i; }
  }
  return [...ring.slice(start), ...ring.slice(0, start)];
}
