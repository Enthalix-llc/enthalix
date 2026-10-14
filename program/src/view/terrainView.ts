// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// The ground, drawn as a translucent earth-coloured mesh over all three
// panes — from the triangles STORED in ifc.db, already turned into the
// house's frame, so what is drawn is what the grade cut used.

import * as THREE from "three";
import earcut from "earcut";

export interface TerrainView { group: THREE.Group; triangles: number }

export function buildTerrainView(tris: Float32Array, opacity: number): TerrainView {
  const group = new THREE.Group();
  group.name = "terrain";
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(tris, 3));
  geom.computeVertexNormals();
  // lit, so the sun's shadows fall on it in the SITE view (2026-09-05)
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
    color: TERRAIN_COLOR, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  }));
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, triangles: tris.length / 9 };
}

/** THE SERVICES INVENTORY IN THE VIEW (2026-09-10): one mesh per element from the stored triangles (a box past
 *  MEP_TRI_CAP), coloured by discipline — the focused subsection's elements lit and casting, the rest dimmed;
 *  a selected element in the selection colour through everything, as a site element is */
export const DISCIPLINE_COLOR: Record<string, number> = { mechanical: 0x4fa3d1, electrical: 0xe0b341, plumbing: 0x5cc28f, other: 0x8c7b64 };
export function buildMepView<T extends { expressId: number; name: string; kind: string; ifcClass: string; discipline: string; room: string | null; file: string; fileExpressId: number; xyz: Float32Array }>(
  els: T[],
  opts: { focus: ((e: T) => boolean) | null; selected: ReadonlySet<number>; hidden?: ReadonlySet<number> },
): { group: THREE.Group; triangles: number; elements: number; lit: number } {
  const group = new THREE.Group();
  group.name = "mep-elements";
  let triangles = 0, elements = 0, lit = 0;
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const matOf = (color: number, alpha: number): THREE.MeshLambertMaterial => {
    const k = `${color}|${alpha.toFixed(2)}`;
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, transparent: alpha < 1, opacity: alpha, side: THREE.DoubleSide, depthWrite: alpha >= 0.5 }); mats.set(k, m); }
    return m;
  };
  let sel: THREE.MeshBasicMaterial | null = null;
  const selMat = (): THREE.MeshBasicMaterial => (sel ??= new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  for (const e of els) {
    if (opts.hidden?.has(e.expressId) || !e.xyz.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(e.xyz, 3));
    geom.computeVertexNormals();
    const focused = opts.focus ? opts.focus(e) : true;
    const mesh = new THREE.Mesh(geom, matOf(DISCIPLINE_COLOR[e.discipline] ?? DISCIPLINE_COLOR.other!, focused ? 0.95 : 0.12));
    mesh.castShadow = focused; mesh.receiveShadow = focused;
    mesh.renderOrder = focused ? 1 : 0;
    mesh.userData.mepElement = { expressId: e.expressId, name: e.name, kind: e.kind, ifcClass: e.ifcClass, discipline: e.discipline, room: e.room, file: e.file, fileExpressId: e.fileExpressId };
    group.add(mesh);
    if (opts.selected.has(e.expressId)) { const glow = new THREE.Mesh(geom, selMat()); glow.renderOrder = 998; group.add(glow); }
    triangles += e.xyz.length / 9; elements++; if (focused) lit++;
  }
  return { group, triangles, elements, lit };
}

/** THE SITE'S SHADING ELEMENTS: one mesh per element from the stored
 *  triangles — trees green, everything else the colour of weathered wood —
 *  casting and receiving the sun's shadows (user, 2026-09-05) */
