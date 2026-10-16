// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BENCH under the assembly. Vertical headers on the left — ZONE EQUIPMENT ·
// AIR LOOP · COILS · PLANT LOOP · RESOURCE · CONTROLS, the engine's own
// organisation (by loop and by side, not by function) — one open at a time, its
// components on the shelf beside it.
//
// THE CARDS ARE ENERGYPLUS COMPONENTS (user, 2026-09-11). The shelf is the
// catalogue read from the engine's schema (epCatalogue.ts), and two tiers sit on
// it together, because the engine takes both in one file: a TEMPLATE is one
// object the engine expands into many, a COMPONENT is one object wired here.
// The user's own grammar says which is which at a glance:
//
//     ideal loads   a full solid border      the fallback every zone has
//     template      left and bottom borders  one object, expanded
//     component     the left border only     one object, wired here
//
// and the header carries the two toggles that show them, either or both.

import { useEffect, useState } from "react";
import { type PaletteGroup, type PaletteItem, PALETTE, PALETTE_GROUPS } from "../core/assembly.js";
import { type Catalogue, type Tier } from "../core/epCatalogue.js";
import { startPaletteDrag } from "./assemblyDrag.js";
import { GROUP_COLOR } from "./SystemsAssembly.js";

const TIERS: Array<{ t: Tier; label: string; title: string }> = [
  { t: "template", label: "Template", title: "one object the engine expands into many — fast and complete, but nothing can be wired into it" },
  { t: "component", label: "Custom", title: "one EnergyPlus object each, wired here — what a ground loop or a variable-speed heat pump needs" },
];
const read = (k: string, dflt: boolean): boolean => { const v = window.localStorage.getItem(k); return v === null ? dflt : v === "1"; };

/** `shelves` / `title` (2026-10-02): the ELECTRICAL sheet's bench is this one over its own catalogue — its shelves, no tiers, no attachments */
export function AssemblyBench(p: { catalogue: Catalogue | null; shelves?: string[]; title?: string }): React.ReactElement {
  const shelves = p.shelves ?? PALETTE_GROUPS, store = p.shelves ? `bim-asm-group-${(p.title ?? "elec").split(" · ").pop()!.toLowerCase()}` : "bim-asm-group";   // a store per discipline (2026-10-02: PLUMBING read ELECTRICAL's shelf)
  const [group, setGroup] = useState<PaletteGroup>(() => { const g = window.localStorage.getItem(store) as PaletteGroup | null; return g && shelves.includes(g) ? g : shelves[0] as PaletteGroup; });
  const [template, setTemplate] = useState(() => read("bim-asm-template", true));
  const [custom, setCustom] = useState(() => read("bim-asm-custom", true));
  useEffect(() => { window.localStorage.setItem(store, group); }, [group, store]);
  useEffect(() => { window.localStorage.setItem("bim-asm-template", template ? "1" : "0"); }, [template]);
  useEffect(() => { window.localStorage.setItem("bim-asm-custom", custom ? "1" : "0"); }, [custom]);

  // ideal loads rides with the templates, and is always its shelf's first item (the user's ruling)
  const tiers: Tier[] = p.shelves ? ["component"] : [...(template ? (["ideal", "template"] as Tier[]) : []), ...(custom ? (["component"] as Tier[]) : [])];
  const fromCat: PaletteItem[] = (p.catalogue ? p.catalogue.byShelf(group, tiers) : []).map((e) => ({
    id: e.cls, group: e.shelf as PaletteGroup, label: e.label, sub: `${e.cls} — ${e.sub}`, node: "component" as const, cls: e.cls, tier: e.tier,
  }));
  const order: Record<Tier, number> = { ideal: 0, template: 1, component: 2 };
  fromCat.sort((a, b) => (order[a.tier ?? "component"] - order[b.tier ?? "component"]) || a.label.localeCompare(b.label));
  // the attachments (coils and the availability schedule dropped ONTO a card) have no class of their own; they stay as they were
  const attachments = PALETTE.filter((it) => it.group === group && it.attach);
  // THE ZONE CARD (user, 2026-10-16: "they are not offered in the frame below the mechanical systems view, so how can they be
  // assembled?"): not an engine component, so the catalogue has none — the sheet's own Zone, on ZONE EQUIPMENT whatever tiers are shown,
  // right after Ideal loads (the shelf's first item, the user's ruling)
  const zoneTile = !p.shelves && group === "ZONE EQUIPMENT" ? PALETTE.filter((it) => it.node === "zone") : [];
  const nIdeal = fromCat.filter((it) => it.tier === "ideal").length;
  const items = [...fromCat.slice(0, nIdeal), ...zoneTile, ...fromCat.slice(nIdeal), ...(custom && !p.shelves ? attachments : [])];

  return (
    <div className="asmBench">
      <div className="asmRail">
        {shelves.map((g) => (
          <button key={g} className={`asmRailBtn${group === g ? " on" : ""}`} style={{ borderLeftColor: GROUP_COLOR[g] ?? "#d4a017" }} onClick={() => setGroup(g as PaletteGroup)}>{g}</button>
        ))}
      </div>
      <div className="asmShelf">
        <div className="asmShelfHead">
          <b>{p.title ?? "SYSTEMS · MECHANICAL"}</b>
          {!p.shelves && <span className="asmTierBtns">
            {TIERS.map((x) => (
              <button key={x.t} className={`asmTierBtn${(x.t === "template" ? template : custom) ? " on" : ""}`} title={x.title}
                onClick={() => (x.t === "template" ? setTemplate(!template) : setCustom(!custom))}>{x.label}</button>
            ))}
          </span>}
          <span className="muted">{items.length} component{items.length === 1 ? "" : "s"}{!p.catalogue ? " · the schema is not read" : ""}</span>
        </div>
        <div className="asmTiles">
          {items.map((it) => (
            <div key={it.id} className={`asmTile tier-${it.attach ? "attach" : it.node === "zone" ? "zone" : it.tier ?? "component"}`} style={{ borderColor: GROUP_COLOR[it.group] ?? "#d4a017" }}
              onPointerDown={(e) => startPaletteDrag({ item: it }, it.label, e)} title={it.sub}>
              <div className="asmTileLabel">{it.label}</div>
            </div>
          ))}
          {!items.length && <div className="muted" style={{ padding: "8px 4px" }}>nothing on this shelf for the tiers shown — try the other button</div>}
        </div>
      </div>
    </div>
  );
}
