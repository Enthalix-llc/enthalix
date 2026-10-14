// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ONE DERIVATION IN THE OPERATIONS MODEL, and it is a statistic, not a
// model fact: ASHRAE Guideline 14-2014 §5.2.11, the calibrated-simulation
// case. Measured bills against the run's daily meter summed over each
// bill's OWN period — bill periods, never calendar months. Printed beside
// its inputs; the verdict is WITHHELD while any caveat stands (too few
// periods, a typical-year weather file, a meter the run did not report).
//
//   NMBE   = Σ(m_i − s_i) / ((n − p)·m̄) × 100
//   CVRMSE = √(Σ(m_i − s_i)² / (n − p)) / m̄ × 100          p = 1
//   bill periods: |NMBE| ≤ 5, CVRMSE ≤ 15 · hourly: ≤ 10, ≤ 30

import type { BillRow } from "./csvRead.js";
import { priceMonths, monthFromBill, type TariffCard, type PcaRuling, type BillLine } from "./tariff.js";

export interface DailyMeter { name: string; month: number; day: number; /** J */ value: number }

export interface PeriodResult {
  bill: BillRow;
  /** the run's meter over the bill's period, kWh */
  modelledKwh: number;
  /** every day of the period had a daily value */
  covered: boolean;
  daysCovered: number;
}

const J_PER_KWH = 3.6e6;

