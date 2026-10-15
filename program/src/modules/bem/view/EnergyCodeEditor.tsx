// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// THE ENERGY CODE'S VALUES, TYPED (user, 2026-10-15): SITE › energy code › Edit values… — the code's name and source, then one climate
// zone's row of the values the model is built from, each with the place in the code it was read (the citation). Written to the user's
// own data/energy-codes/*.csv (energyCodeEdit.ts), the file replaced kept beside it; read again at once, and the model rebuilt.

import { useEffect, useMemo, useState } from "react";
import { ENERGY_CODE_FILES } from "../core/energyCodes.js";
import { FACTOR_DEFS, entriesOf, entryProblems, missingOf, recsOf, shownOf, shownUnit, storedOf, tidy, withEdits, type Entry, type Rec } from "../core/energyCodeEdit.js";
import { ZONE_TABLE_URL } from "../../../core/climateZone.js";

const ZONE_ROWS = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];
const NEW = "__new__";
const dec = (b: Uint8Array | null): string => (b ? new TextDecoder().decode(b) : "");

export function EnergyCodeEditor(p: { zone: string | null; edition: string | null; imperial: boolean; onSaved: () => void; onCancel: () => void }): React.ReactElement {
  const [csv, setCsv] = useState<{ editions: string; values: string } | null>(null);
  useEffect(() => {
    void Promise.all([window.bem.readDataFile(ENERGY_CODE_FILES.editions), window.bem.readDataFile(ENERGY_CODE_FILES.values)])
      .then(([e, v]) => setCsv({ editions: dec(e), values: dec(v) }));
  }, []);
  const editions = useMemo(() => (csv ? recsOf(csv.editions) : []), [csv]);
  const values = useMemo(() => (csv ? recsOf(csv.values) : []), [csv]);
  const [pick, setPick] = useState<string | null>(null);
  const [ed, setEd] = useState<Rec>({ id: "", label: "", publisher: "", source_url: "", read_on: "", read_from: "", irc_equivalent: "" });
  const [zoneRow, setZoneRow] = useState(/^\d/.exec((p.zone ?? "").trim())?.[0] ?? "4");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  // shown as typed: the text in each box, so a half-typed number is never rewritten under the cursor
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // the edition opened first: the one the project reads, else the table's first, else a new one
  useEffect(() => {
    if (!csv || pick !== null) return;
    setPick(editions.find((e) => e.id === p.edition)?.id ?? editions[0]?.id ?? NEW);
  }, [csv, editions, pick, p.edition]);
  useEffect(() => {
    if (pick === null) return;
    const e = editions.find((x) => x.id === pick);
    setEd(e ? { ...e } : { id: "", label: "", publisher: "", source_url: "", read_on: new Date().toISOString().slice(0, 10), read_from: "", irc_equivalent: "" });
    const en = entriesOf(values, e?.id ?? "", zoneRow);
    setEntries(en);
    setTyped(Object.fromEntries(FACTOR_DEFS.map((d) => { const v = en[d.factor]?.value; return [d.factor, v === null || v === undefined ? "" : tidy(shownOf(d.kind, v, p.imperial))]; })));
  }, [pick, zoneRow, editions, values, p.imperial]);
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);

  const setEntry = (f: string, patch: Partial<Entry>): void => setEntries((x) => ({ ...x, [f]: { ...(x[f] ?? { value: null, cite: "", note: "" }), ...patch } }));
  const idOk = /^[A-Za-z0-9._-]+$/.test(ed.id ?? "");
  const idTaken = pick === NEW && editions.some((e) => e.id === ed.id);
  const problems = [...(!idOk ? ["the code's id: letters, digits, . _ - only (e.g. IECC-2021)"] : []), ...(idTaken ? [`the id ${ed.id} is already on record — pick it above to edit it`] : []),
    ...(!(ed.label ?? "").trim() ? ["the code's name"] : []), ...entryProblems(entries)];
  const missing = missingOf(entries);
  const save = async (): Promise<void> => {
    if (!csv || problems.length) return;
    setSaving(true); setError(null);
    try {
      const next = withEdits(csv, { ...ed, label: ed.label!.trim() }, zoneRow, entries);
      await window.bem.saveEnergyCodes({ "editions.csv": next.editions, "values.csv": next.values });
      p.onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false); }
  };
  const edField = (k: string, label: string, ph: string, w: number, tip: string): React.ReactElement => (
    <label title={tip}>{label} <input value={ed[k] ?? ""} placeholder={ph} style={{ width: w }} disabled={k === "id" && pick !== NEW} onChange={(e) => setEd((x) => ({ ...x, [k]: e.target.value }))} /></label>
  );
  return (
    <div className="menuScrim dialogScrim" onPointerDown={p.onCancel}>
      <div className="dialog codeDialog codeEditor" role="dialog" aria-label="the energy code's values" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">the energy code's values — as you read them in the code</div>
        <div className="muted" style={{ marginBottom: 8 }}>
          The model's default constructions, its infiltration and the reference thermostat are built from these values. Enthalix ships no code
          table: read the code your project is under (the IECC is free to read, read-only, at <a href={ZONE_TABLE_URL} target="_blank" rel="noreferrer">codes.iccsafe.org</a>) and
          enter its values with the table or section each is from. Saved to <code>data/energy-codes/</code>.
        </div>
        {!csv ? <div className="muted">reading data/energy-codes/…</div> : <>
          <div className="allRow">
            <label>code <select value={pick ?? ""} onChange={(e) => setPick(e.target.value)}>
              {editions.map((e) => <option key={e.id} value={e.id}>{e.label || e.id}</option>)}
              <option value={NEW}>new code…</option>
            </select></label>
            {edField("id", "id", "IECC-2021", 110, "a short key for this code — the files and the project's ruling name it")}
            {edField("label", "name", "2021 IECC", 170, "the code's name as the app shows it")}
            {edField("publisher", "publisher", "International Code Council", 170, "who publishes the code")}
          </div>
          <div className="allRow">
            {edField("source_url", "read at", "https://codes.iccsafe.org/…", 260, "the page you read the values from")}
            {edField("read_on", "on", "YYYY-MM-DD", 96, "the date you read them")}
            <label title="the climate zone's row of the code's tables: the zone's number (a table row like '5 and Marine 4' is entered as 5)">climate zone row <select value={zoneRow} onChange={(e) => setZoneRow(e.target.value)}>
              {ZONE_ROWS.map((z) => <option key={z} value={z}>{z}{p.zone && p.zone.startsWith(z) ? ` (this project: ${p.zone})` : ""}</option>)}
            </select></label>
          </div>
          <table className="codeTable codeValues">
            <thead><tr><th>factor</th><th>value</th><th>unit</th><th>where in the code (table / section)</th><th>note</th></tr></thead>
            <tbody>{FACTOR_DEFS.map((d) => {
              const e = entries[d.factor] ?? { value: null, cite: "", note: "" };
              return (
                <tr key={d.factor} title={d.tip}>
                  <td>{d.label}{d.at === "all" ? <span className="muted"> · every zone</span> : null}</td>
                  <td><input className="num" style={{ width: 76 }} value={typed[d.factor] ?? ""} placeholder={d.nullable ? "NR" : "not entered"}
                    onChange={(x) => { const t = x.target.value; setTyped((y) => ({ ...y, [d.factor]: t })); const n = t.trim() === "" ? null : Number(t); setEntry(d.factor, { value: n === null ? null : Number.isFinite(n) ? storedOf(d.kind, n, p.imperial) : NaN }); }} /></td>
                  <td className="muted">{shownUnit(d, p.imperial)}</td>
                  <td><input style={{ width: 210 }} value={e.cite} placeholder={d.at === "all" ? "e.g. Table R405.4.2(1)" : "e.g. Table R402.1.2"} onChange={(x) => setEntry(d.factor, { cite: x.target.value })} /></td>
                  <td><input style={{ width: 150 }} value={e.note} onChange={(x) => setEntry(d.factor, { note: x.target.value })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <div className="muted">stored as the code states them (U in Btu/h·ft²·°F, R in h·ft²·°F/Btu, depth in ft, thermostat in °F){p.imperial ? "" : " — typed here in metric, converted on save"}</div>
          {missing.length > 0 && <div className="src-user">not entered yet — the model cannot run until they are: {missing.join(", ")}</div>}
          {problems.length > 0 && <div className="bad">{problems.join(" · ")}</div>}
          {error && <div className="bad">not saved: {error}</div>}
        </>}
        <div className="allRow">
          <button className="apply" disabled={!csv || problems.length > 0 || saving} onClick={() => void save()}>{saving ? "saving…" : `Save zone ${zoneRow}'s values`}</button>
          <button className="qaBtn" onClick={p.onCancel}>cancel</button>
          <span className="muted">then pick the code with Choose… — the model is rebuilt on save</span>
        </div>
      </div>
    </div>
  );
}
