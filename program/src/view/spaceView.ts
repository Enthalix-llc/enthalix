// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// The rooms, drawn as translucent volumes over all three panes.
//
// One builder, one palette, one source of rows (ifc.db `spaces`/`space_faces`)
// — so a space is the same colour in the Fragments pane, the IFC-DB pane and
// the IDF-DB pane, and the eye can carry a room across the three views. The
// colour comes from the space's STORED `color_index`, not from its position in
// whatever array a caller happens to hold.

import * as THREE from "three";
import earcut from "earcut";
import type { SpaceFaceRow } from "../core/db.js";

/** Golden-angle hue rotation: consecutive indices land far apart on the wheel,
 *  so neighbouring rooms never read as the same colour. Fixed saturation and
 *  lightness keep them all equally present against the dark ground. */
export function spaceColor(colorIndex: number): THREE.Color {
  return new THREE.Color().setHSL(((colorIndex * 137.508) % 360) / 360, 0.65, 0.55);
}

function basis(n: [number, number, number]): { u: THREE.Vector3; v: THREE.Vector3 } {
  const N = new THREE.Vector3(...n).normalize();
  const a = Math.abs(N.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(a, N).normalize();
  return { u, v: new THREE.Vector3().crossVectors(N, u) };
}

export interface SpaceView {
  group: THREE.Group;
  spaces: number;
  triangles: number;
}

/** `opacity` is the volume's own translucency — the surfaces are faded
 *  separately by their own panes so the rooms show through them. */
export function buildSpaceView(rows: SpaceFaceRow[], opacity: number): SpaceView {
  const pos: number[] = [];
  const col: number[] = [];
  const linePos: number[] = [];
  const lineCol: number[] = [];
  const ids = new Set<number>();
  // which of the given rows each fill triangle belongs to — a click on a
  // room resolves to a stored row, the way a click on a surface does
  const rowOfTri: number[] = [];
  let triangles = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    ids.add(row.spaceId);
    const c = spaceColor(row.colorIndex);
    const { u, v } = basis(row.n);
    const all = [...row.outer, ...row.holes.flat()];
    const holeIdx: number[] = [];
    let at = row.outer.length;
    for (const h of row.holes) { holeIdx.push(at); at += h.length; }
    const flat: number[] = [];
    for (const p of all) {
      const P = new THREE.Vector3(...p);
      flat.push(P.dot(u), P.dot(v));
    }
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
    for (let t = 0; t + 2 < tris.length; t += 3) {
      for (const ti of [tris[t]!, tris[t + 1]!, tris[t + 2]!]) {
        const p = all[ti]!;
        pos.push(p[0], p[1], p[2]);
        col.push(c.r, c.g, c.b);
      }
      rowOfTri.push(rowIndex);
      triangles++;
    }
    // a crisp outline: a translucent wash alone reads as fog
    for (const loop of [row.outer, ...row.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
        linePos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
        lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
  }

  const group = new THREE.Group();
  group.name = "spaces";

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
    // volumes overlap and nest; writing depth makes the nearest one hide the
    // rest and the overlay stops reading as a set of rooms
    depthWrite: false,
  }));
  mesh.renderOrder = 2;
  mesh.name = "space-fill";
  mesh.userData.rowOfTri = new Int32Array(rowOfTri);
  group.add(mesh);

  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
  lg.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: Math.min(1, opacity * 2.5), depthWrite: false,
  }));
  lines.renderOrder = 3;
  group.add(lines);

  return { group, spaces: ids.size, triangles };
}
