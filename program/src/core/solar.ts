// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SOLAR INTENSITY on an exterior surface (user, 2026-09-05): the irradiance
// falling on it at the clock's hour. Nothing modelled from scratch — the
// direct-normal, diffuse-horizontal and global-horizontal radiation are READ
// from the weather file's own row for that month, day and hour, and put on
// the surface by its orientation with the isotropic sky (the textbook form:
// direct × cos of incidence + diffuse × the sky the surface sees + ground-
// reflected × the ground it sees, albedo 0.2 stated). Unshaded: the view's
// shadows are the renderer's, the engine's own shading is in the run.

type V3 = [number, number, number];

export interface HourRad { ghi: number; dni: number; dhi: number }

export interface EpwRadiation {
  hours: number;
  /** the row for a wall-clock hour (0–24): EPW rows are hours ENDING, so 12.25 is the row for hour 13 */
  at(month: number, day: number, hour: number): HourRad | null;
}

/** the 8760 rows' global / direct-normal / diffuse-horizontal (Wh/m²), fields 14–16 of the EPW data line */
export function parseEpwRadiation(text: string): EpwRadiation {
  const map = new Map<number, HourRad>();
  for (const line of text.split("\n")) {
    const c = line.split(",");
    if (c.length < 16) continue;
    const month = +c[1]!, day = +c[2]!, hour = +c[3]!;
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 1 && hour <= 24)) continue;
    map.set(month * 10000 + day * 100 + hour, { ghi: +c[13]! || 0, dni: +c[14]! || 0, dhi: +c[15]! || 0 });
  }
  return {
    hours: map.size,
    at: (month, day, hour) => map.get(month * 10000 + day * 100 + Math.max(1, Math.min(24, Math.ceil(hour - 1e-9)))) ?? null,
  };
}

export interface Irradiance { total: number; direct: number; diffuse: number; ground: number; cosI: number }

/** W/m² on a surface with outward normal nOut, the sun at unit vector `sun` (null below the horizon) */
export function irradiance(nOut: V3, sun: V3 | null, r: HourRad, albedo = 0.2): Irradiance {
  const cosI = sun ? Math.max(0, nOut[0] * sun[0] + nOut[1] * sun[1] + nOut[2] * sun[2]) : 0;
  const up = nOut[1];
  const direct = r.dni * cosI;
  const diffuse = r.dhi * (1 + up) / 2;
  const ground = r.ghi * albedo * (1 - up) / 2;
  return { total: direct + diffuse + ground, direct, diffuse, ground, cosI };
}

/** the sequential ramp the lens paints with: night blue → amber → near white, packed rgba as the view expects */
export function intensityColor(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, k: number): number => Math.round(a + (b - a) * k);
  const [r, g, b] = x < 0.5
    ? [lerp(0x1e, 0xff, x * 2), lerp(0x22, 0x8e, x * 2), lerp(0x30, 0x14, x * 2)]
    : [lerp(0xff, 0xff, (x - 0.5) * 2), lerp(0x8e, 0xf5, (x - 0.5) * 2), lerp(0x14, 0xc0, (x - 0.5) * 2)];
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | 255) >>> 0;
}
