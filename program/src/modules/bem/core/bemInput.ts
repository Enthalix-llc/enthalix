// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BEM MODULE READS THE FILE. idf.db is the contract: a downstream module
// opens it and finds everything an EnergyPlus writer needs — the surfaces
// with their zones and their side of the ground line, the elements'
// GlobalIds and IsExternal verdicts, every zone with the volume of the solid
// it came from, the site and the true north the IFC states. Nothing here
// reaches into BIM's memory. The gate proves it: the IDF written from the
// closure and the IDF written from the file must be byte-identical.

import type { Database } from "sql.js";
import { queryIdfFaces, queryIdfElements, queryZones, queryOpenings, queryElementTypes, queryMepElements, queryMepSystems, querySiteElements, queryVoidRulings, readMetaOf, type DbFaceRow, type ZoneRowIn, type ElementTypeRow, type MepElementRow, type MepSystemRow, type VoidRulingRow } from "../../../core/db.js";
import type { PlacedOpening } from "../../../core/placeOpenings.js";
import type { IdfFaceIn, IdfElementIn, IdfSite, ShadingElementIn } from "./bemIdf.js";

export interface BemInput {
  meta: Map<string, string>;
  /** the IFC's own file name (`meta.source_ifc_name`): the IDF header and the Building name */
  sourceIfcName: string;
  sourceIfcSha256: string;
  /** idf.db's content hash — what bem.db records it was built from */
  contentSha256: string;
  rows: DbFaceRow[];
  faces: IdfFaceIn[];
  elements: Map<number, IdfElementIn>;
  /** the file's word per TYPE (2026-09-08): a stated U, a layer set — from idf.db's element_types */
  types: Map<number, ElementTypeRow>;
  /** every window and door placed on its cell, with its glazing verdict */
  openings: PlacedOpening[];
  zones: ZoneRowIn[];
  zoneVolumesM3: Map<string, number>;
  site: IdfSite | null;
  /** where the site's elevation came from (2026-09-07): the lowest occupied level, else the IfcSite; and IfcSite.RefElevation as stated */
  siteElevationFrom: string;
  siteRefElevationM: number | null;
  trueNorth: [number, number] | null;
  /** THE SERVICES INVENTORY (2026-09-10): the projected shade files' elements (without their triangles) and systems, as idf.db holds them */
  mep: { elements: MepElementRow[]; systems: MepSystemRow[] };
  /** THE SHADING SET (2026-09-15): idf.db's site_elements — the projected files' elements as ruled (deletions vetoed), triangles in the house frame */
  siteElements: ShadingElementIn[];
  /** THE VOID RULINGS (user, 2026-09-18): per space the void QA flagged, where the insulation sits — idf.db's void_rulings */
  voidRulings: VoidRulingRow[];
}

/** THE ZONES DRAWN ON THE SHEET, merged (2026-09-10): every room a Zone node holds becomes that zone — the faces' two sides, the
 *  rows, the zone list (one entry per zone, the rooms' volumes summed, the source naming them) and the volumes — BEFORE the
 *  resolver or the writer read anything; the IfcSpace each side came from (spaceIfc) is untouched, so a Space per room still
 *  sits inside the zone. The same input comes back when nothing is held. */
