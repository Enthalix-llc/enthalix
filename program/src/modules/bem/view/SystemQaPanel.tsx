// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SYSTEM QA PANEL (user, 2026-09-11: "a QA approach that identifies missing elements"). The rows are READ BACK from
// bem.db's system_qa — the QA of the IDF as written, one row per loop, air loop and zone, the eight rules of the report's
// §4 each with a verdict — and the gaps are printed in words under the table, the way the wall QA prints its boundaries.
// Nothing here repairs anything; a gap names what is missing and where.

import { useState } from "react";
import { QA_RULES, type SystemQaRow } from "../core/systemQa.js";
import type { CompiledAssembly } from "../core/assembly.js";
import type { BemModelOutcome } from "../pipeline.js";

/** THE QA ON THE CARD (user, 2026-09-13: "expose the QA results in a user readable fashion"): each card's rows, read back onto
 *  it — a system's or a ring member's through its ruling's emitted objects (the AirLoopHVAC or the loop object among the row's
 *  object names), a Zone's through its emitted name. Nothing is derived: the rows are bem.db's, the names the writer's. */
export function qaRowsByNode(compiled: CompiledAssembly, model: BemModelOutcome | null): Map<string, SystemQaRow[]> {
  const out = new Map<string, SystemQaRow[]>();
  if (!model) return out;
  const rows = model.systemQa;
  const byRuling = new Map<string, SystemQaRow[]>();
  for (const s of model.systems) {
    const names = new Set(s.objectNames);
    const mine = rows.filter((r) => r.kind !== "zone" && r.kind !== "zones" && r.kind !== "loose" && r.kind !== "ideal loads" && names.has(r.subject));
    if (mine.length) byRuling.set(s.id, mine);
  }
  for (const [node, rid] of Object.entries(compiled.rulingIds)) { const m = byRuling.get(rid); if (m) out.set(node, m); }
  // a card written as one unit per thermostat (2026-09-13) carries every unit's rows
  for (const [node, ids] of Object.entries(compiled.splitIds ?? {})) { const m = ids.flatMap((rid) => byRuling.get(rid) ?? []); if (m.length) out.set(node, m); }
  const ep = new Map(model.zones.map((z) => [z.name, z.epName]));
  for (const z of compiled.zones) { const e = ep.get(z.name) ?? z.name; const m = rows.filter((r) => r.kind === "zone" && r.subject === e); if (m.length) out.set(z.id, m); }
  return out;
}

/** the eight rules in two words each, for the legend under the table (the full words are QA_RULES, on hover) */
const QA_SHORT: Record<number, string> = { 1: "pump on supply", 2: "nodes joined", 3: "both sides fed", 4: "sides right", 5: "air paths", 6: "zone equipment", 7: "controls set", 8: "sizing once" };

const read = (k: string, d: boolean): boolean => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
const write = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* view state */ } };

export function SystemQaPanel(p: { rows: SystemQaRow[]; byNode?: Map<string, SystemQaRow[]>; onSelect?: (id: string | null) => void }): React.ReactElement | null {
  const [open, setOpen] = useState(() => read("bim-sys-qa", true));
  const rows = p.rows;
  // a row selects its card on the sheet (2026-09-13)
  const cardOf = (r: SystemQaRow): string | null => { for (const [id, rs] of p.byNode ?? []) if (rs.includes(r)) return id; return null; };
  const gaps = rows.reduce((t, r) => t + r.gaps, 0);
  const subjects = rows.filter((r) => r.kind !== "zones" && r.kind !== "loose").length;
  const rules = [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <>
      <button className={`qaBtn sec${open ? " on" : ""}`} onClick={() => { setOpen(!open); write("bim-sys-qa", !open); }} disabled={rows.length === 0} title={`the eight rules a custom system must satisfy before the engine runs it (references/energyplus-systems-modelling.md §4), read from the IDF as written:\n${rules.map((r) => `${r} · ${QA_RULES[r]}`).join("\n")}`}>
        system QA {rows.length === 0 ? "(no rows yet)" : gaps ? <span className="bad">({gaps} gap{gaps === 1 ? "" : "s"} on {rows.filter((r) => r.gaps).length} of {subjects})</span> : <span className="ok">(sound · {subjects})</span>}
      </button>
      {open && rows.length > 0 && (
        <div className="qaPanel sysQa">
          {/* HOW TO READ IT (2026-09-14, the user asked): the rows are the SAVED model's IDF checked against the eight rules a custom system must
              satisfy before the engine runs it — one row per fluid loop, air loop and zone on real equipment; ✓ the rule holds, ✗ what is missing
              (in words under the table), – the rule does not apply to that row. Nothing here repairs: a gap is fixed on the sheet, then Save. */}
          <div className="qaHow">the saved model's IDF, one row per loop, air loop and zone, against eight rules — <span className="ok">✓</span> holds · <span className="bad">✗</span> what is missing, written out below · <span className="muted">–</span> not applicable. A gap is fixed on the sheet (a Pump card into a ring, a line to a Zone…), then Save; a row selects its card.</div>
          <table>
            <thead><tr><th>subject</th><th>kind</th>{rules.map((r) => <th key={r} title={QA_RULES[r]}>{r}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}:${r.subject}`} className={cardOf(r) ? "clickable" : undefined} onClick={() => { const id = cardOf(r); if (id && p.onSelect) p.onSelect(id); }} title={cardOf(r) ? "select its card on the sheet" : undefined}>
                  <td title={r.cls}>{r.subject}</td>
                  <td className="muted">{r.kind}</td>
                  {rules.map((n) => {
                    const c = r.checks.find((x) => x.rule === n);
                    const v = c?.verdict ?? "n/a";
                    return <td key={n} className={v === "gap" ? "bad" : v === "ok" ? "ok" : "muted"} title={c ? `${n} · ${QA_RULES[n]}\n${c.text}` : QA_RULES[n]}>{v === "ok" ? "✓" : v === "gap" ? "✗" : "–"}</td>;
                  })}
                </tr>
              ))}
              {gaps > 0 && rows.flatMap((r) => r.checks.filter((c) => c.verdict === "gap").map((c) => (
                <tr key={`${r.kind}:${r.subject}:${c.rule}`}><td colSpan={10} className="wrap"><b>{r.subject}</b> <span className="muted">· rule {c.rule}, {QA_RULES[c.rule]}:</span> {c.text}</td></tr>
              )))}
            </tbody>
          </table>
          <div className="qaHow muted">{rules.map((r) => `${r} ${QA_SHORT[r]}`).join(" · ")}</div>
        </div>
      )}
    </>
  );
}
