// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BEM DOCK PANELS: the RESULTS FRAME under the RUN view (user, 2026-09-15: "the frame below Run view should show
// options to plot or graph") — five rails at its left edge as the ZONES frame has: ENERGY (the annual end uses by fuel)
// · MONTHLY (the meters month by month) · LOADS (the design loads and the weather-year peaks per zone and space) ·
// SYSTEMS (the engine's sizing reports per coil and per component) · ZONES (each zone's energy and unmet hours) —
// each a table or a chart, the head pinned to the RUN's own epoch (its stamp, its weather file, its engine); and the
// run log. Every number is what the pipeline read back from bem.db's own bytes.

import { Fragment, useState } from "react";
import type { BemOutcome, ZoneLoads } from "../pipeline.js";
import { formatErr } from "../core/eplusErr.js";
import { decodeTime } from "../core/eplusSql.js";
import { fmtPower, fmtPowerArea, fmtArea, fmtEnergyArea, fmtTemp, fmtFlowAir, fmtFlowWater, baseName, W_TO_BTUH, engineName } from "./bemUi.js";
import { endUseTable, fuelShort, fuelLabel, fuelColor, meterLabel, meterColor, coilRows, unitRows, componentRows, designStamp, designDayShort } from "./runResults.js";

type RailTab = "ENERGY" | "MONTHLY" | "LOADS" | "SYSTEMS" | "ZONES";
const RAILS: RailTab[] = ["ENERGY", "MONTHLY", "LOADS", "SYSTEMS", "ZONES"];
const RAIL_COLOR: Record<RailTab, string> = { ENERGY: "#e4b04a", MONTHLY: "#3b6fd6", LOADS: "#d6553b", SYSTEMS: "#2e9e5e", ZONES: "#8b5cf6" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORE = "bem-run-frame";
type Mode = "table" | "chart";
const k0 = (v: number): string => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** vertical bars over a short label set (the twelve months): grouped, or stacked when asked; inline SVG, no library */
function Bars(p: { labels: string[]; series: Array<{ name: string; color: string; values: number[] }>; unit: string; stacked?: boolean; fmt: (v: number) => string }): React.ReactElement {
  const H = 190, padL = 56, padR = 10, padT = 12, padB = 22, W = 540;
  const n = Math.max(1, p.labels.length);
  const tops = p.labels.map((_, i) => p.stacked ? p.series.reduce((t, s) => t + Math.max(0, s.values[i] ?? 0), 0) : Math.max(0, ...p.series.map((s) => s.values[i] ?? 0)));
  const step = niceStep(Math.max(...tops, 1e-9) / 4), top = Math.max(step, Math.ceil(Math.max(...tops, 1e-9) / step) * step);
  const y = (v: number): number => padT + (H - padT - padB) * (1 - v / top);
  const gw = (W - padL - padR) / n;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
      {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 4} y={y(t) + 3} textAnchor="end" className="tick">{p.fmt(t)}</text></g>)}
      <text x={4} y={padT} className="tick">{p.unit}</text>
      {p.labels.map((l, i) => {
        const x0 = padL + i * gw;
        if (p.stacked) {
          let acc = 0;
          return <g key={l}>{p.series.map((s) => { const v = Math.max(0, s.values[i] ?? 0); const yTop = y(acc + v), yBot = y(acc); acc += v; return <rect key={s.name} x={x0 + gw * 0.2} width={gw * 0.6} y={yTop} height={Math.max(0, yBot - yTop)} fill={s.color}><title>{`${l} · ${s.name}: ${p.fmt(v)} ${p.unit}`}</title></rect>; })}<text x={x0 + gw / 2} y={H - 6} textAnchor="middle" className="tick">{l}</text></g>;
        }
        const bw = (gw - 6) / Math.max(1, p.series.length);
        return <g key={l}>{p.series.map((s, j) => { const v = Math.max(0, s.values[i] ?? 0); return <rect key={s.name} x={x0 + 3 + j * bw} width={Math.max(1, bw - 1)} y={y(v)} height={Math.max(0, y(0) - y(v))} fill={s.color}><title>{`${l} · ${s.name}: ${p.fmt(v)} ${p.unit}`}</title></rect>; })}<text x={x0 + gw / 2} y={H - 6} textAnchor="middle" className="tick">{l}</text></g>;
      })}
    </svg>
  );
}

