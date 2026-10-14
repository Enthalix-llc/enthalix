// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE GROUND, READ FROM THE SITE MODEL. `_Site.ifc` (Revit, IFC4X3) carries
// the terrain as IfcGeographicElement TERRAIN toposolids — the grassland,
// the paths, the pavers. Their triangles ARE the grade. Both files state
// absolute elevations in the same feet (the user, 2026-09-03: the storey
// elevations match the site's), so nothing is shifted vertically; in plan
// the site is true-north-up and the house grid is rotated by its own
// TrueNorth (22°), so the terrain is turned INTO the house frame — the house
// is the module's frame — by an angle the gate verifies on the concrete
// path tiles that exist in both files (they sit on the ground).
//
// Excavation: the terrain beside the house was cut below the footings. A
// sample taken at the wall face reads the pit, not the grade. So a sample
// MARCHES OUTWARD in 6-inch steps (the user's rule) and takes the height
// where the ground stops rising — the rim of the cut, or the ground itself
// when there is no cut. Capped at 3 m and counted.

import type * as WebIFC from "web-ifc";
import { IFCGEOGRAPHICELEMENT, IFCBUILDINGELEMENTPROXY, IFCCOLUMN, IFCSLAB, IFCWALL, IFCBEAM, IFCRAMPFLIGHT, IFCSTAIRFLIGHT, IFCRAILING, IFCPLATE, IFCMEMBER,
  IFCLIGHTFIXTURE, IFCLAMP, IFCAIRTERMINAL, IFCAIRTERMINALBOX, IFCDUCTSEGMENT, IFCDUCTFITTING, IFCDUCTSILENCER, IFCPIPESEGMENT, IFCPIPEFITTING, IFCFLOWTERMINAL, IFCSANITARYTERMINAL,
  IFCWASTETERMINAL, IFCSTACKTERMINAL, IFCCONTROLLER, IFCDAMPER, IFCFAN, IFCOUTLET, IFCSWITCHINGDEVICE, IFCJUNCTIONBOX, IFCCABLECARRIERSEGMENT, IFCCABLECARRIERFITTING, IFCCABLESEGMENT,
  IFCELECTRICDISTRIBUTIONBOARD, IFCELECTRICAPPLIANCE, IFCELECTRICGENERATOR, IFCELECTRICFLOWSTORAGEDEVICE, IFCELECTRICMOTOR, IFCTRANSFORMER, IFCPROTECTIVEDEVICE, IFCSENSOR, IFCACTUATOR,
  IFCALARM, IFCFLOWMETER, IFCFLOWINSTRUMENT, IFCUNITARYEQUIPMENT, IFCUNITARYCONTROLELEMENT, IFCSPACEHEATER, IFCTANK, IFCVALVE, IFCPUMP, IFCSOLARDEVICE, IFCHEATEXCHANGER, IFCCOIL,
  IFCBOILER, IFCCHILLER, IFCCOMPRESSOR, IFCCONDENSER, IFCEVAPORATOR, IFCEVAPORATIVECOOLER, IFCHUMIDIFIER, IFCBURNER, IFCENGINE, IFCCOOLINGTOWER, IFCCOOLEDBEAM, IFCAIRTOAIRHEATRECOVERY,
  IFCTUBEBUNDLE, IFCFILTER, IFCINTERCEPTOR, IFCFURNITURE, IFCAUDIOVISUALAPPLIANCE, IFCCOMMUNICATIONSAPPLIANCE, IFCDISTRIBUTIONELEMENT, IFCDISTRIBUTIONFLOWELEMENT, IFCDISTRIBUTIONCONTROLELEMENT,
  IFCFLOWSEGMENT, IFCFLOWFITTING, IFCFLOWMOVINGDEVICE, IFCFLOWCONTROLLER, IFCFLOWSTORAGEDEVICE, IFCFLOWTREATMENTDEVICE, IFCENERGYCONVERSIONDEVICE } from "web-ifc";

export type V3 = [number, number, number];

