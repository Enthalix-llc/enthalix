// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ELECTRICAL SHEET (user, 2026-10-02: "the PV panel system needs to be assembled like the mechanical systems" — "with components
// below the system view, and details of the components shown in right column"; the chain ruled the same day: Array → Inverter →
// Load centre → Utility; the panel count edited by PICKING panels). The sheet is the MECHANICAL sheet's own canvas, bench and
// column; what differs is its cards and its connectors. A card is one EnergyPlus object, as on MECHANICAL — but these objects are
// joined by NAMING one another (a load centre names its generator list and its inverter), not by nodes, so the schema has no node
// field to read a connector from: the connectors are STATED here, one line per card, direct current from an array to an inverter,
// alternating current from the inverter to a load centre and from the load centre to the utility. The compile reads the lines into
// the load centres the writer emits; what the engine cannot take is refused and named on the card.

import { type Assembly, type AsmNode, addNode, addEdge, patchNode } from "./assembly.js";
import type { EpSchema } from "./epSchema.js";
import type { Catalogue, CatEntry, CatPort } from "./epCatalogue.js";
import type { SystemFields } from "./bemDb.js";
import type { PvPanel } from "./pvArrays.js";

export const ELEC_CLASS = { array: "Generator:PVWatts", inverter: "ElectricLoadCenter:Inverter:PVWatts", centre: "ElectricLoadCenter:Distribution", utility: "Output:Meter" } as const;
/** the bench's shelves for the sheet, outside in: what generates, what converts, what distributes */
export const ELEC_SHELVES = ["GENERATION", "INVERTERS", "DISTRIBUTION"];
const P = (key: string, medium: "dc" | "ac", dir: "in" | "out", label: string): CatPort => ({ key, medium, dir, label });
const SPECS: Array<{ cls: string; shelf: string; label: string; sub: string; ports: CatPort[] }> = [
  { cls: ELEC_CLASS.array, shelf: "GENERATION", label: "PV array", sub: "the panels it holds (ticked in the column, read from the projected files) — one Generator:PVWatts per panel on its own top face, the module, mounting and losses the array's", ports: [P("dc-out", "dc", "out", "DC")] },
  { cls: ELEC_CLASS.inverter, shelf: "INVERTERS", label: "Inverter (PVWatts)", sub: "turns the arrays' DC to AC: its efficiency and the DC-to-AC ratio — microinverters on every panel are written as one, their shared efficiency", ports: [P("dc-in", "dc", "in", "DC"), P("ac-out", "ac", "out", "AC")] },
  { cls: ELEC_CLASS.centre, shelf: "DISTRIBUTION", label: "Load centre", sub: "the panel the inverter feeds: ElectricLoadCenter:Distribution, Baseload, a DC buss with its one inverter", ports: [P("ac-in", "ac", "in", "AC"), P("grid-out", "ac", "out", "Grid")] },
  { cls: ELEC_CLASS.utility, shelf: "DISTRIBUTION", label: "Utility — net metering", sub: "the service: what the house buys, what it sells back and the net, the engine's facility meters (no batteries — the user's ruling); priced by BOM › TARIFFS", ports: [P("grid-in", "ac", "in", "Grid")] },
];

/** the sheet's catalogue: the four cards, their connectors stated (the canvas and the bench read it as they read MECHANICAL's) */
export function readElecCatalogue(schema: EpSchema | null): Catalogue {
  const entries = new Map<string, CatEntry>(), missing: string[] = [];
  for (const s of SPECS) {
    const c = schema?.classOf(s.cls) ?? null;
    if (schema && !c) missing.push(s.cls);
    entries.set(s.cls, { cls: s.cls, group: c?.group ?? "", tier: "component", shelf: s.shelf, label: s.label, sub: s.sub, ports: s.ports, unread: [], zoneAttached: false, accepts: {} });
  }
  return {
    entries, missing, census: `${entries.size} electrical cards${missing.length ? ` · NOT IN THE SCHEMA ${missing.join(", ")}` : ""}`,
    of: (cls) => entries.get(cls) ?? null,
    byShelf: (shelf) => [...entries.values()].filter((e) => e.shelf === shelf),
  };
}

