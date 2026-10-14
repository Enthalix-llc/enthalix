// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE WINDOW SCHEDULE'S REFERENCE (user, 2026-10-01: "the reference dropdown should show window basis options (e.g., Marvin
 * Essential) with ability to search for value (either already used or in a file location)"). One control per Window row:
 * what governs the type, and a searchable list — the code default, the products this project already uses (a pick
 * there is the same row again, never an alias), and every row of the fenestration datasets (the manufacturers' NFRC
 * ratings, the engine's window constructions, your own). A pick stages the ruling the DETAIL frame stages: a dataset
 * construction → a library ruling, its objects verbatim; a rating → a U ruling carrying the product.
 * THE GLASS DOOR TOO (user, 2026-10-01: "Same approach is needed for glass doors"): a glazed Door row takes the same
 * control over the datasets' door rows; a solid door keeps the opaque section's governs select.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConstructionRuling } from "../core/bemDb.js";
import type { GlazingProduct } from "../core/materialsDb.js";
import { srcClass } from "./bemUi.js";

const U_IP = 5.678263;

/** what a ruling reads as, following an older alias to the ruling it names (the alias select is gone from windows) */
export function fenRefOf(st: ConstructionRuling | undefined, stage: Record<string, ConstructionRuling>): { label: string; cls: string; via: string | null } {
  let r = st, via: string | null = null;
  for (let i = 0; r?.source === "sameAs" && r.sameAs && i < 8; i++) { via = r.sameAs; r = stage[r.sameAs]; }
  if (!r || r.source === "code" || r.source === "sameAs") return { label: "code default", cls: "code-default", via };
  if (r.source === "u") return { label: r.product?.name ?? "a typed U · SHGC · VT (DETAIL)", cls: r.product && r.product.source !== "hand" ? "dataset" : "user", via };
  if (r.source === "library") return { label: r.library?.name ?? "a dataset construction", cls: "dataset", via };
  return { label: r.source === "layers" ? "the assembly (DETAIL)" : r.source, cls: "user", via };
}

/** the ruling a fenestration row stages — the DETAIL frame's rule, one place */
export function rulingForProduct(g: GlazingProduct, keepName?: string): ConstructionRuling {
  const name = keepName ? { name: keepName } : {};
  if (g.rowKind === "construction" && g.libFile && g.libName) return { source: "library", library: { file: g.libFile, name: g.libName }, ...name };
  return { source: "u", uWm2k: g.uWm2k, shgc: g.shgc, vt: g.vt ?? undefined, product: { key: g.key, name: g.name, source: g.sourceId }, ...name };
}

const badge = (g: GlazingProduct): string => (g.cpd ? `NFRC · ${g.cpd}` : g.sourceId === "epwin" ? "EnergyPlus" : g.sourceId === "hand" ? "yours" : g.sourceId);

