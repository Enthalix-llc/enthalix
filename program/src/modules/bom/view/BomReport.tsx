// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// BOM · THE PRINTED REPORT (user, 2026-10-07: "Can we add print function to BOM?"). Laid out for the page only, as RUN's: hidden on
// screen, the one thing shown under @media print (ui.css). The tariff as applied, with every charge and its citation, the PCA and the
// net metering period; the bills against the model over each bill's own days, with the weather the comparison stands on; the run's
// months and the bills priced; the months' $ as columns. Every number is what BOM's screen shows.

import { createPortal } from "react-dom";
import { CompareTable, CostTable, pairWords, type Priced } from "./BomCost.js";
import type { BomLedger } from "../core/bomDb.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = (v: number): string => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE_W = 700;

export function BomReport({ priced: P, tariff, project, runStamp, weather, pv = true }: { priced: Priced | null; tariff: BomLedger["tariff"] | undefined; project: string; runStamp: string | null; weather: string;
  /** a renewable system (2026-10-23): without one, no net metering, kWh out or credit in the report */ pv?: boolean }): React.ReactElement {
  const C = P?.card.charges;
  const applied = !!P && (tariff?.card === P.card.id || (!tariff && !!P.card.sample));   // the sample is the run's card when none is applied
  const pca = tariff?.pca;
  const page = (
    <div className="printReport">
      <h1>BOM · Energy &amp; Cost — {project || "the project"}</h1>
      <div className="prMeta">
        <span><b>printed</b>{new Date().toLocaleString()}</span>
        <span><b>run</b>{runStamp ?? "none"}</span>
        <span><b>weather</b>{weather}</span>
        <span><b>tariff</b>{P ? `${P.card.name}${applied ? " · applied" : " · NOT applied — the run carries no tariff"}` : "none readable"}</span>
      </div>
      {!P && <p className="prWarn">no run, or no tariff card — nothing to price</p>}
      {P && C && (
        <section>
          <h2>The tariff · {P.card.name} · {P.card.status} · {P.card.effective}</h2>
          <table><tbody>
            {([["access", C.accessUsdMonth], ["energy delivery", C.deliveryUsdKwh], ["demand delivery", C.demandUsdKw], ["supply Jun–Sep", C.supplySummerUsdKwh], ["supply Oct–May", C.supplyWinterUsdKwh]] as const).map(([k, c]) => (
              <tr key={k}><td style={{ textAlign: "left" }}>{k}</td><td>{c.unit.startsWith("$/kWh") ? `${(c.value * 100).toFixed(3)} ¢/kWh` : `$${c.value.toFixed(2)} ${c.unit.replace("$", "")}`}</td><td style={{ textAlign: "left" }}>{c.cite}</td></tr>
            ))}
            <tr><td style={{ textAlign: "left" }}>power cost adjustment</td><td>{pca?.all !== undefined ? `${(pca.all * 100).toFixed(3)} ¢/kWh` : pca?.byMonth ? "by month" : "not typed"}</td><td style={{ textAlign: "left" }}>{pca?.byMonth ? Object.entries(pca.byMonth).map(([k, v]) => `${MONTHS[Number(k) - 1] ?? k} ${(v * 100).toFixed(3)}¢`).join(" · ") : pca?.all === undefined ? "left out of every total" : "typed from a bill"}</td></tr>
            {pv && P.card.netMetering && <tr><td style={{ textAlign: "left" }}>net metering</td><td>{P.card.netMetering.schedule}</td><td style={{ textAlign: "left" }}>the 12-month period opens in {MONTHS[(tariff?.nemStartMonth ?? 1) - 1]}</td></tr>}
          </tbody></table>
        </section>
      )}
      {P && <MonthBars P={P} />}
      {P && P.paired.length > 0 && <section><h2>The bills against the model</h2><CompareTable P={P} /></section>}
      {P && P.paired.length === 0 && <p>no bills imported — the run is priced alone. {pairWords(P)}</p>}
      {P?.run && <section><h2>The run, by month</h2><CostTable pv={pv} title={`${P.runMeters.join(" + ")}${P.runPartial.length ? ` · left out, the run holds only part of: ${P.runPartial.join(", ")}` : ""}`} lines={P.run} engine={P.engine} engineAnnual={P.engineAnnual} /></section>}
      {P && P.bills.length > 0 && <section><h2>The bills, priced</h2><CostTable pv={pv} title="by their periods" lines={P.bills.map((b) => b.line)} billed={P.bills.map((b) => b.bill.costUsd ?? null)} /></section>}
    </div>
  );
  return createPortal(page, document.body);
}

/** the months' $ as columns — the run and, where a bill ends in the month, the bill priced — at the page's width */
function MonthBars({ P }: { P: Priced }): React.ReactElement {
  const bill = new Map<number, number>();
  for (const b of P.bills) bill.set(b.line.month, b.line.total);
  const runV = (m: number): number | null => P.run?.[m - 1]?.total ?? null;
  const top = Math.max(1, ...MONTHS.map((_, i) => Math.max(runV(i + 1) ?? 0, bill.get(i + 1) ?? 0)));
  const L = 50, B = 20, H = 200, ph = H - B - 8, pw = PAGE_W - L - 8, slot = pw / 12, bw = slot * 0.35;
  const y = (v: number): number => 8 + ph - (v / top) * ph;
  return (
    <section>
      <h2>The months' cost</h2>
      <svg width={PAGE_W} height={H}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={L} x2={L + pw} y1={y(top * f)} y2={y(top * f)} stroke="#ccc" /><text x={L - 4} y={y(top * f) + 3} fontSize="9" textAnchor="end">{usd(top * f).replace(/\.\d\d$/, "")}</text></g>)}
        {MONTHS.map((mn, i) => {
          const x = L + slot * i + slot / 2, r = runV(i + 1), b = bill.get(i + 1);
          return (
            <g key={mn}>
              {r !== null && <rect x={x - bw} y={y(r)} width={bw - 1} height={y(0) - y(r)} fill="#3c8ce8" />}
              {b !== undefined && <rect x={x} y={y(b)} width={bw - 1} height={y(0) - y(b)} fill="#e8603c" />}
              <text x={x} y={H - 6} fontSize="9" textAnchor="middle">{mn}</text>
            </g>
          );
        })}
      </svg>
      <div className="prMeta"><span><b style={{ color: "#3c8ce8" }}>■</b>the run (BOM's arithmetic)</span>{P.bills.length > 0 && <span><b style={{ color: "#e8603c" }}>■</b>the bill ending in the month, priced</span>}</div>
    </section>
  );
}
