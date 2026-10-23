// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SYSTEMS › ELECTRICAL — THE COLUMN beside the sheet (user, 2026-10-02: "the electrical systems MUST be assembled similar to the
// Mechanical system, with components below the system view, and details of the components shown in right column"). As on
// MECHANICAL: the sheet's save state at the head (Save · n changes, revert), then the SELECTED card's settings — an array's panels
// (ticked, the panel count edited by picking, each roof face a group) and its module, mounting and losses; an inverter's efficiency
// and ratio; what a load center and the utility write — or, with nothing selected, what the sheet compiles to and what it refuses.

import type { Assembly, AsmNode } from "../core/assembly.js";
import { patchNode } from "../core/assembly.js";
import { ELEC_CLASS, panelsOf, withPanels, panelFaces, zonesOn, type ElecCompiled } from "../core/elecSheet.js";
import { PV_MODULE_TYPES, PV_ARRAY_TYPES, PVWATTS_DEFAULTS, type PvPanel, type ResolvedPv } from "../core/pvArrays.js";
import type { IoReference } from "../core/ioReference.js";
import { RefButton } from "./SystemOptions.js";
import { KV, NumInput, fmtArea } from "./bemUi.js";

export interface ElectricalColumnProps {
  asm: Assembly; onChange: (a: Assembly) => void; sel: string | null; onSel: (id: string | null) => void;
  compiled: ElecCompiled; panels: PvPanel[]; catalogueLabel: (cls: string) => string;
  /** the user's units (Show Imperial / Show Metric) — every number at the eye */
  imperial: boolean;
  /** what the SAVED model writes (its generation setting, read back) */
  written: ResolvedPv | null | undefined; writtenNote: string | null;
  pending: number; onSave: () => void; onRevert: () => void; busy: boolean;
  /** an empty sheet: an array per roof face, one inverter, one load center, the utility, wired (the PV form's fields carried) */
  onFromFile: () => void;
  /** light these panels in the model view */
  onShow: (ids: number[]) => void;
  ioRef: IoReference | null;
}

