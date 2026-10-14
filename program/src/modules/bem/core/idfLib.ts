// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE LIBRARY IS READ (2026-09-08). EnergyPlus ships its own datasets beside
// the engine — ASHRAE_2005_HOF_Materials.idf (204 Material, 64 NoMass, 2
// AirGap, 15 Constructions), CompositeWallConstructions.idf (12 framed and
// block walls as their 1-D equivalents, 36 materials), WindowConstructs.idf
// (207 glazing constructions, EVERY one preceded by a `! U= SHGC= TSOL= TVIS=`
// note), WindowGlassMaterials.idf (62) and WindowGasMaterials.idf (16). This
// module parses them as they are: a comment-aware object splitter that keeps
// the note before a Construction, an index by class and by name, a layer
// resolver, and ΣR of a stack with the films the engine adds stated. The
// name-matching of the file's layers to these materials is a HEURISTIC that
// offers candidates for the user to pick — never applied by itself.

export const LIB_FILES = ["ASHRAE_2005_HOF_Materials.idf", "CompositeWallConstructions.idf", "WindowConstructs.idf", "WindowGlassMaterials.idf", "WindowGasMaterials.idf"] as const;
/** THE EQUIPMENT DATASETS (2026-09-12): read into the library as EXTRA objects, never into the materials seed — each file by
 *  its path under the engine's install and the classes kept from it: the single-speed water-to-air coils' curves from the
 *  DataSets, and the VARIABLE-SPEED SPEED SET from the engine's own example (its two 10-speed coils with their reference-unit
 *  capacities, flows and curves — the engine autosizes the nominal speed's capacity and scales every speed to it) */
export const CURVE_FILES: ReadonlyArray<{ path: string; keep: RegExp }> = [
  { path: "DataSets/WaterToAirHeatPumps.idf", keep: /^Curve:/ },
  { path: "ExampleFiles/VSHeatPumpWaterToAirEquationFit.idf", keep: /^(Curve:|Coil:(Cooling|Heating):WaterToAirHeatPump:VariableSpeedEquationFit$)/ },
];
/** the objects a curve file contributes: its text parsed, the classes the entry keeps */
export const parseCurveFile = (text: string, entry: { path: string; keep: RegExp }): IdfObject[] =>
  parseIdfObjects(text, entry.path.split("/").pop() ?? entry.path).filter((o) => entry.keep.test(o.cls));

export interface IdfObject {
  cls: string;
  name: string;
  /** every field, the name first, as the dataset states it (comments stripped, trimmed) */
  fields: string[];
  file: string;
  /** the `! U=… SHGC=… TSOL=… TVIS=…` line before a window Construction, verbatim */
  note: string | null;
  /** the last banner of `!` lines above the object that cites a source ("ASHRAE Handbook of Fundamentals, 2005, Chapter 30, Table 19 and Table 22") — the dataset's own word (2026-09-08) */
  provenance?: string;
  /** a materials.db row's key, when the object came from there */
  key?: string;
  /** the row's kind (the colour), when the object came from materials.db */
  kind?: string;
}
export interface Library {
  objects: IdfObject[];
  byClass: Map<string, IdfObject[]>;
  byName: Map<string, IdfObject>;
  census: Record<string, number>;
  files: string[];
  /** materials.db's rows as objects, by key (2026-09-08) — the pick pool when it is there */
  materials?: Map<string, IdfObject>;
}

