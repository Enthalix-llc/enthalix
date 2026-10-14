// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE OPTIONS UNDER THE VIEW for a focused subsection (user, 2026-09-10):
// the kind the model runs on (the code default first), the file's equipment
// for it with what the file states (a rating read out of a type name shown
// as a default in the inherited colour), the engine's own fields for the
// kind from Energy+.schema.epJSON in IDD order, and the citation line. The
// MECHANICAL subsections are ruled on the ASSEMBLY canvas and its bench
// (AssemblyBench.tsx) — this table serves the other five, read-only until
// their slices. `FieldTable` is the one field editor every bench shares.

import { useState } from "react";
import type { EpSchema, EpField } from "../core/epSchema.js";
import type { BemModelOutcome } from "../pipeline.js";
import type { SystemsRuling, SystemFields, FieldValue } from "../core/bemDb.js";
import { SECTION_LABELS, CODE_DEFAULT_SYSTEM, subDef, MAIN_OF, type SystemSection } from "../core/mepFocus.js";
import { stageDiff, KEY_FIELD } from "../core/bemSystems.js";
import { srcClass, NumInput } from "./bemUi.js";
import { unitAtEye } from "../core/units.js";
import { ioRefFor, type IoReference } from "../core/ioReference.js";
import { scheduleMark, scheduleRefOfMark, markerWord } from "../core/scheduleMark.js";
import { scheduleFileName, type ScheduleProfile, type ScheduleRef } from "../core/schedules.js";

/** THE SCHEDULE DROPDOWN (user, 2026-09-14): a `*_schedule_name` field offers the writer's own (blank = the engine's default for that field,
 *  always on), the SCHEDULES › HVAC availability role, and the library's schedules that fit an on/off or fraction field (0…1) by file — the
 *  pick rides in the card's fields as a marker the writer resolves; the schedule is emitted once. Nothing is authored. */
