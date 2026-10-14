// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SYSTEMS › PLUMBING — THE COLUMN beside the sheet (user, 2026-10-02: water heaters "assigned to a specific room for room heat gain and
// loss (with heat pump water heater)"). As on MECHANICAL and ELECTRICAL: the sheet's save state at the head, then the SELECTED card's
// settings — a heater's ROOM (its zone takes the tank's losses and, for a heat pump, gives it its air), its tank, its heater, its
// fuel or its heat pump's rating; a hot-water use's rooms (ticked) and the bedrooms they hold, the daily use the code states — or,
// with nothing selected, what the sheet compiles to and what it refuses. Every number in the user's units, stored as the engine's SI.

import type { Assembly, AsmNode } from "../core/assembly.js";
import { patchNode } from "../core/assembly.js";
import { PLUMB_CLASS, heaterKindOf, realClassOf, withRooms, ROOMS_OF, BEDROOMS_FIELD, DHW_METHODS, DHW_SETPOINT_CITE, DHW_SHAPE_CITE, bathroomsByName, REU2016, WELL_RULE_FIELD, WELL_GPD_FIELD, WELL_W_FIELD, WELL_GPM_FIELD, type PlumbCompiled } from "../core/plumbSheet.js";
import { bedroomsIn } from "../core/bemGains.js";
import { DHW_EXAMPLE, RECOVERY, HUD_FHA_CITE, HPWH_ELEMENT_OFFSET_K, hudFha, skinFromStandby, tankAreaM2 } from "../core/dhwWrite.js";
import type { IoReference } from "../core/ioReference.js";
import { RefButton } from "./SystemOptions.js";
import { KV, NumInput } from "./bemUi.js";

export interface PlumbRoom { room: string; zone: string; conditioned: boolean }
export interface PlumbingColumnProps {
  asm: Assembly; onChange: (a: Assembly) => void; sel: string | null; onSel: (id: string | null) => void;
  compiled: PlumbCompiled; rooms: PlumbRoom[]; catalogueLabel: (cls: string) => string;
  /** what the SAVED model writes (its setting, read back) */
  writtenNote: string | null;
  pending: number; onSave: () => void; onRevert: () => void; busy: boolean;
  /** the file's water heaters, by name and room: the first sheet is made from them */
  fileHeaters: Array<{ name: string; room: string | null }>; onFromFile: () => void;
  ioRef: IoReference | null; imperial: boolean;
  /** the model's occupants (BAHSP 2014, the gains' own count) — the REU2016 rule's people */
  occupants: number | null;
  /** the bedroom ticks on ZONES as applied (2026-10-07) — the one place a bedroom is said */
  bedroomMarks: Readonly<Record<string, boolean>>;
}

const GAL = 0.003785411784;
/** a day's water at the eye (the user's units): gal/day under imperial, L/day under metric — the code's rule stays in gallons, its own words */
const dayVol = (gpd: number, imperial: boolean): string => (imperial ? `${gpd.toFixed(1)} gal/day` : `${(gpd * 3.785411784).toFixed(0)} L/day`);

