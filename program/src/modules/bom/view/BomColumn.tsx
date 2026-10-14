// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BOM EDITING COLUMN — operations, in the order the milestone plan
// names: schedules → tariff & PV → bills & sensors → calibration. This first
// slice is the bills and the statistic; the rest names its milestone. The
// column map is the user's: the reader guesses from the header, the user
// confirms, and the mapping is kept in the ledger beside the imported file.

import type { BomImport, BomOutcome } from "../pipeline.js";
import type { BillColumnMap } from "../core/csvRead.js";
import type { BillFormat, StatementsLedger } from "../core/statement.js";
import { BomStatements } from "./BomStatements.js";

export interface BomColumnProps {
  imports: BomImport[];
  pending: BomImport | null;
  outcome: BomOutcome | null;
  bemStamp: string | null;
  metersAvailable: string[];
  meters: string[];
  epwLine: string;
  busy: boolean;
  onImport: () => void;
  onMap: (map: BillColumnMap) => void;
  onConfirm: () => void;
  onCancelPending: () => void;
  onMeters: (m: string[]) => void;
  onRecompute: () => void;
  onDock: (d: "bom-bills" | "bom-calibration") => void;
  isOpen: (d: string) => boolean;
  /** the printed report (BomReport), through the system print dialog — Save as PDF is in it (2026-10-07) */
  onPrint: () => void;
  /** THE BILLS AS PRINTED (2026-10-09): every statement typed, its format, a change, the format's dialog */
  statements: StatementsLedger; format: BillFormat;
  onStatements: (next: StatementsLedger) => void; onFormat: () => void;
  /** BOM's own run on the actual year, the panels' measured PV, the three pairs (2026-10-09) */
  calibrationRun?: React.ReactNode;
}

const FIELDS: Array<{ key: keyof BillColumnMap; label: string; required: boolean }> = [
  { key: "periodStart", label: "period start", required: true },
  { key: "periodEnd", label: "period end", required: true },
  { key: "measured", label: "reading (kWh / therm)", required: true },
  { key: "fuel", label: "fuel", required: false },
  { key: "account", label: "account", required: false },
  { key: "cost", label: "cost $", required: false },
];

export function BomColumn(p: BomColumnProps): React.ReactElement {
  const o = p.outcome;
  const cal = o?.calibration ?? null;
  return (
    <div className="idfBar bemCol bomCol">
      <div className="barHead">BOM · OPERATIONS</div>
      <button className="qaBtn" onClick={p.onPrint} title="the tariff, the bills against the model over each bill's own days, the run's months and the bills priced, the months' cost — through the system print dialog (Save as PDF is in it)">Print / Save PDF…</button>

      <div className="step">
        <div className="stepHead">1 · schedules</div>
        <div className="idfInfo">occupancy, thermostat setbacks, lighting — milestone M4; the run uses the code's thermostat (72 / 75 °F, IECC R405) all year</div>
      </div>
      <div className="step">
        <div className="stepHead">2 · tariff &amp; PV</div>
        <div className="idfInfo">the tariff: UTILITY below — select a card for its charges, the PCA and Apply; the PV is on BEM › SYSTEMS › ELECTRICAL</div>
      </div>

      <div className="step">
        <div className="stepHead">3 · bills &amp; sensors</div>
        <div className="kv"><span>weather</span><b className={o?.epw?.kind === "AMY" ? "src-file" : "src-code"}>{p.epwLine}</b></div>
        <BomStatements led={p.statements} format={p.format} busy={p.busy} onChange={p.onStatements} onFormat={p.onFormat} />
        <button className="qaBtn" onClick={p.onImport} disabled={p.busy} title="another utility's bills as a CSV export">Import bills CSV…</button>
        {p.pending && (
          <div className="colMap">
            <div className="idfInfo"><b>{p.pending.name}</b> · {p.pending.csv.rows.length} rows · columns: {p.pending.csv.header.join(", ")}</div>
            {FIELDS.map((f) => (
              <label key={f.key} className="lensRow">
                {f.label}{f.required ? " *" : ""}
                <select value={(p.pending!.columnMap[f.key] as string | undefined) ?? ""} onChange={(e) => p.onMap({ ...p.pending!.columnMap, [f.key]: e.target.value || undefined })}>
                  <option value="">—</option>
                  {p.pending!.csv.header.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <div className="idfInfo">{p.pending.bills.length} bills read{p.pending.problems.length ? ` · ${p.pending.problems.length} rows not read: ${p.pending.problems.slice(0, 2).join("; ")}` : ""}</div>
            <div className="allRow">
              <button className="apply" onClick={p.onConfirm} disabled={p.pending.bills.length === 0}>Use these {p.pending.bills.length} bills</button>
              <button onClick={p.onCancelPending}>cancel</button>
            </div>
          </div>
        )}
        {p.imports.length > 0 && <div className="idfInfo">imported: {p.imports.map((i) => `${i.name} (${i.bills.length} bills, ${i.sha256.slice(0, 8)})`).join(" · ")}</div>}
        <label className="lensRow">
          compare to
          <select value={p.meters.join("+")} onChange={(e) => p.onMeters(e.target.value ? e.target.value.split("+") : [])} disabled={p.metersAvailable.length === 0}>
            {p.metersAvailable.length === 0 && <option value="">no run with daily meters yet</option>}
            {p.metersAvailable.length > 0 && <option value={p.metersAvailable.join("+")}>the run's loads (district heating + cooling)</option>}
            <option value="ElectricityPurchased:Facility">electricity purchased (not in an ideal-loads run)</option>
          </select>
        </label>
        {p.imports.length > 0 && <button className="apply" onClick={p.onRecompute} disabled={p.busy || !p.bemStamp}>{p.busy ? "…" : "Compare with the run"}</button>}
        {p.imports.length > 0 && <button className={`qaBtn${p.isOpen("bom-bills") ? " on" : ""}`} onClick={() => p.onDock("bom-bills")}>bills table</button>}
      </div>

      <div className="step">
        <div className="stepHead">4 · calibration</div>
        {p.calibrationRun}
        {cal && <div className="stepHead">against BEM's run (typical year)</div>}
        {!cal && <div className="idfInfo">{p.bemStamp ? "against BEM's run: import bills, then compare" : "against BEM's run: run the BEM first"}</div>}
        {cal && (
          <>
            <div className="kv"><span>verdict</span><b className={cal.verdict === "calibrated" ? "ok" : cal.verdict === "not calibrated" ? "bad" : ""}>{cal.verdict === "comparison" ? "comparison, not calibration" : cal.verdict}</b></div>
            <div className="kv"><span>CVRMSE</span><b>{cal.cvrmsePct?.toFixed(2) ?? "—"} % (≤ {cal.limitCvrmse})</b></div>
            <div className="kv"><span>NMBE</span><b>{cal.nmbePct?.toFixed(2) ?? "—"} % (|·| ≤ {cal.limitNmbe})</b></div>
            <div className="kv"><span>periods</span><b>{cal.n} · p = {cal.p}</b></div>
            {cal.caveats.map((c, i) => <div key={i} className="idfInfo caveat">{cal.verdict === "withheld" ? "withheld: " : ""}{c}</div>)}
            <button className={`qaBtn${p.isOpen("bom-calibration") ? " on" : ""}`} onClick={() => p.onDock("bom-calibration")}>measured vs modelled</button>
            <div className="idfInfo">bom.db content {String(o?.bomMeta.get("content_sha256") ?? "").slice(0, 12)}</div>
          </>
        )}
      </div>
    </div>
  );
}