/** the bill's days as (month, day) pairs — the run's year is nominal */
function periodDays(startIso: string, endIso: string): Array<[number, number]> {
  const y0 = Number(startIso.slice(0, 4)), m0 = Number(startIso.slice(5, 7)), d0 = Number(startIso.slice(8, 10));
  const y1 = Number(endIso.slice(0, 4)), m1 = Number(endIso.slice(5, 7)), d1 = Number(endIso.slice(8, 10));
  const out: Array<[number, number]> = [];
  const t = new Date(Date.UTC(y0, m0 - 1, d0)), end = Date.UTC(y1, m1 - 1, d1);
  for (let k = 0; k < 400 && t.getTime() <= end; k++) {
    out.push([t.getUTCMonth() + 1, t.getUTCDate()]);
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** each bill against the sum of the named meters over its own days */
export function billPeriods(bills: BillRow[], daily: DailyMeter[], meters: string[]): PeriodResult[] {
  const byDay = new Map<string, number>();
  for (const d of daily) {
    if (!meters.includes(d.name)) continue;
    const k = `${d.month}-${d.day}`;
    byDay.set(k, (byDay.get(k) ?? 0) + d.value);
  }
  return bills.map((bill) => {
    let sumJ = 0, covered = 0;
    const days = periodDays(bill.periodStart, bill.periodEnd);
    for (const [m, d] of days) {
      const v = byDay.get(`${m}-${d}`);
      if (v !== undefined) { sumJ += v; covered++; }
    }
    return { bill, modelledKwh: sumJ / J_PER_KWH, covered: covered === days.length && days.length > 0, daysCovered: covered };
  });
}

// ── THE CALIBRATION RUN, BY DATE (2026-10-09) ─────────────────────────────────────────────────────────────────────────────────────
// A run on the actual year is DATED: each hour is summed into its calendar date (the run's first hour as the engine dated it, local
// standard time — the weather file's frame), and each bill sums its own dates. The typical year's month-day path above stays for a
// typical run, whose year is nominal. Three pairs, each the bill's own row against the run's own meter: Consumption (delivered)
// against ElectricityPurchased, Generation (sent to the grid) against ElectricitySurplusSold, Net against ElectricityNet — and the
// panels' measured production against ElectricityProduced. Before the PV was connected, the house was billed as a house without PV:
// its own use bought, nothing sold or made — the panels change no load, so the run's facility use stands for those days.

export interface HourSeries { name: string; units: string; values: number[]; start?: [number, number, number] }
export interface CalibDay { facility: number; purchased: number; sold: number; net: number; produced: number }
export const METERS = { facility: "Electricity:Facility", purchased: "ElectricityPurchased:Facility", sold: "ElectricitySurplusSold:Facility", net: "ElectricityNet:Facility", produced: "ElectricityProduced:Facility" } as const;

const isoAdd = (y: number, m: number, d: number, add: number): string => new Date(Date.UTC(y, m - 1, d + add)).toISOString().slice(0, 10);

/** the run's hours summed into calendar dates, kWh; before `pvOn` (an ISO date) the day is the house without PV */
export function calibrationDays(hourly: HourSeries[], pvOn: string | null): Map<string, CalibDay> {
  const days = new Map<string, CalibDay>();
  const of = (k: keyof typeof METERS): HourSeries | undefined => hourly.find((h) => h.name.toUpperCase() === METERS[k].toUpperCase());
  const fac = of("facility");
  if (!fac?.start) return days;
  const per = (h: HourSeries | undefined): number => (h && /kwh/i.test(h.units) ? 1 : J_PER_KWH);
  const [y, m, d] = fac.start;
  const sum = (h: HourSeries | undefined, i: number): number => (h ? (h.values[i] ?? 0) / per(h) : 0);
  const pur = of("purchased"), sold = of("sold"), net = of("net"), prod = of("produced");
  for (let i = 0; i < fac.values.length; i++) {
    // hour i ends at (i + 1) h: the 24th hour of a day is still that day
    const date = isoAdd(y, m, d, Math.floor(i / 24));
    const dd = days.get(date) ?? days.set(date, { facility: 0, purchased: 0, sold: 0, net: 0, produced: 0 }).get(date)!;
    const f = sum(fac, i);
    dd.facility += f;
    if (pvOn && date < pvOn) { dd.purchased += f; dd.net += f; continue; }
    // a run without PV reports no Purchased / Net: the facility is both
    dd.purchased += pur ? sum(pur, i) : f; dd.sold += sum(sold, i); dd.net += net ? sum(net, i) : f; dd.produced += sum(prod, i);
  }
  return days;
}

/** the run's hours with every hour before `pvOn` made the house without PV — its facility use bought, nothing sold or made — so the
 *  tariff prices the calibration run as the bills were billed (2026-10-10) */
export function pvOffBefore(hourly: HourSeries[], pvOn: string | null): HourSeries[] {
  const fac = hourly.find((h) => h.name.toUpperCase() === METERS.facility.toUpperCase());
  if (!pvOn || !fac?.start) return hourly;
  const per = (h: HourSeries): number => (/kwh/i.test(h.units) ? 1 : J_PER_KWH);
  const [y, m, d] = fac.start;
  let cut = 0;
  while (cut < fac.values.length && isoAdd(y, m, d, Math.floor(cut / 24)) < pvOn) cut++;
  if (cut === 0) return hourly;
  const role = (h: HourSeries): keyof typeof METERS | null => (Object.keys(METERS) as Array<keyof typeof METERS>).find((k) => METERS[k].toUpperCase() === h.name.toUpperCase()) ?? null;
  return hourly.map((h) => {
    const r = role(h);
    if (r !== "purchased" && r !== "net" && r !== "sold" && r !== "produced") return h;
    const values = h.values.slice();
    for (let i = 0; i < cut && i < values.length; i++) values[i] = r === "purchased" || r === "net" ? ((fac.values[i] ?? 0) / per(fac)) * per(h) : 0;
    return { ...h, values };
  });
}

export interface PairPeriod {
  bill: BillRow;
  /** the bill's rows and the run's, kWh — a row the bill does not state is null */
  consumption: { billed: number | null; model: number };
  generation: { billed: number | null; model: number };
  net: { billed: number; model: number };
  /** the panels' measured production over the dates the export holds, and the run's over the same dates */
  pv: { measured: number; model: number; days: number } | null;
  covered: boolean;
  daysCovered: number;
  days: number;
}

/** the bill's own dates, from its first day to its last (the BillRow's end is the day before the meter read) */
export function billDates(bill: BillRow): string[] {
  const out: string[] = [];
  const t = new Date(`${bill.periodStart}T00:00:00Z`), end = Date.parse(`${bill.periodEnd}T00:00:00Z`);
  for (let k = 0; k < 400 && t.getTime() <= end; k++) { out.push(t.toISOString().slice(0, 10)); t.setUTCDate(t.getUTCDate() + 1); }
  return out;
}

export function calibrationPeriods(bills: BillRow[], days: Map<string, CalibDay>, pvDays?: ReadonlyMap<string, number>, pvOn?: string | null): PairPeriod[] {
  return bills.map((bill) => {
    const dates = billDates(bill);
    let covered = 0, pur = 0, sold = 0, net = 0, pm = 0, pr = 0, pd = 0;
    for (const dt of dates) {
      const d = days.get(dt);
      if (!d) continue;
      covered++; pur += d.purchased; sold += d.sold; net += d.net;
      const meas = pvDays?.get(dt);
      if (meas !== undefined && (!pvOn || dt >= pvOn)) { pm += meas; pr += d.produced; pd++; }
    }
    const recv = bill.receivedKwh ?? null;
    return {
      bill, covered: covered === dates.length && dates.length > 0, daysCovered: covered, days: dates.length,
      consumption: { billed: recv === null ? null : bill.measured + recv, model: pur },
      generation: { billed: recv, model: sold },
      net: { billed: bill.measured, model: net },
      pv: pd ? { measured: pm, model: pr, days: pd } : null,
    };
  });
}

/** Guideline 14 on each pair over the covered periods (a period with the row unstated left out) */
export function pairStats(periods: PairPeriod[]): { consumption: G14 | null; generation: G14 | null; net: G14 | null; pv: G14 | null } {
  const cov = periods.filter((p) => p.covered);
  const g = (rows: Array<[number, number]>): G14 | null => (rows.length ? guideline14(rows.map((r) => r[0]), rows.map((r) => r[1])) : null);
  return {
    consumption: g(cov.filter((p) => p.consumption.billed !== null).map((p) => [p.consumption.billed!, p.consumption.model])),
    generation: g(cov.filter((p) => p.generation.billed !== null).map((p) => [p.generation.billed!, p.generation.model])),
    net: g(cov.map((p) => [p.net.billed, p.net.model])),
    // the PV over the periods the export covers whole, after the connection
    pv: g(periods.filter((p) => p.pv && p.pv.days === p.days).map((p) => [p.pv!.measured, p.pv!.model])),
  };
}

export interface G14 { n: number; p: number; meanMeasured: number; nmbePct: number; cvrmsePct: number }

export function guideline14(measured: number[], simulated: number[], p = 1): G14 {
  const n = measured.length;
  const mean = n ? measured.reduce((t, v) => t + v, 0) / n : 0;
  if (n - p <= 0 || mean === 0) return { n, p, meanMeasured: mean, nmbePct: NaN, cvrmsePct: NaN };
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) { const e = measured[i]! - simulated[i]!; sum += e; sumSq += e * e; }
  return {
    n, p, meanMeasured: mean,
    nmbePct: (sum / ((n - p) * mean)) * 100,
    cvrmsePct: (Math.sqrt(sumSq / (n - p)) / mean) * 100,
  };
}

export interface Verdict {
  basis: "bill periods" | "hourly";
  limitCvrmse: number;
  limitNmbe: number;
  /** "calibrated" / "not calibrated" when no caveat stands; "withheld" otherwise; "comparison" when the weather is the actual year's but
   *  its sun and sky are estimates (user, 2026-10-08: "this will not be a true calibration model") — the statistic shown, never a verdict */
  verdict: "calibrated" | "not calibrated" | "withheld" | "comparison";
  caveats: string[];
  /** what stands under a comparison — said beside the statistic, not withholding it */
  notes: string[];
}

/** an actual-year file whose sun and sky are not measured: the app's own (makeEpw / BOM › WEATHER) says so in its first comment */
export const sunEstimated = (epwComment: string): boolean => /Open-Meteo|reanalysis/i.test(epwComment);

export function verdictFor(g: G14, opts: { basis: "bill periods" | "hourly"; epwKind: "TMY" | "AMY" | "unknown"; epwYears?: number[]; metersInRun: boolean; uncovered: number; estimatedSun?: boolean;
  /** further pairs that must ALSO fall within the limits (the calibration run: Consumption beside Net) */
  also?: G14[];
  /** the estimated sun checked against the panels' measured production, bill period by bill period (2026-10-09) */
  pvCheck?: G14 | null }): Verdict {
  const hourly = opts.basis === "hourly";
  const limitCvrmse = hourly ? 30 : 15, limitNmbe = hourly ? 10 : 5;
  const caveats: string[] = [];
  if (!(g.n >= 12)) caveats.push(`insufficient periods (${g.n} of the 12 Guideline 14 asks for)`);
  if (opts.epwKind === "TMY") caveats.push(`weather is typical${opts.epwYears?.length ? ` (${opts.epwYears.length} source years)` : ""} — the bills were not metered under it`);
  if (opts.epwKind === "unknown") caveats.push("weather file not read");
  if (!opts.metersInRun) caveats.push("meter not in run — the run reports no meter the bills were mapped to");
  if (opts.uncovered > 0) caveats.push(`${opts.uncovered} bill period(s) not covered by the run`);
  if (!Number.isFinite(g.cvrmsePct)) caveats.push("the statistic is undefined (no periods or a zero mean)");
  const inLimits = (x: G14): boolean => Math.abs(x.nmbePct) <= limitNmbe && x.cvrmsePct <= limitCvrmse;
  const within = inLimits(g) && (opts.also ?? []).every(inLimits);
  // THE SUN CHECKED (2026-10-09): the one estimated input tested against a measurement at this site — the panels' own production
  if (!caveats.length && opts.epwKind === "AMY" && opts.estimatedSun && opts.pvCheck && Number.isFinite(opts.pvCheck.nmbePct)) {
    const pv = opts.pvCheck, pvLine = `NMBE ${pv.nmbePct.toFixed(1)} % · CVRMSE ${pv.cvrmsePct.toFixed(1)} % over ${pv.n} bill periods`;
    if (inLimits(pv)) return { basis: opts.basis, limitCvrmse, limitNmbe, verdict: within ? "calibrated" : "not calibrated", caveats, notes: [
      `the estimated sun checked against your measured PV — ${pvLine}, within Guideline 14's limits`,
      "temperature, humidity and wind are the station's readings; the sun and sky the Open-Meteo archive at the site, checked by the panels",
    ] };
    return { basis: opts.basis, limitCvrmse, limitNmbe, verdict: "comparison", caveats, notes: [
      `comparison — the estimated sun disagrees with your measured PV: ${pvLine}`,
      `the bills are ${within ? "within" : "outside"} Guideline 14's limits for ${opts.basis}, on a sun the panels do not confirm`,
    ] };
  }
  if (!caveats.length && opts.epwKind === "AMY" && opts.estimatedSun) {
    return { basis: opts.basis, limitCvrmse, limitNmbe, verdict: "comparison", caveats, notes: [
      `comparison, not calibration — ${within ? "within" : "outside"} Guideline 14's limits for ${opts.basis}`,
      "the sun and sky are estimates (the Open-Meteo archive at the site), not measured; temperature, humidity and wind are the station's readings",
      "filled hours are counted in the weather file's own comments",
    ] };
  }
  return { basis: opts.basis, limitCvrmse, limitNmbe, verdict: caveats.length ? "withheld" : within ? "calibrated" : "not calibrated", caveats, notes: [] };
}

/** a seeded PRNG (mulberry32) for the gate's fixture — the same bills every run */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** a standard normal from two uniforms */
export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── THE BILLS WITHOUT THE PV (user, 2026-10-10: "show Standard w/o and w/ PV, Calibrated w/o and w/ PV, and Billed w/o and w/ PV") ──
// The bills state what the grid delivered and what it took back; without the panels the grid would have delivered the house's whole use:
// the bill's net plus what the panels made (measured, the Enphase export), nothing sent back. The card prices both usages in the bills'
// order, its credit bank carried as it is; each bill's own total is moved by the card's difference — its taxes and one-off charges kept
// as billed. An ESTIMATE, said so: a bill whose days the export does not hold after the connection is left out, named.
export interface BillNoPv { bill: BillRow; pvKwh: number | null; withPv: BillLine; withoutPv: BillLine | null; usd: number | null; why: string }

export function billedWithoutPv(card: TariffCard, t: { pca?: PcaRuling; nemStartMonth?: number } | undefined, bills: BillRow[], pvDays: ReadonlyMap<string, number> | null, pvOn: string | null): BillNoPv[] {
  const sorted = [...bills].filter((b) => /elec/i.test(b.fuel) || !b.fuel).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const pv = sorted.map((b): number | null => {
    let sum = 0;
    for (const d of billDates(b)) {
      if (pvOn && d < pvOn) continue;
      const v = pvDays?.get(d);
      if (v === undefined) return pvOn && b.periodEnd < pvOn ? 0 : null;
      sum += v;
    }
    return sum;
  });
  const start = Math.min(12, Math.max(1, t?.nemStartMonth ?? 1));
  const withUm = sorted.map((b) => monthFromBill(b));
  const ps = Math.max(0, withUm.findIndex((m) => m.month === start));
  const opts = { ...(t?.pca ? { pca: t.pca } : {}), periodStart: ps };
  const withL = priceMonths(card, withUm, opts).lines;
  // a period the export does not hold keeps its billed usage, so the bank carries; its own bar is left out
  const noL = priceMonths(card, sorted.map((b, i) => monthFromBill(pv[i] === null ? b : { ...b, measured: b.measured + pv[i]!, receivedKwh: 0 })), opts).lines;
  return sorted.map((bill, i) => {
    const p = pv[i]!, w = withL[i]!, n = p === null ? null : noL[i]!;
    const usd = p === null || bill.costUsd === null || !n ? null : bill.costUsd - w.total + n.total;
    const why = p === null ? (pvDays ? "the PV export does not hold every day of this period after the connection" : "import the PV production CSV")
      : bill.costUsd === null ? "the bill states no total" : p === 0 ? "before the PV's connection: as billed" : `${Math.round(p)} kWh the panels made, bought from the grid instead`;
    return { bill, pvKwh: p, withPv: w, withoutPv: n, usd, why };
  });
}

/** THE EQUIVALENT $/kWh WITHOUT THE PANELS (user, 2026-10-10): the estimated totals over the kWh the grid would have delivered — the bills
 *  that could be estimated only */
export function equivalentWithoutPv(rows: BillNoPv[]): { usd: number; kwh: number; n: number; perKwh: number } | null {
  const ok = rows.filter((x) => x.usd !== null && x.withoutPv);
  const usd = ok.reduce((t, x) => t + x.usd!, 0), kwh = ok.reduce((t, x) => t + x.withoutPv!.kwhIn, 0);
  return ok.length && kwh > 0 ? { usd, kwh, n: ok.length, perKwh: usd / kwh } : null;
}