export interface TerrainSource {
  /** every TERRAIN triangle in the site file's own world frame (metres, Y-up) */
  tris: V3[][];
  elements: Array<{ expressId: number; name: string; tris: number; top: number }>;
}

export interface Terrain {
  tris: V3[][];
  cellM: number;
  cells: Map<string, number[]>;
  min: V3;
  max: V3;
  rotationDeg: number;
}

export const STEP_M = 0.1524;   // six inches — the user's sampling increment
export const MARCH_MAX_M = 3.0;

export function rotateY(p: V3, deg: number): V3 {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  return [cs * p[0] - sn * p[2], p[1], sn * p[0] + cs * p[2]];
}

/** stream the TERRAIN toposolids; every other geographic element (landings,
 *  stairs) is furniture on the ground, not the ground */
export function readTerrain(api: WebIFC.IfcAPI, modelID: number): TerrainSource {
  const tris: V3[][] = [];
  const elements: TerrainSource["elements"] = [];
  api.StreamAllMeshesWithTypes(modelID, [IFCGEOGRAPHICELEMENT], (mesh) => {
    const line = api.GetLine(modelID, mesh.expressID) as { Name?: { value?: string }; PredefinedType?: { value?: string } };
    if ((line.PredefinedType?.value ?? "").toUpperCase() !== "TERRAIN") return;
    let n = 0, top = -Infinity;
    for (let g = 0; g < mesh.geometries.size(); g++) {
      const pg = mesh.geometries.get(g);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const m = pg.flatTransformation;
      const P = (i: number): V3 => {
        const x = v[6 * i]!, y = v[6 * i + 1]!, z = v[6 * i + 2]!;
        return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
      };
      for (let i = 0; i < ix.length; i += 3) {
        const t = [P(ix[i]!), P(ix[i + 1]!), P(ix[i + 2]!)];
        tris.push(t); n++;
        for (const p of t) top = Math.max(top, p[1]);
      }
      geom.delete();
    }
    elements.push({ expressId: mesh.expressID, name: line.Name?.value ?? "?", tris: n, top });
  });
  return { tris, elements };
}

/** every product in the site file that is NOT terrain — trees, ties, a dock's
 *  columns and decks, retaining walls, ramps: what shades the house (user,
 *  2026-09-05). Each element keeps its name and class; the triangles are in
 *  the site's own frame until rotated like the terrain. */
export interface SiteElement { expressId: number; name: string; ifcClass: string; tris: V3[][]; predefinedType?: string | null }

export const SHADING_TYPES: Array<[number, string]> = [
  [IFCBUILDINGELEMENTPROXY, "IfcBuildingElementProxy"], [IFCCOLUMN, "IfcColumn"], [IFCSLAB, "IfcSlab"], [IFCWALL, "IfcWall"],
  [IFCBEAM, "IfcBeam"], [IFCRAMPFLIGHT, "IfcRampFlight"], [IFCSTAIRFLIGHT, "IfcStairFlight"], [IFCRAILING, "IfcRailing"],
  [IFCPLATE, "IfcPlate"], [IFCMEMBER, "IfcMember"], [IFCGEOGRAPHICELEMENT, "IfcGeographicElement"],
];
/** THE MEP CLASSES (2026-09-10): what a services model exports its equipment, fixtures, terminals and runs as — every
 *  distribution class web-ifc knows, streamed into the SYSTEMS inventory; a Revit export puts most equipment in
 *  IfcBuildingElementProxy (SHADING_TYPES reads those), the rest here. Not shading: a duct inside a room shades nothing. */
