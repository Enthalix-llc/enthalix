// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE DETAIL VIEW (user, 2026-09-08: "the view will show plan or detail, as
// with wall assembly"). For the selected type, a section through its assembly
// drawn TO SCALE from the FILE's own layer set — name, thickness and category
// per layer, outside on the left — with, beside each layer, the resistance the
// governing construction gives it in its source colour; the foot states ΣR,
// the films the engine adds, the U that follows, and the file's stated U. A
// window or door is drawn as an elevation at the file's OverallWidth ×
// OverallHeight with the parts the file names. Nothing here is derived: the
// drawing is the file's word, the numbers are the ruling's.
//
// EDITING (user, 2026-09-08, later): the layers are SELECTABLE — a band in the
// drawing or a row in the list under it — and the options table under the
// view then reads the layer. The drawing reads the STAGED ruling joined to
// the file's layers by seq (never the emitted effective material): a picked
// material colours its band by the material's KIND from the database; a
// layer with PARTS (the stud and the batt between the studs) is painted the
// fill's colour with the framing drawn as a rectangle inside it at its
// fraction of the band's height — the band's height read as one framing
// module, since the vertical axis has no scale. The IDF name is typed here.

import { Fragment, useEffect, useRef, useState } from "react";
import type { TypeRow } from "../constructionTypes.js";
import { fenValues } from "../constructionTypes.js";
import { sanitizeIdfName, CODE_VT, type ResolvedConstruction } from "../core/bemIdf.js";
import { layerR, layerThickness, resolveConstruction, windowNote, FILMS, type IdfObject, type Library } from "../core/idfLib.js";
import { effectiveLayer, partR, FRAMING_DEFAULTS, ruledStack } from "../core/bemModel.js";
import { KIND_LABELS, resolveMaterialRef, kindOfName, absStated, type MaterialKind, type MaterialClass, type MaterialRow } from "../core/materialsDb.js";
import type { ConstructionRuling, LayerCustom } from "../core/bemDb.js";
import { fmtLen, fmtTemp, srcClass, NumInput, InfoTip } from "./bemUi.js";
import { cFactor, slabFactors, F_TABLE_CITE, C_TABLE_CITE, type SlabPlan } from "../core/groundCoupling.js";

const U_IP = 5.678263;
const fmtR = (r: number | null, imperial: boolean): string => (r === null ? "—" : imperial ? `R-${(r / 0.17611).toFixed(1)}` : `${r.toFixed(2)} m²K/W`);
/** the number alone, for a cell under the R header (user, 2026-09-16: "adding R- to the r value is redundant if labeled at top") */
const fmtRn = (r: number | null, imperial: boolean): string => (r === null ? "—" : imperial ? (r / 0.17611).toFixed(1) : r.toFixed(2));
const fmtU = (u: number | null, imperial: boolean): string => (u === null ? "—" : imperial ? `U ${(u / U_IP).toFixed(3)}` : `U ${u.toFixed(3)}`);
const fmtTh = (m: number, imperial: boolean): string => (imperial ? `${(m * 39.3701).toFixed(m * 39.3701 < 0.1 && m > 0 ? 4 : 2).replace(/(\.\d{2}\d*?[1-9])0+$/, "$1")}″` : `${(m * 1000).toFixed(m * 1000 < 1 && m > 0 ? 2 : 0)} mm`);

/** the colour of a material's KIND — the database's word first, the file's category and the name after (2026-09-08) */
export const KIND_FILL: Record<MaterialKind, string> = {
  roofing: "#26272b", siding: "#f4f4f0", wood: "#d9b88a", plywood: "#e2c99c", concrete: "#b9bcc4", masonry: "#c98a6d", gypsum: "#efe8d8",
  "insulation-batt": "#e7b8d6", "insulation-rigid": "#f0c8de", metal: "#8fa3bd", membrane: "#5c6270", air: "#f6f7fb", glass: "#bfe3f5", gas: "#f6f7fb", generic: "#d5d8e0",
};
/** THE OUTLINE FOLLOWS THE FILL (user, 2026-09-29: "its outline can be white so as to see it with the view black background"): a
 *  dark band is drawn with a light outline, a light band with a dark one — by the fill's relative luminance */
export function outlineFor(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return "#333";
  const v = parseInt(m[1]!, 16), lin = (c: number): number => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return L < 0.18 ? "#e8e8ec" : "#333";
}
function fillOf(kind: string | null | undefined, cat: string | null, name: string, cls?: string): string {
  if (kind && kind in KIND_FILL) return KIND_FILL[kind as MaterialKind];
  const c: MaterialClass = cls === "Material:NoMass" || cls === "Material:AirGap" ? cls : "Material";
  return KIND_FILL[kindOfName(name, c, cat)];
}
const srcOf = (o: IdfObject): string => (o.file === "built" || o.file.startsWith("materials:hand") ? "user" : "dataset");
/** a material object's solar absorptance field: a Material's 8th, a NoMass's 5th (IDD order); none on an AirGap or a short object */
const solarAbsOf = (o: IdfObject): number | null => { const i = o.cls === "Material" ? 7 : o.cls === "Material:NoMass" ? 4 : -1; const f = i >= 0 ? o.fields[i] : undefined; const v = f === undefined || f === "" ? NaN : Number(f); return Number.isFinite(v) ? v : null; };
/** the thermal absorptance field (the long-wave emittance, a product sheet's TE): a Material's 7th, a NoMass's 4th */
const thermalAbsOf = (o: IdfObject): number | null => { const i = o.cls === "Material" ? 6 : o.cls === "Material:NoMass" ? 3 : -1; const f = i >= 0 ? o.fields[i] : undefined; const v = f === undefined || f === "" ? NaN : Number(f); return Number.isFinite(v) ? v : null; };
/** STATED OR THE ENGINE'S DEFAULT (2026-09-29): a materials.db row says it (absStated); a dataset object read by name says it when its
 *  own fields reach that far — the DataSets' HOF materials stop before the absorptances, and the engine fills 0.9 / 0.7 */
const statedOf = (o: IdfObject, row: MaterialRow | null): { thermal: boolean; solar: boolean } => row ? absStated(row) : { thermal: o.fields.length > (o.cls === "Material" ? 6 : 3) && o.fields[o.cls === "Material" ? 6 : 3] !== "", solar: o.fields.length > (o.cls === "Material" ? 7 : 4) && o.fields[o.cls === "Material" ? 7 : 4] !== "" };
const FRAMING_RE = /wood|softwood|lumber|stud|joist|rafter|framing/i;

export interface DrawPath { name: string; fraction: number; rSi: number | null; kind: string | null; src: string; sourceText: string | null; framing: boolean }
export interface DrawLayer {
  seq: number; name: string; cat: string | null;
  /** the number from the outside as ruled (null when deleted); the user's deletion or addition (2026-09-09) */
  position: number | null; deleted: boolean; added: boolean;
  thickness: number | null; thicknessSrc: "file" | "user" | "dataset";
  /** the thickness was TYPED (not the picked row's own) — the only case the × to put it back shows (2026-09-29: a row of the
   *  user's own reads in the user's colour, and its own thickness showed the × as if typed) */
  thicknessTyped?: boolean;
  /** the material picked (its name), null when none */
  material: string | null; kind: string | null; cls?: string;
  rSi: number | null; src: string; sourceText: string | null;
  /** the picked material's solar absorptance as its object states it (the engine's 0.7 written when a row has none); null with no material —
   *  the REFLECTANCE the view shows is 1 − it (user, 2026-09-16: "We need Reflectance up in view table as well") */
  solarAbs: number | null;
  /** the thermal absorptance (TE) as the object states it, null with no material (2026-09-29) */
  thermalAbs?: number | null;
  /** which of the two are the ENGINE'S DEFAULTS rather than stated — shown greyed (2026-09-29) */
  absDefault?: { thermal: boolean; solar: boolean };
  paths: DrawPath[]; picked: boolean; method?: string;
  /** the category ruled by the user (the file's name reads otherwise) */
  kindSrc?: "user";
  /** a custom edit drafted on the layer (2026-09-29): its name, R and reflectance override the pick's until Apply assembly saves them */
  custom?: LayerCustom;
}
/** THE STACK THE DRAWING READS: the file's layers joined to the staged ruling by seq; a library construction's own
 *  objects when one governs; never the emitted effective material — one arithmetic with the resolver (effectiveLayer) */