/** the panels an array card holds: express ids, kept in its fields as one list */
export const PANELS_FIELD = "panels";
export const panelsOf = (n: AsmNode): number[] => String(n.fields?.[PANELS_FIELD] ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
export function withPanels(asm: Assembly, id: string, panels: number[]): Assembly {
  return patchNode(asm, id, (n) => { const f: SystemFields = { ...(n.fields ?? {}) }; if (panels.length) f[PANELS_FIELD] = [...new Set(panels)].sort((a, b) => a - b).join(","); else delete f[PANELS_FIELD]; return { ...n, fields: f }; });
}

export interface ElecArray { node: string; name: string; panels: number[]; fields: SystemFields }
export interface ElecCentre { node: string; name: string; inverter: { node: string; name: string; fields: SystemFields }; arrays: ElecArray[]; utility: string | null }
export interface ElecCompiled { centres: ElecCentre[]; refusals: Array<{ node: string; text: string }>; cautions: Array<{ node: string; text: string }>;
  /** panel → the array card that holds it (the first; a second holder is refused) */
  owner: Map<number, string> }

const nameOf = (n: AsmNode): string => n.ident?.trim() || n.label || SPECS.find((s) => s.cls === n.cls)?.label || n.id;
const fieldsOf = (n: AsmNode): SystemFields => { const f: SystemFields = { ...(n.fields ?? {}) }; delete f[PANELS_FIELD]; return f; };

/** the sheet → the load centres the writer emits. `available` = the panels the projected files carry; absent, any id is taken */
export function compileElectrical(asm: Assembly, available?: ReadonlySet<number>): ElecCompiled {
  const refusals: ElecCompiled["refusals"] = [], cautions: ElecCompiled["cautions"] = [];
  const refuse = (n: AsmNode, text: string): void => { refusals.push({ node: n.id, text: `${nameOf(n)} ${text}` }); };
  const of = (cls: string): AsmNode[] => asm.nodes.filter((n) => n.kind === "component" && n.cls === cls);
  const linesFrom = (n: AsmNode, port: string): AsmNode[] => asm.edges.filter((e) => e.from === n.id && e.fromPort === port).map((e) => asm.nodes.find((x) => x.id === e.to)).filter((x): x is AsmNode => !!x);
  const linesInto = (n: AsmNode, port: string): AsmNode[] => asm.edges.filter((e) => e.to === n.id && e.toPort === port).map((e) => asm.nodes.find((x) => x.id === e.from)).filter((x): x is AsmNode => !!x);
  const owner = new Map<number, string>();
  // the arrays: their panels, each held once, and the one inverter their DC runs to
  const goodArrays = new Map<string, { a: ElecArray; inverter: string }>();
  for (const n of of(ELEC_CLASS.array)) {
    const ids = panelsOf(n);
    const absent = available ? ids.filter((x) => !available.has(x)) : [];
    const twice = ids.filter((x) => owner.has(x));
    for (const x of ids) if (!owner.has(x)) owner.set(x, n.id);
    const inv = linesFrom(n, "dc-out").filter((x) => x.cls === ELEC_CLASS.inverter);
    let ok = true;
    if (!ids.length) { refuse(n, "holds no panel — tick its panels in the column"); ok = false; }
    if (absent.length) { refuse(n, `holds ${absent.length} panel${absent.length === 1 ? "" : "s"} the projected files do not carry (#${absent.slice(0, 4).join(", #")}${absent.length > 4 ? " …" : ""}) — project the file on SITE, or untick them`); ok = false; }
    if (twice.length) { refuse(n, `holds ${twice.length} panel${twice.length === 1 ? "" : "s"} another array already holds (#${twice.slice(0, 4).join(", #")}${twice.length > 4 ? " …" : ""}) — a panel is in one array`); ok = false; }
    if (!inv.length) { refuse(n, "— its DC out runs to no inverter: connect it to an inverter's DC in"); ok = false; }
    if (inv.length > 1) { refuse(n, "— its DC out runs to two inverters: an array feeds one"); ok = false; }
    if (ok) goodArrays.set(n.id, { a: { node: n.id, name: nameOf(n), panels: ids, fields: fieldsOf(n) }, inverter: inv[0]!.id });
  }
  // the inverters: the arrays they take and the one load centre their AC runs to
  const goodInverters = new Map<string, { n: AsmNode; arrays: ElecArray[]; centre: string }>();
  for (const n of of(ELEC_CLASS.inverter)) {
    const arrays = [...goodArrays.values()].filter((g) => g.inverter === n.id).map((g) => g.a);
    const fed = linesInto(n, "dc-in").length;
    const centres = linesFrom(n, "ac-out").filter((x) => x.cls === ELEC_CLASS.centre);
    let ok = true;
    if (!fed) { refuse(n, "— no array feeds its DC in"); ok = false; }
    else if (!arrays.length) { refuse(n, "— every array feeding it is refused (see the arrays)"); ok = false; }
    if (!centres.length) { refuse(n, "— its AC out runs to no load centre"); ok = false; }
    if (centres.length > 1) { refuse(n, "— its AC out runs to two load centres: an inverter feeds one"); ok = false; }
    if (ok) goodInverters.set(n.id, { n, arrays, centre: centres[0]!.id });
  }
  // the load centres: ONE inverter each (ElectricLoadCenter:Distribution names one), the utility their Grid runs to
  const centres: ElecCentre[] = [];
  for (const n of of(ELEC_CLASS.centre)) {
    const invs = [...goodInverters.values()].filter((g) => g.centre === n.id);
    const fed = linesInto(n, "ac-in").length;
    const util = linesFrom(n, "grid-out").filter((x) => x.cls === ELEC_CLASS.utility);
    if (!fed) { refuse(n, "— nothing feeds its AC in"); continue; }
    if (fed > 1) { refuse(n, "— two inverters feed it: EnergyPlus gives a load centre ONE inverter (ElectricLoadCenter:Distribution names one) — give the second inverter its own load centre"); continue; }
    if (!invs.length) { refuse(n, "— the inverter feeding it is refused (see the inverter)"); continue; }
    if (!util.length) cautions.push({ node: n.id, text: `${nameOf(n)} is not connected to the utility — what it produces is still metered (the facility meters are the house's), the sheet just does not show where the surplus goes` });
    const inv = invs[0]!;
    centres.push({ node: n.id, name: nameOf(n), inverter: { node: inv.n.id, name: nameOf(inv.n), fields: fieldsOf(inv.n) }, arrays: inv.arrays, utility: util[0]?.id ?? null });
  }
  const utils = of(ELEC_CLASS.utility);
  for (const n of utils.slice(1)) cautions.push({ node: n.id, text: `${nameOf(n)}: the house has one service — the utility is the facility's meters, a second card adds nothing` });
  return { centres, refusals, cautions, owner };
}

/** the roof faces the panels sit on: one normal within 3° and one plane within 0.3 m — the file's own arrays */
export function panelFaces(panels: PvPanel[]): PvPanel[][] {
  const faces: Array<{ n: [number, number, number]; d: number; ps: PvPanel[] }> = [];
  const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  for (const p of panels) {
    const d = dot(p.poly[0]!, p.normal);
    const f = faces.find((x) => dot(x.n, p.normal) > Math.cos((3 * Math.PI) / 180) && Math.abs(x.d - d) < 0.3);
    if (f) f.ps.push(p); else faces.push({ n: p.normal, d, ps: [p] });
  }
  return faces.map((f) => f.ps).sort((a, b) => b.length - a.length);
}

/** A FIRST SHEET FROM THE FILE: an array per roof face holding its panels, one inverter, one load centre, the utility, wired — the
 *  house's one service; `legacy` carries the fields of the PV form this sheet replaces onto its cards (module, mounting, losses on
 *  every array; the inverter's efficiency and ratio) */
export function sheetFromFile(panels: PvPanel[], legacy?: SystemFields): Assembly {
  let asm: Assembly = { nodes: [], edges: [] };
  const pick = (keys: string[]): SystemFields => { const f: SystemFields = {}; for (const k of keys) if (legacy?.[k] !== undefined && legacy[k] !== "") f[k] = legacy[k]!; return f; };
  const faces = panelFaces(panels);
  const add = (cls: string, label: string, x: number, y: number, fields?: SystemFields): string => {
    const r = addNode(asm, { node: "component", cls, label }, x, y); asm = r.asm;
    if (fields && Object.keys(fields).length) asm = patchNode(asm, r.id, (n) => ({ ...n, fields }));
    return r.id;
  };
  const mid = Math.max(0, (faces.length - 1) * 48);
  const inv = add(ELEC_CLASS.inverter, "Inverter", 296, mid, pick(["dc_to_ac_size_ratio", "inverter_efficiency"]));
  const elc = add(ELEC_CLASS.centre, "Load centre", 560, mid);
  const util = add(ELEC_CLASS.utility, "Utility — net metering", 824, mid);
  faces.forEach((ps, i) => {
    const tilt = ps.reduce((t, p) => t + p.tiltDeg, 0) / ps.length;
    const id = add(ELEC_CLASS.array, `Array ${String.fromCharCode(65 + (i % 26))} · ${ps.length} panel${ps.length === 1 ? "" : "s"} at ${tilt.toFixed(0)}°`, 0, i * 96, pick(["module_type", "array_type", "system_losses"]));
    asm = withPanels(asm, id, ps.map((p) => p.expressId));
    asm = addEdge(asm, id, inv, "dc-out", "dc-in");
  });
  asm = addEdge(asm, inv, elc, "ac-out", "ac-in");
  asm = addEdge(asm, elc, util, "grid-out", "grid-in");
  return asm;
}
