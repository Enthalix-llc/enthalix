// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// MAKE AN ACTUAL-YEAR WEATHER FILE (2026-10-07): the station's measured hours (NOAA NCEI GHCNh) and the site's sun and sky (the
// Open-Meteo historical archive), both without a key, into Weather/ beside the typical-year file whose header it keeps. The
// downloads are kept in data/cache/weather/ (a year's station file is fetched again only when the period reaches past what it held).
//
//   pnpm tsx scripts/makeEpw.ts --start 2025-01-01 --end 2025-12-31 --lat <site latitude> --lon <site longitude>
//                               --station <GHCNh station id, e.g. USW00013743> --template <the typical-year EPW stem in Weather/>
//
// Open-Meteo's free archive is for NON-COMMERCIAL use only (open-meteo.com/en/terms); its data is CC BY 4.0: "Weather data by
// Open-Meteo.com". NOAA's GHCNh hours are CC0.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGhcnh, parseOpenMeteo, makeAmyEpw, OPEN_METEO_HOURLY } from "../src/modules/bem/core/amyEpw.js";
import { readEpw } from "../src/modules/bem/core/epwRead.js";

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const need = (k: string): string => { const v = arg(k, ""); if (!v) { console.error(`--${k} is required (see the usage at the top of scripts/makeEpw.ts)`); process.exit(2); } return v; };
const start = arg("start", "2025-01-01"), end = arg("end", "2025-12-31");
const lat = Number(need("lat")), lon = Number(need("lon"));
const stationId = need("station");
const tplStem = need("template");
const root = path.resolve(import.meta.dirname, "../..");
const weatherDir = path.join(root, "Weather"), cache = path.join(root, "data/cache/weather");
mkdirSync(cache, { recursive: true });

const get = async (url: string, file: string, maxAgeDays: number): Promise<string> => {
  const p = path.join(cache, file);
  if (existsSync(p) && maxAgeDays > 0) {
    const { mtimeMs } = await import("node:fs").then((m) => m.statSync(p));
    if (Date.now() - mtimeMs < maxAgeDays * 86_400_000) return readFileSync(p, "utf8");
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const t = await r.text();
  writeFileSync(p, t);
  return t;
};

// the station's years the period touches, a day either side for the time zone
const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
const thisYear = new Date().getUTCFullYear();
let psv = "";
for (let y = y0 - (start.slice(5) === "01-01" ? 1 : 0); y <= y1 + (end.slice(5) === "12-31" ? 1 : 0); y++) {
  if (y > thisYear) continue;
  const url = `https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/${y}/psv/GHCNh_${stationId}_${y}.psv`;
  // a past year's file is final; the current year's is fetched again after a day
  const t = await get(url, `GHCNh_${stationId}_${y}.psv`, y < thisYear ? 3650 : 1);
  psv += psv ? `\n${t.split(/\r?\n/).slice(1).join("\n")}` : t;
}
const station = parseGhcnh(psv);
const dayBefore = new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const dayAfter = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const omUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dayBefore}&end_date=${dayAfter}&hourly=${OPEN_METEO_HOURLY.join(",")}&timezone=GMT`;
const omText = await get(omUrl, `open-meteo_${lat}_${lon}_${dayBefore}_${dayAfter}.json`, 1);
const om = JSON.parse(omText) as Parameters<typeof parseOpenMeteo>[0] & { latitude?: number; longitude?: number; elevation?: number; reason?: string };
if (om.reason) throw new Error(`Open-Meteo: ${om.reason}`);
const grid = parseOpenMeteo(om);
const template = readFileSync(path.join(weatherDir, `${tplStem}.epw`), "utf8");

const out = makeAmyEpw({ template, station, grid, start, end, site: { lat, lon }, gridAt: om.latitude !== undefined ? { lat: om.latitude, lon: om.longitude!, elevationM: om.elevation ?? null } : null });
const stem = `${tplStem.replace(/_TMY[^_]*([._-].*)?$/i, "")}_AMY_${start}_${end}_GHCNh-OpenMeteo`;   // the template's place name, the actual year's dates
const epwPath = path.join(weatherDir, `${stem}.epw`);
writeFileSync(epwPath, out.epw);
const ddy = path.join(weatherDir, `${tplStem}.ddy`);
if (existsSync(ddy)) copyFileSync(ddy, path.join(weatherDir, `${stem}.ddy`));
const back = readEpw(out.epw);
console.log(`WROTE ${epwPath}`);
console.log(`  ${station.name} (${station.station}, ${station.lat} ${station.lon}, ${station.elevationM} m) · ${station.obs.length} reports · the site ${lat}, ${lon} → Open-Meteo's grid point ${om.latitude}, ${om.longitude}`);
console.log(`  read back: ${back.kind} · years ${back.years.join(", ")} · ${back.hours} h · data period ${back.dataPeriod}`);
for (const [k, c] of Object.entries(out.counts.fields)) console.log(`  ${k}: ${c.station} h the station · ${c.line} h a line across a gap ≤ 6 h · ${c.grid} h the reanalysis · ${c.missing} h missing`);
console.log(`  sun and cloud missing: ${out.counts.gridMissing} h · the .ddy copied beside it: ${existsSync(ddy) ? "yes" : "no"}`);