/** the objects of one dataset: `!` comments stripped, a `! U=` line kept for the Construction that follows it */
export function parseIdfObjects(text: string, file: string): IdfObject[] {
  const out: IdfObject[] = [];
  let note: string | null = null;
  let buf = "";
  // a BANNER is a run of whole-line `!` comments (not `!-` field notes, not the `! U=` note); the last
  // one that cites a source is the provenance of the objects under it — "! use with InternalMass" is not
  let banner: string[] = [];
  let provenance: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const bang = raw.indexOf("!");
    const code = bang >= 0 ? raw.slice(0, bang) : raw;
    const comment = bang >= 0 ? raw.slice(bang) : "";
    const c = comment.trim();
    if (/^!\s*U=/.test(c)) note = c.replace(/^!\s*/, "");
    else if (!code.trim() && c.startsWith("!") && !c.startsWith("!-")) { const t = c.replace(/^!+\s*/, "").replace(/^=+$/, "").trim(); if (t) banner.push(t); continue; }
    if (!code.trim()) continue;
    if (banner.length) { const t = banner.join(" "); if (/chapter|table|ashrae|handbook|report|source/i.test(t)) provenance = t; banner = []; }
    buf += code + " ";
    let semi = buf.indexOf(";");
    while (semi >= 0) {
      const stmt = buf.slice(0, semi);
      buf = buf.slice(semi + 1);
      const fields = stmt.split(",").map((s) => s.trim());
      const cls = fields.shift() ?? "";
      if (cls) {
        out.push({ cls, name: fields[0] ?? "", fields, file, note: cls === "Construction" ? note : null, ...(provenance ? { provenance } : {}) });
        if (cls === "Construction") note = null;
      }
      semi = buf.indexOf(";");
    }
  }
  return out;
}

/** the datasets' objects, with any read elsewhere appended as they are (the schedule files, 2026-09-09) */
export function parseLibrary(files: Array<{ file: string; text: string }>, extra: IdfObject[] = []): Library {
  const objects = [...files.flatMap((f) => parseIdfObjects(f.text, f.file)).filter((o) => o.cls !== "Version"), ...extra];
  const byClass = new Map<string, IdfObject[]>(), byName = new Map<string, IdfObject>();
  const census: Record<string, number> = {};
  for (const o of objects) {
    (byClass.get(o.cls) ?? byClass.set(o.cls, []).get(o.cls)!).push(o);
    if (!byName.has(o.name)) byName.set(o.name, o);
    census[o.cls] = (census[o.cls] ?? 0) + 1;
  }
  return { objects, byClass, byName, census, files: [...files.map((f) => f.file), ...new Set(extra.map((o) => o.file))] };
}

/** a Construction and every layer it names — null when a layer is not in the library */
export function resolveConstruction(lib: Library, name: string): { cons: IdfObject; layers: IdfObject[] } | null {
  const cons = lib.byName.get(name);
  if (!cons || cons.cls !== "Construction") return null;
  const layers: IdfObject[] = [];
  for (const ln of cons.fields.slice(1)) {
    if (!ln) continue;
    const l = lib.byName.get(ln);
    if (!l || l.cls === "Construction") return null;
    layers.push(l);
  }
  return layers.length ? { cons, layers } : null;
}

const num = (s: string | undefined): number | null => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

/** a layer's own resistance, m²K/W: thickness / conductivity for a Material or a glazing, the stated R for NoMass / AirGap; null for a gas (the engine models it) */
export function layerR(o: IdfObject): number | null {
  if (o.cls === "Material" || o.cls === "WindowMaterial:Glazing") {
    const th = num(o.fields[o.cls === "Material" ? 2 : 3]), k = num(o.fields[o.cls === "Material" ? 3 : 13]);
    return th !== null && k !== null && k > 0 ? th / k : null;
  }
  if (o.cls === "Material:NoMass") return num(o.fields[2]);
  if (o.cls === "Material:AirGap") return num(o.fields[1]);
  return null;
}
/** a Material's thickness in metres, null when it has none */
export const layerThickness = (o: IdfObject): number | null => (o.cls === "Material" ? num(o.fields[2]) : o.cls === "WindowMaterial:Glazing" || o.cls === "WindowMaterial:Gas" ? num(o.fields[o.cls === "WindowMaterial:Gas" ? 2 : 3]) : null);

