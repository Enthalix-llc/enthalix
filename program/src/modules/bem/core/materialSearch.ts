// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A MATERIAL BY HAND, AND THE BROWSER (user, 2026-09-08: "provide option for
// Internet Search … and then saving elected results into material db"; 2026-09-16:
// "Internet search provides a browser window, and the add by hand creates a new
// row for editing and a dialog box given for material data"). The search route
// that fetched and parsed BCL's JSON in the app (2026-09-08) is retired: the
// in-app browser window opens on the search, and the numbers come back through
// the dialog. Everything here is PURE: the URL templates, the form in the user's
// units, the row a form makes (refused with the reason when it cannot make a
// layer), the form a row makes again for an edit.

import { sha256Hex } from "../../../core/sha256.js";
import { validateRow, IP, kindOfName, type MaterialClass, type MaterialKind, type MaterialRow } from "./materialsDb.js";
import type { LayerCustom } from "./bemDb.js";

/** a URL template with the query in it */
export const searchUrl = (template: string, q: string): string => template.replace("{q}", encodeURIComponent(q.trim()));
/** THE IN-APP BROWSER'S searches (2026-09-16): BCL's own site (NREL/NLR's component library; bcl.nlr.gov/?q= answers, its
 *  /search paths 404 — probed 2026-09-16) and the web; the numbers come back through the dialog */
export const BROWSE_URLS = { bcl: "https://bcl.nlr.gov/?q={q}", general: "https://duckduckgo.com/?q={q}" } as const;
/** the IDD's roughness words for a Material, as it lists them */
export const ROUGHNESS = ["VeryRough", "Rough", "MediumRough", "MediumSmooth", "Smooth", "VerySmooth"] as const;

/** what the add-by-hand form holds: the numbers AS TYPED, in the units the user has selected (user, 2026-09-08:
 *  "adding material data by hand requires the units to match user selected units") — inches, Btu·in/h·ft²·°F,
 *  lb/ft³, Btu/lb·°F and h·ft²·°F/Btu under Show Imperial; m, W/m·K, kg/m³, J/kg·K and m²K/W under Show Metric */
export interface HandForm { name: string; kind: MaterialKind; cls: MaterialClass; units: "IP" | "SI"; thickness: number | null; k: number | null; rho: number | null; cp: number | null; r: number | null; sourceUrl: string; sourceName: string; /** the IDD's word, or none (MediumRough at emit) — 2026-09-16 */ roughness?: string | null;
  /** THE ABSORPTANCES (user, 2026-09-16: "Thermal Absorptance (at value given) and Solar and Visible Absorptance (both the value of
   *  1 − reflectivity value) … impact thermal and solar gain of exterior surfaces"): dimensionless, 0–1; a reflectivity typed sets the
   *  solar and the visible absorptance to 1 − it; left empty, the engine's 0.9 / 0.7 / 0.7 stand in at emit and the tooltip says so */
  thermalAbs?: number | null; reflectivity?: number | null; solarAbs?: number | null; visibleAbs?: number | null }
/** the form in the other system: every typed number converted, so a units toggle keeps what was typed */
export function handFormInUnits(f: HandForm, units: "IP" | "SI"): HandForm {
  if (f.units === units) return f;
  const to = units === "SI";
  const cv = (v: number | null, k: number): number | null => (v === null ? null : Number((to ? v * k : v / k).toPrecision(6)));
  return { ...f, units, thickness: cv(f.thickness, IP.inM), k: cv(f.k, IP.kWmK), rho: cv(f.rho, IP.rho), cp: cv(f.cp, IP.cp), r: cv(f.r, IP.rSi) };
}
/** the form → the SI input the row is built from; the typed numbers and their units travel as the audit trail */
export function handFormToInput(f: HandForm): HandInput {
  const si = handFormInUnits(f, "SI");
  // a reflectivity given → solar and visible absorptance 1 − it (the user's rule); a typed absorptance wins only when no reflectivity is typed
  const refl = f.reflectivity ?? null;
  const solarAbs = refl !== null ? Number((1 - refl).toFixed(4)) : f.solarAbs ?? null;
  const visibleAbs = refl !== null ? Number((1 - refl).toFixed(4)) : f.visibleAbs ?? null;
  return { name: f.name, kind: f.kind, cls: f.cls, thicknessM: si.thickness, conductivityWmK: si.k, densityKgM3: si.rho, specificHeatJKgK: si.cp, rSi: si.r, roughness: f.roughness ?? null, thermalAbs: f.thermalAbs ?? null, solarAbs, visibleAbs, sourceUrl: f.sourceUrl, sourceName: f.sourceName, typedUnits: f.units, typed: { thickness: f.thickness, k: f.k, rho: f.rho, cp: f.cp, r: f.r, thermalAbs: f.thermalAbs ?? null, reflectivity: refl, solarAbs: f.solarAbs ?? null, visibleAbs: f.visibleAbs ?? null } };
}
/** what the row is built from; the numbers in SI, the source URL required; `typedUnits` says what the user typed in */
export interface HandInput { name: string; kind: MaterialKind; cls: MaterialClass; thicknessM: number | null; conductivityWmK: number | null; densityKgM3: number | null; specificHeatJKgK: number | null; rSi: number | null; roughness?: string | null; thermalAbs?: number | null; solarAbs?: number | null; visibleAbs?: number | null; sourceUrl: string; sourceName: string; typedUnits?: "IP" | "SI"; typed?: Record<string, number | null>;
  /** the key of the row this one was edited from — the origin is then the source, and a URL is optional */
  editFrom?: string | null }
