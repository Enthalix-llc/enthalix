// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ELECTRICAL › GENERATION — THE PV ARRAYS (user, 2026-10-02: "add renewable energy to the Electrical system subtab, starting
// with PV" — the array READ FROM THE IFC; the batteries were never installed, so production is accounted by net metering).
// One Generator:PVWatts per PANEL the projected files carry: each of this house's panels sits on its own IQ8H microinverter, so
// each produces on its own. The array names the panel's own top face as its surface ("Surface — the array geometry (tilt and
// azimuth) as well as shading is determined from the surface referenced", the schema's note): the engine reads the tilt, the
// azimuth from true north (the Building north axis included) and the shade of the trees and the roofs from that face. Nothing
// is derived that the file states: the panel's rating is READ from its type name ("SILFAB 380w" → 380 W, the 2026-09-10 ruling
// on names), its face from its own triangles. The PVWatts inputs the file cannot state are the PVWatts Version 5 Manual's own
// defaults (Dobos 2014, NREL/TP-6A20-62641), each the user's to rule.

type V3 = [number, number, number];
export interface PvElementIn { expressId: number; file: string; name: string; tris: V3[][] }
export interface PvPanel { expressId: number; file: string; name: string; kind: string; watts: number; poly: V3[]; normal: V3; areaM2: number; tiltDeg: number }
export type PvFieldKey = "module_type" | "array_type" | "system_losses" | "dc_to_ac_size_ratio" | "inverter_efficiency";
export interface PvRulingIn { enabled: boolean; fields?: Partial<Record<PvFieldKey, string | number>> }
export interface ResolvedPv {
  panels: PvPanel[];
  /** the inputs the writer states, each with where it came from */
  moduleType: { value: string; source: "user" | "dataset"; why: string };
  arrayType: { value: string; source: "user" | "dataset" };
  systemLosses: { value: number; source: "user" | "dataset" };
  dcToAc: { value: number; source: "user" | "dataset" };
  inverterEfficiency: { value: number; source: "user" | "dataset" };
  dcW: number;
  /** panels the file carries that cannot be written, each with its reason */
  refused: string[];
  /** THE SHEET'S LOAD CENTRES (2026-10-02, ELECTRICAL assembled like MECHANICAL): each its inverter and its arrays, each array its
   *  panels and its own module / mounting / losses; absent = the PV form's one load centre over every panel */
  centres?: PvCentre[];
}
export interface PvArrayOut { name: string; panels: PvPanel[]; moduleType: ResolvedPv["moduleType"]; arrayType: ResolvedPv["arrayType"]; systemLosses: ResolvedPv["systemLosses"] }
export interface PvCentre { name: string; inverter: { name: string; dcToAc: ResolvedPv["dcToAc"]; efficiency: ResolvedPv["inverterEfficiency"] }; arrays: PvArrayOut[] }
/** the sheet as the resolver takes it (elecSheet.ts compiles it): cards by name, an array's panels by express id, the fields as typed */
export interface PvSheetIn { centres: Array<{ name: string; inverter: { name: string; fields: Record<string, string | number> }; arrays: Array<{ name: string; panels: number[]; fields: Record<string, string | number> }> }>; refusals: Array<{ text: string }> }

/** the PVWatts Version 5 Manual's defaults (NREL/TP-6A20-62641): system losses 14 %, DC-to-AC 1.1, inverter 96 % */
export const PVWATTS_DEFAULTS = { systemLosses: 0.14, dcToAc: 1.1, inverterEfficiency: 0.96, arrayType: "FixedRoofMounted", citation: "PVWatts Version 5 Manual (Dobos 2014, NREL/TP-6A20-62641)" } as const;
/** the manual's three module types by their nominal efficiency (Table 2): the type is the one nearest the panel's own */
export const PV_MODULE_TYPES: Array<{ id: string; nominal: number; label: string }> = [
  { id: "Standard", nominal: 0.15, label: "Standard — crystalline silicon, about 15 %" },
  { id: "Premium", nominal: 0.19, label: "Premium — high-efficiency crystalline, about 19 %" },
  { id: "ThinFilm", nominal: 0.10, label: "Thin film — about 10 %" },
];
export const PV_ARRAY_TYPES: Array<{ id: string; label: string }> = [
  { id: "FixedRoofMounted", label: "fixed, roof mounted — close to the roof, little air behind (the manual's choice for a residential roof)" },
  { id: "FixedOpenRack", label: "fixed, open rack — air on both sides" },
];

