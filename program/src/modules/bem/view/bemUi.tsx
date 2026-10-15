// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// The small pieces every BEM tab is built from: a key/value row coloured by
// its source, a step block, the source's CSS class. Provenance is a colour
// (DesignBuilder's rule in this theme): the file plain, a dataset or a code
// default blue, the user amber.

import { useEffect, useState } from "react";
import type { Source } from "../core/bemIdf.js";
import { LENSES, RAMP_CSS, type Lens, type Legend } from "../core/bemPaint.js";

/** THE COLOUR IS THE SOURCE (the tab review, 2026-09-15): the file plain, a dataset teal, a code default blue, the user amber — and a
 *  value with NO source (a count, a computed sun angle, a name) carries no colour at all, never the code default's blue */
export const srcClass = (s: Source | string | null | undefined): string =>
  s === "user" ? "src-user" : s === "file" ? "src-file" : s === "dataset" ? "src-dataset" : s === "code-default" || s === "code" ? "src-code" : "";

export function KV(p: { k: string; v: React.ReactNode; src?: Source | string | null; title?: string }): React.ReactElement {
  return <div className="kv" title={p.title}><span>{p.k}</span><b className={srcClass(p.src)}>{p.v}</b></div>;
}

/** A COLUMN'S EXPOSITION IS A TOOLTIP (user, 2026-09-29: "the large discussion … at top of right column should be a
 *  tooltip, so the vertical space is maximized"): the prose that says how a tab reads sits behind one ⓘ on a row that is
 *  already there, and the column's height goes to the rows. A warning is never put here — it stays on the screen. */
export function InfoTip(p: { text: string }): React.ReactElement {
  return <span className="infoTip" title={p.text}>ⓘ</span>;
}

export function Step(p: { head: string; tip?: string; children?: React.ReactNode }): React.ReactElement {
  return <div className="step"><div className="stepHead">{p.head}{p.tip && <InfoTip text={p.tip} />}</div>{p.children}</div>;
}

/** A ROLL-UP (user, 2026-09-15: "sections need to roll up to save column space"): a Step folded behind its head, one
 *  click open or closed, the open set remembered per column under `store`; folded, a one-line summary stands in for
 *  the body so the number is still on the screen. View state, written nowhere but the browser. */
export function Fold(p: { id: string; store: string; head: string; summary?: React.ReactNode; defaultOpen?: boolean; children?: React.ReactNode }): React.ReactElement {
  const read = (): Record<string, boolean> => { try { const v = JSON.parse(window.localStorage.getItem(p.store) ?? "{}") as unknown; return v && typeof v === "object" ? (v as Record<string, boolean>) : {}; } catch { return {}; } };
  const [open, setOpen] = useState<boolean>(() => { const v = read(); return p.id in v ? !!v[p.id] : (p.defaultOpen ?? true); });
  const toggle = (): void => setOpen((o) => { const n = !o; try { const v = read(); v[p.id] = n; window.localStorage.setItem(p.store, JSON.stringify(v)); } catch { /* view state only */ } return n; });
  return (
    <div className={`step fold${open ? " open" : ""}`}>
      <button type="button" className="stepHead foldHead" onClick={toggle} title={open ? "fold this section" : "unfold this section"}>
        <span className="foldArrow">{open ? "▾" : "▸"}</span>{p.head}
      </button>
      {!open && p.summary !== undefined && <div className="foldSummary">{p.summary}</div>}
      {open && p.children}
    </div>
  );
}

export const baseName = (p: string | null | undefined): string => (p ? (p.split(/[\\/]/).pop() ?? p) : "");

/** THE UNITS AT THE EYE (user, 2026-09-04): the engine speaks W and kWh; a
 *  load reads MBH (1000 Btu/h) in imperial and kW in metric, energy reads kWh
 *  in both — a fuel would read therms or gallons, and none is burned yet. */
export const W_TO_BTUH = 3.412142;
export const fmtPower = (w: number, imperial: boolean): string => (imperial ? `${(w * W_TO_BTUH / 1000).toFixed(2)} MBH` : `${(w / 1000).toFixed(2)} kW`);
export const fmtPowerArea = (wm2: number, imperial: boolean): string => (imperial ? `${(wm2 * W_TO_BTUH / 10.7639).toFixed(1)} Btu/h·ft²` : `${wm2.toFixed(1)} W/m²`);
export const fmtArea = (m2: number, imperial: boolean): string => (imperial ? `${(m2 * 10.7639).toFixed(0)} ft²` : `${m2.toFixed(1)} m²`);
export const fmtEnergyArea = (kwh: number, m2: number, imperial: boolean): string =>
  (m2 > 0 ? (imperial ? `${(kwh / (m2 * 10.7639)).toFixed(2)} kWh/ft²` : `${(kwh / m2).toFixed(1)} kWh/m²`) : "");

