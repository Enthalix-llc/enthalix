// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// UNITS AT THE EYE (user, 2026-09-13 night: "assure that all units, in all
// inputs, match the user selected units"). The engine takes SI; the user
// types in the system chosen at the top of the screen. The conversion from a
// field's SI unit to its IP unit is READ from the engine's own IDD header —
// `Energy+.idd` opens with three lists: the default IP conversions (used when
// a field states no `\ip-units`), the other conversions a field selects with
// its `\ip-units` code, and the units that are not translated. Nothing here
// is authored: a factor and an offset per line, as the IDD states them.

export interface IpConversion { si: string; ip: string; factor: number; offset: number; /** true for the second list: chosen only by a field's ip-units */ byCode: boolean }
export interface IpConversions {
  list: IpConversion[];
  /** SI unit → its conversions in the IDD's order: the first non-code entry is the default */
  bySi: Map<string, IpConversion[]>;
  /** the IDD's "Units fields that are not translated" */
  untranslated: Set<string>;
  citation: string;
}
export const IDD_FILE = "Energy+.idd";

/** the IDD header's three unit lists, parsed as written */
export function readIddConversions(iddText: string): IpConversions {
  const head = iddText.slice(0, 40_000).split("\n");
  const list: IpConversion[] = [], untranslated = new Set<string>();
  let section: "default" | "code" | "none" | null = null;
  for (const raw of head) {
    const line = raw.replace(/\r$/, "");
    if (/^!\s*Default IP conversions/.test(line)) { section = "default"; continue; }
    if (/^!\s*Other conversions supported/.test(line)) { section = "code"; continue; }
    if (/^!\s*Units fields that are not translated/.test(line)) { section = "none"; continue; }
    if (/^!\s*\*{6,}/.test(line)) { if (section) break; continue; }
    if (!section || !/^!/.test(line)) continue;
    const body = line.replace(/^!\s*/, "").trimEnd();
    if (!body) continue;
    if (section === "none") { untranslated.add(body.trim()); continue; }
    const m = /^(\S+)\s+=>\s+(\S+)\s+([\d.Ee+-]+)(?:\s*\(plus\s+([\d.Ee+-]+)\))?\s*$/.exec(body);
    if (!m) continue;
    list.push({ si: m[1]!, ip: m[2]!, factor: Number(m[3]), offset: m[4] ? Number(m[4]) : 0, byCode: section === "code" });
  }
  const bySi = new Map<string, IpConversion[]>();
  for (const c of list) (bySi.get(c.si) ?? bySi.set(c.si, []).get(c.si)!).push(c);
  return { list, bySi, untranslated, citation: `${IDD_FILE}'s header: ${list.filter((c) => !c.byCode).length} default IP conversions, ${list.filter((c) => c.byCode).length} by \\ip-units code, ${untranslated.size} units not translated` };
}

/** the conversion a field takes: its `\ip-units` code names one of its SI unit's entries; else the first default entry; none for an untranslated or unlisted unit */
export function conversionFor(conv: IpConversions | null | undefined, si: string | null | undefined, ipUnits?: string | null): IpConversion | null {
  if (!conv || !si) return null;
  const entries = conv.bySi.get(si);
  if (!entries?.length) return null;
  if (ipUnits) { const byCode = entries.find((c) => c.ip === ipUnits); if (byCode) return byCode; }
  return entries.find((c) => !c.byCode) ?? entries[0] ?? null;
}
export const toIp = (v: number, c: IpConversion): number => v * c.factor + c.offset;
export const fromIp = (v: number, c: IpConversion): number => (v - c.offset) / c.factor;

/** a field's unit as the user sees it: the label, and the value both ways — SI both ways under metric; the IDD's conversion under imperial (identity when the IDD lists none) */
export interface UnitAtEye { label: string; converted: boolean; toEye: (v: number) => number; fromEye: (v: number) => number }
export function unitAtEye(conv: IpConversions | null | undefined, field: { units: string | null; ipUnits: string | null }, imperial: boolean): UnitAtEye {
  const id = (v: number): number => v;
  if (!field.units) return { label: "", converted: false, toEye: id, fromEye: id };
  const c = imperial ? conversionFor(conv, field.units, field.ipUnits) : null;
  if (!c) return { label: field.units, converted: false, toEye: id, fromEye: id };
  // a value typed or shown is kept to six significant figures — the engine's own precision for a converted field
  const six = (v: number): number => Number(v.toPrecision(6));
  return { label: c.ip, converted: c.factor !== 1 || c.offset !== 0, toEye: (v) => six(toIp(v, c)), fromEye: (v) => six(fromIp(v, c)) };
}

/** the flow units the ventilation inputs speak: cfm under imperial, L/s under metric (the IDD's own m3/s ⇄ ft3/min, scaled) */
export const L_S_PER_CFM = 0.4719474;
export const FT2_PER_M2 = 10.7639104167097;
/** a cfm stored by the resolver's rule (ASHRAE 62.2 speaks cfm), shown in the user's units */
export const flowAtEye = (cfm: number, imperial: boolean): number => (imperial ? cfm : Number((cfm * L_S_PER_CFM).toPrecision(6)));
export const flowFromEye = (v: number, imperial: boolean): number => (imperial ? v : Number((v / L_S_PER_CFM).toPrecision(6)));
export const flowUnit = (imperial: boolean): string => (imperial ? "cfm" : "L/s");
export const fmtFlow = (cfm: number, imperial: boolean, digits = 0): string => `${flowAtEye(cfm, imperial).toFixed(digits)} ${flowUnit(imperial)}`;
/** fan power per flow, stated per cfm by the protocols, at the eye */
export const fmtWattsPerFlow = (wPerCfm: number, imperial: boolean): string => (imperial ? `${wPerCfm} W/cfm` : `${(wPerCfm / L_S_PER_CFM).toFixed(2)} W/(L/s)`);

/** a note written by the resolver in SI (bem.db's record) read at the eye: every "N m²" and "N W/m²" converted under imperial, the text otherwise verbatim */
export function siNoteAtEye(note: string, imperial: boolean): string {
  if (!imperial) return note;
  return note
    .replace(/(\d+(?:\.\d+)?) W\/m²/g, (_, n: string) => `${(Number(n) / FT2_PER_M2).toPrecision(3)} W/ft²`)
    .replace(/(\d+(?:\.\d+)?) per m²/g, (_, n: string) => `${(Number(n) / FT2_PER_M2).toPrecision(3)} per ft²`)
    .replace(/(\d+(?:\.\d+)?) m²/g, (_, n: string) => `${(Number(n) * FT2_PER_M2).toFixed(0)} ft²`);
}
