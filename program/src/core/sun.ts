// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SUN over the site for a wall-clock hour: NOAA's solar calculator
// equations — the same model EnergyPlus uses for the sun's place — stated in
// fifty lines rather than pulled in as a dependency (the predecessor used
// suncalc; the lesson kept is the model, not the package). Astronomy is not
// a fact the file states, but every INPUT is: the IfcSite's latitude and
// longitude, the weather file's time zone. Bearings are clockwise from TRUE
// north; the view turns them into the house grid by the file's north axis.

export interface SunPosition {
  /** degrees above the horizon (negative: below) */
  altitudeDeg: number;
  /** clockwise from true north */
  azimuthDeg: number;
  declinationDeg: number;
  eqTimeMin: number;
  /** local wall-clock hours */
  solarNoonH: number;
  sunriseH: number | null;
  sunsetH: number | null;
}

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function dayOfYear(month: number, day: number): number {
  return (CUM[month - 1] ?? 0) + day;
}

/** longitude positive EAST, tzHours the zone's offset from UTC (west negative), hourLocal 0–24 wall-clock */
export function sunPosition(latDeg: number, lonDeg: number, tzHours: number, month: number, day: number, hourLocal: number): SunPosition {
  const n = dayOfYear(month, day);
  const g = (2 * Math.PI / 365) * (n - 1 + (hourLocal - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const timeOffset = eqTime + 4 * lonDeg - 60 * tzHours;
  const tst = hourLocal * 60 + timeOffset;
  const ha = (tst / 4 - 180) * RAD;
  const lat = latDeg * RAD;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const sinZen = Math.sin(zen);
  let az = 180;
  if (sinZen > 1e-9) {
    const c = (Math.sin(decl) - Math.sin(lat) * Math.cos(zen)) / (Math.cos(lat) * sinZen);
    az = Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
    if (ha > 0) az = 360 - az;
  }
  // sunrise and sunset: the hour angle at which the sun's centre is 0.833° below the horizon
  const cosHa0 = Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  const noonMin = 720 - 4 * lonDeg - eqTime + 60 * tzHours;
  let sunriseH: number | null = null, sunsetH: number | null = null;
  if (cosHa0 >= -1 && cosHa0 <= 1) {
    const ha0 = Math.acos(cosHa0) * DEG;
    sunriseH = (noonMin - 4 * ha0) / 60;
    sunsetH = (noonMin + 4 * ha0) / 60;
  }
  return { altitudeDeg: 90 - zen * DEG, azimuthDeg: az, declinationDeg: decl * DEG, eqTimeMin: eqTime, solarNoonH: noonMin / 60, sunriseH, sunsetH };
}

/** a unit vector toward the sun in the HOUSE frame (store: X east of the
 *  project grid, Y up, Z south of it), given the project grid's north axis —
 *  the bearing of project +Y clockwise from true north, the file's word */
export function sunDirection(p: SunPosition, northAxisDeg: number): [number, number, number] | null {
  if (p.altitudeDeg <= 0) return null;
  const phi = (p.azimuthDeg - northAxisDeg) * RAD, alt = p.altitudeDeg * RAD;
  return [Math.cos(alt) * Math.sin(phi), Math.sin(alt), -Math.cos(alt) * Math.cos(phi)];
}

/** the Building North Axis from the file's TrueNorth (x, y): the bearing of
 *  project +Y clockwise from true north — the writer's own arithmetic, so the
 *  view and the IDF agree (the gate asserts it) */
export function northAxisFromTrueNorth(tn: [number, number] | null): number {
  if (!tn) return 0;
  const bearingOfTrueNorth = Math.atan2(tn[0], -tn[1]) * DEG;
  return ((-bearingOfTrueNorth % 360) + 360) % 360;
}

/** true north as a horizontal unit vector in the house frame */
export function northDirection(northAxisDeg: number): [number, number, number] {
  const phi = -northAxisDeg * RAD;
  return [Math.sin(phi), 0, -Math.cos(phi)];
}

/** day-of-year (1–365) back to month and day */
export function monthDayOf(n: number): { month: number; day: number } {
  let m = 12;
  while (m > 1 && (CUM[m - 1] ?? 0) >= n) m--;
  return { month: m, day: n - (CUM[m - 1] ?? 0) };
}

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtHour(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "—";
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${String((hh + (mm === 60 ? 1 : 0)) % 24).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}