export const MEP_TYPES: Array<[number, string]> = [
  [IFCLIGHTFIXTURE, "IfcLightFixture"], [IFCLAMP, "IfcLamp"], [IFCAIRTERMINAL, "IfcAirTerminal"], [IFCAIRTERMINALBOX, "IfcAirTerminalBox"],
  [IFCDUCTSEGMENT, "IfcDuctSegment"], [IFCDUCTFITTING, "IfcDuctFitting"], [IFCDUCTSILENCER, "IfcDuctSilencer"], [IFCPIPESEGMENT, "IfcPipeSegment"], [IFCPIPEFITTING, "IfcPipeFitting"],
  [IFCFLOWTERMINAL, "IfcFlowTerminal"], [IFCSANITARYTERMINAL, "IfcSanitaryTerminal"], [IFCWASTETERMINAL, "IfcWasteTerminal"], [IFCSTACKTERMINAL, "IfcStackTerminal"],
  [IFCCONTROLLER, "IfcController"], [IFCDAMPER, "IfcDamper"], [IFCFAN, "IfcFan"], [IFCOUTLET, "IfcOutlet"], [IFCSWITCHINGDEVICE, "IfcSwitchingDevice"], [IFCJUNCTIONBOX, "IfcJunctionBox"],
  [IFCCABLECARRIERSEGMENT, "IfcCableCarrierSegment"], [IFCCABLECARRIERFITTING, "IfcCableCarrierFitting"], [IFCCABLESEGMENT, "IfcCableSegment"],
  [IFCELECTRICDISTRIBUTIONBOARD, "IfcElectricDistributionBoard"], [IFCELECTRICAPPLIANCE, "IfcElectricAppliance"], [IFCELECTRICGENERATOR, "IfcElectricGenerator"],
  [IFCELECTRICFLOWSTORAGEDEVICE, "IfcElectricFlowStorageDevice"], [IFCELECTRICMOTOR, "IfcElectricMotor"], [IFCTRANSFORMER, "IfcTransformer"], [IFCPROTECTIVEDEVICE, "IfcProtectiveDevice"],
  [IFCSENSOR, "IfcSensor"], [IFCACTUATOR, "IfcActuator"], [IFCALARM, "IfcAlarm"], [IFCFLOWMETER, "IfcFlowMeter"], [IFCFLOWINSTRUMENT, "IfcFlowInstrument"],
  [IFCUNITARYEQUIPMENT, "IfcUnitaryEquipment"], [IFCUNITARYCONTROLELEMENT, "IfcUnitaryControlElement"], [IFCSPACEHEATER, "IfcSpaceHeater"], [IFCTANK, "IfcTank"], [IFCVALVE, "IfcValve"],
  [IFCPUMP, "IfcPump"], [IFCSOLARDEVICE, "IfcSolarDevice"], [IFCHEATEXCHANGER, "IfcHeatExchanger"], [IFCCOIL, "IfcCoil"], [IFCBOILER, "IfcBoiler"], [IFCCHILLER, "IfcChiller"],
  [IFCCOMPRESSOR, "IfcCompressor"], [IFCCONDENSER, "IfcCondenser"], [IFCEVAPORATOR, "IfcEvaporator"], [IFCEVAPORATIVECOOLER, "IfcEvaporativeCooler"], [IFCHUMIDIFIER, "IfcHumidifier"],
  [IFCBURNER, "IfcBurner"], [IFCENGINE, "IfcEngine"], [IFCCOOLINGTOWER, "IfcCoolingTower"], [IFCCOOLEDBEAM, "IfcCooledBeam"], [IFCAIRTOAIRHEATRECOVERY, "IfcAirToAirHeatRecovery"],
  [IFCTUBEBUNDLE, "IfcTubeBundle"], [IFCFILTER, "IfcFilter"], [IFCINTERCEPTOR, "IfcInterceptor"], [IFCFURNITURE, "IfcFurniture"],
  [IFCAUDIOVISUALAPPLIANCE, "IfcAudioVisualAppliance"], [IFCCOMMUNICATIONSAPPLIANCE, "IfcCommunicationsAppliance"],
  [IFCDISTRIBUTIONELEMENT, "IfcDistributionElement"], [IFCDISTRIBUTIONFLOWELEMENT, "IfcDistributionFlowElement"], [IFCDISTRIBUTIONCONTROLELEMENT, "IfcDistributionControlElement"],
  [IFCFLOWSEGMENT, "IfcFlowSegment"], [IFCFLOWFITTING, "IfcFlowFitting"], [IFCFLOWMOVINGDEVICE, "IfcFlowMovingDevice"], [IFCFLOWCONTROLLER, "IfcFlowController"],
  [IFCFLOWSTORAGEDEVICE, "IfcFlowStorageDevice"], [IFCFLOWTREATMENTDEVICE, "IfcFlowTreatmentDevice"], [IFCENERGYCONVERSIONDEVICE, "IfcEnergyConversionDevice"],
];

