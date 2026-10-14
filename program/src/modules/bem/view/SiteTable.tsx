// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SITE TABLE under the SITE view (user, 2026-09-05): the site file's
// shading elements as UNIQUE rows — a row for the trees, a row for the ties,
// the dock's columns — each with its count, class, triangles, how many are
// hidden and how many the user deleted from the model. Read from idf.db's
// site_elements (the contract: what the IDF will carry as shading), the
// deletions from the ledger. A row click lights every element of that kind;
// each element is also right-click selectable in the view for hide / delete.

export interface SiteRowIn { expressId: number; name: string; ifcClass: string; tris: number; file?: string }

export interface SiteTypeRow { name: string; file: string; ifcClass: string; ids: number[]; tris: number; hidden: number; deleted: Array<{ expressId: number; name: string }> }

/** the file's family:type, the instance id dropped */
export const siteTypeName = (name: string): string => name.replace(/:\d+$/, "");

export function siteTypes(els: SiteRowIn[], hidden: ReadonlySet<number>, deleted: Array<{ expressId: number; name: string; file?: string }>): SiteTypeRow[] {
  const rows = new Map<string, SiteTypeRow>();
  const keyOf = (name: string, file: string | undefined): string => `${file ?? ""}|${siteTypeName(name)}`;
  for (const e of els) {
    const k = keyOf(e.name, e.file);
    const r = rows.get(k) ?? { name: siteTypeName(e.name), file: e.file ?? "", ifcClass: e.ifcClass, ids: [], tris: 0, hidden: 0, deleted: [] };
    r.ids.push(e.expressId); r.tris += e.tris; if (hidden.has(e.expressId)) r.hidden++;
    rows.set(k, r);
  }
  for (const d of deleted) {
    const k = keyOf(d.name, d.file);
    const r = rows.get(k) ?? { name: siteTypeName(d.name), file: d.file ?? "", ifcClass: "", ids: [], tris: 0, hidden: 0, deleted: [] };
    r.deleted.push(d);
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}
