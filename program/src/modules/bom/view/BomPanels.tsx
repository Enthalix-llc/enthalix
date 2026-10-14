// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BOM DOCK PANELS: the bills table (an eye per period — an excluded
// period leaves the statistic) and the calibration panel: measured against
// modelled per bill period as paired bars, the formula written out with the
// numbers, and every caveat that withholds the verdict.

import type { BomOutcome } from "../pipeline.js";

export function BomBillsPanel(p: { outcome: BomOutcome; excluded: Set<string>; onToggle: (key: string) => void }): React.ReactElement {
  const o = p.outcome;
  return (
    <div className="qaPanel steps">
      <table>
        <thead><tr><th></th><th>period</th><th>days</th><th>measured</th><th>modelled kWh</th><th>Δ %</th><th>covered</th><th>file</th></tr></thead>
        <tbody>
          {o.bills.map((b) => {
            const key = `${b.account}|${b.periodStart}`;
            const off = p.excluded.has(key);
            const d = b.modelledKwh !== null && b.measured ? ((b.modelledKwh - b.measured) / b.measured) * 100 : null;
            return (
              <tr key={key} className={off ? "off" : ""}>
                <td><button className={`eye${off ? " off" : ""}`} onClick={() => p.onToggle(key)} title={off ? "include this period" : "exclude this period from the statistic"}>{off ? "◌" : "◉"}</button></td>
                <td>{b.periodStart} – {b.periodEnd}</td>
                <td>{b.days}</td>
                <td>{b.measured.toFixed(0)} {b.unit}</td>
                <td>{b.modelledKwh === null ? "—" : b.modelledKwh.toFixed(0)}</td>
                <td className={d !== null && Math.abs(d) > 15 ? "bad" : ""}>{d === null ? "" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}`}</td>
                <td>{b.covered === null ? "" : b.covered ? "yes" : "NO"}</td>
                <td>{b.importSha256.slice(0, 8)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>compared to {o.meters.join(" + ") || "no meter"} · measured is the bill's own reading; modelled is the run's daily meter summed over the bill's period, never a calendar month.</p>
    </div>
  );
}

export function BomCalibrationPanel(p: { outcome: BomOutcome }): React.ReactElement {
  const o = p.outcome;
  const rows = o.periods;
  const max = Math.max(1, ...rows.flatMap((r) => [r.bill.measured, r.modelledKwh]));
  const W = 640, H = 200, pad = 28, bw = rows.length ? (W - 2 * pad) / rows.length : 10;
  const y = (v: number): number => H - pad - (v / max) * (H - 2 * pad);
  const g = o.g14, v = o.verdict;
  return (
    <div className="qaPanel steps">
      <svg viewBox={`0 0 ${W} ${H}`} className="calChart" role="img" aria-label="measured vs modelled per bill period">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--line)" />
        <text x={pad - 4} y={pad + 4} textAnchor="end" fill="var(--dim)" fontSize="9">{max.toFixed(0)}</text>
        <text x={pad - 4} y={H - pad} textAnchor="end" fill="var(--dim)" fontSize="9">0</text>
        {rows.map((r, i) => {
          const x = pad + i * bw;
          return (
            <g key={i}>
              <rect x={x + bw * 0.12} y={y(r.bill.measured)} width={bw * 0.36} height={H - pad - y(r.bill.measured)} fill="var(--text)" opacity={0.85} />
              <rect x={x + bw * 0.52} y={y(r.modelledKwh)} width={bw * 0.36} height={H - pad - y(r.modelledKwh)} fill="var(--accent-bom)" opacity={r.covered ? 0.9 : 0.35} />
              <text x={x + bw / 2} y={H - pad + 11} textAnchor="middle" fill="var(--dim)" fontSize="8">{r.bill.periodStart.slice(5)}</text>
            </g>
          );
        })}
        <rect x={W - pad - 150} y={6} width={10} height={10} fill="var(--text)" opacity={0.85} /><text x={W - pad - 136} y={15} fill="var(--muted)" fontSize="9">measured (the bill)</text>
        <rect x={W - pad - 60} y={6} width={10} height={10} fill="var(--accent-bom)" /><text x={W - pad - 46} y={15} fill="var(--muted)" fontSize="9">modelled</text>
      </svg>
      {g && v && (
        <p className="formula">
          ASHRAE Guideline 14-2014 §5.2.11, p = {g.p}, n = {g.n}, m̄ = {g.meanMeasured.toFixed(1)}<br />
          NMBE = Σ(m − s) / ((n − p)·m̄) × 100 = <b>{g.nmbePct.toFixed(2)} %</b> (|NMBE| ≤ {v.limitNmbe} for {v.basis})<br />
          CVRMSE = √(Σ(m − s)² / (n − p)) / m̄ × 100 = <b>{g.cvrmsePct.toFixed(2)} %</b> (≤ {v.limitCvrmse})<br />
          verdict: <b>{v.verdict === "comparison" ? "comparison, not calibration" : v.verdict}</b>{[...v.caveats, ...v.notes].length ? ` — ${[...v.caveats, ...v.notes].join(" · ")}` : ""}
        </p>
      )}
      <p>{o.epwLine}. {o.epw?.comment ? `The file says: "${o.epw.comment.slice(0, 120)}…"` : ""}</p>
    </div>
  );
}