/** every placed mesh of the given classes, with its name, class and stated PredefinedType — the one stream both lists use */
export function streamElements(api: WebIFC.IfcAPI, modelID: number, types: Array<[number, string]>, skip?: (type: number, line: { Name?: { value?: string }; PredefinedType?: { value?: string } }) => boolean): SiteElement[] {
  const out: SiteElement[] = [];
  for (const [type, cls] of types) {
    api.StreamAllMeshesWithTypes(modelID, [type], (mesh) => {
      const line = api.GetLine(modelID, mesh.expressID) as { Name?: { value?: string }; PredefinedType?: { value?: string } };
      if (skip && skip(type, line)) return;
      const tris: V3[][] = [];
      for (let g = 0; g < mesh.geometries.size(); g++) {
        const pg = mesh.geometries.get(g);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);
        const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const m = pg.flatTransformation;
        const P = (i: number): V3 => {
          const x = v[6 * i]!, y = v[6 * i + 1]!, z = v[6 * i + 2]!;
          return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
        };
        for (let i = 0; i < ix.length; i += 3) tris.push([P(ix[i]!), P(ix[i + 1]!), P(ix[i + 2]!)]);
        geom.delete();
      }
      if (tris.length) out.push({ expressId: mesh.expressID, name: line.Name?.value ?? "?", ifcClass: cls, tris, predefinedType: line.PredefinedType?.value ?? null });
    });
  }
  return out;
}
export function readSiteElements(api: WebIFC.IfcAPI, modelID: number): SiteElement[] {
  return streamElements(api, modelID, SHADING_TYPES, (type, line) => type === IFCGEOGRAPHICELEMENT && (line.PredefinedType?.value ?? "").toUpperCase() === "TERRAIN");
}
/** the services classes' geometry — the SYSTEMS inventory's other half (the proxies come from readSiteElements) */
export function readMepGeometry(api: WebIFC.IfcAPI, modelID: number): SiteElement[] {
  return streamElements(api, modelID, MEP_TYPES);
}

/** the site elements turned into the house frame, as the terrain is */
export function rotateSiteElements(els: SiteElement[], rotationDeg: number): SiteElement[] {
  return els.map((e) => ({ ...e, tris: e.tris.map((t) => t.map((p) => rotateY(p, rotationDeg)) as V3[]) }));
}

/** the triangles turned into the house frame and binned by plan cell */
export function buildTerrain(source: V3[][], rotationDeg: number, cellM = 1): Terrain {
  const tris = rotationDeg === 0 ? source : source.map((t) => t.map((p) => rotateY(p, rotationDeg)));
  const cells = new Map<string, number[]>();
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  const key = (i: number, j: number): string => `${i}|${j}`;
  tris.forEach((t, ti) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of t) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
    }
    for (let i = Math.floor(x0 / cellM); i <= Math.floor(x1 / cellM); i++)
      for (let j = Math.floor(z0 / cellM); j <= Math.floor(z1 / cellM); j++) {
        const k = key(i, j);
        const a = cells.get(k);
        if (a) a.push(ti); else cells.set(k, [ti]);
      }
  });
  return { tris, cellM, cells, min, max, rotationDeg };
}

/** the ground's top under a plan point: the highest hit of a vertical ray */
export function heightAt(t: Terrain, x: number, z: number): number | null {
  const ids = t.cells.get(`${Math.floor(x / t.cellM)}|${Math.floor(z / t.cellM)}`);
  if (!ids) return null;
  let best: number | null = null;
  for (const ti of ids) {
    const [a, b, c] = t.tris[ti]! as [V3, V3, V3];
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / d;
    const l2 = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) best = y;
  }
  return best;
}