/** a hand row: named for what the user read, keyed by its own numbers, refused (with the reason) when it cannot make a layer */
export function handMaterial(h: HandInput): { row: MaterialRow | null; why: string | null } {
  const name = h.name.trim();
  if (!name) return { row: null, why: "a name" };
  const url = h.sourceUrl.trim(), from = h.editFrom?.trim() || null;
  // AN EDIT NAMES ITS ORIGIN (2026-09-08, "saved the updated material, but the new material does not show"): a row edited
  // from a saved or catalogued row carries that row's key in its source, so the URL is optional there — the origin IS the
  // source (a catalogue row's "CEC Title24-2013 — AEC" names a standard, not a page); a fresh hand row still needs its page
  const sourceName = h.sourceName.trim();
  // A SOURCE IS A NAME OR A PAGE (user, 2026-09-08: "the interface requires a url for resource"): the document the numbers
  // came from is a source whether or not it has a URL — "ASHRAE HOF 2021, Table 4" will do; a URL is kept when there is one
  if (!url && !sourceName && !from) return { row: null, why: "the source — the document or page the numbers came from (a name will do; a URL when there is one)" };
  const row: MaterialRow = {
    // the key hashes the numbers; the absorptances join it only when given, so a row saved before them keeps its key
    key: `hand:${sha256Hex(`${name}|${h.cls}|${h.thicknessM}|${h.conductivityWmK}|${h.rSi}|${url}${from ? `|${from}` : ""}${h.thermalAbs != null || h.solarAbs != null || h.visibleAbs != null ? `|a=${h.thermalAbs ?? ""},${h.solarAbs ?? ""},${h.visibleAbs ?? ""}` : ""}`).slice(0, 12)}`,
    name, cls: h.cls, kind: h.kind, roughness: h.cls === "Material" ? (h.roughness ?? null) : null,
    thicknessM: h.thicknessM, conductivityWmK: h.cls === "Material" ? h.conductivityWmK : null, densityKgM3: h.cls === "Material" ? h.densityKgM3 : null, specificHeatJKgK: h.cls === "Material" ? h.specificHeatJKgK : null,
    rSi: h.cls === "Material" ? null : h.rSi, thermalAbs: h.thermalAbs ?? null, solarAbs: h.solarAbs ?? null, visibleAbs: h.visibleAbs ?? null,
    sourceId: "hand", sourceRef: `${sourceName || (from ? "edited" : "typed by hand")}${url ? ` — ${url}` : ""}${from ? ` · edited from ${from}` : ""}`, unitsAsFetched: h.typedUnits ?? "SI", fetchedJson: h.typed ? JSON.stringify({ typed: h.typed, units: h.typedUnits ?? "SI" }) : null, notes: `typed by the user from the source named${from ? `; edited from ${from}` : ""}${h.typedUnits === "IP" ? ", in inches, Btu·in/h·ft²·°F, lb/ft³, Btu/lb·°F (converted to SI)" : ""}`, addedAt: "",
  };
  const why = validateRow(row);
  return why ? { row: null, why } : { row, why: null };
}

/** A CUSTOM EDIT BECOMES A ROW OF YOURS (user, 2026-09-29: "When main view (MV) button is applied, any custom layer edits are
 *  saved"). The layer's pick is the BASE; what was typed in the DETAIL list overrides it: the name; the R at the layer's own
 *  thickness — a material with mass keeps its density and specific heat and takes k = t / R, one without is a massless row at that
 *  R; the reflectance — solar and visible absorptance 1 − it (the hand dialog's rule). Nothing is invented: a layer with no pick
 *  becomes a massless row, and without an R typed it is refused with the reason. The row cites its origin (`editFrom`). */