/** an air flow at the eye: cfm under imperial, L/s otherwise (the engine's m³/s stored) */
export const fmtFlowAir = (m3s: number, imperial: boolean): string => (imperial ? `${(m3s * 2118.88).toFixed(0)} cfm` : `${(m3s * 1000).toFixed(1)} L/s`);
/** a water flow at the eye: gpm under imperial, L/s otherwise */
export const fmtFlowWater = (m3s: number, imperial: boolean): string => (imperial ? `${(m3s * 15850.3).toFixed(1)} gpm` : `${(m3s * 1000).toFixed(2)} L/s`);

/** °C for the model, °F at the display edge when the user reads imperial */
export const fmtTemp = (c: number, imperial: boolean, digits = 1): string => (Number.isNaN(c) ? "not entered" : imperial ? `${(c * 9 / 5 + 32).toFixed(digits)} °F` : `${c.toFixed(digits)} °C`);
/** a length at the eye: feet under Show Imperial, metres otherwise */
export const fmtLen = (m: number, imperial: boolean, digits = 2): string => (imperial ? `${(m / 0.3048).toFixed(digits)} ft` : `${m.toFixed(digits)} m`);
/** a speed: mph under imperial, m/s otherwise */
export const fmtSpeed = (ms: number, imperial: boolean): string => (imperial ? `${(ms * 2.236936).toFixed(1)} mph` : `${ms.toFixed(1)} m/s`);
/** a distance: miles under imperial, km otherwise */
export const fmtDist = (km: number, imperial: boolean, digits = 1): string => (imperial ? `${(km * 0.621371).toFixed(digits)} mi` : `${km.toFixed(digits)} km`);
/** degree-days: the listing states °C-days (HDD18 / CDD10); under imperial the same days on the °F scale (HDD65 / CDD50), ×1.8 */
export const fmtDegDays = (cDays: number, imperial: boolean): string => (imperial ? `${Math.round(cDays * 1.8)}` : `${cDays}`);

/** THE LENS: what paints the zone model in the main view — zone colours by
 *  default, a result once a run exists. One control, shown on ZONES and RUN. */
