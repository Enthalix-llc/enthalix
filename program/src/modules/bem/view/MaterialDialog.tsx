// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MATERIAL DIALOG (user, 2026-09-16: "add by hand creates a new row for
// editing and a dialog box given for material data"): the app's one modal —
// a scrim over the window and a panel with the hand form, moved here from the
// search panel of 2026-09-08 (retired: "Internet search" opens the in-app
// browser window now; nothing is fetched or parsed in the app). The numbers
// are typed in the user's units (the toggle converts what is typed), the
// source is a name or a page, the roughness one of the IDD's six words; Save
// makes the row (materials.db, through the sidecar) and the layer TAKES it;
// Esc or the scrim cancels. An edit opens it prefilled with the row.
import { useEffect, useRef, useState } from "react";
import type { MaterialKind } from "../core/materialsDb.js";
import { kindOfName } from "../core/materialsDb.js";
import { handFormInUnits, handFormToInput, ROUGHNESS, type HandInput, type HandForm } from "../core/materialSearch.js";
import { ROLE_LABELS, type LayerRole } from "../core/layerRoles.js";
import { NumInput } from "./bemUi.js";

export interface DialogState {
  /** the layer (its seq) the row is for */
  seq: number;
  /** the form, its numbers in the units the user has selected (`units`) */
  form: Partial<HandForm>;
  /** the row being EDITED: its key — the saved row is kept, the layer takes the new one */
  editFrom: string | null;
  /** the layer's role, said in the head */
  role: LayerRole | null;
  note: string;
}
export const newDialog = (seq: number, role: LayerRole | null, units: "IP" | "SI"): DialogState => ({ seq, form: { units, sourceName: "", sourceUrl: "" }, editFrom: null, role, note: "" });