export function PlumbingColumn(p: PlumbingColumnProps): React.ReactElement {
  const n = p.sel ? p.asm.nodes.find((x) => x.id === p.sel) ?? null : null;
  const refused = (id: string): string[] => p.compiled.refusals.filter((r) => r.node === id).map((r) => r.text);
  const cautions = (id: string): string[] => p.compiled.cautions.filter((r) => r.node === id).map((r) => r.text);
  return (
    <div className="idfBar bemCol">
      <div className="barHead">PLUMBING · the sheet</div>
      {/* THE METHOD (the user, 2026-10-07): one for the whole sheet, every hot-water use card labelled with it — mutually exclusive */}
      <div className="sysNote" title={DHW_METHODS.map((m) => `${m.label}: ${m.words}`).join("\n\n")}>hot-water use method:{" "}
        {DHW_METHODS.map((m) => <label key={m.id} className={m.built ? "src-code" : "muted"} style={{ marginRight: 8 }}><input type="radio" name="dhwMethod" checked={m.id === "dwelling"} disabled={!m.built} readOnly />{m.label}{m.built ? "" : " (not built)"}</label>)}
        <div className="muted">one card per dwelling unit — the main house and the ADU (Auxiliary Dwelling Unit) — each gets the code's daily use once</div>
      </div>
      <div className="sysApplyRow">
        <button className="apply" disabled={!p.pending || p.busy} onClick={p.onSave}>{p.pending ? `Save · ${p.pending} change${p.pending === 1 ? "" : "s"}` : "✓ saved — no changes"}</button>
        {p.pending > 0 && <button className="qaBtn" onClick={p.onRevert}>revert</button>}
      </div>
      {!p.asm.nodes.length && (
        <div className="sysBody">
          <div className="sysNote">The sheet is empty. Drag a water heater — heat pump, electric or gas — and a hot-water use from the bench under the view, connect the heater's HW out to the use's HW in, pick the heater's room and tick the rooms the use serves; or make the first sheet from the file:</div>
          <button className="qaBtn" disabled={!p.fileHeaters.length} onClick={p.onFromFile} title="a card per water heater the file places, in the room the file puts it in, its tank from its name; a hot-water use under each — the rooms a FIRST GUESS by name (the ADU's heater the ADU's rooms, the other the house's), for you to check">
            make the sheet from the file · {p.fileHeaters.length} water heater{p.fileHeaters.length === 1 ? "" : "s"}{p.fileHeaters.length ? ` (${p.fileHeaters.map((h) => h.room ?? "no room").join(", ")})` : ""}
          </button>
        </div>
      )}
      {n ? <CardSettings {...p} n={n} refused={refused(n.id)} cautions={cautions(n.id)} /> : p.asm.nodes.length > 0 && (
        <div className="sysBody">
          <KV k="the sheet" v={`${p.compiled.heaters.length} water heater${p.compiled.heaters.length === 1 ? "" : "s"} · ${p.compiled.uses.length} hot-water use${p.compiled.uses.length === 1 ? "" : "s"} · ${p.compiled.heaters.reduce((t, h) => t + h.gpd, 0).toFixed(1)} gal/day`} />
          {p.compiled.heaters.map((h) => <div key={h.node} className="sysNote"><b>{h.name}</b> in {h.room} → {h.uses.map((u) => `${u.name} (${dayVol(u.gpd, p.imperial)})`).join(", ") || "no use"}</div>)}
          {p.compiled.wells.map((w) => <div key={w.node} className="sysNote"><b>{w.name}</b> → {w.gpdWords} = {dayVol(w.gpd, p.imperial)} · {w.runHours.toFixed(2)} h/day at {w.pumpW} W</div>)}
          {p.compiled.refusals.map((r, i) => <div key={i} className="src-warn">{r.text}</div>)}
          {p.compiled.cautions.map((r, i) => <div key={`c${i}`} className="src-user">{r.text}</div>)}
          {p.writtenNote && <KV k="in the saved model" src="user" v={p.writtenNote} />}
          <div className="sysNote muted">select a card on the sheet to see its settings here</div>
        </div>
      )}
    </div>
  );
}

