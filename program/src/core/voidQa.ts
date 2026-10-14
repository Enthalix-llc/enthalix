// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE VOID QA (user, 2026-09-18: "We need a QA dialog in BIM to review this
// very issue. When spaces are created, flag the suspected spaces of concern
// and provide a dialogue box that asks where the insulation resides (at roof
// or at ceiling level)"). Every space this app BUILDS rather than reads —
// the attics and the interstitial cavities the carve raises over a room's
// ceiling — carries a question the file does not answer: which plane holds
// the insulation, the roof over the void or the ceiling under it? The answer
// decides the whole envelope there, and only the user knows it.
//
// So this module states, per space, WHAT CLOSES IT — read from the stored
// rows, never from memory, the wall QA's own discipline — and flags the ones
// that need a ruling. It repairs nothing and it decides nothing.
//
// Two kinds of row, because a void the carve MISSED needs a name to hang on:
//   · a void the carve built  → the flag sits on the void's own name
//   · a roof another roof covers → no space was built between them, so the
//     flag sits on the ROOM whose roof it is (2026-09-18: 255 ft² of the
//     Great room's roof reads as facing the sky under the studio roof)

import polygonClipping from "polygon-clipping";
import type { DbFaceRow } from "./db.js";

export type VoidFlag =
  | "insulation"      // a roof over it and a ceiling under it: which one carries the insulation?
  | "interstitial"    // a FLOOR closes it, not a roof — a joist cavity, not an attic
  | "no-top"          // nothing closes it at all
  | "covered";        // a roof of this room has another roof over it and no space between

/** what the QA proposes; the dialog pre-selects it and the user rules */
export type VoidVerdict = "roof" | "ceiling" | "not-a-space" | "make-a-void";

export interface VoidQaRow {
  /** the space the flag hangs on — a void the carve built, or the room whose roof is covered */
  name: string;
  kind: "void" | "room";
  /** what closes it above and below: the collapse's own category, its area and the zone beyond */
  top: string | null;
  topM2: number;
  bottom: string | null;
  bottomM2: number;
  /** the clear height between the two planes, as the rings state it */
  gapMinM: number;
  gapMaxM: number;
  /** the areas the space carries, by what the collapse called each surface */
  roofM2: number;
  ceilingM2: number;
  floorM2: number;
  extWallM2: number;
  /** the zones under it (through its floor) and over it (through its top) */
  under: string[];
  over: string[];
  /** a covered room: how much of its roof has another roof above, and whose */
  coveredM2: number;
  coveredBy: string[];
  flags: VoidFlag[];
  verdict: VoidVerdict;
  /** the row in the user's words — the panel and the tooltip read it */
  note: string;
}

const UP = 0.5;                       // a surface counts as a top or a bottom when its outward normal leans this far
const PLANE_EPS = 0.08;               // metres: a plane must clear another by this much to be "over" it
const AREA_EPS = 0.05;                // m²: an overlap under this is noise, not a cover

type Ring = Array<[number, number]>;
const plan = (r: Array<[number, number, number]>): Ring => r.map((p) => [p[0], p[2]]);
const closed = (r: Ring): Ring => (r.length && (r[0]![0] !== r[r.length - 1]![0] || r[0]![1] !== r[r.length - 1]![1]) ? [...r, r[0]!] : r);
/** a surface as polygon-clipping wants it: the outer ring then its holes */
const poly = (row: DbFaceRow): Ring[] => [closed(plan(row.outer)), ...row.holes.map((h) => closed(plan(h)))];
function planArea(rings: Ring[][]): number {
  let a = 0;
  for (const p of rings) for (let i = 0; i < p.length; i++) {
    const r = p[i]!;
    let s = 0;
    for (let j = 0; j < r.length - 1; j++) s += r[j]![0] * r[j + 1]![1] - r[j + 1]![0] * r[j]![1];
    a += (i === 0 ? 1 : -1) * Math.abs(s) / 2;
  }
  return a;
}
/** the plane's height at a plan point; null when the surface is vertical (it is nobody's top) */
function yAt(row: DbFaceRow, x: number, z: number): number | null {
  const [nx, ny, nz] = row.n;
  if (Math.abs(ny) < 1e-3) return null;
  const p0 = row.outer[0]!;
  return (nx * p0[0] + ny * p0[1] + nz * p0[2] - nx * x - nz * z) / ny;
}
const centroidOf = (rings: Ring[][]): [number, number] => {
  const r = rings[0]?.[0] ?? [];
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return r.length ? [x / r.length, z / r.length] : [0, 0];
};
const yRange = (rows: DbFaceRow[]): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) for (const p of r.outer) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  return [lo, hi];
};
const area = (rows: DbFaceRow[]): number => rows.reduce((t, r) => t + (r.grossAreaM2 ?? r.areaM2), 0);

