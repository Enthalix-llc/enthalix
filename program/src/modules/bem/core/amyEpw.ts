// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// AN ACTUAL-YEAR WEATHER FILE (the user, 2026-10-07: "Can we obtain a generic local data somewhere else?" — NREL's key page did not
// work; "yes, proceed" on GHCNh + Open-Meteo). A pure converter: what was MEASURED at the station, what the reanalysis states at the
// site for the sun and the sky, and the typical-year file's header — into one EPW the engine runs on a real calendar, so a run can
// be set against the bills metered under the same weather.
//
//   · the station (NOAA NCEI GHCNh — the hourly archive that replaced ISD, whose updates stopped 2025-08-28): dry-bulb, dew point,
//     station pressure (else from the altimeter setting at the station's elevation), wind direction and speed, visibility — the
//     report nearest each hour's end, within 30 minutes
//   · the site (Open-Meteo's historical archive, no key; free for non-commercial use): global, direct normal and diffuse irradiance
//     (each the average over the hour before its stamp = the EPW's Wh/m² for the hour ending), cloud cover (instantaneous, as the
//     total and the opaque sky cover — the archive states one), the hour's precipitation; and its own temperature, dew point,
//     pressure and wind, used ONLY to fill a station gap longer than 6 hours — each fill counted
//   · not written, so the engine derives them itself: the horizontal infrared (from the opaque sky cover, the dry-bulb and the dew
//     point), the extraterrestrial radiation, the illuminances — their missing flags, as the EPW format defines them
//
// Every hour is in LOCAL STANDARD TIME (no daylight saving), hour h = the hour ending h:00, as the format states.

export interface StationObs {
  /** the report's time, ms since the epoch, UTC */
  utcMs: number;
  tC: number | null; tdC: number | null;
  /** station-level pressure, Pa; the altimeter setting, hPa (converted at the station's elevation when the first is absent) */
  pStnPa: number | null; altimeterHpa: number | null;
  windDir: number | null; windMs: number | null; visKm: number | null;
}
export interface GridHour {
  /** the stamp, ms since the epoch, UTC: radiation and precipitation are over the hour BEFORE it, the rest at it */
  utcMs: number;
  ghi: number | null; dni: number | null; dhi: number | null; cloudPct: number | null; precipMm: number | null;
  tC: number | null; tdC: number | null; pPa: number | null; windMs: number | null; windDir: number | null;
}

