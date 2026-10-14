// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE STAGE JOURNAL (2026-09-10): the second place a draft lives. Every change of any BEM tab's stage is mirrored
// SYNCHRONOUSLY into browser storage under the file's sha — no IPC, no debounce — so a page reload, an Electron relaunch,
// or a load that re-seeds the stages from disk finds the newest draft and never replaces it with an older one. The user's
// sheet (a heat pump, a ground loop, six air terminals) was drawn during a load the writer was gated off for, then wiped
// by the load's seed from a disk copy that never got it. Pure functions; the gate exercises them on a Map.

import type { BemLedger, SystemsRuling } from "./bemDb.js";

export type Staged = NonNullable<BemLedger["staged"]>;
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const journalKey = (sha: string): string => `bim-stage:${sha}`;

/** the journal for a file: a staged record with its `at`, or null when none (or unreadable) */
export function readJournal(storage: StorageLike, sha: string): Staged | null {
  try {
    const s = storage.getItem(journalKey(sha));
    if (!s) return null;
    const j = JSON.parse(s) as Staged;
    return j && typeof j === "object" && typeof j.at === "string" ? j : null;
  } catch { return null; }
}
/** write the record (null clears it); storage that is full or absent is not an error — the disk copy stands */
export function writeJournal(storage: StorageLike, sha: string, staged: Staged | null): void {
  try { if (staged && !stagedEmpty(staged)) storage.setItem(journalKey(sha), JSON.stringify(staged)); else storage.removeItem(journalKey(sha)); } catch { /* the disk copy stands */ }
}
/** the newer of the disk's staged record and the journal's, by `at`; a copy without `at` loses; equal → the disk's */
export function newestStaged(disk: Staged | null | undefined, journal: Staged | null): Staged | null {
  if (!journal?.at) return disk ?? null;
  if (!disk?.at) return journal;
  return journal.at > disk.at ? journal : disk;
}
/** nothing staged in it */
export const stagedEmpty = (x?: Staged | null): boolean => !x || !(x.constructions || x.ground || x.site || x.schedules || x.holidays !== undefined || x.systems || x.gains);
/** what the writer compares — the content, never the `at` */
export const stagedContent = (x?: Staged | null): string => JSON.stringify(x && !stagedEmpty(x) ? { c: x.constructions ?? null, g: x.ground ?? null, s: x.site ?? null, h: x.schedules ?? null, d: x.holidays === undefined ? "-" : x.holidays, y: x.systems ?? null, n: x.gains ?? null } : null);
/** the sheet's components in a staged record, for a listing */
export const sheetSize = (s: SystemsRuling | undefined): { components: number; connectors: number } => ({ components: s?.assembly?.nodes.length ?? 0, connectors: s?.assembly?.edges.length ?? 0 });
