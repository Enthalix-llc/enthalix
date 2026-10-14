// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT THE WEATHER FILE SAYS ABOUT ITSELF. A TMY is typical: its header
// states the source year of every month ("#years=[15] … Jan=2021; Feb=2022;
// Mar=2017 …") and the Year column of its 8760 rows carries them — so no
// bill period ever happened under it, and a calibration against bills is
// withheld. An actual-year file has one contiguous year. The header also
// states the station and its position (which is not the site's) and the
// ground temperatures at three depths, month by month — the SITE panel's
// `file` values. Lives in BEM (2026-09-04): BEM is upstream of BOM.

export interface EpwGround { depthM: number; monthsC: number[] }

export interface EpwRead {
  station: string;
  stateCountry: string;
  wmo: string;
  latitude: number | null;
  longitude: number | null;
  timeZone: number | null;
  elevationM: number | null;
  comment: string;
  /** distinct years in the data rows */
  years: number[];
  hours: number;
  kind: "TMY" | "AMY" | "unknown";
  /** the first and the last data rows' dates, [year, month, day] — an actual year's run period (2026-10-07) */
  firstDate: [number, number, number] | null;
  lastDate: [number, number, number] | null;
  /** the data period the header states */
  dataPeriod: string;
  /** HOLIDAYS/DAYLIGHT SAVINGS (2026-09-13): the leap-year flag and the daylight-saving span as written, the holidays by name and date */
  dst: string;
  holidays: Array<{ name: string; date: string }>;
  /** GROUND TEMPERATURES: each depth's twelve monthly values, as stated */
  ground: EpwGround[];
  /** THE AIR TEMPERATURES (2026-09-15): the rows' dry-bulb averaged per month and over the year — the ground estimate's inputs; null without rows */
  monthlyDryBulbC: number[] | null;
  annualDryBulbC: number | null;
  /** the dry-bulb hours counted in each month (2026-10-07) — a month the file holds only a day of reads as a day, not a month */
  monthlyDryBulbHours: number[];
  /** each month's mean dry-bulb over the hours it holds, NaN for a month with none */
  monthlyDryBulbMeanC: number[];
}

export function readEpw(text: string): EpwRead {
  const lines = text.split(/\r?\n/);
  let station = "", stateCountry = "", wmo = "", lat: number | null = null, lon: number | null = null, tz: number | null = null, elev: number | null = null, comment = "", dataPeriod = "", dst = "";
  const holidays: Array<{ name: string; date: string }> = [];
  const ground: EpwGround[] = [];
  const years = new Set<number>();
  let hours = 0;
  let firstDate: [number, number, number] | null = null, lastDate: [number, number, number] | null = null;
  const dbSum = Array<number>(12).fill(0), dbN = Array<number>(12).fill(0);
  const num = (s: string | undefined): number | null => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : null);
  for (const line of lines) {
    if (/^LOCATION,/i.test(line)) {
      const f = line.split(",");
      station = f[1] ?? ""; stateCountry = `${f[2] ?? ""} ${f[3] ?? ""}`.trim(); wmo = f[5] ?? "";
      lat = num(f[6]); lon = num(f[7]); tz = num(f[8]); elev = num(f[9]);
      continue;
    }
    if (/^COMMENTS 1,/i.test(line)) { comment = line.slice("COMMENTS 1,".length).trim(); continue; }
    if (/^DATA PERIODS,/i.test(line)) { dataPeriod = line.split(",").slice(1).join(", ").trim(); continue; }
    if (/^GROUND TEMPERATURES,/i.test(line)) {
      // GROUND TEMPERATURES, n, depth, cond, density, cp, Jan..Dec, depth, …
      const f = line.split(",").slice(2);
      for (let i = 0; i + 15 < f.length; i += 16) {
        const depth = num(f[i]), months = f.slice(i + 4, i + 16).map((x) => Number(x));
        if (depth !== null && months.every((v) => Number.isFinite(v))) ground.push({ depthM: depth, monthsC: months });
      }
      continue;
    }
    if (/^HOLIDAYS\/DAYLIGHT SAVINGS,/i.test(line)) {
      // leap year observed, DST start, DST end, N holidays, then name, date pairs
      const f = line.split(",").map((x) => x.trim());
      dst = `leap year ${f[1] ?? ""} · daylight saving ${f[2] || "none"}${f[3] ? ` – ${f[3]}` : ""}`;
      const n = Number(f[4] ?? 0);
      for (let i = 0; i < n && 5 + 2 * i + 1 < f.length; i++) holidays.push({ name: f[5 + 2 * i] ?? "", date: f[6 + 2 * i] ?? "" });
      continue;
    }
    if (/^(DESIGN CONDITIONS|TYPICAL\/EXTREME PERIODS|COMMENTS 2),/i.test(line)) continue;
    const m = /^(\d{4}),(\d{1,2}),(\d{1,2}),(\d{1,2}),/.exec(line);
    if (m) {
      years.add(Number(m[1])); hours++;
      lastDate = [Number(m[1]), Number(m[2]), Number(m[3])]; if (!firstDate) firstDate = lastDate;
      const mo = Number(m[2]) - 1, db = Number(line.split(",")[6]);
      if (mo >= 0 && mo < 12 && Number.isFinite(db) && db > -70 && db < 70) { dbSum[mo] = (dbSum[mo] ?? 0) + db; dbN[mo] = (dbN[mo] ?? 0) + 1; }   // 99.9 is the EPW's missing-value flag
    }
  }
  const monthlyDryBulbC = dbN.every((n) => n > 0) ? dbSum.map((s, i) => s / dbN[i]!) : null;
  const annualDryBulbC = monthlyDryBulbC ? dbSum.reduce((t, v) => t + v, 0) / dbN.reduce((t, v) => t + v, 0) : null;
  const ys = [...years].sort((a, b) => a - b);
  const kind: EpwRead["kind"] = hours === 0 ? "unknown" : ys.length === 1 || /^"?\s*(AMY|actual)/i.test(comment) && ys.length <= 2 ? "AMY" : "TMY";
  return { station, stateCountry, wmo, latitude: lat, longitude: lon, timeZone: tz, elevationM: elev, comment, years: ys, hours, kind, firstDate, lastDate, dataPeriod, dst, holidays, ground, monthlyDryBulbC, annualDryBulbC, monthlyDryBulbHours: dbN, monthlyDryBulbMeanC: dbSum.map((s, i) => (dbN[i] ? s / dbN[i]! : NaN)) };
}

