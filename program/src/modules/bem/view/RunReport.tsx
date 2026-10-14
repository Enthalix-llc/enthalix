// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN · THE PRINTED REPORT (user, 2026-10-02: "we need to be able to print results on run tab, both results and graphs" —
// the full report, ruled the same day). Laid out for the page only: hidden on screen, the one thing shown under @media print
// (ui.css). Everything the RUN column and its frame read, whatever is folded or ticked there: the run's epoch, the annual
// end uses by fuel, the months, the Annual graph with every series the run has, the Peak heating and cooling graphs, the
// zones' loads and energy, the fuels' peaks and the units' sizing. Every number is what the pipeline read back from bem.db.

import { perRun } from "../core/runCalendar.js";
import { createPortal } from "react-dom";
import type { BemOutcome, BemModelOutcome } from "../pipeline.js";
import { decodeTime } from "../core/eplusSql.js";
import { fmtPower, fmtEnergyArea, fmtFlowAir, baseName, engineName } from "./bemUi.js";
import { endUseTable, fuelShort, fuelLabel, meterLabel, coilRows, unitRows } from "./runResults.js";
import { AnnualGraph, PeakGraph, ANNUAL_SERIES, peakLoadsOf } from "./RunGraphs.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const k0 = (v: number): string => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
/** the printable width of a US Letter / A4 page at 96 px per inch, inside the margins */
const PAGE_W = 700;

