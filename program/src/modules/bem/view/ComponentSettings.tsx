// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SETTINGS OF THE SELECTED COMPONENT (user, 2026-09-10: "details of
// component settings will be in right column … specific setpoints for each
// selected component in the view can be shown and edited"). The name, the ID,
// the class and its Reference; the note and the refusals on the card; the QA on
// the card; the zones it serves; and its INPUTS — for a water-to-air heat pump a
// form of grouped inputs (user, 2026-09-14: the unit, the supply fan, the two
// coils, the supplemental heater, dehumidification, the water flow, the sizing
// ratio), for every other class the engine's fields from the schema with the
// names, nodes and references the program assigns left out ("do not require
// input labels as they are assigned by the program"; a missing connection is an
// error on the card, never a field). With nothing selected: what the sheet
// compiles to and what it refuses.

import { useState } from "react";
import type { EpSchema, EpField } from "../core/epSchema.js";
import type { BemInput } from "../core/bemInput.js";
import type { BemModelOutcome } from "../pipeline.js";
import type { FieldValue, SystemFields } from "../core/bemDb.js";
import { type Assembly, type AsmNode, type CompiledAssembly, type ZoneAssign, NODE_LABEL, GROUP_OF, classOf, isResource, isAirLoop, isLoop, patchNode, detach, removeRoom, toggleZone, toggleThermostat, zonesOf, foldTerminals, TERMINAL_CLASSES, TERMINAL_FIELD, SUPPLY_SETPOINT_FIELD, TERMINAL_MIN_FRACTION, CHANGEOVERS, defaultTerminalFor, SUPPLEMENTAL_FIELD, COIL_MODELS, coilModelOf, ATTACH_LABEL, THERMOSTAT_SIDE_FIELD, servesByClass, substitute } from "../core/assembly.js";
import { formOf, formKeys, GHX_TYPES, isGhxClass, CARD_KEYS } from "../core/componentForms.js";
import { ComponentForm, Group, Row, Slider } from "./ComponentForm.js";
import { DEHUMIDIFY_RH_FIELD, DEHUMIDIFY_RH_DEFAULT } from "../core/epAssemble.js";
import { HVAC_LABELS, capabilityOf } from "../core/bemSystems.js";
import { OUT_OF_REACH } from "../core/bemIdf.js";
import type { HvacRuling } from "../core/bemDb.js";
import { GROUP_COLOR, zoneColor } from "./SystemsAssembly.js";
import { FieldTable, RefButton, ScheduleSelect } from "./SystemOptions.js";
import { srcClass, NumInput } from "./bemUi.js";
import { qaRowsByNode } from "./SystemQaPanel.js";
import { flowAtEye, flowFromEye, flowUnit, fmtFlow, fmtWattsPerFlow, L_S_PER_CFM, unitAtEye } from "../core/units.js";
import type { IoReference } from "../core/ioReference.js";
import type { ScheduleProfile, ScheduleRef } from "../core/schedules.js";
import { QA_RULES } from "../core/systemQa.js";
import { bedroomsOfFaces } from "../core/bemGains.js";
import { UH_PEAK_FIELD, UH_PEAK_TIME_FIELD } from "../core/eplusSql.js";
import { FLUID_FIELD, FREEZE_TABLE, GLYCOL_WORDS, DOW_MARGIN_K, loopFluidOf, fluidDerate, type Glycol, LOOP_DT_FIELD, LOOP_DT_OPTIONS, SIZING_FLUID_C, loopDtOf, rhoCpOf, type LoopDtSource } from "../core/loopFluid.js";

const FT2 = 10.7639;
const CFM = 4.719474e-4;   // m³/s per cfm
const isTerminalCard = (n: AsmNode): boolean => n.kind === "terminal" || (n.kind === "component" && (n.cls ?? "").startsWith("AirTerminal:"));
/** the damper's label in the user's words, from its class */
const damperWord = (cls: string): string => TERMINAL_CLASSES.find((t) => t.cls === cls)?.label ?? cls;

/** THE FOLD (user, 2026-09-13: the damper lives inside the Zone card): the terminal cards on the sheet, and one button that
 *  folds every one that sits between one unit and one Zone — the card removed, the unit's line drawn to the Zone, the damper's
 *  class and fields taken onto the Zone. Named before it is pressed; the load never rewrites a drawing. */
function FoldTerminals({ p }: { p: SettingsProps }): React.ReactElement | null {
  const cards = p.asm.nodes.filter(isTerminalCard);
  if (!cards.length) return null;
  const f = foldTerminals(p.asm, p.assign);
  return (
    <div className="src-warn">
      {cards.length} terminal card{cards.length === 1 ? "" : "s"} on the sheet — the Zone's Air in is the terminal now: the damper's type and its two fields are the Zone's settings, and a unit's Air out runs straight to the Zone.{" "}
      <button className="chip" disabled={!f.folded.length} onClick={() => { p.onChange(f.asm, f.assign); p.onSel(null); }} title={f.folded.length ? `folds ${f.folded.join(", ")}: each card removed, its unit's line drawn to its Zone, its damper's class kept on the Zone` : "no card sits between one unit and one Zone"}>Fold {f.folded.length} into {f.folded.length === 1 ? "its Zone" : "their Zones"}</button>
      {f.left.length > 0 && <span> · left as drawn (not between one unit and one Zone): {f.left.join(", ")}</span>}
    </div>
  );
}

export interface SettingsProps {
  /** the component catalogue: a card that IS an EnergyPlus class takes its connectors and its fields from it */
  catalogue?: import("../core/epCatalogue.js").Catalogue | null;
  asm: Assembly; assign: ZoneAssign; onChange: (a: Assembly, assign?: ZoneAssign) => void;
  sel: string | null; onSel: (id: string | null) => void;
  compiled: CompiledAssembly; schema: EpSchema | null; model: BemModelOutcome | null; input: BemInput | null;
  conditioned: string[]; imperial: boolean; ventilationScheduled: boolean;
  /** the Input Output Reference's index, for the Reference button on every component (2026-09-13 night) */
  ioRef?: IoReference | null;
  /** the library's schedules that fit an availability or on/off field (0…1), for the schedule dropdowns (2026-09-14) */
  schedules?: ScheduleProfile[];
  /** the SCHEDULES › HVAC availability role's pick, named in the dropdowns */
  availabilityRole?: ScheduleRef | null;
  /** the latest run's sizing rows (2026-10-08): a unit heater's peak over the run shows on its card */
  runSizing?: import("../core/eplusSql.js").SizingDetail[] | null;
}

export function ComponentSettings(p: SettingsProps): React.ReactElement {
  const node = p.sel ? p.asm.nodes.find((n) => n.id === p.sel) ?? null : null;
  const edge = p.sel && !node ? p.asm.edges.find((e) => e.id === p.sel) ?? null : null;
  if (node) return <NodeSettings node={node} p={p} />;
  if (edge) {
    const name = (id: string): string => { const n = p.asm.nodes.find((x) => x.id === id); return n ? n.label ?? NODE_LABEL[n.kind] : id; };
    return <div className="sysSettings"><div className="sysOptHead"><b>connector</b> · {name(edge.from)} → {name(edge.to)} <button className="chip" onClick={() => { p.onChange({ ...p.asm, edges: p.asm.edges.filter((e) => e.id !== edge.id) }); p.onSel(null); }}>remove</button></div></div>;
  }
  return <Compiled p={p} />;
}

