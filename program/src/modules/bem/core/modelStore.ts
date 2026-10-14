// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// idf.db HOLDS THE MODEL (the user, 2026-10-06: "THE IDF DB MUST HOLD ALL INFORMATION REQUIRED FOR THE IDF ENERGYPLUS INPUT
// FILE!" — the program's intent from the start: IFC → ifc.db → the user's corrections → idf.db, the truth evaluated). Until
// now idf.db held the geometry corrections only; the user's constructions, schedules, systems, gains, site and weather lived
// in a side ledger re-applied at every build, and a material named there BY KEY into a library could vanish (the stud wall's
// siding, lost with materials-user.json in 2026-09). Now every Apply COMMITS the model into idf.db:
//   model_rulings  — each applied section of the user's rulings, as applied (the stage is not the model)
//   model_library  — every library object the build actually read (a material's, a construction's, a schedule's fields,
//                    a curve), as VALUES — never a key into a file that can change
//   model_weather  — the weather file itself (the EPW and its DDY text), not its path
//   model_climate  — the county and climate zone the code values were read for
// and the model is built from idf.db ALONE. A commit is proven before it stands: the IDF built from idf.db must equal, byte
// for byte, the IDF the live libraries give — a difference is a failed check, never silent.

import type { Database } from "sql.js";
import type { IdfObject, Library } from "./idfLib.js";
import type { BemLedger } from "./bemDb.js";
import type { CountyZoneRead } from "../../../core/climateZone.js";
import { sha256Hex } from "../../../core/sha256.js";
import type { EpSchema } from "./epSchema.js";
import { readBemInput, type BemInput } from "./bemInput.js";
import { buildModel, type BuiltModel } from "./bemModel.js";
import { writeIdf, type IdfModel } from "./bemIdf.js";
import { readWeather, type WeatherRead } from "./weather.js";

/** the model_rulings row the BOM tariff rides in (not a section of the BEM rulings) */
const TARIFF_SECTION = "@bom-tariff";
export const MODEL_TABLES = ["model_rulings", "model_library", "model_weather", "model_climate"] as const;

const DDL = `
CREATE TABLE IF NOT EXISTS model_rulings (section TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_library (seq INTEGER PRIMARY KEY, cls TEXT NOT NULL, name TEXT NOT NULL, file TEXT NOT NULL,
  fields TEXT NOT NULL, note TEXT, provenance TEXT, key TEXT, kind TEXT,
  in_objects INTEGER NOT NULL, by_name TEXT, materials_key TEXT);
CREATE TABLE IF NOT EXISTS model_weather (path TEXT NOT NULL, sha256 TEXT NOT NULL, epw TEXT NOT NULL, ddy TEXT);
CREATE TABLE IF NOT EXISTS model_climate (json TEXT NOT NULL);
`;

/** one object the build read, with where the library held it — so a library rebuilt from idf.db answers every lookup the same */
interface UsedObject { seq: number; o: IdfObject; inObjects: boolean; byName: string | null; materialsKey: string | null }

/** THE RECORDING LIBRARY: the live library with every object behind a proxy that marks it read when its values are read
 *  (fields, the window note, the provenance) — a name or a file looked at while searching is not a use */
export function recordingLibrary(lib: Library): { library: Library; used: () => UsedObject[] } {
  const seqOf = new Map<IdfObject, number>();
  lib.objects.forEach((o, i) => seqOf.set(o, i));
  let extra = lib.objects.length;
  const mark = new Set<IdfObject>();
  const proxies = new Map<IdfObject, IdfObject>();
  const wrap = (o: IdfObject): IdfObject => {
    let p = proxies.get(o);
    if (!p) {
      if (!seqOf.has(o)) seqOf.set(o, extra++);
      p = new Proxy(o, { get(t, k, r) { if (k === "fields" || k === "note" || k === "provenance") mark.add(t); return Reflect.get(t, k, r); } });
      proxies.set(o, p);
    }
    return p;
  };
  const objects = lib.objects.map(wrap);
  const byClass = new Map([...lib.byClass].map(([k, v]) => [k, v.map(wrap)]));
  const byName = new Map([...lib.byName].map(([k, v]) => [k, wrap(v)]));
  const materials = lib.materials ? new Map([...lib.materials].map(([k, v]) => [k, wrap(v)])) : undefined;
  const inObjects = new Set(lib.objects);
  const nameOf = new Map<IdfObject, string>(); for (const [k, v] of lib.byName) if (!nameOf.has(v)) nameOf.set(v, k);
  const keyOf = new Map<IdfObject, string>(); if (lib.materials) for (const [k, v] of lib.materials) if (!keyOf.has(v)) keyOf.set(v, k);
  const library: Library = { ...lib, objects, byClass, byName, ...(materials ? { materials } : {}) };
  return {
    library,
    used: () => [...mark].map((o) => ({ seq: seqOf.get(o)!, o, inObjects: inObjects.has(o), byName: nameOf.get(o) ?? null, materialsKey: keyOf.get(o) ?? null })).sort((a, b) => a.seq - b.seq),
  };
}

