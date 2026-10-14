// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SCHEDULES (2026-09-09) — one row per ROLE: what the model runs on, read
// back from bem.db with its source, and a pick over the engine's OWN
// schedules whose type limits fit the role (a fraction for the gains, the
// leakage and the availability; a temperature for the setpoints), the code
// default first. Under the assignment, the LIBRARY: every schedule the two
// files state, as a 24-hour strip, the object printed on a click — the
// same objects the writer emits verbatim. Staged, one counted Apply, the
// ledger's `schedules`. In the column, never a main view (user, 2026-09-04).
// Nothing is authored here; a profile by hand is a later slice.

import { useMemo, useState } from "react";
import type { BemModelOutcome } from "../pipeline.js";
import type { BemLedger, ScheduleRef } from "../core/bemDb.js";
import type { Library } from "../core/idfLib.js";
import { SCHEDULE_ROLES, EQUIPMENT_GROUP_ROLES, ROLE_LABELS, ROLE_KIND, ROLE_CONSUMER, CODE_DEFAULT_SCHEDULE, DEFAULT_PROFILE_REF, SCHEDULE_FILES, readProfiles, fitsRole, objectText, scheduleFileName, type ScheduleRole, type ScheduleProfile } from "../core/schedules.js";
import { KV, Step, srcClass, fmtTemp } from "./bemUi.js";
import { type DaySetDef, partsOf, PART_LABELS, SEASON_PRESETS } from "../core/scheduleParts.js";
import { dayProfilesOf } from "../core/scheduleEdit.js";
import { USER_SCHEDULE_FILE } from "../core/scheduleEdit.js";

export type ScheduleStage = Partial<Record<ScheduleRole, ScheduleRef>>;

/** a 24-hour strip: one bar per hour, the bar's height the value over [min, max] */
export function Strip(p: { hours: number[]; max: number; min?: number; cls?: string; title?: string }): React.ReactElement {
  const min = p.min ?? 0, span = Math.max(1e-9, p.max - min);
  return (
    <svg viewBox="0 0 96 16" preserveAspectRatio="none" className={`strip ${p.cls ?? ""}`} aria-hidden="true">
      {p.title && <title>{p.title}</title>}
      {p.hours.map((v, h) => { const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / span)) : 0; return <rect key={h} x={h * 4} y={16 - 14 * t - 1} width={3.4} height={14 * t + 1} />; })}
    </svg>
  );
}
const same = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const fmtV = (v: number, kind: "fraction" | "temperature", imperial: boolean): string => (Number.isFinite(v) ? (kind === "temperature" ? fmtTemp(v, imperial, 1) : v.toFixed(2)) : "—");
const rangeOf = (p: { min: number; max: number }, kind: "fraction" | "temperature", imperial: boolean): string => (p.min === p.max ? fmtV(p.min, kind, imperial) : `${fmtV(p.min, kind, imperial)} – ${fmtV(p.max, kind, imperial)}`);
const refKey = (r: ScheduleRef | undefined): string => (r ? `${scheduleFileName(r.file)}|${r.name}` : "");

/** the two strips of a reading — the weekend beside the weekday only when it differs */
function Strips(p: { weekday: number[] | null; weekend: number[] | null; kind: "fraction" | "temperature"; cls: string; imperial: boolean; min: number; max: number }): React.ReactElement {
  if (!p.weekday) return <div className="schedNone">—</div>;
  const lo = p.kind === "temperature" ? 10 : 0, hi = p.kind === "temperature" ? 30 : 1;
  const title = (h: number[], d: string): string => `${d}: ${h.map((v, i) => `${i + 1}h ${fmtV(v, p.kind, p.imperial)}`).join(" · ")}`;
  return (
    <div className="schedStrips">
      <div><Strip hours={p.weekday} min={lo} max={hi} cls={p.cls} title={title(p.weekday, "weekday")} /><span>weekday</span></div>
      {p.weekend && !same(p.weekday, p.weekend) && <div><Strip hours={p.weekend} min={lo} max={hi} cls={p.cls} title={title(p.weekend, "weekend")} /><span>weekend</span></div>}
      <span className="schedRange">{rangeOf(p, p.kind, p.imperial)}</span>
    </div>
  );
}

