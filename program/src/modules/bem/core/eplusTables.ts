// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// READ THE ENGINE'S TABLES. eplustbl.csv is the tabular report in comma
// style: a report title, then tables, each a title line, a header line
// beginning with a comma, and rows whose first cell is the row's name. This
// reads them all into one map so the gate can quote the annual heating and
// cooling, the conditioned area and the unmet hours by name.

export interface EpTable { report: string; name: string; header: string[]; rows: Map<string, string[]> }

export function parseTabularCsv(text: string): EpTable[] {
  const lines = text.split(/\r?\n/);
  const out: EpTable[] = [];
  let report = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("REPORT:,")) { report = line.slice(8).replace(/,+$/, "").trim(); continue; }
    // a table: its title, a blank line, a header beginning ",,", then rows
    // beginning "," whose second cell is the row's name
    const blank = lines[i + 1] ?? "", head = lines[i + 2] ?? "";
    if (!line.startsWith(",") && line.replace(/,+$/, "").trim() && !blank.trim() && head.startsWith(",,")) {
      const t: EpTable = { report, name: line.replace(/,+$/, "").trim(), header: head.split(",").map((c) => c.trim()), rows: new Map() };
      i += 3;
      while (i < lines.length && lines[i]!.startsWith(",")) {
        const cells = lines[i]!.split(",").map((c) => c.trim());
        t.rows.set(cells[1] ?? "", cells);
        i++;
      }
      i--;
      out.push(t);
    }
  }
  return out;
}

/** a cell by table name, row name and a header pattern; NaN when absent */
export function cell(tables: EpTable[], table: string, row: string, col: RegExp): number {
  for (const t of tables) {
    if (t.name !== table) continue;
    const r = t.rows.get(row);
    const c = t.header.findIndex((h) => col.test(h));
    if (r && c >= 0) return Number(r[c]);
  }
  return NaN;
}