export function LensPicker(p: { lens: Lens; legend: Legend | null; hasRun: boolean; onLens: (l: Lens) => void; imperial?: boolean;
  /** the hour on the design day a surface-temperature lens shows (1–24, the hour ending) and the words for its default (2026-10-08) */
  hour?: number; onHour?: (h: number) => void; hourWords?: string;
  /** the lenses offered, when not all (2026-10-12: RUN's model shows the surface temperatures alone) */
  only?: Lens[] }): React.ReactElement {
  const isTemp = p.lens === "surface-temp-summer" || p.lens === "surface-temp-winter";
  const end = (v: number): string => (p.legend?.units === "W" ? (p.imperial ? `${Math.round(v * 3.412142).toLocaleString()} Btu/h` : `${Math.round(v).toLocaleString()} W`)
    : p.legend?.units === "°C" ? (p.imperial ? `${(v * 9 / 5 + 32).toFixed(0)} °F` : `${v.toFixed(1)} °C`) : `${v.toFixed(0)} ${p.legend?.units ?? ""}`);
  const hex = (c: number | null): string => (c === null ? "transparent" : `#${(c >>> 8).toString(16).padStart(6, "0")}`);
  const W = (w: number | null): string => (w === null ? "—" : p.imperial ? `${Math.round(w * 3.412142).toLocaleString()} Btu/h` : `${Math.round(w).toLocaleString()} W`);
  const val = (v: number | null): string => (v === null ? "" : p.legend?.units === "W" ? W(v) : `${v.toFixed(0)} ${p.legend?.units ?? ""}`);
  return (
    <div className="lensBox">
      <label className="lensRow">
        painted by
        <select value={p.lens} onChange={(e) => p.onLens(e.target.value as Lens)}>
          {LENSES.filter((l) => !p.only || p.only.includes(l.id)).map((l) => <option key={l.id} value={l.id} disabled={!p.hasRun && l.id !== "none" && l.id !== "zone" && l.id !== "bc"}>{l.id === "none" ? "zone (the stored colours)" : l.label}</option>)}
        </select>
      </label>
      {!p.hasRun && <div className="idfInfo">no run yet — the loads paint once EnergyPlus has run (RUN)</div>}
      {isTemp && p.onHour && (
        <label className="lensRow" title="the hour on the design day — EnergyPlus reports each hour by its end (14 = 13:00–14:00)">
          hour <select value={p.hour ?? 14} onChange={(e) => p.onHour!(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{String(h - 1).padStart(2, "0")}:00–{String(h).padStart(2, "0")}:00</option>)}
          </select>
          {p.hourWords && <span className="muted"> {p.hourWords}</span>}
        </label>
      )}
      {p.legend && p.lens !== "none" && (
        <div className="legend">
          {p.legend.units
            ? <>
                <div className="legendBar" style={{ background: RAMP_CSS[p.legend.ramp] }} />
                <div className="legendEnds"><span>{end(p.legend.min)}</span><span>{end(p.legend.max)}</span></div>
              </>
            : <div className="idfInfo">one colour per {p.lens === "zone" ? "zone" : "boundary condition"}</div>}
          <div className="idfInfo">painted {p.legend.painted} · no value {p.legend.unpainted} · not emitted (grey) {p.legend.notEmitted}</div>
          {isTemp && p.legend.surfaces && (() => {
            const T = (c: number): string => (p.imperial ? `${(c * 9 / 5 + 32).toFixed(0)} °F` : `${c.toFixed(1)} °C`);
            const A = (m2: number): string => (p.imperial ? `${(m2 * 10.7639).toFixed(0)} ft²` : `${m2.toFixed(1)} m²`);
            const s = p.legend.surfaces;
            return (
              <table className="legendZones legendSurfaces" title="each exterior surface the colour paints: its room, its kind, the way it faces from true north and its tilt, its gross area, and its outside face temperature at the hour picked — EnergyPlus's Surface Outside Face Temperature on the design day">
                <thead><tr><th></th><th>zone</th><th>room</th><th>surface</th><th>facing</th><th className="num">tilt</th><th className="num">area</th><th className="num">outside face</th></tr></thead>
                <tbody>{s.map((r) => (
                  <tr key={r.epName} title={r.epName}><td><span className="legendSwatch" style={{ background: hex(r.color) }} /></td><td>{r.zone}</td><td>{r.room}</td><td>{r.type.toLowerCase()}</td>
                    <td>{r.facing}{r.facing !== "flat" ? ` ${r.azimuthDeg.toFixed(0)}°` : ""}</td><td className="num">{r.tiltDeg.toFixed(0)}°</td><td className="num">{A(r.areaM2)}</td><td className="num on">{T(r.c)}</td></tr>
                ))}</tbody>
                <tfoot><tr><td></td><td colSpan={6}>{s.length} exterior surfaces · coolest {s.length ? T(Math.min(...s.map((x) => x.c))) : "—"} · hottest {s.length ? T(Math.max(...s.map((x) => x.c))) : "—"}</td><td></td></tr></tfoot>
              </table>
            );
          })()}
          {!isTemp && p.legend.entries.length > 0 && p.legend.entries.some((e) => e.heatW !== null || e.color !== null) && (
            <table className="legendZones" title="each zone in its colour; its peaks are the engine's zone sizing — the design day's largest heating and cooling load (RUN › REPORT, HVAC Sizing Summary)">
              <thead><tr><th></th><th>zone</th>{p.legend.units && p.lens !== "zone-heating-peak" && p.lens !== "zone-cooling-peak" ? <th className="num">{p.legend.units}</th> : null}<th className="num">heating peak</th><th className="num">cooling peak</th></tr></thead>
              <tbody>{p.legend.entries.map((e) => (
                <tr key={e.zone}><td><span className="legendSwatch" style={{ background: hex(e.color) }} /></td><td>{e.zone}</td>
                  {p.legend!.units && p.lens !== "zone-heating-peak" && p.lens !== "zone-cooling-peak" ? <td className="num">{val(e.value)}</td> : null}
                  <td className={`num${p.lens === "zone-heating-peak" ? " on" : ""}`}>{W(e.heatW)}</td><td className={`num${p.lens === "zone-cooling-peak" ? " on" : ""}`}>{W(e.coolW)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** A NUMBER FIELD YOU CAN TYPE IN (2026-09-08, "now I can't edit the materials"): a controlled `<input type="number">`
 *  re-rendered from the parsed value clears on every "0" and "0." — 0.0127 could not be typed. The text is the field's
 *  own while it is focused; every complete number is committed as typed; the value is re-read only on blur or when it
 *  changes from outside (a units toggle, a revert). `null` is an empty field. */
export function NumInput(p: { value: number | null; onValue: (v: number | null) => void; digits?: number; className?: string; style?: React.CSSProperties; placeholder?: string; disabled?: boolean; title?: string; min?: number; max?: number }): React.ReactElement {
  const fmt = (v: number | null): string => (v === null || !Number.isFinite(v) ? "" : p.digits !== undefined ? String(Number(v.toFixed(p.digits))) : String(v));
  const [text, setText] = useState(fmt(p.value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(fmt(p.value)); }, [p.value, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="text" inputMode="decimal" className={p.className} style={p.style} placeholder={p.placeholder} disabled={p.disabled} title={p.title} value={text}
      onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setText(fmt(p.value)); }}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const t = e.target.value.replace(/,/g, ".");
        setText(t);
        if (t.trim() === "") { p.onValue(null); return; }
        const n = Number(t);
        if (!Number.isFinite(n) || !/\d$/.test(t)) return;                 // "0.", "-", ".": not yet a number
        const c = p.min !== undefined && n < p.min ? p.min : p.max !== undefined && n > p.max ? p.max : n;
        p.onValue(c);
      }} />
  );
}

/** THE ENGINE AS ITS LICENCE ASKS IT BE NAMED (EnergyPlus licence §4: "EnergyPlus version X"): "EnergyPlus, Version 26.1.0-6f2e40d102"
 *  → "EnergyPlus version 26.1.0"; no version read → "EnergyPlus" */
export function engineName(v: string | null | undefined): string {
  const x = /(\d+\.\d+\.\d+)/.exec(String(v ?? ""))?.[1];
  return x ? `EnergyPlus version ${x}` : "EnergyPlus";
}