export function mergeInputZones(input: BemInput, roomZone: Record<string, string>): BemInput {
  const held = Object.keys(roomZone).filter((r) => roomZone[r] !== r);
  if (!held.length) return input;
  const map = <T extends string | null | undefined>(z: T): T => (z && roomZone[z] ? (roomZone[z] as T) : z);
  const touch = (a: string | null | undefined, b: string | null | undefined): boolean => !!((a && roomZone[a] && roomZone[a] !== a) || (b && roomZone[b] && roomZone[b] !== b));
  const faces = input.faces.map((f) => (touch(f.space, f.spaceFacing) ? { ...f, space: map(f.space), spaceFacing: map(f.spaceFacing) } : f));
  const rows = input.rows.map((r) => (touch(r.space, r.spaceFacing) ? { ...r, space: map(r.space), spaceFacing: map(r.spaceFacing) } : r));
  const zones: ZoneRowIn[] = []; const seen = new Map<string, ZoneRowIn>();
  for (const z of input.zones) {
    const name = roomZone[z.name] ?? z.name;
    const cur = seen.get(name);
    if (!cur) { const nz: ZoneRowIn = { ...z, name, volumeSource: name !== z.name ? `merged on the sheet: ${z.name}` : z.volumeSource }; seen.set(name, nz); zones.push(nz); }
    else { cur.volumeM3 += z.volumeM3; cur.volumeSource = `${cur.volumeSource}, ${z.name}`; if (z.kind === "room") cur.kind = "room"; }
  }
  // A VOID RULING follows its space into the zone it was merged into (2026-09-18): the writer reads the SURFACE's zone
  // name, so a ruling still keyed to the void alone would name a zone that no longer exists. Two voids in one Zone that
  // were ruled differently keep the first and say so — the writer names the disagreement, it never averages one.
  const voidRulings = input.voidRulings.map((r) => ({ ...r, space: map(r.space) }));
  return { ...input, faces, rows, zones, voidRulings, zoneVolumesM3: new Map(zones.map((z) => [z.name, z.volumeM3])) };
}
/** the stored rows as the writer takes them — ONE mapping for the gate and the app; each face carries the openings placed on it (2026-09-08) */
export function facesFromRows(rows: DbFaceRow[], openings: PlacedOpening[] = []): IdfFaceIn[] {
  const byRow = new Map<number, PlacedOpening[]>();
  for (const o of openings) (byRow.get(o.surfaceId) ?? byRow.set(o.surfaceId, []).get(o.surfaceId)!).push(o);
  return rows.map((f) => ({
    id: f.id, elementId: f.elementId, category: f.ifcClass, n: f.n, outer: f.outer, holes: f.holes,
    areaM2: f.areaM2, grossAreaM2: f.grossAreaM2, thicknessM: f.thicknessM,
    space: f.space ?? null, spaceFacing: f.spaceFacing ?? null, spaceIfc: f.spaceIfc ?? null, spaceFacingIfc: f.spaceFacingIfc ?? null,
    grade: f.grade, gradeDepthM: f.gradeDepthM,
    openings: f.id !== undefined ? byRow.get(f.id) : undefined,
  }));
}

export function readBemInput(db: Database): BemInput {
  const meta = readMetaOf(db);
  const rows = queryIdfFaces(db);
  const elements = new Map<number, IdfElementIn>();
  for (const [id, e] of queryIdfElements(db)) elements.set(id, { globalId: e.globalId, isExternal: e.isExternal, ifcClass: e.ifcClass, name: e.name, typeId: e.typeId, glazingFraction: e.glazingFraction });
  const types = queryElementTypes(db);
  const openings = queryOpenings(db);
  const zones = queryZones(db);
  const zoneVolumesM3 = new Map(zones.map((z) => [z.name, z.volumeM3]));
  const lat = meta.get("site_latitude"), lon = meta.get("site_longitude"), elev = meta.get("site_elevation_m");
  const site: IdfSite | null = lat && lon ? { latitude: Number(lat), longitude: Number(lon), elevationM: Number(elev || 0) } : null;
  const siteElevationFrom = meta.get("site_elevation_from") || "";
  const siteRefElevationM = meta.get("site_ref_elevation_m") ? Number(meta.get("site_ref_elevation_m")) : null;
  const tn = meta.get("true_north");
  const trueNorth = tn ? (tn.split(",").map(Number) as [number, number]) : null;
  const mep = { elements: queryMepElements(db, false), systems: queryMepSystems(db) };
  // the shading set, triangle by triangle from the stored blob (nine floats per triangle)
  const siteElements: ShadingElementIn[] = querySiteElements(db).map((r) => {
    const tris: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
    for (let k = 0; k + 8 < r.xyz.length; k += 9) tris.push([[r.xyz[k]!, r.xyz[k + 1]!, r.xyz[k + 2]!], [r.xyz[k + 3]!, r.xyz[k + 4]!, r.xyz[k + 5]!], [r.xyz[k + 6]!, r.xyz[k + 7]!, r.xyz[k + 8]!]]);
    return { expressId: r.expressId, file: r.file, name: r.name, ifcClass: r.ifcClass, tris };
  });
  return {
    siteElements,
    voidRulings: queryVoidRulings(db),
    mep,
    meta,
    sourceIfcName: meta.get("source_ifc_name") || meta.get("source_name") || "idf.db",
    sourceIfcSha256: meta.get("source_ifc_sha256") ?? "",
    contentSha256: meta.get("content_sha256") ?? "",
    rows, faces: facesFromRows(rows, openings), elements, types, openings, zones, zoneVolumesM3, site, trueNorth, siteElevationFrom, siteRefElevationM,
  };
}
