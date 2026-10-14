// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * WHAT THE MODEL LEAVES OUT OF THE ENVELOPE, IN RED (user, 2026-10-01: "ALL EXTERIOR DOORS MUST BE INCLUDED ... NO
 * EXCEPTION, AND THIS IS A CASE WHERE THIS PROCESS HAS FAILED TO BE TRUTHFUL"). Eight exterior doors had been dropped
 * with nothing but a muted footnote to say so. Every exterior opening the model does not carry in full, and every
 * exterior-facing surface no zone claims, is listed here at the head of CONSTRUCTIONS and RUN — by name, area and the
 * writer's own reason — until it is in the model. Interior walls and doors are not listed: EnergyPlus does not need
 * them (the user's word, the same day); idf.db keeps them for airflow.
 */
import type { IdfWriteReport } from "../core/bemIdf.js";
import { fmtArea } from "./bemUi.js";

const label = (name: string): string => { const t = name.split(":"); return t.length >= 2 ? `${t[0]!.replace(/^(Door|Window)-/, "")}: ${t[1]}` : name; };

export function EnvelopeLosses(p: { report: IdfWriteReport | null | undefined; imperial: boolean }): React.ReactElement | null {
  const r = p.report;
  if (!r) return null;
  const lost = r.openingAccounts.map((a) => ({ a, m2: a.losses.reduce((t, l) => t + l.m2, 0) })).filter((x) => x.m2 > 0.005);
  const ext = Object.entries(r.unclaimed.exteriorByCategory).filter(([, a]) => a > 0.05);
  if (!lost.length && !ext.length) return null;
  const doors = lost.filter((x) => x.a.op.kind !== "window");
  const word = (c: string): string => (c === "exteriorWall" ? "exterior wall" : c === "floor" ? "external floor" : c);
  return (
    <div className="envLoss" title="the energy model does not carry these — the writer's own reasons; each is to be brought into the model, none is accepted">
      <div className="envLossHead">NOT IN THE ENERGY MODEL</div>
      {lost.length > 0 && (
        <div>
          {lost.length} exterior opening{lost.length === 1 ? "" : "s"}{doors.length ? ` (${doors.length} door${doors.length === 1 ? "" : "s"})` : ""} not carried in full · {fmtArea(lost.reduce((t, x) => t + x.m2, 0), p.imperial)}
          <ul>
            {lost.map(({ a, m2 }) => (
              <li key={a.op.elementId} title={a.losses.map((l) => `${fmtArea(l.m2, p.imperial)} — ${l.reason}`).join("\n")}>
                {a.op.kind === "window" ? "window" : a.op.glazed ? "glass door" : "door"} {label(a.op.name)} — {fmtArea(m2, p.imperial)} of {fmtArea(a.placedM2, p.imperial)}: {a.losses[0]!.reason}{a.losses.length > 1 ? ` (+${a.losses.length - 1})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ext.length > 0 && (
        <div title="cells of the envelope that no room or void claims — not written; whether each is outside the building (an eave, a parapet) or envelope the model is missing is still to be traced">
          exterior-facing surfaces no zone claims: {ext.map(([c, a]) => `${word(c)} ${fmtArea(a, p.imperial)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}