/** a panel the files carry, by its name (the gate's own rule since 2026-09-10) */
export const isPvPanel = (name: string): boolean => /solar[_ -]?panel|photovolt/i.test(name);
/** the rating stated in the type name: "SILFAB 380w" → 380; null when the name states none */
export function ratingW(name: string): number | null {
  const m = /(\d{2,4}(?:\.\d+)?)\s*w(?:att)?s?\b/i.exec(name.split(":").pop() ?? name);
  return m ? Number(m[1]) : null;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** THE PANEL'S TOP FACE from its own triangles (house frame, Y up): the panel's plane is the area-weighted normal of its
 *  upward-facing triangles; the top face is the triangles facing that way at the panel's highest offset along it (within 1 cm —
 *  a frame lip a little lower is not the glass); its outline is the convex hull of their corners, wound counter-clockwise about
 *  the upward normal so the face looks at the sky (the engine's outward rule). Null when the panel states no such face. */
export function panelTopFace(tris: V3[][]): { poly: V3[]; normal: V3; areaM2: number } | null {
  const facets = tris.filter((t) => t.length === 3).map((t) => {
    const c = cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!)), a = Math.hypot(c[0], c[1], c[2]) / 2;
    return { t, n: unit(c), a };
  }).filter((f) => f.a > 1e-8);
  // the panel's plane: the LARGEST upward facet (the glass) and every facet parallel to it, area-weighted — never the frame's
  // sides, which tilt an average by a degree or two and so move a 1.9 m panel's far corner by centimetres (measured 2026-10-02)
  const seed = facets.filter((f) => f.n[1] > 0.3).sort((a, b) => b.a - a.a)[0];
  if (!seed) return null;
  const facing = facets.filter((f) => dot(f.n, seed.n) > Math.cos(5 * Math.PI / 180));
  const sum: V3 = [0, 0, 0];
  for (const f of facing) for (let k = 0; k < 3; k++) sum[k] = sum[k]! + f.n[k]! * f.a;
  const N = unit(sum);
  // the top face: the parallel facets at the panel's highest offset along N, each judged by its centre (within 1 cm)
  const cen = (t: V3[]): number => (dot(t[0]!, N) + dot(t[1]!, N) + dot(t[2]!, N)) / 3;
  const top = Math.max(...facing.map((f) => cen(f.t)));
  const pts: V3[] = [];
  for (const f of facing) if (cen(f.t) > top - 0.01) for (const p of f.t) if (!pts.some((q) => Math.hypot(...sub(p, q)) < 1e-3)) pts.push(p);
  if (pts.length < 3) return null;
  // the hull in the face's own frame (u, v) — Andrew's monotone chain, counter-clockwise about N
  const u = unit(Math.abs(N[1]) < 0.99 ? cross([0, 1, 0], N) : cross([1, 0, 0], N)), v = cross(N, u);
  const uv = pts.map((p) => ({ p, x: dot(p, u), y: dot(p, v) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: typeof uv[number], a: typeof uv[number], b: typeof uv[number]): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof uv = [], upper: typeof uv = [];
  for (const q of uv) { while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...uv].reverse()) { while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;
  let area = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i]!, b = hull[(i + 1) % hull.length]!; area += a.x * b.y - b.x * a.y; }
  return { poly: hull.map((h) => h.p), normal: N, areaM2: Math.abs(area) / 2 };
}

