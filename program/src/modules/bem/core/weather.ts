// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE WEATHER, READ FROM ITS OWN FILES. The design days come from the .ddy
// beside the EPW — every one it states, each with whether the engine would
// accept it (this station's summer object carries "N" for wet-bulb and the
// engine refuses it), the coldest and the hottest valid one chosen unless
// the user names the days; where no valid cooling day exists the weather
// file's own extreme summer week stands in. The EPW's header says what the
// file IS — the station, its position, the source years of a typical year,
// the ground temperatures at three depths — and the SITE panel shows that
// read beside what the IfcSite states. The reads go through an `io` so the
// gate (node) and the app (Electron IPC) run the same function.

import type { IdfWeather } from "./bemIdf.js";
import { readEpw, type EpwRead } from "./epwRead.js";

/** THE DEFAULT WEATHER FILE, until the user picks one on BEM › SITE: a file every EnergyPlus install carries in its WeatherData folder
 *  (Golden, Colorado, TMY3) — a placeholder that says so wherever it is shown, never a guess at the site's climate. A FILE NAME, not a
 *  path (2026-09-23): it is found by name in the project's Weather/ folder, then the engine's WeatherData, then any other install's
 *  (engineLocate.cjs `resolveEpw`); overridable with GATE_EPW */
export const DEFAULT_EPW = "USA_CO_Golden-NREL.724666_TMY3.epw";

export interface WeatherIo {
  exists(p: string): boolean;
  readText(p: string): string | null;
}

export interface DesignDay {
  name: string;
  month: number;
  day: number;
  /** WinterDesignDay / SummerDesignDay as the .ddy states it */
  type: string;
  maxDbC: number | null;
  /** the humidity condition and its value: "Wetbulb 24.1" */
  humidity: string;
  windMs: number | null;
  /** the engine accepts it: a dry-bulb, and a wet-bulb / dewpoint where the condition needs one */
  valid: boolean;
  /** the object as the file states it, verbatim */
  text: string;
}

export interface WeatherRead extends IdfWeather {
  epw: string;
  /** the sizing periods chosen, by name and dry-bulb, for the census */
  picked: string[];
  /** .ddy objects the engine would refuse (no wet-bulb, no dry-bulb) */
  invalid: number;
  /** every design day the .ddy states */
  days: DesignDay[];
  /** the .ddy's own word on the climate zone ("3A"), when it states one */
  climateZone: string | null;
  /** the EPW's header: station, position, source years, ground temperatures */
  header: EpwRead | null;
}

export interface WeatherOptions {
  /** the user's design days, by name; unset = the coldest and the hottest valid */
  designDays?: string[];
  /** the header read costs the whole EPW (1.6 MB); the gate and the app want it, a twin comparison does not */
  readHeader?: boolean;
}

/** every SizingPeriod:DesignDay a .ddy states, with whether the engine would accept it, and the file's climate-zone word */
export function parseDdy(ddyText: string): { days: DesignDay[]; climateZone: string | null } {
  const days: DesignDay[] = [];
  let climateZone: string | null = null;
  const cz = /Climate Zone\s*=\s*"?([0-9][A-C]?)"?/i.exec(ddyText);
  if (cz) climateZone = cz[1]!;
  const clean = ddyText.split(/\r?\n/).map((l) => l.replace(/!.*$/, "")).join("\n");
  for (const m of clean.matchAll(/SizingPeriod:DesignDay\s*,([^;]*);/g)) {
    const f = m[1]!.split(",").map((x) => x.trim());
    const maxDb = Number(f[4]);
    const humidityOk = !/^(Wetbulb|Dewpoint)$/i.test(f[8] ?? "") || Number.isFinite(Number(f[9]));
    days.push({
      name: f[0]!, month: Number(f[1]), day: Number(f[2]), type: f[3] ?? "",
      maxDbC: Number.isFinite(maxDb) ? maxDb : null,
      humidity: `${f[8] ?? ""}${Number.isFinite(Number(f[9])) ? ` ${Number(f[9])}` : f[9] ? ` ${f[9]}` : ""}`.trim(),
      windMs: Number.isFinite(Number(f[15])) ? Number(f[15]) : null,
      valid: Number.isFinite(maxDb) && humidityOk,
      text: `SizingPeriod:DesignDay,\n` + f.map((x) => `    ${x}`).join(",\n") + ";",
    });
  }
  return { days, climateZone };
}

/** HUMIDITY MEASURED (2026-09-07, the legend): a .ddy with a valid summer design day carries a
 *  wet-bulb the station measured; a tide gauge's has none and the engine
 *  refuses its summer object — measured on 2026-09-04 */
export function humidityMeasured(ddyText: string): boolean {
  return parseDdy(ddyText).days.some((d) => d.valid && /summer/i.test(d.type) && /^(Wetbulb|Dewpoint)/i.test(d.humidity));
}

export function readWeather(epw: string, io: WeatherIo, opts: WeatherOptions = {}): WeatherRead | null {
  if (!io.exists(epw)) return null;
  const ddy = epw.replace(/\.epw$/i, ".ddy");
  let days: DesignDay[] = [];
  let climateZone: string | null = null;
  const ddyText = io.readText(ddy);
  if (ddyText !== null) ({ days, climateZone } = parseDdy(ddyText));
  const valid = days.filter((d) => d.valid).sort((a, b) => (a.maxDbC ?? 0) - (b.maxDbC ?? 0));
  let pick: DesignDay[];
  if (opts.designDays && opts.designDays.length) {
    pick = opts.designDays.map((n) => valid.find((d) => d.name === n)).filter((d): d is DesignDay => !!d);
  } else {
    const coldest = valid[0];
    const hottest = [...valid].reverse().find((d) => /summer/i.test(d.type));
    pick = [coldest, hottest].filter((d): d is DesignDay => !!d);
  }
  const hasSummer = pick.some((d) => /summer/i.test(d.type));
  const header = opts.readHeader === false ? null : (() => { const t = io.readText(epw); return t ? readEpw(t) : null; })();
  return {
    epw,
    designDayIdf: pick.map((d) => d.text),
    summerFromWeatherFile: !hasSummer,
    runYear: true,
    amy: header?.kind === "AMY" && header.firstDate && header.lastDate ? { begin: header.firstDate, end: header.lastDate } : null,
    epwName: (epw.split(/[\\/]/).pop() ?? epw).replace(/\.epw$/i, ""),
    picked: pick.map((d) => `${d.name} (${d.maxDbC} °C)`)
      .concat(hasSummer ? [] : ["summer = the weather file's own extreme week (no valid cooling design day in the .ddy)"]),
    invalid: days.length - valid.length,
    days,
    climateZone,
    header,
  };
}

/** great-circle distance between two positions, km — a number the user reads, not one the model uses */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