function Compiled({ p }: { p: SettingsProps }): React.ReactElement {
  const c = p.compiled;
  return (
    <div className="sysSettings">
      <div className="sysOptHead"><span className="muted">select a component on the sheet for its inputs · </span>{p.asm.nodes.length} components · {p.asm.edges.length} connectors</div>
      {(() => { const saved = p.model?.systems.filter((r) => r.source !== "code-default") ?? []; return saved.length ? <div className="muted" title="what the SAVED sheet compiled to — the model bem.db holds; the rows below are the sheet as drawn now">saved model: {saved.map((r) => `${r.id} (${r.zones.length})`).join(", ")}</div> : null; })()}
      <FoldTerminals p={p} />
      {c.hvac.map((h) => (
        <div key={h.id} className="asmRow"><b className={srcClass("user")}>{h.id}</b> <span>{HVAC_LABELS[h.kind].split(" (")[0]}</span> <span className="muted">{h.zones.length ? h.zones.join(", ") : "no zone"}</span>
          {h.fields && <span className="muted"> · {Object.entries(h.fields).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}</span>}
          {h.doas && <span className="muted"> · outdoor air from {h.doas.id}</span>}
          {h.plant?.hotWater && <span className="muted"> · on {h.plant.hotWater.id}{h.plant.hotWater.boiler ? " (boiler)" : " (no boiler)"}</span>}
          {h.plant && !h.plant.hotWater && <span className="muted"> · mixed-water loop{h.plant.boiler ? " · boiler" : ""}{h.plant.tower ? " · tower" : ""}</span>}
          {h.wired && <span className="muted"> · generated: {generatedWord(h.wired)}</span>}
        </div>
      ))}
      {c.loops.map((l) => (
        <div key={l.id} className="asmRow"><b className={srcClass("user")}>{l.id}</b> <span>{l.cls}</span> <span className="muted">generated: {l.pump.cls} on the supply inlet branch · supply {l.producers.map((q) => q.name).join(", ")} · demand {l.consumers.join(", ") || "—"}</span></div>
      ))}
      {c.ventilation?.wholeHouse && <div className="asmRow"><b className={srcClass("user")}>whole-house</b> <span>{c.ventilation.wholeHouse.kind}{c.ventilation.wholeHouse.recovery ? ` · ${c.ventilation.wholeHouse.recovery}` : ""}</span> <span className="muted">{c.ventilation.wholeHouse.zones ? c.ventilation.wholeHouse.zones.join(", ") : "every conditioned zone"}</span></div>}
      {c.ventilation?.local?.map((l) => <div key={l.id} className="asmRow"><b className={srcClass("user")}>exhaust</b> <span>{l.zone}</span> <span className="muted">{fmtFlow(l.cfm ?? (/bath|wc|powder/i.test(l.zone) ? 50 : 100), p.imperial)}{p.ventilationScheduled ? "" : " · waits on SCHEDULES › ventilation"}</span></div>)}
      {!c.hvac.length && !c.ventilation && <div className="muted">ideal loads in every conditioned zone — the code default</div>}
      {c.refusals.length > 0 && <div className="src-warn">refused: {c.refusals.map((r) => r.text).join(" · ")}</div>}
      {c.cautions.length > 0 && <div className={srcClass("user")}>note: {c.cautions.map((r) => r.text).join(" · ")}</div>}
    </div>
  );
}

/** what the generator writes for a wired ruling, in one line: the fan, the coils' model, the control, the loop */
function generatedWord(w: NonNullable<import("../core/bemDb.js").HvacRuling["wired"]>): string {
  const control = w.control ?? "Load";
  const ctl = control === "SetPoint" ? `SetPoint${w.changeover ? ` · ${CHANGEOVERS.find((c) => c.id === w.changeover)?.label ?? w.changeover}` : ""}` : `follows ${w.controlZone || "one zone"}${w.uncontrolled?.length ? `; ${w.uncontrolled.join(", ")} served, not controlled` : ""}`;
  return `${w.fan.cls} · ${w.cooling.cls.replace(/^Coil:Cooling:WaterToAirHeatPump:/, "")} coils · ${ctl} · ${w.loop ? `water on ${w.loop}` : "water on no loop"}${w.oa ? " · outdoor air through a core" : ""}`;
}

/** THE TWO SIDES OF A ZONE'S THERMOSTAT (user, 2026-09-14: "checkboxes for applicability — cooling checked off means no cooling"): a checkbox
 *  per side, defaulted from what the zone's equipment can do (a baseboard heats only: cooling unchecked and locked) and the user's to switch off on
 *  equipment that could; a side that is off has its setpoint put out of reach in the IDF (50 °C / −50 °C — the shape the unit heater has had
 *  since a heating-only thermostat made the engine skip sizing its zone, measured 2026-09-11), so nothing calls for it and no unmet hours count
 *  on that side. One source: the Zone node's fields, edited here and on the ZONES tab alike. */
export function ZoneSides(p: { node: AsmNode; feeder: HvacRuling | null; imperial: boolean; onPatch: (f: (n: AsmNode) => AsmNode) => void; compact?: boolean;
  /** READ ONLY (the user, 2026-10-06: "use only one location for inputs, the Zones tab"): the sheet's Zone card shows the setpoints, ZONES edits them */
  readOnly?: boolean }): React.ReactElement {
  const cap = p.feeder ? capabilityOf(p.feeder.kind, p.feeder.fields) : { heat: true, cool: true, why: "" };
  const tempIn = (c: number | undefined, dflt: number): number => Number(((p.imperial ? (c ?? dflt) * 9 / 5 + 32 : c ?? dflt)).toFixed(1));
  const tempOut = (v: number | null): number | undefined => (v === null ? undefined : p.imperial ? Number(((v - 32) * 5 / 9).toFixed(2)) : v);
  const fmt = (c: number): string => `${tempIn(c, c)} ${p.imperial ? "°F" : "°C"}`;
  const setField = (key: string, v: string | number | undefined): void => p.onPatch((x) => { const f = { ...(x.fields ?? {}) }; if (v === undefined) delete f[key]; else f[key] = v; const m = { ...x }; if (Object.keys(f).length) m.fields = f; else delete m.fields; return m; });
  const side = (s: "heating" | "cooling"): React.ReactElement => {
    const key = s === "heating" ? "heating_setpoint_c" : "cooling_setpoint_c", flag = THERMOSTAT_SIDE_FIELD[s], can = s === "heating" ? cap.heat : cap.cool, dflt = s === "heating" ? 20 : 25.5556, reach = s === "heating" ? OUT_OF_REACH.heatC : OUT_OF_REACH.coolC;
    const on = can && p.node.fields?.[flag] !== "off";
    const v = p.node.fields?.[key];
    if (p.readOnly) return (
      <span key={s} className={on ? srcClass(typeof v === "number" ? "user" : "code-default") : can ? "src-warn" : "muted"} title="set on the ZONES tab — the one place a zone's thermostat is typed">
        {s} {on ? fmt(typeof v === "number" ? v : dflt) : can ? "OFF" : `none — ${cap.why}`}
      </span>
    );
    return (
      <label key={s} className={`zoneSide${on ? "" : " off"}`} title={!can ? `${cap.why} — the ${s} setpoint is put out of reach (${fmt(reach)}) so nothing calls for ${s}; no unmet hours count on this side` : on ? `uncheck to switch ${s} off for this zone: its setpoint is put out of reach (${fmt(reach)}) and nothing calls for ${s}` : `off — the ${s} setpoint is put out of reach (${fmt(reach)}); check to restore it`}>
        <input type="checkbox" checked={on} disabled={!can} onChange={(e) => setField(flag, e.target.checked ? undefined : "off")} />
        {s}{p.compact ? "" : " setpoint"} <NumInput className={srcClass(typeof v === "number" ? "user" : "code-default")} value={on ? tempIn(typeof v === "number" ? v : undefined, dflt) : null} placeholder={on ? undefined : "none"} onValue={(val) => setField(key, tempOut(val))} disabled={!on} digits={1} /> <span className="muted">{p.imperial ? "°F" : "°C"}{!can ? ` · none — ${cap.why}` : !on ? " · off" : ""}</span>
      </label>
    );
  };
  if (p.readOnly) return <div className="muted">thermostat: {side("heating")} · {side("cooling")} <span>— set on the ZONES tab</span></div>;
  return <>{side("heating")}{side("cooling")}</>;
}

/** THE EXCHANGER'S TYPE (user, 2026-09-14: "GroundHeatExchanger:System requires a subset approach"): the ground heat exchanger's kind IS the
 *  card's class — a vertical borefield, a slinky, a pond, a surface, a horizontal trench, or the fluid-to-fluid exchanger (offered and refused).
 *  Changed in place as the right-click menu changes a card: the id, the place and the lines kept (re-hung by medium); the numbers both kinds
 *  share — the soil, the pipe, the flow — travel with it where the two classes' fields agree in units; the rest are named. */
function GhxType({ n, p }: { n: AsmNode; p: SettingsProps }): React.ReactElement {
  const cls = classOf(n);
  const [note, setNote] = useState<string | null>(null);
  const change = (to: string): void => {
    const t = GHX_TYPES.find((x) => x.cls === to);
    if (!t || to === cls) return;
    const r = substitute(p.asm, n.id, { node: "component", cls: to, label: t.label }, p.catalogue ?? null);
    const into = formOf(to);
    const keep: SystemFields = {}, dropped: string[] = [];
    const unitsOf = (c: string, k: string): string | null => p.schema?.fieldsOf(c).find((x) => x.key === k)?.units ?? null;
    for (const [k, v] of Object.entries(n.fields ?? {})) {
      if ((Object.values(FLUID_FIELD) as string[]).includes(k) || (into && formKeys(into).has(k) && (CARD_KEYS.includes(k) || unitsOf(cls, k) === unitsOf(to, k)))) keep[k] = v; else dropped.push(k.replace(/_/g, " "));
    }
    let asm = r.asm;
    if (Object.keys(keep).length) asm = patchNode(asm, n.id, (x) => ({ ...x, fields: keep }));
    p.onChange(asm);
    setNote(`→ ${t.label}: ${r.dropped.length ? `lines dropped: ${r.dropped.map((d) => `${d.port} → ${d.other}`).join(", ")}` : "every line kept"}${dropped.length ? ` · not carried over: ${dropped.join(", ")}` : ""}`);
  };
  const t = GHX_TYPES.find((x) => x.cls === cls);
  return (
    <div className="inGroup">
      <div className="inTitle">Type</div>
      <Row k="exchanger" title="the ground heat exchanger's kind — the card's class, changed in place: its lines re-hung by medium, the numbers both kinds share kept">
        <select className={srcClass("user")} value={cls} onChange={(e) => change(e.target.value)}>
          {GHX_TYPES.map((x) => <option key={x.cls} value={x.cls} title={`${x.sub}${x.refused ? ` — ${x.refused}` : ""}`}>{x.label}{x.refused ? " — refused" : ""}</option>)}
        </select>
        <span className={t?.refused ? "src-warn inSub" : "muted inSub"}>{t?.refused ?? t?.sub}{note ? ` · ${note}` : ""}</span>
      </Row>
    </div>
  );
}

