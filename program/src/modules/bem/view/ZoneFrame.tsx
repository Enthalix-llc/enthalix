// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ZONES FRAME (user, 2026-09-13): under the view, four rails at its left edge as the SYSTEMS bench has — OCCUPANCY ·
// ENVELOPE · LIGHTING · LOADS — reading the selected ROOM, or the selected ZONE as the sum of its rooms. Every value comes
// back from bem.db's `rooms` rows (never the in-memory report), in its source's colour with the rule in words; an input
// STAGES a gain ruling — on the zone when a zone is the subject (every room of it takes the setting), on the room when a
// room is — applied by the column's counted button. The ENVELOPE rail is the space table, the same component the BIM
// inspector reads.

import type { BemRoomRow, GainRulings, GainRuling, GainEquipmentRow, BemScheduleRow, EquipmentGroup } from "../core/bemDb.js";
import type { SpaceSurface } from "../../bim/spaceTable.js";
import { spaceSummary } from "../../bim/spaceTable.js";
import type { MepElementRow } from "../../../core/db.js";
import { SpaceTableView, type SpaceTableProps } from "../../../view/SpaceTableView.js";
import { srcClass, NumInput, W_TO_BTUH } from "./bemUi.js";
import { siNoteAtEye, FT2_PER_M2 } from "../core/units.js";
import { RESIDENTIAL_EXAMPLE, BAHSP_2014, EQUIPMENT_GROUPS, groupOfRow } from "../core/bemGains.js";

export type FrameTab = "OCCUPANCY" | "ENVELOPE" | "LIGHTING" | "LOADS";
export const FRAME_TABS: FrameTab[] = ["OCCUPANCY", "ENVELOPE", "LIGHTING", "LOADS"];
const RAIL_COLOR: Record<FrameTab, string> = { OCCUPANCY: "#d6553b", ENVELOPE: "#3b6fd6", LIGHTING: "#b8860b", LOADS: "#2e9e5e" };

export interface ZoneFrameProps {
  /** the selected drawn Zone, or the room's own zone; null when nothing is selected */
  zone: { name: string; rooms: string[] } | null;
  /** the selected room; null when the zone is the subject */
  space: string | null;
  rooms: BemRoomRow[];
  stage: GainRulings; onStage: (g: GainRulings) => void;
  surfacesOf: (room: string) => SpaceSurface[];
  fixturesOf: (room: string) => MepElementRow[];
  table: Omit<SpaceTableProps, "rows" | "summary" | "fmtA">;
  schedules: BemScheduleRow[];
  fmtA: (m2: number) => string; imperial: boolean;
  tab: FrameTab; onTab: (t: FrameTab) => void;
}

/** a ruling with its empty parts dropped; undefined when nothing is left */
function prune(r: GainRuling): GainRuling | undefined {
  const out: GainRuling = {};
  const clean = (o: Record<string, unknown> | undefined): Record<string, unknown> | undefined => { if (!o) return undefined; const c = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); return Object.keys(c).length ? c : undefined; };
  const pp = clean(r.people as Record<string, unknown> | undefined); if (pp) out.people = pp as GainRuling["people"];
  const ll = clean(r.lights as Record<string, unknown> | undefined); if (ll) out.lights = ll as GainRuling["lights"];
  if (r.equipment?.length) out.equipment = r.equipment;
  return Object.keys(out).length ? out : undefined;
}

