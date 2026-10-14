// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// READ WHAT THE ENGINE SAID. eplusout.err is the instrument that does not move
// under the fix: it says what stops a run (Fatal, Severe) and what it merely
// notes (Warning). This groups the messages by their first words and counts
// the ones the geometry work is about, so the gate can print one line per
// cause rather than a wall of text. eplusout.eio's surface details give the
// engine's own areas and azimuths back for a cross-check.

export type ErrKind = "Fatal" | "Severe" | "Warning";

export interface ErrGroup { kind: ErrKind; key: string; count: number; sample: string }

export interface ErrSummary {
  fatal: number;
  severe: number;
  warning: number;
  completed: boolean;
  groups: ErrGroup[];
  /** the geometry messages the report named, counted by their first line */
  notEnclosed: number;
  areaMismatch: number;
  subsurfaceOutside: number;
  nonPlanar: number;
  vertexOrdering: number;
  nonConvex: number;
  tail: string;
}

export function parseErr(text: string): ErrSummary {
  const lines = text.split(/\r?\n/);
  const msgs: Array<{ kind: ErrKind; text: string }> = [];
  for (const line of lines) {
    const m = /^\s*\*\*\s*(Fatal|Severe|Warning)\s*\*\*\s*(.*)$/.exec(line);
    if (m) { msgs.push({ kind: m[1] as ErrKind, text: m[2] ?? "" }); continue; }
    const c = /^\s*\*\*\s*~~~\s*\*\*\s*(.*)$/.exec(line);
    if (c && msgs.length) msgs[msgs.length - 1]!.text += ` ¶ ${c[1] ?? ""}`;
  }
  const groups = new Map<string, ErrGroup>();
  for (const m of msgs) {
    const first = m.text.split(" ¶ ")[0] ?? "";
    // the message up to its first name or number: the cause, not the instance
    const key = first.replace(/"[^"]*"/g, "\"…\"").replace(/=\s*[-\d.]+/g, "=…").replace(/\d+(\.\d+)?/g, "n").slice(0, 110);
    const g = groups.get(`${m.kind}|${key}`);
    if (g) g.count++; else groups.set(`${m.kind}|${key}`, { kind: m.kind, key, count: 1, sample: m.text.slice(0, 220) });
  }
  const count = (re: RegExp): number => msgs.filter((m) => re.test(m.text)).length;
  const tail = lines.filter((l) => /EnergyPlus (Completed|Terminated)|Elapsed Time/.test(l)).join(" | ");
  return {
    fatal: msgs.filter((m) => m.kind === "Fatal").length,
    severe: msgs.filter((m) => m.kind === "Severe").length,
    warning: msgs.filter((m) => m.kind === "Warning").length,
    completed: /Completed Successfully/.test(text),
    groups: [...groups.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind < b.kind ? -1 : 1)),
    notEnclosed: count(/not fully enclosed/),
    areaMismatch: count(/InterZone Surface Areas do not match/),
    subsurfaceOutside: count(/does not surround subsurface/),
    nonPlanar: count(/non-planar/i),
    vertexOrdering: count(/Vertex ordering/i),
    nonConvex: count(/non-convex/i),
    tail,
  };
}

export function formatErr(s: ErrSummary, maxGroups = 14): string[] {
  const out = [
    `  ENERGYPLUS SAID: ${s.completed ? "completed" : "DID NOT COMPLETE"} · Fatal ${s.fatal} · Severe ${s.severe} · Warning ${s.warning}` +
      (s.tail ? `  (${s.tail})` : ""),
    `    the geometry messages: not fully enclosed ${s.notEnclosed} · inter-zone area mismatch ${s.areaMismatch} · ` +
      `subsurface outside its base ${s.subsurfaceOutside} · non-planar ${s.nonPlanar} · vertex ordering ${s.vertexOrdering} · non-convex ${s.nonConvex}`,
  ];
  for (const g of s.groups.slice(0, maxGroups)) out.push(`    ${g.kind.padEnd(7)} ×${String(g.count).padStart(4)}  ${g.sample}`);
  if (s.groups.length > maxGroups) out.push(`    … ${s.groups.length - maxGroups} more groups`);
  return out;
}

export interface EioSurface { name: string; cls: string; netAreaM2: number; grossAreaM2: number; azimuthDeg: number; tiltDeg: number; zone: string }

/** Output:Surfaces:List,Details — the engine's own reading of every surface */
export function parseEioSurfaces(text: string): EioSurface[] {
  const out: EioSurface[] = [];
  let cols: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("! <HeatTransfer Surface>")) { cols = line.slice(2).split(",").map((c) => c.trim()); continue; }
    if (!line.startsWith("HeatTransfer Surface,") || !cols) continue;
    const v = line.split(",").map((c) => c.trim());
    const at = (label: RegExp): number => cols!.findIndex((c) => label.test(c));
    const num = (i: number): number => (i >= 0 ? Number(v[i]) : NaN);
    out.push({
      name: v[at(/^Surface Name/)] ?? "", cls: v[at(/^Surface Class/)] ?? "",
      netAreaM2: num(at(/Area \(Net\)/)), grossAreaM2: num(at(/Area \(Gross\)/)),
      azimuthDeg: num(at(/^Azimuth/)), tiltDeg: num(at(/^Tilt/)), zone: v[at(/^Zone Name/)] ?? "",
    });
  }
  return out;
}