/** THE LOOP'S FLUID (user, 2026-10-08: "needs to show liquid used and any antifreeze added … feedback on freeze protection used (type,
 *  percentage represents protection down to what temperature, and derated capacity %)"): water, or a glycol at a percentage by volume or
 *  weight — the freezing point from Dow's tables, Dow's 3 °C margin, and the mixture beside water from the engine's own glycol table */
function LoopFluidInputs({ n, p }: { n: AsmNode; p: SettingsProps }): React.ReactElement {
  const f = n.fields ?? {};
  const set = (patch: Record<string, string | number | undefined>): void => p.onChange(patchNode(p.asm, n.id, (x) => {
    const g: SystemFields = { ...(x.fields ?? {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete g[k]; else g[k] = v; }
    const m = { ...x }; if (Object.keys(g).length) m.fields = g; else delete m.fields; return m;
  }));
  const g = f[FLUID_FIELD.antifreeze] === "PropyleneGlycol" || f[FLUID_FIELD.antifreeze] === "EthyleneGlycol" ? (f[FLUID_FIELD.antifreeze] as Glycol) : null;
  const pct = typeof f[FLUID_FIELD.pct] === "number" ? (f[FLUID_FIELD.pct] as number) : null;
  const basis = f[FLUID_FIELD.basis] === "weight" ? "weight" : "volume";
  const fl = loopFluidOf(f);
  const T = (c: number, d = 1): string => (p.imperial ? `${(c * 9 / 5 + 32).toFixed(d)} °F` : `${c.toFixed(d)} °C`);
  const d0 = fl ? fluidDerate(fl, 0) : null, d10 = fl ? fluidDerate(fl, 10) : null;
  return (
    <div className="inGroup">
      <div className="inTitle">Loop fluid</div>
      <Row k="liquid" title="what the ground loop carries — typed here, the one place; the loop this exchanger sits on is written with it (FluidProperties:GlycolConcentration, the loop's Fluid Type)">
        <select className={srcClass(g ? "user" : "code-default")} value={g ?? "Water"} onChange={(e) => set(e.target.value === "Water" ? { [FLUID_FIELD.antifreeze]: undefined, [FLUID_FIELD.pct]: undefined, [FLUID_FIELD.basis]: undefined } : { [FLUID_FIELD.antifreeze]: e.target.value })}>
          <option value="Water">water, no antifreeze</option>
          <option value="PropyleneGlycol">water + propylene glycol</option>
          <option value="EthyleneGlycol">water + ethylene glycol</option>
        </select>
        {g && <>
          <NumInput className={srcClass(pct !== null ? "user" : "code-default")} value={pct} placeholder="type %" onValue={(v) => set({ [FLUID_FIELD.pct]: v ?? undefined })} digits={1} min={0} max={60} /> %
          <select className={srcClass(f[FLUID_FIELD.basis] ? "user" : "code-default")} value={basis} onChange={(e) => set({ [FLUID_FIELD.basis]: e.target.value })} title="a loop is usually mixed and labelled by volume; Dow's tables give both">
            <option value="volume">by volume</option><option value="weight">by weight</option>
          </select>
        </>}
        {!g && <span className="muted inSub">plain water freezes at {T(0)} — the engine's water data stop there</span>}
      </Row>
      {g && !fl && <div className="src-warn">type the percentage — until then the loop is written as plain water</div>}
      {fl && <>
        <Row k="freeze protection" title={`${FREEZE_TABLE[fl.glycol].source} — by weight % with the matching volume %, read between rows`}>
          <span><b className="src-user">{fl.volumePct.toFixed(1)} vol% = {fl.weightPct.toFixed(1)} wt%</b> {GLYCOL_WORDS[fl.glycol]} freezes at <b>{T(fl.freezeC)}</b> · Dow: keep the loop above <b>{T(fl.freezeC + DOW_MARGIN_K)}</b> ({DOW_MARGIN_K} °C margin){fl.beyond ? " · beyond Dow's table — the last row is used" : ""}</span>
        </Row>
        <Row k="beside water" title="the engine's own built-in glycol properties (EnergyPlus DataSets/GlycolPropertiesRefData.idf), the mixture at its weight fraction against water at the same temperature (water's 0 °C row below freezing)">
          {d0 && d10 ? <span>carries <b>{(d0.heatPerVolume * 100).toFixed(1)} %</b> of water's heat per litre per degree → <b>{d0.extraFlowPct.toFixed(1)} % more flow</b> for the same heat at the same ΔT (at {T(0, 0)}; {d10.extraFlowPct.toFixed(1)} % at {T(10, 0)}) · viscosity <b>{d0.viscosityX.toFixed(1)}×</b> water's (more pump work, a thicker film in the pipe) · conductivity {(d0.conductivity * 100).toFixed(0)} %</span>
            : <span className="muted">the engine's table has no row for this mixture at {T(0, 0)}</span>}
        </Row>
        <div className="muted">EnergyPlus's water-to-air heat pump coils have no glycol input — their curves read the entering water temperature and the flow. The glycol acts through the loop: its specific heat and density set the loop's temperatures for the flow it moves, its viscosity and conductivity the borefield pipe's resistance. Below the engine's table ({fl.glycol === "PropyleneGlycol" ? "PG" : "EG"} data start near the freezing point) the run warns.</div>
      </>}
    </div>
  );
}

/** THE LOOP ΔT FOR FLOW SIZING (user, 2026-10-08: "Show on pump card the loop dT … EnergyPlus basic as dropdown option (10F), but show
 *  WaterFurnace Closed loop (8F) which we will use, and add option for custom"): the ΔT the heat pumps' water is sized to, with the loop's
 *  fluid (its ground heat exchanger's card) giving the flow per ton of heat moved */
function PumpDtInputs({ n, p }: { n: AsmNode; p: SettingsProps }): React.ReactElement {
  const f = n.fields ?? {};
  const set = (patch: Record<string, string | number | undefined>): void => p.onChange(patchNode(p.asm, n.id, (x) => {
    const g: SystemFields = { ...(x.fields ?? {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete g[k]; else g[k] = v; }
    const m = { ...x }; if (Object.keys(g).length) m.fields = g; else delete m.fields; return m;
  }));
  const dt = loopDtOf(f);
  const loop = p.compiled.loops.find((l) => l.id === p.compiled.rulingIds[n.id]) ?? null;
  const fl = loop ? loop.producers.map((x) => loopFluidOf(x.fields)).find((x) => x) ?? null : null;
  const rc = rhoCpOf(fl);
  const TON_W = 3516.853, GPM = 15850.32;   // 12,000 Btu/h; m³/s → US gpm
  const perTon = (TON_W / (rc * dt.k)) * GPM, perKw = (1000 / (rc * dt.k)) * 1000;   // gpm per ton, L/s per kW
  const custom = typeof f[LOOP_DT_FIELD.k] === "number" ? (f[LOOP_DT_FIELD.k] as number) : null;
  const dtEye = (k: number): number => Number((p.imperial ? k * 9 / 5 : k).toFixed(2));
  const opt = LOOP_DT_OPTIONS.find((o) => o.id === dt.source)!;
  return (
    <div className="inGroup">
      <div className="inTitle">Flow sizing</div>
      <Row k="loop ΔT" title="the temperature difference across the heat pumps' water side at full load — each coil's water flow is the heat it moves through the loop ÷ (ρ·cp × ΔT), and the loop's Sizing:Plant takes the same ΔT">
        <select className={srcClass(dt.ruled ? "user" : "code-default")} value={dt.ruled ? (f[LOOP_DT_FIELD.source] as string) : "energyplus"} onChange={(e) => set({ [LOOP_DT_FIELD.source]: e.target.value as LoopDtSource })}>
          {LOOP_DT_OPTIONS.map((o) => <option key={o.id} value={o.id} title={o.words}>{o.label}</option>)}
        </select>
        {(f[LOOP_DT_FIELD.source] === "custom") && <><NumInput className={srcClass(custom !== null ? "user" : "code-default")} value={custom === null ? null : dtEye(custom)} placeholder="type ΔT" onValue={(v) => set({ [LOOP_DT_FIELD.k]: v === null ? undefined : Number((p.imperial ? v * 5 / 9 : v).toPrecision(6)) })} digits={2} min={0} /> {p.imperial ? "°F" : "K"}</>}
        <span className="muted inSub">{dt.k.toFixed(2)} K = {(dt.k * 9 / 5).toFixed(1)} °F · {opt.words}{dt.ruled ? "" : " — the program's standing value until picked here; the coils keep the example's flows"}{f[LOOP_DT_FIELD.source] === "custom" && custom === null ? " — type the ΔT; until then 10 °F" : ""}</span>
      </Row>
      <Row k="flow" title={`the flow for one ton (12,000 Btu/h) of heat moved through the loop at this ΔT, the fluid's ρ·cp at ${SIZING_FLUID_C} °C from the engine's built-in table`}>
        <span><b>{perTon.toFixed(2)} gpm per ton</b> ({perKw.toFixed(3)} L/s per kW) of heat moved · fluid: {fl ? `${fl.pct}% ${GLYCOL_WORDS[fl.glycol]} by ${fl.basis}` : "water"} (the ground heat exchanger's card){loop ? ` · loop ${loop.id}` : " · this pump is on no loop"}</span>
      </Row>
      <div className="muted">heating draws capacity × (1 − 1/COP) from the loop, cooling rejects capacity × (1 + 1/COP) into it — each speed of each coil gets the flow for its own heat at this ΔT, and the engine scales it with the coil's autosized capacity. The sized flows read back in RUN › REPORT (Component Sizing).</div>
    </div>
  );
}

/** THE UNIT HEATER'S PEAK (user, 2026-10-08: "Show garage heater at 3.8kW and report peak"): the latest run's largest heating rate and
 *  when, against the capacity the card gives it */
function UnitHeaterPeak({ n, p }: { n: AsmNode; p: SettingsProps }): React.ReactElement {
  const h = p.compiled.hvac.find((x) => x.id === p.compiled.rulingIds[n.id]);
  const units = (h?.zones ?? []).map((z) => `${z} unit heater`.toUpperCase());
  const rows = (p.runSizing ?? []).filter((r) => r.cls === "ZoneHVAC:UnitHeater" && units.includes(r.subject.toUpperCase()));
  const cap = typeof n.fields?.nominal_capacity === "number" ? (n.fields.nominal_capacity as number) : null;
  const W = (w: number): string => (p.imperial ? `${(w * 3.412142).toFixed(0)} Btu/h (${(w / 1000).toFixed(2)} kW)` : `${(w / 1000).toFixed(2)} kW`);
  return (
    <div className="inGroup">
      <div className="inTitle">The last run</div>
      {!p.runSizing ? <div className="muted">no run read yet — run the model; the heater's peak heating rate shows here</div>
        : !rows.length ? <div className="muted">the last run has no peak for this heater — runs made before 2026-10-08 did not ask the engine for it; run again</div>
        : units.map((u) => {
          const pk = rows.find((r) => r.subject.toUpperCase() === u && r.field === UH_PEAK_FIELD), at = rows.find((r) => r.subject.toUpperCase() === u && r.field === UH_PEAK_TIME_FIELD);
          if (!pk || pk.value === null) return null;
          return <Row key={u} k="peak" title="the coil's largest heating rate in any timestep of the weather run (Heating Coil Heating Rate) and when">
            <span><b className="src-file">{W(pk.value)}</b> at {at?.text ?? "—"}{cap ? ` · ${((pk.value / cap) * 100).toFixed(0)} % of the ${W(cap)} typed` : " · the capacity is autosized"}</span>
          </Row>;
        })}
      {/* MEASURED 2026-10-08: a garage whose design day carries no heating load gets an air flow sized to 0 — a typed capacity then delivers nothing */}
      {(() => {
        const flow = (p.runSizing ?? []).find((r) => r.cls === "ZoneHVAC:UnitHeater" && units.includes(r.subject.toUpperCase()) && /Maximum Supply Air Flow Rate/i.test(r.field));
        return flow && flow.value === 0 && typeof n.fields?.maximum_supply_air_flow_rate !== "number"
          ? <div className="src-warn">the engine sized this heater's air flow to 0 — the zone's design day has no heating load — so it can deliver nothing whatever its capacity: type its air flow (the product's cfm) under Supply fan</div> : null;
      })()}
    </div>
  );
}

/** THE WATER-TO-AIR HEAT PUMP's INPUTS (user, 2026-09-14) — grouped by function, the names and nodes assigned by the program and never
 *  shown, the water side an error on the card when it is not connected: the unit's availability and coil model; the supply fan's operating
 *  mode, placement and air flow; a convergence slider per coil; the supplemental heater behind a switch; dehumidification; the coil water
 *  flow mode; the DX heating coil sizing ratio. Every value in its source colour; the engine's whole table a toggle away. */
function HeatPumpInputs({ n, p, units, setField, setFields }: { n: AsmNode; p: SettingsProps; units: import("../core/bemDb.js").HvacRuling[]; setField: (key: string, v: string | number | undefined) => void; setFields: (fields: Record<string, FieldValue> | undefined) => void }): React.ReactElement {
  const [table, setTable] = useState(false);
  const cls = "AirLoopHVAC:UnitaryHeatPump:WaterToAir";
  const sch = p.schema!;
  const f = n.fields ?? {};
  const field = (k: string): EpField | undefined => sch.classOf(cls)?.fields.find((x) => x.key === k);
  const eye = (k: string) => unitAtEye(sch.conversions, field(k)!, p.imperial);
  const nUnits = Math.max(units.length, 1);
  const model = coilModelOf(typeof f.cooling_coil_object_type === "string" ? f.cooling_coil_object_type : "") ?? coilModelOf(typeof f.heating_coil_object_type === "string" ? f.heating_coil_object_type : "") ?? "VariableSpeedEquationFit";
  const modelRuled = typeof f.cooling_coil_object_type === "string" || typeof f.heating_coil_object_type === "string";
  const suppOn = f[SUPPLEMENTAL_FIELD] !== "none";
  const dehum = f.dehumidification_control_type === "CoolReheat";
  const convDflt = nUnits > 1 ? Number((1 / nUnits).toPrecision(3)) : 0.001;
  const conv = (k: string): number => (typeof f[k] === "number" ? (f[k] as number) : convDflt);
  const num = (k: string): number | null => (typeof f[k] === "number" ? eye(k).toEye(f[k] as number) : null);
  const setNum = (k: string) => (v: number | null): void => setField(k, v === null ? undefined : eye(k).fromEye(v));
  const isAuto = (k: string): boolean => typeof f[k] === "string" && /^autosize$/i.test(String(f[k]));
  const tempAt = (c: number): string => `${eye("maximum_supply_air_temperature_from_supplemental_heater").toEye(c)} ${eye("maximum_supply_air_temperature_from_supplemental_heater").label}`;
  const enumSel = (k: string, dflt: string, title: string, opts: Array<{ v: string; label: string; title?: string; disabled?: boolean }>): React.ReactElement => (
    <select className={srcClass(typeof f[k] === "string" ? "user" : "dataset")} value={typeof f[k] === "string" ? String(f[k]) : dflt} onChange={(e) => setField(k, e.target.value)} title={title}>
      {opts.map((o) => <option key={o.v} value={o.v} title={o.title} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
  return (
    <div className="inForm">
      <div className="idfInfo inHead" title="grouped by function; the names, nodes and branches are assigned by the program — a connection that is missing is an error on the card"><b>Inputs</b> <span className="muted">· names, nodes and branches assigned by the program</span></div>
      <Group title="Unit" note={nUnits > 1 ? `written as ${nUnits} units, one per thermostat (the note above)` : undefined}>
        <Row k="availability" title="the unit runs while the schedule reads > 0; blank = always available (the engine's default)">
          <ScheduleSelect value={f.availability_schedule_name} onValue={(v) => setField("availability_schedule_name", v)} schedules={p.schedules ?? []} availabilityRole={p.availabilityRole} blank="always available" />
        </Row>
        <Row k="coil model" title="the parent's three water-to-air coil models — one pick sets the heating and the cooling coil's object type">
          <select className={srcClass(modelRuled ? "user" : "dataset")} value={model} onChange={(e) => { setField("cooling_coil_object_type", `Coil:Cooling:WaterToAirHeatPump:${e.target.value}`); setField("heating_coil_object_type", `Coil:Heating:WaterToAirHeatPump:${e.target.value}`); }} title={COIL_MODELS.find((m) => m.id === model)?.sub}>
            {COIL_MODELS.map((m) => <option key={m.id} value={m.id} title={`${m.sub}${m.refused ? ` — ${m.refused}` : ""}`} disabled={!!m.refused}>{m.label}{m.refused ? " — not written" : ""}</option>)}
          </select>
          <span className="muted inSub">{COIL_MODELS.find((m) => m.id === model)?.sub}</span>
        </Row>
      </Group>
      <Group title="Supply fan" note="Fan:OnOff — the only fan this parent takes">
        <Row k="operating mode" title="the fan's operating mode schedule: 0 = the fan cycles with the coils, > 0 = it runs continuously; blank = cycling (the engine's default)">
          <ScheduleSelect value={f.supply_air_fan_operating_mode_schedule_name} onValue={(v) => setField("supply_air_fan_operating_mode_schedule_name", v)} schedules={p.schedules ?? []} availabilityRole={p.availabilityRole} blank="cycling — the fan runs with the coils" always="continuous — the fan runs always" role={false} />
        </Row>
        <Row k="placement" title="BlowThrough: the fan ahead of the coils · DrawThrough: the fan after them">
          {enumSel("fan_placement", "BlowThrough", "the fan's place in the unit", [{ v: "BlowThrough", label: "BlowThrough — fan ahead of the coils" }, { v: "DrawThrough", label: "DrawThrough — fan after the coils" }])}
        </Row>
        <Row k="air flow rate" title="the supply air flow rate; autosize = the engine sizes it at the design days">
          <NumInput className={srcClass(typeof f.supply_air_flow_rate === "number" ? "user" : "code-default")} value={num("supply_air_flow_rate")} onValue={setNum("supply_air_flow_rate")} disabled={isAuto("supply_air_flow_rate")} placeholder="autosize" min={0} />
          <span className="muted">{eye("supply_air_flow_rate").label}</span>
          <button className={`chip${isAuto("supply_air_flow_rate") || f.supply_air_flow_rate === undefined ? " on" : ""}`} onClick={() => setField("supply_air_flow_rate", isAuto("supply_air_flow_rate") || f.supply_air_flow_rate === undefined ? undefined : "autosize")} title="the engine sizes it at the design days (the default)">autosize</button>
        </Row>
      </Group>
      {/* MEASURED 2026-09-14 (Furnaces.cc): the parent's two convergence fields are read on the SINGLE-SPEED coils' path (CalcNewZoneHeatCoolFlowRates,
          :6992 / :7516); the variable-speed control (ControlVSHPOutput, :9966) iterates on its own constant 0.001 — the split fixture's year moved
          not one kWh under 1/2. The field is written either way; the group says which coils read it. */}
      <Group title="Heating coil" note={`${model === "VariableSpeedEquationFit" ? "the convergence is read by the engine for the single-speed coils only" : ""}`}>
        <Row k="convergence" title={`the tolerance of the unit's part-load iteration in heating: it stops when its output is within this fraction of the zone's load. The engine's default is 0.001; ${nUnits > 1 ? `this card is written as ${nUnits} units, so the initial value is 1/${nUnits} = ${convDflt} — the reciprocal of the number of identical units, modelling one multizone unit's response` : "a single unit keeps the engine's default"}. Measured (Furnaces.cc): the field is read on the single-speed coils' path; the variable-speed control iterates on its own 0.001 (ControlVSHPOutput, :9966) — written either way`}>
          <Slider value={conv("heating_convergence")} ruled={typeof f.heating_convergence === "number"} onValue={(v) => setField("heating_convergence", v ?? undefined)} dflt={convDflt} title="drag: 0.001 … 1" />
        </Row>
      </Group>
      <Group title="Cooling coil" note={`${model === "VariableSpeedEquationFit" ? "as for heating" : ""}`}>
        <Row k="convergence" title={`the tolerance of the unit's part-load iteration in cooling — as for heating: ${nUnits > 1 ? `1/${nUnits} = ${convDflt} initially` : "the engine's 0.001"}; read by the engine for the single-speed coils, the variable-speed control on its own 0.001`}>
          <Slider value={conv("cooling_convergence")} ruled={typeof f.cooling_convergence === "number"} onValue={(v) => setField("cooling_convergence", v ?? undefined)} dflt={convDflt} title="drag: 0.001 … 1" />
        </Row>
      </Group>
      <Group title="Supplemental heater" on={suppOn} onSwitch={(on) => setField(SUPPLEMENTAL_FIELD, on ? undefined : "none")} note={suppOn ? undefined : "off — the parent requires a supplemental coil, so it is written never available (a schedule of 0)"}>
        <Row k="type" title="the supplemental coil's class; a water or steam coil needs a hot-water or steam loop the sheet does not write yet">
          {enumSel("supplemental_heating_coil_object_type", "Coil:Heating:Electric", "the supplemental coil", [
            { v: "Coil:Heating:Electric", label: "Electric" }, { v: "Coil:Heating:Fuel", label: "Fuel (gas, propane, oil)" },
            { v: "Coil:Heating:Water", label: "Hot water — not written (needs a hot-water loop)", disabled: true }, { v: "Coil:Heating:Steam", label: "Steam — not written (needs a steam loop)", disabled: true }])}
        </Row>
        <Row k="max supply air temperature" title="the supply air may not leave the supplemental heater warmer than this; autosize = the engine's own">
          <NumInput className={srcClass(typeof f.maximum_supply_air_temperature_from_supplemental_heater === "number" ? "user" : "dataset")} value={num("maximum_supply_air_temperature_from_supplemental_heater")} onValue={setNum("maximum_supply_air_temperature_from_supplemental_heater")} disabled={isAuto("maximum_supply_air_temperature_from_supplemental_heater")} placeholder={tempAt(50)} digits={1} />
          <span className="muted">{eye("maximum_supply_air_temperature_from_supplemental_heater").label}</span>
          <button className={`chip${isAuto("maximum_supply_air_temperature_from_supplemental_heater") ? " on" : ""}`} onClick={() => setField("maximum_supply_air_temperature_from_supplemental_heater", isAuto("maximum_supply_air_temperature_from_supplemental_heater") ? undefined : "autosize")} title="the engine sizes it">autosize</button>
        </Row>
        <Row k="max outdoor temperature" title="the supplemental heater runs only while the outdoor dry-bulb is below this (the engine's ceiling 21 °C = 69.8 °F)">
          <NumInput className={srcClass(typeof f.maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation === "number" ? "user" : "dataset")} value={num("maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation")} onValue={setNum("maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation")} placeholder={tempAt(21)} max={eye("maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation").toEye(21)} digits={1} />
          <span className="muted">{eye("maximum_outdoor_dry_bulb_temperature_for_supplemental_heater_operation").label}</span>
        </Row>
      </Group>
      <Group title="Dehumidification">
        <Row k="control" title="None = the unit meets the sensible load only · CoolReheat = the cooling coil runs past the dry-bulb setpoint to meet a humidity setpoint and the supplemental coil reheats (a humidistat is written in the control zone)">
          {enumSel("dehumidification_control_type", "None", "the engine's two", [{ v: "None", label: "None — sensible load only" }, { v: "CoolReheat", label: "CoolReheat — overcool, then reheat with the supplemental coil" }])}
        </Row>
        {dehum && (
          <Row k="dehumidify above" title={`the humidistat's dehumidifying setpoint, % RH; ${DEHUMIDIFY_RH_DEFAULT.percent} % is ${DEHUMIDIFY_RH_DEFAULT.citation}`}>
            <NumInput className={srcClass(typeof f[DEHUMIDIFY_RH_FIELD] === "number" ? "user" : "dataset")} value={typeof f[DEHUMIDIFY_RH_FIELD] === "number" ? (f[DEHUMIDIFY_RH_FIELD] as number) : DEHUMIDIFY_RH_DEFAULT.percent} onValue={(v) => setField(DEHUMIDIFY_RH_FIELD, v ?? undefined)} min={0} max={100} digits={0} />
            <span className="muted">% RH{suppOn ? "" : " — needs the supplemental heater on"}</span>
          </Row>
        )}
      </Group>
      <Group title="Water flow" note={model === "EquationFit" ? undefined : "read by the engine for the single-speed EquationFit coils only"}>
        <Row k="coil water flow" title="Constant: 100 % water flow whenever the unit is on · Cycling: flow follows the compressor's part-load ratio · ConstantOnDemand: 100 % while the coil has a load, 0 otherwise">
          {enumSel("heat_pump_coil_water_flow_mode", "Cycling", "the engine's three", [{ v: "Cycling", label: "Cycling — with the compressor's part load" }, { v: "Constant", label: "Constant — 100 % whenever on" }, { v: "ConstantOnDemand", label: "ConstantOnDemand — 100 % while there is a load" }])}
        </Row>
      </Group>
      <Group title="Sizing">
        <Row k="DX heating coil sizing ratio" title="the heating capacity relative to the cooling capacity the engine sizes; 1.0 = equal (the engine's default)">
          <NumInput className={srcClass(typeof f.dx_heating_coil_sizing_ratio === "number" ? "user" : "code-default")} value={typeof f.dx_heating_coil_sizing_ratio === "number" ? (f.dx_heating_coil_sizing_ratio as number) : 1} onValue={(v) => setField("dx_heating_coil_sizing_ratio", v === null || v === 1 ? undefined : v)} min={0.01} digits={2} />
        </Row>
      </Group>
      <button className={`chip${table ? " on" : ""}`} onClick={() => setTable((t) => !t)} title="every field of the class from the engine's schema, for the record — the same values, in IDD order">{table ? "hide the engine's table" : "the engine's table (every field)"}</button>
      {table && <FieldTable cls={cls} schema={sch} values={n.fields} onValues={setFields} imperial={p.imperial} ioRef={p.ioRef} schedules={p.schedules} availabilityRole={p.availabilityRole} heading="the engine's table" showAll />}
    </div>
  );
}

function NodeSettings({ node: n, p }: { node: AsmNode; p: SettingsProps }): React.ReactElement {
  const refused = p.compiled.refusals.filter((r) => r.node === n.id).map((r) => r.text);
  const cautions = p.compiled.cautions.filter((r) => r.node === n.id).map((r) => r.text);
  const qaRows = qaRowsByNode(p.compiled, p.model).get(n.id) ?? [];
  const set = (f: (x: AsmNode) => AsmNode): void => p.onChange(patchNode(p.asm, n.id, f));
  const cls = classOf(n);
  const skip = /^zone_name$|^template_thermostat_name$|^template_unitary_system_name$|^control_zone_or_thermostat_location_name$|^dedicated_outdoor_air_system_name$|^template_plant_loop_type$|^zone_or_zonelist|^schedule_name$|^design_flow_rate_calculation_method$|^flow_rate_per_floor_area$|^ventilation_type$|^design_flow_rate$|^control_type$/;
  const attachedKeys = new Set<string>();
  for (const a of n.attached ?? []) { const t = a.startsWith("coil-heat") ? ["heating_coil_type", "supplemental_heating_coil_type", "baseboard_heating_type"] : a.startsWith("coil-cool") ? ["cooling_coil_type"] : ["heat_recovery_type"]; for (const k of t) attachedKeys.add(k); }
  const nbrs = p.asm.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => p.asm.nodes.find((x) => x.id === (e.from === n.id ? e.to : e.from))).filter((x): x is AsmNode => !!x);
  // an air loop serves through its terminals; a terminal names its air loop
  const zones = isAirLoop(n.kind) ? [...new Set(nbrs.filter((x) => x.kind === "terminal").flatMap((x) => zonesOf(p.assign, x.id)))]
    : [...new Set([...zonesOf(p.assign, n.id), ...p.compiled.zones.filter((z) => z.fedBy === n.id).map((z) => z.name)])];   // a Zone card joined by Loc is served too
  const airLoop = n.kind === "terminal" ? nbrs.find((x) => isAirLoop(x.kind)) ?? null : null;
  const loopsOn = nbrs.filter((x) => isLoop(x.kind));
  const cfaByCells = p.input ? p.input.faces.filter((f) => f.category === "floor" && ((f.space && p.conditioned.includes(f.space)) || (f.spaceFacing && p.conditioned.includes(f.spaceFacing)))).reduce((t, f) => t + f.areaM2, 0) : 0;
  // the bedrooms ticked on ZONES (2026-10-07), as the model counted them — the one place a bedroom is said
  const bedsList = p.model?.built.model.gains?.bedrooms ?? null;
  const nbrByName = bedsList ? bedsList.length : p.input ? bedroomsOfFaces(p.input.faces) : 0;
  const serves = n.kind !== "boiler" && n.kind !== "tower" && !isLoop(n.kind) && n.kind !== "doas" && !isResource(n.kind) && n.kind !== "zone" && !(n.kind === "component" && !servesByClass(cls));
  // THE FORM (2026-09-14): a class with a spec — the unit heater, the pumps, the ground heat exchangers — reads as grouped inputs with roll-ups
  const spec = p.schema && n.kind !== "zone" && n.kind !== "exhaust" && n.kind !== "wholehouse" && !isResource(n.kind) ? formOf(cls) : null;
  const drawn = n.kind === "zone" ? p.compiled.zones.find((z) => z.id === n.id) ?? null : null;
  // the unit that serves this Zone and how it is controlled (2026-09-13): the thermostat's role and the damper's words follow it
  const feeder = drawn ? p.compiled.hvac.find((h) => h.zones.includes(drawn.name)) ?? null : null;
  const fw = feeder?.wired ?? null, setPoint = fw?.control === "SetPoint";
  const feederName = drawn?.fedBy ? (p.asm.nodes.find((x) => x.id === drawn.fedBy)?.ident?.trim() || p.asm.nodes.find((x) => x.id === drawn.fedBy)?.label || "the unit") : "the unit";
  // an air parent's own ruling, for its control and changeover selects
  const own = n.kind === "component" ? p.compiled.hvac.find((h) => h.id === p.compiled.rulingIds[n.id]) ?? null : null;
  // ONE HEAT PUMP PER THERMOSTAT (2026-09-13): a WaterToAir card on several T-on zones is written as a unit per zone, each with this card's settings
  const units = n.kind === "component" && p.compiled.splitIds?.[n.id] ? p.compiled.hvac.filter((h) => p.compiled.splitIds[n.id]!.includes(h.id)) : own ? [own] : [];
  const ownUnit = feeder && drawn?.fedBy && p.compiled.splitIds?.[drawn.fedBy] ? feeder.id : null;
  const setField = (key: string, v: string | number | undefined): void => set((x) => { const f = { ...(x.fields ?? {}) }; if (v === undefined || v === "") delete f[key]; else f[key] = v; const m = { ...x }; if (Object.keys(f).length) m.fields = f; else delete m.fields; return m; });
  const maxFlowRaw = n.fields?.[TERMINAL_FIELD.maxFlow], maxFlowM3s = typeof maxFlowRaw === "number" ? maxFlowRaw : null;
  const tempIn = (c: number | undefined, dflt: number): number => Number(((p.imperial ? (c ?? dflt) * 9 / 5 + 32 : c ?? dflt)).toFixed(1));
  const tempOut = (v: number | null): number | undefined => (v === null ? undefined : p.imperial ? Number(((v - 32) * 5 / 9).toFixed(2)) : v);
  return (
    <div className="sysSettings">
      <div className="sysOptHead">
        <span className="asmDot" style={{ background: n.kind === "zone" ? zoneColor(n.id) : GROUP_COLOR[GROUP_OF[n.kind]] }} />
        <input type="text" className="asmName" value={n.label ?? ""} placeholder={NODE_LABEL[n.kind]} onChange={(e) => set((x) => { const m = { ...x }; if (e.target.value) m.label = e.target.value; else delete m.label; return m; })} title="the component's name — the object's name in the IDF" />
        <span className="muted asmIdLabel">ID :</span>
        <input type="text" className="asmName asmIdentInput" value={n.ident ?? ""} placeholder="e.g. HP-1" onChange={(e) => set((x) => { const m = { ...x }; if (e.target.value) m.ident = e.target.value; else delete m.ident; return m; })} title="the component's ID (2026-09-10): shown under its name on the sheet; when given it names the IDF object" />
        <span className="muted" title="the EnergyPlus class this card is; right-click the card on the sheet to change it or remove it"> · {cls}</span>
        <RefButton cls={cls} ioRef={p.ioRef} />
      </div>
      {n.from && <div className={srcClass("file")} title={`${n.from.file} #${n.from.fileExpressId}`}>from the file: {n.from.name}{n.from.system ? ` · on ${n.from.system}` : ""}</div>}
      {refused.length > 0 && <div className="src-warn">refused: {refused.join(" · ")}</div>}
      {cautions.filter((t) => /switched off on this Zone card/.test(t)).map((t) => <div key={t} className="src-warn">⚠ {t}</div>)}
      {cautions.some((t) => !/switched off on this Zone card/.test(t)) && <div className={srcClass("user")}>note: {cautions.filter((t) => !/switched off on this Zone card/.test(t)).join(" · ")}</div>}
      {qaRows.length > 0 && (() => {
        // THE QA ON THE CARD (2026-09-13): the model's rows for this card, read back from bem.db — the sound rules in one line, each gap in words
        const checks = qaRows.flatMap((r) => r.checks), gaps = checks.filter((c) => c.verdict === "gap");
        return <div className="sysZones"><div className="muted" title={`the saved model's QA rows for this card: ${qaRows.map((r) => `${r.subject} [${r.kind}]`).join(", ")}`}>QA of the saved model: {gaps.length ? <span className="src-warn">{gaps.length} gap{gaps.length === 1 ? "" : "s"}</span> : <span className="ok">sound</span>} <span className="muted">· {qaRows.length} row{qaRows.length === 1 ? "" : "s"}, rules met {checks.filter((c) => c.verdict === "ok").map((c) => c.rule).join(" ") || "—"}</span></div>
          {gaps.map((c, i) => <div key={i} className="src-warn">✗ {c.rule} · {QA_RULES[c.rule]} — {c.text}</div>)}</div>;
      })()}
      {serves && (() => {
        // a component air parent serves the Zones its Air out reaches (its units' zones, compiled); a template kind the ZONES tab's assignment
        const served = units.length ? [...new Set(units.flatMap((u) => u.zones))] : zones;
        const airParent = n.kind === "component" && /^AirLoopHVAC:/.test(cls);
        return <div className="muted">serves: {served.length ? served.join(", ") : airParent ? "— run its Air out to each Zone's Air in" : isAirLoop(n.kind) ? "— (connect an air terminal, assign its zones in ZONES)" : "— (assign in ZONES)"}</div>;
      })()}
      {n.kind === "terminal" && <div className="muted">on: {airLoop ? airLoop.label ?? NODE_LABEL[airLoop.kind] : "— (connect it to an air loop)"}</div>}
      {isTerminalCard(n) && <FoldTerminals p={p} />}
      {n.kind === "component" && cls === "AirLoopHVAC:UnitarySystem" && (
        <div className="sysZones inGroup">
          <div className="inTitle">Control</div>
          <div className="muted">control: {cls === "AirLoopHVAC:UnitarySystem" ? (
            <select className={srcClass(n.fields?.control_type ? "user" : "dataset")} value={String(n.fields?.control_type ?? "")} onChange={(e) => setField("control_type", e.target.value)} title="the engine's own three: SetPoint for several zones, each on its own thermostat; Load or SingleZoneVAV for one thermostat">
              <option value="">the default for what it feeds{own?.wired?.control ? ` — ${own.wired.control}` : ""}</option>
              <option value="SetPoint">SetPoint — a controller polls every zone's thermostat: each damper follows its own, the zones' vote sets the mode, a setpoint per mode, the unit off while all are satisfied</option>
              <option value="Load">Load — one control zone's thermostat; the other zones served, not controlled</option>
              <option value="SingleZoneVAV">SingleZoneVAV — one zone, the unit modulating its damper's flow</option>
            </select>
          ) : <span>Load on ONE thermostat — this parent has no control field and takes Fan:OnOff alone (the engine's HeatPump.idf shape). EnergyPlus allows one controlling thermostat per unitary heat pump, so on several zones with a thermostat a separate unit is written for each, named this card + the zone, every one with the settings below; a zone with its T off is served by the first, not controlled.</span>}</div>
          {own?.wired?.control === "SetPoint" && (
            <div className="muted">changeover: <select className={srcClass(n.fields?.changeover ? "user" : "dataset")} value={String(n.fields?.changeover ?? "ZonePriority")} onChange={(e) => setField("changeover", e.target.value)} title="the engine's own four words (its zoning unit's priority_control_mode), transcribed into the arbiter: which mode the unit takes when zones ask for both">
              {CHANGEOVERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select> <span>{CHANGEOVERS.find((c) => c.id === (n.fields?.changeover ?? "ZonePriority"))?.sub} · the mode holds {0.25} h before it may flip · the unit stops while every thermostat is satisfied (the loop forced off)</span></div>
          )}
          {own?.wired?.control === "SetPoint" && (
            <div className="muted">supply setpoint per mode: <label>cooling <NumInput className={srcClass(typeof n.fields?.[SUPPLY_SETPOINT_FIELD.cooling] === "number" ? "user" : "dataset")} value={typeof n.fields?.[SUPPLY_SETPOINT_FIELD.cooling] === "number" ? tempIn(n.fields[SUPPLY_SETPOINT_FIELD.cooling] as number, 0) : null} placeholder="reset" onValue={(v) => setField(SUPPLY_SETPOINT_FIELD.cooling, tempOut(v))} digits={1} /> {p.imperial ? "°F" : "°C"}</label> <label>heating <NumInput className={srcClass(typeof n.fields?.[SUPPLY_SETPOINT_FIELD.heating] === "number" ? "user" : "dataset")} value={typeof n.fields?.[SUPPLY_SETPOINT_FIELD.heating] === "number" ? tempIn(n.fields[SUPPLY_SETPOINT_FIELD.heating] as number, 0) : null} placeholder="reset" onValue={(v) => setField(SUPPLY_SETPOINT_FIELD.heating, tempOut(v))} digits={1} /> {p.imperial ? "°F" : "°C"}</label> <span>typed = held there in that mode (the controller's own setpoint, a Scheduled manager); blank = reset to the neediest zone within {p.imperial ? "55–86 / 50–113 °F" : "12.8–30 / 10–45 °C"} (Warmest / Coldest)</span></div>
          )}
        </div>
      )}
      {n.kind === "component" && cls === "AirLoopHVAC:UnitaryHeatPump:WaterToAir" && p.schema && <HeatPumpInputs n={n} p={p} units={units} setField={setField} setFields={(fields) => set((x) => { const m = { ...x }; if (fields) m.fields = fields; else delete m.fields; return m; })} />}
      {loopsOn.length > 0 && <div className="muted">on: {loopsOn.map((l) => l.label ?? NODE_LABEL[l.kind]).join(", ")}</div>}
      {isResource(n.kind) && <div className="muted">a primary resource on the loop it is connected to. It becomes <b>{cls}</b> when the plant loop is written in full (tier 2); until then it is carried in the ruling and named as refused — the loop runs on its boiler and tower.</div>}
      {!!n.attached?.length && <div className="asmPills">{n.attached.map((a) => <span key={a} className="asmPill">{ATTACH_LABEL[a]} <button className="chip" onClick={() => p.onChange(detach(p.asm, n.id, a))} title="detach">×</button></span>)}</div>}
      {n.kind === "zone" && (
        <div className="sysZones">
          <div>rooms ({(n.rooms ?? []).length}): {(n.rooms ?? []).map((r) => <span key={r} className="asmPill">{r} <button className="chip" onClick={() => p.onChange(removeRoom(p.asm, n.id, r))} title="take this room out of the zone">×</button></span>)}{!(n.rooms ?? []).length && <span className="src-warn">none — drag rooms from LEVELS · SPACES onto the zone</span>}</div>
          <div className="muted">thermostat: {n.thermostat === false
            ? <span className="src-code">{setPoint ? `off — served at minimum flow, no thermostat: its damper holds its minimum and it reports no demand to ${feederName}` : "off — served, not controlled (the zone takes what the unit's supply gives; no ZoneControl:Thermostat is written)"}</span>
            : <span className="src-user">{setPoint ? `on — reports its demand to ${feederName}'s controller each timestep; its damper follows this thermostat, the zones' vote sets the mode, the unit stops when every thermostat is satisfied` : fw ? (fw.controlZone === drawn?.name ? (ownUnit ? `on — its own unit ${ownUnit} follows it (one heat pump per thermostat: the note on ${feederName})` : `on — ${feederName}'s control zone (${fw.control ?? "Load"} control follows one thermostat)`) : `on — a second thermostat on ${feederName}, which follows ${fw.controlZone || "another zone"}: served as drawn (set ${feederName}'s control to SetPoint for a thermostat in every zone)`) : "on — the zone's thermostat; the unit that serves it follows it"}</span>} <button className="chip" onClick={() => p.onChange(toggleThermostat(p.asm, n.id))} title="the T on the card does the same">{n.thermostat === false ? "switch on" : "switch off"}</button></div>
          <div className="muted">served by: {drawn?.fedBy ? <span className="src-user">{feederName}{ownUnit ? ` · its own unit ${ownUnit}` : ""}</span> : <span className="src-code">ideal loads — run a unit's Air out to its Air in, or join zone equipment's Loc to its Loc</span>}{drawn?.fans.length ? <span> · exhaust: {drawn.fans.map((f) => p.asm.nodes.find((x) => x.id === f)?.label ?? "Exhaust fan").join(", ")}</span> : null}{drawn?.oaFrom ? <span> · outdoor air from {p.asm.nodes.find((x) => x.id === drawn.oaFrom)?.label ?? "a DOAS"}</span> : null}</div>
          {fw && (
            // THE DAMPER THE ZONE CARRIES (user, 2026-09-13): the terminal object per zone is the Zone's own setting — none of the three has a coil in it
            <div className="sysZones">
              <div className="muted">damper: <select className={srcClass(n.fields?.[TERMINAL_FIELD.cls] ? "user" : "dataset")} value={String(n.fields?.[TERMINAL_FIELD.cls] ?? "")} onChange={(e) => setField(TERMINAL_FIELD.cls, e.target.value)} title="the air terminal object EnergyPlus writes for this zone — one per zone per air loop, on the supply; the return and the exhaust are nodes the generator writes">
                <option value="">{`${feederName}'s default — ${damperWord(defaultTerminalFor(fw.parent))}`}</option>
                {TERMINAL_CLASSES.map((t) => <option key={t.cls} value={t.cls}>{t.label}</option>)}
              </select> <span>{TERMINAL_CLASSES.find((t) => t.cls === (n.fields?.[TERMINAL_FIELD.cls] || defaultTerminalFor(fw.parent)))?.sub} · {String(n.fields?.[TERMINAL_FIELD.cls] || defaultTerminalFor(fw.parent))}</span> <RefButton cls={String(n.fields?.[TERMINAL_FIELD.cls] || defaultTerminalFor(fw.parent))} ioRef={p.ioRef} small /></div>
              <label>max flow <NumInput className={srcClass(maxFlowM3s !== null ? "user" : "code-default")} value={maxFlowM3s === null ? null : Number((p.imperial ? maxFlowM3s / CFM : maxFlowM3s).toFixed(p.imperial ? 0 : 4))} placeholder="autosize" onValue={(v) => setField(TERMINAL_FIELD.maxFlow, v === null ? undefined : p.imperial ? Number((v * CFM).toPrecision(6)) : v)} /> <span className="muted">{p.imperial ? "cfm" : "m³/s"} · blank = autosized to the zone's design load</span></label>
              {String(n.fields?.[TERMINAL_FIELD.cls] || defaultTerminalFor(fw.parent)) === "AirTerminal:SingleDuct:ConstantVolume:NoReheat"
                ? <span className="muted" title="the tab review, SYSTEMS item 1: the constant-volume outlet has no minimum-fraction field — a typed value was dropped silently before">no minimum fraction — a constant-volume outlet is a fixed share of the unit's flow, no damper</span>
                : <label>minimum fraction <NumInput className={srcClass(typeof n.fields?.[TERMINAL_FIELD.minFraction] === "number" ? "user" : "dataset")} value={typeof n.fields?.[TERMINAL_FIELD.minFraction] === "number" ? (n.fields[TERMINAL_FIELD.minFraction] as number) : TERMINAL_MIN_FRACTION} onValue={(v) => setField(TERMINAL_FIELD.minFraction, v === null ? undefined : v)} digits={2} min={0} max={1} /> <span className="muted">of the max flow the damper closes to · {TERMINAL_MIN_FRACTION} is the engine's own changeover example (ChangeoverBypassVAV.idf)</span></label>}
            </div>
          )}
          <ZoneSides node={n} feeder={feeder} imperial={p.imperial} onPatch={set} readOnly />
          <span className="muted">the thermostat of this zone in the IDF — the code's thermostat {p.imperial ? "72 / 75 °F" : "22.2 / 23.9 °C"} (the IECC standard reference design) until typed on ZONES; a side unchecked is put out of reach ({p.imperial ? "−58 / 122 °F" : "−50 / 50 °C"}) so nothing calls for it; its rooms become one thermal zone named {drawn?.name ?? "by its ID"}, a Space each</span>
          <button className="chip" onClick={() => p.onChange(toggleZone(p.asm, n.id))}>{n.collapsed ? "expand on the sheet" : "collapse on the sheet"}</button>
        </div>
      )}
      {n.kind === "wholehouse" && (
        <div className="sysZones">
          <select className={srcClass("user")} value={n.vent?.kind ?? "Exhaust"} onChange={(e) => set((x) => ({ ...x, vent: { ...(x.vent ?? { kind: "Exhaust" }), kind: e.target.value as NonNullable<AsmNode["vent"]>["kind"] } }))}>
            <option value="Exhaust">Exhaust fan ({fmtWattsPerFlow(0.35, p.imperial)})</option><option value="Intake">Supply fan ({fmtWattsPerFlow(0.35, p.imperial)})</option><option value="Balanced">Balanced, no recovery ({fmtWattsPerFlow(0.70, p.imperial)})</option><option value="HeatRecovery">Heat recovery — through the ideal-loads templates' own fields</option>
          </select>
          <span title="the bedrooms are ticked on ZONES — the one place a bedroom is said (2026-10-07)">bedrooms <b className="src-user">{nbrByName}</b> <span className="muted">{bedsList?.length ? `— ${bedsList.join(", ")} ` : ""}· ticked on ZONES{n.vent?.bedrooms !== undefined ? ` · the ${n.vent.bedrooms} typed here before is retired` : ""}</span></span>
          <label>CFA <NumInput className={srcClass(n.vent?.cfaM2 !== undefined ? "user" : "dataset")} value={p.imperial ? Number(((n.vent?.cfaM2 ?? cfaByCells) * FT2).toFixed(0)) : Number((n.vent?.cfaM2 ?? cfaByCells).toFixed(1))} onValue={(v) => set((x) => ({ ...x, vent: { ...(x.vent ?? { kind: "Exhaust" }), cfaM2: v === null ? undefined : p.imperial ? v / FT2 : v } }))} /> <span className="muted">{p.imperial ? "ft²" : "m²"} (the cells {p.imperial ? `${(cfaByCells * FT2).toFixed(0)} ft²` : `${cfaByCells.toFixed(1)} m²`})</span></label>
          <span className="muted">{(() => {
            // the standard's own form is in cfm and ft²; under metric the same rule in L/s and m², and the rate it gives from the numbers above
            const cfa = n.vent?.cfaM2 ?? cfaByCells, nbr = nbrByName, qCfm = 0.03 * cfa * FT2 + 7.5 * (nbr + 1);
            return `Qtot = ${p.imperial ? "0.03 cfm/ft² × CFA + 7.5 cfm × (bedrooms + 1)" : `${(0.03 * FT2 * L_S_PER_CFM).toFixed(3)} L/s·m² × CFA + ${(7.5 * L_S_PER_CFM).toFixed(2)} L/s × (bedrooms + 1)`} = ${fmtFlow(qCfm, p.imperial, 1)} — ANSI/RESNET/ICC 301-2022`;
          })()}; on {zones.length ? `the ${zones.length} zones assigned` : "every conditioned zone"}</span>
        </div>
      )}
      {n.kind === "exhaust" && (
        <div className="sysZones">
          <label>{flowUnit(p.imperial)} <NumInput className={srcClass(n.vent?.cfm !== undefined ? "user" : "dataset")} value={flowAtEye(n.vent?.cfm ?? (zones.some((z) => /bath|wc|powder/i.test(z)) ? 50 : 100), p.imperial)} onValue={(v) => set((x) => ({ ...x, vent: { ...(x.vent ?? { kind: "Exhaust" }), cfm: v === null ? undefined : flowFromEye(v, p.imperial) } }))} digits={p.imperial ? 0 : 1} min={0} /></label>
          <span className="muted">{fmtFlow(100, p.imperial)} kitchen / {fmtFlow(50, p.imperial)} bath at {fmtWattsPerFlow(0.3, p.imperial)} (2010 BAHSP) · on the SCHEDULES ventilation role — {p.ventilationScheduled ? "ruled" : "not ruled: listed, not emitted"}</span>
        </div>
      )}
      {spec && p.schema && (
        <ComponentForm spec={spec} schema={p.schema} fields={n.fields ?? {}} setField={setField} setFields={(fields) => set((x) => { const m = { ...x }; if (fields) m.fields = fields; else delete m.fields; return m; })} imperial={p.imperial} schedules={p.schedules} availabilityRole={p.availabilityRole} derived={{ zone: p.compiled.locations?.[n.id], units: units.length || undefined }} ioRef={p.ioRef}
          before={n.kind === "component" && isGhxClass(cls) ? <><GhxType n={n} p={p} /><LoopFluidInputs n={n} p={p} /></> : n.kind === "component" && /^(Pump:|HeaderedPumps:)/.test(cls) ? <PumpDtInputs n={n} p={p} /> : undefined}
          after={cls === "ZoneHVAC:UnitHeater" ? <UnitHeaterPeak n={n} p={p} /> : undefined} />
      )}
      {!spec && n.kind !== "exhaust" && n.kind !== "zone" && !isResource(n.kind) && cls !== "AirLoopHVAC:UnitaryHeatPump:WaterToAir" && p.schema && (
        <FieldTable cls={n.kind === "wholehouse" && n.vent?.kind === "HeatRecovery" ? "HVACTemplate:Zone:IdealLoadsAirSystem" : cls} schema={p.schema} values={n.fields} onValues={(fields) => set((x) => { const m = { ...x }; if (fields) m.fields = fields; else delete m.fields; return m; })}
          skip={new RegExp(`${skip.source}${attachedKeys.size ? `|^(${[...attachedKeys].join("|")})$` : ""}`)} title={n.attached?.length ? "the attached coils set their fields" : undefined} imperial={p.imperial} ioRef={p.ioRef} schedules={p.schedules} availabilityRole={p.availabilityRole} />
      )}
      {!p.schema && <div className="src-warn">Energy+.schema.epJSON is not read — no field can be offered</div>}
    </div>
  );
}
