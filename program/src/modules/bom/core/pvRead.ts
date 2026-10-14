// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE HOUSE'S OWN SUN (user, 2026-10-09: the Enphase microinverters' "CSV daily report over the last year"). The actual-year weather's
// sun and sky are the reanalysis's estimates; the panels MEASURE what that sun made at this site. The export is read as it is: a date
// column and a production column whose UNIT is read from its own header — Wh, kWh or MWh — never assumed. A header the reader cannot
// place is refused by name; a row that cannot be read is named by its line, never skipped silently.

import { parseCsv, parseDate } from "./csvRead.js";

export interface PvDay { date: string; kwh: number }
export interface PvRead { days: PvDay[]; dateColumn: string; energyColumn: string; unit: "Wh" | "kWh" | "MWh"; problems: string[] }

const UNIT_KWH: Record<PvRead["unit"], number> = { Wh: 0.001, kWh: 1, MWh: 1000 };

export function parsePvCsv(text: string): PvRead | { error: string } {
  const csv = parseCsv(text);
  const h = csv.header;
  const iDate = h.findIndex((c) => /date|day|time/i.test(c));
  // the production column: "Energy Produced (Wh)", "Production (kWh)" … — a consumption or export column is not it
  const iE = h.findIndex((c) => /produc|generat/i.test(c) && !/consum|export|import/i.test(c));
  if (iDate < 0 || iE < 0) return { error: `no ${iDate < 0 ? "date" : "production"} column in the header (${h.join(" · ")}) — the export needs a date and an energy produced column` };
  const u = /\(\s*(MWh|kWh|Wh)\s*\)|\b(MWh|kWh|Wh)\b/i.exec(h[iE]!);
  const word = (u?.[1] ?? u?.[2] ?? "").toLowerCase();
  const unit: PvRead["unit"] | null = word === "wh" ? "Wh" : word === "kwh" ? "kWh" : word === "mwh" ? "MWh" : null;
  if (!unit) return { error: `the production column "${h[iE]}" states no unit (Wh, kWh or MWh) — not guessed` };
  const byDate = new Map<string, number>();
  const problems: string[] = [];
  csv.rows.forEach((r, k) => {
    const rawDate = (r[iDate] ?? "").trim(), rawE = (r[iE] ?? "").replace(/[,\s]/g, "");
    if (!rawDate && !rawE) return;
    if (/total/i.test(rawDate)) return;
    const date = parseDate(rawDate.split(/[ T]/)[0] ?? "");
    const v = Number(rawE);
    if (!date) { problems.push(`line ${k + 2}: the date "${rawDate}" is not read`); return; }
    if (rawE === "" || !Number.isFinite(v)) { problems.push(`line ${k + 2}: the production "${r[iE] ?? ""}" is not a number`); return; }
    // a report in parts of a day (hourly or 15-minute rows) sums into its date
    byDate.set(date, (byDate.get(date) ?? 0) + v * UNIT_KWH[unit]);
  });
  const days = [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, kwh]) => ({ date, kwh }));
  return { days, dateColumn: h[iDate]!, energyColumn: h[iE]!, unit, problems };
}
