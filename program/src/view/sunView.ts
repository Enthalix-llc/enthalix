// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SUN PATH over the model (user, 2026-09-05: the SITE view shows the
// solar shading projection): a horizon ring with true north marked, the day's
// arc through the hours above the horizon, a dot per hour, the sun itself and
// its ray to the model's centre. Hand-drawn lines and two spheres; the
// shadows are the renderer's, cast by the same direction (dbPanes.setSun).

import * as THREE from "three";

type V3 = [number, number, number];

export interface SunViewIn {
  center: V3;
  radius: number;
  /** the day's path: each entry a wall-clock hour and the unit direction toward the sun, null below the horizon */
  path: Array<{ hour: number; dir: V3 | null }>;
  sun: V3 | null;
  north: V3;
}

export function buildSunView(s: SunViewIn): THREE.Group {
  const g = new THREE.Group();
  g.name = "sun";
  const C = new THREE.Vector3(...s.center), R = s.radius;
  const at = (d: V3, r = R): THREE.Vector3 => new THREE.Vector3(C.x + d[0] * r, C.y + d[1] * r, C.z + d[2] * r);
  const line = (pts: THREE.Vector3[], color: number, opacity = 1): THREE.Line => {
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
  };
  // the horizon ring and the compass: north long and red, east / south / west short
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; ring.push(new THREE.Vector3(C.x + R * Math.sin(a), C.y, C.z - R * Math.cos(a))); }
  g.add(line(ring, 0x4a5265));
  const N = new THREE.Vector3(...s.north), E = new THREE.Vector3(-N.z, 0, N.x);
  const tick = (d: THREE.Vector3, len: number, color: number): void => { g.add(line([at([d.x, 0, d.z], R), at([d.x, 0, d.z], R + len)], color)); };
  tick(N, R * 0.12, 0xff5555);
  tick(E, R * 0.05, 0x7c8698);
  tick(N.clone().negate(), R * 0.05, 0x7c8698);
  tick(E.clone().negate(), R * 0.05, 0x7c8698);
  // the arc, broken at the horizon
  let run: THREE.Vector3[] = [];
  const flush = (): void => { if (run.length > 1) g.add(line(run, 0xffcc55)); run = []; };
  for (const p of s.path) { if (p.dir) run.push(at(p.dir)); else flush(); }
  flush();
  const dot = new THREE.SphereGeometry(R * 0.012, 8, 6);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffcc55, depthTest: false });
  for (const p of s.path) {
    if (!p.dir || Math.abs(p.hour - Math.round(p.hour)) > 1e-6) continue;
    const m = new THREE.Mesh(dot, dotMat); m.position.copy(at(p.dir)); g.add(m);
  }
  if (s.sun) {
    const sun = new THREE.Mesh(new THREE.SphereGeometry(R * 0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffdd44, depthTest: false }));
    sun.position.copy(at(s.sun));
    g.add(sun);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([at(s.sun), C]),
      new THREE.LineDashedMaterial({ color: 0xffdd44, dashSize: R * 0.03, gapSize: R * 0.02, transparent: true, opacity: 0.8, depthTest: false }));
    ray.computeLineDistances();
    g.add(ray);
  }
  g.renderOrder = 999;
  return g;
}