export function ElectricalColumn(p: ElectricalColumnProps): React.ReactElement {
  const n = p.sel ? p.asm.nodes.find((x) => x.id === p.sel) ?? null : null;
  const kw = (ps: PvPanel[]): string => `${(ps.reduce((t, q) => t + q.watts, 0) / 1000).toFixed(2)} kW DC`;
  const byId = new Map(p.panels.map((q) => [q.expressId, q]));
  const refused = (id: string): string[] => p.compiled.refusals.filter((r) => r.node === id).map((r) => r.text);
  const cautions = (id: string): string[] => p.compiled.cautions.filter((r) => r.node === id).map((r) => r.text);
  return (
    <div className="idfBar bemCol">
      <div className="barHead">ELECTRICAL · the sheet</div>
      <div className="sysApplyRow">
        <button className="apply" disabled={!p.pending || p.busy} onClick={p.onSave}>{p.pending ? `Save · ${p.pending} change${p.pending === 1 ? "" : "s"}` : "✓ saved — no changes"}</button>
        {p.pending > 0 && <button className="qaBtn" onClick={p.onRevert}>revert</button>}
      </div>
      {!p.asm.nodes.length && (
        <div className="sysBody">
          <div className="sysNote">The sheet is empty. Drag cards from the bench under the view — a PV array, an inverter, a load center, a meter, the utility — and connect DC out → DC in, AC out → AC in, Grid → Grid (a load center → a meter → the utility); drag a space onto a load center to put its zone on it; or make the first sheet from the file:</div>
          <button className="qaBtn" disabled={!p.panels.length} onClick={p.onFromFile} title="one array per roof face holding its panels, one inverter (the microinverters' shared efficiency), one load center, the utility — wired; the PV form's settings carried onto the cards">
            make the sheet from the file · {p.panels.length} panels on {panelFaces(p.panels).length} roof face{panelFaces(p.panels).length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {n ? <CardSettings {...p} n={n} refused={refused(n.id)} cautions={cautions(n.id)} byId={byId} kw={kw} /> : p.asm.nodes.length > 0 && (
        <div className="sysBody">
          <KV k="the sheet" v={(() => { const lc = p.asm.nodes.filter((x) => x.cls === ELEC_CLASS.centre).length; return `${lc} load center${lc === 1 ? "" : "s"}${p.compiled.centres.length ? ` (${p.compiled.centres.length} fed by PV)` : ""} · ${p.compiled.meters.length} meter${p.compiled.meters.length === 1 ? "" : "s"} · ${p.compiled.centres.reduce((t, c) => t + c.arrays.length, 0)} arrays · ${p.compiled.owner.size} of ${p.panels.length} panels`; })()} />
          {p.compiled.centres.map((c) => <div key={c.node} className="sysNote"><b>{c.name}</b> ← {c.inverter.name} ← {c.arrays.map((a) => `${a.name} (${a.panels.length})`).join(", ")}{c.utility ? " → the utility" : ""}</div>)}
          {p.compiled.meters.map((m) => <div key={m.node} className="sysNote"><b>{m.name}</b> meters {m.zones.join(", ")}</div>)}
          {p.compiled.refusals.map((r, i) => <div key={i} className="src-warn">{r.text}</div>)}
          {p.compiled.cautions.map((r, i) => <div key={`c${i}`} className="src-user">{r.text}</div>)}
          {p.writtenNote && <KV k="in the saved model" src="user" v={p.writtenNote} />}
          <div className="sysNote muted">select a card on the sheet to see its settings here</div>
        </div>
      )}
    </div>
  );
}

function CardSettings(p: ElectricalColumnProps & { n: AsmNode; refused: string[]; cautions: string[]; byId: Map<number, PvPanel>; kw: (ps: PvPanel[]) => string }): React.ReactElement {
  const n = p.n;
  const f = (n.fields ?? {}) as Record<string, string | number>;
  const set = (k: string, v: string | number | null): void => p.onChange(patchNode(p.asm, n.id, (x) => { const g = { ...(x.fields ?? {}) }; if (v === null || v === "") delete g[k]; else g[k] = v; return { ...x, fields: g }; }));
  const pct = (k: string, dflt: number): React.ReactElement => <NumInput value={typeof f[k] === "number" ? (f[k] as number) * 100 : null} placeholder={`${(dflt * 100).toFixed(0)} (the manual's)`} digits={1} onValue={(v) => set(k, v === null ? null : v / 100)} />;
  return (
    <div className="sysSettings elecSettings">
      <div className="sysOptHead">
        <input type="text" className="asmName" value={n.label ?? ""} placeholder={p.catalogueLabel(n.cls ?? "")} onChange={(e) => p.onChange(patchNode(p.asm, n.id, (x) => { const m = { ...x }; if (e.target.value) m.label = e.target.value; else delete m.label; return m; }))} title="the component's name — the object's name in the IDF" />
        <span className="muted asmIdLabel">ID :</span>
        <input type="text" className="asmName asmIdentInput" value={n.ident ?? ""} placeholder="e.g. INV-1" onChange={(e) => p.onChange(patchNode(p.asm, n.id, (x) => { const m = { ...x }; if (e.target.value) m.ident = e.target.value; else delete m.ident; return m; }))} title="the component's ID — shown under its name on the sheet, and its IDF name when given" />
        <span className="muted" title="the EnergyPlus class this card is; right-click the card on the sheet to remove it"> · {n.cls}</span>
        <RefButton cls={n.cls ?? ""} ioRef={p.ioRef} />
      </div>
      {p.refused.map((t, i) => <div key={i} className="src-warn">{t}</div>)}
      {p.cautions.map((t, i) => <div key={`c${i}`} className="src-user">{t}</div>)}
      {n.cls === ELEC_CLASS.array && <ArrayPanels {...p} />}
      {n.cls === ELEC_CLASS.array && (
        <table className="pvFields"><tbody>
          <tr><td>module</td><td><select value={String(f.module_type ?? "")} onChange={(e) => set("module_type", e.target.value)}>
            <option value="">from the panels' efficiency (their W over their face)</option>
            {PV_MODULE_TYPES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select></td></tr>
          <tr><td>mounting</td><td><select value={String(f.array_type ?? "")} onChange={(e) => set("array_type", e.target.value)}>
            <option value="">{PV_ARRAY_TYPES[0]!.label}</option>
            {PV_ARRAY_TYPES.slice(1).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select></td></tr>
          <tr><td title="soiling, shading by nearby objects the model does not draw, wiring, mismatch, availability — the PVWatts lump">system losses %</td><td>{pct("system_losses", PVWATTS_DEFAULTS.systemLosses)}</td></tr>
        </tbody></table>
      )}
      {n.cls === ELEC_CLASS.inverter && (
        <table className="pvFields"><tbody>
          <tr><td>efficiency %</td><td>{pct("inverter_efficiency", PVWATTS_DEFAULTS.inverterEfficiency)}</td></tr>
          <tr><td title="the arrays' DC rating over the inverter's AC rating">DC / AC ratio</td><td><NumInput value={typeof f.dc_to_ac_size_ratio === "number" ? (f.dc_to_ac_size_ratio as number) : null} placeholder={`${PVWATTS_DEFAULTS.dcToAc} (the manual's)`} digits={2} onValue={(v) => set("dc_to_ac_size_ratio", v)} /></td></tr>
        </tbody></table>
      )}
      {n.cls === ELEC_CLASS.inverter && <div className="sysNote">the house's microinverters (one per panel) are written as one PVWatts inverter at their shared efficiency — the engine's PVWatts inverter is one per load center</div>}
      {n.cls === ELEC_CLASS.centre && <div className="sysNote">writes ElectricLoadCenter:Distribution — Baseload, a DC buss with its one inverter, and its ElectricLoadCenter:Generators list of every panel its arrays hold. Nothing here is the user's to type yet; batteries (none installed) would join it here.</div>}
      {n.cls === ELEC_CLASS.centre && <div className="sysNote">its zones: {zonesOn(n).length ? zonesOn(n).join(", ") : "none — drag a space from LEVELS · SPACES onto the card; right-click a zone on the card to unassign it"} · wire its Grid to a Meter to meter them</div>}
      {n.cls === ELEC_CLASS.meter && <div className="sysNote">writes Meter:Custom, named as the card is: each zone's own electricity (its lights and equipment) on the load centers wired to its Grid in, and the electricity of every unit that serves only those zones — the engine meters a unit to HVAC, never to a zone. Reported by month, day and hour; the year is on RUN, beside what no meter holds.</div>}
      {n.cls === ELEC_CLASS.utility && <div className="sysNote">the service: the building's connection to the grid. Nothing is written for the card itself — the engine's facility meters say what the building buys (Electricity:Facility; with PV also ElectricityPurchased, ElectricitySurplusSold and ElectricityNet:Facility). NET METERING is the tariff's, not this card's: BOM › UTILITY's card states it, and the run is billed net only when PV feeds the building. Wire each Meter's Grid out here.</div>}
      {(n.cls === ELEC_CLASS.array || n.cls === ELEC_CLASS.inverter) && <div className="pvNote">the defaults are the {PVWATTS_DEFAULTS.citation}</div>}
    </div>
  );
}

/** THE PANEL COUNT, EDITED BY PICKING (the user's ruling, 2026-10-02): the panels the files carry, grouped by roof face; a tick puts
 *  one in this array (taking it out of any other — a panel is in one array), a face's buttons take or drop the face */
function ArrayPanels(p: ElectricalColumnProps & { n: AsmNode; kw: (ps: PvPanel[]) => string }): React.ReactElement {
  const mine = new Set(panelsOf(p.n));
  const holderOf = (id: number): AsmNode | null => p.asm.nodes.find((x) => x.id !== p.n.id && x.cls === ELEC_CLASS.array && panelsOf(x).includes(id)) ?? null;
  const take = (ids: number[], on: boolean): void => {
    let a = p.asm;
    if (on) for (const x of a.nodes.filter((y) => y.id !== p.n.id && y.cls === ELEC_CLASS.array)) { const keep = panelsOf(x).filter((id) => !ids.includes(id)); if (keep.length !== panelsOf(x).length) a = withPanels(a, x.id, keep); }
    const next = on ? [...mine, ...ids] : [...mine].filter((id) => !ids.includes(id));
    p.onChange(withPanels(a, p.n.id, next));
  };
  const faces = panelFaces(p.panels);
  const held = [...mine].map((id) => p.panels.find((q) => q.expressId === id)).filter((q): q is PvPanel => !!q);
  return (
    <div className="pvPanels">
      <KV k="panels" v={`${held.length} · ${p.kw(held)}`} />
      <button className="qaBtn" disabled={!held.length} onClick={() => p.onShow(held.map((q) => q.expressId))} title="switch to the model and light this array's panels">show in the model</button>
      {faces.map((ps, i) => {
        const tilt = ps.reduce((t, q) => t + q.tiltDeg, 0) / ps.length, inHere = ps.filter((q) => mine.has(q.expressId)).length;
        return (
          <div key={i} className="pvFace">
            <div className="pvFaceHead">roof face {i + 1} · {ps.length} panels at {tilt.toFixed(1)}° · {inHere} in this array
              <button className="chip" disabled={inHere === ps.length} onClick={() => take(ps.map((q) => q.expressId), true)}>all</button>
              <button className="chip" disabled={!inHere} onClick={() => take(ps.map((q) => q.expressId), false)}>none</button>
            </div>
            <div className="pvTicks">
              {ps.map((q) => { const h = holderOf(q.expressId); return (
                <label key={q.expressId} className={h ? "held" : ""} title={`${q.name} · ${q.watts} W · ${fmtArea(q.areaM2, p.imperial)} · tilt ${q.tiltDeg.toFixed(1)}°${h ? ` · in ${h.label ?? h.id} — ticking moves it here` : ""}`}>
                  <input type="checkbox" checked={mine.has(q.expressId)} onChange={(e) => take([q.expressId], e.target.checked)} />#{q.expressId % 100000000}
                </label>
              ); })}
            </div>
          </div>
        );
      })}
      {!p.panels.length && <div className="src-warn">no PV panel in the projected files — project the file that carries them on SITE</div>}
    </div>
  );
}
