// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SYSTEMS (user, 2026-09-10) — the column IS the selected component's
// settings ("drop the drop-down categories in the right column, and use
// the whole space for each selected component's data settings"): the
// counted Apply for the sheet's stage, then ComponentSettings — the name,
// the class, the zones it serves (assigned in ZONES), the attachments, the
// engine's own fields from the schema; with nothing selected, what the
// sheet compiles to and what it refuses. The sheet is MECHANICAL; the
// ELECTRICAL and PLUMBING subsections return with their slices.

import type { BemModelOutcome } from "../pipeline.js";
import type { SystemsRuling } from "../core/bemDb.js";
import type { MepElementRow } from "../../../core/db.js";
import { diagramDiff } from "../core/assembly.js";
import { sheetSize } from "../core/stageJournal.js";
import type { BemLedger } from "../core/bemDb.js";
import { useState } from "react";
import { SECTION_TREE, CODE_DEFAULT_SYSTEM, kindSummary, ratingFromName, type MainSection, type SystemSection } from "../core/mepFocus.js";
import { ComponentSettings, type SettingsProps } from "./ComponentSettings.js";
import { SystemQaPanel, qaRowsByNode } from "./SystemQaPanel.js";
import { KV, srcClass, InfoTip } from "./bemUi.js";

interface HistoryRow { path: string; at: string; components: number; connectors: number; draft: boolean; systems: SystemsRuling }
export function BemSystems(p: { model: BemModelOutcome | null; stage: SystemsRuling; applied: SystemsRuling | undefined; onApply: (s: SystemsRuling) => void; onRevert: () => void; busy: boolean; settings: SettingsProps; draft: { at: string; error?: string } | null; sha: string; onRestore: (s: SystemsRuling) => void }): React.ReactElement {
  const m = p.model;
  const diff = diagramDiff(p.stage, p.applied);
  // PREVIOUS VERSIONS (2026-09-10): the ledger's history, one row per distinct sheet, newest first; restore STAGES it
  const [hist, setHist] = useState<HistoryRow[] | "loading" | null>(null);
  const toggleHistory = async (): Promise<void> => {
    if (hist) { setHist(null); return; }
    setHist("loading");
    const rows: HistoryRow[] = []; const seen = new Set<string>();
    for (const e of await window.bem.listDecisionsHistory(p.sha)) {
      const j = (await window.bem.readDecisionsHistory(p.sha, e.path)) as BemLedger | null;
      const s = j?.staged?.systems ?? j?.systems; const key = JSON.stringify([s?.assembly ?? null, s?.assign ?? null]);
      if (!s?.assembly?.nodes.length || seen.has(key)) continue;
      seen.add(key);
      rows.push({ path: e.path, at: e.at, ...sheetSize(s), draft: !!j?.staged?.systems, systems: s });
    }
    setHist(rows);
  };
  const when = (at: string): string => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString(); };
  const applied = m?.systems.filter((r) => r.source !== "code-default") ?? [];
  return (
    <div className="idfBar bemCol">
      {/* THE SHEET'S SAVE STATE (2026-09-14, the user asked what this section is for): the sheet as drawn against the sheet SAVED into the
          model — Save writes the drawing (and what it compiles to) into idf.db and the ledger and rebuilds the model; revert puts the drawing
          back to the saved one; the draft line says the drawing is kept on disk as it changes, so nothing is lost before Save; previous
          versions lists earlier sheets to restore. What the saved model holds is listed in the column with nothing selected. */}
      <div className="allRow">
        <button className="apply" disabled={diff.pending === 0 || p.busy} onClick={() => p.onApply(p.stage)} title={`Save the sheet — its components, connectors and the zones assigned in ZONES — into idf.db (system_components · system_connectors · system_zones) and the ledger keyed to this file; the model is rebuilt and RUN says it moved${diff.words.length ? `\n${diff.words.join("\n")}` : ""}${applied.length ? `\n\nin the saved model now: ${applied.map((r) => `${r.id} (${r.zones.length} zones)`).join(", ")}` : ""}`}>
          {diff.pending === 0 ? "✓ saved — no changes" : `Save · ${diff.pending} change${diff.pending > 1 ? "s" : ""}`}
        </button>
        {diff.pending > 0 && <button className="chip" onClick={p.onRevert} title="the sheet back to what is saved">revert</button>}
        <button className="chip" onClick={() => { void toggleHistory(); }} title="every earlier version of this file's ledger holding a sheet (the store keeps the last 30); restore stages one, Save writes it">previous versions{hist ? " ▴" : "…"}</button>
        <span className="muted asmDraft" title="the sheet as drawn is kept on disk as it changes — in this file's ledger and in the browser's storage — so a reload, a relaunch or a load never loses it; Save is the model's word">
          {p.draft ? (p.draft.error ? <span className="src-warn">draft not on disk — {p.draft.error}</span> : <span>draft kept · {when(p.draft.at)}</span>) : null}
        </span>
        {!m && <span className="src-warn">no model yet — build the envelope, then open a BEM tab</span>}
      </div>
      {hist === "loading" && <div className="muted asmDraft">reading the history…</div>}
      {Array.isArray(hist) && (
        <div className="asmHistory">
          {hist.length === 0 ? <span className="muted">no earlier sheet in the history yet</span> : hist.map((h) => (
            <div key={h.path} className="asmRow"><span className="muted">{h.at.slice(0, 10)} {when(h.at)}</span> <span>{h.components} components · {h.connectors} connectors · {h.draft ? "draft" : "saved"}</span> <button className="chip" onClick={() => { p.onRestore(h.systems); setHist(null); }} title="stage this sheet — the sheet as it is now goes to the history on the next write">restore</button></div>
          ))}
        </div>
      )}
      {m && m.built.unresolvedSystems.length > 0 && <div className="src-warn" title="what the SAVED sheet asked for that the model could not write, and why — fix it on the sheet, then Save">not written in the saved model: {m.built.unresolvedSystems.join("; ")}</div>}
      <SystemQaPanel rows={m?.systemQa ?? []} byNode={qaRowsByNode(p.settings.compiled, m)} onSelect={p.settings.onSel} />
      <ComponentSettings {...p.settings} />
    </div>
  );
}