/** horizontal bars, one row per subject: the series side by side, or stacked segments when asked */
function HBars(p: { rows: Array<{ label: string; values: number[] }>; series: Array<{ name: string; color: string }>; unit: string; stacked?: boolean; fmt: (v: number) => string }): React.ReactElement {
  const rowH = p.stacked ? 16 : 6 + 7 * p.series.length, padL = 160, padR = 70, W = 640;
  const H = 10 + p.rows.length * rowH + 4;
  const maxV = Math.max(1e-9, ...p.rows.map((r) => p.stacked ? r.values.reduce((t, v) => t + Math.max(0, v), 0) : Math.max(0, ...r.values)));
  const wOf = (v: number): number => (W - padL - padR) * (Math.max(0, v) / maxV);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
      {p.rows.map((r, i) => {
        const y0 = 10 + i * rowH, ty = y0 + (p.stacked ? 11 : rowH / 2 + 3);
        const total = p.stacked ? r.values.reduce((t, v) => t + Math.max(0, v), 0) : Math.max(0, ...r.values);
        let acc = 0;
        return (
          <g key={r.label}>
            <text x={padL - 6} y={ty} textAnchor="end" className="tick"><title>{r.label}</title>{r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label}</text>
            {p.series.map((s, j) => {
              const v = Math.max(0, r.values[j] ?? 0);
              if (p.stacked) { const xs = padL + wOf(acc); acc += v; return <rect key={s.name} x={xs} y={y0 + 2} width={wOf(v)} height={12} fill={s.color}><title>{`${r.label} · ${s.name}: ${p.fmt(v)} ${p.unit}`}</title></rect>; }
              return <rect key={s.name} x={padL} y={y0 + 3 + j * 7} width={wOf(v)} height={6} fill={s.color}><title>{`${r.label} · ${s.name}: ${p.fmt(v)} ${p.unit}`}</title></rect>;
            })}
            <text x={padL + wOf(total) + 4} y={ty} className="tick">{p.fmt(total)}{p.stacked ? "" : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ChartLegend(p: { series: Array<{ name: string; color: string }> }): React.ReactElement {
  return <div className="chartLegend">{p.series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

function readFrame(): { tab: RailTab; mode: Partial<Record<RailTab, Mode>> } {
  try { const v = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as { tab?: RailTab; mode?: Partial<Record<RailTab, Mode>> } | null; return { tab: v?.tab && RAILS.includes(v.tab) ? v.tab : "ENERGY", mode: v?.mode ?? {} }; } catch { return { tab: "ENERGY", mode: {} }; }
}

export function BemResultsPanel(p: { bem: BemOutcome; selectedZone: string | null; onZone: (zone: string) => void; imperial: boolean }): React.ReactElement {
  const b = p.bem, im = p.imperial, L = b.loads;
  const [frame, setFrame] = useState(readFrame);
  const tab = frame.tab, mode: Mode = frame.mode[tab] ?? (tab === "MONTHLY" ? "chart" : "table");
  const setTab = (t: RailTab): void => setFrame((f) => { const n = { ...f, tab: t }; try { window.localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* view state */ } return n; });
  const setMode = (m: Mode): void => setFrame((f) => { const n = { ...f, mode: { ...f.mode, [tab]: m } }; try { window.localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* view state */ } return n; });
  const pw = (w: number): number => (im ? w * W_TO_BTUH / 1000 : w / 1000);
  const pwUnit = im ? "MBH" : "kW";
  const setting = (k: string): string => b.settings.find((s) => s.key === k)?.value ?? "";
  const stale = !!(b.run.modelSha256 && b.modelSha && b.run.modelSha256 !== b.modelSha);
  const runEpw = baseName(b.run.epw).replace(/\.epw$/i, "");
  const engine = engineName(b.run.energyplusVersion);
  const area = b.facility.conditionedAreaM2;
  const zones = b.report.zoneRows.map((z) => {
    const U = z.name.toUpperCase();
    const spaces = (b.report.model.spacesByZone[z.name] ?? []).map((sn) => ({ name: sn, l: L.spaces.get(sn.toUpperCase()) }));
    return {
      name: z.name, cond: z.conditioned, upper: U, zl: L.zones.get(U),
      spaces: spaces.length > 1 || (spaces.length === 1 && spaces[0]!.name !== z.name) ? spaces : [],
      heat: b.zoneHeating.get(U) ?? 0, cool: b.zoneCooling.get(U) ?? 0, unmet: b.zoneUnmet.get(U) ?? 0, source: b.zoneSource.get(U) ?? null,
    };
  });
  const energyRows = [...zones].sort((x, y) => (y.heat + y.cool) - (x.heat + x.cool));
  const loadRows = zones.filter((z) => z.cond.value && z.zl).sort((x, y) => (y.zl!.designHeatingW) - (x.zl!.designHeatingW));
  const reasons = new Map<string, number>();
  for (const r of b.notEmitted.values()) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const F = L.facility;
  const sumPeak = (k: "peakHeatingW" | "peakCoolingW"): number => loadRows.reduce((t, z) => t + (z.zl?.[k] ?? 0), 0);
  const eu = endUseTable(b.endUses);
  const fuelPeakTotal = (fuel: string): number => b.fuelPeaks.find((f) => f.fuel === fuel && f.row === "Total End Uses")?.w ?? 0;
  const fuelsWithPeak = [...b.fuelPeakTimes.keys()].filter((f) => fuelPeakTotal(f) > 0);
  const meters = [...b.monthlyMeters].filter(([, a]) => a.some((v) => v > 0)).map(([name, values]) => ({ name: meterLabel(name), color: meterColor(name), values }));
  const coils = coilRows(b.sizingDetails), comps = componentRows(b.sizingDetails).filter((c) => c.cls !== "ZoneHVAC:IdealLoadsAirSystem");
  const idealSystems = componentRows(b.sizingDetails).filter((c) => c.cls === "ZoneHVAC:IdealLoadsAirSystem").length;
  const loadCells = (l: ZoneLoads | undefined): React.ReactNode => l ? (
    <>
      <td title={`${fmtPowerArea(l.designHeatingWm2, im)} · ${l.heatingDay}`}>{fmtPower(l.designHeatingW, im)}</td><td>{l.designHeatingFlowM3s > 0 ? fmtFlowAir(l.designHeatingFlowM3s, im) : ""}</td><td className="muted">{decodeTime(l.heatingDayTime)}</td>
      <td title={`${fmtPowerArea(l.designCoolingWm2, im)} · ${l.coolingDay}`}>{fmtPower(l.designCoolingW, im)}</td><td>{l.designCoolingFlowM3s > 0 ? fmtFlowAir(l.designCoolingFlowM3s, im) : ""}</td><td className="muted">{decodeTime(l.coolingDayTime)}</td>
      <td>{l.peakHeatingTime ? fmtPower(l.peakHeatingW, im) : ""}</td><td className="muted">{decodeTime(l.peakHeatingTime)}</td>
      <td>{l.peakCoolingTime ? fmtPower(l.peakCoolingW, im) : ""}</td><td className="muted">{decodeTime(l.peakCoolingTime)}</td>
    </>
  ) : <><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /></>;
  const hasChart = tab !== "SYSTEMS";
  const cell = (v: number | null, f: (x: number) => string): string => (v === null ? "—" : f(v));
  return (
    <div className="asmBench zoneFrame runFrame">
      <div className="asmRail">
        {RAILS.map((t) => <button key={t} className={`asmRailBtn${tab === t ? " on" : ""}`} style={{ borderLeftColor: RAIL_COLOR[t] }} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="qaPanel steps">
        <p>
          <b>Run {b.stamp}</b> · {runEpw || "design days only"} · {engine} ·
          {" "}heating <b>{k0(b.facility.heatingKwh)} kWh</b> · cooling <b>{k0(b.facility.coolingKwh)} kWh</b>
          {area > 0 ? ` over ${fmtArea(area, im)} conditioned (${fmtEnergyArea(b.facility.heatingKwh, area, im)} / ${fmtEnergyArea(b.facility.coolingKwh, area, im)})` : ""} ·
          {" "}setpoint not met {b.facility.unmetHeatingH.toFixed(0)} h / {b.facility.unmetCoolingH.toFixed(0)} h
          {fuelsWithPeak.length ? <> · peak demand {fuelsWithPeak.map((f) => `${fuelShort(f)} ${fmtPower(fuelPeakTotal(f), im)} at ${decodeTime(b.fuelPeakTimes.get(f) ?? 0)}`).join(" · ")}</> : null}.
          {stale && <span className="src-user"> The model has changed since this run (run on {String(b.run.modelSha256).slice(0, 12)}, the model now {b.modelSha.slice(0, 12)}): every table here is the run's; run again for the current model.</span>}
        </p>
        <div className="allRow">
          <b>{tab}</b>
          {hasChart && <>
            <button className={`qaBtn${mode === "table" ? " on" : ""}`} onClick={() => setMode("table")}>table</button>
            <button className={`qaBtn${mode === "chart" ? " on" : ""}`} onClick={() => setMode("chart")}>chart</button>
          </>}
          <span className="idfInfo" title={tab === "ENERGY" ? "the End Uses table of the run's Annual Building Utility Performance Summary — every row by every fuel it drew; kWh in both unit systems (a fuel would also read therms or gallons)"
            : tab === "MONTHLY" ? "the meters the writer asked for, month by month over the weather year"
            : tab === "LOADS" ? `design at ${loadRows[0]?.zl?.heatingDay ?? "the design days"} (the HVAC Sizing Summary: the zone's sensible load, no ventilation or system effects) · peak over the weather year`
            : tab === "SYSTEMS" ? "the engine's own sizing reports: CoilSizingDetails per coil and ComponentSizingSummary per object — what a unit is picked from"
            : "each zone's annual heating and cooling (the ideal-loads pair, or the zone air system's sensible pair on real equipment) and its unmet hours"}>
            {tab === "ENERGY" || tab === "MONTHLY" ? "kWh" : tab === "LOADS" ? (im ? "MBH = 1000 Btu/h" : "kW") : ""}
          </span>
        </div>

        {tab === "ENERGY" && mode === "table" && (
          <table>
            <thead><tr><th>end use</th>{eu.fuels.map((f) => <th key={f} title={fuelLabel(f)}>{fuelShort(f)} kWh</th>)}<th>total kWh</th>{area > 0 && <th>per area</th>}</tr></thead>
            <tbody>
              {eu.rows.map((r) => (
                <tr key={r}><td className="wrap">{r}</td>{eu.fuels.map((f) => { const v = eu.at(r, f); return <td key={f}>{v === null ? "" : k0(v)}</td>; })}<td><b>{k0(eu.rowTotal(r))}</b></td>{area > 0 && <td className="muted">{fmtEnergyArea(eu.rowTotal(r), area, im)}</td>}</tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>total</b></td>{eu.fuels.map((f) => <td key={f}><b>{k0(eu.fuelTotal(f))}</b></td>)}<td><b>{k0(eu.fuels.reduce((t, f) => t + eu.fuelTotal(f), 0))}</b></td>{area > 0 && <td className="muted">{fmtEnergyArea(eu.fuels.reduce((t, f) => t + eu.fuelTotal(f), 0), area, im)}</td>}</tr></tfoot>
          </table>
        )}
        {tab === "ENERGY" && mode === "chart" && (
          <div className="chartBox">
            <ChartLegend series={eu.fuels.map((f) => ({ name: fuelLabel(f), color: fuelColor(f) }))} />
            <HBars stacked unit="kWh" fmt={k0} series={eu.fuels.map((f) => ({ name: fuelLabel(f), color: fuelColor(f) }))} rows={eu.rows.map((r) => ({ label: r, values: eu.fuels.map((f) => eu.at(r, f) ?? 0) }))} />
          </div>
        )}

        {tab === "MONTHLY" && meters.length === 0 && <p>this run carries no monthly meter — run again under this build to read them</p>}
        {tab === "MONTHLY" && meters.length > 0 && mode === "chart" && (
          <div className="chartBox">
            <ChartLegend series={meters} />
            <Bars labels={MONTHS} series={meters} unit="kWh" fmt={k0} />
          </div>
        )}
        {tab === "MONTHLY" && meters.length > 0 && mode === "table" && (
          <table>
            <thead><tr><th>month</th>{meters.map((s) => <th key={s.name}>{s.name} kWh</th>)}</tr></thead>
            <tbody>{MONTHS.map((mn, i) => <tr key={mn}><td>{mn}</td>{meters.map((s) => <td key={s.name}>{k0(s.values[i] ?? 0)}</td>)}</tr>)}</tbody>
            <tfoot><tr><td><b>year</b></td>{meters.map((s) => <td key={s.name}><b>{k0(s.values.reduce((t, v) => t + v, 0))}</b></td>)}</tr></tfoot>
          </table>
        )}

        {tab === "LOADS" && mode === "table" && (
          <table>
            <thead><tr><th>zone · space</th><th>design heating</th><th>air</th><th>at</th><th>design cooling</th><th>air</th><th>at</th><th>peak heating</th><th>at</th><th>peak cooling</th><th>at</th></tr></thead>
            <tbody>
              {loadRows.map((z) => (
                <Fragment key={z.name}>
                  <tr className={p.selectedZone === z.name ? "sel" : ""} onClick={() => p.onZone(z.name)}>
                    <td className="wrap"><b>{z.name}</b>{z.spaces.length ? <span className="muted"> · {z.spaces.length} spaces</span> : null}</td>
                    {loadCells(z.zl)}
                  </tr>
                  {z.spaces.map((sp) => (
                    <tr key={`${z.name}/${sp.name}`} className={p.selectedZone === z.name ? "sel sub" : "sub"} onClick={() => p.onZone(z.name)}>
                      <td className="wrap muted">&nbsp;&nbsp;{sp.name}</td>
                      {loadCells(sp.l)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr title="the sum of the zones' design loads — each at its own peak, not coincident">
                <td><b>Σ zones</b> (non-coincident)</td>
                <td>{fmtPower(F.sumDesignHeatingW, im)}</td><td>{fmtFlowAir(loadRows.reduce((s, z) => s + (z.zl?.designHeatingFlowM3s ?? 0), 0), im)}</td><td /><td>{fmtPower(F.sumDesignCoolingW, im)}</td><td>{fmtFlowAir(loadRows.reduce((s, z) => s + (z.zl?.designCoolingFlowM3s ?? 0), 0), im)}</td><td />
                <td>{fmtPower(sumPeak("peakHeatingW"), im)}</td><td /><td>{fmtPower(sumPeak("peakCoolingW"), im)}</td><td />
              </tr>
              {(F.peakHeatingW > 0 || F.peakCoolingW > 0) && (
                <tr title="the ideal-loads district meters' coincident peak under the weather year (Demand End Use Components Summary)">
                  <td><b>facility</b> (coincident, the ideal-loads zones)</td>
                  <td /><td /><td /><td /><td /><td />
                  <td>{fmtPower(F.peakHeatingW, im)}</td><td className="muted">{decodeTime(F.peakHeatingTime)}</td>
                  <td>{fmtPower(F.peakCoolingW, im)}</td><td className="muted">{decodeTime(F.peakCoolingTime)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        )}
        {tab === "LOADS" && mode === "chart" && (
          <div className="chartBox">
            <ChartLegend series={[{ name: "design heating", color: "#d94f4f" }, { name: "design cooling", color: "#3b8fd6" }]} />
            <HBars unit={pwUnit} fmt={(v) => v.toFixed(1)} series={[{ name: "design heating", color: "#d94f4f" }, { name: "design cooling", color: "#3b8fd6" }]}
              rows={loadRows.map((z) => ({ label: z.name, values: [pw(z.zl!.designHeatingW), pw(z.zl!.designCoolingW)] }))} />
          </div>
        )}

        {tab === "SYSTEMS" && coils.length === 0 && comps.length === 0 && (
          <p>{idealSystems ? `ideal loads on ${idealSystems} zones — the engine sized no coil, fan, pump or terminal; ComponentSizingSummary holds the ideal-loads systems alone (their air flows 0). Draw a system on the SYSTEMS sheet, Save and run, and the units' sizes appear here.` : "this run carries no sizing rows — run again under this build to read them"}</p>
        )}
        {tab === "SYSTEMS" && coils.length > 0 && (
          <table className="unitSizing" title="per unit (user, 2026-10-02): its heating and cooling loads at their design-day peaks with the supply air, beside the coil capacity the engine sized (a variable-speed heat pump takes one size for both coils, the larger side's); a supplemental coil switched off on the card is written at 0 W and listed as none">
            <thead><tr><th>unit</th><th>zones</th><th>heating load</th><th>coil</th><th>air</th><th>at</th><th>cooling load</th><th>sensible</th><th>coil</th><th>air</th><th>at</th><th>supplemental</th></tr></thead>
            <tbody>{unitRows(coils).map((u) => (
              <tr key={u.unit}>
                <td className="wrap"><b>{u.unit}</b></td><td className="wrap muted">{u.zones}</td>
                <td>{cell(u.heating?.peakW ?? null, (v) => fmtPower(v, im))}</td><td className="muted">{cell(u.heating?.capacityW ?? null, (v) => fmtPower(v, im))}</td><td>{cell(u.heating?.airM3s ?? null, (v) => fmtFlowAir(v, im))}</td><td className="muted">{u.heating?.time ? designStamp(u.heating.time) : ""}</td>
                <td>{cell(u.cooling?.peakW ?? null, (v) => fmtPower(v, im))}</td><td>{cell(u.cooling?.peakSensibleW ?? null, (v) => fmtPower(v, im))}</td><td className="muted">{cell(u.cooling?.capacityW ?? null, (v) => fmtPower(v, im))}</td><td>{cell(u.cooling?.airM3s ?? null, (v) => fmtFlowAir(v, im))}</td><td className="muted">{u.cooling?.time ? designStamp(u.cooling.time) : ""}</td>
                <td className="muted">{u.others.filter((c) => /Supplemental/i.test(c.name)).map((c) => cell(c.capacityW, (v) => fmtPower(v, im))).join(" · ") || (u.none.length ? "none" : "—")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {tab === "SYSTEMS" && coils.length > 0 && (
          <table>
            <thead><tr><th>coil</th><th>role</th><th>unit</th><th>zones</th><th>capacity</th><th>sensible</th><th>air flow</th><th>water flow</th><th>design day</th><th>at</th><th>entering air DB / WB</th><th>leaving air DB</th><th>water in / out</th><th>outdoor DB</th><th>autosized</th></tr></thead>
            <tbody>
              {coils.map((c) => (
                <tr key={c.name} title={c.type}>
                  <td className="wrap">{c.name}</td><td>{c.kind}</td><td className="wrap">{c.hvac}</td><td className="wrap">{c.zones}</td>
                  <td>{cell(c.capacityW, (v) => fmtPower(v, im))}</td><td>{cell(c.sensibleW, (v) => fmtPower(v, im))}</td>
                  <td>{c.airM3s !== null && c.airM3s > 0 ? fmtFlowAir(c.airM3s, im) : "—"}</td><td>{c.waterM3s !== null && c.waterM3s > 0 ? fmtFlowWater(c.waterM3s, im) : "—"}</td>
                  <td className="wrap">{designDayShort(c.day)}</td><td className="muted">{designStamp(c.time)}</td>
                  <td>{cell(c.enteringDbC, (v) => fmtTemp(v, im))} / {cell(c.enteringWbC, (v) => fmtTemp(v, im))}</td><td>{cell(c.leavingDbC, (v) => fmtTemp(v, im))}</td>
                  <td>{c.enteringWaterC !== null ? `${fmtTemp(c.enteringWaterC, im)} / ${cell(c.leavingWaterC, (v) => fmtTemp(v, im))}` : "—"}</td>
                  <td>{cell(c.outdoorDbC, (v) => fmtTemp(v, im))}</td><td className="muted">{c.autosized}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "SYSTEMS" && comps.length > 0 && (
          <>
            <p><b>ComponentSizingSummary</b> — every field the engine sized, per object; "Design Size" is the engine's own, "User-Specified" what the IDF stated.</p>
            <table>
              <thead><tr><th>class</th><th>object</th><th>field</th><th>value</th></tr></thead>
              <tbody>
                {comps.map((c) => c.fields.map((f, i) => (
                  <tr key={`${c.cls}|${c.name}|${f.field}`}>
                    <td className="muted">{i === 0 ? c.cls : ""}</td><td className="wrap">{i === 0 ? c.name : ""}</td><td className="wrap">{f.field}</td>
                    <td>{f.value !== null ? (f.units === "W" ? fmtPower(f.value, im) : f.units === "m3/s" ? (/Water|Fluid|Plant/i.test(f.field) ? fmtFlowWater(f.value, im) : fmtFlowAir(f.value, im)) : f.units === "C" ? fmtTemp(f.value, im) : `${f.value} ${f.units}`) : f.text ?? ""}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </>
        )}

        {tab === "ZONES" && mode === "table" && (
          <table>
            <thead><tr><th>zone</th><th>conditioned</th><th>read from</th><th>heating kWh</th><th>cooling kWh</th><th>unmet h</th></tr></thead>
            <tbody>
              {energyRows.map((z) => (
                <tr key={z.name} className={p.selectedZone === z.name ? "sel" : ""} onClick={() => p.onZone(z.name)}>
                  <td className="wrap">{z.name}</td>
                  <td className={z.cond.source === "user" ? "src-user" : "src-code"}>{z.cond.value ? "yes" : "no"}</td>
                  <td className="muted">{z.cond.value ? (z.source ?? "—") : ""}</td>
                  <td>{z.cond.value ? k0(z.heat) : ""}</td>
                  <td>{z.cond.value ? k0(z.cool) : ""}</td>
                  <td>{z.cond.value ? z.unmet.toFixed(0) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "ZONES" && mode === "chart" && (
          <div className="chartBox">
            <ChartLegend series={[{ name: "heating", color: "#d94f4f" }, { name: "cooling", color: "#3b8fd6" }]} />
            <HBars unit="kWh" fmt={k0} series={[{ name: "heating", color: "#d94f4f" }, { name: "cooling", color: "#3b8fd6" }]}
              rows={energyRows.filter((z) => z.cond.value).map((z) => ({ label: z.name, values: [z.heat, z.cool] }))} />
          </div>
        )}

        <p>
          <b>The model as written now</b>{stale ? " (the run's own model differs — see above)" : ""}: {b.report.surfaces} surfaces — Outdoors {b.report.byBc.Outdoors.count} ({fmtArea(b.report.byBc.Outdoors.areaM2, im)}) · Ground {b.report.byBc.Ground.count} ({fmtArea(b.report.byBc.Ground.areaM2, im)}) ·
          Surface {b.report.byBc.Surface.count} · Adiabatic {b.report.byBc.Adiabatic.count} · windows {b.report.windows} · door pairs {b.report.interiorDoors} ·
          Sizing:Zone {b.report.model.sizing.zones} · Space {b.report.model.sizing.spaces}. {fmtArea(b.report.unclaimed.exteriorAreaM2, im)} of envelope faces no zone.
          {" "}Ground: {setting("ground_temp_from") || "—"}. HVAC: {setting("hvac") || "—"}. Envelope: {setting("envelope") || "—"}.
          {" "}<b>Not emitted</b>: {[...reasons].map(([r, n]) => `${r} ${n}`).join(" · ") || "none"}.
          {" "}Holes refused: {b.report.holesSkipped.manyVertices} with 5+ vertices, {b.report.holesSkipped.onFloorOrCeiling} in floors/ceilings, {b.report.holesSkipped.onAdiabaticOrGround} on adiabatic/ground bases.
          {" "}Winding violations {b.report.windingViolations}.
        </p>
      </div>
    </div>
  );
}

export function BemRunPanel(p: { bem: BemOutcome | null; log: string[] }): React.ReactElement {
  return (
    <div className="qaPanel steps">
      {p.bem && (
        <p>
          {formatErr(p.bem.err).map((l, i) => <span key={i} className="logLine">{l}</span>)}
        </p>
      )}
      <p className="log">
        {p.log.map((l, i) => <span key={i} className="logLine">{l}</span>)}
      </p>
    </div>
  );
}
