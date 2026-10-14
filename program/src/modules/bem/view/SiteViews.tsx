// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SITE TAB's VIEWS AND THE TABLES UNDER THEM (user, 2026-09-07). The
// tab's default view is the IDF-DB model with the files beside the house
// listed under it; "locate" swaps the view for a Google Maps frame on the
// site's position with an address locator under it; "choose a weather file"
// swaps it for a map of every available station with the list under it;
// SOLAR STUDIES (a checkbox in the column) brings back the terrain, the
// shading elements and the sun. Every table reads a stored row or a listing
// the web stated; the user picks, nothing is applied unasked.

import { Fragment, useEffect, useMemo, useState } from "react";
import { TileMap, type MapMarker, type MapBounds } from "../../../view/TileMap.js";
import { stationId, type NearStation, type StationFile } from "../../../core/weatherStations.js";
import type { SiteFileRow } from "../../../core/db.js";
import type { SiteTypeRow } from "./SiteTable.js";
import { distanceKm } from "../core/weather.js";
import { baseName, fmtLen, fmtDist, fmtDegDays } from "./bemUi.js";

export type SiteFocus = "model" | "location" | "weather";
export interface Located { latitude: number; longitude: number; elevationM?: number; label?: string }

/** THE POSITION IN FORCE, on OpenStreetMap (its tiles, attribution drawn) — and Google Maps in the user's OWN browser at the same point:
 *  Google's documented Maps URLs need no key and launch Google Maps under the user's own terms with Google; nothing of Google's is
 *  embedded in the app. `satellite`: the browser opens on the satellite base map, so the house itself confirms the place */
export function googleMapsUrl(latitude: number, longitude: number, satellite: boolean): string {
  const ll = `${latitude.toFixed(6)}%2C${longitude.toFixed(6)}`;
  return satellite ? `https://www.google.com/maps/@?api=1&map_action=map&center=${ll}&zoom=19&basemap=satellite` : `https://www.google.com/maps/search/?api=1&query=${ll}`;
}
export function LocationFrame(p: { latitude: number; longitude: number; label: string; satellite: boolean }): React.ReactElement {
  const markers: MapMarker[] = [{ id: "site", latitude: p.latitude, longitude: p.longitude, label: p.label, kind: "site", on: true }];
  return (
    <div className="gmap">
      <TileMap center={{ latitude: p.latitude, longitude: p.longitude }} zoom={17} viewKey={`${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`} markers={markers} />
      <div className="mapTag">{p.label} · <button className="qaBtn" onClick={() => void window.bem.openExternal(googleMapsUrl(p.latitude, p.longitude, p.satellite))} title="opens Google Maps at this point in your own browser">Open in Google Maps{p.satellite ? " (satellite)" : ""}</button></div>
    </div>
  );
}