/** anything that answers "how high is the ground here": the terrain mesh,
 *  or concrete standing on fill (a slab, a stair's treads, a landing) */
export interface HeightField { heightAt(x: number, z: number): number | null }

export interface FillFace { n: V3; outer: V3[] }
/** the upward faces of a fill element as a height field: the height of the
 *  face's plane at every plan point inside its outline — a stair's treads
 *  give the stepped ground line under the steps for free */
export function polygonField(faces: FillFace[]): HeightField {
  const tops = faces.filter((f) => f.n[1] > 0.3 && f.outer.length >= 3);
  const inRing = (x: number, z: number, r: V3[]): boolean => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!, b = r[j]!;
      if ((a[2] > z) !== (b[2] > z) && x < ((b[0] - a[0]) * (z - a[2])) / (b[2] - a[2]) + a[0]) inside = !inside;
    }
    return inside;
  };
  return {
    heightAt(x, z) {
      let best: number | null = null;
      for (const f of tops) {
        if (!inRing(x, z, f.outer)) continue;
        const p0 = f.outer[0]!;
        const y = p0[1] - (f.n[0] * (x - p0[0]) + f.n[2] * (z - p0[2])) / f.n[1];
        if (best === null || y > best) best = y;
      }
      return best;
    },
  };
}

export interface GradeSample { gradeM: number | null; atM: number; capped: boolean }

/** how far the ground must fall away from its high point before the march
 *  believes it has passed the rim — a flat excavation floor never rises,
 *  so the first non-rise cannot be the stop */
export const RIM_DROP_M = 0.15;

/** grade beside a wall or slab edge: march outward from the face in 6-inch
 *  steps keeping the highest ground seen, and stop once the ground has
 *  fallen clearly away from it — across an excavation (flat floor, then the
 *  rim, then the land falling away) to its rim, or the ground itself where
 *  there is none. A hillside that keeps rising is capped and counted. */
export function gradeBeside(t: Terrain, x: number, z: number, out: [number, number],
  stepM = STEP_M, maxM = MARCH_MAX_M): GradeSample {
  let high: number | null = null, atM = 0, last = 0;
  for (let d = 0; d <= maxM + 1e-9; d += stepM) {
    const h = heightAt(t, x + out[0] * d, z + out[1] * d);
    if (h === null) { if (high === null) continue; else break; }
    last = d;
    if (high === null || h > high) { high = h; atM = d; continue; }
    if (h < high - RIM_DROP_M) return { gradeM: high, atM, capped: false };
  }
  return { gradeM: high, atM, capped: high !== null && last >= maxM - 1e-9 && atM >= maxM - stepM - 1e-9 };
}

/** the triangles as one Float32 run, and back — the stored form */
export function flattenTris(tris: V3[][]): Float32Array {
  const flat = new Float32Array(tris.length * 9);
  tris.forEach((tri, i) => tri.forEach((p, j) => { flat[9 * i + 3 * j] = p[0]; flat[9 * i + 3 * j + 1] = p[1]; flat[9 * i + 3 * j + 2] = p[2]; }));
  return flat;
}
export function unflattenTris(flat: Float32Array): V3[][] {
  const out: V3[][] = [];
  for (let i = 0; i + 8 < flat.length; i += 9) out.push([[flat[i]!, flat[i + 1]!, flat[i + 2]!], [flat[i + 3]!, flat[i + 4]!, flat[i + 5]!], [flat[i + 6]!, flat[i + 7]!, flat[i + 8]!]]);
  return out;
}
/** the house's TrueNorth (module plan, unit) → the angle that turns the
 *  true-north-up site into the house frame */
export function rotationFromTrueNorth(tn: [number, number] | null): number {
  return tn ? Math.round(((Math.atan2(tn[0], -tn[1]) * 180) / Math.PI) * 100) / 100 : 0;
}