export function MaterialDialog(p: {
  state: DialogState; onState: (s: DialogState) => void; imperial: boolean;
  layerLabel: string;
  /** resolves to the refusal (what the row still needs), or null when saved — the caller closes the dialog then */
  onSave: (h: HandInput) => Promise<string | null>;
  /** Delete (an edit of a row of YOURS only — 2026-09-17): the row leaves materials.db and the sidecar */
  onDelete?: (key: string) => void;
  canDelete?: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const s = p.state, hand = s.form;
  const units: "IP" | "SI" = p.imperial ? "IP" : "SI";
  const [why, setWhy] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<HandForm>): void => p.onState({ ...s, form: { ...hand, units: hand.units ?? units, ...patch } });
  // the kind (the family, the colour in the view) follows the name — the same reading the seeds get; the CATEGORY is the layer's role
  const kindOf = (h: Partial<HandForm>): MaterialKind => h.kind ?? kindOfName(h.name ?? "", h.cls ?? "Material");
  // THE CLASS FOLLOWS THE R (user, 2026-09-16: "Thermal Resistance R-Value (if given, the next three inputs are greyed)"): an R makes
  // a massless layer at that R (the thickness kept for the drawing); none makes a layer with mass from k, ρ, cp
  const massless = hand.r !== null && hand.r !== undefined;
  const formOf = (h: Partial<HandForm>): HandForm => ({ name: h.name ?? "", kind: kindOf(h), cls: massless ? "Material:NoMass" : "Material", units: h.units ?? units, thickness: h.thickness ?? null, k: h.k ?? null, rho: h.rho ?? null, cp: h.cp ?? null, r: h.r ?? null, roughness: h.roughness ?? null, thermalAbs: h.thermalAbs ?? null, reflectivity: h.reflectivity ?? null, solarAbs: h.solarAbs ?? null, visibleAbs: h.visibleAbs ?? null, sourceUrl: h.sourceUrl ?? "", sourceName: h.sourceName ?? "" });
  // the units toggle converts what was typed, so the form always reads in the selected units (user, 2026-09-08)
  useEffect(() => { if (hand.units && hand.units !== units) p.onState({ ...s, form: handFormInUnits(formOf(hand), units) }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);
  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);
  const U = p.imperial ? { th: "in", k: "Btu·in/h·ft²·°F", rho: "lb/ft³", cp: "Btu/lb·°F", r: "h·ft²·°F/Btu" } : { th: "m", k: "W/m·K", rho: "kg/m³", cp: "J/kg·K", r: "m²K/W" };
  const eg = p.imperial ? { th: "0.5", k: "1.11", rho: "50", cp: "0.26", r: "19" } : { th: "0.0127", k: "0.16", rho: "800", cp: "1090", r: "3.35" };
  // A REFLECTIVITY GIVEN sets the solar and the visible absorptance to 1 − it (the user's rule); the two read greyed then
  const reflGiven = hand.reflectivity !== null && hand.reflectivity !== undefined;
  const setRefl = (v: number | null): void => set(v === null ? { reflectivity: null } : { reflectivity: v, solarAbs: Number((1 - v).toFixed(4)), visibleAbs: Number((1 - v).toFixed(4)) });
  const submit = async (): Promise<void> => { setWhy(null); setWhy(await p.onSave({ ...handFormToInput(formOf(hand)), editFrom: s.editFrom })); };
  return (
    <div className="menuScrim dialogScrim" onPointerDown={p.onCancel}>
      <div className="dialog" role="dialog" aria-label="a material by hand" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">{s.editFrom ? `edit → a custom material for ${p.layerLabel}` : `a new material for ${p.layerLabel}`}</div>
        <div className="muted">the numbers as the source states them, in {p.imperial ? "imperial" : "metric"} units (e.g. ½ in gypsum board: {eg.th} {U.th} · k {eg.k} · ρ {eg.rho} · cp {eg.cp}) — Show {p.imperial ? "Metric" : "Imperial"} at the top switches them and converts what is typed{s.note ? ` · ${s.note}` : ""}</div>
        <div className="allRow">
          category <input className="cat" value={s.role ? ROLE_LABELS[s.role] : "—"} disabled title="the layer's category, assigned by the layer this material is for" />
          name <input ref={nameRef} className="q" value={hand.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="as the source names it — GAF Reflector Coastal Slate" />
        </div>
        <div className="allRow">
          roughness <select value={hand.roughness ?? ""} onChange={(e) => set({ roughness: e.target.value || null })} title="the IDD's six words; MediumRough when left blank (the engine's default for a row without one)"><option value="">MediumRough (default)</option>{ROUGHNESS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          thickness <NumInput style={{ width: 70 }} value={hand.thickness ?? null} placeholder={eg.th} onValue={(v) => set({ thickness: v })} /> {U.th}
        </div>
        <div className="allRow">
          R-value <NumInput style={{ width: 70 }} value={hand.r ?? null} placeholder={eg.r} onValue={(v) => set({ r: v })} /> <span title="an R given makes a massless layer at that R — the conductivity, density and specific heat are then not read">{U.r}</span> ·
          conductivity <NumInput style={{ width: 70 }} value={hand.k ?? null} placeholder={eg.k} disabled={massless} onValue={(v) => set({ k: v })} /> {U.k} ·
          density <NumInput style={{ width: 70 }} value={hand.rho ?? null} placeholder={eg.rho} disabled={massless} onValue={(v) => set({ rho: v })} /> {U.rho} ·
          specific heat <NumInput style={{ width: 70 }} value={hand.cp ?? null} placeholder={eg.cp} disabled={massless} onValue={(v) => set({ cp: v })} /> {U.cp}
        </div>
        <div className="allRow">
          <span title="TE on a product sheet — the thermal emittance, the engine's thermal absorptance (long-wave, 0–1)">thermal emittance (TE)</span> <NumInput style={{ width: 60 }} value={hand.thermalAbs ?? null} placeholder="0.9" onValue={(v) => set({ thermalAbs: v })} /> ·
          <span title="SR on a product sheet (CRRC, ENERGY STAR) — the solar reflectance; the solar and visible absorptance become 1 − it. The SRI is calculated from SR and TE (ASTM E1980) and is not an EnergyPlus input">solar reflectance (SR)</span> <NumInput style={{ width: 60 }} value={hand.reflectivity ?? null} placeholder="0.3" onValue={setRefl} /> <span className="muted" title="a reflectivity given sets the solar and the visible absorptance to 1 − it">→</span>
          solar absorptance <NumInput style={{ width: 60 }} value={hand.solarAbs ?? null} placeholder="0.7" disabled={reflGiven} onValue={(v) => set({ solarAbs: v })} /> ·
          visible absorptance <NumInput style={{ width: 60 }} value={hand.visibleAbs ?? null} placeholder="0.7" disabled={reflGiven} onValue={(v) => set({ visibleAbs: v })} />
          <span className="muted" title="left empty, the engine's own 0.9 / 0.7 / 0.7 are written">(0–1; empty = the engine's 0.9 · 0.7 · 0.7)</span>
        </div>
        <div className="allRow">
          source <input value={hand.sourceName ?? ""} onChange={(e) => set({ sourceName: e.target.value })} placeholder="the document or page the numbers came from" style={{ width: 220 }} title="required: the source by name — a URL beside it when there is one" />
          URL <input className="q" value={hand.sourceUrl ?? ""} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder={s.editFrom ? "https://… (optional: the row edited from is the source)" : "https://… (optional when the source is named)"} title="right-click for cut, copy and paste" />
        </div>
        <div className="allRow">
          <button className="apply" onClick={() => void submit()} title="the row goes into materials.db (through your sidecar) with every value above and this layer takes it; the IDF's Material carries the roughness and the three absorptances">{s.editFrom ? "Save the edit · the layer takes it" : "Save · the layer takes it"}</button>
          {s.editFrom && p.canDelete && p.onDelete && <button className="qaBtn bad" onClick={() => p.onDelete!(s.editFrom!)} title="remove this row of yours from materials.db — remembered by its key in the sidecar, never carried back; a layer that carries it reads no material until another is picked">Delete</button>}
          <button className="qaBtn" onClick={p.onCancel}>Cancel</button>
          {s.editFrom && <span className="muted">editing {s.editFrom} — Save keeps it and the layer takes the new row{p.canDelete ? "; Delete removes it" : " (a seed row cannot be deleted)"}</span>}
          {why && <span className="bad">not saved: it needs {why}</span>}
        </div>
      </div>
    </div>
  );
}