/** THE LOCATOR under the map: the file's own address as the seed, an address typed → candidates from Nominatim → one picked = a staged ruling */
export function LocationLocator(p: {
  fileAddress: string | null;
  fileSite: { latitude: number; longitude: number; elevationM: number } | null;
  located: Located | undefined;
  imperial: boolean;
  satellite: boolean;
  onSatellite: (on: boolean) => void;
  onLocate: (loc: Located) => void;
  onClear: () => void;
}): React.ReactElement {
  const [q, setQ] = useState(p.fileAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [results, setResults] = useState<Array<{ name: string; latitude: number; longitude: number; kind: string }>>([]);
  useEffect(() => { if (!q && p.fileAddress) setQ(p.fileAddress); }, [p.fileAddress]); // eslint-disable-line react-hooks/exhaustive-deps
  const [typed, setTyped] = useState<{ lat: string; lon: string }>({ lat: "", lon: "" });
  // THE LADDER (2026-09-07: OpenStreetMap may know a town but not every rural road):
  // the address as typed, then without its house number, then the town and state — each
  // asked in turn, and the note says which form matched, so a town-level answer is never
  // mistaken for the house
  const search = async (): Promise<void> => {
    const full = q.trim();
    if (!full) return;
    setBusy(true); setNote("asking OpenStreetMap's Nominatim…"); setResults([]);
    const parts = full.split(",").map((x) => x.trim()).filter(Boolean);
    const noNumber = full.replace(/^\s*\d+[A-Za-z]?\s+/, "");
    const forms = [...new Set([full, noNumber, parts.length >= 3 ? parts.slice(-2).join(", ") : "", parts.length >= 2 ? parts[parts.length - 1]! : ""].filter(Boolean))];
    try {
      for (const form of forms) {
        const r = await window.bem.geocode(form);
        if ("error" in r) { setNote(`lookup failed: ${r.error}`); return; }
        if (r.results.length) {
          setResults(r.results);
          setNote(form === full
            ? `${r.results.length} candidate${r.results.length > 1 ? "s" : ""} for the address — click one to stage it as the site's position`
            : `no match for "${full}"; "${form}" matched (${r.results.length}) — a town-level position, kilometres coarse: pick it to see the area, or type the position below`);
          return;
        }
      }
      setNote(`no match for ${forms.map((f) => `"${f}"`).join(", ")} — type the position below`);
    } finally { setBusy(false); }
  };
  const typedOk = Number.isFinite(Number(typed.lat)) && Number.isFinite(Number(typed.lon)) && typed.lat.trim() !== "" && typed.lon.trim() !== "" && Math.abs(Number(typed.lat)) <= 90 && Math.abs(Number(typed.lon)) <= 180;
  const fmtKm = (km: number): string => (p.imperial ? `${(km * 0.621371).toFixed(2)} mi` : `${km.toFixed(2)} km`);
  const inForce = p.located ?? p.fileSite;
  return (
    <div className="locator">
      <div className="allRow">
        <input className="addr" value={q} placeholder="street, town, state" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
        <button className="qaBtn" disabled={busy || !q.trim()} onClick={() => void search()}>Locate</button>
        <label title="Open in Google Maps opens the satellite view in your browser — its imagery shows the house itself"><input type="checkbox" checked={p.satellite} onChange={(e) => p.onSatellite(e.target.checked)} /> satellite (Google Maps)</label>
      </div>
      <div className="idfInfo">
        the file states: address <span className="src-file">{p.fileAddress ?? "none"}</span> · position <span className="src-file">{p.fileSite ? `lat ${p.fileSite.latitude.toFixed(5)} · lon ${p.fileSite.longitude.toFixed(5)} · elev ${p.fileSite.elevationM.toFixed(1)} m` : "none"}</span>
        {p.located && (
          <> · located: <span className="src-user">lat {p.located.latitude.toFixed(5)} · lon {p.located.longitude.toFixed(5)}{p.located.label ? ` — ${p.located.label}` : ""}</span>
            {p.fileSite ? ` · ${fmtKm(distanceKm(p.fileSite, p.located))} from the file's position` : ""}
            {" "}<button className="qaBtn" onClick={p.onClear}>back to the file's</button></>
        )}
        {!p.located && inForce && <> · the map shows the file's position; a candidate picked below is staged — Apply in the column makes it the ruling</>}
      </div>
      {note && <div className="idfInfo">{note}</div>}
      <div className="allRow" title="a position read from a survey, a deed or Google Maps itself (right-click a point there → the coordinates)">
        <span className="idfInfo">or type it:</span>
        <input className="num" value={typed.lat} placeholder="latitude" onChange={(e) => setTyped((t) => ({ ...t, lat: e.target.value }))} />
        <input className="num" value={typed.lon} placeholder="longitude" onChange={(e) => setTyped((t) => ({ ...t, lon: e.target.value }))} />
        <button className="qaBtn" disabled={!typedOk} onClick={() => p.onLocate({ latitude: Number(typed.lat), longitude: Number(typed.lon), label: "typed" })}>stage</button>
      </div>
      {results.length > 0 && (
        <table className="spaceTable">
          <thead><tr><th>candidate (OpenStreetMap)</th><th>kind</th><th className="num">lat</th><th className="num">lon</th><th className="num">from the file's</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} onClick={() => p.onLocate({ latitude: r.latitude, longitude: r.longitude, label: r.name })} title="stage this position">
                <td className="wrap">{r.name}</td><td>{r.kind}</td><td className="num">{r.latitude.toFixed(5)}</td><td className="num">{r.longitude.toFixed(5)}</td>
                <td className="num">{p.fileSite ? fmtKm(distanceKm(p.fileSite, r)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** the ASHRAE zone code a station's listing states: "4A - Mixed - Humid" → "4A" */
export const zoneCode = (s: string): string => (s.split(" - ")[0] ?? s).trim();

/** THE STATIONS ON THE MAP (user, 2026-09-07: "zooming or scrolling should update
 *  locations on map"): the site and every station IN THE VIEW; the one in force lit,
 *  installed ones ringed, the project's zone (by county) marked; the map reports its
 *  bounds after every pan or zoom and the parent re-reads what is in them */
export function WeatherStationsMap(p: {
  site: { latitude: number; longitude: number } | null;
  stations: NearStation[];
  inForceWmo: string | null;
  installed: ReadonlySet<string>;
  /** HUMIDITY MEASURED, read from the installed files' own .ddy (a valid summer design day with a wet-bulb); unknown for a file not on disk */
  humidity: ReadonlyMap<string, boolean>;
  projectZone: string | null;
  focus: NearStation | null;
  imperial: boolean;
  onMarker: (id: string) => void;
  onView: (b: MapBounds) => void;
}): React.ReactElement {
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = p.stations.map((s) => {
      const hum = p.humidity.get(s.wmo);
      return { id: stationId(s), latitude: s.latitude, longitude: s.longitude, kind: "station", on: s.wmo === p.inForceWmo, installed: p.installed.has(s.wmo), sameZone: !!p.projectZone && zoneCode(s.climateZone) === p.projectZone, noHumidity: hum === false,
        label: `${s.name.replace(/\./g, " ")} · ${zoneCode(s.climateZone)} · ${fmtDist(s.km, p.imperial, 0)}${hum === true ? " · humidity measured" : hum === false ? " · no measured humidity (its .ddy has no valid summer day)" : ""}` };
    });
    if (p.site) m.push({ id: "site", latitude: p.site.latitude, longitude: p.site.longitude, label: `the site${p.projectZone ? ` · zone ${p.projectZone} by county` : ""}`, kind: "site" });
    return m;
  }, [p.stations, p.site, p.inForceWmo, p.installed, p.projectZone, p.humidity, p.imperial]);
  const center = p.focus ?? p.site ?? { latitude: 38, longitude: -77 };
  const key = p.focus ? `s:${stationId(p.focus)}` : `site:${p.site?.latitude ?? 0},${p.site?.longitude ?? 0}`;
  return (
    <div className="paneMap">
      <TileMap center={center} zoom={p.focus ? 10 : 8} viewKey={key} markers={markers} onMarker={(m) => { if (m.kind === "station") p.onMarker(m.id); }} onView={p.onView} />
      <div className="mapLegend" title="what the colours say — the zone is the listing's word per file (ASHRAE HOF 2025); humidity is read from the installed files' own .ddy, so a file not on disk has no humidity mark">
        <b>stations</b>
        <span><i className="sw same" /> the project's zone{p.projectZone ? ` (${p.projectZone}, by county)` : ""}</span>
        <span><i className="sw other" /> another zone</span>
        <span><i className="sw on" /> in force</span>
        <span><i className="sw installed" /> installed in the engine's WeatherData</span>
        <span><i className="sw nohum" /> no measured humidity (its .ddy has no valid summer design day)</span>
        <span><i className="sw site" /> the site</span>
      </div>
    </div>
  );
}

/** the stations inside the map's bounds, nearest the site first, capped so the DOM stays light */
export function stationsInView(all: NearStation[], b: MapBounds | null, cap = 400): NearStation[] {
  const inside = b ? all.filter((s) => s.latitude >= b.minLat && s.latitude <= b.maxLat && s.longitude >= b.minLon && s.longitude <= b.maxLon) : all;
  return inside.sort((a, c) => a.km - c.km).slice(0, cap);
}

/** THE LIST under the map: the stations in the map's view, nearest first, with every period the listing serves; a file is used by downloading it once */
export function StationList(p: {
  stations: NearStation[];
  /** the project's zone by county, and the switch that keeps only its stations */
  projectZone: string | null;
  onlySameZone: boolean;
  onOnlySameZone: (on: boolean) => void;
  zoom: number | null;
  listingWord: string;
  onRefresh: () => void;
  inForcePath: string | null;
  installedPaths: string[];
  focus: NearStation | null;
  onFocus: (s: NearStation | null) => void;
  onUse: (file: StationFile, station: NearStation) => void;
  busy: boolean;
  imperial: boolean;
  humidity: ReadonlyMap<string, boolean>;
}): React.ReactElement {
  const fmtKm = (km: number): string => fmtDist(km, p.imperial, 1);
  const inForceStem = p.inForcePath ? baseName(p.inForcePath).replace(/\.epw$/i, "") : "";
  const installedStems = new Set(p.installedPaths.map((x) => baseName(x).replace(/\.epw$/i, "")));
  return (
    <div className="stationList">
      <div className="allRow">
        <span className="idfInfo">{p.listingWord}</span>
        <button className="qaBtn" onClick={p.onRefresh} disabled={p.busy} title="fetch EnergyPlus's weather listing again">refresh listing</button>
        <span className="idfInfo">{p.stations.length} stations in the map's view{p.zoom !== null ? ` (zoom ${p.zoom})` : ""} — pan or zoom the map to read others</span>
        <label title="the project's climate zone is read by county (the SITE column); keep only the stations the listing puts in the same ASHRAE zone">
          <input type="checkbox" checked={p.onlySameZone} disabled={!p.projectZone} onChange={(e) => p.onOnlySameZone(e.target.checked)} /> only the project's zone{p.projectZone ? ` (${p.projectZone})` : " (not identified)"}
        </label>
      </div>
      <table className="spaceTable stationTable">
        <thead><tr><th className="num">from the site</th><th>station</th><th>state</th><th>ASHRAE zone{p.projectZone ? ` (project ${p.projectZone})` : ""}</th><th className="num" title={p.imperial ? "heating degree-days, base 65 °F (the listing's HDD18 on the °F scale)" : "heating degree-days, base 18 °C"}>{p.imperial ? "HDD65" : "HDD18"}</th><th className="num" title={p.imperial ? "cooling degree-days, base 50 °F (the listing's CDD10 on the °F scale)" : "cooling degree-days, base 10 °C"}>{p.imperial ? "CDD50" : "CDD10"}</th><th className="num">elev {p.imperial ? "ft" : "m"}</th><th>humidity</th><th>files — click <b>use</b> on a period</th></tr></thead>
        <tbody>
          {p.stations.map((s) => (
            <tr key={stationId(s)} className={p.focus && stationId(p.focus) === stationId(s) ? "sel" : ""} onClick={() => p.onFocus(p.focus && stationId(p.focus) === stationId(s) ? null : s)} title="click: centre the map on this station">
              <td className="num">{fmtKm(s.km)}</td>
              <td className="wrap">{s.name.replace(/\./g, " ")} <span className="muted">WMO {s.wmo}</span></td>
              <td>{s.state}</td><td className={p.projectZone && zoneCode(s.climateZone) === p.projectZone ? "same" : ""}>{zoneCode(s.climateZone)}{p.projectZone && zoneCode(s.climateZone) === p.projectZone ? " ✓" : ""}</td>
              <td className="num">{s.hdd18 !== null ? fmtDegDays(s.hdd18, p.imperial) : "—"}</td><td className="num">{s.cdd10 !== null ? fmtDegDays(s.cdd10, p.imperial) : "—"}</td><td className="num">{p.imperial ? (s.elevationM / 0.3048).toFixed(0) : s.elevationM.toFixed(0)}</td>
              <td className={p.humidity.get(s.wmo) === false ? "bad" : ""}>{p.humidity.get(s.wmo) === true ? "measured" : p.humidity.get(s.wmo) === false ? "none" : "—"}</td>
              <td>
                {s.files.map((f) => {
                  const on = f.stem === inForceStem, have = installedStems.has(f.stem);
                  return (
                    <button key={f.stem} className={`qaBtn per${on ? " on" : ""}`} disabled={p.busy || on} title={`${f.stem}\n${f.source}${on ? "\nthe weather file in force" : have ? "\ninstalled — click to use it, no download" : "\nclick to download it once into data/weather/ and use it"}`}
                      onClick={(e) => { e.stopPropagation(); p.onUse(f, s); }}>{on ? `${f.period} · in force` : `use ${f.period}${have ? " ✓" : ""}`}</button>
                  );
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** THE SITE FRAME (user, 2026-09-16: "the view frame should show linked files with checkboxes to their left for display
 *  (default checked on, but can be unchecked to turn off). Right clicking on item (for example PV panels) allows you adjust the
 *  file rotation by set amount CW or CCW … The other material in the Site tab view frame should be cleared"): one row per IFC
 *  beside the house with a DISPLAY checkbox — view state, never a ruling; off takes the file's terrain and elements out of the
 *  view — and, under a projected file, its kinds of shading element with a checkbox each (the hide set); a click on a kind lights
 *  it in the view; a right-click on a file or a kind opens the app's menu: project it or leave it out, hide, delete from the
 *  model, and TURN THE FILE by a typed amount clockwise or counter-clockwise (the ledger's per-file turn, C1 of 2026-09-15).
 *  What the frame carried before (kind, size, what it holds, class, triangles, the Σ row) is cleared. */
export function SiteFilesFrame(p: {
  files: SiteFileRow[]; siteName: string; rows: SiteTypeRow[]; hiddenFiles: ReadonlySet<string>; selected: ReadonlySet<number>; busy: boolean;
  onShowFile: (name: string, on: boolean) => void;
  onShowKind: (ids: number[], on: boolean) => void;
  onSelect: (ids: number[] | null) => void;
  onRestore: (expressId: number) => void;
  onRestoreAll: (expressIds: number[]) => void;
  onMenu: (m: { x: number; y: number; file: string; projected: boolean; kind?: SiteTypeRow }) => void;
}): React.ReactElement {
  const turnWord = (deg: number): string => (deg ? ` · turned ${Math.abs(deg)}° ${deg > 0 ? "CW" : "CCW"}` : "");
  // the kinds DELETED from the model (every element of them) fold behind one line per file, so the frame stays the live list
  const [openDeleted, setOpenDeleted] = useState<Set<string>>(new Set());
  const toggleDeleted = (name: string): void => setOpenDeleted((o) => { const n = new Set(o); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  return (
    <table className="spaceTable typeTable siteFrame">
      <tbody>
        {p.files.map((f) => {
          const fileHidden = p.hiddenFiles.has(f.name);
          const all = p.rows.filter((r) => (r.file || p.siteName) === f.name);
          const gone = all.filter((r) => r.ids.length === 0 && r.deleted.length > 0);
          const kinds = openDeleted.has(f.name) ? all : all.filter((r) => r.ids.length > 0);
          const goneN = gone.reduce((t, r) => t + r.deleted.length, 0);
          return (
            <Fragment key={f.name}>
              <tr className="file" onContextMenu={(e) => { e.preventDefault(); p.onMenu({ x: e.clientX, y: e.clientY, file: f.name, projected: f.projected }); }}
                title={f.projected ? "the checkbox shows or hides this file in the view · right-click: leave it out of the model, or turn it by degrees" : "not projected — right-click to read it into the model"}>
                <td><input type="checkbox" checked={f.projected && !fileHidden} disabled={p.busy || !f.projected} onChange={(e) => p.onShowFile(f.name, e.target.checked)} title={f.projected ? (fileHidden ? "show this file in the view" : "hide this file in the view (it stays in the model)") : "not projected"} /></td>
                <td className="wrap" colSpan={2}><b>{f.name}</b> <span className="muted">· {f.kind === "site" ? "site" : f.kind === "shade" ? "shade" : "—"}{f.projected ? ` · ${f.elements} element${f.elements === 1 ? "" : "s"}${f.terrainTris ? " · terrain" : ""}${turnWord(f.turnDeg ?? 0)}` : " · not projected — right-click to project it"}</span></td>
              </tr>
              {f.projected && kinds.map((r) => {
                const nSel = r.ids.filter((id) => p.selected.has(id)).length;
                const shown = r.ids.length > 0 && r.hidden < r.ids.length;
                return (
                  <tr key={`${r.file}|${r.name}`} className={`kind${nSel > 0 ? " sel" : ""}`} onClick={() => { if (r.ids.length) p.onSelect(nSel === r.ids.length ? null : r.ids); }}
                    onContextMenu={(e) => { e.preventDefault(); p.onMenu({ x: e.clientX, y: e.clientY, file: f.name, projected: true, kind: r }); }}
                    title="click: light every element of this kind in the view · the checkbox shows or hides them · right-click: hide or delete them from the model, or turn the file by degrees">
                    <td><input type="checkbox" checked={shown} disabled={p.busy || fileHidden || r.ids.length === 0} onClick={(e) => e.stopPropagation()} onChange={(e) => p.onShowKind(r.ids, e.target.checked)} /></td>
                    <td className="wrap" colSpan={2}>{r.ids.length} × {r.name}{nSel > 0 && nSel < r.ids.length ? <span className="muted"> · {nSel} selected</span> : null}
                      {r.deleted.length > 0 && <span className="muted"> · {r.deleted.length} deleted from the model <button className="qaBtn" onClick={(e) => { e.stopPropagation(); p.onRestoreAll(r.deleted.map((d) => d.expressId)); }} title="put every deleted element of this kind back — one rebuild">restore all</button>{r.deleted.length <= 6 && r.deleted.map((d) => <button key={d.expressId} className="qaBtn" onClick={(e) => { e.stopPropagation(); p.onRestore(d.expressId); }} title={`restore #${d.expressId % 100_000_000}`}>#{d.expressId % 100_000_000}</button>)}</span>}
                    </td>
                  </tr>
                );
              })}
              {f.projected && gone.length > 0 && (
                <tr className="kind sub" onClick={() => toggleDeleted(f.name)} title="the kinds every element of which was deleted from the model — click to list them, each with restore">
                  <td /><td className="wrap muted" colSpan={2}>{openDeleted.has(f.name) ? "▾" : "▸"} {gone.length} kind{gone.length === 1 ? "" : "s"} deleted from the model ({goneN} element{goneN === 1 ? "" : "s"}){openDeleted.has(f.name) ? " — listed above with restore" : " — click to list them"}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {p.files.length === 0 && <tr><td colSpan={3} className="muted">no other IFC beside the opened file</td></tr>}
      </tbody>
    </table>
  );
}

/** THE FILE'S TURN, from the menu (user, 2026-09-16: "adjust the file rotation by set amount CW or CCW (for example 6.2 degrees
 *  CW)"): a typed amount, CW or CCW, added to the file's cumulative extra turn (degrees clockwise seen from above, on top of its
 *  TrueNorth turn — the ledger's siteFileTurn; the file is read again); the amount is remembered; reset puts the turn back to 0 */
export function TurnMenu(p: { file: string; turnDeg: number; disabled: boolean; onTurn: (deg: number) => void }): React.ReactElement {
  const [step, setStep] = useState(() => window.localStorage.getItem("bim-turn-step") ?? "1");
  const v = Number(step), ok = Number.isFinite(v) && v > 0;
  const go = (sign: 1 | -1): void => { if (!ok) return; window.localStorage.setItem("bim-turn-step", step); p.onTurn(Math.round((p.turnDeg + sign * v) * 1000) / 1000); };
  return (
    <div className="ctxTurn">
      <div className="ctxDim">turn {p.file} · now {p.turnDeg ? `${Math.abs(p.turnDeg)}° ${p.turnDeg > 0 ? "CW" : "CCW"}` : "no extra turn"} on its own TrueNorth</div>
      <div className="ctxTurnRow">
        <span>by</span>
        <input type="number" step="0.05" min="0" value={step} disabled={p.disabled} onChange={(e) => setStep(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(1); }} title="degrees; Enter turns clockwise" />
        <span>°</span>
        <button disabled={!ok || p.disabled} onClick={() => go(1)} title="clockwise seen from above">CW</button>
        <button disabled={!ok || p.disabled} onClick={() => go(-1)} title="counter-clockwise seen from above">CCW</button>
        {p.turnDeg !== 0 && <button disabled={p.disabled} onClick={() => p.onTurn(0)} title="back to the file's own TrueNorth turn alone">reset</button>}
      </div>
    </div>
  );
}