/** THE MAINS FROM AN ACTUAL YEAR THAT IS NOT A CALENDAR YEAR (2026-10-07). Site:WaterMainsTemperature CorrelationFromWeatherFile
 *  takes its two inputs — the annual average outdoor dry-bulb and the largest difference between monthly averages — from the file
 *  as if it ran Jan 1 → Dec 31; on a file from 2025-11-01 to 2026-10-01 the engine read −8,205.68 °C and 96,798.73 K, the July
 *  mains came to 6.4 million °C and the first draw on the design day ran the tanks away (Fatal). Here the same two inputs from the
 *  file's own rows — over the months it holds whole (28 days or more of hours), each month's mean of its hours, the year the mean of
 *  all those hours — for the Correlation method. Null where the engine's own reading is right: a typical year, or an actual year
 *  that is one calendar year from Jan 1. */
export function mainsCorrelation(h: EpwRead | null): { annualC: number; maxDiffC: number; months: number; words: string } | null {
  if (!h || h.kind !== "AMY") return null;
  if (h.firstDate && h.firstDate[1] === 1 && h.firstDate[2] === 1 && h.hours >= 8760) return null;
  const whole = h.monthlyDryBulbHours.map((n, m) => (n >= 28 * 24 ? m : -1)).filter((m) => m >= 0);
  if (!whole.length) return null;
  const means = whole.map((m) => h.monthlyDryBulbMeanC[m]!);
  const hours = whole.reduce((t, m) => t + h.monthlyDryBulbHours[m]!, 0);
  const annualC = whole.reduce((t, m) => t + h.monthlyDryBulbMeanC[m]! * h.monthlyDryBulbHours[m]!, 0) / hours;
  const maxDiffC = Math.max(...means) - Math.min(...means);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const left = names.filter((_, m) => !whole.includes(m));
  return { annualC, maxDiffC, months: whole.length,
    words: `the weather file's own ${whole.length} whole months (${left.length ? `${left.join(", ")} held for less than 28 days, left out` : "all twelve"}): annual mean ${annualC.toFixed(2)} °C, monthly means differ by ${maxDiffC.toFixed(2)} K` };
}

/** the one line a panel shows */
export function describeEpw(r: EpwRead | null, coveredPeriods?: { covered: number; total: number }): string {
  if (!r) return "no weather file read";
  const cov = coveredPeriods ? ` · covers ${coveredPeriods.covered}/${coveredPeriods.total} periods` : "";
  if (r.kind === "AMY") return `AMY ${r.years.join("–")} · ${r.hours} h · ${r.station}${cov}`;
  if (r.kind === "TMY") return `TMYx: ${r.years.length} source years (${r.years[0]}–${r.years[r.years.length - 1]}) · ${r.station} — cannot calibrate`;
  return `${r.station || "weather"}: no data rows read`;
}