const num = (s: string | undefined): number | null => (s === undefined || s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** GHCNh's pipe-separated station file (one year) → the reports; `elevationM` is read from its ELEVATION column */
export function parseGhcnh(psv: string): { obs: StationObs[]; station: string; name: string; elevationM: number | null; lat: number | null; lon: number | null } {
  const lines = psv.split(/\r?\n/).filter((l) => l.trim());
  const head = (lines[0] ?? "").split("|");
  const at = (k: string): number => head.indexOf(k);
  const iDate = at("DATE"), iT = at("temperature"), iTd = at("dew_point_temperature"), iP = at("station_level_pressure"), iA = at("altimeter");
  const iWd = at("wind_direction"), iWs = at("wind_speed"), iV = at("visibility"), iEl = at("ELEVATION"), iLat = at("LATITUDE"), iLon = at("LONGITUDE");
  const obs: StationObs[] = [];
  let station = "", name = "", elevationM: number | null = null, lat: number | null = null, lon: number | null = null;
  for (const l of lines.slice(1)) {
    const f = l.split("|");
    if (!station) { station = f[0] ?? ""; name = f[1] ?? ""; elevationM = num(f[iEl]); lat = num(f[iLat]); lon = num(f[iLon]); }
    const t = Date.parse(`${f[iDate]}Z`);
    if (!Number.isFinite(t)) continue;
    const p = num(f[iP]);
    obs.push({ utcMs: t, tC: num(f[iT]), tdC: num(f[iTd]), pStnPa: p === null ? null : p * 100, altimeterHpa: num(f[iA]), windDir: num(f[iWd]), windMs: num(f[iWs]), visKm: num(f[iV]) });
  }
  obs.sort((a, b) => a.utcMs - b.utcMs);
  return { obs, station, name, elevationM, lat, lon };
}

/** the archive's hourly JSON, asked for with timezone=GMT */
export const OPEN_METEO_HOURLY = ["temperature_2m", "dew_point_2m", "surface_pressure", "wind_speed_10m", "wind_direction_10m", "cloud_cover", "shortwave_radiation", "direct_normal_irradiance", "diffuse_radiation", "precipitation"] as const;
export function parseOpenMeteo(json: { hourly?: Record<string, Array<number | string | null>>; hourly_units?: Record<string, string> }): GridHour[] {
  const h = json.hourly ?? {};
  const time = (h["time"] ?? []) as string[];
  const v = (k: string, i: number): number | null => { const x = (h[k] ?? [])[i]; return typeof x === "number" && Number.isFinite(x) ? x : null; };
  // wind arrives in km/h unless asked otherwise — the unit the archive states is read, never assumed
  const kmh = (json.hourly_units?.["wind_speed_10m"] ?? "km/h") === "km/h";
  return time.map((t, i) => ({
    utcMs: Date.parse(`${t}:00Z`),
    ghi: v("shortwave_radiation", i), dni: v("direct_normal_irradiance", i), dhi: v("diffuse_radiation", i), cloudPct: v("cloud_cover", i), precipMm: v("precipitation", i),
    tC: v("temperature_2m", i), tdC: v("dew_point_2m", i), pPa: v("surface_pressure", i) === null ? null : v("surface_pressure", i)! * 100,
    windMs: v("wind_speed_10m", i) === null ? null : kmh ? v("wind_speed_10m", i)! / 3.6 : v("wind_speed_10m", i), windDir: v("wind_direction_10m", i),
  }));
}

/** the altimeter setting → the station pressure at the station's elevation (the NWS's own conversion, "Pressure Altitude / Station
 *  Pressure", weather.gov/media/epz/wxcalc/stationPressure.pdf): P = (A^0.190263 − 8.417286×10⁻⁵ · h)^(1/0.190263), hPa, h in m */
export const stationFromAltimeter = (aHpa: number, hM: number): number => Math.pow(Math.pow(aHpa, 0.190263) - 8.417286e-5 * hM, 1 / 0.190263);
/** the relative humidity from the dry-bulb and the dew point — the Magnus form, Alduchov & Eskridge (1996): es = 6.1094·exp(17.625T/(T+243.04)) */
export const rhOf = (tC: number, tdC: number): number => Math.max(0, Math.min(100, 100 * Math.exp((17.625 * tdC) / (tdC + 243.04) - (17.625 * tC) / (tC + 243.04))));

export interface AmyCounts {
  hours: number;
  /** per field: hours the station gave, hours filled by a line across a gap ≤ 6 h, hours from the reanalysis, hours left missing */
  fields: Record<string, { station: number; line: number; grid: number; missing: number }>;
  /** hours the site's radiation or cloud was absent, written as missing */
  gridMissing: number;
}

const DAY = 86_400_000, HOUR = 3_600_000;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const md = (ms: number): string => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, " ")}`; };

/** the EPW for [start, end] (local dates, YYYY-MM-DD, end inclusive) — the template's header lines kept, its COMMENTS and DATA PERIODS
 *  restated, every hour from the station and the site */
export function makeAmyEpw(a: {
  template: string; station: ReturnType<typeof parseGhcnh>; grid: GridHour[]; start: string; end: string;
  /** the site the grid was read at, for the comment */
  site: { lat: number; lon: number }; gridAt?: { lat: number; lon: number; elevationM: number | null } | null;
}): { epw: string; counts: AmyCounts; tzHours: number } {
  const tLines = a.template.split(/\r?\n/);
  const loc = tLines.find((l) => /^LOCATION,/i.test(l)) ?? "";
  const tz = Number(loc.split(",")[8]);
  if (!Number.isFinite(tz)) throw new Error("the template's LOCATION states no time zone");
  const keep = (re: RegExp): string => tLines.find((l) => re.test(l)) ?? "";
  const t0 = Date.parse(`${a.start}T00:00:00Z`), t1 = Date.parse(`${a.end}T00:00:00Z`);
  if (!(t1 >= t0)) throw new Error(`the period ${a.start} – ${a.end} is empty`);
  // the hours, as local-standard ends: hour h of local date D ends at D + h hours LOCAL = D + h − tz hours UTC
  const ends: number[] = [];
  for (let d = t0; d <= t1; d += DAY) for (let h = 1; h <= 24; h++) ends.push(d + h * HOUR - tz * HOUR);
  const n = ends.length;
  // the station's report nearest each hour's end, within 30 minutes — a field the nearest report lacks is taken from the nearest
  // report that has it within the same 30 minutes
  const obs = a.station.obs;
  const nearest = (t: number, pick: (o: StationObs) => number | null): number | null => {
    let lo = 0, hi = obs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (obs[m]!.utcMs < t) lo = m + 1; else hi = m; }
    let best: number | null = null, bestD = 30 * 60_000 + 1;
    for (let i = Math.max(0, lo - 6); i < Math.min(obs.length, lo + 6); i++) {
      const v = pick(obs[i]!), dt = Math.abs(obs[i]!.utcMs - t);
      if (v !== null && dt < bestD) { best = v; bestD = dt; }
    }
    return best;
  };
  const elev = a.station.elevationM ?? 0;
  const gridAtT = new Map(a.grid.map((g) => [g.utcMs, g]));
  const fields: AmyCounts["fields"] = {};
  // one station field over the period: the reports, a line across a gap of ≤ 6 hours, the reanalysis over a longer one
  const series = (key: string, st: (o: StationObs) => number | null, gr: (g: GridHour) => number | null, circular = false): Array<number | null> => {
    const v = ends.map((t) => nearest(t, st));
    const c = { station: v.filter((x) => x !== null).length, line: 0, grid: 0, missing: 0 };
    for (let i = 0; i < n; ) {
      if (v[i] !== null) { i++; continue; }
      let j = i; while (j < n && v[j] === null) j++;
      const prev = i > 0 ? v[i - 1]! : null, next = j < n ? v[j]! : null;
      if (j - i <= 6 && prev !== null && next !== null) {
        for (let k = i; k < j; k++) {
          const f = (k - i + 1) / (j - i + 1);
          if (circular) { let d = next - prev; if (d > 180) d -= 360; if (d < -180) d += 360; v[k] = (prev + f * d + 360) % 360; } else v[k] = prev + f * (next - prev);
          c.line++;
        }
      } else for (let k = i; k < j; k++) { const g = gridAtT.get(ends[k]!); const x = g ? gr(g) : null; v[k] = x; if (x === null) c.missing++; else c.grid++; }
      i = j;
    }
    fields[key] = c;
    return v;
  };
  const T = series("dry-bulb", (o) => o.tC, (g) => g.tC);
  const Td = series("dew point", (o) => o.tdC, (g) => g.tdC);
  const P = series("station pressure", (o) => o.pStnPa ?? (o.altimeterHpa === null ? null : stationFromAltimeter(o.altimeterHpa, elev) * 100), (g) => g.pPa);
  const Ws = series("wind speed", (o) => o.windMs, (g) => g.windMs);
  const Wd = series("wind direction", (o) => (o.windMs === 0 ? 0 : o.windDir), (g) => g.windDir, true);
  const Vis = ends.map((t) => nearest(t, (o) => o.visKm));
  let gridMissing = 0;
  const rows: string[] = [];
  const flags = "?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9";
  ends.forEach((t, i) => {
    const local = t + tz * HOUR;   // the hour's end, local standard
    const d = new Date(local - 1);  // the date the hour belongs to: hour 24 ends at the next midnight
    const hour = Math.round((local - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / HOUR);
    const g = gridAtT.get(t);
    if (!g || g.ghi === null || g.dni === null || g.dhi === null || g.cloudPct === null) gridMissing++;
    const t$ = T[i] ?? null, td0 = Td[i] ?? null, td$ = td0 !== null && t$ !== null ? Math.min(td0, t$) : td0;
    const sky = g?.cloudPct === null || g?.cloudPct === undefined ? 99 : Math.round(g.cloudPct / 10);
    const r = (x: number | null | undefined, dig: number, miss: string): string => (x === null || x === undefined ? miss : x.toFixed(dig));
    rows.push([
      d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, 0, flags,
      r(t$, 1, "99.9"), r(td$, 1, "99.9"), t$ !== null && td$ !== null ? Math.round(rhOf(t$, td$)) : 999, r(P[i], 0, "999999"),
      9999, 9999, 9999,   // extraterrestrial horizontal and direct normal, horizontal infrared: the engine derives them
      r(g?.ghi, 0, "9999"), r(g?.dni, 0, "9999"), r(g?.dhi, 0, "9999"),
      999999, 999999, 999999, 9999,   // illuminances and zenith luminance: the engine derives them
      r(Wd[i], 0, "999"), r(Ws[i], 1, "999"), sky, sky,
      r(Vis[i], 1, "9999"), 99999, 9, "999999999", 999, 0.999, 999, 99, 999,
      r(g?.precipMm, 1, "999"), g?.precipMm === null || g?.precipMm === undefined ? 99 : 1,
    ].join(","));
  });
  const counts: AmyCounts = { hours: n, fields, gridMissing };
  const fill = Object.entries(fields).map(([k, c]) => `${k} ${c.station} station/${c.line} line/${c.grid} reanalysis/${c.missing} missing`).join("; ");
  const first = ends[0]! + tz * HOUR - HOUR;
  const header = [
    loc,
    keep(/^DESIGN CONDITIONS,/i), keep(/^TYPICAL\/EXTREME PERIODS,/i), keep(/^GROUND TEMPERATURES,/i),
    "HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0",
    `COMMENTS 1,"AMY ${a.start} to ${a.end} (local standard time) -- measured at ${a.station.name} (GHCNh ${a.station.station}, NOAA NCEI): dry-bulb, dew point, station pressure, wind, visibility; sun, cloud and precipitation at ${Math.abs(a.site.lat).toFixed(4)} ${a.site.lat >= 0 ? "N" : "S"} ${Math.abs(a.site.lon).toFixed(4)} ${a.site.lon >= 0 ? "E" : "W"} from the Open-Meteo historical archive (Weather data by Open-Meteo.com, CC BY 4.0; its free API is for non-commercial use)${a.gridAt ? ` (its grid point ${a.gridAt.lat.toFixed(4)}, ${a.gridAt.lon.toFixed(4)})` : ""}; horizontal infrared, extraterrestrial radiation and illuminance left to EnergyPlus; header lines from the typical-year file"`,
    `COMMENTS 2,"hours ${n}: ${fill}; sun/cloud missing ${gridMissing} h; a gap <= 6 h filled by a line, a longer one by the reanalysis; RH from the dry-bulb and dew point (Magnus, Alduchov & Eskridge 1996); total = opaque sky cover (the archive states one)"`,
    `DATA PERIODS,1,1,Data,${DOW[new Date(first).getUTCDay()]},${md(t0)},${md(t1)}`,
  ];
  return { epw: [...header, ...rows].join("\n") + "\n", counts, tzHours: tz };
}