export function stackOf(row: TypeRow, stage: ConstructionRuling | undefined, lib: Library | null, film: number, rowOf?: (key: string) => MaterialRow | null): { layers: DrawLayer[]; how: "file" | "layers" | "library" } {
  const fileLayers = row.layers.filter((l) => !l.part);
  if (stage?.source === "library" && stage.library && lib) {
    const res = resolveConstruction(lib, stage.library.name);
    if (res) return { how: "library", layers: res.layers.map((o, i) => ({ seq: i, position: i + 1, deleted: false, added: false, name: o.name, cat: null, thickness: layerThickness(o), thicknessSrc: "file", material: o.name, solarAbs: solarAbsOf(o), thermalAbs: thermalAbsOf(o), absDefault: (({ thermal, solar }) => ({ thermal: !thermal, solar: !solar }))(statedOf(o, null)), kind: o.kind ?? null, cls: o.cls, rSi: layerR(o), src: srcOf(o), sourceText: o.provenance ?? `${o.file} (EnergyPlus DataSets)`, paths: [], picked: true })) };
  }
  // THE STACK AS RULED (2026-09-09): the file's layers joined to their picks, the user's added layers in place, the deleted ones struck
  const stack = ruledStack(fileLayers, stage?.source === "layers" ? stage.layers : undefined);
  const layers: DrawLayer[] = stack.map((rl) => ({ seq: rl.seq, position: rl.position, deleted: rl.deleted, added: rl.added, name: rl.file?.material ?? rl.pick.material, cat: rl.file?.category ?? null, solarAbs: null, thickness: rl.file?.thicknessM ?? (rl.added ? rl.pick.thicknessM ?? null : null), thicknessSrc: "file", material: null, kind: null, rSi: null, src: rl.added ? "user" : "file", sourceText: null, paths: [], picked: false }));
  if (stage?.source !== "layers" || !lib) return { how: "file", layers };
  const byD = new Map(layers.map((d) => [d.seq, d]));
  const partsOf = new Map<number, Array<{ o: IdfObject; fraction: number }>>();
  for (const rl of stack) {
    const d = byD.get(rl.seq)!, l = rl.pick;
    if (rl.deleted) continue;
    if (l.kind) { d.kind = l.kind; d.kindSrc = "user"; }   // the ruled category paints the band until a material is picked
    if (l.thicknessM !== undefined) {
      // the picked row's own thickness reads in the row's colour; a typed one in the user's
      const po = l.ref ? resolveMaterialRef(lib, l.ref) : null, pt = po ? layerThickness(po) : null;
      const own = pt !== null && Math.abs(pt - l.thicknessM) < 1e-6;
      d.thickness = l.thicknessM; d.thicknessSrc = own ? (srcOf(po!) as "user" | "dataset") : "user"; d.thicknessTyped = !own;
    }
    const th = d.thickness ?? 0;
    if (l.parts && l.parts.length) {
      const ps: Array<{ o: IdfObject; fraction: number }> = [];
      for (const q of l.parts) { const o = resolveMaterialRef(lib, q.ref); if (o) ps.push({ o, fraction: q.fraction }); }
      d.paths = ps.map((q) => ({ name: q.o.name, fraction: q.fraction, rSi: th > 0 ? partR(q.o, th) : null, kind: q.o.kind ?? null, src: srcOf(q.o), sourceText: q.o.provenance ?? null, framing: FRAMING_RE.test(q.o.name) }));
      if (!d.paths.some((q) => q.framing) && d.paths.length) d.paths[0]!.framing = true;
      partsOf.set(d.seq, ps);
      d.material = d.paths.map((q) => q.name).join(" + "); d.picked = ps.length === l.parts.length && ps.length > 0; d.method = l.method ?? "parallel-path";
      const fill = d.paths.filter((q) => !q.framing).sort((a, b) => b.fraction - a.fraction)[0] ?? d.paths[0];
      d.kind = fill?.kind ?? null;
      continue;
    }
    const ref = l.ref ?? (l.library ? { file: l.library.file, name: l.library.name } : null);
    if (ref) {
      const o = resolveMaterialRef(lib, ref);
      if (!o) { d.material = "key" in ref ? ref.key : ref.name; d.sourceText = "not in the library"; continue; }
      d.material = o.name; d.kind = o.kind ?? null; d.cls = o.cls; d.picked = true; d.solarAbs = solarAbsOf(o); d.thermalAbs = thermalAbsOf(o);
      { const st = statedOf(o, "key" in ref ? rowOf?.(ref.key) ?? null : null); d.absDefault = { thermal: !st.thermal, solar: !st.solar }; }
      d.rSi = o.cls === "Material" && th > 0 ? partR(o, th) : layerR(o);
      d.src = srcOf(o); d.sourceText = o.provenance ?? `${o.file.replace(/^materials:/, "")}`;
      continue;
    }
    if (l.rSi !== undefined && l.rSi > 0) { d.material = `R ${l.rSi.toFixed(2)} typed`; d.rSi = l.rSi; d.src = "user"; d.sourceText = "a typed R — one massless layer"; d.picked = true; d.kind = "insulation-rigid"; }
  }
  // A CUSTOM EDIT (2026-09-29): what was typed in the list reads over the pick — the name, the R at this thickness, the reflectance
  for (const rl of stack) {
    const c = rl.pick.custom, d = byD.get(rl.seq)!;
    if (!c || rl.deleted || d.paths.length) continue;
    d.custom = c;
    if (c.name !== undefined) d.material = c.name;
    if (c.rSi !== undefined) { d.rSi = c.rSi; d.picked = true; }
    if (c.refl !== undefined) { d.solarAbs = 1 - c.refl; d.absDefault = { thermal: d.absDefault?.thermal ?? false, solar: false }; }
    if (c.te !== undefined) { d.thermalAbs = c.te; d.absDefault = { solar: d.absDefault?.solar ?? false, thermal: false }; }
    d.src = "user"; d.sourceText = c.source?.trim() ? c.source.trim() : `a custom edit${d.sourceText ? ` of ${d.sourceText}` : ""} — saved as a material of yours on Apply assembly`;
  }
  // the bridged layers last: a parallel path's R needs the rest of the stack (the resolver's own order)
  const rPlain = layers.reduce((t, d) => t + (d.paths.length ? 0 : d.rSi ?? 0), 0);
  const isoOf = new Map<number, number>();
  for (const [seq, ps] of partsOf) { const e = effectiveLayer(ps, byD.get(seq)!.thickness ?? 0, 0, 0, "isothermal-planes"); if (e) isoOf.set(seq, e.rIsothermal); }
  for (const [seq, ps] of partsOf) {
    const d = byD.get(seq)!;
    const rOthers = rPlain + [...isoOf].filter(([q]) => q !== seq).reduce((t, [, r]) => t + r, 0);
    const e = effectiveLayer(ps, d.thickness ?? 0, rOthers, film, (d.method as "parallel-path" | "isothermal-planes") ?? "parallel-path");
    if (!e) { d.sourceText = "a part states no R, or the fractions do not sum to 1"; d.picked = false; continue; }
    d.rSi = e.rEff;
    const def = FRAMING_DEFAULTS[row.kind === "roof" || row.kind === "ceiling" ? "roof" : row.kind === "floor" ? "floor" : "wall"].fraction;
    const framing = d.paths.find((q) => q.framing);
    d.src = d.paths.some((q) => q.src === "user") || (framing && Math.abs(framing.fraction - def) > 1e-6) || d.method === "isothermal-planes" ? "user" : "dataset";
    d.sourceText = `${d.method === "parallel-path" ? "parallel path (ASHRAE HOF Ch. 27)" : "isothermal planes"}: R ${e.rParallel.toFixed(2)} / ${e.rIsothermal.toFixed(2)} · framing ${((framing?.fraction ?? 0) * 100).toFixed(0)} %`;
  }
  return { how: "layers", layers };
}

