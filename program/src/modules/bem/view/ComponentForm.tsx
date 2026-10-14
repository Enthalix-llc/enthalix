// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE FORM RENDERER (user, 2026-09-14 afternoon: "clean up the component UI …
// use roll ups to conserve vertical space"). A component's inputs from its spec
// (bem/core/componentForms.ts): groups by function, each a ROLL-UP when the spec
// says so — collapsed to its title with a count until opened — an input per row
// by the engine's own field kind (a schedule dropdown, an enum in words, a number
// in the user's units through the IDD's conversions with an autosize chip where
// the engine offers it, a slider for a convergence, a list of pairs), every value
// in its source colour: the user's amber when typed, the dataset colour for a
// stated default, the code default's blue for the engine's own. Nothing the
// program assigns is a row. The engine's whole table stays a toggle away.

import { useState } from "react";
import type { EpSchema, EpField } from "../core/epSchema.js";
import type { SystemFields, FieldValue } from "../core/bemDb.js";
import { type FormSpec, type FormGroup, type FormInput, type FormOption, type Derived, CARD_KEYS, numOf, optionsFor } from "../core/componentForms.js";
import { ScheduleSelect, FieldTable } from "./SystemOptions.js";
import { srcClass, NumInput } from "./bemUi.js";
import { unitAtEye } from "../core/units.js";
import type { ScheduleProfile, ScheduleRef } from "../core/schedules.js";
import type { IoReference } from "../core/ioReference.js";

/** a group of related inputs (user, 2026-09-14: "related function input should be grouped together"); a group with a switch greys its
 *  inputs when the switch is off; a ROLL-UP folds to its title until opened */