export function ZoneFrame(p: ZoneFrameProps): React.ReactElement {
  const subjectRooms = p.space ? [p.space] : p.zone?.rooms ?? [];
  const rows = subjectRooms.map((r) => p.rooms.find((x) => x.room === r)).filter((x): x is BemRoomRow => !!x);
  const bucket: "rooms" | "zones" = p.space ? "rooms" : "zones";
  const key = p.space ?? p.zone?.name ?? null;
  const rule: GainRuling = (key ? p.stage[bucket]?.[key] : undefined) ?? {};
  const setRule = (fn: (r: GainRuling) => GainRuling): void => {
    if (!key) return;
    const next = prune(fn(rule));
    const b = { ...(p.stage[bucket] ?? {}) }; if (next) b[key] = next; else delete b[key];
    const out: GainRulings = { ...p.stage }; if (Object.keys(b).length) out[bucket] = b; else delete out[bucket];
    p.onStage(out);
  };
  const W = (n: number): string => `${n.toFixed(0)} W`;   // electrical watts in both systems: Lights and ElectricEquipment carry \ip-units W in the IDD
  const note = (s: string | null | undefined): string => (s ? siNoteAtEye(s, p.imperial) : "no row");
  // the activity level: W/person in SI, Btu/h per person under imperial (the IDD's default IP for W/person)
  const actIn = (w: number): number => Number((p.imperial ? w * W_TO_BTUH : w).toFixed(1)), actOut = (v: number): number => Number((p.imperial ? v / W_TO_BTUH : v).toPrecision(6));
  const schedRow = (role: BemScheduleRow["role"]): BemScheduleRow | undefined => p.schedules.find((s) => s.role === role);
  const subjectWord = p.space ? `${p.space}` : p.zone ? `${p.zone.name} · ${p.zone.rooms.length} room${p.zone.rooms.length === 1 ? "" : "s"} — the zone's settings, every room takes them` : null;
  const staged = key && p.stage[bucket]?.[key] ? <span className="src-user"> · staged — Apply in the column</span> : null;
  const src = (s: string): string => srcClass(s as "user");

  const occupancy = (): React.ReactElement => {
    const total = rows.reduce((t, r) => t + r.people, 0), s = rows[0]?.peopleSource ?? "code-default";
    const sr = schedRow("occupancy");
    return (
      <div className="zfPanel">
        <div>people: <b className={src(s)}>{total.toFixed(2)}</b> {p.space ? <span className="muted">— {note(rows[0]?.peopleNote)}</span> : <span className="muted">— over {rows.length} rooms{rows.length ? `: ${rows.map((r) => `${r.room} ${r.people.toFixed(2)}`).join(", ")}` : ""}</span>}</div>
        <div className="zfRow">
          <label>people <NumInput className={srcClass(rule.people?.count !== undefined ? "user" : "dataset")} value={rule.people?.count ?? null} placeholder={total.toFixed(2)} onValue={(v) => setRule((r) => ({ ...r, people: { ...r.people, count: v ?? undefined, none: undefined } }))} digits={2} min={0} /></label>
          <label><input type="checkbox" checked={!!rule.people?.none} onChange={(e) => setRule((r) => ({ ...r, people: e.target.checked ? { none: true } : {} }))} /> none</label>
          <label>activity <NumInput className={srcClass(rule.people?.activityW !== undefined ? "user" : "dataset")} value={actIn(rule.people?.activityW ?? RESIDENTIAL_EXAMPLE.people.activityW)} onValue={(v) => setRule((r) => ({ ...r, people: { ...r.people, activityW: v === null ? undefined : actOut(v) } }))} digits={1} min={0} /> {p.imperial ? "Btu/h per person" : "W/person"}</label>
          <span className="muted">{p.space ? "this room's ruling" : "the zone's count, spread over its rooms by floor area"}{staged}</span>
        </div>
        <div className="muted">the default: {BAHSP_2014.citation} — the house's bedrooms by name, spread over the conditioned rooms by floor area; the activity level the example's activity_sch ({p.imperial ? `${(RESIDENTIAL_EXAMPLE.people.activityW * W_TO_BTUH).toFixed(0)} Btu/h` : `${RESIDENTIAL_EXAMPLE.people.activityW} W`} per person, ASHRAE 2009 per the protocols); fraction radiant {RESIDENTIAL_EXAMPLE.people.fractionRadiant}</div>
        <div className="muted">schedule: <span className={src(sr?.source ?? "code-default")}>{rows[0]?.schedules.occupancy ?? sr?.name ?? "—"}</span> {sr ? `· ${sr.note}` : ""} — picked in SCHEDULES › occupancy</div>
      </div>
    );
  };
  const envelope = (): React.ReactElement => {
    const surf = subjectRooms.flatMap(p.surfacesOf), sum = spaceSummary(surf);
    const byBearing = new Map<string, { areaM2: number; openings: number; openingM2: number }>();
    for (const r of surf) if (r.kind === "wall" && r.side === "Ext") { const k = r.orient?.label ?? "—"; const g = byBearing.get(k) ?? { areaM2: 0, openings: 0, openingM2: 0 }; g.areaM2 += r.areaM2; g.openings += r.openings; g.openingM2 += r.openingM2; byBearing.set(k, g); }
    const items = surf.flatMap((r) => r.items), win = items.filter((i) => i.kind === "window"), door = items.filter((i) => i.kind === "door");
    const floorFacing = [...new Set(surf.filter((r) => r.kind === "floor").map((r) => r.facing))].join(", ");
    return (
      <div className="zfPanel">
        <div className="zfRow">
          <span>floor <b>{p.fmtA(sum.floorM2)}</b>{floorFacing ? <span className="muted"> on {floorFacing}</span> : null}</span>
          <span>exterior walls <b>{p.fmtA(sum.extWallM2)}</b>{byBearing.size ? <span className="muted"> — {[...byBearing].map(([k, g]) => `${k} ${p.fmtA(g.areaM2)}${g.openings ? ` (${g.openings} openings)` : ""}`).join(" · ")}</span> : null}</span>
          <span>windows <b>{win.length}</b> · {p.fmtA(win.reduce((t, i) => t + i.areaM2, 0))}</span>
          <span>doors <b>{door.length}</b> · {p.fmtA(door.reduce((t, i) => t + i.areaM2, 0))}</span>
          <span>roof <b>{p.fmtA(sum.roofM2)}</b> · ceiling <b>{p.fmtA(sum.ceilingM2)}</b> · interior walls <b>{p.fmtA(sum.intWallM2)}</b></span>
        </div>
        {p.space ? <SpaceTableView rows={surf} summary={sum} fmtA={p.fmtA} {...p.table} /> : <div className="muted">the sums over {subjectRooms.length} rooms — pick a room for its surfaces one by one</div>}
      </div>
    );
  };
  const lighting = (): React.ReactElement => {
    const fx = subjectRooms.flatMap(p.fixturesOf), stated = fx.filter((e) => (e.wattageW ?? e.powerW) !== null), fxW = stated.reduce((t, e) => t + (e.wattageW ?? e.powerW ?? 0), 0);
    const kinds = [...fx.reduce((m, e) => m.set(e.kind, (m.get(e.kind) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((t, r) => t + r.lightsW, 0), s = rows[0]?.lightsSource ?? "code-default";
    const sr = schedRow("lighting");
    return (
      <div className="zfPanel">
        <div>lights: <b className={src(s)}>{W(total)}</b> {p.space ? <span className="muted">— {note(rows[0]?.lightsNote)}</span> : <span className="muted">— over {rows.length} rooms{rows.length ? `: ${rows.map((r) => `${r.room} ${W(r.lightsW)}`).join(", ")}` : ""}</span>}</div>
        <div className="muted">the file: <span className="src-file">{fx.length} fixture{fx.length === 1 ? "" : "s"}, {stated.length} state a wattage: {W(fxW)}</span>{kinds.length ? ` — ${kinds.slice(0, 6).map(([k, n]) => `${n} × ${k}`).join(", ")}${kinds.length > 6 ? " …" : ""}` : ""}</div>
        <div className="zfRow">
          <label>W <NumInput className={srcClass(rule.lights?.wattsW !== undefined ? "user" : "dataset")} value={rule.lights?.wattsW ?? null} placeholder={total.toFixed(0)} onValue={(v) => setRule((r) => ({ ...r, lights: { ...r.lights, wattsW: v ?? undefined, none: undefined, fixtures: undefined } }))} digits={0} min={0} /></label>
          <button className="chip" disabled={!!rule.lights?.fixtures} onClick={() => setRule((r) => ({ ...r, lights: { fixtures: true } }))} title="rule the file's fixtures' stated wattage, even where none is stated (0 W)">the file's fixtures</button>
          <label><input type="checkbox" checked={!!rule.lights?.none} onChange={(e) => setRule((r) => ({ ...r, lights: e.target.checked ? { none: true } : {} }))} /> none</label>
          {(rule.lights?.wattsW !== undefined || rule.lights?.fixtures || rule.lights?.none) && <button className="chip" onClick={() => setRule((r) => ({ ...r, lights: {} }))}>the default</button>}
          <span className="muted">{p.space ? "this room's ruling" : "the zone's W, spread over its rooms by floor area"}{staged}</span>
        </div>
        <div className="muted">the default: the file's fixtures where a wattage is stated, else the example's {p.imperial ? `${(RESIDENTIAL_EXAMPLE.lights.hardwiredWm2 / FT2_PER_M2).toFixed(4)} + ${(RESIDENTIAL_EXAMPLE.lights.plugInWm2 / FT2_PER_M2).toFixed(4)} W/ft²` : `${RESIDENTIAL_EXAMPLE.lights.hardwiredWm2.toFixed(3)} + ${RESIDENTIAL_EXAMPLE.lights.plugInWm2.toFixed(3)} W/m²`} ({RESIDENTIAL_EXAMPLE.citation}); radiant {RESIDENTIAL_EXAMPLE.lights.radiant} · visible {RESIDENTIAL_EXAMPLE.lights.visible} · return air {RESIDENTIAL_EXAMPLE.lights.returnAir}</div>
        <div className="muted">schedule: <span className={src(sr?.source ?? "code-default")}>{rows[0]?.schedules.lighting ?? sr?.name ?? "—"}</span> {sr ? `· ${sr.note}` : ""} — picked in SCHEDULES › lighting</div>
      </div>
    );
  };
  const loads = (): React.ReactElement => {
    // the rows as written, merged by id over the subject's rooms
    const merged = new Map<string, { id: string; name: string; group?: EquipmentGroup; wattsW: number; subcategory: string; schedule: string; latent: number; radiant: number; lost: number; source: string; note: string }>();
    for (const r of rows) for (const e of r.equipment) { const m = merged.get(e.id); if (m) m.wattsW += e.wattsW; else merged.set(e.id, { ...e }); }
    const list = [...merged.values()];
    const total = list.reduce((t, e) => t + e.wattsW, 0);
    const ruled = (id: string): GainEquipmentRow | undefined => rule.equipment?.find((x) => x.id === id);
    const setRow = (id: string, fn: (x: GainEquipmentRow | undefined) => GainEquipmentRow | undefined): void => setRule((r) => {
      const others = (r.equipment ?? []).filter((x) => x.id !== id); const next = fn(r.equipment?.find((x) => x.id === id));
      return { ...r, equipment: next ? [...others, next] : others };
    });
    const example = (id: string) => RESIDENTIAL_EXAMPLE.equipment.find((e) => e.id === id);
    const off = (id: string): boolean => ruled(id)?.enabled === false;
    const userRows = (rule.equipment ?? []).filter((x) => !merged.has(x.id) && !example(x.id));
    const sr = schedRow("equipment");
    return (
      <div className="zfPanel">
        <div>loads: <b className={src(rows[0]?.equipmentSource ?? "code-default")}>{W(total)}</b> <span className="muted">— {list.length} rows as written{p.space ? "" : ` over ${rows.length} rooms`}; the example's rows placed by the file's dishwasher and dryer, its plug loads by floor share ({RESIDENTIAL_EXAMPLE.citation}); {RESIDENTIAL_EXAMPLE.omitted}</span>{staged}</div>
        <table className="zfTable">
          <thead><tr><th></th><th>load</th><th className="num" title="electrical watts in both systems — the IDD's own IP unit for an equipment level is W">W</th><th>subcategory</th><th>schedule</th><th className="num">latent</th><th className="num">radiant</th><th className="num">lost</th><th>source</th></tr></thead>
          <tbody>
            {EQUIPMENT_GROUPS.map((g) => {
              const mine = list.filter((e) => (e.group ?? groupOfRow(e)) === g.id), yours = userRows.filter((u) => groupOfRow(u) === g.id);
              const gw = mine.reduce((t, e) => t + (off(e.id) ? 0 : e.wattsW), 0) + yours.reduce((t, u) => t + (u.enabled ? u.wattsW ?? 0 : 0), 0);
              const gs = g.id === "other" ? sr : schedRow(g.id);
              const add = (): void => { const id = `${g.id}-${Date.now().toString(36)}`; setRow(id, () => ({ id, name: g.newName, subcategory: g.subcategory, group: g.id, wattsW: g.id === "other" ? 100 : 0, enabled: true })); };
              return [
                <tr key={`g-${g.id}`} className="zfGroup">
                  <td colSpan={9}><b>{g.label}</b> <span className="muted">— {g.items} · {W(gw)} · schedule: {gs && gs.source !== "code-default" ? <span className={src(gs.source)}>{gs.name}</span> : g.id === "other" ? "the example's MiscPlugLoad" : "the rows' own (SCHEDULES › " + g.label.toLowerCase() + " not ruled)"}</span>
                    {" "}<button className="chip" disabled={!key} onClick={add} title={`add a ${g.label.toLowerCase()} load to this ${p.space ? "room" : "zone"}`}>add…</button></td>
                </tr>,
                ...mine.map((e) => {
                const o = ruled(e.id), ex = example(e.id);
                return (
                  <tr key={e.id} className={off(e.id) ? "off" : ""}>
                    <td><input type="checkbox" checked={!off(e.id)} title="off: the row is not written for this subject" onChange={(ev) => setRow(e.id, (x) => (ev.target.checked ? (x && (x.wattsW !== undefined || x.wm2 !== undefined) ? { ...x, enabled: true } : undefined) : { id: e.id, name: e.name, subcategory: e.subcategory, enabled: false, ...(x?.wattsW !== undefined ? { wattsW: x.wattsW } : {}) }))} /></td>
                    <td>{e.name}</td>
                    <td className="num"><NumInput className={srcClass(o?.wattsW !== undefined ? "user" : e.source as "user")} value={o?.wattsW ?? null} placeholder={e.wattsW.toFixed(1)} onValue={(v) => setRow(e.id, (x) => (v === null ? (x?.enabled === false ? x : undefined) : { id: e.id, name: e.name, subcategory: e.subcategory, enabled: true, ...x, wattsW: v }))} digits={1} min={0} /></td>
                    <td>{e.subcategory}</td>
                    <td>{e.schedule}</td>
                    <td className="num">{e.latent}</td><td className="num">{e.radiant}</td><td className="num">{e.lost}</td>
                    <td className={src(e.source)} title={note(e.note)}>{o ? "ruled" : ex ? "the example" : e.source}</td>
                  </tr>
                );
                }),
                ...yours.map((u) => (
                <tr key={u.id}>
                  <td><input type="checkbox" checked={u.enabled} onChange={(ev) => setRow(u.id, (x) => (x ? { ...x, enabled: ev.target.checked } : x))} /></td>
                  <td><input type="text" className="asmName" value={u.name} onChange={(ev) => setRow(u.id, (x) => (x ? { ...x, name: ev.target.value } : x))} /></td>
                  <td className="num"><NumInput className="src-user" value={u.wattsW ?? null} onValue={(v) => setRow(u.id, (x) => (x ? { ...x, wattsW: v ?? undefined } : x))} digits={1} min={0} /></td>
                  <td><input type="text" className="asmName" value={u.subcategory} onChange={(ev) => setRow(u.id, (x) => (x ? { ...x, subcategory: ev.target.value } : x))} /></td>
                  <td className="muted">{gs && gs.source !== "code-default" ? gs.name : sr && sr.source !== "code-default" ? sr.name : "MiscPlugLoad (the example's)"}</td>
                  <td className="num">{u.latent ?? 0.06}</td><td className="num">{u.radiant ?? 0.69}</td><td className="num">{u.lost ?? 0.25}</td>
                  <td className="src-user">yours · <button className="chip" onClick={() => setRow(u.id, () => undefined)}>×</button> {p.space ? "" : "(the W spread over the zone's rooms by floor area)"}</td>
                </tr>
                )),
                ...(mine.length || yours.length ? [] : [
                  <tr key={`n-${g.id}`} className="off">
                    <td></td><td>{g.newName}</td>
                    <td className="num"><NumInput className="src-code-default" value={null} placeholder="type W" onValue={(v) => { if (v === null || !key) return; const id = `${g.id}-${Date.now().toString(36)}`; setRow(id, () => ({ id, name: g.newName, subcategory: g.subcategory, group: g.id, wattsW: v, enabled: true })); }} digits={1} min={0} /></td>
                    <td colSpan={6} className="muted">no example value — the engine's single-family example has no {g.label.toLowerCase()} row{g.id === "entertainment" ? " (its television is 0 W)" : ""}; type W to add one{p.space ? "" : " (spread over the zone's rooms by floor area)"}</td>
                  </tr>]),
              ];
            })}
          </tbody>
        </table>
        <div className="zfRow">
          <span className="muted">each group's rows run on its SCHEDULES role when ruled, else the equipment role{sr && sr.source !== "code-default" ? ` (ruled: ${sr.name})` : ""}, else the example's own profile — a typed row takes the misc plug loads' fractions and MiscPlugLoad; charging meters to its own end use (RUN › Car charging)</span>
        </div>
      </div>
    );
  };
  return (
    <div className="asmBench zoneFrame">
      <div className="asmRail">
        {FRAME_TABS.map((t) => <button key={t} className={`asmRailBtn${p.tab === t ? " on" : ""}`} style={{ borderLeftColor: RAIL_COLOR[t] }} onClick={() => p.onTab(t)}>{t}</button>)}
      </div>
      <div className="asmShelf">
        {!key ? <div className="muted">pick a zone in the column, or a room — in the tree, under a zone's card, or in the model — to read it here</div>
          : <>
              <div className="asmShelfHead"><b>{p.tab}</b> <span className="muted">· {subjectWord}</span></div>
              {p.tab === "OCCUPANCY" ? occupancy() : p.tab === "ENVELOPE" ? envelope() : p.tab === "LIGHTING" ? lighting() : loads()}
            </>}
      </div>
    </div>
  );
}
