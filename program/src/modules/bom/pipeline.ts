// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE OPERATIONS MODEL's run in the app: the bills the user imported (raw
// files copied under data/bom/imports/, the column map in the ledger) against
// the last BEM run's daily meters read back from bem.db, the weather file's
// own word on whether it is typical, and Guideline 14's statistic — into
// bom.db, saved, then READ BACK for the views. The same core the gate calls.

import type { SqlJsStatic } from "sql.js";
import { parseCsv, mapBills, guessColumns, type BillColumnMap, type BillRow, type ParsedCsv } from "./core/csvRead.js";
import { billPeriods, guideline14, verdictFor, sunEstimated, type PeriodResult, type G14, type Verdict } from "./core/calibration.js";
import { readEpw, describeEpw, type EpwRead } from "../bem/core/epwRead.js";
import { statementToBillRow, type StatementsLedger } from "./core/statement.js";
import { buildBomDb, writeStatements, writeImport, writeBills, writeMeterMap, writeRunRequest, writeCalibration, stampBomShas, queryBills, queryCalibration, type BomLedger, type BillOut, type CalibrationOut } from "./core/bomDb.js";
import { sha256Hex } from "../../core/sha256.js";

export interface BomImport { sha256: string; name: string; text: string; csv: ParsedCsv; columnMap: BillColumnMap; bills: BillRow[]; problems: string[] }

export interface BomOutcome {
  bills: BillOut[];
  periods: PeriodResult[];
  g14: G14 | null;
  verdict: Verdict | null;
  calibration: CalibrationOut | null;
  epw: EpwRead | null;
  epwLine: string;
  meters: string[];
  bomMeta: Map<string, string>;
}

/** the statements as BillRows (a bill without its dates or its net is left out until typed) */
export function statementBills(led: StatementsLedger | undefined): BillRow[] {
  return (led?.bills ?? []).map((s, k) => statementToBillRow(s, k + 1)).filter((r): r is BillRow => !!r);
}

/** read a CSV the user picked: the header, a guessed column map, the bills it yields */
export function importBills(name: string, text: string, columnMap?: Partial<BillColumnMap>): BomImport {
  const csv = parseCsv(text);
  const guess = guessColumns(csv.header);
  const map: BillColumnMap = {
    periodStart: columnMap?.periodStart ?? guess.periodStart ?? "",
    periodEnd: columnMap?.periodEnd ?? guess.periodEnd ?? "",
    measured: columnMap?.measured ?? guess.measured ?? "",
    fuel: columnMap?.fuel ?? guess.fuel, account: columnMap?.account ?? guess.account,
    cost: columnMap?.cost ?? guess.cost, demand: columnMap?.demand ?? guess.demand, unit: columnMap?.unit,
  };
  const { bills, problems } = mapBills(csv, map);
  return { sha256: sha256Hex(text), name, text, csv, columnMap: map, bills, problems };
}

/** bom.db from the imports and the last run; saved; read back */
export async function runBomPipeline(
  SQL: SqlJsStatic,
  opts: {
    imports: BomImport[];
    /** the bills typed as statements (2026-10-09) — read as BillRows beside the imports' */
    statements?: StatementsLedger;
    excluded: Set<string>;
    meters: string[];
    daily: Array<{ name: string; month: number; day: number; value: number }>;
    runStamp: string;
    epwPath: string | null;
    bemMeta: Map<string, string> | null;
    readMeta: (db: import("sql.js").Database) => Map<string, string>;
  },
): Promise<BomOutcome> {
  const epwText = opts.epwPath ? await window.bem.readText(opts.epwPath) : null;
  const epw = epwText ? readEpw(epwText) : null;
  const typed = statementBills(opts.statements);
  const bills = [...opts.imports.flatMap((i) => i.bills), ...typed].filter((b) => !opts.excluded.has(`${b.account}|${b.periodStart}`));
  const periods = billPeriods(bills, opts.daily, opts.meters);
  const metersInRun = opts.meters.some((m) => opts.daily.some((d) => d.name === m));
  const g14 = periods.length ? guideline14(periods.map((p) => p.bill.measured), periods.map((p) => p.modelledKwh)) : null;
  const verdict = g14 ? verdictFor(g14, { basis: "bill periods", epwKind: epw?.kind ?? "unknown", epwYears: epw?.years, metersInRun, uncovered: periods.filter((p) => !p.covered).length, estimatedSun: !!epw && sunEstimated(epw.comment) }) : null;
  const bdb = buildBomDb(SQL, {
    sourceIfcSha256: opts.bemMeta?.get("source_ifc_sha256") ?? "", sourceIdfSha256: opts.bemMeta?.get("source_idf_sha256") ?? "",
    sourceBemSha256: opts.bemMeta?.get("content_sha256") ?? "", sourceName: "bem.db",
  });
  for (const i of opts.imports) {
    writeImport(bdb, { sha256: i.sha256, kind: "bills", name: i.name, rows: i.csv.rows.length, columnMap: i.columnMap });
    writeBills(bdb, i.bills, i.sha256, opts.excluded, periods);
  }
  if (typed.length) writeBills(bdb, typed, "statements", opts.excluded, periods);
  writeStatements(bdb, opts.statements);
  writeMeterMap(bdb, { [bills[0]?.fuel ?? "electricity"]: opts.meters }, "user");
  if (bills.length) writeRunRequest(bdb, { begin: bills.map((b) => b.periodStart).sort()[0]!, end: bills.map((b) => b.periodEnd).sort().pop()!, epwName: opts.epwPath ?? "", epwSha256: "", epwKind: epw?.kind ?? "unknown", source: "file" });
  if (g14 && verdict) writeCalibration(bdb, opts.runStamp, bills[0]?.fuel ?? "electricity", g14, verdict);
  stampBomShas(bdb);
  const bytes = bdb.export();
  bdb.close();
  await window.bim.saveDb("bom.db", bytes);
  const again = new SQL.Database(bytes);
  const out: BomOutcome = {
    bills: queryBills(again), periods, g14, verdict, calibration: queryCalibration(again)[0] ?? null, epw,
    epwLine: describeEpw(epw, { covered: periods.filter((p) => p.covered).length, total: periods.length }),
    meters: opts.meters, bomMeta: opts.readMeta(again),
  };
  again.close();
  return out;
}
