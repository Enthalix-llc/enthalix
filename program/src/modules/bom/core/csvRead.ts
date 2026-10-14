// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A utility bill is a FILE: a CSV the utility or the user exported, one row
// per bill. This module reads it — quotes, commas, CRLF — and maps the
// columns the user names to the bill's fields. Nothing is computed: the
// period, the reading and the cost are what the bill says, and a row that
// cannot be read is reported by line, never skipped silently.

export interface ParsedCsv { header: string[]; rows: string[][] }

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows };
}

/** which CSV column holds which bill field — the user's mapping, kept in the ledger */
export interface BillColumnMap {
  periodStart: string;
  periodEnd: string;
  measured: string;
  fuel?: string;
  account?: string;
  cost?: string;
  demand?: string;
  /** the kWh the meter RECEIVED from the house (a net meter's export to the grid); `measured` is then the net */
  received?: string;
  /** the unit of `measured` when the file has no unit column: kWh or therm */
  unit?: string;
}

export interface BillRow {
  account: string;
  fuel: string;
  /** ISO dates, inclusive */
  periodStart: string;
  periodEnd: string;
  days: number;
  measured: number;
  unit: string;
  costUsd: number | null;
  demandKw: number | null;
  /** a net meter's kWh received from the house (to the grid), when the bill states it — `measured` is the net (delivered − received) */
  receivedKwh?: number | null;
  line: number;
}

/** a date the way bills print them: ISO, or M/D/YYYY, or D-Mon-YYYY */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) { const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!; return `${y}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`; }
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(t);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2]!.toLowerCase()) + 1;
    if (mon > 0) { const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!; return `${y}-${String(mon).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`; }
  }
  return null;
}

export function daysBetween(startIso: string, endIso: string): number {
  const a = Date.UTC(Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)) - 1, Number(startIso.slice(8, 10)));
  const b = Date.UTC(Number(endIso.slice(0, 4)), Number(endIso.slice(5, 7)) - 1, Number(endIso.slice(8, 10)));
  return Math.round((b - a) / 86400000) + 1;   // both ends inclusive, as bills count
}

/** guess the mapping from the header names — a starting point the user confirms */
export function guessColumns(header: string[]): Partial<BillColumnMap> {
  const find = (re: RegExp): string | undefined => header.find((h) => re.test(h));
  return {
    periodStart: find(/start|from|begin/i) ?? find(/^date$/i),
    periodEnd: find(/end|to$|through/i),
    measured: find(/kwh|usage|consumption|therm|energy|reading/i),
    fuel: find(/fuel|service|commodity|type/i),
    account: find(/account|meter/i),
    cost: find(/cost|amount|charge|\$|total/i),
    demand: find(/demand|kw$/i),
  };
}

export function mapBills(csv: ParsedCsv, map: BillColumnMap): { bills: BillRow[]; problems: string[] } {
  const col = (name: string | undefined): number => (name ? csv.header.indexOf(name) : -1);
  const iStart = col(map.periodStart), iEnd = col(map.periodEnd), iMeas = col(map.measured);
  const iFuel = col(map.fuel), iAcct = col(map.account), iCost = col(map.cost), iDem = col(map.demand), iRec = col(map.received);
  const problems: string[] = [];
  const bills: BillRow[] = [];
  if (iStart < 0 || iEnd < 0 || iMeas < 0) {
    problems.push(`columns not found: ${[iStart < 0 && "period start", iEnd < 0 && "period end", iMeas < 0 && "measured"].filter(Boolean).join(", ")}`);
    return { bills, problems };
  }
  const num = (s: string | undefined): number | null => {
    // a blank cell is "not stated", never 0 (a blank cost read as $0 and a blank demand as 0 kW until 2026-10-08)
    if (s === undefined || s.trim() === "") return null;
    const v = Number(s.replace(/[$,\s]/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  csv.rows.forEach((r, k) => {
    const line = k + 2;
    const start = parseDate(r[iStart] ?? ""), end = parseDate(r[iEnd] ?? "");
    const measured = num(r[iMeas]);
    if (!start || !end) { problems.push(`line ${line}: unreadable period "${r[iStart] ?? ""}" – "${r[iEnd] ?? ""}"`); return; }
    if (measured === null) { problems.push(`line ${line}: unreadable reading "${r[iMeas] ?? ""}"`); return; }
    if (end < start) { problems.push(`line ${line}: period ends before it starts`); return; }
    bills.push({
      account: iAcct >= 0 ? (r[iAcct] ?? "").trim() : "",
      fuel: iFuel >= 0 ? (r[iFuel] ?? "").trim().toLowerCase() : "electricity",
      periodStart: start, periodEnd: end, days: daysBetween(start, end),
      measured, unit: map.unit ?? (/therm/i.test(map.measured) ? "therm" : "kWh"),
      costUsd: iCost >= 0 ? num(r[iCost]) : null, demandKw: iDem >= 0 ? num(r[iDem]) : null,
      ...(iRec >= 0 ? { receivedKwh: num(r[iRec]) } : {}), line,
    });
  });
  return { bills, problems };
}

/** bills back to CSV — the gate's fixture goes out and comes back through the same reader */
export function billsToCsv(bills: BillRow[]): string {
  const esc = (s: string | number | null): string => { const t = s === null ? "" : String(s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return ["account,fuel,period_start,period_end,kwh,cost_usd,demand_kw",
    ...bills.map((b) => [b.account, b.fuel, b.periodStart, b.periodEnd, b.measured, b.costUsd, b.demandKw].map(esc).join(","))].join("\n") + "\n";
}
