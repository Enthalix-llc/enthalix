// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE FENESTRATION DIALOG (user, 2026-09-17: "we still need the Internet and
// New and Apply top row in frame for windows"): New on a window, glazed door
// or skylight opens this — the material dialog's twin for a whole-product
// assembly. A window carries different data from a layer material: no
// thickness, no conductivity — the label's U with the frame inside it, the
// SHGC, and the VT where the certificate publishes one. Save writes the row
// into the sidecar (materials.db's fenestration table, as a row of YOURS) and
// the type TAKES it; Esc or the scrim cancels.
import { useEffect, useRef, useState } from "react";
import { NumInput } from "./bemUi.js";

const U_IP = 5.678263;   // W/m²K per Btu/h·ft²·°F

export interface FenDialogState {
  /** the type the row is for — its key and the name shown in the head */
  key: string; label: string;
  section: "window" | "door" | "skylight" | "any";
  name: string; group: string; u: number | null; shgc: number | null; vt: number | null;
  sourceName: string; sourceUrl: string;
  /** the row of yours being EDITED: its key. An edit REPLACES it (the numbers make the key); Delete removes it */
  editFrom: string | null;
  /** the window type's own unit area, READ from the file (OverallWidth × OverallHeight) — shown, never typed (2026-10-01) */
  unitAreaM2?: number | null; unitCount?: number;
  /** the Window schedule's Custom… (2026-10-01): the name reads as the type's Reference */
  custom?: boolean;
}
export const newFenDialog = (key: string, label: string, section: FenDialogState["section"]): FenDialogState =>
  ({ key, label, section, name: "", group: "", u: null, shgc: null, vt: null, sourceName: "", sourceUrl: "", editFrom: null });
/** THE EDIT (2026-09-17, the user: "rather than Remove, we should have Edit for user added materials, and on the
 *  edit dialog (same as new dialog) have Save and Delete buttons"): the saved row's own numbers in the form, in the
 *  user's units; its source read back out of the row's reference text. */
export const editFenDialog = (key: string, label: string, row: {
  key: string; name: string; section: FenDialogState["section"]; nameGroup?: string | null;
  uWm2k: number; shgc: number; vt: number | null; sourceRef: string;
}, imperial: boolean): FenDialogState => {
  const ref = row.sourceRef.replace(/\s*—\s*typed by hand\s*$/, "");
  const url = /(https?:\/\/\S+)/.exec(ref)?.[1] ?? "";
  return {
    key, label, section: row.section, name: row.name, group: row.nameGroup ?? "",
    u: imperial ? Number((row.uWm2k / U_IP).toFixed(4)) : row.uWm2k, shgc: row.shgc, vt: row.vt,
    sourceName: ref.replace(url, "").replace(/\s*·\s*$/, "").trim(), sourceUrl: url, editFrom: row.key,
  };
};

export function FenestrationDialog(p: {
  state: FenDialogState; onState: (s: FenDialogState) => void; imperial: boolean;
  /** resolves to the refusal (what the row still needs), or null when saved — the caller closes the dialog then */
  onSave: (s: FenDialogState, uWm2k: number | null) => Promise<string | null>;
  /** Delete (an edit only): the row leaves materials.db and your sidecar, remembered by its key */
  onDelete?: (key: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const s = p.state;
  const [why, setWhy] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<FenDialogState>): void => p.onState({ ...s, ...patch });
  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);
  const uUnit = p.imperial ? "Btu/h·ft²·°F" : "W/m²K";
  const submit = async (): Promise<void> => { setWhy(null); setWhy(await p.onSave(s, s.u === null ? null : p.imperial ? s.u * U_IP : s.u)); };
  return (
    <div className="menuScrim dialogScrim" onPointerDown={p.onCancel}>
      <div className="dialog" role="dialog" aria-label="a fenestration assembly by hand" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">{s.editFrom ? `edit → a fenestration assembly of yours, for ${s.label}` : s.custom ? `custom reference for ${s.label}` : `a new fenestration assembly for ${s.label}`}</div>
        <div className="muted">the label's WHOLE-PRODUCT numbers as the certificate or the data sheet states them — the frame is inside the U, so there is no thickness and no conductivity here (e.g. an NFRC label: U {p.imperial ? "0.28" : "1.59"} {uUnit} · SHGC 0.25 · VT 0.51). Show {p.imperial ? "Metric" : "Imperial"} at the top switches the unit.</div>
        <div className="allRow">
          for <input className="cat" value={s.section === "door" ? "glazed door" : s.section} disabled title="the type this row is for — a window, a glazed door or a skylight" />
          {s.custom ? "reference" : "name"} <input ref={nameRef} className="q" value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="as the maker names it — Marvin Elevate Casement, 1 1/8″ Tripane Low E3" style={{ width: 340 }} />
        </div>
        {s.unitAreaM2 != null && (
          <div className="allRow muted" title="read from the file: the window type's OverallWidth × OverallHeight — the model's window area stays the file's geometry; shown for reference, not typed">
            unit area <input disabled value={p.imperial ? `${(s.unitAreaM2 / 0.09290304).toFixed(2)} ft²` : `${s.unitAreaM2.toFixed(3)} m²`} style={{ width: 90 }} /> each{s.unitCount ? ` · ${s.unitCount} in the file` : ""} — read from the file
          </div>
        )}
        <div className="allRow">
          group <input value={s.group} onChange={(e) => set({ group: e.target.value })} placeholder="Casement, Awning, Sliding Door… (the Name filter lists it)" style={{ width: 240 }} title="the name filter's entry for this row — its product type; the name's own head when left blank" />
        </div>
        <div className="allRow">
          U <NumInput style={{ width: 80 }} digits={3} min={0.001} value={s.u} placeholder={p.imperial ? "0.28" : "1.59"} onValue={(v) => set({ u: v })} /> <span title="the whole product's U, the frame inside it — not the centre of glass">{uUnit}</span> ·
          SHGC <NumInput style={{ width: 60 }} digits={2} min={0.01} max={0.99} value={s.shgc} placeholder="0.25" onValue={(v) => set({ shgc: v })} /> ·
          VT <NumInput style={{ width: 60 }} digits={2} min={0.01} max={0.99} value={s.vt} placeholder="0.51" onValue={(v) => set({ vt: v })} />
          <span className="muted" title="a VT left empty goes out blank and the engine estimates it — Marvin's ratings publish none">(VT optional — blank: the engine estimates it)</span>
        </div>
        <div className="allRow">
          source <input value={s.sourceName} onChange={(e) => set({ sourceName: e.target.value })} placeholder="the certificate or data sheet — NFRC CPD MAR-N-251" style={{ width: 240 }} title="required: the source by name — a URL beside it when there is one" />
          URL <input className="q" value={s.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://… (optional when the source is named)" title="right-click for cut, copy and paste" />
        </div>
        <div className="allRow">
          <button className="apply" onClick={() => void submit()} title="the row goes into materials.db's fenestration table (through your sidecar) and this type takes it: a SimpleGlazingSystem at your U, SHGC and VT">{s.editFrom ? "Save the edit · the type takes it" : "Save · the type takes it"}</button>
          {s.editFrom && p.onDelete && <button className="qaBtn bad" onClick={() => p.onDelete!(s.editFrom!)} title="remove this row of yours from materials.db and your sidecar — remembered by its key, never carried back; a type that took it keeps the numbers as typed values">Delete</button>}
          <button className="qaBtn" onClick={p.onCancel}>Cancel</button>
          {why && <span className="bad">not saved: it needs {why}</span>}
        </div>
      </div>
    </div>
  );
}