/** THE CARD'S STRIP BY PART (the user, 2026-10-05): one strip and the label under it — "All Days" fixed when that is all the
 *  schedule defines, else a dropdown of its parts (Weekdays first; Weekends, Holiday, the season, the design days); a schedule
 *  the buttons cannot hold lists its own day profiles, a date block each */
function PartStrip(p: { profile: ScheduleProfile; kind: "fraction" | "temperature"; cls: string; imperial: boolean; seasons: DaySetDef[] }): React.ReactElement {
  const [picked, setPick] = useState<number | null>(null);
  const opts = useMemo((): Array<{ label: string; hours: number[] }> => {
    const r = partsOf(p.profile, [...SEASON_PRESETS, ...p.seasons]);
    if ("parts" in r) {
      const x = r.parts;
      if (x.mode === "all") return [{ label: PART_LABELS.all, hours: x.hours.all }];
      return [
        { label: PART_LABELS.weekdays, hours: x.hours.weekdays }, { label: PART_LABELS.weekends, hours: x.hours.weekends }, { label: PART_LABELS.holiday, hours: x.hours.holiday },
        ...(x.season ? [{ label: `${PART_LABELS.seasonal} · ${x.season.id}`, hours: x.hours.seasonal }] : []),
        { label: PART_LABELS.summerDD, hours: x.hours.summerDD }, { label: PART_LABELS.winterDD, hours: x.hours.winterDD },
      ];
    }
    return dayProfilesOf(p.profile).map((d) => ({ label: d.label, hours: d.hours }));
  }, [p.profile, p.seasons]);
  // shown first: the first part with any use (a value above 0) — a schedule used only on weekends opens on Weekends;
  // none in use, or a setpoint, the first part (the user, 2026-10-05)
  const pick = picked ?? (p.kind === "fraction" ? Math.max(0, opts.findIndex((x) => x.hours.some((v) => v > 0))) : 0);
  const o = opts[Math.min(pick, opts.length - 1)];
  if (!o) return <div className="schedNone">—</div>;
  const lo = p.kind === "temperature" ? 10 : 0, hi = p.kind === "temperature" ? 30 : 1;
  return (
    <div className="schedStrips">
      <div>
        <Strip hours={o.hours} min={lo} max={hi} cls={p.cls} title={`${o.label}: ${o.hours.map((v, i) => `${i + 1}h ${fmtV(v, p.kind, p.imperial)}`).join(" · ")}`} />
        {opts.length === 1
          ? <span>{o.label}</span>
          : <select className="schedPartPick" value={Math.min(pick, opts.length - 1)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => setPick(Number(e.target.value))} title="the schedule's parts — the strip shows the one picked">
              {opts.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
            </select>}
      </div>
      <span className="schedRange">{rangeOf(p.profile, p.kind, p.imperial)}</span>
    </div>
  );
}

export function BemSchedules(p: { model: BemModelOutcome | null; library: Library | null; stage: ScheduleStage; onStage: (role: ScheduleRole, ref: ScheduleRef | undefined) => void;
  onRevert: () => void; onApply: (s: ScheduleStage) => void; busy: boolean; ledger: BemLedger | null; imperial: boolean;
  /** THE CARD SELECTED (2026-09-13): the calendar in the view paints its schedule; the frame under the view prints the values */
  card: ScheduleRole | null; onCard: (r: ScheduleRole | null) => void;
  /** THE PROJECT'S HOLIDAY LIST (2026-10-05) as staged and as applied — set in the editor's Holiday button, applied here */
  holidays: DaySetDef | null; holidaysApplied: DaySetDef | null;
  /** your schedules re-saved under a name this project already runs on: their copies wait on Apply */
  copiesPending: string[];
  /** your seasons, to name a schedule's season by its ID */
  seasons?: DaySetDef[] }): React.ReactElement {
  const m = p.model;
  const profiles = useMemo(() => (p.library ? readProfiles(p.library) : []), [p.library]);
  const [libRole, setLibRole] = useState<ScheduleRole | "all">("all");
  const [libFilter, setLibFilter] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  if (!m) return <div className="idfBar bemCol"><div className="idfInfo">no model yet — build the envelope, then open a BEM tab</div></div>;
  const applied = p.ledger?.schedules ?? {};
  const holidaysPending = JSON.stringify(p.holidays) !== JSON.stringify(p.holidaysApplied);
  const pending = SCHEDULE_ROLES.filter((r) => refKey(p.stage[r]) !== refKey(applied[r])).length + (holidaysPending ? 1 : 0) + p.copiesPending.length;
  const byKey = new Map(profiles.map((q) => [refKey({ file: q.file, name: q.name }), q] as const));
  const rowOf = (role: ScheduleRole) => m.schedules.find((s) => s.role === role) ?? null;
  const libRows = profiles.filter((q) => (libRole === "all" || fitsRole(q, libRole)) && (!libFilter.trim() || `${q.name} ${scheduleFileName(q.file)} ${q.cls}`.toLowerCase().includes(libFilter.trim().toLowerCase())));
  const files = SCHEDULE_FILES.map((f) => `${scheduleFileName(f.path)} ${profiles.filter((q) => scheduleFileName(q.file) === scheduleFileName(f.path)).length}`).join(" · ");
  return (
    <div className="idfBar bemCol">
      {m.built.unresolvedSchedules.length > 0 && <div className="idfInfo src-warn">not honoured: {m.built.unresolvedSchedules.join("; ")}</div>}
      {/* the project's holiday list (the editor's Holiday button sets it): one for every schedule, the engine's SpecialDays */}
      <div className={`idfInfo${holidaysPending ? " src-user" : ""}`} title="every schedule runs its own Holiday profile on these days (RunPeriodControl:SpecialDays); set under the graph when a card's Holiday button is picked">
        the project's holidays: {p.holidays ? `${p.holidays.id || "Custom"} · ${p.holidays.days.length} days` : "none"}{holidaysPending ? ` · staged (applied: ${p.holidaysApplied ? `${p.holidaysApplied.id || "Custom"} · ${p.holidaysApplied.days.length} days` : "none"})` : ""}
        {p.copiesPending.length > 0 && <> · your re-saved {p.copiesPending.join(", ")} — the project's copy follows on Apply</>}
      </div>
      <Step head="assignment — the schedule each role runs on" tip={`one schedule per role — the code default until ruled; a pick is one of the engine's own objects, emitted verbatim${p.library ? ` (read: ${files})` : " (the engine's files are not read: no engine found)"}. The occupancy, lighting and equipment schedules run on every room's People, Lights and ElectricEquipment (ZONES, since 2026-09-13); ventilation's waits on a SYSTEMS ruling. Click a card: the calendar in the view paints it, and the frame under it edits its day profiles — All Days, or Weekdays · Weekends · Holiday · Seasonal · the design days. A schedule of yours is kept in the project's ledger as applied.`}>
        {SCHEDULE_ROLES.map((role) => {
          const row = rowOf(role), st = p.stage[role], stProfile = st ? byKey.get(refKey(st)) ?? null : null;
          // THE DEFAULT SHOWN IS THE DEFAULT WRITTEN (the tab review, SCHEDULES item 1): an unruled gain role runs on the example's own
          // profile (People on Occupancy, Lights on InteriorLightingHE, each appliance on its own row's profile) — painted here, never "always on"
          const dfltRef = !st && !(row && row.weekday) ? DEFAULT_PROFILE_REF[role] : undefined;
          const dfltProfile = dfltRef ? byKey.get(refKey(dfltRef)) ?? null : null;
          const kind = ROLE_KIND[role];
          const fitting = profiles.filter((q) => fitsRole(q, role));
          const byFile = new Map<string, ScheduleProfile[]>();
          for (const q of fitting) (byFile.get(scheduleFileName(q.file)) ?? byFile.set(scheduleFileName(q.file), []).get(scheduleFileName(q.file))!).push(q);
          const staged = refKey(st) !== refKey(applied[role]);
          const src = st ? "dataset" : "code-default";
          return (
            <div key={role} className={`schedRow schedCard${staged ? " staged" : ""}${p.card === role ? " sel" : ""}`} onClick={() => p.onCard(p.card === role ? null : role)} title="click: the calendar in the view paints this role's schedule, the frame under it prints the values">
              <div className="schedHead">
                <span className="schedRole" title={ROLE_CONSUMER[role] ? `the object that takes it: ${ROLE_CONSUMER[role]}` : "no object takes it yet — ZONES rules the gains"}>{ROLE_LABELS[role]}</span>
                <select className={srcClass(src)} value={refKey(st)} disabled={p.busy || !p.library} onClick={(e) => e.stopPropagation()} title={row ? `applied: ${row.name}${row.note ? ` · ${row.note}` : ""}` : ""}
                  onChange={(e) => { const q = byKey.get(e.target.value); p.onStage(role, q ? { file: scheduleFileName(q.file), name: q.name } : undefined); }}>
                  <option value="">{CODE_DEFAULT_SCHEDULE[role]} · code default</option>
                  {[...byFile].map(([f, qs]) => (
                    <optgroup key={f} label={f === USER_SCHEDULE_FILE ? `your schedules · ${f}` : f}>
                      {qs.map((q) => <option key={refKey(q)} value={refKey(q)}>{q.name} · {rangeOf(q, kind, p.imperial)}{q.blocks > 1 ? ` · ${q.blocks} blocks` : ""}</option>)}
                    </optgroup>
                  ))}
                </select>
                {staged && <span className="schedStaged">staged</span>}
              </div>
              {stProfile
                ? <PartStrip profile={stProfile} kind={kind} cls={srcClass("dataset")} imperial={p.imperial} seasons={p.seasons ?? []} />
                : row && row.weekday
                  ? (row.file && byKey.get(refKey({ file: row.file, name: row.name }))
                    ? <PartStrip profile={byKey.get(refKey({ file: row.file, name: row.name }))!} kind={kind} cls={srcClass(row.source)} imperial={p.imperial} seasons={p.seasons ?? []} />
                    : <Strips weekday={row.weekday} weekend={row.weekend} kind={kind} cls={srcClass(row.source)} imperial={p.imperial} min={Math.min(...row.weekday)} max={Math.max(...row.weekday)} />)
                  : dfltProfile
                    ? <><PartStrip profile={dfltProfile} kind={kind} cls={srcClass("dataset")} imperial={p.imperial} seasons={p.seasons ?? []} />
                        <div className="schedNote"><span className={srcClass("dataset")}>written: the example's {dfltProfile.name}</span>{role === "equipment" ? " on the plug loads — each appliance runs on its own example profile (Dishwasher, Refrigerator, Range, Clothes Washer, Dryer) until a ruling puts every ElectricEquipment row whose group is not ruled on one schedule" : (EQUIPMENT_GROUP_ROLES as readonly string[]).includes(role) ? " on this group's rows (ZONES › LOADS)" : role === "occupancy" ? " on every room's People" : " on every room's Lights"}</div></>
                  : (EQUIPMENT_GROUP_ROLES as readonly string[]).includes(role) ? <div className="schedNone">{CODE_DEFAULT_SCHEDULE[role]}</div>
                  : ROLE_CONSUMER[role] ? <div className="schedNone">{kind === "temperature" ? "a constant per zone — see ZONES" : role === "ventilation" ? "no local exhaust until SYSTEMS › Ventilation rules one" : role === "infiltration" ? "a constant 1 — the writer's own always-on schedule on every ZoneInfiltration" : role === "hvac-availability" ? "always available — the ideal-loads templates' default; a card's availability field takes a pick here" : "always on"}</div> : null}
              {row && <div className="schedNote">{row.source === "code-default" ? row.note : `applied: ${row.name} — ${row.note}`}</div>}
              {st && !ROLE_CONSUMER[role] && <div className="schedNote">assigned — takes effect when ZONES rules the {role === "ventilation" ? "ventilation" : role === "occupancy" ? "people" : role} (no object today)</div>}
            </div>
          );
        })}
        <div className="applyRow">
          <button className="apply" disabled={pending === 0 || p.busy} onClick={() => p.onApply(p.stage)} title="the staged schedule rulings go to the BEM ledger and the model is rebuilt; RUN says the model moved">
            {pending === 0 ? "✓ applied — nothing staged" : `Apply ${pending} ruling${pending > 1 ? "s" : ""}`}
          </button>
          {pending > 0 && <button onClick={p.onRevert}>revert</button>}
        </div>
      </Step>
      <Step head={`library — the engine's own schedules (${profiles.length})`}>
        <div className="schedLibHead">
          <select value={libRole} onChange={(e) => setLibRole(e.target.value as ScheduleRole | "all")} title="show the schedules that fit a role">
            <option value="all">every schedule</option>
            {SCHEDULE_ROLES.map((r) => <option key={r} value={r}>fits {ROLE_LABELS[r]}</option>)}
          </select>
          <input value={libFilter} onChange={(e) => setLibFilter(e.target.value)} placeholder="filter by name…" />
          <span className="muted">{libRows.length} of {profiles.length}</span>
        </div>
        <div className="idfInfo">{SCHEDULE_FILES.map((f) => <div key={f.path}><b>{scheduleFileName(f.path)}</b> — {f.note}</div>)}<div><b>{USER_SCHEDULE_FILE}</b> — your schedules: the day profiles you edited and saved in the frame under the calendar, read by every project ({profiles.filter((q) => scheduleFileName(q.file) === USER_SCHEDULE_FILE).length})</div></div>
        <div className="qaPanel schedLib">
          <table>
            <thead><tr><th>name</th><th>file</th><th>type</th><th>limits</th><th>range</th><th>profile</th></tr></thead>
            <tbody>
              {libRows.map((q) => {
                const key = refKey(q), kind: "fraction" | "temperature" = /temperature/i.test(q.typeLimits ?? "") ? "temperature" : "fraction";
                const lo = kind === "temperature" ? 10 : 0, hi = kind === "temperature" ? 30 : 1;
                return (
                  <tr key={key} className={shown === key ? "sel" : ""} onClick={() => setShown(shown === key ? null : key)} title={q.problem ?? `${q.dayTypes.join(" ")}${q.blocks > 1 ? ` · ${q.blocks} date blocks` : ""}`}>
                    <td>{q.name}</td>
                    <td className="muted">{scheduleFileName(q.file)}</td>
                    <td className="muted">{q.cls.replace(/^Schedule:/, "")}</td>
                    <td className="muted">{q.typeLimits ?? "—"}</td>
                    <td>{q.problem ? <span className="src-warn">{q.problem}</span> : rangeOf(q, kind, p.imperial)}</td>
                    <td className="schedCell">{q.problem ? "" : <Strip hours={q.weekday} min={lo} max={hi} cls={srcClass("dataset")} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown && byKey.get(shown) && (
          <pre className="schedObj">{byKey.get(shown)!.chain.map(objectText).join("\n\n")}</pre>
        )}
      </Step>
      <KV k="values" v={`file ${m.census.file} · dataset ${m.census.dataset} · code default ${m.census["code-default"]} · user ${m.census.user}`} />
    </div>
  );
}