const num = (v: string | number | undefined): number | null => { const n = typeof v === "number" ? v : v !== undefined && v !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

/** every PV panel the projected files carry, read from its name and its own triangles; what cannot be read is named */
export function readPanels(elements: PvElementIn[]): { panels: PvPanel[]; refused: string[] } {
  const panels: PvPanel[] = [], refused: string[] = [];
  for (const e of elements) {
    if (!isPvPanel(e.name)) continue;
    const kind = e.name.replace(/:\d+$/, "");
    const w = ratingW(kind);
    if (w === null) { refused.push(`${kind} #${e.expressId}: its name states no wattage — type one on the panel's kind`); continue; }
    const face = panelTopFace(e.tris);
    if (!face) { refused.push(`${kind} #${e.expressId}: no upward face in its geometry`); continue; }
    panels.push({ expressId: e.expressId, file: e.file, name: e.name, kind, watts: w, poly: face.poly, normal: face.normal, areaM2: face.areaM2, tiltDeg: Math.acos(Math.min(1, face.normal[1])) * 180 / Math.PI });
  }
  if (!panels.length && !refused.length) refused.push("no PV panel in the projected files — project the file that carries them on SITE");
  return { panels, refused };
}
/** the module type nearest the panels' own efficiency: their stated watts over their drawn face, at the standard 1000 W/m² */
function moduleFor(panels: PvPanel[], typedIn: unknown): ResolvedPv["moduleType"] {
  const eff = panels.length ? panels.reduce((t, p) => t + p.watts, 0) / (1000 * panels.reduce((t, p) => t + p.areaM2, 0)) : null;
  const nearest = eff !== null ? [...PV_MODULE_TYPES].sort((a, b) => Math.abs(a.nominal - eff) - Math.abs(b.nominal - eff))[0]! : PV_MODULE_TYPES[0]!;
  const typed = typeof typedIn === "string" && PV_MODULE_TYPES.some((m) => m.id === typedIn) ? typedIn : null;
  return typed ? { value: typed, source: "user", why: "ruled" } : { value: nearest.id, source: "dataset", why: eff !== null ? `${(eff * 100).toFixed(1)} % — the panels' stated W over their drawn face at 1000 W/m², nearest the manual's ${nearest.id} (${(nearest.nominal * 100).toFixed(0)} %)` : "no panel read — the manual's Standard" };
}
const arrayTypeOf = (v: unknown): ResolvedPv["arrayType"] => (typeof v === "string" && PV_ARRAY_TYPES.some((a) => a.id === v) ? { value: v, source: "user" } : { value: PVWATTS_DEFAULTS.arrayType, source: "dataset" });
const numOr = (v: unknown, d: number): { value: number; source: "user" | "dataset" } => { const n = num(v as string | number | undefined); return n !== null ? { value: n, source: "user" } : { value: d, source: "dataset" }; };

/** the panels of the projected files and the inputs the writer states for them; null when PV is not ruled on */
export function resolvePv(elements: PvElementIn[], ruling: PvRulingIn | undefined): ResolvedPv | null {
  if (!ruling?.enabled) return null;
  const { panels, refused } = readPanels(elements);
  const f = ruling.fields ?? {};
  return {
    panels, refused,
    moduleType: moduleFor(panels, f.module_type),
    arrayType: arrayTypeOf(f.array_type),
    systemLosses: numOr(f.system_losses, PVWATTS_DEFAULTS.systemLosses),
    dcToAc: numOr(f.dc_to_ac_size_ratio, PVWATTS_DEFAULTS.dcToAc),
    inverterEfficiency: numOr(f.inverter_efficiency, PVWATTS_DEFAULTS.inverterEfficiency),
    dcW: panels.reduce((t, p) => t + p.watts, 0),
  };
}

/** THE SHEET'S PV (2026-10-02): each load centre its inverter and its arrays, each array its own panels and settings; a panel the
 *  files do not read is named, a sheet that compiles to nothing writes nothing (its refusals named) */
export function resolvePvSheet(elements: PvElementIn[], sheet: PvSheetIn): ResolvedPv {
  const read = readPanels(elements);
  const byId = new Map(read.panels.map((p) => [p.expressId, p]));
  const refused = [...read.refused.filter((r) => !r.startsWith("no PV panel") || !sheet.centres.length), ...sheet.refusals.map((r) => r.text)];
  const centres: PvCentre[] = sheet.centres.map((c) => ({
    name: c.name,
    inverter: { name: c.inverter.name, dcToAc: numOr(c.inverter.fields.dc_to_ac_size_ratio, PVWATTS_DEFAULTS.dcToAc), efficiency: numOr(c.inverter.fields.inverter_efficiency, PVWATTS_DEFAULTS.inverterEfficiency) },
    arrays: c.arrays.map((a) => {
      const ps = a.panels.map((id) => byId.get(id)).filter((p): p is PvPanel => !!p);
      for (const id of a.panels) if (!byId.has(id)) refused.push(`${a.name}: panel #${id} is not read from the projected files`);
      return { name: a.name, panels: ps, moduleType: moduleFor(ps, a.fields.module_type), arrayType: arrayTypeOf(a.fields.array_type), systemLosses: numOr(a.fields.system_losses, PVWATTS_DEFAULTS.systemLosses) };
    }).filter((a) => a.panels.length),
  })).filter((c) => c.arrays.length);
  const panels = centres.flatMap((c) => c.arrays.flatMap((a) => a.panels));
  const first = centres[0]?.arrays[0];
  return {
    panels, refused, centres,
    moduleType: first?.moduleType ?? moduleFor([], undefined), arrayType: first?.arrayType ?? arrayTypeOf(undefined), systemLosses: first?.systemLosses ?? numOr(undefined, PVWATTS_DEFAULTS.systemLosses),
    dcToAc: centres[0]?.inverter.dcToAc ?? numOr(undefined, PVWATTS_DEFAULTS.dcToAc), inverterEfficiency: centres[0]?.inverter.efficiency ?? numOr(undefined, PVWATTS_DEFAULTS.inverterEfficiency),
    dcW: panels.reduce((t, p) => t + p.watts, 0),
  };
}