/** ΣR of a stack, and the layers whose R the library does not state */
export function stackR(layers: IdfObject[]): { rSi: number; unknown: string[] } {
  let rSi = 0;
  const unknown: string[] = [];
  for (const l of layers) { const r = layerR(l); if (r === null) unknown.push(l.name); else rSi += r; }
  return { rSi, unknown };
}
/** the inside + outside air films the engine adds, m²K/W (ASHRAE: 0.12 + 0.03 wall, 0.11 + 0.03 ceiling, 0.16 + 0.05 floor) — U here is 1 / (ΣR + film) */
/** THE FILMS the engine adds to a construction's layers (cited 2026-09-15, the review's uncited-defaults pass): ASHRAE Handbook — Fundamentals,
 *  "Surface Conductances and Resistances for Air" (Ch. 26 in 2017, Ch. 25 in 2021): still air inside — a vertical surface with horizontal
 *  heat flow 0.12 m²K/W (R-0.68), a horizontal surface with heat flow up 0.11 (R-0.61), heat flow down 0.16 (R-0.92); outside, air moving
 *  at 15 mph (the winter value) 0.03 (R-0.17). So wall 0.12 + 0.03 = 0.15 · ceiling 0.11 + 0.03 = 0.14 · floor 0.16 + 0.05 = 0.21, the floor's
 *  outside 0.05 a stated rounding of the summer 7.5 mph value (0.044). The IRC's assembly U-factors include these films. */
export const FILMS = { wall: 0.15, ceiling: 0.14, floor: 0.21 } as const;

/** the dataset's own word on a window construction: centre-of-glass U (winter), SHGC and TVIS (summer, normal incidence) */
export function windowNote(o: IdfObject): { u: number; shgc: number; tsol: number | null; tvis: number | null } | null {
  const m = o.note && /U=([\d.]+)\s+SHGC=([\d.]+)(?:\s+TSOL=([\d.]+))?(?:\s+TVIS=([\d.]+))?/.exec(o.note);
  return m ? { u: Number(m[1]), shgc: Number(m[2]), tsol: m[3] ? Number(m[3]) : null, tvis: m[4] ? Number(m[4]) : null } : null;
}

