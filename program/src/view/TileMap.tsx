// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A SMALL MAP (2026-09-07): OpenStreetMap's tiles under markers, for the
// weather stations around the site. Web Mercator is a formula and a tile is
// an image at a computed place, so no library is needed: drag pans, the
// wheel zooms about the cursor, a marker click reports its id. The tiles
// come from tile.openstreetmap.org (attribution required and drawn); the
// map is a picture the user reads, nothing in the model comes from it.

import { useEffect, useRef, useState } from "react";

export interface MapBounds { minLat: number; maxLat: number; minLon: number; maxLon: number; zoom: number }

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  /** site: the IfcSite (or the located position); station: a weather station; on: the one in force */
  kind: "site" | "station" | "picked";
  on?: boolean;
  installed?: boolean;
  /** the station's ASHRAE zone is the project's (by county) */
  sameZone?: boolean;
  /** the installed file's .ddy has no valid summer design day: humidity was not measured */
  noHumidity?: boolean;
}

const TILE = 256;
const mercX = (lon: number, z: number): number => ((lon + 180) / 360) * TILE * 2 ** z;
const mercY = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};
const lonOf = (x: number, z: number): number => (x / (TILE * 2 ** z)) * 360 - 180;
const latOf = (y: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export function TileMap(p: {
  center: { latitude: number; longitude: number };
  zoom: number;
  /** a change of this key re-centres the map on `center` at `zoom` */
  viewKey: string;
  markers: MapMarker[];
  onMarker?: (m: MapMarker) => void;
  /** the view's bounds after every pan, zoom or resize (2026-09-07): what the list shows follows the map */
  onView?: (b: MapBounds) => void;
}): React.ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ lat: p.center.latitude, lon: p.center.longitude, z: p.zoom });
  useEffect(() => { setView({ lat: p.center.latitude, lon: p.center.longitude, z: p.zoom }); }, [p.viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const z = Math.round(view.z);
  const cx = mercX(view.lon, z), cy = mercY(view.lat, z);
  const left = cx - size.w / 2, top = cy - size.h / 2;
  useEffect(() => {
    if (!size.w || !size.h || !p.onView) return;
    p.onView({ minLat: latOf(top + size.h, z), maxLat: latOf(top, z), minLon: lonOf(left, z), maxLon: lonOf(left + size.w, z), zoom: z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.lat, view.lon, z, size.w, size.h]);
  const n = 2 ** z;
  const tiles: Array<{ x: number; y: number; px: number; py: number }> = [];
  if (size.w && size.h) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++) {
        tiles.push({ x: ((tx % n) + n) % n, y: ty, px: tx * TILE - left, py: ty * TILE - top });
      }
    }
  }
  const drag = useRef<{ x: number; y: number; lat: number; lon: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lon: view.lon, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, lon: lonOf(mercX(d.lon, z) - dx, z), lat: Math.max(-85, Math.min(85, latOf(mercY(d.lat, z) - dy, z))) }));
  };
  const onUp = (): void => { drag.current = null; };
  const onWheel = (e: React.WheelEvent): void => {
    const dz = e.deltaY < 0 ? 1 : -1;
    const nz = Math.max(2, Math.min(18, z + dz));
    if (nz === z) return;
    // zoom about the cursor: the point under it stays put
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = left + mx, wy = top + my;
    const lon = lonOf(wx, z), lat = latOf(wy, z);
    const k = 2 ** (nz - z);
    const ncx = mercX(lon, nz) - (mx - size.w / 2) , ncy = mercY(lat, nz) - (my - size.h / 2);
    void k;
    setView({ lat: latOf(ncy, nz), lon: lonOf(ncx, nz), z: nz });
  };
  return (
    <div ref={box} className="tileMap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      {tiles.map((t) => (
        <img key={`${z}/${t.x}/${t.y}`} className="tile" alt="" draggable={false} src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`} style={{ left: t.px, top: t.py }} />
      ))}
      {p.markers.map((m) => {
        const x = mercX(m.longitude, z) - left, y = mercY(m.latitude, z) - top;
        if (x < -30 || y < -30 || x > size.w + 30 || y > size.h + 30) return null;
        return (
          <div key={m.id} className={`marker ${m.kind}${m.on ? " on" : ""}${m.installed ? " installed" : ""}${m.sameZone ? " same" : ""}${m.noHumidity ? " nohum" : ""}`} style={{ left: x, top: y }} title={m.label}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) p.onMarker?.(m); }}>
            <span>{m.label}</span>
          </div>
        );
      })}
      <div className="mapAttrib">© OpenStreetMap contributors · zoom {z}</div>
    </div>
  );
}
