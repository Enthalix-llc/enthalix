// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE INPUT OUTPUT REFERENCE, LINKED (user, 2026-09-13 night: "a page link to
// the associated reference with each component in a Reference button … this
// help button is required for each component"). Big Ladder publishes the
// engine's Input Output Reference by version, one page per IDD group, one
// anchor per object; its index page lists EVERY object with its page and
// anchor. That index is fetched once (the app through bem:fetch-cached, the
// gate into the same data/cache) and read into a map keyed by the object's
// own name as the index prints it — never a URL guessed from a class name:
// "Lights" sits at `lights-000`, "Zone" on the thermal-zone page, which no
// slug rule knows. A class the index does not list has no button and is
// named, and the gate refuses a bench card without a page.

export interface IoRefEntry { page: string; anchor: string; text: string }
export interface IoReference {
  version: string; base: string;
  entries: IoRefEntry[];
  /** by the link's text, the object's name as printed (the rule); by its alphanumeric key as the fallback */
  byText: Map<string, IoRefEntry>; byKey: Map<string, IoRefEntry>;
  /** links whose text is an object name (holds a colon) — the index also lists sections */
  classLinks: number;
}

export const IO_REF_HOST = "https://bigladdersoftware.com/epx/docs";
export const ioRefBase = (version: string): string => `${IO_REF_HOST}/${version}/input-output-reference/`;
export const ioRefIndexUrl = (version: string): string => `${ioRefBase(version)}index.html`;
export const ioRefCacheName = (version: string): string => `io-reference-${version}-index.html`;
/** the docs version the user linked (2026-09-13) — used only when the engine's own version cannot be read */
export const IO_REF_FALLBACK_VERSION = "26-1";
/** "25.2.0" or "25.2" → "25-2", the docs' own numbering */
export const ioRefVersionOf = (engineVersion: string | null | undefined): string => { const m = /(\d+)\.(\d+)/.exec(engineVersion ?? ""); return m ? `${m[1]}-${m[2]}` : IO_REF_FALLBACK_VERSION; };
export const ioRefKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const unescape = (s: string): string => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/** the index page → every link to a group page's anchor, keyed by its printed text — a combined heading split into its names — and by its key as the fallback; the first listing wins */
export function parseIoReferenceIndex(html: string, version: string): IoReference {
  const entries: IoRefEntry[] = [];
  const byText = new Map<string, IoRefEntry>(), byKey = new Map<string, IoRefEntry>();
  for (const m of html.matchAll(/<a[^>]*href="(group-[^"#]+\.html)#([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
    const e: IoRefEntry = { page: m[1]!, anchor: m[2]!, text: unescape(m[3]!) };
    entries.push(e);
    // a heading may print several objects at once ("Shading:Site:Detailed, Shading:Building:Detailed"; "AirLoopHVAC:SupplyPath, AirLoopHVAC:ReturnPath"): each name reaches the same anchor
    for (const name of [e.text, ...(e.text.includes(":") ? e.text.split(/,\s*/) : [])]) {
      if (name && !byText.has(name)) byText.set(name, e);
      const k = ioRefKey(name); if (k && !byKey.has(k)) byKey.set(k, e);
    }
  }
  return { version, base: ioRefBase(version), entries, byText, byKey, classLinks: entries.filter((e) => e.text.includes(":")).length };
}

/** the page and anchor for an object class: by its name as the index prints it, else by its key; null when the index does not list it */
/** a page the reference documents but its INDEX does not list (2026-09-14: the fluid-to-fluid exchanger sits on the condenser-equipment page,
 *  its heading read there — the anchor is the page's own id) — stated once, never a slug rule */
const STATED_PAGES: Record<string, { page: string; anchor: string }> = {
  "HeatExchanger:FluidToFluid": { page: "group-condenser-equipment.html", anchor: "heatexchangerfluidtofluid" },
};
export function ioRefFor(ref: IoReference | null | undefined, cls: string): { url: string; page: string; anchor: string; text: string } | null {
  if (!ref || !cls) return null;
  const e = ref.byText.get(cls) ?? ref.byKey.get(ioRefKey(cls)) ?? (STATED_PAGES[cls] ? { ...STATED_PAGES[cls]!, text: cls } : null);
  return e ? { url: `${ref.base}${e.page}#${e.anchor}`, page: e.page, anchor: e.anchor, text: e.text } : null;
}