export function buildSiteElementsView(
  els: Array<{ expressId: number; name: string; ifcClass: string; xyz: Float32Array; file?: string; fileExpressId?: number }>,
  opacity: number,
  hidden: ReadonlySet<number> = new Set(),
  selected: ReadonlySet<number> = new Set(),
  transmittanceOf: (name: string) => number = () => 0,
): { group: THREE.Group; triangles: number; elements: number } {
  const group = new THREE.Group();
  group.name = "site-elements";
  let triangles = 0;
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const matOf = (color: number, alpha: number): THREE.MeshLambertMaterial => {
    const k = `${color}|${alpha.toFixed(2)}`;
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, transparent: alpha < 1, opacity: alpha, side: THREE.DoubleSide }); mats.set(k, m); }
    return m;
  };
  // the shadow of a tree that lets light through: the depth pass discards a
  // Bayer-dithered share of its fragments, and the soft shadow filter turns the
  // screen-door into a lighter shadow (a canopy in winter casts a thin one)
  let sel: THREE.MeshBasicMaterial | null = null;
  const selMat = (): THREE.MeshBasicMaterial => (sel ??= new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  const depths = new Map<string, THREE.MeshDepthMaterial>();
  const depthOf = (t: number): THREE.MeshDepthMaterial => {
    const k = t.toFixed(2);
    let d = depths.get(k);
    if (!d) {
      d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      d.onBeforeCompile = (sh) => {
        sh.uniforms.uTransmit = { value: t };
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <clipping_planes_pars_fragment>", "#include <clipping_planes_pars_fragment>\nuniform float uTransmit;")
          .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  {
    int bx = int(mod(gl_FragCoord.x, 4.0)), by = int(mod(gl_FragCoord.y, 4.0));
    int idx = bx + 4 * by;
    float bayer[16];
    bayer[0]=0.0; bayer[1]=8.0; bayer[2]=2.0; bayer[3]=10.0; bayer[4]=12.0; bayer[5]=4.0; bayer[6]=14.0; bayer[7]=6.0;
    bayer[8]=3.0; bayer[9]=11.0; bayer[10]=1.0; bayer[11]=9.0; bayer[12]=15.0; bayer[13]=7.0; bayer[14]=13.0; bayer[15]=5.0;
    float thr = 0.0;
    for (int i = 0; i < 16; i++) if (i == idx) thr = (bayer[i] + 0.5) / 16.0;
    if (thr < uTransmit) discard;
  }`);
      };
      depths.set(k, d);
    }
    return d;
  };
  for (const e of els) {
    if (hidden.has(e.expressId)) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(e.xyz, 3));
    geom.computeVertexNormals();
    const tree = /tree|oak|maple|pine|shrub|plant/i.test(e.name);
    const t = tree ? transmittanceOf(e.name) : 0;
    const mesh = new THREE.Mesh(geom, matOf(tree ? 0x3f7a3f : 0x8c7b64, tree ? opacity * (1 - t) : opacity));
    if (t > 0) mesh.customDepthMaterial = depthOf(t);
    // a SELECTED element (a table row, a click in the view) is lit the way a
    // model cell is: the selection colour drawn through everything (2026-09-05)
    if (selected.has(e.expressId)) {
      const glow = new THREE.Mesh(geom, selMat());
      glow.renderOrder = 998;
      group.add(glow);
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.siteElement = { expressId: e.expressId, name: e.name, ifcClass: e.ifcClass, file: e.file ?? "", fileExpressId: e.fileExpressId ?? e.expressId };
    group.add(mesh);
    triangles += e.xyz.length / 9;
  }
  return { group, triangles, elements: els.length };
}

export const TERRAIN_COLOR = 0x8a6d3b;
/** the selection colour the model's cells light with (ui.css --sel) */
export const SELECTION_COLOR = 0xffd166;

/** THE FILL, drawn as the earth it is: each fill element's upward faces a
 *  couple of centimetres under the concrete (so the concrete still shows),
 *  with skirts from their outlines down to the terrain — the same colour as
 *  the ground, because it is ground (the user, 2026-09-03). */
export function buildFillView(
  faces: Array<{ n: [number, number, number]; outer: Array<[number, number, number]>; holes: Array<Array<[number, number, number]>> }>,
  groundAt: (x: number, z: number) => number | null,
  opacity: number,
  dropM = 0.02,
): { group: THREE.Group; triangles: number } {
  const pos: number[] = [];
  let triangles = 0;
  const tri = (a: number[], b: number[], c: number[]): void => { pos.push(...a, ...b, ...c); triangles++; };
  for (const f of faces) {
    if (f.n[1] < 0.3 || f.outer.length < 3) continue;
    const N = new THREE.Vector3(...f.n).normalize();
    const ax = Math.abs(N.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(ax, N).normalize();
    const v = new THREE.Vector3().crossVectors(N, u);
    const all = [...f.outer, ...f.holes.flat()];
    const holeIdx: number[] = [];
    let at = f.outer.length;
    for (const h of f.holes) { holeIdx.push(at); at += h.length; }
    const flat: number[] = [];
    for (const p of all) { const P = new THREE.Vector3(...p); flat.push(P.dot(u), P.dot(v)); }
    const idx = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
    const low = (p: [number, number, number]): number[] => [p[0], p[1] - dropM, p[2]];
    for (let i = 0; i + 2 < idx.length; i += 3) tri(low(all[idx[i]!]!), low(all[idx[i + 1]!]!), low(all[idx[i + 2]!]!));
    // the skirt: from each outline edge down to the ground beneath its ends
    for (let i = 0; i < f.outer.length; i++) {
      const a = f.outer[i]!, b = f.outer[(i + 1) % f.outer.length]!;
      const ga = groundAt(a[0], a[2]), gb = groundAt(b[0], b[2]);
      if (ga === null || gb === null) continue;
      const ya = Math.min(ga, a[1] - dropM), yb = Math.min(gb, b[1] - dropM);
      if (a[1] - dropM - ya < 0.01 && b[1] - dropM - yb < 0.01) continue;
      const A = low(a), B = low(b), A0 = [a[0], ya, a[2]], B0 = [b[0], yb, b[2]];
      tri(A, B, B0); tri(A, B0, A0);
    }
  }
  const group = new THREE.Group();
  group.name = "fill";
  if (pos.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geom.computeVertexNormals();
    group.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: TERRAIN_COLOR, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    })));
  }
  return { group, triangles };
}