export function ScheduleSelect(p: { value: FieldValue | undefined; onValue: (v: string | undefined) => void; schedules: ScheduleProfile[]; availabilityRole?: ScheduleRef | null; blank: string; always?: string; role?: boolean; className?: string; title?: string }): React.ReactElement {
  const v = typeof p.value === "string" ? p.value : "";
  const byFile = new Map<string, ScheduleProfile[]>();
  for (const s of p.schedules) { const f = scheduleFileName(s.file); (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(s); }
  const ref = scheduleRefOfMark(v);
  const known = !v || v === "@always" || v === "@hvac-availability" || (ref && p.schedules.some((s) => s.name.toLowerCase() === ref.name.toLowerCase()));
  return (
    <select className={p.className ?? srcClass(v ? "user" : "code-default")} value={v} onChange={(e) => p.onValue(e.target.value || undefined)} title={p.title}>
      <option value="">{p.blank}</option>
      {p.always && <option value="@always">{p.always}</option>}
      {p.role !== false && <option value="@hvac-availability">SCHEDULES › HVAC availability{p.availabilityRole ? ` — ${p.availabilityRole.name}` : " (not ruled yet: always available)"}</option>}
      {[...byFile].map(([f, ss]) => <optgroup key={f} label={f}>{ss.map((s) => <option key={`${f}|${s.name}`} value={scheduleMark({ file: f, name: s.name })}>{s.name}{s.constant !== null ? ` (constant ${s.constant})` : ""}</option>)}</optgroup>)}
      {!known && <option value={v}>{markerWord(v) ?? v} (not in the library)</option>}
    </select>
  );
}

/** the fields the PROGRAM assigns (user, 2026-09-14: "do not require input labels as they are assigned by the program"): the object's
 *  name, every node, and every reference to another object — a coil's, a curve's, a branch's, a list's — except a schedule, which is
 *  the user's pick */
export const isSchedField = (f: EpField): boolean => /schedule_name$/.test(f.key) || (f.objectList?.includes("ScheduleNames") ?? false);
export const isAssignedField = (f: EpField): boolean => f.key === "name" || /_node_name$|_node_or_nodelist_name$|^zone_name$|zone_or_zonelist_name$/.test(f.key) || (f.kind === "object" && !isSchedField(f));

/** THE REFERENCE BUTTON (user, 2026-09-13 night): the Input Output Reference's own page and anchor for a class, opened in the browser;
 *  the index not read (offline) or a class it does not list is said in words, never a guessed link */
export function RefButton(p: { cls: string; ioRef: IoReference | null | undefined; small?: boolean }): React.ReactElement | null {
  if (!p.cls) return null;
  const r = ioRefFor(p.ioRef ?? null, p.cls);
  if (!r) return <span className={`muted refBtn${p.small ? " small" : ""}`} title={p.ioRef ? `${p.cls}: no page in the Input Output Reference's index (docs ${p.ioRef.version})` : "the Input Output Reference's index is not read yet — offline, or the engine not found"}>{p.ioRef ? "no reference page" : "reference…"}</span>;
  return <button className={`chip refBtn${p.small ? " small" : ""}`} title={`Input Output Reference (${p.ioRef!.version}) · ${r.text} — ${r.url}`} onClick={(e) => { e.stopPropagation(); void window.bem.openExternal(r.url); }}>Reference</button>;
}

const CITATION: Record<SystemSection, string> = {
  heating: "ideal loads at the code's thermostat (72 / 75 °F, the IECC R405 standard reference design); the residential kinds are the engine's own HVACTemplate objects — a furnace + DX, an air-source heat pump, a packaged terminal heat pump, electric baseboard, a water-to-air heat pump on a mixed-water loop — capacity autosized, efficiency stated; a zone a ruling takes keeps its thermostat",
  cooling: "as heating: one hvac list, a heat pump is both; a zone is in at most one system; every other conditioned zone keeps ideal loads",
  ventilation: "whole-house rate 0.03 cfm/ft² + 7.5 cfm × (bedrooms + 1) — ANSI/RESNET/ICC 301-2022 (ASHRAE 62.2), fans 0.35 W/cfm (0.70 balanced); heat recovery through the templates' own outdoor-air fields; local exhaust 100 cfm kitchen / 50 cfm bath at 0.3 W/cfm — 2010 Building America House Simulation Protocols, on the SCHEDULES ventilation role",
  power: "the single-family example's appliance set (SingleFamilyHouse_HP_Slab.idf) as dataset defaults; plug loads 0.91 kWh/yr per ft² — ANSI/RESNET/ICC 301-2022; the outlets' VA in the file are NEC allowances, listed, never a load",
  lighting: "the fixtures' TotalWattage where the file states it; else 1.05 + 0.48 W/m² (the example) or 455 + 0.8 × CFA kWh/yr — ANSI/RESNET/ICC 301-2022; exterior lights on the astronomical clock",
  generation: "Generator:PVWatts on the roof face the panels sit over; inverter 0.96 and DC-to-AC 1.10, system losses 0.14 — PVWatts (NREL/TP-6A20-62641, Table 6); battery round-trip 0.925 — OpenStudio-HPXML; a standby generator needs performance curves the file does not state",
  dhw: "a stand-alone WaterHeater:Mixed (the IDD's own use-side notes), tank and capacity from the file's name or 2014 BAHSP Table 8, setpoint 125 °F, the Building America draw schedules; the heat-pump water heater the file names as the 4-object option",
  water: "WaterUse:Equipment per fixture group on the Building America schedules; mains temperature from the weather file (Site:WaterMainsTemperature CorrelationFromWeatherFile); drain-water heat recovery and rainwater as options",
};
const NEXT_SLICE: Partial<Record<SystemSection, string>> = { dhw: "slice 4", water: "slice 4", power: "slice 5", lighting: "slice 5" };

/** the engine's fields for a class, each editable: an enum as a select (blank = the engine's default), a number typed or
 *  `autosize` where the engine offers it, text otherwise — the value in its source colour, the default and the note beside */
export function FieldTable(p: { cls: string; schema: EpSchema; values: SystemFields | undefined; onValues: (v: SystemFields | undefined) => void; given?: Record<string, { value: FieldValue; source: string; note?: string }>; skip?: RegExp; title?: string; imperial: boolean; ioRef?: IoReference | null; schedules?: ScheduleProfile[]; availabilityRole?: ScheduleRef | null; heading?: string; showAll?: boolean; electric?: boolean }): React.ReactElement {
  const [all, setAll] = useState(!!p.showAll);
  const c = p.schema.classOf(p.cls);
  if (!c) return <div className="src-warn">{p.cls} is not in the schema</div>;
  // the fields the program assigns (names, nodes, references) are never listed: a connection that is missing is an error on the card
  const assigned = c.fields.filter((f) => isAssignedField(f) && !(p.skip && p.skip.test(f.key))).length;
  const fields = c.fields.filter((f) => !isAssignedField(f) && !(p.skip && p.skip.test(f.key)));
  const shown = all ? fields : fields.filter((f) => KEY_FIELD.test(f.key) || f.required || (p.values && f.key in p.values));
  const set = (k: string, v: FieldValue | null): void => {
    const n: SystemFields = { ...(p.values ?? {}) };
    if (v === null || v === "") delete n[k]; else n[k] = v;
    p.onValues(Object.keys(n).length ? n : undefined);
  };
  // UNITS AT THE EYE (user, 2026-09-13 night): a number field reads and takes the user's units — the IDD's own IP conversion for the field's
  // SI unit (its \ip-units code choosing among them), stored as the engine's SI; a unit the IDD does not translate stays as it is
  // an ELECTRIC watt stays a watt (2026-10-02: a PV array's DC capacity read in Btu/h) — the IDD's W ⇄ Btu/h is for heat
  const eye = (f: EpField) => unitAtEye(p.schema.conversions, f, p.imperial && !(p.electric && f.units === "W"));
  const atEye = (f: EpField, v: FieldValue | null | undefined): string => (typeof v === "number" ? String(eye(f).toEye(v)) : v === null || v === undefined ? "" : String(v));
  const fmtDefault = (f: EpField): string => (f.default === null ? (f.required ? "required" : "blank") : atEye(f, f.default));
  const anyIp = p.imperial && fields.some((f) => f.kind === "number" && eye(f).converted);
  return (
    <div>
      <div className="idfInfo inHead" title={`${p.cls} — ${c.fields.length} fields in the engine's schema${c.minFields ? `, ${c.minFields} minimum` : ""}; ${assigned} assigned by the program (the name, the nodes, the references); ${anyIp ? "numbers in your units through the IDD's own conversions, stored as the engine's SI" : p.imperial ? "no field here has an IP unit" : "SI, the engine's own units"}`}><b>{p.heading ?? "Inputs"}</b>{p.title ? <span className="muted"> — {p.title}</span> : null} <span className="muted">· {shown.length} of {fields.length}</span> {p.ioRef !== undefined && <RefButton cls={p.cls} ioRef={p.ioRef} small />} <button className="chip" onClick={() => setAll((a) => !a)}>{all ? "the key fields" : `all ${fields.length}`}</button></div>
      <table className="spaceTable typeTable sysFields sysFieldsEdit">
        <thead><tr><th>field</th><th>value</th><th>units</th><th>the engine's default</th><th>note</th></tr></thead>
        <tbody>
          {shown.map((f) => {
            const ruled = p.values && f.key in p.values ? p.values[f.key]! : null;
            const g = p.given?.[f.key];
            const src = ruled !== null ? "user" : g ? g.source : "code-default";
            const isAuto = typeof ruled === "string" && /^autosize$/i.test(ruled);
            return (
              <tr key={f.key} className={KEY_FIELD.test(f.key) ? "key" : ""}>
                <td title={f.key}>{f.label}{f.required ? <span className="src-warn" title="required"> *</span> : null}</td>
                <td>
                  {isSchedField(f) ? (
                    <ScheduleSelect value={ruled ?? undefined} onValue={(v) => set(f.key, v ?? null)} schedules={p.schedules ?? []} availabilityRole={p.availabilityRole} blank={g ? `${g.value} (${g.source})` : f.note && /blank/i.test(f.note) ? `blank — ${f.note.replace(/^.*?(if|when)\s+(this\s+)?(field\s+)?(is\s+)?(left\s+)?blank[,:]?\s*/i, "").slice(0, 60)}` : "blank — the engine's default"} always="always on" role={/availab|operating_mode|fan/.test(f.key)} title={f.note ?? f.key} />
                  ) : f.kind === "enum" ? (
                    <select className={srcClass(src)} value={ruled !== null ? String(ruled) : ""} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">{g ? `${g.value} (${g.source})` : `default: ${fmtDefault(f)}`}</option>
                      {f.enum!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.kind === "number" ? (
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <NumInput className={srcClass(src)} value={typeof ruled === "number" ? eye(f).toEye(ruled) : null} onValue={(v) => set(f.key, v === null ? null : eye(f).fromEye(v))} disabled={isAuto} placeholder={g ? atEye(f, g.value) : fmtDefault(f)} min={f.min !== null ? (eye(f).converted ? eye(f).toEye(f.min) : f.min) : undefined} max={f.max !== null ? (eye(f).converted ? eye(f).toEye(f.max) : f.max) : undefined} title={f.note ?? f.key} />
                      {f.autosizable && <button className={`chip${isAuto ? " on" : ""}`} onClick={() => set(f.key, isAuto ? null : "autosize")} title="the engine sizes it at the design days">autosize</button>}
                    </span>
                  ) : (
                    <input type="text" className={srcClass(src)} value={ruled !== null ? String(ruled) : ""} placeholder={g ? String(g.value) : fmtDefault(f)} onChange={(e) => set(f.key, e.target.value)} title={f.note ?? f.key} />
                  )}
                </td>
                <td className="muted" title={eye(f).converted ? `the engine's ${f.units}, converted by the IDD's own table` : f.units ?? ""}>{eye(f).label}</td>
                <td className={srcClass(g ? g.source : "code-default")} title={g?.note ?? ""}>{g ? `${atEye(f, g.value)}${g.note ? ` — ${g.note.slice(0, 60)}${g.note.length > 60 ? "…" : ""}` : ""}` : fmtDefault(f)}{f.autosizable && !g ? " · autosizable" : ""}</td>
                <td className="muted" title={f.note ?? ""}>{f.note ? (f.note.length > 80 ? `${f.note.slice(0, 78)}…` : f.note) : f.enum ? f.enum.join(" · ") : ""}</td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan={5} className="muted">no key fields — show all</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function SystemOptions(p: { section: SystemSection; schema: EpSchema | null; imperial: boolean; stage: SystemsRuling; applied: SystemsRuling | undefined; model: BemModelOutcome | null; ioRef?: IoReference | null }): React.ReactElement {
  const def = subDef(p.section);
  const diff = stageDiff(p.stage, p.applied);
  const appliedRows = p.model?.systems.filter((r) => r.section === p.section) ?? [];
  const governs = appliedRows.filter((r) => r.source !== "code-default");
  // the PV the model wrote, as the fields' given values (each array's own capacity is its panel's; the rest are shared)
  const pv = p.section === "generation" ? p.model?.built.model.pv ?? null : null;
  const pvGiven: Record<string, { value: FieldValue; source: string; note?: string }> | undefined = pv ? {
    dc_system_capacity: { value: pv.panels[0]?.watts ?? 0, source: "file", note: `each array is one panel; ${pv.panels.length} arrays, ${(pv.dcW / 1000).toFixed(2)} kW DC in all` },
    module_type: { value: pv.moduleType.value, source: pv.moduleType.source },
    array_type: { value: pv.arrayType.value, source: pv.arrayType.source },
    system_losses: { value: pv.systemLosses.value, source: pv.systemLosses.source },
    array_geometry_type: { value: "Surface", source: "file", note: "the panel's own top face" },
  } : undefined;
  return (
    <div className="sysOptions">
      <div className="sysOptHead">
        <span className="muted">{MAIN_OF[p.section].toUpperCase()} › </span><b>{SECTION_LABELS[p.section]}</b> <span className="sysKind">{def.kind}</span> <RefButton cls={def.defaultKind} ioRef={p.ioRef} small />
        <span className="muted"> · governs: </span>
        {governs.length ? governs.map((r) => <span key={r.id} className={srcClass(r.source)} title={r.note}>{r.id} · {r.label.split(" (")[0]}{p.section === "generation" ? "" : ` · ${r.zones.length} zone${r.zones.length === 1 ? "" : "s"}`}{r.refused.length ? ` · refused: ${r.refused.length}` : ""}; </span>) : <span className={srcClass("code-default")}>{CODE_DEFAULT_SYSTEM[p.section]}</span>}
        {diff.words[p.section] && <span className="sysStaged"> · staged: {diff.words[p.section]} — Apply in the column</span>}
        <span className="muted"> · the object that takes it: {def.consumer}</span>
      </div>
      {/* GENERATION is ruled in the column (2026-10-02): the fields show what the model wrote for each array, never "until its slice" */}
      <div className="idfInfo"><b>{def.defaultKind}</b> — the engine's fields, from its schema{p.schema ? ` (${p.schema.classOf(def.defaultKind)?.fields.length ?? 0} fields)` : " — the schema is not read"}. {p.section === "generation" ? (pv ? `What the model writes for each of the ${pv.panels.length} arrays — ruled in the column (ELECTRICAL › Generation).` : "Ruled in the column (ELECTRICAL › Generation); nothing is written until PV is applied there.") : `The ruling for this subsection comes in ${NEXT_SLICE[p.section] ?? "a later slice"}; the code default governs.`}</div>
      {p.schema && <FieldTable cls={def.defaultKind} schema={p.schema} values={undefined} onValues={() => undefined} given={pvGiven} title={p.section === "generation" ? (pv ? "as written — edit in the column" : "edit in the column") : "read-only until its slice"} imperial={p.imperial} ioRef={p.ioRef} electric={p.section === "generation"} />}
      {!p.schema && <div className="src-warn">Energy+.schema.epJSON is not read — no field can be offered; is the engine installed?</div>}
      <div className="idfInfo">defaults and citations: {CITATION[p.section]}</div>
    </div>
  );
}