export function customLayerMaterial(base: MaterialRow | null, thicknessM: number | null, c: LayerCustom, fallbackName: string): { row: MaterialRow | null; why: string | null } {
  const name = (c.name ?? base?.name ?? fallbackName).trim();
  const refl = c.refl ?? null;
  const solarAbs = refl !== null ? Number((1 - refl).toFixed(4)) : base?.solarAbs ?? null;
  const visibleAbs = refl !== null ? Number((1 - refl).toFixed(4)) : base?.visibleAbs ?? null;
  // THE SOURCE TYPED IN THE LIST (user, 2026-09-29: "the MVT should allow source to be edited"): a URL in it is the row's URL, the
  // rest its name; nothing typed keeps "custom edit of …". The origin row stays cited either way (`editFrom`)
  const typedSrc = (c.source ?? "").trim(), url = typedSrc.match(/https?:\/\/\S+/)?.[0] ?? "";
  const srcName = typedSrc.replace(url, "").replace(/\s*[—–-]\s*$/, "").trim();
  const common = { name, roughness: base?.roughness ?? null, thermalAbs: c.te ?? base?.thermalAbs ?? null, solarAbs, visibleAbs, sourceUrl: url, sourceName: srcName || (url ? "" : base ? `custom edit of "${base.name}"` : "a custom edit in DETAIL"), editFrom: base?.key ?? null, typed: { rSi: c.rSi ?? null, reflectivity: refl, thermalAbs: c.te ?? null } };
  const t = thicknessM !== null && thicknessM > 0 ? thicknessM : null;
  if (base && base.cls === "Material" && t !== null) {
    const k = c.rSi !== undefined ? (c.rSi > 0 ? t / c.rSi : null) : base.conductivityWmK;
    if (k === null) return { row: null, why: "an R above zero" };
    return handMaterial({ ...common, kind: base.kind, cls: "Material", thicknessM: t, conductivityWmK: Number(k.toPrecision(6)), densityKgM3: base.densityKgM3, specificHeatJKgK: base.specificHeatJKgK, rSi: null });
  }
  const r = c.rSi ?? base?.rSi ?? (base?.cls === "Material" && base.thicknessM && base.conductivityWmK ? base.thicknessM / base.conductivityWmK : null);
  if (r === null || !(r > 0)) return { row: null, why: base ? "an R above zero" : "an R — the layer has no material picked, so its R must be typed" };
  const cls: MaterialClass = base?.cls === "Material:AirGap" ? "Material:AirGap" : "Material:NoMass";
  return handMaterial({ ...common, kind: base?.kind ?? kindOfName(name, cls, null), cls, thicknessM: null, conductivityWmK: null, densityKgM3: null, specificHeatJKgK: null, rSi: Number(r.toPrecision(6)) });
}

/** a saved row back into the form, in the user's units — to EDIT a material (2026-09-08): the numbers, the kind, the class,
 *  the source name and URL as the row's source_ref states them ("<name> — <url>") */
export function formFromRow(r: MaterialRow, units: "IP" | "SI"): HandForm {
  // the URL is taken only when the reference carries one — a catalogue row's "CEC Title24-2013 — AEC" names a standard and
  // its author, not a page (a first cut put "AEC" in the URL field); an edit's own "· edited from …" suffix is not the source
  const ref = r.sourceRef.replace(/ · edited from .+$/, "");
  const m = /^(.*?) — (https?:\/\/\S+)$/.exec(ref);
  const si: HandForm = { name: r.name, kind: r.kind, cls: r.cls === "Material" ? "Material" : "Material:NoMass", units: "SI", thickness: r.thicknessM, k: r.conductivityWmK, rho: r.densityKgM3, cp: r.specificHeatJKgK, r: r.rSi, roughness: r.roughness, thermalAbs: r.thermalAbs, reflectivity: r.solarAbs !== null && r.visibleAbs !== null && Math.abs(r.solarAbs - r.visibleAbs) < 1e-6 ? Number((1 - r.solarAbs).toFixed(4)) : null, solarAbs: r.solarAbs, visibleAbs: r.visibleAbs, sourceName: m ? m[1]! : ref, sourceUrl: m ? m[2]! : "" };
  return handFormInUnits(si, units);
}
/** the query the search opens with: the file's material name up to its first comma — "Siding, Clapboard" answered nothing on BCL, "Siding" answers */
export const searchQueryFor = (material: string): string => material.split(/[,(]/)[0]!.trim() || material;