/** ELECTRICAL and PLUMBING (their sheets come with their slices): the discipline's subsections, what governs each, the focus on click;
 *  the PV panels are the one thing of the file's services still named — they are the shading set already */
/** a component on the discipline's sheet, listed under its subsection: saved (in the model) or waiting on Save, refused with why */
export interface SheetItem { section: SystemSection; node: string; name: string; kind: string; room: string | null; saved: boolean; refused: string | null }
export function DisciplineColumn(p: { main: MainSection; model: BemModelOutcome | null; mep: MepElementRow[]; focus: SystemSection; onFocus: (s: SystemSection) => void;
  /** THE SHEET'S EQUIPMENT under its subsection (the user, 2026-10-05: the water heaters under Domestic Hot Water); a click picks it on the sheet */
  sheet?: SheetItem[]; onPick?: (node: string) => void }): React.ReactElement {
  const main = SECTION_TREE.find((m) => m.id === p.main)!;
  const panels = kindSummary(p.mep, "generation").filter((k) => /solar|photovolt|\bpv\b|panel/i.test(k.kind) && !/inverter|combiner|breaker|meter/i.test(k.kind));
  return (
    <div className="idfBar bemCol">
      <div className="barHead">{main.label.toUpperCase()}<InfoTip text="the code default governs each subsection until its slice rules it; the options under the view are the engine's fields, read-only until then" /></div>
      {main.subs.map((sub) => {
        const rows = p.model?.systems.filter((r) => r.section === sub.id && r.source !== "code-default") ?? [];
        const items = (p.sheet ?? []).filter((x) => x.section === sub.id);
        const unsaved = items.filter((x) => !x.saved).length;
        return (
          <div key={sub.id} className={`sysSub${p.focus === sub.id ? " focus" : ""}`}>
            <button className={`qaBtn sec${p.focus === sub.id ? " on" : ""}`} onClick={() => p.onFocus(sub.id)} title={`${sub.kind} · the object that takes it: ${sub.consumer}`}>
              {sub.label} <span className="sysKind">{sub.kind}</span> · {rows.length ? <span className="src-user">{rows.map((r) => r.id).join(", ")}</span> : <span className="src-code">{CODE_DEFAULT_SYSTEM[sub.id].split(" — ")[0]}</span>}
              {items.length > 0 && <span className="sysKind"> · {items.length} on the sheet{unsaved ? `, ${unsaved} not saved` : ""}</span>}
            </button>
            {items.length > 0 && (
              <div className="sysItems">
                {items.map((x) => (
                  <button key={x.node} className="sysItem" onClick={() => p.onPick?.(x.node)} title={`${x.kind}${x.room ? ` · in ${x.room}` : ""} — click: pick it on the sheet${x.refused ? `\nrefused: ${x.refused}` : ""}`}>
                    <span className="src-user">{x.name}</span>
                    <span className="muted"> · {/#well$/.test(x.kind) ? "well pump" : x.kind.replace(/^WaterHeater:/, "").replace(/#gas$/, " (gas)")}{x.room ? ` · ${x.room}` : x.section === "water" ? " · outside" : " · no room"}</span>
                    {x.refused ? <span className="src-warn"> · refused</span> : x.saved ? <span className="muted"> · in the model</span> : <span className="src-warn"> · not saved — Save writes it</span>}
                  </button>
                ))}
              </div>
            )}
            {p.focus === sub.id && (
              <div className="sysBody">
                {/* the applied ruling governs once there is one (2026-10-02: the line read "none — no PV" over 35 applied panels) */}
                {rows.length ? <KV k="governs" src="user" v={rows.map((r) => r.label).join("; ")} /> : <KV k="governs" src="code-default" v={CODE_DEFAULT_SYSTEM[sub.id]} />}
                {sub.id === "generation" && <div className="sysNote">assembled on the sheet above — PV arrays, inverters, load centres and the utility (2026-10-02)</div>}
                {sub.id === "generation" && panels.map((k) => { const r = ratingFromName(k.kind, k.ifcClass); return <div key={k.kind} className="sysNote">{k.count} × {k.kind.split(":").pop()}{r ? <span className={srcClass("code-default")} title="read out of the type name — a default, adopted only by a ruling"> · {r.value} {r.unit} from the name</span> : null} · on the roof, in the shading set</div>; })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