export function Group(p: { title: string; on?: boolean; onSwitch?: (on: boolean) => void; children: React.ReactNode; note?: string; rollup?: boolean; count?: { inputs: number; set: number } }): React.ReactElement {
  const off = p.on === false;
  const [open, setOpen] = useState(!p.rollup);
  return (
    <div className={`inGroup${off ? " off" : ""}${p.rollup ? " rollup" : ""}${open ? "" : " folded"}`}>
      <div className="inTitle">
        {p.rollup && <button className="fold" onClick={() => setOpen((o) => !o)} title={open ? "fold" : "unfold"}>{open ? "▾" : "▸"}</button>}
        {p.onSwitch ? <label><input type="checkbox" checked={!off} onChange={(e) => p.onSwitch!(e.target.checked)} /> {p.title}</label> : p.rollup ? <button className="foldTitle" onClick={() => setOpen((o) => !o)}>{p.title}</button> : p.title}
        {!open && p.count ? <span className="muted"> · {p.count.inputs} input{p.count.inputs === 1 ? "" : "s"}{p.count.set ? ` · ${p.count.set} set` : ""}</span> : null}
        {p.note ? <span className="muted"> · {p.note}</span> : null}
      </div>
      {open && <fieldset disabled={off}>{p.children}</fieldset>}
    </div>
  );
}
export function Row(p: { k: string; title?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="inRow" title={p.title}><span className="k">{p.k}</span>{p.children}</div>;
}
/** THE CONVERGENCE SLIDER (user, 2026-09-14): a tolerance on a 0.001…1 scale — for a card written as several identical units its initial value
 *  is the reciprocal of their number (the user's way of modelling one multizone unit's response); a single unit keeps the engine's default */
export function Slider(p: { value: number; ruled: boolean; onValue: (v: number | null) => void; dflt: number; title: string }): React.ReactElement {
  return (
    <span className="inSlider">
      <input type="range" min={0.001} max={1} step={0.001} value={p.value} onChange={(e) => p.onValue(Number(e.target.value))} title={p.title} />
      <b className={srcClass(p.ruled ? "user" : "dataset")}>{p.value}</b>
      {p.ruled && <button className="chip" onClick={() => p.onValue(null)} title={`back to ${p.dflt}`}>reset</button>}
    </span>
  );
}

export interface FormProps {
  spec: FormSpec; schema: EpSchema; fields: SystemFields;
  setField: (key: string, v: FieldValue | undefined) => void;
  setFields: (fields: SystemFields | undefined) => void;
  imperial: boolean; schedules?: ScheduleProfile[]; availabilityRole?: ScheduleRef | null;
  derived: Derived; ioRef?: IoReference | null;
  /** rendered under the head, before the groups (the exchanger's type select) */
  before?: React.ReactNode;
  /** rendered after the groups (a unit heater's run peak, 2026-10-08) */
  after?: React.ReactNode;
}

const NONE = { label: "", converted: false, toEye: (x: number) => x, fromEye: (x: number) => x };

function InputView({ i, p }: { i: FormInput; p: FormProps }): React.ReactElement | null {
  const f = p.fields, d = p.derived;
  const cls = i.cls ?? p.spec.cls;
  const field: EpField | null = CARD_KEYS.includes(i.key) ? null : p.schema.fieldsOf(cls).find((x) => x.key === i.key) ?? null;
  const v = f[i.key];
  const ruled = v !== undefined && v !== "";
  const dflt = typeof i.dflt === "function" ? i.dflt(f, d) : i.dflt;
  const label = i.label ?? field?.label ?? i.key;
  const note = typeof i.note === "function" ? i.note(f, d) : i.note;
  const base = i.title ?? field?.note ?? i.key;
  const title = `${base}${dflt !== undefined && !ruled ? ` · default ${dflt}${i.citation ? ` — ${i.citation}` : ""}` : ""}`;
  const eye = field ? unitAtEye(p.schema.conversions, field, p.imperial) : NONE;
  // an integer field is numeric too (the IDD's N type): the boreholes in x and y were stored as text before this read the type (2026-09-14)
  const kind = i.as ?? (i.options || field?.enum ? "enum" : field?.kind === "number" || field?.type === "n" ? "number" : "text");
  const src = ruled ? "user" : dflt !== undefined ? "dataset" : "code-default";
  const set = (x: FieldValue | undefined): void => p.setField(i.key, x);
  const units = field?.units ? <span className="muted">{eye.label}</span> : null;
  if (kind === "note") return <Row k={label} title={title}><span className="muted">{note}</span></Row>;
  if (kind === "location") return <Row k={label} title={title}><span className={srcClass(d.zone ? "user" : "code-default")}>{d.zone ? `in ${d.zone} — its skin losses go there` : "outdoors — join its Loc to a Zone to put its losses in it"}</span></Row>;
  if (kind === "schedule") return (
    <Row k={label} title={title}>
      <ScheduleSelect value={v} onValue={(x) => set(x)} schedules={p.schedules ?? []} availabilityRole={p.availabilityRole} blank={i.schedule?.blank ?? "blank — the engine's default"} always={i.schedule?.always} role={i.schedule?.role} title={title} />
      {note ? <span className="muted inSub">{note}</span> : null}
    </Row>
  );
  if (kind === "enum") {
    const opts: FormOption[] = i.options ? optionsFor(i, field) : (field?.enum ?? []).map((o) => ({ v: o, label: o }));
    const cur = ruled ? String(v) : typeof dflt === "string" ? dflt : "";
    return (
      <Row k={label} title={title}>
        <select className={srcClass(src)} value={cur} onChange={(e) => set(e.target.value || undefined)} title={opts.find((o) => o.v === cur)?.title ?? title}>
          {(typeof dflt !== "string" || !opts.some((o) => o.v === dflt)) && <option value="">{typeof dflt === "string" ? dflt : `default: ${field?.default ?? "blank"}`}</option>}
          {opts.map((o) => <option key={o.v} value={o.v} title={o.disabled ? `${o.title ?? ""}${o.title ? " — " : ""}${o.disabled}` : o.title} disabled={!!o.disabled}>{o.label}{o.disabled ? " — refused" : ""}</option>)}
        </select>
        {note ? <span className={/refused|needs|not written/.test(note) ? "src-warn inSub" : "muted inSub"}>{note}</span> : null}
      </Row>
    );
  }
  if (kind === "slider") {
    const dv = typeof dflt === "number" ? dflt : 0.001;
    return <Row k={label} title={title}><Slider value={typeof v === "number" ? v : dv} ruled={typeof v === "number"} onValue={(x) => set(x ?? undefined)} dflt={dv} title="drag: 0.001 … 1" />{note ? <span className="muted inSub">{note}</span> : null}</Row>;
  }
  if (kind === "xy-list" || kind === "pairs") return (
    <Row k={label} title={title}>
      <textarea className={srcClass(ruled ? "user" : "code-default")} rows={3} value={ruled ? String(v) : ""} placeholder={kind === "xy-list" ? "0, 0\n6, 0\n12, 0" : "-8.5, 1.2\n-7.8, 1.5\n…"} onChange={(e) => set(e.target.value || undefined)} title={title} spellCheck={false} />
      {note ? <span className="muted inSub">{note}</span> : null}
    </Row>
  );
  if (kind === "constant-schedule" || kind === "number") {
    const isAuto = typeof v === "string" && /^autosize$/i.test(v);
    const autoByDefault = v === undefined && dflt === "autosize";
    const lit = isAuto || autoByDefault;
    const conv = (x: number | null): number | undefined => (x === null ? undefined : eye.fromEye(x));
    const ph = isAuto || autoByDefault ? "autosize" : typeof dflt === "number" ? String(eye.toEye(dflt)) : typeof dflt === "string" ? dflt : field?.default !== null && field?.default !== undefined ? (typeof field.default === "number" ? String(eye.toEye(field.default)) : String(field.default)) : field?.autosizable ? "autosize" : field?.required ? "required" : "";
    return (
      <Row k={label} title={title}>
        <NumInput className={srcClass(src)} value={numOf(v) !== null ? eye.toEye(numOf(v)!) : null} onValue={(x) => set(conv(x))} disabled={isAuto} placeholder={ph} min={i.min ?? (field?.min !== null && field?.min !== undefined ? (eye.converted ? eye.toEye(field.min) : field.min) : undefined)} max={i.max ?? (field?.max !== null && field?.max !== undefined ? (eye.converted ? eye.toEye(field.max) : field.max) : undefined)} digits={i.digits} title={title} />
        {units}
        {field?.autosizable && <button className={`chip${lit ? " on" : ""}`} onClick={() => set(lit ? undefined : "autosize")} title="the engine sizes it at the design days">autosize</button>}
        {kind === "constant-schedule" && <span className="muted">· written as a constant schedule</span>}
        {note ? <span className="muted inSub">{note}</span> : null}
      </Row>
    );
  }
  return (
    <Row k={label} title={title}>
      <input type="text" className={srcClass(src)} value={ruled ? String(v) : ""} placeholder={typeof dflt === "string" || typeof dflt === "number" ? String(dflt) : field?.default !== null && field?.default !== undefined ? String(field.default) : ""} onChange={(e) => set(e.target.value || undefined)} title={title} />
      {note ? <span className="muted inSub">{note}</span> : null}
    </Row>
  );
}

function GroupView({ g, p }: { g: FormGroup; p: FormProps }): React.ReactElement | null {
  const f = p.fields, d = p.derived;
  if (g.when && !g.when(f, d)) return null;
  const shown = g.inputs.filter((i) => !i.when || i.when(f, d));
  const note = typeof g.note === "function" ? g.note(f, d) : g.note;
  const on = g.toggle ? f[g.toggle.key] !== g.toggle.off : undefined;
  const count = { inputs: shown.filter((i) => i.as !== "note").length, set: shown.filter((i) => f[i.key] !== undefined && f[i.key] !== "").length };
  return (
    <Group title={g.title} rollup={g.rollup} count={count} note={g.toggle && on === false ? g.toggle.offNote : note} on={on} onSwitch={g.toggle ? (x) => p.setField(g.toggle!.key, x ? undefined : g.toggle!.off) : undefined}>
      {shown.map((i, k) => <InputView key={`${k}:${i.key}`} i={i} p={p} />)}
      {(g.sub ?? []).map((s) => <GroupView key={s.title} g={s} p={p} />)}
    </Group>
  );
}

/** the component's inputs from its spec, the engine's whole table a toggle away */
export function ComponentForm(p: FormProps): React.ReactElement {
  const [table, setTable] = useState(false);
  return (
    <div className="inForm">
      <div className="idfInfo inHead" title="grouped by function; the names, nodes and branches are assigned by the program — a connection that is missing is an error on the card"><b>Inputs</b> <span className="muted">· {p.spec.head}</span></div>
      {p.before}
      {p.spec.groups.map((g) => <GroupView key={g.title} g={g} p={p} />)}
      {p.after}
      <button className={`chip${table ? " on" : ""}`} onClick={() => setTable((t) => !t)} title="every field of the class from the engine's schema, for the record — the same values, in IDD order">{table ? "hide the engine's table" : "the engine's table (every field)"}</button>
      {table && <FieldTable cls={p.spec.cls} schema={p.schema} values={p.fields} onValues={p.setFields} imperial={p.imperial} ioRef={p.ioRef} schedules={p.schedules} availabilityRole={p.availabilityRole} heading="the engine's table" showAll />}
    </div>
  );
}
