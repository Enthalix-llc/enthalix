// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE EXPLAIN TEXTS, PARSED (user, 2026-10-15: "dialog boxes explaining the sections … a first pass on these descriptions for review and
// editing"): explain.md is the user's file, read here into entries. "# Region" starts a region, "## match" an entry, "TAB › match"
// limits it to one tab, "## *" is the region's general text. The Markdown is the small subset the file uses — paragraphs, "- "
// lists, **bold**, `code` — escaped first, so nothing in the file is ever run as HTML.

export type ExplainRegion = "Top bar" | "Rail" | "Levels and spaces" | "View" | "Frame" | "Right column";

export interface ExplainEntry {
  region: string;
  /** the tab an entry is limited to (BIM, SITE, … BOM), else null */
  scope: string | null;
  /** the start of the header's text, lower-cased; "*" for the region's general text */
  match: string;
  /** the heading as written, for the dialog's title */
  title: string;
  html: string;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

/** the file's Markdown subset → HTML: blank-line paragraphs, "- " lists (a line indented under an item continues it) */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = (): void => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const flushList = (): void => { if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; };
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    if (t.startsWith("- ")) { flushPara(); (list ??= []).push(t.slice(2)); continue; }
    if (list && /^\s/.test(line)) { list[list.length - 1] += ` ${t}`; continue; }
    flushList(); para.push(t);
  }
  flushPara(); flushList();
  return out.join("");
}

export function parseExplain(text: string): ExplainEntry[] {
  const entries: ExplainEntry[] = [];
  let region = "";
  let cur: { title: string; body: string[] } | null = null;
  const close = (): void => {
    if (!cur || !region) { cur = null; return; }
    const parts = cur.title.split(" › ");
    const scope = parts.length > 1 ? parts[0]!.trim() : null;
    const match = (parts.length > 1 ? parts.slice(1).join(" › ") : cur.title).trim();
    entries.push({ region, scope, match: match === "*" ? "*" : match.toLowerCase(), title: cur.title, html: mdToHtml(cur.body.join("\n")) });
    cur = null;
  };
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    if (line.startsWith("## ")) { close(); cur = { title: line.slice(3).trim(), body: [] }; continue; }
    if (line.startsWith("# ")) { close(); region = line.slice(2).trim(); continue; }
    cur?.body.push(line);
  }
  close();
  return entries;
}

/** the header's text as the user reads it: the fold arrows and the ⓘ taken off, the spaces collapsed */
export const headerText = (s: string): string => s.replace(/[▸▾ⓘ]/g, "").replace(/\s+/g, " ").trim();

/** the entry for a header: the longest match the text starts with, the current tab's scoped entries first; else the region's "*" */
export function findExplain(entries: ExplainEntry[], region: string, text: string, scope: string): ExplainEntry | null {
  const t = text.toLowerCase();
  const inRegion = entries.filter((e) => e.region === region);
  const best = (list: ExplainEntry[]): ExplainEntry | null =>
    list.filter((e) => e.match !== "*" && t.startsWith(e.match)).sort((a, b) => b.match.length - a.match.length)[0] ?? null;
  return best(inRegion.filter((e) => e.scope === scope)) ?? best(inRegion.filter((e) => e.scope === null)) ?? inRegion.find((e) => e.match === "*") ?? null;
}
