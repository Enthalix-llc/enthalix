// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SPACE TABLE (user, 2026-09-04): one room's surfaces — floor, walls by bearing, ceiling, roof — each the sum of the
// stored cells bounding it, with the openings they carry and, when a run exists, the annual conduction; a row lights its
// cells and their element, an opening row its window or door and its hole, the glazing checkbox is the user's ruling.
// One component since 2026-09-13, read by the BIM inspector and by the ZONES frame's ENVELOPE rail alike.

import { Fragment } from "react";
import type { SpaceSurface, SpaceSummary } from "../modules/bim/spaceTable.js";

export interface Hi { rows: Set<number>; elements: Set<number>; loop: Array<[number, number, number]> | null }
export interface SpaceTableProps {
  rows: SpaceSurface[]; summary: SpaceSummary;
  hi: Hi | null; onHi: (next: Hi | null | ((h: Hi | null) => Hi | null)) => void;
  selRow: number | null; selElementId: number | null;
  /** the run, when one exists: the surfaces as emitted and their annual conduction by emitted name */
  bem: { surfaces: Array<{ idfSurfaceId: number | null; epName: string }>; surfaceConduction: Map<string, number> } | null;
  fmtA: (m2: number) => string;
  onRuleGlazing: (globalId: string, on: boolean) => void;
}

export function SpaceTableView(p: SpaceTableProps): React.ReactElement {
  const { hi, bem, summary } = p;
  return (
    <table className="spaceTable">
      <thead><tr><th>surface</th><th className="num">net</th><th>type (the file)</th><th>facing</th><th className="num">openings</th><th className="num">cells</th>{bem && <th className="num">kWh/yr</th>}</tr></thead>
      <tbody>
        {p.rows.map((r, i) => {
          const on = (hi !== null && hi.loop === null && r.rowIds.some((id) => hi.rows.has(id)))
            || (hi === null && p.selRow !== null && r.rowIds.includes(p.selRow));
          const cond = bem
            ? r.rowIds.reduce((t, id) => t + bem.surfaces.filter((x) => x.idfSurfaceId === id).reduce((u, x) => u + (bem.surfaceConduction.get(x.epName.toUpperCase()) ?? 0), 0), 0)
            : null;
          const items = [...r.items].sort((a, b) => a.kind.localeCompare(b.kind) || b.areaM2 - a.areaM2);
          return (
            <Fragment key={i}>
              <tr className={on ? "sel" : ""} title="click: outline these cells and light their element in the IFC view"
                onClick={() => p.onHi((h) => (h && h.loop === null && r.rowIds.every((id) => h.rows.has(id)) ? null : { rows: new Set(r.rowIds), elements: new Set(r.elementIds), loop: null }))}>
                <td>{r.kind} · <span className={r.side === "Ext" ? "ext" : "int"}>{r.side}</span>{r.orient ? ` · ${r.orient.label}${r.orient.deg !== null ? ` ${r.orient.deg}°` : ""}` : ""}</td>
                <td className="num">{p.fmtA(r.areaM2)}</td>
                <td className="type" title={r.elementIds.map((id) => `#${id}`).join(" ")}>{r.types.join(" · ")}</td>
                <td>{r.facing}</td>
                <td className="num">{r.openings ? `${r.openings} · ${p.fmtA(r.openingM2)}` : ""}</td>
                <td className="num">{r.cells}</td>
                {bem && <td className="num">{cond !== null && Math.abs(cond) >= 0.5 ? cond.toFixed(0) : ""}</td>}
              </tr>
              {items.map((it, j) => {
                const src = it.glazedSource;
                const why = it.globalId === null ? "no element matched — nothing to rule on"
                  : src === "user" ? "glazing: your ruling · click to change"
                  : src === "file" ? "glazing: stated by the file"
                  : `glazing: ${it.glazed ? "by the type name" : "no word in the file or the type name"} — a default; click to rule`;
                const isOn = hi !== null ? hi.loop === it.ring : (p.selElementId !== null && it.elementId !== null && it.elementId === p.selElementId);
                return (
                <tr key={`${i}-${j}`} className={`sub${isOn ? " sel" : ""}`} title="click: light this window or door and outline its hole"
                  ref={(el) => { if (isOn && hi === null) el?.scrollIntoView({ block: "nearest" }); }}
                  onClick={() => p.onHi(it.rowId !== null ? { rows: new Set([it.rowId]), elements: new Set(it.elementId !== null ? [it.elementId] : r.elementIds), loop: it.ring } : null)}>
                  <td>
                    <input type="checkbox" checked={it.glazed === true} disabled={it.globalId === null} title={why}
                      onClick={(e) => e.stopPropagation()} onChange={(e) => { if (it.globalId) p.onRuleGlazing(it.globalId, e.target.checked); }} />
                    {it.glazed ? <span className={src === "user" ? "src-user" : src === "default" ? "src-code" : "src-file"}>glazing: </span> : null}
                    {it.kind}{it.label ? ` · ${it.label}` : ""}
                  </td>
                  <td className="num">{p.fmtA(it.areaM2)}</td>
                  <td></td>
                  <td>{it.elementId !== null ? `#${it.elementId}${it.fit === "notch" ? " · notch" : it.fit === "clear" ? " · not cut" : ""}` : "no element matched"}</td>
                  <td></td><td></td>
                  {bem && <td />}
                </tr>
                );
              })}
            </Fragment>
          );
        })}
        <tr className="sum">
          <td>floor {p.fmtA(summary.floorM2)}</td>
          <td colSpan={2}>walls ext {p.fmtA(summary.extWallM2)} · int {p.fmtA(summary.intWallM2)}</td>
          <td className="num">ceiling {p.fmtA(summary.ceilingM2)} · roof {p.fmtA(summary.roofM2)}</td>
          <td className="num">{summary.openings ? `${summary.openings} · ${p.fmtA(summary.openingM2)}` : ""}</td>
          <td className="num">{summary.cells}</td>
          {bem && <td />}
        </tr>
      </tbody>
    </table>
  );
}
