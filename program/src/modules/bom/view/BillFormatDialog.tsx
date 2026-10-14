// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BILL FORMAT (user, 2026-10-09: "We need a dialog to give the user flexibility in defining the monthly bills"). What a utility's bill
// holds, as the user reads it off paper: the utility, the rate schedule, the service; the usage rows (Consumption · Generation · Net — renamed,
// with a kW or not); the charge groups in order and, in each, its lines — a label, how it is figured (a $ a month · a rate per kWh or per kW
// of a usage row · an amount typed, as a tax is) and what carries to the next month (the rate, or the amount as an estimate). A default
// layout is the preset. A change applies to new bills; a bill already typed keeps its lines and gains the new ones empty (core/statement.ts withFormat).

import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_BILL_FORMAT, BASIS_WORDS, ROLE_WORDS, type BillFormat, type LineBasis, type LineDef, type UsageRole } from "../core/statement.js";

let seq = 0;
const nid = (p: string): string => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const move = <T,>(xs: T[], i: number, d: number): T[] => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const out = [...xs]; [out[i], out[j]] = [out[j]!, out[i]!]; return out; };

export function BillFormatDialog({ format, onSave, onCancel }: { format: BillFormat; onSave: (f: BillFormat) => void; onCancel: () => void }): ReactNode {
  const [f, setF] = useState<BillFormat>(() => structuredClone(format));
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") onCancel(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onCancel]);
  const setGroup = (gi: number, patch: Partial<BillFormat["groups"][number]>): void => setF({ ...f, groups: f.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setLine = (gi: number, li: number, patch: Partial<LineDef>): void => setGroup(gi, { lines: f.groups[gi]!.lines.map((l, i) => (i === li ? { ...l, ...patch } : l)) });
  return (
    <div className="menuScrim dialogScrim" onPointerDown={onCancel}>
      <div className="dialog billFormat" role="dialog" aria-label="the bill format" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">the bill format — what each month's bill holds (a change applies to new bills; a bill typed keeps its lines and gains new ones empty)</div>
        <table className="fmtTable"><tbody>
          <tr><td>utility</td><td><input type="text" value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value })} /></td>
            <td>rate schedule</td><td><input type="text" value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} /></td>
            <td>service</td><td><input type="text" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></td></tr>
        </tbody></table>
        <div className="stmtGroupHead">usage rows</div>
        <table className="fmtTable"><tbody>
          {f.usage.map((u, i) => (
            <tr key={u.role} title={ROLE_WORDS[u.role]}>
              <td className="muted">{u.role}</td>
              <td><input type="text" value={u.label} onChange={(e) => setF({ ...f, usage: f.usage.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} /></td>
              <td><label><input type="checkbox" checked={u.kw} onChange={(e) => setF({ ...f, usage: f.usage.map((x, k) => (k === i ? { ...x, kw: e.target.checked } : x)) })} /> states kW</label></td>
              <td className="muted">{ROLE_WORDS[u.role]}</td>
            </tr>
          ))}
        </tbody></table>
        <div className="stmtGroupHead">detail of charges</div>
        {f.groups.map((g, gi) => (
          <div key={g.id} className="fmtGroup">
            <div className="allRow">
              <input type="text" className="q" value={g.label} onChange={(e) => setGroup(gi, { label: e.target.value })} title="the group's heading as the bill prints it" />
              <button className="qaBtn" onClick={() => setF({ ...f, groups: move(f.groups, gi, -1) })} disabled={gi === 0}>↑</button>
              <button className="qaBtn" onClick={() => setF({ ...f, groups: move(f.groups, gi, 1) })} disabled={gi === f.groups.length - 1}>↓</button>
              <button className="qaBtn" onClick={() => setGroup(gi, { lines: [...g.lines, { id: nid("line"), label: "new line", basis: "amount", carry: "amount" }] })}>+ line</button>
              <button className="qaBtn bad" onClick={() => setF({ ...f, groups: f.groups.filter((_, i) => i !== gi) })} title="remove the group and its lines from the format">remove group</button>
            </div>
            <table className="fmtTable"><tbody>
              {g.lines.map((l, li) => (
                <tr key={l.id}>
                  <td><input type="text" value={l.label} onChange={(e) => setLine(gi, li, { label: e.target.value })} /></td>
                  <td><select value={l.basis} onChange={(e) => { const b = e.target.value as LineBasis; setLine(gi, li, { basis: b, carry: b === "amount" ? "amount" : "rate", ...(b === "per-kwh" || b === "per-kw" ? { of: l.of ?? "net" } : {}) }); }}>
                    {(Object.keys(BASIS_WORDS) as LineBasis[]).map((b) => <option key={b} value={b}>{BASIS_WORDS[b]}</option>)}
                  </select></td>
                  <td>{(l.basis === "per-kwh" || l.basis === "per-kw") && <select value={l.of ?? "net"} onChange={(e) => setLine(gi, li, { of: e.target.value as UsageRole })} title="the usage row it is figured on">
                    {f.usage.map((u) => <option key={u.role} value={u.role}>of {u.label}</option>)}
                  </select>}</td>
                  <td><select value={l.carry} onChange={(e) => setLine(gi, li, { carry: e.target.value as "rate" | "amount" })} title="what the next month's bill starts from">
                    <option value="rate">carry the rate</option><option value="amount">estimate the amount</option>
                  </select></td>
                  <td>{l.basis === "per-kwh" && <label title="the power cost adjustment: its rate prices the model's month too"><input type="checkbox" checked={!!l.pca} onChange={(e) => setLine(gi, li, { pca: e.target.checked || undefined })} /> PCA</label>}</td>
                  <td><button className="qaBtn" onClick={() => setGroup(gi, { lines: move(g.lines, li, -1) })} disabled={li === 0}>↑</button>
                    <button className="qaBtn" onClick={() => setGroup(gi, { lines: move(g.lines, li, 1) })} disabled={li === g.lines.length - 1}>↓</button>
                    <button className="qaBtn bad" onClick={() => setGroup(gi, { lines: g.lines.filter((_, i) => i !== li) })}>×</button></td>
                </tr>
              ))}
              {g.lines.length === 0 && <tr><td className="muted" colSpan={6}>no lines — "+ line" adds one (a credit is a negative amount)</td></tr>}
            </tbody></table>
          </div>
        ))}
        <div className="allRow">
          <button className="qaBtn" onClick={() => setF({ ...f, groups: [...f.groups, { id: nid("group"), label: "new group", lines: [] }] })}>+ group</button>
          <button className="qaBtn" onClick={() => setF({ ...structuredClone(DEFAULT_BILL_FORMAT), id: f.id })} title="put back the default bill layout">Default layout</button>
          <span style={{ flex: 1 }} />
          <button className="apply" onClick={() => onSave(f)}>Save format</button>
          <button className="qaBtn" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