export interface DetailInput {
  row: TypeRow | null;
  /** the type's ruled construction as APPLIED, when one governs — its U printed beside the staged stack's */
  resolved: ResolvedConstruction | null;
  /** the code default the type's cells carry: the construction's layer names and U */
  code: { name: string; layers: string[]; uWm2k: number | null; shgc?: number | null; vt?: number | null } | null;
  /** a window's or door's stated size, from one element of the type */
  overall: { w: number; h: number } | null;
  imperial: boolean;
  /** a floor type with cells on the ground (slice 4): the method ruled, the depth the cells sit at, the deepest wall part beside them */
  ground?: { method: string; depthM: number; wallDepthM: number; slabThickM: number; cells: number; of: number;
    /** the slab's insulation as ruled and the code's (2026-10-10), the edition and zone the code row is read for */
    plan: SlabPlan; code: string; wallR: number;
    /** what EnergyPlus is given: the slab's construction(s) as written, the below-grade walls beside it by construction */
    slabConstructions: Array<{ name: string; layers: string[] }>; walls: Array<{ name: string; uWm2k: number | null; areaM2: number; layers: string[]; thickM: Array<number | null> }>;
    /** the last run's annual conduction through these slab cells (into the zone +), and the method that run was written with */
    run: { stamp: string; kwh: number; cells: number; current: boolean } | null };
  /** the STAGED ruling for this type — the drawing reads the composition as staged; Apply is in the column */
  stage?: ConstructionRuling;
  /** the library with materials.db's rows: a ref resolves to the object drawn */
  library?: Library | null;
  /** a materials.db row by key — tells a stated surface value from the engine's default (2026-09-29) */
  rowOf?: (key: string) => MaterialRow | null;
  /** when `sameAs` governs: the target type and its staged ruling — the target's stack is drawn */
  alias?: { key: string; row: TypeRow | null; stage: ConstructionRuling | undefined } | null;
  /** the selected LAYER (its seq), and the two ways to select one */
  layerSel?: number | null;
  onLayer?: (seq: number | null) => void;
  /** a right-click on a band or a row (user, 2026-09-09): delete the layer, add one beside it, add a sub-item */
  onLayerMenu?: (seq: number, x: number, y: number) => void;
  /** THE THICKNESS TYPED IN THE LIST (user, 2026-09-09: "we need a method to correct the thickness value, and the image
   *  must change"): the layer's thickness in metres, undefined = back to the file's (or the picked row's own) */
  onThickness?: (seq: number, thicknessM: number | undefined) => void;
  /** A CUSTOM EDIT typed in the list (2026-09-29): a patch on the layer's draft; null drops the draft */
  onCustom?: (seq: number, patch: LayerCustom | null) => void;
  /** the IDF name typed in the head */
  onName?: (name: string | undefined) => void;
  /** the staged ruling differs from the applied one */
  staged?: boolean;
  /** THE VIEW'S APPLY (user, 2026-09-16): this type's staged assembly — its name, its layers added, deleted and picked — goes to
   *  the column and the model; `stagedSummary` says what would be written (describeStage); revert puts the applied ruling back */
  onApply?: () => void;
  onRevert?: () => void;
  stagedSummary?: string | null;
}

/** THE STAGED CHANGES IN WORDS (2026-09-16): what the view's Apply would write — the name, what governs, the layers changed,
 *  added, deleted or restored, a product or a dataset construction chosen; null when the stage equals the applied ruling */
