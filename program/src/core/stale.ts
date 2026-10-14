// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE FRESHNESS RULE. The module contract is a chain of files —
// ifc.db → idf.db → bem.db → bom.db — and each one names the file it was
// built from. A byte hash of a database flaps (every one carries
// `created_at`), so every file also stamps a `content_sha256` over the
// canonical text of the rows a downstream module reads, hashed from the
// same strings its writer inserted. A downstream file records THAT hash;
// when the two differ the downstream is stale, and the rail says so.
//
// The predecessor's own rule, verbatim: "if the ifc file changes, then the
// ifc db also changes to match. An ifc db change forces a change in the idf
// db. NO MORE STALE REFERENCES!" — enforced there by a freshness gate. Here
// the check is one function, run by every gate (exit 1 on a broken link)
// and by the app (a dot per module). Nothing here repairs anything.

import type { Database } from "sql.js";
import { sha256Hex } from "./sha256.js";

export type ModuleId = "ifc" | "idf" | "bem" | "bom";

export interface ChainLink {
  /** which downstream file the link belongs to */
  module: Exclude<ModuleId, "ifc">;
  /** the meta key on the downstream file and the key it must equal upstream */
  downstreamKey: string;
  upstreamKey: string;
  expected: string | null;   // the upstream value, null when that file is absent
  actual: string | null;     // the downstream's record, null when absent
  /** absent files are not broken links — a module that has not been built yet */
  state: "ok" | "stale" | "absent";
}

export function readMeta(db: Database): Map<string, string> {
  const m = new Map<string, string>();
  const r = db.exec("SELECT key, value FROM meta");
  if (r.length) for (const [k, v] of r[0]!.values) m.set(String(k), v === null ? "" : String(v));
  return m;
}

function hasTable(db: Database, name: string): boolean {
  const r = db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", [name]);
  return Number(r[0]?.values[0]?.[0] ?? 0) > 0;
}

/** rows of a table in a stable order, one text line each, prefixed by the table name */
function tableLines(db: Database, table: string, orderBy: string, columns: string): string[] {
  if (!hasTable(db, table)) return [];
  const r = db.exec(`SELECT ${columns} FROM ${table} ORDER BY ${orderBy}`);
  if (!r.length) return [];
  return r[0]!.values.map((row) => `${table}|${row.map((v) => (v === null ? "" : String(v))).join("|")}`);
}

/** the doors whose glass share the file states (schema 16) — absent rows and an older idf.db hash as nothing, so a file stating
 *  none hashes as it did */
function glassShareLines(db: Database): string[] {
  if (!hasTable(db, "elements") || !db.exec("SELECT name FROM pragma_table_info('elements') WHERE name='glazing_fraction'").length) return [];
  return (db.exec("SELECT id, glazing_fraction FROM elements WHERE glazing_fraction IS NOT NULL ORDER BY id")[0]?.values ?? []).map((r) => `glazing_fraction|${r[0]}|${r[1]}`);
}

/** The canonical text of idf.db as a downstream module reads it: the
 *  surfaces, the plane rulings, the user's edits and step decisions, and the
 *  rooms as ruled. `id`s are not part of it (they renumber on every rebuild
 *  by construction — but they are stable in a rebuild that changes nothing). */
export function canonicalIdfText(db: Database): string {
  return [
    ...tableLines(db, "choices", "category", "category, mode"),
    ...tableLines(db, "surfaces", "id",
      "element_id, category, mode, nx, ny, nz, area_m2, gross_area_m2, thickness_m, source, space, space_facing, space_ifc, space_facing_ifc, grade, grade_m, grade_depth_m, outer, holes"),
    ...tableLines(db, "edits", "seq", "op, from_surface, to_surface"),
    // the site and shade files projected into the model (2026-09-07): a PV panel added is a shading surface the IDF gains
    ...tableLines(db, "site_files", "name", "name, sha256, projected"),
    ...tableLines(db, "site_elements", "express_id", "express_id, file, name, ifc_class, tris"),
    ...tableLines(db, "mep_elements", "express_id", "express_id, file, name, ifc_class, discipline, room, systems, wattage_w, power_w"),
    ...tableLines(db, "mep_systems", "express_id", "express_id, name, predefined_type, members, rooms"),
    // the systems diagram as saved (2026-09-10): a Save moves the content, so the BEM model reads stale until rebuilt
    ...tableLines(db, "system_components", "rowid", "id, kind, ident, label, x, y, fields, attached, vent, from_file, rooms"),
    ...tableLines(db, "system_connectors", "rowid", "id, from_id, from_port, to_id, to_port, points"),
    ...tableLines(db, "system_zones", "rowid", "zone, component"),
    ...tableLines(db, "system_rooms", "rowid", "room, component"),
    ...tableLines(db, "step_decisions", "key", "key, lower_id, upper_id, offset_m, at_height_m, choice"),
    ...tableLines(db, "void_rulings", "space", "space, answer, grille"),
    ...tableLines(db, "spaces", "id", "id, name, long_name, storey"),
    ...tableLines(db, "space_faces", "id", "space_id, nx, ny, nz, area_m2, outer, holes"),
    ...tableLines(db, "zones", "name", "name, kind, volume_m3, volume_source"),
    ...tableLines(db, "elements", "id", "id, global_id, ifc_class, is_external, glazed, type_id"),
    // a door's stated glass share (schema 16, 2026-10-07) — the writer splits the door by it; only rows that state one, so an
    // idf.db with none hashes as it did
    ...glassShareLines(db),
    // the file's word per type (2026-09-08): a stated U or a layer set a downstream construction reads
    ...tableLines(db, "element_types", "id", "id, ifc_class, name, u_w_m2k"),
    ...tableLines(db, "type_layers", "type_id, seq", "type_id, seq, part, material, thickness_m, category"),
    ...tableLines(db, "openings", "element_id", "element_id, global_id, kind, glazed, surface_id, fit, s0, s1, t0, t1"),
    // THE MODEL COMMITTED TO idf.db (2026-10-07, modules/bem/core/modelStore.ts): the user's rulings, the library objects the
    // build read as values, the weather by its content — an Apply moves the content, so the BEM model reads stale until rebuilt
    ...tableLines(db, "model_rulings", "section", "section, json"),
    ...tableLines(db, "model_library", "seq", "seq, cls, name, file, fields, note, key, in_objects, by_name, materials_key"),
    ...tableLines(db, "model_weather", "path", "path, sha256"),
    ...tableLines(db, "model_climate", "json", "json"),
  ].join("\n");
}