/**
 * Every space the app built, and every room whose roof another roof covers.
 * `rows` are idf.db's stored surfaces; `zones` idf.db's own zone list.
 */
export function assessVoids(
  rows: DbFaceRow[],
  zones: Array<{ name: string; kind: "room" | "attic" }>,
): VoidQaRow[] {
  const out: VoidQaRow[] = [];
  // ── the voids the carve built: what closes each one, above and below
  for (const z of zones.filter((q) => q.kind === "attic")) {
    const mine = rows.filter((r) => r.space === z.name || r.spaceFacing === z.name);
    if (!mine.length) continue;
    // the outward direction FROM this zone: the zone sits on the −n side when it is `space`, the +n side when it is `spaceFacing`
    const up = (r: DbFaceRow): number => (r.space === z.name ? r.n[1] : -r.n[1]);
    const tops = mine.filter((r) => up(r) > UP), bottoms = mine.filter((r) => up(r) < -UP);
    const beyond = (rs: DbFaceRow[]): string[] => [...new Set(rs.map((r) => (r.space === z.name ? r.spaceFacing : r.space)).filter((s): s is string => !!s))];
    const cat = (rs: DbFaceRow[]): string | null => {
      const by = new Map<string, number>();
      for (const r of rs) by.set(r.ifcClass, (by.get(r.ifcClass) ?? 0) + (r.grossAreaM2 ?? r.areaM2));
      return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const topCat = cat(tops), botCat = cat(bottoms);
    const [topLo, topHi] = tops.length ? yRange(tops) : [NaN, NaN];
    const [botLo, botHi] = bottoms.length ? yRange(bottoms) : [NaN, NaN];
    const flags: VoidFlag[] = [];
    let verdict: VoidVerdict = "roof";
    let note: string;
    if (!tops.length) {
      flags.push("no-top");
      verdict = "not-a-space";
      note = "nothing closes this space at the top — it was built over a ceiling and found no plane above it";
    } else if (topCat === "roof") {
      flags.push("insulation");
      verdict = "roof";
      note = `a roof closes it — an attic. ${area(tops).toFixed(0)} m² of roof over ${area(bottoms).toFixed(0)} m² of ceiling: the insulation is on one of those two planes and the file does not say which`;
    } else {
      flags.push("interstitial");
      verdict = "not-a-space";
      note = `a ${topCat ?? "surface"} closes it, not a roof — this is the cavity inside a floor assembly (the room's ceiling below, the floor structure above), not an attic`;
    }
    out.push({
      name: z.name, kind: "void", top: topCat, topM2: area(tops), bottom: botCat, bottomM2: area(bottoms),
      gapMinM: tops.length && bottoms.length ? topLo - botHi : 0,
      gapMaxM: tops.length && bottoms.length ? topHi - botLo : 0,
      roofM2: area(mine.filter((r) => r.ifcClass === "roof")),
      ceilingM2: area(mine.filter((r) => r.ifcClass === "ceiling")),
      floorM2: area(mine.filter((r) => r.ifcClass === "floor")),
      extWallM2: area(mine.filter((r) => r.ifcClass === "exteriorWall")),
      under: beyond(bottoms), over: beyond(tops), coveredM2: 0, coveredBy: [],
      flags, verdict, note,
    });
  }
  // ── a roof with another roof over it and NO space between: the carve built no void, so the flag
  //    sits on the room whose roof it is. The overlap is the real plan intersection, not a bounding box.
  const roofs = rows.filter((r) => r.ifcClass === "roof" && Math.abs(r.n[1]) > 1e-3);
  const covered = new Map<string, { m2: number; by: Set<string> }>();
  for (const r of roofs) {
    const who = r.space ?? r.spaceFacing;
    if (!who) continue;                                     // an unclaimed plane has no name to hang a flag on
    const mineP = poly(r);
    for (const s of roofs) {
      if (s === r) continue;
      let inter: Ring[][];
      try { inter = polygonClipping.intersection(mineP as never, poly(s) as never) as unknown as Ring[][]; }
      catch { continue; }
      if (!inter.length) continue;
      const m2 = planArea(inter);
      if (m2 < AREA_EPS) continue;
      const [cx, cz] = centroidOf(inter);
      const mineY = yAt(r, cx, cz), overY = yAt(s, cx, cz);
      if (mineY === null || overY === null || overY <= mineY + PLANE_EPS) continue;
      // the two planes share plan and the other is above: is a space already between them?
      const between = zones.some((q) => q.kind === "attic" && rows.some((x) => (x.space === q.name || x.spaceFacing === q.name) && x.id === s.id)
        && rows.some((x) => (x.space === q.name || x.spaceFacing === q.name) && x.id === r.id));
      if (between) continue;
      const e = covered.get(who) ?? { m2: 0, by: new Set<string>() };
      e.m2 += m2 / Math.max(1e-9, Math.abs(r.n[1]));        // plan area back to the sloped plane's own area
      e.by.add(s.space ?? s.spaceFacing ?? `element ${s.elementId}`);
      covered.set(who, e);
    }
  }
  for (const [who, e] of covered) {
    const row = out.find((q) => q.name === who);
    if (row) { row.coveredM2 = e.m2; row.coveredBy = [...e.by]; if (!row.flags.includes("covered")) row.flags.push("covered"); continue; }
    out.push({
      name: who, kind: "room", top: "roof", topM2: 0, bottom: null, bottomM2: 0, gapMinM: 0, gapMaxM: 0,
      roofM2: 0, ceilingM2: 0, floorM2: 0, extWallM2: 0, under: [], over: [], coveredM2: e.m2, coveredBy: [...e.by],
      flags: ["covered"], verdict: "make-a-void",
      note: `${e.m2.toFixed(0)} m² of this room's roof has another roof over it (${[...e.by].join(", ")}) and no space between — the model tells the engine it faces the sky`,
    });
  }
  return out.sort((a, b) => b.coveredM2 + b.topM2 - (a.coveredM2 + a.topM2));
}

// ── THE RULING (user, 2026-09-18: "provide a dialogue box that asks where the insulation resides
//    (at roof or at ceiling level)"). The QA states the question; these are the answers, in the
//    user's own words, and the ledger keeps one per space. Nothing here decides anything: the
//    verdict above only PRE-SELECTS an answer, and a space with no ruling is unruled.

export type VoidAnswer =
  | "roof"          // the insulation is at the ROOF — the void is inside the envelope, its vents interior
  | "ceiling"       // the insulation is at the CEILING — a vented attic, the void outside the envelope
  | "not-a-space"   // not a space at all: the cavity inside a floor assembly (an interstitial floor)
  | "make-a-void"   // a covered roof: the roof above closes a void over this one — build it
  | "shade";        // a covered roof: the roof above only shades it, nothing is trapped between

export interface VoidRuling {
  answer: VoidAnswer;
  /** "it opens into conditioned space (a transfer grille)" — the user's word on every void in this project */
  grille?: boolean;
  at: string;
}

export const VOID_ANSWERS: Record<VoidAnswer, { label: string; why: string }> = {
  roof: { label: "the insulation is at the ROOF", why: "an unvented roof: the insulation is in the roof assembly, so this space is inside the envelope and the ceiling under it is an interior surface" },
  ceiling: { label: "the insulation is at the CEILING", why: "a vented attic: the insulation is on the floor of this space, so the space is outside the envelope and the roof over it is a bare deck" },
  "not-a-space": { label: "not a space — part of the floor assembly", why: "an interstitial cavity between a room's ceiling and the floor structure above it, not a space to model" },
  "make-a-void": { label: "the roof above closes a void over this one", why: "the space between the two roofs is trapped and belongs in the model; as it stands the lower roof tells the engine it faces the sky" },
  shade: { label: "the roof above only shades it", why: "nothing is trapped between them — the upper roof is a shading surface over this one" },
};

/** the answers this row may be given, in the order the dialog offers them; the first is the QA's own verdict */
export function answersFor(row: VoidQaRow): VoidAnswer[] {
  const covered = row.kind === "room" || (row.flags.includes("covered") && !row.flags.includes("insulation") && !row.flags.includes("interstitial"));
  const list: VoidAnswer[] = covered
    ? ["make-a-void", "shade"]
    : row.flags.includes("interstitial") || row.flags.includes("no-top")
      ? ["not-a-space", "roof", "ceiling"]
      : ["roof", "ceiling", "not-a-space"];
  const v = row.verdict as VoidAnswer;
  return list.includes(v) ? [v, ...list.filter((a) => a !== v)] : list;
}

/** the space's word for the tree's `?` and the corrections row — what is asked, or what the user answered */
export function voidWord(row: VoidQaRow, ruling: VoidRuling | undefined): string {
  if (ruling) return `${VOID_ANSWERS[ruling.answer].label}${ruling.grille ? " · opens into conditioned space (a transfer grille)" : ""}`;
  return row.note;
}

/** the census line — the gate prints it and the panel's header reads the same words */
export function formatVoidQa(rows: VoidQaRow[]): string {
  const n = (f: VoidFlag): number => rows.filter((r) => r.flags.includes(f)).length;
  return `${rows.length} space${rows.length === 1 ? "" : "s"} to rule on — insulation ${n("insulation")} · interstitial ${n("interstitial")} · covered roof ${n("covered")} · no top ${n("no-top")}`;
}