function CardSettings(p: PlumbingColumnProps & { n: AsmNode; refused: string[]; cautions: string[] }): React.ReactElement {
  const n = p.n, im = p.imperial;
  const f = (n.fields ?? {}) as Record<string, string | number>;
  const set = (k: string, v: string | number | null): void => p.onChange(patchNode(p.asm, n.id, (x) => { const g = { ...(x.fields ?? {}) }; if (v === null || v === "") delete g[k]; else g[k] = v; return { ...x, fields: g }; }));
  const num = (k: string): number | null => (typeof f[k] === "number" ? (f[k] as number) : null);
  const kind = heaterKindOf(n.cls);
  const heater = kind ? p.compiled.heaters.find((h) => h.node === n.id) ?? null : null;
  const use = n.cls === PLUMB_CLASS.use ? p.compiled.uses.find((u) => u.node === n.id) ?? null : null;
  // a numeric input in the user's units: shown = SI × k (+ off), stored back as SI
  const unitInput = (key: string, siDefault: number, k: number, off: number, digits: number, label: string, title?: string): React.ReactElement => (
    <tr><td title={title}>{label}</td><td><NumInput value={num(key) === null ? null : num(key)! * k + off} placeholder={Number.isFinite(siDefault) ? `${(siDefault * k + off).toFixed(digits)}` : "—"} digits={digits} onValue={(v) => set(key, v === null ? null : Number(((v - off) / k).toPrecision(8)))} /></td></tr>
  );
  const tF = (c: number): number => c * 1.8 + 32;
  const served = heater ? heater.uses : [];
  const size = kind ? hudFha(served.reduce((t, u) => t + u.bedrooms, 0), Math.max(1, served.reduce((t, u) => t + u.bathrooms, 0)), kind === "gas") : null;
  return (
    <div className="sysSettings elecSettings">
      <div className="sysOptHead">
        <input type="text" className="asmName" value={n.label ?? ""} placeholder={p.catalogueLabel(n.cls ?? "")} onChange={(e) => p.onChange(patchNode(p.asm, n.id, (x) => { const m = { ...x }; if (e.target.value) m.label = e.target.value; else delete m.label; return m; }))} title="the component's name — the object's name in the IDF" />
        <span className="muted asmIdLabel">ID :</span>
        <input type="text" className="asmName asmIdentInput" value={n.ident ?? ""} placeholder="e.g. WH-1" onChange={(e) => p.onChange(patchNode(p.asm, n.id, (x) => { const m = { ...x }; if (e.target.value) m.ident = e.target.value; else delete m.ident; return m; }))} title="the component's ID — shown under its name on the sheet, and its IDF name when given" />
        <span className="muted" title="the EnergyPlus class this card writes; right-click the card on the sheet to remove it"> · {realClassOf(n.cls ?? "")}{kind === "gas" ? " (gas)" : ""}</span>
        <RefButton cls={realClassOf(n.cls ?? "")} ioRef={p.ioRef} />
      </div>
      {p.refused.map((t, i) => <div key={i} className="src-warn">{t}</div>)}
      {p.cautions.map((t, i) => <div key={`c${i}`} className="src-user">{t}</div>)}
      {kind && (
        <>
          <table className="pvFields"><tbody>
            <tr><td title="the room the heater sits in: its zone takes the tank's skin losses, and a heat pump draws that zone's air over its evaporator (the zone is cooled and dried by it)">room</td><td>
              <select value={ROOMS_OF(n)[0] ?? ""} onChange={(e) => p.onChange(withRooms(p.asm, n.id, e.target.value ? [e.target.value] : []))}>
                <option value="">— pick its room —</option>
                {p.rooms.map((r) => <option key={r.room} value={r.room}>{r.room}{r.zone !== r.room ? ` · zone ${r.zone}` : ""}{r.conditioned ? "" : " · unconditioned"}</option>)}
              </select>
            </td></tr>
            {unitInput("tank_volume", (size?.gal ?? 50) * GAL, im ? 1 / GAL : 1000, 0, im ? 0 : 0, im ? "tank gal" : "tank L", `the tank's volume — blank: ${size?.gal ?? "—"} gal for ${size?.row ?? "the rooms it serves"}, ${HUD_FHA_CITE}`)}
            {unitInput("heater_1_capacity", size?.w ?? 4500, kind === "gas" && im ? 3.412142 : 1, 0, 0, kind === "gas" ? (im ? "burner Btu/h" : "burner W") : "element W", `the ${kind === "gas" ? "burner" : kind === "hpwh" ? "backup element" : "element"}'s capacity — blank: ${size ? `${(size.w / 1000).toFixed(1)} kW` : "—"} (${HUD_FHA_CITE})`)}
            {kind === "gas" && <tr><td>fuel</td><td><select value={String(f.heater_fuel_type ?? "Propane")} onChange={(e) => set("heater_fuel_type", e.target.value)}><option value="Propane">Propane (the file's 500 gal LPG tank)</option><option value="NaturalGas">Natural gas</option></select></td></tr>}
            {kind === "gas" && unitInput("heater_thermal_efficiency", RECOVERY.gas, 100, 0, 0, "recovery %", RECOVERY.cite)}
            {kind === "hpwh" && unitInput("rated_heating_capacity", DHW_EXAMPLE.hpwh.ratedCapacityW, 1, 0, 0, "heat pump W", `the compressor's rated heating capacity — blank: ${DHW_EXAMPLE.hpwh.ratedCapacityW} W, ${DHW_EXAMPLE.cite}; the product's own rating is yours to type`)}
            {kind === "hpwh" && unitInput("rated_cop", DHW_EXAMPLE.hpwh.ratedCop, 1, 0, 2, "rated COP", `blank: ${DHW_EXAMPLE.hpwh.ratedCop}, ${DHW_EXAMPLE.cite}`)}
            {kind === "hpwh" && unitInput("minimum_inlet_air_temperature_for_compressor_operation", DHW_EXAMPLE.hpwh.minInletC, im ? 1.8 : 1, im ? 32 : 0, 0, im ? "min air °F" : "min air °C", `below this room-air temperature the compressor stops and the element heats — blank: ${DHW_EXAMPLE.hpwh.minInletC} °C, ${DHW_EXAMPLE.cite}`)}
            {unitInput("standby_loss_w", NaN, 1, 0, 0, "standby loss W", "the product's stated standby loss, W (Wh per hour) — with the difference it is stated at, the engine's skin loss is set so the tank loses exactly this; it replaces the skin loss below")}
            {unitInput("standby_loss_delta_k", NaN, im ? 1.8 : 1, 0, 0, im ? "at ΔT °F" : "at ΔT K", "the tank-to-room temperature difference the standby loss is stated at")}
            {unitInput("skin_loss_coefficient", DHW_EXAMPLE.skinLossWm2K, im ? 0.17611 : 1, 0, 3, im ? "skin loss Btu/h·ft²·°F" : "skin loss W/m²·K", `the tank's loss per area of the ENGINE'S tank (a cylinder of the volume at ${DHW_EXAMPLE.tankHeightM} m, its ends included) to the room's zone — blank: ${DHW_EXAMPLE.skinLossWm2K} W/m²·K, ${DHW_EXAMPLE.cite} (high: near an uninsulated tank); a standby loss above replaces it`)}
          </tbody></table>
          {(() => {
            const vol = num("tank_volume") ?? (size?.gal ?? 50) * 0.003785411784, area = tankAreaM2(vol, DHW_EXAMPLE.tankHeightM);
            const w = num("standby_loss_w"), dk = num("standby_loss_delta_k");
            const skin = w !== null && dk ? skinFromStandby(w, dk, vol, DHW_EXAMPLE.tankHeightM) : num("skin_loss_coefficient") ?? DHW_EXAMPLE.skinLossWm2K;
            return <div className="pvNote">the engine's tank: {im ? `${(area * 10.7639).toFixed(1)} ft²` : `${area.toFixed(2)} m²`} (sides and ends) × {im ? `${(skin * 0.17611).toFixed(4)} Btu/h·ft²·°F` : `${skin.toFixed(3)} W/m²·K`} = UA {(skin * area).toFixed(2)} W/K{w !== null && dk ? ` — from the standby loss ${w} W at ${im ? `${(dk * 1.8).toFixed(0)} °F` : `${dk.toFixed(1)} K`}` : ""} · at {im ? "125 °F" : "51.7 °C"} in a {im ? "60 °F" : "15.6 °C"} room it loses {(skin * area * (51.67 - 15.56)).toFixed(0)} W</div>;
          })()}
          <div className="pvNote">the tank at {im ? "125 °F" : "51.7 °C"} — {DHW_SETPOINT_CITE}{kind === "hpwh" ? `; the backup element ${HPWH_ELEMENT_OFFSET_K} K under it (${im ? `${tF(51.67 - HPWH_ELEMENT_OFFSET_K).toFixed(0)} °F` : `${(51.67 - HPWH_ELEMENT_OFFSET_K).toFixed(1)} °C`}), so the heat pump leads` : ""} · the cold supply the mains from the weather file · a stand-alone tank, its draw the uses connected to it{heater ? ` (${heater.gpd.toFixed(1)} gal/day)` : ""}</div>
        </>
      )}
      {n.cls === PLUMB_CLASS.use && <UseRooms {...p} n={n} use={use} set={set} num={num} />}
      {n.cls === PLUMB_CLASS.well && (() => {
        const well = p.compiled.wells.find((w) => w.node === n.id) ?? null;
        const rule = f[WELL_RULE_FIELD] === "reu2016" ? "reu2016" : "typed";
        const L_PER_GAL = 3.785411784;
        return (
          <>
            <table className="pvFields"><tbody>
              <tr><td title="the household's whole water (cold and hot) the pump lifts each day">day's water</td><td>
                <select value={rule} onChange={(e) => set(WELL_RULE_FIELD, e.target.value === "reu2016" ? "reu2016" : null)}>
                  <option value="typed">typed below</option>
                  <option value="reu2016">REU2016: {im ? `${REU2016.gpcd} gal` : `${(REU2016.gpcd * L_PER_GAL).toFixed(0)} L`}/person/day × the model's {p.occupants !== null ? p.occupants.toFixed(2) : "—"} occupants</option>
                </select>
              </td></tr>
              {rule === "typed" && <tr><td>{im ? "gal/day" : "L/day"}</td><td><NumInput value={num(WELL_GPD_FIELD) === null ? null : num(WELL_GPD_FIELD)! * (im ? 1 : L_PER_GAL)} placeholder="type it" digits={0} min={0} onValue={(v) => set(WELL_GPD_FIELD, v === null ? null : Number((v / (im ? 1 : L_PER_GAL)).toPrecision(8)))} /></td></tr>}
              <tr><td title="the pump's electric power while it runs — its nameplate; no default is assumed">pump W</td><td><NumInput value={num(WELL_W_FIELD)} placeholder="type it" digits={0} min={0} onValue={(v) => set(WELL_W_FIELD, v)} /></td></tr>
              <tr><td title="the pump's flow at the system's pressure — how fast it fills the pressure tank; the day's water ÷ this flow is its run time">{im ? "pump gpm" : "pump L/min"}</td><td><NumInput value={num(WELL_GPM_FIELD) === null ? null : num(WELL_GPM_FIELD)! * (im ? 1 : L_PER_GAL)} placeholder="type it" digits={1} min={0} onValue={(v) => set(WELL_GPM_FIELD, v === null ? null : Number((v / (im ? 1 : L_PER_GAL)).toPrecision(8)))} /></td></tr>
            </tbody></table>
            {rule === "reu2016" && <div className="pvNote">{REU2016.cite} — the occupants are the model's own (BAHSP 2014: 0.59 × bedrooms + 0.87)</div>}
            {well && <div className="pvNote">{im ? `${well.gpd.toFixed(0)} gal/day` : `${(well.gpd * L_PER_GAL).toFixed(0)} L/day`} at {im ? `${well.gpm} gpm` : `${(well.gpm * L_PER_GAL).toFixed(1)} L/min`} → runs {well.runHours.toFixed(2)} h/day × {well.pumpW} W = {((well.runHours * well.pumpW) / 1000).toFixed(2)} kWh/day, on SCHEDULES › domestic water — metered as exterior equipment (Well Pump), no room takes its heat</div>}
          </>
        );
      })()}
    </div>
  );
}

/** THE ROOMS A USE SERVES, ticked by zone; their bedrooms (by name — "Bed 1") set the code's daily use, a typed number over them */
function UseRooms(p: PlumbingColumnProps & { n: AsmNode; use: PlumbCompiled["uses"][number] | null; set: (k: string, v: number | null) => void; num: (k: string) => number | null }): React.ReactElement {
  const mine = new Set(ROOMS_OF(p.n));
  const zones = new Map<string, PlumbRoom[]>();
  for (const r of p.rooms) zones.set(r.zone, [...(zones.get(r.zone) ?? []), r]);
  const take = (rs: string[], on: boolean): void => p.onChange(withRooms(p.asm, p.n.id, on ? [...mine, ...rs] : [...mine].filter((r) => !rs.includes(r))));
  const beds = bedroomsIn([...mine], p.bedroomMarks), counted = beds.length;
  return (
    <div className="pvPanels">
      <KV k="use" v={p.use ? `${dayVol(p.use.gpd, p.imperial)} — ${p.compiled.rule.words} with Nbr ${p.use.bedrooms} (${p.compiled.rule.cite})` : "not written — see above"} />
      <table className="pvFields"><tbody>
        <tr><td title="the bedrooms the code's use is counted from: the rooms this card serves that are ticked as bedrooms on ZONES (the one place a bedroom is said; a room named 'Bed n' starts ticked)">bedrooms</td><td className="src-user">{counted}{beds.length ? ` — ${beds.join(", ")}` : ""} <span className="muted">· ticked on ZONES</span>{p.num(BEDROOMS_FIELD) !== null ? <span className="muted"> · the {p.num(BEDROOMS_FIELD)} typed here before is retired</span> : null}</td></tr>
      </tbody></table>
      <div className="pvNote">{mine.size} room{mine.size === 1 ? "" : "s"} · {counted} bedroom{counted === 1 ? "" : "s"} (ZONES) and {bathroomsByName([...mine])} bath{bathroomsByName([...mine]) === 1 ? "" : "s"} by name · drawn on {DHW_SHAPE_CITE}</div>
      {[...zones].map(([z, rs]) => {
        const inHere = rs.filter((r) => mine.has(r.room)).length;
        return (
          <div key={z} className="pvFace">
            <div className="pvFaceHead">zone {z} · {inHere} of {rs.length}
              <button className="chip" disabled={inHere === rs.length} onClick={() => take(rs.map((r) => r.room), true)}>all</button>
              <button className="chip" disabled={!inHere} onClick={() => take(rs.map((r) => r.room), false)}>none</button>
            </div>
            <div className="pvTicks">
              {rs.map((r) => (
                <label key={r.room} title={r.room}><input type="checkbox" checked={mine.has(r.room)} onChange={(e) => take([r.room], e.target.checked)} />{r.room}</label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