/** ifc.db's content is the source file plus the site model beside it */
export function canonicalIfcText(db: Database): string {
  const meta = readMeta(db);
  let site = "";
  if (hasTable(db, "terrain")) {
    const r = db.exec("SELECT site_sha256 FROM terrain ORDER BY id LIMIT 1");
    site = String(r[0]?.values[0]?.[0] ?? "");
  }
  return `${meta.get("source_sha256") ?? ""}‖${site}`;
}

function putMeta(db: Database, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
}

/** stamp `meta.content_sha256`; call after the LAST write to the file */
export function stampIdfContentSha(db: Database): string {
  const sha = sha256Hex(canonicalIdfText(db));
  putMeta(db, "content_sha256", sha);
  return sha;
}
export function stampIfcContentSha(db: Database): string {
  const sha = sha256Hex(canonicalIfcText(db));
  putMeta(db, "content_sha256", sha);
  return sha;
}

/** The four links, evaluated on whatever metas are present. An absent
 *  downstream is not a broken link — it has not been built. */
export function checkChain(metas: { ifc?: Map<string, string> | null; idf?: Map<string, string> | null; bem?: Map<string, string> | null; bom?: Map<string, string> | null; materials?: Map<string, string> | null }): ChainLink[] {
  const link = (module: ChainLink["module"], down: Map<string, string> | null | undefined, downstreamKey: string,
    up: Map<string, string> | null | undefined, upstreamKey: string, optional = false): ChainLink => {
    const expected = up?.get(upstreamKey) ?? null;
    const actual = down?.get(downstreamKey) ?? null;
    let state: ChainLink["state"];
    if (!down) state = "absent";
    else if (optional && (actual === null || actual === "") && expected === null) state = "ok";
    else state = expected !== null && actual === expected ? "ok" : "stale";
    return { module, downstreamKey, upstreamKey, expected, actual, state };
  };
  return [
    link("idf", metas.idf, "source_ifc_sha256", metas.ifc, "source_sha256"),
    link("bem", metas.bem, "source_idf_sha256", metas.idf, "content_sha256"),
    link("bem", metas.bem, "source_bom_inputs_sha256", metas.bom, "inputs_sha256", true),
    link("bom", metas.bom, "source_bem_sha256", metas.bem, "content_sha256"),
    // materials.db is a library, not a module: the link is optional (absent on both sides is fine) and appended last, so the four above keep their indexes
    link("bem", metas.bem, "source_materials_sha256", metas.materials, "content_sha256", true),
  ];
}

/** one line per link, for the gate and the census */
export function formatChain(links: ChainLink[]): string[] {
  const short = (s: string | null): string => (s === null ? "—" : s === "" ? "''" : s.slice(0, 12));
  return links.map((l) =>
    `${l.state === "ok" ? "✓" : l.state === "stale" ? "✗ STALE" : "· absent"}  ${l.module}.db.${l.downstreamKey} ${short(l.actual)} ` +
    `vs upstream ${l.upstreamKey} ${short(l.expected)}`);
}

/** a module's dot: green when every link it owns holds, amber when one is stale, hollow when unbuilt */
export function moduleState(links: ChainLink[], module: ChainLink["module"]): "ok" | "stale" | "absent" {
  const own = links.filter((l) => l.module === module);
  if (own.every((l) => l.state === "absent")) return "absent";
  return own.some((l) => l.state === "stale") ? "stale" : "ok";
}
