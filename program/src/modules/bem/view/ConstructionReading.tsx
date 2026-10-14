// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PLAN READING (user, 2026-09-16: "the Plan should show in the frame below
// the view the item selected — roof, wall, etc. — and the Code default (we need
// to set the code used in the Site tab), the IFC description and the IDF
// description with U values"). For the selected type, three columns side by
// side — CODE · IFC · IDF — each with its name, its layers and its nominal U
// (and SHGC where it applies), and what governs as a button on the column, lit
// in the source's colour. This frame READS; the assembly is edited in DETAIL,
// whose Apply writes it to the column. Nothing here derives a number: the code
// column is the model's code default, the IFC column the file's own layers and
// stated U (Revit's conductance, no films), the IDF column the construction as
// written or as staged.
import type { TypeRow } from "../constructionTypes.js";
import { withLayers, type ConstructionRuling } from "../core/bemDb.js";
import { ruledStack } from "../core/bemModel.js";
import type { ResolvedConstruction } from "../core/bemIdf.js";
import { srcClass } from "./bemUi.js";

const U_IP = 5.678263;
const fU = (u: number | null | undefined, imperial: boolean): string => (u === null || u === undefined ? "—" : imperial ? (u / U_IP).toFixed(3) : u.toFixed(3));
const fTh = (m: number, imperial: boolean): string => (imperial ? `${(m * 39.3701).toFixed(2)}″` : `${(m * 1000).toFixed(0)} mm`);

export function ConstructionReading(p: {
  row: TypeRow; imperial: boolean;
  /** "2018 IECC (IRC ch. 11) · climate zone 4A by county" — the model's energy_code setting */
  codeLabel: string;
  /** the code default the type's cells carry: its construction's name, layer names and U */
  code: { name: string; layers: string[]; uWm2k: number | null; /** the other code kinds on some of the cells (a wall type with exterior and partition cells) */ others?: string[] } | null;
  /** the code's fenestration SHGC for a glazed type */
  codeShgc: number | null;
  applied: ConstructionRuling | undefined;
  stage: ConstructionRuling | undefined;
  /** the applied ruled construction as written (null while the code default governs) */
  resolved: ResolvedConstruction | null;
  stagedSummary: string | null;
  onStage: (key: string, r: ConstructionRuling | undefined) => void;
  /** to the DETAIL view, the assembly promoted from the file's layers when the code or the file governs */
  onDetail: () => void;
}): React.ReactElement {
  const r = p.row, st = p.stage, gov = st?.source ?? "code";
  const glazed = r.kind === "window" || (r.kind === "door" && r.glazed === true);
  const fileLayers = r.layers.filter((l) => !l.part);
  const idfGov = gov !== "code" && gov !== "file";
  const uUnit = p.imperial ? "Btu/h·ft²·°F" : "W/m²K";
  const toAssembly = (): void => {
    if (!idfGov && fileLayers.length) p.onStage(r.key, withLayers(st, ruledStack(fileLayers, undefined).map((x) => x.pick)));
    p.onDetail();
  };
  return (
    <>
      <div className="readTitle">{r.section} · {r.label} · {r.elements.length} element{r.elements.length === 1 ? "" : "s"} · U in {uUnit} · the lit column governs; the assembly is edited in DETAIL</div>
      <div className="readGrid">
        <div className={`readCol src-code${gov === "code" ? " sel" : ""}`}>
          <div className="readHead">CODE <span className="muted">· {p.codeLabel}</span></div>
          <div className="readName">{p.code?.name ?? "no code construction for this kind"}</div>
          <div className="readLayers">{p.code?.layers.join(" · ") ?? "—"}</div>
          <div className="readU">{p.code?.uWm2k !== null && p.code?.uWm2k !== undefined ? `U ${fU(p.code.uWm2k, p.imperial)}` : "no code U"}{glazed && p.codeShgc !== null ? ` · SHGC ${p.codeShgc.toFixed(2)}` : ""} <span className="muted">· the code's nominal assembly U, with films</span></div>
          {p.code?.others?.length ? <div className="muted">also, on some cells: {p.code.others.join(" · ")}</div> : null}
          <button className={`qaBtn${gov === "code" ? " on" : ""}`} onClick={() => p.onStage(r.key, st?.name ? { source: "code", name: st.name } : undefined)} title="the code default governs: its construction is written for this type's cells">{gov === "code" ? "governs" : "let the code govern"}</button>
        </div>
        <div className={`readCol src-file${gov === "file" ? " sel" : ""}`}>
          <div className="readHead">IFC <span className="muted">· the file's word</span></div>
          <div className="readName">{r.label}</div>
          <div className="readLayers">{fileLayers.length ? fileLayers.map((l) => `${l.material}${l.thicknessM ? ` ${fTh(l.thicknessM, p.imperial)}` : ""}`).join(" · ") : glazed ? `${r.layers.filter((l) => l.part).map((l) => `${l.part}: ${l.material}`).join(" · ") || "the file names no parts"}` : "the file names no layers"}</div>
        </div>
        <div className={`readCol ${idfGov ? srcClass(p.resolved?.source ?? "user") : "src-code"}${idfGov ? " sel" : ""}`}>
          <div className="readHead">IDF <span className="muted">· {p.stagedSummary ? "as staged" : "as written"}</span></div>
          <div className="readName">{st?.name ?? p.resolved?.name ?? (idfGov ? p.resolved?.label ?? "the assembly" : `${p.code?.name ?? "the code default"} · shared code default`)}</div>
          <div className="readLayers">{p.resolved && idfGov ? p.resolved.layers.join(" · ") : gov === "sameAs" ? `same as ${st?.sameAs ?? "?"}` : idfGov ? "not applied yet — Apply assembly in DETAIL" : "not ruled: the code default's construction is written"}</div>
          <div className="readU">{p.resolved && idfGov ? <>U {fU(p.resolved.uWm2k, p.imperial)}{p.resolved.shgc !== undefined ? ` · SHGC ${p.resolved.shgc.toFixed(2)}` : ""}{p.resolved.vt !== undefined ? ` · VT ${p.resolved.vt.toFixed(2)}` : ""}{p.resolved.dropped?.length ? <span className="muted"> · left out: {p.resolved.dropped.join("; ")}</span> : null}</> : "—"}</div>
          {p.stagedSummary && <div className="staged">staged: {p.stagedSummary} — Apply assembly in DETAIL</div>}
          <button className={`qaBtn${idfGov ? " on" : ""}`} onClick={toAssembly} title={idfGov ? "the assembly governs — open DETAIL to edit it" : "promote the file's layers to an assembly and open DETAIL to pick its materials"}>{idfGov ? "governs · edit in DETAIL" : "edit the assembly in DETAIL"}</button>
        </div>
      </div>
    </>
  );
}
