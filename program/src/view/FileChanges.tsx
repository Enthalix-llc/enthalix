// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE FILE CHANGED — the panel (2026-09-09). Opened on load when the file's
 * hash has no ledger but the previous ifc.db's rulings fit this building
 * (core/ifcChanges.ts): the file's changes named one by one, and every
 * ruling with its verdict — carried, changed (the user's choice per row:
 * keep my ruling · take the file's), gone. A panel in the editing column,
 * never over the view: a changed element is clickable and lights in the
 * views, so the choice is made looking at it.
 */
import type { ReactElement } from "react";
import type { FileDiff, RulingCase, CarryRecord } from "../core/ifcChanges.js";

export interface FileChangesProps {
  prevName: string; prevSha: string; nextSha: string; prevAt: string;
  diff: FileDiff; cases: RulingCase[]; record: CarryRecord;
  /** case ids the user chose to take the file's word on (the ruling dropped) */
  take: Set<string>;
  /** the choices as they stand differ from what the ledger carries */
  pending: boolean;
  busy: boolean;
  onTake: (id: string, take: boolean) => void;
  onApply: () => void;
  onDismiss: () => void;
  onSelect: (elementId: number | null) => void;
}

const VERDICT: Record<RulingCase["verdict"], string> = { carried: "carried", changed: "the file changed it", gone: "gone from the file" };

export function FileChanges(p: FileChangesProps): ReactElement {
  const els = p.diff.changes.filter((c) => c.what === "element"), types = p.diff.changes.filter((c) => c.what === "type"), rooms = p.diff.changes.filter((c) => c.what === "space");
  const changed = p.cases.filter((c) => c.verdict === "changed"), gone = p.cases.filter((c) => c.verdict === "gone"), carried = p.cases.filter((c) => c.verdict === "carried");
  const n = (kind: "added" | "removed" | "changed", list: typeof els): number => list.filter((c) => c.kind === kind).length;
  return (
    <div className="qaPanel steps changes">
      <p>
        <b>The file changed.</b> This is <code>{p.nextSha.slice(0, 12)}</code>; your rulings were made on <code>{p.prevSha.slice(0, 12)}</code> ({p.prevName}, saved {p.prevAt.slice(0, 16).replace("T", " ")}).
        The previous ifc.db is the original for accounting; nothing in it was altered. By GlobalId the two files share {(100 * p.diff.overlap).toFixed(1)} % of their elements:
        {" "}{p.diff.unchanged} unchanged · {n("removed", els)} removed · {n("added", els)} added · {n("changed", els)} changed; types changed {n("changed", types)}; rooms changed {n("changed", rooms)}.
        Every ruling whose subject is unchanged came over ({carried.length}); a ruling the file changed under is yours to keep or to overwrite with the file's word, below; a ruling whose subject is gone was dropped and is named.
      </p>
      {p.diff.changes.length > 0 && (
        <table>
          <thead><tr><th>change</th><th className="wrap">in the file</th><th className="wrap">what moved</th></tr></thead>
          <tbody>
            {p.diff.changes.map((c) => (
              <tr key={`${c.what}:${c.key}`} className={c.nextId !== null && c.what === "element" ? "clickable" : ""} onClick={() => { if (c.what === "element" && c.nextId !== null) p.onSelect(c.nextId); }} title={c.what === "element" && c.nextId !== null ? "select it in the views" : undefined}>
                <td className={c.kind === "removed" ? "bad" : c.kind === "added" ? "src-user" : "warn"}>{c.kind} {c.what}</td>
                <td className="wrap">{c.label}</td>
                <td className="wrap muted">{c.diffs.join("; ") || (c.kind === "removed" ? "not in the file any more" : "new in the file")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table>
        <thead><tr><th>ruling</th><th className="wrap">on</th><th className="wrap">verdict</th><th>keep?</th></tr></thead>
        <tbody>
          {[...changed, ...gone].map((c) => (
            <tr key={c.id}>
              <td className="wrap">{c.ledger}/{c.kind}</td>
              <td className="wrap">{c.label}</td>
              <td className={`wrap ${c.verdict === "gone" ? "bad" : "warn"}`}>{VERDICT[c.verdict]}{c.why ? ` — ${c.why}` : ""}</td>
              <td>
                {c.verdict === "changed" ? (
                  <select className={p.take.has(c.id) ? "src-file" : "src-user"} value={p.take.has(c.id) ? "file" : "keep"} onChange={(e) => p.onTake(c.id, e.target.value === "file")} title="keep my ruling: it is replayed against the changed subject and reports itself if it no longer applies · take the file's: the ruling is dropped and the file's word governs">
                    <option value="keep">keep my ruling</option>
                    <option value="file">take the file's</option>
                  </select>
                ) : <span className="muted">dropped</span>}
              </td>
            </tr>
          ))}
          {changed.length + gone.length === 0 && <tr><td colSpan={4} className="muted">every ruling's subject is unchanged — all {carried.length} came over</td></tr>}
        </tbody>
      </table>
      <div className="allRow">
        <button className="apply" disabled={!p.pending || p.busy} onClick={p.onApply} title="write the ledgers for this file with these choices and rebuild">
          {p.pending ? `Apply · keep ${changed.length - p.take.size}, take the file's on ${p.take.size}` : `✓ carried — ${p.record.carried} unchanged · ${p.record.kept.length} kept · ${p.record.overwritten.length} overwritten · ${p.record.dropped.length} dropped`}
        </button>
        <button onClick={p.onDismiss} disabled={p.busy} title="hide this panel; the record stays in the corrections ledger">dismiss</button>
      </div>
      {carried.length > 0 && <details><summary className="muted">{carried.length} carried unchanged</summary><ul className="muted">{carried.map((c) => <li key={c.id}>{c.ledger}/{c.kind}: {c.label}</li>)}</ul></details>}
    </div>
  );
}
