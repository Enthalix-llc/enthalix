// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// LOSSLESS DELETION FROM THE IFC ITSELF. The user rules that an element does
// not exist — a ceiling the file draws over the Studio Bath that is not there
// — and the ruling is written into the source file, not into a sidecar. The
// discipline is the predecessor project's (its edit-pipeline notes, §5.4),
// ported without its code: a STEP file is one entity per line; index every
// line, splice the target out of every relationship that lists it, drop a
// relationship that would be left empty, drop the entity, emit every other
// byte verbatim, and REFUSE TO WRITE if any surviving line still references a
// dropped id. Nothing else is touched: the element's own placement and
// representation lines are left as orphans, which STEP permits, so the edit
// is the smallest that keeps the file valid.

export interface DeleteReport {
  deleted: number[];
  /** relationship lines rewritten (the target spliced out of a list) */
  spliced: number[];
  /** relationship lines dropped because they referred only to the target */
  droppedRels: number[];
  /** lines that still referenced a dropped id — the write is refused when any */
  dangling: Array<{ line: number; ifcType: string; refs: number[] }>;
  /** referencing lines of a type these rules do not know — the write is refused */
  unhandled: Array<{ line: number; ifcType: string }>;
  ok: boolean;
  lineEnding: "\r\n" | "\n";
}

/** the `#N` tokens of one entity line's attribute list, outside string literals */
function refsOf(attrs: string): number[] {
  const out: number[] = [];
  let inStr = false;
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i]!;
    if (c === "'") { inStr = !inStr; continue; }
    if (inStr || c !== "#") continue;
    let j = i + 1;
    while (j < attrs.length && attrs[j]! >= "0" && attrs[j]! <= "9") j++;
    if (j > i + 1) { out.push(Number(attrs.slice(i + 1, j))); i = j - 1; }
  }
  return out;
}

/** relationships that LIST the things they relate: the target is spliced out
 *  of the list, and the rel goes when the list would be empty */
const LIST_RELS = /^IFCREL(CONTAINEDINSPATIALSTRUCTURE|AGGREGATES|NESTS|DEFINESBYPROPERTIES|DEFINESBYTYPE|ASSOCIATES[A-Z]*|ASSIGNS[A-Z]*|REFERENCEDINSPATIALSTRUCTURE|DECLARES)$/;
/** relationships whose only payload is the target: dropped with it */
const SINGLE_RELS = /^IFCREL(SPACEBOUNDARY[A-Z0-9]*|VOIDSELEMENT|FILLSELEMENT|CONNECTSPATHELEMENTS|CONNECTSELEMENTS|COVERSBLDGELEMENTS|COVERSSPACES|PROJECTSELEMENT)$/;

export function deleteFromStep(text: string, ids: number[]): { text: string; report: DeleteReport } {
  const lineEnding: "\r\n" | "\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(lineEnding);
  const report: DeleteReport = { deleted: [], spliced: [], droppedRels: [], dangling: [], unhandled: [], ok: true, lineEnding };
  const targets = new Set(ids);
  const head = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/;
  // index: express id → line, and every incoming reference
  const lineOf = new Map<number, number>();
  const incoming = new Map<number, number[]>();
  const parsed = new Map<number, { id: number; type: string; open: number }>();
  for (let li = 0; li < lines.length; li++) {
    const m = head.exec(lines[li]!);
    if (!m) continue;
    const id = Number(m[1]);
    lineOf.set(id, li);
    parsed.set(li, { id, type: m[2]!.toUpperCase(), open: m[0].length - 1 });
    const attrs = lines[li]!.slice(m[0].length);
    for (const r of refsOf(attrs)) {
      const a = incoming.get(r);
      if (a) a.push(li); else incoming.set(r, [li]);
    }
  }
  for (const id of targets) if (!lineOf.has(id)) { report.ok = false; report.unhandled.push({ line: -1, ifcType: `#${id} not in file` }); }
  if (!report.ok) return { text, report };

  const drop = new Set<number>();          // line indexes to remove
  const rewritten = new Map<number, string>();
  const dropEntity = (id: number): void => {
    const li = lineOf.get(id);
    if (li === undefined || drop.has(li)) return;
    drop.add(li);
    report.deleted.push(id);
    for (const ref of incoming.get(id) ?? []) {
      if (drop.has(ref)) continue;
      const p = parsed.get(ref)!;
      const cur = rewritten.get(ref) ?? lines[ref]!;
      if (LIST_RELS.test(p.type)) {
        // splice `#id` out of the list it sits in, then tidy the separators
        const attrs = cur.slice(p.open);
        const next = attrs.replace(new RegExp(`(?<=[(,])\\s*#${id}(?=\\s*[,)])`), "")
          .replace(/\(\s*,/g, "(").replace(/,\s*,/g, ",").replace(/,\s*\)/g, ")");
        if (/\(\s*\)/.test(next)) {
          drop.add(ref); report.droppedRels.push(p.id);
          for (const r2 of incoming.get(p.id) ?? []) if (!drop.has(r2)) report.unhandled.push({ line: r2, ifcType: parsed.get(r2)?.type ?? "?" });
        } else {
          rewritten.set(ref, cur.slice(0, p.open) + next);
          if (!report.spliced.includes(p.id)) report.spliced.push(p.id);
        }
      } else if (SINGLE_RELS.test(p.type)) {
        drop.add(ref); report.droppedRels.push(p.id);
      } else {
        report.unhandled.push({ line: ref, ifcType: p.type });
      }
    }
  };
  for (const id of targets) dropEntity(id);
  if (report.unhandled.length) { report.ok = false; return { text, report }; }

  // rebuild, then the guardrail: no survivor may reference a dropped id
  const droppedIds = new Set<number>();
  for (const li of drop) { const p = parsed.get(li); if (p) droppedIds.add(p.id); }
  const out: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    if (drop.has(li)) continue;
    const l = rewritten.get(li) ?? lines[li]!;
    const p = parsed.get(li);
    if (p) {
      const bad = refsOf(l.slice(p.open)).filter((r) => droppedIds.has(r));
      if (bad.length) report.dangling.push({ line: li, ifcType: p.type, refs: bad });
    }
    out.push(l);
  }
  if (report.dangling.length) { report.ok = false; return { text, report }; }
  return { text: out.join(lineEnding), report };
}

export function formatDelete(r: DeleteReport, name: (id: number) => string = () => ""): string[] {
  return [
    `  IFC DELETE — ${r.ok ? "ok" : "REFUSED"} · dropped ${r.deleted.map((id) => `#${id}${name(id)}`).join(", ") || "nothing"} · ` +
      `rels rewritten ${r.spliced.length} (${r.spliced.slice(0, 6).map((id) => `#${id}`).join(", ")}${r.spliced.length > 6 ? "…" : ""}) · rels dropped ${r.droppedRels.length}` +
      (r.unhandled.length ? ` · unhandled referencing types: ${[...new Set(r.unhandled.map((u) => u.ifcType))].join(", ")}` : "") +
      (r.dangling.length ? ` · DANGLING: ${r.dangling.slice(0, 4).map((d) => `${d.ifcType} → #${d.refs.join(",#")}`).join("; ")}` : ""),
  ];
}