export function RunReport({ bem: b, model: m, imperial: im, project }: { bem: BemOutcome; model: BemModelOutcome | null; imperial: boolean; project: string }): React.ReactElement {
  const area = b.facility.conditionedAreaM2;
  const perArea = (kwh: number): string => (area > 0 ? ` (${fmtEnergyArea(kwh, area, im)})` : "");
  const stale = !!(m && b.run.modelSha256 && b.run.modelSha256 !== m.modelSha);
  const eu = endUseTable(b.endUses);
  const meters = [...b.monthlyMeters].filter(([, a]) => a.some((v) => v > 0)).map(([name, values]) => ({ name: meterLabel(name), values }));
  // PV (2026-10-02): what the arrays produced and the utility side of net metering, the engine's own facility meters summed over the year
  const yearOf = (name: string): number | null => { const a = b.monthlyMeters.get(name); return a ? a.reduce((t, v) => t + v, 0) : null; };
  const pvRows = ([["PV produced", "ElectricityProduced:Facility"], ["from the utility", "ElectricityPurchased:Facility"], ["surplus to the utility", "ElectricitySurplusSold:Facility"], ["net from the utility", "ElectricityNet:Facility"]] as const)
    .flatMap(([k, m]): Array<[string, number]> => { const v = yearOf(m); return v !== null && (k !== "PV produced" || v > 0) ? [[k, v]] : []; });
  const fuelPeakTotal = (fuel: string): number => b.fuelPeaks.find((f) => f.fuel === fuel && f.row === "Total End Uses")?.w ?? 0;
  const fuelsWithPeak = [...b.fuelPeakTimes.keys()].filter((f) => fuelPeakTotal(f) > 0);
  const coils = coilRows(b.sizingDetails);
  const zones = b.report.zoneRows.filter((z) => z.conditioned.value).map((z) => {
    const U = z.name.toUpperCase();
    return { name: z.name, zl: b.loads.zones.get(U), heat: b.zoneHeating.get(U) ?? 0, cool: b.zoneCooling.get(U) ?? 0, unmet: b.zoneUnmet.get(U) ?? 0 };
  });
  // the weather-year peaks are the ideal-loads district meters' — a run on real equipment has none, and empty columns are left out
  const hasPeaks = zones.some((z) => z.zl?.peakHeatingTime || z.zl?.peakCoolingTime);
  const engine = engineName(b.run.energyplusVersion);
  const page = (
    <div className="printReport">
      <header>
        <h1>Energy model results</h1>
        <div className="prMeta">
          <span><b>project</b> {project || "—"}</span>
          <span><b>run</b> {b.stamp}</span>
          <span><b>weather</b> {baseName(b.run.epw).replace(/\.epw$/i, "") || "design days only"}</span>
          <span><b>engine</b> {engine}</span>
          <span><b>model</b> {String(b.run.modelSha256 ?? "").slice(0, 12) || "—"}</span>
          <span><b>engine said</b> {b.run.completed ? "completed" : "did not complete"} · Fatal {b.run.fatal} · Severe {b.run.severe} · Warning {b.run.warning}</span>
          <span><b>printed</b> {new Date().toLocaleString()}</span>
        </div>
        {stale && <p className="prWarn">These results are from an earlier model ({String(b.run.modelSha256).slice(0, 12)}); the model has changed since this run.</p>}
      </header>

      <section>
        <h2>Annual results</h2>
        <table className="prKv"><tbody>
          <tr><td>heating</td><td>{k0(b.facility.heatingKwh)} kWh{perRun(b.hourly)}{perArea(b.facility.heatingKwh)}</td></tr>
          <tr><td>cooling</td><td>{k0(b.facility.coolingKwh)} kWh{perRun(b.hourly)}{perArea(b.facility.coolingKwh)}</td></tr>
          <tr><td>unmet hours</td><td>{b.facility.unmetHeatingH.toFixed(0)} h heating · {b.facility.unmetCoolingH.toFixed(0)} h cooling</td></tr>
          <tr><td>conditioned area</td><td>{im ? `${(area * 10.7639).toFixed(0)} ft²` : `${area.toFixed(1)} m²`}</td></tr>
        </tbody></table>
        {eu.fuels.length > 0 && (
          <table>
            <thead><tr><th>end use · kWh{perRun(b.hourly)}</th>{eu.fuels.map((f) => <th key={f} title={fuelLabel(f)}>{fuelShort(f)}</th>)}</tr></thead>
            <tbody>{eu.rows.map((r) => <tr key={r}><td>{r.toLowerCase()}</td>{eu.fuels.map((f) => { const v = eu.at(r, f); return <td key={f}>{v === null ? "" : k0(v)}</td>; })}</tr>)}</tbody>
            <tfoot><tr><td>total</td>{eu.fuels.map((f) => <td key={f}>{k0(eu.fuelTotal(f))}</td>)}</tr></tfoot>
          </table>
        )}
      </section>

      {pvRows.length > 0 && (
        <section>
          <h2>PV and net metering · kWh{perRun(b.hourly)}</h2>
          <table className="prKv"><tbody>{pvRows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{k0(v)}</td></tr>)}</tbody></table>
        </section>
      )}

      {meters.length > 0 && (
        <section>
          <h2>Monthly · kWh</h2>
          <table className="prMonths">
            <thead><tr><th>meter</th>{MONTHS.map((mn) => <th key={mn}>{mn}</th>)}<th>year</th></tr></thead>
            <tbody>{meters.map((s) => <tr key={s.name}><td>{s.name}</td>{MONTHS.map((mn, i) => <td key={mn}>{k0(s.values[i] ?? 0)}</td>)}<td><b>{k0(s.values.reduce((t, v) => t + v, 0))}</b></td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="prGraph">
        <h2>Annual · energy by day</h2>
        <AnnualGraph bem={b} shown={ANNUAL_SERIES.map((s) => s.id)} size={{ w: PAGE_W, h: 300 }} />
      </section>
      <section className="prGraph">
        <h2>Peak · heating</h2>
        <PeakGraph {...peakLoadsOf(b)} kind="heating" imperial={im} size={{ w: PAGE_W, h: 320 }} />
      </section>
      <section className="prGraph">
        <h2>Peak · cooling</h2>
        <PeakGraph {...peakLoadsOf(b)} kind="cooling" imperial={im} size={{ w: PAGE_W, h: 320 }} />
      </section>

      <section>
        <h2>Zones</h2>
        <table>
          <thead><tr><th>zone</th><th>design heating</th><th>air</th><th>design cooling</th><th>air</th>{hasPeaks && <><th>peak heating</th><th>at</th><th>peak cooling</th><th>at</th></>}<th>heating kWh</th><th>cooling kWh</th><th>unmet h</th></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.name}>
                <td>{z.name}</td>
                <td>{z.zl ? fmtPower(z.zl.designHeatingW, im) : ""}</td><td>{z.zl?.designHeatingFlowM3s ? fmtFlowAir(z.zl.designHeatingFlowM3s, im) : ""}</td>
                <td>{z.zl ? fmtPower(z.zl.designCoolingW, im) : ""}</td><td>{z.zl?.designCoolingFlowM3s ? fmtFlowAir(z.zl.designCoolingFlowM3s, im) : ""}</td>
                {hasPeaks && <>
                  <td>{z.zl?.peakHeatingTime ? fmtPower(z.zl.peakHeatingW, im) : ""}</td><td>{z.zl?.peakHeatingTime ? decodeTime(z.zl.peakHeatingTime) : ""}</td>
                  <td>{z.zl?.peakCoolingTime ? fmtPower(z.zl.peakCoolingW, im) : ""}</td><td>{z.zl?.peakCoolingTime ? decodeTime(z.zl.peakCoolingTime) : ""}</td>
                </>}
                <td>{k0(z.heat)}</td><td>{k0(z.cool)}</td><td>{z.unmet.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Σ zones (non-coincident)</td><td>{fmtPower(b.loads.facility.sumDesignHeatingW, im)}</td><td /><td>{fmtPower(b.loads.facility.sumDesignCoolingW, im)}</td><td /><td colSpan={hasPeaks ? 7 : 3} /></tr></tfoot>
        </table>
      </section>

      <section>
        <h2>Peak demand and unit sizing</h2>
        <table className="prKv"><tbody>
          {fuelsWithPeak.length === 0 && <tr><td colSpan={2}>no fuel peak in this run</td></tr>}
          {fuelsWithPeak.map((f) => <tr key={f}><td>{fuelLabel(f)} peak</td><td>{fmtPower(fuelPeakTotal(f), im)} at {decodeTime(b.fuelPeakTimes.get(f) ?? 0)}</td></tr>)}
        </tbody></table>
        {coils.length > 0 && (
          <table>
            <thead><tr><th>unit</th><th>heating load</th><th>air</th><th>cooling load</th><th>sensible</th><th>air</th><th>coil</th><th>zones</th></tr></thead>
            <tbody>
              {unitRows(coils).map((u) => (
                <tr key={u.unit}>
                  <td>{u.unit}</td>
                  <td>{u.heating?.peakW ? fmtPower(u.heating.peakW, im) : "—"}</td><td>{u.heating?.airM3s ? fmtFlowAir(u.heating.airM3s, im) : ""}</td>
                  <td>{u.cooling?.peakW ? fmtPower(u.cooling.peakW, im) : "—"}</td><td>{u.cooling?.peakSensibleW ? fmtPower(u.cooling.peakSensibleW, im) : ""}</td><td>{u.cooling?.airM3s ? fmtFlowAir(u.cooling.airM3s, im) : ""}</td>
                  <td>{fmtPower(Math.max(u.heating?.capacityW ?? 0, u.cooling?.capacityW ?? 0), im)}</td>
                  <td>{u.zones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
  return createPortal(page, document.body);
}