export function FenReference(p: {
  rowKey: string; st: ConstructionRuling | undefined; stage: Record<string, ConstructionRuling>;
  /** the rows of the fenestration datasets for this section (window, or glazed door); null until materials.db is read */
  products: GlazingProduct[] | null; imperial: boolean;
  /** which schedule the row is in — the words of the list; window when not said */
  section?: "window" | "door";
  /** the row keys whose references count as "already used" here — this section's glazed types; every ruled type when not said */
  peers?: ReadonlySet<string>;
  onStage: (r: ConstructionRuling | undefined) => void;
  /** a fenestration row of your own: the New dialog (the DETAIL frame's), this type takes it */
  onNew?: () => void;
}): React.ReactElement {
  const [open, setOpenRaw] = useState<{ x: number; y: number; w: number; up: boolean } | null>(null);
  // closing the list clears its search, so the next opening shows every reference (2026-10-01)
  const setOpen = (v: typeof open): void => { setOpenRaw(v); if (!v) setQ(""); };
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(null); };
    // the list is placed where the button stood; a scroll of the column under it closes it rather than leave it adrift
    const scroll = (e: Event): void => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key); document.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); document.removeEventListener("scroll", scroll, true); };
  }, [open]);
  const cur = fenRefOf(p.st, p.stage);
  const keepName = p.st?.source !== "sameAs" ? p.st?.name : undefined;
  // the products this project already uses — by product key or dataset construction name — with how many types take each
  const used = useMemo(() => {
    const m = new Map<string, { g: GlazingProduct | null; ruling: ConstructionRuling; label: string; n: number }>();
    for (const [k, r] of Object.entries(p.stage)) {
      if (k === p.rowKey || (p.peers && !p.peers.has(k))) continue;
      const id = r.source === "u" && r.product ? `p:${r.product.key}` : r.source === "library" && r.library ? `l:${r.library.name}` : null;
      if (!id) continue;
      const g = p.products?.find((x) => (r.source === "u" ? x.key === r.product!.key : x.libName === r.library!.name)) ?? null;
      const e = m.get(id) ?? { g, ruling: r, label: r.source === "u" ? r.product!.name : r.library!.name, n: 0 };
      e.n++; m.set(id, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [p.stage, p.rowKey, p.products, p.peers]);
  const what = p.section === "door" ? "glazed door" : "window";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s: string): boolean => words.every((w) => s.toLowerCase().includes(w));
  const pool = (p.products ?? []).filter((g) => !words.length || hit(`${g.name} ${g.productType} ${g.cpd ?? ""} ${g.glassOption ?? ""} ${g.sourceId} ${g.coating ?? ""} ${g.gas ?? ""}`));
  const shown = pool.slice(0, 60);
  const uAt = (u: number): string => (p.imperial ? (u / U_IP).toFixed(3) : u.toFixed(3));
  const pick = (r: ConstructionRuling | undefined): void => { p.onStage(r); setOpen(null); setQ(""); };
  return (
    <div className="fenRef" ref={box} onClick={(e) => e.stopPropagation()}>
      <button className={`fenRefBtn ${srcClass(cur.cls)}`} onClick={() => { if (open) { setOpen(null); return; } const b = btn.current!.getBoundingClientRect(); const w = Math.min(480, window.innerWidth * 0.7); const up = window.innerHeight - b.bottom < 320 && b.top > window.innerHeight - b.bottom; setOpen({ x: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), y: up ? b.top - 2 : b.bottom + 2, w, up }); }}
        title={`${cur.label}${cur.via ? `\nan older "same as ${cur.via}" ruling — pick a product here to give this type its own reference` : ""}\nclick to choose or search the ${what} products`}
        ref={btn}>
        {cur.label}{cur.via ? " ↩" : ""} ▾
      </button>
      {open && (
        <div className="fenRefPop" style={open.up ? { left: open.x, bottom: window.innerHeight - open.y, width: open.w, maxHeight: open.y - 12 } : { left: open.x, top: open.y, width: open.w, maxHeight: window.innerHeight - open.y - 12 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={p.section === "door" ? "search the glazed door products: Essential, swinging, sliding, argon…" : "search the window products: Essential, casement, MAR-N-375, argon…"} />
          <div className="fenRefList">
            <div className="fenRefHead">governs</div>
            <button className="fenRefCode" onClick={() => pick(undefined)}>code default <span className="muted">— the energy code's fenestration row</span></button>
            {used.length > 0 && <div className="fenRefHead">already used in this project</div>}
            {used.filter((u) => !words.length || hit(u.label)).map((u) => (
              <button key={u.label} className={srcClass(u.ruling.source === "u" && u.ruling.product?.source === "hand" ? "user" : "dataset")}
                onClick={() => pick(u.g ? rulingForProduct(u.g, keepName) : { ...u.ruling, ...(keepName ? { name: keepName } : {}), combined: undefined, sameAs: undefined })}>
                {u.label} <span className="muted">· {u.n} type{u.n === 1 ? "" : "s"}{u.g ? ` · U ${uAt(u.g.uWm2k)} · SHGC ${u.g.shgc.toFixed(2)}` : ""}</span>
              </button>
            ))}
            {p.onNew && <button className="src-user" onClick={() => { setOpen(null); p.onNew!(); }} title="a reference of your own: its name, U, SHGC and VT (and where they come from) — this type takes it">Custom…</button>}
            <div className="fenRefHead">other {what} products · search {p.products === null ? "materials.db not read yet" : `${pool.length}${pool.length > shown.length ? `, ${shown.length} shown — type to narrow` : ""}`}</div>
            {shown.map((g) => (
              <button key={g.key} className={srcClass(g.sourceId === "hand" ? "user" : "dataset")} onClick={() => pick(rulingForProduct(g, keepName))}
                title={`${g.name}\n${g.sourceRef}${g.notes ? `\n${g.notes}` : ""}`}>
                {g.name} <span className="muted">· U {uAt(g.uWm2k)} · SHGC {g.shgc.toFixed(2)}{g.vt !== null ? ` · VT ${g.vt.toFixed(2)}` : ""} · {badge(g)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
