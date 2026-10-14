// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * WHICH VERSION IS THIS FILE CLOSEST TO (2026-09-30). The project store keeps every version of a project's IFC with its
 * FileIndex; a file opened with no ledger of its own is compared against each of its project's versions that HAS ledgers,
 * by the diff the carry already runs (GlobalIds in common, core/ifcChanges.ts), and the closest one is its parent. Pure:
 * the app and the gate rank with this one function. Nothing is carried from a version under half the GlobalIds in common
 * (the carry's own rule — another building), and a tie goes to the newest version.
 */
import { diffIndex, type FileIndex } from "./ifcChanges.js";

export interface VersionCandidate {
  sha: string; fileName: string | null; madeBy: string; createdAt: string;
  index: FileIndex; ledgers: string[];
}
export interface RankedParent extends VersionCandidate {
  /** the share of GlobalIds the two files have in common (over the larger set) */
  overlap: number;
  /** elements unchanged / changed / added / removed, for the words shown with the choice */
  unchanged: number; changed: number; added: number; removed: number;
}
/** the carry's own threshold: under it, another building */
export const SAME_BUILDING = 0.5;

/** every candidate ranked against the file opened, closest first; `eligible` those a carry may come from (the same
 *  building, with ledgers — or, for the lineage alone, `{ ledgers: false }`, the same building whatever it holds) */
export function rankParents(next: FileIndex, candidates: VersionCandidate[], opts: { ledgers?: boolean } = {}): { ranked: RankedParent[]; eligible: RankedParent[] } {
  const ranked = candidates.filter((c) => c.sha !== next.sha).map((c): RankedParent => {
    const d = diffIndex(c.index, next);
    const n = (kind: "added" | "removed" | "changed"): number => d.changes.filter((x) => x.what === "element" && x.kind === kind).length;
    return { ...c, overlap: d.overlap, unchanged: d.unchanged, changed: n("changed"), added: n("added"), removed: n("removed") };
  }).sort((a, b) => b.overlap - a.overlap || b.unchanged - a.unchanged || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { ranked, eligible: ranked.filter((r) => r.overlap >= SAME_BUILDING && (opts.ledgers === false || r.ledgers.length > 0)) };
}

/** the words for a version: its file, when it was recorded, how it was made */
export const versionLabel = (v: { sha: string; fileName: string | null; createdAt: string; madeBy: string }): string =>
  `${v.fileName ?? "a file"} · ${v.sha.slice(0, 12)} · ${v.createdAt.slice(0, 10)} · ${v.madeBy}`;

/** THE LINEAGE SIDECAR: a program that writes a new version of an IFC (BIMedit) leaves `<file>.lineage.json` beside it
 *  naming the version it was made from — so the parent is EXACT, not ranked. Trusted only when its own sha is the file's
 *  (a sidecar left beside an older copy says nothing about this one). */
export interface LineageSidecar { format: string; sha256: string; parentSha256: string; madeBy: string; at?: string; edits?: string[] }
export const LINEAGE_FORMAT = "bim-bem-bom lineage 1";
export function readLineageSidecar(text: string | null, fileSha: string): { sidecar: LineageSidecar | null; problem: string | null } {
  if (text === null) return { sidecar: null, problem: null };
  let j: Partial<LineageSidecar>;
  try { j = JSON.parse(text) as Partial<LineageSidecar>; } catch (e) { return { sidecar: null, problem: `not JSON (${e instanceof Error ? e.message : String(e)})` }; }
  if (j.format !== LINEAGE_FORMAT) return { sidecar: null, problem: `format "${String(j.format)}", expected "${LINEAGE_FORMAT}"` };
  const hex = (x: unknown): boolean => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (!hex(j.sha256) || !hex(j.parentSha256)) return { sidecar: null, problem: "sha256 and parentSha256 must be sha256 hex" };
  if (j.sha256 !== fileSha) return { sidecar: null, problem: `it describes ${String(j.sha256).slice(0, 12)}, not this file (${fileSha.slice(0, 12)}) — ignored` };
  if (j.parentSha256 === fileSha) return { sidecar: null, problem: "it names the file as its own parent" };
  return { sidecar: { format: j.format, sha256: j.sha256!, parentSha256: j.parentSha256!, madeBy: typeof j.madeBy === "string" && j.madeBy ? j.madeBy : "bimedit", at: j.at, edits: Array.isArray(j.edits) ? j.edits.map(String) : [] }, problem: null };
}