/** the tokens a file's layer name and a dataset's material name may share — a HEURISTIC that ranks candidates for the user; never applied by itself */
const TOKENS: Array<[RegExp, RegExp]> = [
  [/gypsum|gwb|plaster/i, /gypsum|plaster/i], [/plywood|sheathing|osb/i, /plywood|sheathing|wood panel/i], [/siding|clapboard/i, /siding/i],
  [/brick/i, /brick/i], [/concrete|cast-in-place/i, /concrete(?! block)/i], [/cmu|block/i, /concrete block/i], [/batt|insulation/i, /batt|insulation/i],
  [/shingle/i, /shingle/i], [/metal panel|steel|aluminum|metal/i, /metal surface|steel/i], [/^air$|air space|air gap/i, /air space|air gap|airspace/i],
  [/vapor|vapour/i, /vapor|felt|polyethylene|film/i], [/carpet/i, /carpet/i], [/tile|terrazzo/i, /tile|terrazzo/i], [/stucco|eifs/i, /stucco|eifs/i],
  [/oak|pine|flooring|softwood|lumber|wood/i, /wood/i], [/stone/i, /stone/i], [/glass/i, /clear|glass/i],
];
export function matchMaterials(lib: Library, layer: { material: string; thicknessM: number | null; category: string | null }): IdfObject[] {
  // the pool is materials.db when it is there (it holds the datasets' rows and more), else the datasets themselves
  const opaque = lib.materials ? [...lib.materials.values()] : [...(lib.byClass.get("Material") ?? []), ...(lib.byClass.get("Material:NoMass") ?? []), ...(lib.byClass.get("Material:AirGap") ?? [])];
  const zero = layer.thicknessM !== null && layer.thicknessM < 1e-6;
  // a composite's own numbered layers (#1, #2 …) are its 1-D equivalents, not materials to pick
  const pool = (zero ? opaque.filter((o) => o.cls !== "Material") : opaque).filter((o) => !/ #\d+$/.test(o.name));
  const scored = pool.map((o) => {
    let s = 0;
    for (const [mine, theirs] of TOKENS) if (mine.test(layer.material) && theirs.test(o.name)) s += 2;
    const th = layerThickness(o);
    if (!zero && layer.thicknessM !== null && th !== null) s += Math.max(0, 1 - Math.abs(th - layer.thicknessM) / Math.max(layer.thicknessM, 0.01));
    if (/^ASHRAE_2005_HOF|^materials:hof2005/.test(o.file)) s += 0.1;
    return { o, s };
  }).filter((x) => x.s >= 1.5).sort((a, b) => b.s - a.s);
  return scored.slice(0, 8).map((x) => x.o);
}

/** the stud layer's thickness names the composite (2026-09-08): 5½″ → 2x6, 3½″ → 2x4 — the dataset's own equivalents, wood or steel by the file's word */
export function compositeFor(lib: Library, layer: { material: string; thicknessM: number | null }): IdfObject | null {
  if (layer.thicknessM === null) return null;
  const depth = Math.abs(layer.thicknessM - 0.1397) < 0.01 ? "2x6" : Math.abs(layer.thicknessM - 0.0889) < 0.01 ? "2x4" : null;
  if (!depth) return null;
  const steel = /metal|steel/i.test(layer.material);
  return (lib.byClass.get("Construction") ?? []).find((o) => o.name.includes(depth) && o.name.includes(steel ? "Steel Stud" : "Wood Stud") && !/Brick|Foam/.test(o.name)) ?? null;
}

export function formatLibraryCensus(lib: Library): string {
  const n = (c: string): number => lib.census[c] ?? 0;
  const win = lib.byClass.get("Construction")?.filter((o) => o.file.startsWith("WindowConstructs")) ?? [];
  return `Material ${n("Material")} · NoMass ${n("Material:NoMass")} · AirGap ${n("Material:AirGap")} · Construction ${n("Construction")} (windows ${win.length}, U stated ${win.filter((o) => windowNote(o)).length}) · glass ${n("WindowMaterial:Glazing")} · gas ${n("WindowMaterial:Gas")}`;
}

/** the object as the IDF takes it: class, then every field — the dataset's own text */
export const idfObjectFields = (o: IdfObject): string[] => o.fields.slice(1);

/** a zone equipment class's objects → the zone they serve (NAME → ZONE, both UPPERCASE), through ZoneHVAC:EquipmentConnections (zone,
 *  equipment list) and ZoneHVAC:EquipmentList (its equipment in sixes after the scheme: type, name, cooling and heating sequence, two fraction schedules) */
export function zoneEquipmentZones(idf: string, cls: string): Map<string, string> {
  const objs = parseIdfObjects(idf, "in.idf"), listZone = new Map<string, string>(), out = new Map<string, string>();
  for (const o of objs) if (o.cls === "ZoneHVAC:EquipmentConnections" && o.fields[0] && o.fields[1]) listZone.set(o.fields[1].toUpperCase(), o.fields[0].toUpperCase());
  for (const o of objs) {
    if (o.cls !== "ZoneHVAC:EquipmentList" || !o.fields[0]) continue;
    const zone = listZone.get(o.fields[0].toUpperCase());
    if (!zone) continue;
    for (let i = 2; i + 1 < o.fields.length; i += 6) if ((o.fields[i] ?? "").toUpperCase() === cls.toUpperCase() && o.fields[i + 1]) out.set(o.fields[i + 1]!.toUpperCase(), zone);
  }
  return out;
}

/** THE REPORT'S UNITS (user, 2026-10-11: "Is it possible to recreate the energyplus report to be created in imperial units?"): the HTML
 *  report is written in the units the user shows — inch-pound (Btu/h, kBtu, °F, ft², cfm) under Show Imperial. Set at RUN time on the
 *  run's own in.idf, never on the model: a toggle of the units is not a change of the building (the model's sha stays, Run stays as it
 *  was), and the sql the app reads stays in SI (Output:SQLite's own unit field, JtoKWH) */
export function withReportUnits(idf: string, units: "si" | "ip"): string {
  return units === "ip" ? idf.replace(/(OutputControl:Table:Style,\s*\w+,\s*)JtoKWH;/, "$1InchPound;") : idf;
}