export function describeStage(st: ConstructionRuling | undefined, ap: ConstructionRuling | undefined): string | null {
  if (JSON.stringify(st ?? null) === JSON.stringify(ap ?? null)) return null;
  const parts: string[] = [];
  if ((st?.name ?? "") !== (ap?.name ?? "")) parts.push(st?.name ? `named "${st.name}"` : "the name cleared");
  const gs = st?.source ?? "code", ga = ap?.source ?? "code";
  const word = (g: string, s: ConstructionRuling | undefined): string => g === "layers" ? "the assembly" : g === "u" ? "a U / NFRC set" : g === "library" ? "a dataset construction" : g === "sameAs" ? `same as ${s?.sameAs ?? "?"}` : g === "file" ? "the IFC's stated U" : "the code default";
  if (gs !== ga) parts.push(`governs: ${word(gs, st)}`);
  if (gs === "layers" || ga === "layers") {
    const a = new Map((ap?.source === "layers" ? ap.layers ?? [] : []).map((l) => [l.seq, l]));
    const s = new Map((st?.source === "layers" ? st.layers ?? [] : []).map((l) => [l.seq, l]));
    let changed = 0, added = 0, deleted = 0, restored = 0;
    for (const [seq, l] of s) {
      const o = a.get(seq);
      if (!o) { if (l.added) added++; else if (l.deleted) deleted++; else changed++; continue; }
      if (!!l.deleted !== !!o.deleted) { if (l.deleted) deleted++; else restored++; }
      else if (JSON.stringify(l) !== JSON.stringify(o)) changed++;
    }
    for (const [seq, o] of a) if (!s.has(seq)) { if (o.added) deleted++; else changed++; }
    if (changed) parts.push(`${changed} layer${changed > 1 ? "s" : ""} changed`);
    if (added) parts.push(`${added} layer${added > 1 ? "s" : ""} added`);
    if (deleted) parts.push(`${deleted} deleted`);
    if (restored) parts.push(`${restored} restored`);
    const custom = [...s.values()].filter((l) => l.custom && !l.deleted).length;
    if (custom) parts.push(`${custom} custom edit${custom > 1 ? "s" : ""} — saved as your material${custom > 1 ? "s" : ""} on Apply`);
  }
  if (gs === "u" && ga === "u" && (st?.uWm2k !== ap?.uWm2k || st?.shgc !== ap?.shgc || st?.vt !== ap?.vt || st?.product?.key !== ap?.product?.key)) parts.push(st?.product ? `product ${st.product.name}` : "the U set typed");
  if (gs === "library" && ga === "library" && st?.library?.name !== ap?.library?.name) parts.push(`dataset construction "${st?.library?.name ?? "?"}"`);
  if (gs === "sameAs" && ga === "sameAs" && st?.sameAs !== ap?.sameAs) parts.push(`same as ${st?.sameAs ?? "?"}`);
  return parts.length ? parts.join(" · ") : "changed";
}
/** a source's short name for the layer list (2026-09-16: the citation wrapped to three lines and pushed the thickness input off its label); the whole text stays on hover */
export function shortSource(s: string): string {
  const cut = (s.split(/ · | — | \(/)[0] ?? s).trim();
  return cut.length > 34 ? `${cut.slice(0, 32)}…` : cut;
}

/** THE SLAB EDGE ENLARGED (user, 2026-10-12: "the below slab insulation turns up at perimeter wall"): the slab and its insulation to scale
 *  at about ¼ full size — the turn-up between the slab's edge and the exterior (foundation) wall — the thermal break the code requires (user, 2026-10-12), from the slab's top to its bottom, the strip under
 *  the slab beyond it, broken where it runs on to its distance; the wall's own inside insulation stands on the slab above the turn-up */
function EdgeDetail(p: { th: number; ins: number; r: number; dist: number | null; imperial: boolean;
  /** the slab's below-grade wall as the model writes it, outside first (2026-10-12, the user: "the interior basement wall is 3.5" thick with
   *  0.5" drywall interior, so the wall should be twice the width of the upturn insulation"): drawn to scale — its first layer runs on down
   *  past the slab, the layers inside it stand on the slab */
  wall?: { name: string; layers: string[]; thickM: Array<number | null> } }): React.ReactElement {
  const s = 700, W = 760, top = 46;                       // px per metre
  const th = p.th * s, ins = p.ins > 0 ? Math.max(14, p.ins * s) : 0;
  const known = !!p.wall && p.wall.layers.length > 0 && p.wall.thickM.every((x) => x !== null && x > 0);
  const lay = known ? p.wall!.layers.map((n, i) => ({ name: n, m: p.wall!.thickM[i]!, px: Math.max(3, p.wall!.thickM[i]! * s) }))
    : [{ name: "foundation wall", m: 0, px: 130 }, { name: "the wall's own inside insulation", m: 0, px: 40 }];   // no wall: a schematic width
  const wallL = 40, wallR = wallL + lay[0]!.px;          // the first layer's inside face — the turn-up stands against it
  const fmt = (m: number): string => fmtTh(m, p.imperial);
  const inner = lay.slice(1);
  const xi = wallR + inner.reduce((a, l) => a + l.px, 0); // the wall's inside face (the room side)
  const slabTop = top + 110, slabBot = slabTop + th, insBot = slabBot + ins, bottom = insBot + 34, xe = W - 190;
  const zig = (x: number, y0: number, y1: number): string => `M${x} ${y0} l6 ${(y1 - y0) / 4} l-12 ${(y1 - y0) / 4} l12 ${(y1 - y0) / 4} l-6 ${(y1 - y0) / 4}`;
  return (
    <svg className="detailSvg" viewBox={`0 0 ${W} ${bottom + 30}`} width="100%">
      <text x="6" y="16" className="lbl strong">the slab's edge (to scale, about ¼ full size)</text>
      {/* the soil: outside the wall, and under the slab and its insulation */}
      <rect x="0" y={top} width={wallL} height={bottom - top} fill="#6b5a3e" opacity="0.3" />
      <rect x={wallL} y={insBot} width={xe - wallL} height={bottom - insBot} fill="#6b5a3e" opacity="0.3" />
      {/* the foundation wall, and its own inside insulation standing on the slab */}
      <rect x={wallL} y={top} width={wallR - wallL} height={bottom - top} fill={known ? fillOf(null, null, lay[0]!.name) : "#b9bcc4"} stroke="#333" strokeWidth="0.8"><title>{lay[0]!.name}</title></rect>
      {(() => { let x = wallR; return inner.map((l, i) => { const x0 = x; x += l.px; const f = known ? fillOf(null, null, l.name) : "#f3d36b";
        return <rect key={i} x={x0} y={top} width={l.px} height={slabTop - top} fill={f} stroke={outlineFor(f)} strokeWidth="0.8"><title>{`${l.name} · ${fmt(l.m)}`}</title></rect>; }); })()}
      {/* the turn-up and the strip under the slab, one piece */}
      {ins > 0 && <path d={`M${wallR} ${slabTop} h${ins} v${th} H${xe} v${ins} H${wallR} Z`} fill="#e7b8d6" stroke="#a06090" strokeWidth="1" />}
      {/* the slab */}
      <rect x={wallR + ins} y={slabTop} width={xe - wallR - ins} height={th} fill="#c9ccd4" stroke="#333" strokeWidth="0.8" />
      <path d={zig(xe, slabTop - 6, insBot + 6)} stroke="#ccc" fill="none" strokeWidth="1.2" />
      {/* the labels */}
      <text x={xi + 10} y={top + 16} className="lbl">inside · the room</text>
      <text x={wallR - 6} y={top + 30} className="lbl" textAnchor="end" style={{ fill: "#1d1d1d" }}>exterior wall</text>
      <text x={wallR - 6} y={top + 44} className="lbl" textAnchor="end" style={{ fill: "#1d1d1d" }}>{known ? fmt(lay[0]!.m) : "(foundation)"}</text>
      {known ? inner.map((l, i) => <text key={i} x={xi + 10} y={top + 36 + i * 14} className="lbl">{fmt(l.m)} · {l.name.length > 52 ? `${l.name.slice(0, 51)}…` : l.name}</text>)
        : <text x={xi + 6} y={slabTop - 62} className="lbl">the wall's own inside insulation, on the slab</text>}
      {known && <text x={xi + 10} y={top + 36 + inner.length * 14} className="lbl">{fmt(inner.reduce((a, l) => a + l.m, 0))} inside the {lay[0]!.name.split(/[\s:,(-]/)[0]!.toLowerCase()}, standing on the slab<title>{p.wall!.name}</title></text>}
      {ins > 0 && <>
      <line x1={wallR + ins / 2} y1={slabTop + 6} x2={xi + 6} y2={slabTop - 24} stroke="#a06090" />
      <text x={xi + 10} y={slabTop - 32} className="lbl">R-{p.r}, {fmt(p.ins)}, turned up the slab's edge against the exterior wall —</text>
      <text x={xi + 10} y={slabTop - 19} className="lbl">the code's thermal break</text>
      </>}
      <text x={wallR + ins + 10} y={slabTop + th / 2 + 4} className="lbl" style={{ fill: "#1d1d1d" }}>slab {fmt(p.th)} · its top is the floor (inside)</text>
      {ins > 0 ? <text x={wallR + ins + 10} y={slabBot + ins / 2 + 4} className="lbl" style={{ fill: "#1d1d1d" }}>R-{p.r} under the slab</text>
        : <text x={wallR + 10} y={slabBot + 18} className="lbl">no slab insulation</text>}
      {ins > 0 && <text x={xe + 12} y={slabBot + 4} className="lbl">{p.dist !== null ? `on to ${fmt(p.dist).replace("″", "")}″` : "on under"}</text>}
      {ins > 0 && <text x={xe + 12} y={slabBot + 18} className="lbl">{p.dist !== null ? "from the wall's face" : "the full slab"}</text>}
      <text x={xi + ins + 10} y={bottom - 8} className="lbl">the ground</text>
      {/* the slab's thickness, dimensioned at the turn-up */}
      <line x1={wallR - 10} y1={slabTop} x2={wallR - 10} y2={slabBot} stroke="#ddd" />
      <line x1={wallR - 14} y1={slabTop} x2={wallR - 6} y2={slabTop} stroke="#ddd" />
      <line x1={wallR - 14} y1={slabBot} x2={wallR - 6} y2={slabBot} stroke="#ddd" />
    </svg>
  );
}

function FoundationSection(p: { g: NonNullable<DetailInput["ground"]>; imperial: boolean }): React.ReactElement {
  const { g, imperial } = p;
  // THE SLAB EDGE (user, 2026-10-10: "showing insulation under the slab in detail, and noting distance under slab from edge. The
  // equivalent code required C or F factor approach needs to be shown, along with energyplus modeling value"): the section drawn with the
  // insulation where the ruling puts it, the code's requirement and the standard's F and C beside it, and what the engine is given. Since
  // 2026-10-12 the slab's edge enlarged is the one drawing (user: "Just keep the bottom detail, and delete the upper two as they do not
  // contribute") — the whole-depth section and the layer stack above it are gone for a slab on the ground
  const pl = g.plan;
  // THE VIEW IS THE DRAWING (user, 2026-10-12: "the views are intended for images and graphs, with exception of construction detail which
  // identifies the materials in a table below detail image … these tables need to show in the right column"): the slab's facts are
  // GroundFacts, in the column's Floors section
  return <EdgeDetail wall={g.walls[0]} th={g.slabThickM || 0.1016} ins={pl.r > 0 ? pl.r * 0.1761 * 0.029 : 0} r={pl.r} dist={pl.extent === "full" ? null : pl.distM} imperial={imperial} />;
}

/** THE SLAB'S FACTS, for the right column (2026-10-12, moved out of the view): the selected floor on the ground — where it lies, the
 *  distance from the slab's top against the code's, the walls' C, the turn-up as EnergyPlus takes it, the constructions as written and the
 *  last run's heat through the slab. The code's R, the F values and the insulation as Kiva takes it are the Floors section's own lines */
export function GroundFacts(p: { g: NonNullable<DetailInput["ground"]>; label: string; imperial: boolean }): React.ReactElement {
  const { g, imperial } = p;
  const pl = g.plan, cF = cFactor(g.wallR);
  const len = (m: number): string => fmtLen(m, imperial);
  const u = (v: number | null): string => (v === null ? "—" : imperial ? `U ${(v / 5.678263).toFixed(3)} Btu/h·ft²·°F` : `U ${v.toFixed(3)} W/m²K`);
  return (
    <div className="groundFacts">
      <div className="idfInfo"><b>{p.label}</b> on the ground · {g.cells} of {g.of} cells at or under the ground line · {g.depthM >= 0.01 ? `${len(g.depthM)} below grade` : "at grade"} · wall parts below grade beside them to {len(g.wallDepthM)}</div>
      {pl.r > 0 && <div className="idfInfo">distance: <span className={srcClass(pl.ruled ? "user" : "dataset")}>from the slab's top {len(g.slabThickM)} up the edge + {pl.extent === "full" ? "the full slab" : `${len(pl.distM)} under the slab = ${len(g.slabThickM + pl.distM)}`}{pl.codeR > 0 ? ` · the code's ${len(pl.codeDistM)} ${pl.extent === "full" || g.slabThickM + pl.distM >= pl.codeDistM - 1e-3 ? "met" : "NOT met"}` : ""}</span></div>}
      {g.method === "fcfactor" && <div className="idfInfo">C, the walls: the C-factor typed on CONSTRUCTIONS › Floors <InfoTip text={C_TABLE_CITE} /></div>}
      {g.method === "kiva" && pl.r > 0 && <div className="idfInfo muted">the turn-up (the thermal break against the exterior wall): a slab with no walls takes a Kiva custom block, the same XPS the slab's thickness deep against the wall's inside face; a slab with walls takes none — Kiva runs each wall's own construction down past the slab's edge to its bottom, so the edge meets the walls' inside insulation (their R, not R-{pl.r})</div>}
      {g.slabConstructions.map((c) => <div key={c.name} className="idfInfo muted">slab as written: {c.name} · {c.layers.join(" · ")}</div>)}
      {g.walls.map((w) => <div key={w.name} className="idfInfo muted">walls below grade: {w.name} · {u(w.uWm2k)} · {imperial ? `${(w.areaM2 * 10.7639).toFixed(0)} ft²` : `${w.areaM2.toFixed(1)} m²`} · {w.layers.join(" · ")}</div>)}
      <div className="idfInfo">the run: {g.run ? `${g.run.kwh.toFixed(0)} kWh/yr through these ${g.run.cells} slab cells (into the zone +) — run ${g.run.stamp}, ${g.run.current ? "the model as it stands" : "an EARLIER model — Run again for the slab as now ruled"}` : "no run yet — Run on BEM › RUN for the slab's actual heat flow"}</div>
    </div>
  );
}

/** THE NAME BOX (2026-09-17, the user: "it would be nice to actually place the existing name in the text box so it
 *  could be edited (for example, Wood Rafter 12\" - Metal could be edited at text end)"): the name AS IT STANDS is the
 *  text — the typed name, else the type's own — so a rename is an edit of it, never a retype. Typing the type's own
 *  name back, or emptying the box, clears the ruling. Its own component: the view returns early above this line. */
function NameBox(q: { name: string; base: string; disabled: boolean; placeholder: string; onName?: (n: string | undefined) => void }): React.ReactElement {
  const shown = q.name || q.base;
  const [text, setText] = useState(shown);
  const seen = useRef(shown);
  useEffect(() => { if (seen.current !== shown) { seen.current = shown; setText(shown); } }, [shown]);
  const set = (t: string): void => { setText(t); const v = t.trim(); q.onName?.(!v || v === q.base ? undefined : t); };
  return <input className={`idfName ${q.name ? "src-user" : "src-code"}`} value={text} placeholder={q.placeholder} disabled={q.disabled}
    onChange={(e) => set(e.target.value)} onBlur={() => { if (!text.trim()) setText(q.base); }} />;
}

export function ConstructionDetail(p: DetailInput): React.ReactElement {
  const r = p.row;
  if (!r) return <div className="detailBox"><div className="idfInfo">select a type — a row in the column or in the table below — to see its assembly</div></div>;
  const imperial = p.imperial;
  const film = r.kind === "roof" || r.kind === "ceiling" ? FILMS.ceiling : r.kind === "floor" ? FILMS.floor : FILMS.wall;
  const govern = p.resolved ? { label: p.resolved.label, u: p.resolved.uWm2k, source: p.resolved.source } : p.code ? { label: p.code.name, u: p.code.uWm2k, source: "code-default" as const } : null;
  if (r.kind === "window" || r.kind === "door") {
    const w = p.overall?.w ?? 0.9, h = p.overall?.h ?? 2.0;
    const scale = 200 / Math.max(w, h);
    const W = w * scale, H = h * scale, frame = Math.min(12, W * 0.08);
    const glass = r.glazed !== false;
    const parts = r.layers.filter((l) => l.part);   // the frame and panel materials the drawing is filled with — the file's word, no longer listed
    // the Door section is a MIXTURE (user, 2026-09-18): a solid door's typed U carries no SHGC or VT, and neither does the
    // code's row for it — a glazed door takes the code's fenestration construction, so its row states both
    const glazedType = r.kind === "window" || (r.kind === "door" && r.glazed === true);
    const fen = fenValues(p.stage, p.resolved, p.code, (l) => { const o = p.library?.byName.get(l.name); return o ? windowNote(o) : null; }, glazedType);
    return (
      <div className="detailBox">
        <div className="detailHead"><b>{r.label}</b> · {r.kind} · {r.elements.length} element{r.elements.length === 1 ? "" : "s"}{p.overall ? ` · ${fmtLen(w, imperial)} × ${fmtLen(h, imperial)} (OverallWidth × OverallHeight, the file)` : " · no stated size"}</div>
        <svg className="detailSvg" viewBox={`0 0 ${W + 40} ${H + 40}`} width={Math.min(360, W + 40)} height={H + 40}>
          <rect x="20" y="20" width={W} height={H} fill={fillOf(null, null, parts.find((q) => /frame/i.test(q.part ?? ""))?.material ?? "wood", "frame")} stroke="#333" />
          <rect x={20 + frame} y={20 + frame} width={Math.max(0, W - 2 * frame)} height={Math.max(0, H - 2 * frame)} fill={glass ? "#bfe3f5" : fillOf(null, null, parts.find((q) => /panel/i.test(q.part ?? ""))?.material ?? "wood")} stroke="#555" opacity={glass ? 0.8 : 1} />
          {glass && <line x1={20 + frame} y1={20 + H - frame} x2={20 + W - frame} y2={20 + frame} stroke="#fff" strokeWidth="2" opacity="0.6" />}
        </svg>
        {/* THE MODEL, NAMED UNDER THE MODEL (user, 2026-09-18: "show the name of the model below the model in the view"):
            what this type takes — a product's certified rating, a dataset construction, a typed set — with its own
            numbers beside it; when the code governs, the name is the code construction's and its numbers are the line
            below, stated ONCE. The file's Frame/Mullion and Glass rows are gone by the same word (the drawing is still
            filled with the materials they name). */}
        <div className="detailHead modelName" title={fen.from === "ruling" ? "the ruling on this type — staged rulings are written by Apply assembly" : fen.from === "model" ? "the construction the model wrote for this type" : "no ruling: the code default governs"}>
          <span className={srcClass(fen.source)}><b>{fen.name}</b></span>
          {fen.from !== "code" && <span className={srcClass(fen.source)}> · {fmtU(fen.u, imperial)}{fen.shgc !== null ? ` · SHGC ${fen.shgc.toFixed(2)}` : ""}{fen.vt !== null ? ` · VT ${fen.vt.toFixed(2)}` : fen.vtBlank ? " · VT not published, left blank" : ""}</span>}
          {fen.from === "ruling" && p.staged && <span className="src-user"> · staged — Apply assembly</span>}
        </div>
        <table className="detailTable">
          <tbody>
            <tr><td title="the energy code chosen on SITE, its table's row for the county's climate zone — what this type takes until it is ruled">code</td>
              <td className="src-code">{p.code?.name ?? "—"} · {fmtU(p.code?.uWm2k ?? null, imperial)}{glazedType && p.code?.shgc !== null && p.code?.shgc !== undefined ? ` · SHGC ${p.code.shgc.toFixed(2)}` : glazedType ? "" : " — no glass: the code gives a door its U alone"}{glazedType && p.code?.shgc !== null && p.code?.shgc !== undefined && <span className="muted" title="the code states no VT — the writer's stated default, since a SimpleGlazingSystem needs a number; not a code value"> · VT {(p.code.vt ?? CODE_VT).toFixed(1)} (stated default, not the code's)</span>}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  // an opaque assembly: the FILE's layers to scale, joined to the STAGED ruling by seq — the alias target's stack when sameAs governs
  const aliasOn = p.stage?.source === "sameAs" && !!p.alias;
  const drawRow = aliasOn && p.alias?.row ? p.alias.row : r;
  const drawStage = aliasOn ? p.alias?.stage : p.stage;
  const { layers, how } = stackOf(drawRow, drawStage, p.library ?? null, film, p.rowOf);
  const sel = p.layerSel ?? null;
  const live = layers.filter((l) => !l.deleted), struckN = layers.length - live.length;
  const total = live.reduce((t, l) => t + (l.thickness ?? 0), 0);
  const W = 560, H = 150, x0 = 40;
  // A FLOOR READS TOP DOWN (user, 2026-10-12: "The slab detail needs to reflect the top is inside, and the bottom is at grade"): its stack
  // drawn as a section — the first layer (a floor's top) at the top, the room above it, the ground (or the space below) under it
  const vertical = r.kind === "floor";
  const onGround = vertical && !!p.ground;
  const px = (m: number): number => (total > 0 ? (m / total) * (W - 2 * x0) : 0);
  let x = x0;
  const rects = live.map((l) => { const w = l.thickness && l.thickness > 0 ? Math.max(3, px(l.thickness)) : 2; const rect = { x, w, l }; x += w; return rect; });
  // EVERY BAND KEEPS ITS DIMENSION (the siding at 0.31″ lost its label to a "narrow band" rule, 2026-09-09): labels that would
  // collide step down to a second line
  const labelRows = (() => { const ends = [-Infinity, -Infinity, -Infinity]; return rects.map(({ x: rx, w, l }) => { if (!(l.thickness && l.thickness > 0)) return -1; const tw = fmtTh(l.thickness, imperial).length * 6.4; const start = rx + w / 2 - tw / 2; let row = ends.findIndex((e) => start >= e + 4); if (row < 0) row = ends.indexOf(Math.min(...ends)); ends[row] = start + tw; return row; }); })();
  const picked = layers.filter((l) => l.picked && l.rSi !== null);
  const leftOut = how === "layers" ? live.filter((l) => !l.picked) : [];
  const sumR = how !== "file" && picked.length ? picked.reduce((t, l) => t + (l.rSi ?? 0), 0) : null;
  const uStack = sumR !== null ? 1 / (sumR + film) : null;
  const applied = p.resolved?.uWm2k ?? null;
  const idfName = p.stage?.name ?? "";
  // every type can be named (user, 2026-09-08) — an alias alone takes its target's name; under the code default the name is
  // the type's label here and in the column, and the Construction's name once the type is ruled
  const canName = !p.stage || p.stage.source !== "sameAs";
  const pick = (seq: number): void => p.onLayer?.(sel === seq ? null : seq);
  const menuAt = (seq: number) => (e: React.MouseEvent): void => { e.preventDefault(); e.stopPropagation(); p.onLayerMenu?.(seq, e.clientX, e.clientY); };
  return (
    <div className="detailBox">
      <div className="detailHead"><b>{idfName || r.label}</b>
        {/* RENAME, beside the name (user, 2026-09-08: "I need a way to rename … so that it shows in DETAIL header and in Wall drop down"):
            the typed name is this head, the DETAIL tab, the column's dropdown entry, and the Construction's name in the IDF */}
        <label className="idfNameRow" title={!p.stage || p.stage.source === "code" ? "rename this type: the name reads here, in the DETAIL tab and in the column's dropdown; the IDF takes it as the Construction's name once this type is ruled (the code default's construction is shared until then)" : p.stage.source === "sameAs" ? "an alias takes the target's name" : "rename this type: the name reads here, in the DETAIL tab and in the column's dropdown, and is the Construction's name in the IDF (commas, semicolons and bangs become underscores; 90 characters)"}>rename
          <NameBox name={idfName} base={canName ? r.label : ""} disabled={!canName} placeholder={canName ? r.label : "an alias takes its target's name"} onName={p.onName} />
          {idfName && sanitizeIdfName(idfName) !== idfName && <span className="muted"> → in the IDF "{sanitizeIdfName(idfName)}"</span>}
        </label>
        {idfName ? <span className="muted"> · IFC: {r.label}</span> : null} · {r.kind === "ceiling" ? "ceiling under an attic" : r.kind} · {r.elements.length} element{r.elements.length === 1 ? "" : "s"} · {live.length ? `${live.length} layers, ${fmtTh(total, imperial)}${struckN ? ` (${struckN} deleted)` : ""}` : "the file states no layers"}
        {p.resolved ? <span className={srcClass(p.resolved.source)}> · applied: {p.resolved.label}</span> : <span className="src-code"> · code default{p.code ? `: ${p.code.name}` : ""}</span>}
        {aliasOn && <span className="src-user"> · = {p.alias?.row?.label ?? p.alias?.key} (same as)</span>}
        {/* THE VIEW'S APPLY (user, 2026-09-16: "the Apply button in the View should apply the name change, layer add/delete, and push to
            the Constructions list in the right column"): this type's staged assembly to the ledger; the frame's Apply lands a material on a layer */}
        {p.staged && <span className="staged"> · staged: {p.stagedSummary ?? "changed"}</span>}
        {p.onApply && <> <button className="apply mini" disabled={!p.staged} onClick={p.onApply} title="this type's staged assembly — its name, its layers as picked, added and deleted — goes to the column's Constructions list and the model; the other types' stages stay">Apply assembly</button></>}
        {p.staged && p.onRevert && <> <button className="qaBtn mini" onClick={p.onRevert} title="back to the applied ruling">revert</button></>}
      </div>
      {layers.length > 0 && vertical && !onGround && (() => {
        const BW = 220, bx = 110, top = 34, VH = 170, vy = (xx: number): number => top + ((xx - x0) / (W - 2 * x0)) * VH;
        return (
          <svg className="detailSvg" viewBox={`0 0 ${W} ${top + VH + 46}`} width="100%">
            <text x={bx} y={top - 10} className="lbl">inside · the top of the floor (the room above)</text>
            {rects.map(({ x: rx, w, l }) => {
              const y = vy(rx), hh = Math.max(2, vy(rx + w) - y), fill = fillOf(l.kind, l.cat, l.material ?? l.name, l.cls);
              const fr = l.paths.filter((q) => q.framing);
              const fwAll = fr.reduce((s, a) => s + a.fraction * BW, 0);
              let fx = bx + (BW - fwAll) / 2;
              return (
                <g key={l.seq}>
                  <rect className="band" x={bx} y={y} width={BW} height={hh} fill={fill} stroke={outlineFor(fill)} strokeWidth="0.8" onClick={() => pick(l.seq)} onContextMenu={menuAt(l.seq)}>
                    <title>{`${l.position} · ${l.material ?? l.name}${l.material && !l.added ? ` (the file: ${l.name})` : ""} — right-click: delete, add a layer, add a sub-item`}</title>
                  </rect>
                  {fr.map((q, j) => { const fw = q.fraction * BW, xx = fx; fx += fw; return <rect key={j} className="part" x={xx} y={y} width={fw} height={hh} fill={fillOf(q.kind, null, q.name)} stroke="#5a4a2a" strokeWidth="0.8" />; })}
                  {l.thickness && l.thickness > 0 ? <text x={bx + BW + 10} y={y + hh / 2 + 4} className="lbl">{fmtTh(l.thickness, imperial)} · {(() => { const n = l.material ?? l.name; return n.length > 30 ? `${n.slice(0, 29)}…` : n; })()}<title>{l.material ?? l.name}</title></text> : null}
                </g>
              );
            })}
            {sel !== null && rects.filter((q) => q.l.seq === sel).map((q) => <rect key="sel" className="selOutline" x={bx} y={vy(q.x)} width={BW} height={Math.max(2, vy(q.x + q.w) - vy(q.x))} />)}
            {onGround && <rect x={bx} y={top + VH} width={BW} height="14" fill="#6b5a3e" opacity="0.35" />}
            <text x={bx} y={top + VH + (onGround ? 28 : 16)} className="lbl">{onGround ? "the ground · the slab's bottom on the soil (its edge: the section below)" : "below · the bottom of the floor (the space under it)"}</text>
            {live.length > 1 && <text x={bx - 10} y={top + VH / 2 + 4} className="lbl" textAnchor="end">{fmtTh(total, imperial)}</text>}
          </svg>
        );
      })()}
      {layers.length > 0 && !vertical && (
        <svg className="detailSvg" viewBox={`0 0 ${W} ${H + 96}`} width="100%">
          <text x={x0} y="14" className="lbl">outside / top</text>
          <text x={W - x0} y="14" className="lbl" textAnchor="end">inside</text>
          {rects.map(({ x: rx, w, l }, ri) => (
            <g key={l.seq}>
              <rect className="band" x={rx} y="20" width={w} height={H} fill={fillOf(l.kind, l.cat, l.material ?? l.name, l.cls)} stroke={outlineFor(fillOf(l.kind, l.cat, l.material ?? l.name, l.cls))} strokeWidth="0.8" onClick={() => pick(l.seq)} onContextMenu={menuAt(l.seq)}>
                <title>{`${l.position} · ${l.material ?? l.name}${l.material && !l.added ? ` (the file: ${l.name})` : ""} — right-click: delete, add a layer, add a sub-item`}</title>
              </rect>
              {(() => {
                // the framing at its fraction of the band's height, centred — the band read as one framing module
                const fr = l.paths.filter((q) => q.framing);
                const fhAll = fr.reduce((t, a) => t + a.fraction * H, 0);
                let fy = 20 + (H - fhAll) / 2;
                return fr.map((q, j) => { const fh = q.fraction * H, y = fy; fy += fh; return (
                  <g key={j}>
                    <rect className="part" x={rx} y={y} width={w} height={fh} fill={fillOf(q.kind, null, q.name)} stroke="#5a4a2a" strokeWidth="0.8" />
                    {fh >= 16 && w >= 40 && <text className="partLbl" x={rx + w / 2} y={y + fh / 2 + 3} textAnchor="middle">{`${(q.fraction * 100).toFixed(0)} %`}</text>}
                  </g>); });
              })()}
              {labelRows[ri]! >= 0 && <text x={rx + w / 2} y={H + 34 + labelRows[ri]! * 12} className="lbl" textAnchor="middle">{fmtTh(l.thickness!, imperial)}</text>}
            </g>
          ))}
          {sel !== null && rects.filter((q) => q.l.seq === sel).map((q) => <rect key="sel" className="selOutline" x={q.x} y="20" width={q.w} height={H} />)}
          <line x1={x0} y1={H + 22} x2={x0 + px(total)} y2={H + 22} stroke="#888" />
          <text x={x0 + px(total) / 2} y={H + 76} className="lbl" textAnchor="middle">{fmtTh(total, imperial)} · outside → inside as the file lists the layers{layers.some((l) => l.paths.length) ? " · band height = one framing module, the framing at its fraction" : ""}</text>
        </svg>
      )}
      <table className="detailTable">
        <thead><tr>
          <th title="the assembly's layers as ruled, the outside (a floor's top) first, numbered from there; the picked material's name once one is picked, the file's word until then — click a layer to select it and pick its material in the frame below; right-click to delete, add or restore one">layer, outside first{how === "layers" ? " — click one to select it" : ""}</th>
          <th className="num thick" title="the layer's thickness in your units — the file's, or the picked material's own; type another here and the drawing, the R and the IDF follow (× puts the file's back)">thickness<span className="unit">{imperial ? "in" : "mm"}</span></th>
          <th className="num" title="the layer's thermal resistance at this thickness — a material with mass: thickness ÷ conductivity; a massless one: its stated R — in h·ft²·°F/Btu (imperial) or m²K/W (metric) — the number alone, the unit here; the foot sums them with the engine's air films into the assembly's U">R<span className="unit">{imperial ? "h·ft²·°F/Btu" : "m²K/W"}</span></th>
          <th className="num refl" title="SR — the solar reflectance a product sheet states (CRRC, ENERGY STAR): 1 − the engine's solar absorptance. Greyed when the material states none and the engine's default stands in (absorptance 0.7 → SR 0.30) — no dataset in materials.db measures it for a generic material. The outside layer's decides the sun the surface takes">SR<span className="unit">solar refl.</span></th>
          <th className="num refl" title="TE — the thermal emittance a product sheet states: the engine's thermal absorptance (long-wave, 0–1). It sets the surface's radiant exchange with the sky and the surroundings — on the outside layer the roof's night-sky cooling, on the inside layer the exchange with the room. Greyed when the engine's default 0.9 stands in">TE<span className="unit">emittance</span></th>
          <th title="where the number comes from, in its colour: the file's own word, a dataset (the EnergyPlus DataSets, the catalogue, the reference list), or you — a typed value or a material you saved">source</th>
        </tr></thead>
        <tbody>
          {layers.map((l) => (
            <Fragment key={l.seq}>
              <tr className={`layer${sel === l.seq ? " sel" : ""}${l.deleted ? " struck" : ""}`} onClick={() => { if (!l.deleted) pick(l.seq); }} onContextMenu={menuAt(l.seq)} title={l.deleted ? "deleted — right-click to restore" : `${l.added ? "a layer you added" : `the file names it ${l.name}${l.cat ? ` · ${l.cat}` : ""}`} — right-click: delete, add a layer, add a sub-item`}>
                {/* THE PICKED MATERIAL'S NAME ALONE (user, 2026-09-09: "item 2 still shows Air · Gas when changed — should be just the selected item name"); the file's word stays in the tooltip */}
                <td className="wrap">{l.deleted ? <><s className="muted">{l.name}</s><span className="muted"> · deleted</span></> : l.custom && p.onCustom ? (
                  <span onClick={(e) => e.stopPropagation()}>{l.position} · <input className="customName src-user" value={l.custom.name ?? l.material ?? l.name} onChange={(e) => p.onCustom?.(l.seq, { name: e.target.value })} title="the name of the material you are making — saved as a material of yours on Apply assembly" />
                    <button className="qaBtn mini" onClick={() => p.onCustom?.(l.seq, null)} title="drop the custom edit — the layer goes back to its pick">×</button></span>
                ) : <>{l.position} · {l.material && how === "layers" ? <span className={srcClass(l.src)}>{l.material}</span> : !l.material && l.kindSrc === "user" && l.kind ? <><span className="src-user">{KIND_LABELS[l.kind as MaterialKind]}</span><span className="muted"> — pick a material</span></> : <>{l.name}{l.cat ? <span className="muted"> · {l.cat}</span> : null}</>}{l.added ? <span className="src-user"> · added</span> : null}</>}</td>
                <td className={`num th ${l.thicknessSrc === "file" ? "" : srcClass(l.thicknessSrc)}`} onClick={(e) => e.stopPropagation()} title={l.deleted ? undefined : "the layer's thickness — type it here in the units shown; the drawing, the R and the IDF follow · × puts back the file's (or the picked row's own)"}>
                  {l.deleted || how === "library" || !p.onThickness ? (l.thickness !== null ? fmtTh(l.thickness, imperial) : "—") : (
                    <>
                      <NumInput className={`th ${l.thicknessSrc === "file" ? "src-file" : srcClass(l.thicknessSrc)}`} digits={imperial ? 4 : 2} value={l.thickness !== null ? (imperial ? l.thickness * 39.3701 : l.thickness * 1000) : null} placeholder={imperial ? "in" : "mm"} onValue={(v) => p.onThickness?.(l.seq, v !== null && v > 0 ? (imperial ? v / 39.3701 : v / 1000) : undefined)} />
                      <span className="muted">{imperial ? "″" : "mm"}</span>
                      {l.thicknessTyped && <button className="qaBtn mini" onClick={() => p.onThickness?.(l.seq, undefined)} title="back to the file's thickness (or the picked row's own)">×</button>}
                    </>
                  )}
                </td>
                {l.custom && p.onCustom && !l.deleted
                  ? <td className="num" onClick={(e) => e.stopPropagation()} title="the layer's R at its thickness, in your units — a material with mass takes k = thickness ÷ R when saved"><NumInput className="th src-user" digits={imperial ? 2 : 3} value={l.rSi !== null ? (imperial ? l.rSi / 0.17611 : l.rSi) : null} placeholder="R" onValue={(v) => p.onCustom?.(l.seq, { rSi: v !== null && v > 0 ? (imperial ? v * 0.17611 : v) : undefined })} /></td>
                  : <td className={`num ${l.rSi !== null ? srcClass(l.src) : "muted"}`} title={l.rSi === null ? "no R until a material is picked for this layer" : `R ${fmtR(l.rSi, imperial)}`}>{fmtRn(l.rSi, imperial)}</td>}
                {l.custom && p.onCustom && !l.deleted
                  ? <td className="num refl" onClick={(e) => e.stopPropagation()} title="the solar reflectance, 0–1 — the solar and visible absorptance become 1 − it when saved"><NumInput className="th src-user" digits={2} min={0} max={1} value={l.solarAbs !== null ? 1 - l.solarAbs : null} placeholder="0–1" onValue={(v) => p.onCustom?.(l.seq, { refl: v !== null && v >= 0 && v <= 1 ? v : undefined })} /></td>
                  : <td className={`num refl ${l.solarAbs !== null && !l.absDefault?.solar ? srcClass(l.src) : "muted"}`} title={l.solarAbs === null ? (l.material ? "the material states no solar absorptance the view can read" : "no reflectance until a material is picked for this layer") : `${l.absDefault?.solar ? "the engine's default — the material states none: " : ""}solar absorptance ${l.solarAbs} → SR ${(1 - l.solarAbs).toFixed(2)}`}>{l.solarAbs !== null ? (1 - l.solarAbs).toFixed(2) : "—"}</td>}
                {l.custom && p.onCustom && !l.deleted
                  ? <td className="num refl" onClick={(e) => e.stopPropagation()} title="the thermal emittance TE, 0–1 — the engine's thermal absorptance when saved"><NumInput className="th src-user" digits={2} min={0} max={1} value={l.thermalAbs ?? null} placeholder="0–1" onValue={(v) => p.onCustom?.(l.seq, { te: v !== null && v >= 0 && v <= 1 ? v : undefined })} /></td>
                  : <td className={`num refl ${l.thermalAbs == null || l.absDefault?.thermal ? "muted" : srcClass(l.src)}`} title={l.thermalAbs == null ? "no emittance until a material is picked for this layer" : l.absDefault?.thermal ? `TE ${l.thermalAbs} — the engine's default: the material states none` : `TE ${l.thermalAbs}, as the material states it`}>{l.thermalAbs != null ? l.thermalAbs.toFixed(2) : "—"}</td>}
                {l.custom && p.onCustom && !l.deleted
                  ? <td className="src" onClick={(e) => e.stopPropagation()} title="where these numbers come from — a data sheet, a standard, a page (a URL is kept as the material's link); saved with the material on Apply assembly"><input className="customName src-user" value={l.custom.source ?? ""} placeholder={l.sourceText ? shortSource(l.sourceText) : "the source"} onChange={(e) => p.onCustom?.(l.seq, { source: e.target.value })} /></td>
                  : <td className={`src ${srcClass(l.src)}`} title={l.sourceText ?? undefined}>{l.sourceText ? shortSource(l.sourceText) : how === "file" ? "the file's layer — select it, pick a material" : how === "layers" ? "left out — select it, pick a material" : l.src}</td>}
              </tr>
              {l.paths.map((q, j) => (
                <tr key={j} className="part" onClick={() => pick(l.seq)}>
                  <td className="wrap">↳ {q.name} · {(q.fraction * 100).toFixed(0)} %{q.framing ? " · framing" : ""}</td>
                  <td className="num muted">= the layer</td>
                  <td className={`num ${srcClass(q.src)}`}>{fmtRn(q.rSi, imperial)}</td>
                  <td /><td />
                  <td className={`wrap ${srcClass(q.src)}`}>{q.sourceText ?? q.src}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {p.code && !p.resolved && <tr><td className="wrap src-code">code default: {p.code.layers.join(" · ")}</td><td /><td className="num src-code">{fmtU(p.code.uWm2k, imperial)}</td><td /><td /><td className="src-code">code-default</td></tr>}
          <tr className="sum">
            <td>ΣR + films {fmtR(film, imperial)} (the engine adds them){leftOut.length ? ` · ${leftOut.length} layer${leftOut.length > 1 ? "s" : ""} left out` : ""}{struckN ? ` · ${struckN} deleted` : ""}</td>
            <td />
            <td className="num" title={sumR !== null ? `ΣR ${fmtR(sumR, imperial)}` : undefined}>{fmtRn(sumR, imperial)}</td>
            <td /><td />
            <td>{uStack !== null ? <span className={srcClass(layers.some((l) => l.picked && l.src === "user") ? "user" : "dataset")}>{fmtU(uStack, imperial)} from the {p.staged ? "staged" : "ruled"} stack</span> : govern ? <span className={srcClass(govern.source)}>{fmtU(govern.u, imperial)} · {govern.source}</span> : "—"}{applied !== null && uStack !== null && Math.abs(applied - uStack) > 1e-4 ? <span className="muted"> · applied {fmtU(applied, imperial)}</span> : null}</td>
          </tr>
        </tbody>
      </table>
      {p.ground && <FoundationSection g={p.ground} imperial={imperial} />}
    </div>
  );
}