export interface ModelWeather { path: string; epw: string; ddy: string | null }
export interface ModelInputs {
  ledger: BemLedger;
  /** BOM's applied tariff, as written into the IDF; null = energy only */
  tariff: IdfModel["tariff"];
  library: Library;
  weather: ModelWeather | null;
  zone: CountyZoneRead | null;
  /** when it was committed, and how many library objects it holds — the RUN column's word */
  committedAt: string;
  libraryCount: number;
}

const hasTable = (db: Database, t: string): boolean => db.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${t}'`).length > 0;
export const holdsModel = (db: Database): boolean => hasTable(db, "model_rulings") && db.exec("SELECT 1 FROM model_rulings LIMIT 1").length > 0;
const putMeta = (db: Database, k: string, v: string): void => { db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [k, v]); };

/** THE COMMIT: the applied rulings (never the stage), the objects the build read and the weather, into idf.db */
export function writeModelInputs(db: Database, c: { ledger: BemLedger; used: UsedObject[]; weather: ModelWeather | null; zone: CountyZoneRead | null; tariff?: IdfModel["tariff"] }): void {
  db.exec(DDL);
  for (const t of MODEL_TABLES) db.run(`DELETE FROM ${t}`);
  const r = db.prepare("INSERT INTO model_rulings VALUES (?, ?)");
  for (const [k, v] of Object.entries(c.ledger)) if (k !== "staged" && v !== undefined) r.run([k, JSON.stringify(v)]);
  // BOM › UTILITY's applied tariff (2026-10-03) is an IDF input too — the engine's UtilityCost objects — held beside the rulings
  if (c.tariff) r.run([TARIFF_SECTION, JSON.stringify(c.tariff)]);
  r.free();
  const l = db.prepare("INSERT INTO model_library VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const u of c.used) l.run([u.seq, u.o.cls, u.o.name, u.o.file, JSON.stringify(u.o.fields), u.o.note, u.o.provenance ?? null, u.o.key ?? null, u.o.kind ?? null, u.inObjects ? 1 : 0, u.byName, u.materialsKey]);
  l.free();
  if (c.weather) db.run("INSERT INTO model_weather VALUES (?,?,?,?)", [c.weather.path, sha256Hex(c.weather.epw + "\u0000" + (c.weather.ddy ?? "")), c.weather.epw, c.weather.ddy]);
  if (c.zone) db.run("INSERT INTO model_climate VALUES (?)", [JSON.stringify(c.zone)]);
  putMeta(db, "model_committed_at", new Date().toISOString());
  putMeta(db, "model_ledger_saved_at", c.ledger.savedAt ?? "");
}

/** THE MODEL AS idf.db HOLDS IT — null when idf.db holds none yet (a file never applied since 2026-10-07) */
export function readModelInputs(db: Database): ModelInputs | null {
  if (!holdsModel(db)) return null;
  const ledger = {} as Record<string, unknown>;
  let tariff: IdfModel["tariff"] = null;
  for (const [k, v] of db.exec("SELECT section, json FROM model_rulings")[0]?.values ?? []) {
    if (k === TARIFF_SECTION) tariff = JSON.parse(String(v)) as IdfModel["tariff"]; else ledger[String(k)] = JSON.parse(String(v));
  }
  const rows = db.exec("SELECT cls, name, file, fields, note, provenance, key, kind, in_objects, by_name, materials_key FROM model_library ORDER BY seq")[0]?.values ?? [];
  const objects: IdfObject[] = [], byClass = new Map<string, IdfObject[]>(), byName = new Map<string, IdfObject>(), materials = new Map<string, IdfObject>();
  const census: Record<string, number> = {};
  for (const x of rows) {
    const o: IdfObject = { cls: String(x[0]), name: String(x[1]), file: String(x[2]), fields: JSON.parse(String(x[3])) as string[], note: x[4] === null ? null : String(x[4]) };
    if (x[5] !== null) o.provenance = String(x[5]);
    if (x[6] !== null) o.key = String(x[6]);
    if (x[7] !== null) o.kind = String(x[7]);
    if (Number(x[8]) === 1) { objects.push(o); (byClass.get(o.cls) ?? byClass.set(o.cls, []).get(o.cls)!).push(o); census[o.cls] = (census[o.cls] ?? 0) + 1; }
    if (x[9] !== null) byName.set(String(x[9]), o);
    if (x[10] !== null) materials.set(String(x[10]), o);
  }
  const library: Library = { objects, byClass, byName, census, files: [...new Set(objects.map((o) => o.file))], ...(materials.size ? { materials } : {}) };
  const w = hasTable(db, "model_weather") ? db.exec("SELECT path, epw, ddy FROM model_weather LIMIT 1")[0]?.values[0] : undefined;
  const z = hasTable(db, "model_climate") ? db.exec("SELECT json FROM model_climate LIMIT 1")[0]?.values[0] : undefined;
  const meta = new Map((db.exec("SELECT key, value FROM meta")[0]?.values ?? []).map((m) => [String(m[0]), String(m[1])]));
  return {
    ledger: ledger as unknown as BemLedger,
    tariff,
    library,
    weather: w ? { path: String(w[0]), epw: String(w[1]), ddy: w[2] === null ? null : String(w[2]) } : null,
    zone: z ? (JSON.parse(String(z[0])) as CountyZoneRead) : null,
    committedAt: meta.get("model_committed_at") ?? "",
    libraryCount: rows.length,
  };
}

/** a rebuilt idf.db (a BIM correction re-derives the geometry) keeps the model committed to the one before it — the same file only */
export function carryModelInputs(from: Database, to: Database): boolean {
  if (!holdsModel(from)) return false;
  to.exec(DDL);
  for (const t of MODEL_TABLES) {
    to.run(`DELETE FROM ${t}`);
    const res = from.exec(`SELECT * FROM ${t}`)[0];
    if (!res) continue;
    const st = to.prepare(`INSERT INTO ${t} VALUES (${res.columns.map(() => "?").join(",")})`);
    for (const row of res.values) st.run(row);
    st.free();
  }
  for (const k of ["model_committed_at", "model_ledger_saved_at"]) {
    const v = from.exec("SELECT value FROM meta WHERE key = ?", [k])[0]?.values[0]?.[0];
    if (v !== undefined && v !== null) putMeta(to, k, String(v));
  }
  return true;
}

/** the first line two IDF texts differ at — the proof's word when a commit does not reproduce the model */
export function firstDifference(a: string, b: string): { line: number; was: string; now: string } | null {
  if (a === b) return null;
  const A = a.split("\n"), B = b.split("\n");
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return { line: i + 1, was: A[i] ?? "(none)", now: B[i] ?? "(none)" };
  return null;
}

// ── THE COMMIT AND THE BUILD, one code path for the app (pipeline.ts) and the gate ──────────────────────────────────────────────

/** the weather read from idf.db's own texts (or the file's, at a commit) */
export function weatherOfStore(t: ModelWeather, designDays: string[] | undefined): WeatherRead | null {
  const io = { exists: () => true, readText: (p: string) => (/\.ddy$/i.test(p) ? t.ddy ?? "" : t.epw) };
  return readWeather(t.path, io, { designDays });
}

const idfOf = (built: BuiltModel, weather: WeatherRead | null): string => {
  const i = built.input;
  return writeIdf(i.faces, i.elements, i.zoneVolumesM3, i.site, i.trueNorth, i.sourceIfcName, weather, built.model).idf;
};

/** COMMIT: build once on the live libraries through the recording proxy, write what it read into idf.db; the live IDF is the proof's
 *  reference. The caller stamps and saves idf.db. */
export function commitModel(db: Database, c: { ledger: BemLedger; library: Library | null; weather: ModelWeather | null; zone: CountyZoneRead | null; model: IdfModel; schema: EpSchema | null; tariff?: IdfModel["tariff"] }): string {
  const rec = c.library ? recordingLibrary(c.library) : null;
  const weather = c.weather ? weatherOfStore(c.weather, c.ledger.site?.designDays) : null;
  const live = buildModel(readBemInput(db), c.ledger, weather, c.model, c.zone, rec?.library ?? null, c.schema, c.tariff ?? null);
  const idf = idfOf(live, weather);
  writeModelInputs(db, { ledger: c.ledger, used: rec?.used() ?? [], weather: c.weather, zone: c.zone, tariff: c.tariff ?? null });
  return idf;
}

/** THE BUILD FROM idf.db ALONE: the geometry, the rulings, the library objects, the weather and the climate zone all read from it;
 *  only the engine's own grammar (the schema) and version come from outside — they are the engine's, not the model's */
export function buildFromStore(db: Database, model: IdfModel, schema: EpSchema | null, weatherOverride?: ModelWeather): { stored: ModelInputs; input: BemInput; built: BuiltModel; weather: WeatherRead | null } | null {
  const stored = readModelInputs(db);
  if (!stored) return null;
  const input = readBemInput(db);
  // a CALIBRATION run (BOM, 2026-10-09) takes the model as committed on the actual year's weather — the store's own weather untouched
  const w = weatherOverride ?? stored.weather;
  const weather = w ? weatherOfStore(w, weatherOverride ? undefined : stored.ledger.site?.designDays) : null;
  return { stored, input, built: buildModel(input, stored.ledger, weather, model, stored.zone, stored.library, schema, stored.tariff), weather };
}

/** the proof: the IDF built from idf.db alone against the live libraries' */
export function proveStore(liveIdf: string, storeIdf: string): { ok: boolean; lines: number; diff: ReturnType<typeof firstDifference> } {
  const diff = firstDifference(liveIdf, storeIdf);
  return { ok: diff === null, lines: storeIdf.split("\n").length, diff };
}
