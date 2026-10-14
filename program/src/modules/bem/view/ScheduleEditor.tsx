// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE DAY PROFILE EDITOR, the frame under the calendar (user, 2026-10-05): the selected schedule as 24 bars; a click on a
// bar opens its hour in the input box — a fraction 0.0 … 1.0 (the type limits'), a setpoint in °F or °C. The Name box
// reads the schedule's own name until something is edited; then it is the name the copy is saved under, into YOUR
// schedules (data/schedules-user.idf, every project), and the copy is staged for the role.
//
// THE PART BUTTONS above the bars (the user, later the same day): All Days · Weekdays · Weekends · Holiday · Seasonal ·
// Summer DD · Winter DD. All Days selected, the others dim; a dimmed one picked splits the parts (All Days dims, the
// picked one lit, the rest active). Holiday opens the PROJECT's holiday list under the graph (one per project — the
// engine's own SpecialDays; US federal, your saved lists, or Custom with its ID, the days clicked in the calendar);
// Seasonal the schedule's ONE season (the same choices; it overrides the year on its days). A schedule the buttons cannot
// hold (its Saturday and Sunday differ, …) is edited by its own day profiles, a chip each — or converted on the user's
// word, what changes named first.

import { useEffect, useMemo, useRef, useState } from "react";
import type { IdfObject, Library } from "../core/idfLib.js";
import type { ScheduleProfile, ScheduleRole } from "../core/schedules.js";
import { ROLE_KIND, ROLE_LABELS, scheduleFileName, ruleWith } from "../core/schedules.js";
import { type RunCalendar, dayTypeOf, dayLabel } from "../core/scheduleCalendar.js";
import { dayProfilesOf, dayProfileOn, draftOf, draftOfParts, blankProfile, isEdited, hourRange, parseHour, nameProblem, isUserSchedule, type DayEdits } from "../core/scheduleEdit.js";
import { type PartKey, type PartSchedule, type DaySetDef, type UserCalendars, PART_KEYS, PART_LABELS, partsOf, splitFrom, joinAll, joinWords, hoursOfPart, SEASON_PRESETS, daysWords, idProblem } from "../core/scheduleParts.js";
import { usFederalHolidays } from "../core/scheduleDays.js";
import { cellColor, type CalAt } from "./ScheduleCalendar.js";
import { fmtTemp } from "./bemUi.js";

export interface EditorSave { role: ScheduleRole; object: IdfObject; limits: IdfObject | null; note: string; season: DaySetDef | null }
/** what the calendar shows while the Holiday or Seasonal button is picked: the set's days, painted by a click or a drag when
 *  the set is the user's own */
export interface CalMode { days: number[]; paint: ((n: number, add: boolean) => void) | null; word: string }

const US = ((): DaySetDef => { const u = usFederalHolidays(); return { id: u.label, days: u.days }; })();
const HOLIDAY_PRESETS: DaySetDef[] = [US];
const sameDays = (a: number[], b: number[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);
const toggle = (days: number[], n: number, add: boolean): number[] => { const s = new Set(days); if (add) s.add(n); else s.delete(n); return [...s].sort((a, b) => a - b); };

/** THE 24 BARS AND THE HOUR'S BOX: shared by the parts and the day profiles */
function HourBars(p: { hours: number[]; orig: number[] | null; temp: boolean; imperial: boolean; range: { lo: number; hi: number; discrete: boolean }; onHours: (h: number[]) => void; resetKey: string }): React.ReactElement {
  const [hour, setHour] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setHour(null); setMsg(null); }, [p.resetKey]);
  // A RIGHT-DRAG copies a value (the user, 2026-10-05): the bar pressed with the right button gives its value to every bar
  // the pointer crosses while the button is held; the hours as they stand ride in a ref so a fast drag loses no bar
  const drag = useRef<{ v: number; hours: number[] } | null>(null);
  useEffect(() => { const end = (): void => { drag.current = null; }; window.addEventListener("pointerup", end); return () => window.removeEventListener("pointerup", end); }, []);
  const spread = (h: number): void => {
    const d = drag.current;
    if (!d || Object.is(d.hours[h], d.v)) return;
    d.hours = [...d.hours]; d.hours[h] = d.v;
    p.onHours(d.hours);
  };
  const lo = p.temp ? 10 : 0, hi = p.temp ? 30 : 1;
  const atEye = (v: number): string => (!Number.isFinite(v) ? "" : p.temp ? (p.imperial ? (v * 9 / 5 + 32).toFixed(1) : v.toFixed(1)) : String(v));
  const show = (v: number): string => (!Number.isFinite(v) ? "—" : p.temp ? fmtTemp(v, p.imperial, 0) : v.toFixed(2));
  const unitWord = p.temp ? (p.imperial ? "°F" : "°C") : "";
  const rangeWord = p.temp ? `${atEye(p.range.lo)} – ${atEye(p.range.hi)} ${unitWord}` : `${p.range.lo.toFixed(1)} – ${p.range.hi.toFixed(1)}${p.range.discrete ? " (on/off: 0 or 1)" : ""}`;
  const pick = (h: number): void => { setHour(h); setText(atEye(p.hours[h] ?? NaN)); setMsg(null); setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0); };
  const commit = (step: number): void => {
    if (hour === null) return;
    if (text.trim() === atEye(p.hours[hour] ?? NaN)) { if (step) pick((hour + step + 24) % 24); return; }
    const r = parseHour(text, p.range, p.temp, p.imperial);
    if ("error" in r) { setMsg(`hour ending ${hour + 1}: ${r.error}`); return; }
    const next = [...p.hours]; next[hour] = r.value;
    p.onHours(next);
    setMsg(null);
    if (step) pick((hour + step + 24) % 24);
  };
  return (
    <>
      <div className="schedEdBars">
        {p.hours.map((v, h) => {
          const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
          const changed = p.orig && !Object.is(v, p.orig[h]);
          return (
            <div key={h} className={`schedEdBar${hour === h ? " sel" : ""}${changed ? " edited" : ""}`} onClick={() => pick(h)} title={`hour ending ${h + 1} (${h}:00–${h + 1}:00) · ${show(v)} — click to edit · right-drag from here copies ${show(v)} to the bars you cross`}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => { if (e.button !== 2 || !Number.isFinite(v)) return; e.preventDefault(); setHour(null); drag.current = { v, hours: [...p.hours] }; }}
              onPointerEnter={(e) => { if (drag.current && e.buttons & 2) spread(h); }}>
              <div className="calBarFill" style={{ height: `${Number.isFinite(v) ? Math.max(2, 100 * t) : 0}%`, background: cellColor(v, p.temp ? "temperature" : "fraction") }} />
              <span className="calBarV">{show(v)}</span><span className="calBarH">{h + 1}</span>
            </div>
          );
        })}
      </div>
      <div className="schedEdInput">
        {hour === null
          ? <span className="muted">click a bar to edit its hour · right-drag from a bar copies its value across · {rangeWord}</span>
          : <>
              <span>hour ending <b>{hour + 1}</b> ({hour}:00–{hour + 1}:00)</span>
              <input ref={input} className="src-user" value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={() => commit(0)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { setHour(null); setMsg(null); } }} />
              <span className="muted">{unitWord} · {rangeWord} · Enter / Tab the next hour, Shift back, Esc closes</span>
              {p.orig && !Object.is(p.hours[hour], p.orig[hour]) && <button onClick={() => { const next = [...p.hours]; next[hour] = p.orig![hour]!; p.onHours(next); setText(atEye(p.orig![hour]!)); }} title={`back to the schedule's own ${show(p.orig[hour]!)}`}>×</button>}
            </>}
        {msg && <span className="src-warn"> {msg}</span>}
      </div>
    </>
  );
}

/** A SET OF DAYS under the graph: the project's holiday list, or the schedule's season — none, the starting ones, yours,
 *  or Custom with its ID; the user's own set's days are clicked in the calendar */
function DaySetPicker(p: { kind: "holidays" | "seasons"; value: DaySetDef | null; presets: DaySetDef[]; mine: DaySetDef[]; onValue: (d: DaySetDef | null) => void; onKeep: (d: DaySetDef) => void; kept: string | null }): React.ReactElement {
  const known = [...p.presets, ...p.mine];
  const preset = p.value ? p.presets.find((x) => x.id === p.value!.id && sameDays(x.days, p.value!.days)) : null;
  const saved = p.value ? p.mine.find((x) => x.id.toLowerCase() === p.value!.id.toLowerCase()) : null;
  const sel = !p.value ? "" : preset ? `p:${preset.id}` : saved && sameDays(saved.days, p.value.days) ? `m:${saved.id}` : "custom";
  const problem = p.value && !preset ? idProblem(p.value.id, known.map((x) => x.id), saved ? saved.id : null) : null;
  const word = p.kind === "holidays" ? "holiday list" : "season";
  return (
    <div className="schedEdSet">
      <label>{p.kind === "holidays" ? "the project's holidays" : "the season"}{" "}
        <select value={sel} onChange={(e) => {
          const v = e.target.value;
          if (!v) p.onValue(null);
          else if (v === "custom") p.onValue({ id: p.value && !preset ? p.value.id : "", days: p.value ? [...p.value.days] : [] });
          else { const x = v.startsWith("p:") ? p.presets.find((q) => `p:${q.id}` === v) : p.mine.find((q) => `m:${q.id}` === v); if (x) p.onValue({ id: x.id, days: [...x.days] }); }
        }}>
          <option value="">{p.kind === "holidays" ? "none — no holidays in this project" : "none — no season"}</option>
          <optgroup label="to start from">{p.presets.map((x) => <option key={x.id} value={`p:${x.id}`}>{x.id} · {x.days.length} d</option>)}</optgroup>
          {p.mine.length > 0 && <optgroup label={`your ${p.kind === "holidays" ? "holiday lists" : "seasons"} · calendars-user.json`}>{p.mine.map((x) => <option key={x.id} value={`m:${x.id}`}>{x.id} · {x.days.length} d</option>)}</optgroup>}
          <option value="custom">Custom…{sel === "custom" && p.value?.id ? ` (${p.value.id})` : ""}</option>
        </select>
      </label>
      {p.value && !preset && <label>ID <input className="schedEdId" value={p.value.id} placeholder={`name this ${word}`} onChange={(e) => p.onValue({ ...p.value!, id: e.target.value })} /></label>}
      {p.value && !preset && <button disabled={!!problem || !p.value.days.length || (!!saved && sameDays(saved.days, p.value.days) && saved.id === p.value.id.trim())} onClick={() => p.onKeep(p.value!)} title={`keep this ${word} in your library (data/calendars-user.json), for every project`}>keep in your library</button>}
      {problem && <span className="src-warn">{problem}</span>}
      {p.kept && <span className="src-user">{p.kept}</span>}
      <div className="muted schedEdSetDays">{p.value ? `${daysWords(p.value.days)}${preset ? ` · to change its days, pick Custom…` : " · click or drag days in the calendar above to add or remove them"}` : ""}</div>
    </div>
  );
}

export function ScheduleEditor(p: {
  profile: ScheduleProfile | null; role: ScheduleRole; cal: RunCalendar; at: CalAt; imperial: boolean; library: Library | null;
  /** the draft the calendar paints while edits stand, null to paint the schedule itself */
  onDraft: (d: ScheduleProfile | null) => void;
  /** writes the copy into your schedules and stages it for the role; resolves to an error's words, or null */
  onSave: (s: EditorSave) => Promise<string | null>;
  /** the project's holiday list as staged, and its change (staged — Apply in the column) */
  holidays: DaySetDef | null; onHolidays: (d: DaySetDef | null) => void;
  /** your holiday lists and seasons, and keeping one (resolves to an error's words, or null) */
  calendars: UserCalendars; onKeep: (kind: "holidays" | "seasons", d: DaySetDef) => Promise<string | null>;
  /** the calendar's days while Holiday or Seasonal is picked (null: the calendar paints the schedule) */
  onCalMode: (m: CalMode | null) => void;
}): React.ReactElement {
  const temp = ROLE_KIND[p.role] === "temperature";
  const [blank, setBlank] = useState<ScheduleProfile | null>(null);
  const base = p.profile ?? blank;
  const key = `${p.role}|${p.profile?.file ?? ""}|${p.profile?.name ?? ""}`;
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<{ kind: string; text: string } | null>(null);
  const justSaved = useRef(false);   // a save stages the copy, which changes the schedule shown: its message survives the reset
  // THE PARTS: the schedule read into them (or why not); the edited parts; the part picked
  const seasonsKnown = useMemo(() => [...SEASON_PRESETS, ...p.calendars.seasons], [p.calendars.seasons]);
  const read = useMemo(() => (base ? partsOf(base, seasonsKnown) : null), [base, seasonsKnown]);
  const [converted, setConverted] = useState<PartSchedule | null>(null);
  const orig = read && "parts" in read ? read.parts : converted;
  const [parts, setParts] = useState<PartSchedule | null>(null);
  const [sel, setSel] = useState<PartKey>("all");
  // THE DAY PROFILES (a schedule the buttons cannot hold): the edits by rule
  const [edits, setEdits] = useState<DayEdits>({});
  const [chip, setChip] = useState<string | null>(null);
  const chipPicked = useRef(false);
  // a new schedule or a new role: the edits start over, the name reads the schedule's own
  useEffect(() => {
    setEdits({}); setChip(null); chipPicked.current = false; setConverted(null); setParts(null); setSel("all"); setKept(null);
    if (!justSaved.current) setMsg(null); justSaved.current = false; setBlank(null); setName(p.profile ? p.profile.name : "");
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = parts ?? orig;   // the parts as they stand
  // the part shown first — as the card's dropdown: the first with any use (a value above 0), else Weekdays
  const firstPart = (o: PartSchedule | null): PartKey => {
    if (!o || o.mode === "all") return "all";
    const ks: PartKey[] = ["weekdays", "weekends", "holiday", ...(o.season ? ["seasonal" as const] : []), "summerDD", "winterDD"];
    return (!temp && ks.find((k) => o.hours[k].some((v) => v > 0))) || "weekdays";
  };
  useEffect(() => { if (orig && !parts) setSel(firstPart(orig)); }, [orig]);   // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (base && !orig ? dayProfilesOf(base) : []), [base, orig]);
  const calType = p.cal.holidays.some((h) => h.n === p.at.n) ? "holiday" as const : dayTypeOf(p.cal, p.at.n);
  const onCal = base && !orig && p.at.level !== "year" ? dayProfileOn(list, base, p.at.n, calType) : null;
  useEffect(() => { if (!chipPicked.current && onCal) setChip(onCal); }, [onCal]);
  const curChip = list.find((d) => d.key === chip) ?? list[0] ?? null;
  const chipHours = (k: string): number[] => edits[k] ?? list.find((d) => d.key === k)!.hours;

  // an edit is a change to what is WRITTEN: a split whose parts still all equal the one profile is not one
  const sameParts = (a: PartSchedule, b: PartSchedule): boolean => JSON.stringify(a.season) === JSON.stringify(b.season)
    && (["weekdays", "weekends", "holiday", "summerDD", "winterDD", ...(a.season ? ["seasonal" as const] : [])] as PartKey[]).every((k) => JSON.stringify(hoursOfPart(a, k)) === JSON.stringify(hoursOfPart(b, k)));
  const partsEdited = !!orig && !!parts && !sameParts(parts, orig);
  const edited = !!base && (orig ? partsEdited || (!!converted && !(read && "parts" in read)) : isEdited(list, edits));
  const used: PartKey[] = cur ? (cur.mode === "all" ? ["all"] : ["weekdays", "weekends", "holiday", "summerDD", "winterDD", ...(cur.season ? ["seasonal" as const] : [])]) : [];
  const complete = orig ? !!cur && used.every((k) => hoursOfPart(cur, k).every(Number.isFinite)) : list.every((d) => chipHours(d.key).every(Number.isFinite));
  const range = base ? hourRange(base, p.role) : { lo: 0, hi: 1, discrete: false };
  // the hours not yet typed, and filling them with the role's low value — offered by a button, never done for you
  const untyped = !base ? 0 : orig ? (cur ? used.reduce((n, k) => n + hoursOfPart(cur, k).filter((v) => !Number.isFinite(v)).length, 0) : 0)
    : list.reduce((n, d) => n + chipHours(d.key).filter((v) => !Number.isFinite(v)).length, 0);
  const fillUntyped = (): void => {
    const fill = (h: number[]): number[] => h.map((v) => (Number.isFinite(v) ? v : range.lo));
    if (orig) setPartsFn((s) => ({ ...s, hours: Object.fromEntries(Object.entries(s.hours).map(([k, h]) => [k, fill(h)])) as PartSchedule["hours"] }));
    else setEdits((e) => Object.fromEntries(list.map((d) => [d.key, fill(e[d.key] ?? d.hours)])));
  };

  // the draft the calendar paints: every hour typed, something edited
  const draft = useMemo(() => {
    if (!p.library || !base || !edited || !complete) return null;
    const nm = name.trim() || base.name || "new schedule";
    return orig && cur ? draftOfParts(p.library, base, cur, nm) : draftOf(p.library, base, edits, nm);
  }, [p.library, base, orig, cur, edits, edited, complete, name]);
  useEffect(() => { p.onDraft(draft && !draft.profile.problem ? draft.profile : null); }, [draft]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { p.onDraft(null); p.onCalMode(null); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // THE CALENDAR'S DAYS while Holiday or Seasonal is picked: the set shown, painted when it is the user's own
  const holidayPreset = p.holidays ? HOLIDAY_PRESETS.find((x) => x.id === p.holidays!.id && sameDays(x.days, p.holidays!.days)) : null;
  const seasonPreset = cur?.season ? SEASON_PRESETS.find((x) => x.id === cur.season!.id && sameDays(x.days, cur.season!.days)) : null;
  // a season of the user's own may keep its ID (re-kept on save); a starting one is itself; any other ID must be new
  const seasonProblem = cur?.season && !seasonPreset ? idProblem(cur.season.id, seasonsKnown.map((x) => x.id), p.calendars.seasons.find((x) => x.id.toLowerCase() === cur.season!.id.trim().toLowerCase())?.id ?? null) : null;
  const setPartsFn = (f: (s: PartSchedule) => PartSchedule): void => setParts((s) => f(s ?? cur!));
  const calKey = sel === "holiday" && cur?.mode === "split" ? `h|${JSON.stringify(p.holidays)}` : sel === "seasonal" && cur?.mode === "split" ? `s|${JSON.stringify(cur.season)}` : "";
  useEffect(() => {
    if (sel === "holiday" && cur?.mode === "split") {
      const h = p.holidays;
      p.onCalMode({ days: h?.days ?? [], word: h ? `the project's holidays · ${h.id || "Custom"} · ${h.days.length} days` : "the project's holidays · none", paint: h && !holidayPreset ? (n, add) => p.onHolidays({ ...h, days: toggle(h.days, n, add) }) : null });
    } else if (sel === "seasonal" && cur?.mode === "split") {
      const s = cur.season;
      p.onCalMode({ days: s?.days ?? [], word: s ? `the season · ${s.id || "Custom"} · ${s.days.length} days` : "the season · none", paint: s && !seasonPreset ? (n, add) => setPartsFn((x) => (x.season ? { ...x, season: { ...x.season, days: toggle(x.season.days, n, add) } } : x)) : null });
    } else p.onCalMode(null);
  }, [calKey, sel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const resaving = base && isUserSchedule(base) ? base.name : null;
  const problem = edited && p.library ? nameProblem(name, p.library, resaving) : null;
  const save = async (): Promise<void> => {
    if (!draft || !base || problem || seasonProblem) return;
    const from = base === blank ? "a new schedule" : `from ${base.name} (${scheduleFileName(base.file)})`;
    const what = orig && cur
      ? (cur.mode === "all" ? "All Days" : used.filter((k) => !orig || JSON.stringify(hoursOfPart(cur, k)) !== JSON.stringify(hoursOfPart(orig, k))).map((k) => PART_LABELS[k]).join("; ") || "the parts") + (cur.season ? ` · season "${cur.season.id}"` : "")
      : list.filter((d) => edits[d.key] && edits[d.key]!.some((v, h) => !Object.is(v, d.hours[h]))).map((d) => d.label).join("; ") || "every hour";
    setBusy(true);
    const season = cur?.season && !seasonPreset ? cur.season : null;
    const err = await p.onSave({ role: p.role, object: draft.object, limits: draft.limits, note: `${from} · edited ${what} · saved ${new Date().toISOString().slice(0, 10)}`, season });
    setBusy(false);
    justSaved.current = !err;
    setMsg(err ? { text: err, bad: true } : { text: `saved "${draft.object.name}" into your schedules and staged it for ${ROLE_LABELS[p.role]} — Apply in the column`, bad: false });
  };
  const keep = async (kind: "holidays" | "seasons", d: DaySetDef): Promise<void> => {
    const err = await p.onKeep(kind, { id: d.id.trim(), days: d.days });
    setKept({ kind, text: err ?? `kept "${d.id.trim()}" in your library` });
  };
  const discard = (): void => { setEdits({}); setParts(null); setConverted(null); setName(base === blank ? "" : base?.name ?? ""); setMsg(null); setSel(firstPart(orig)); };

  if (!base) return (
    <div className="schedEdNote">
      <span className="muted">no schedule object to edit — {ROLE_LABELS[p.role]} runs on the code default. </span>
      <button disabled={!p.library} onClick={() => { if (!p.library) return; const b = blankProfile(p.library, p.role); setBlank(b); setName(""); setEdits({}); }} title="one profile for every day of the year, 24 hours for you to type — nothing filled in for you">start a new schedule…</button>
    </div>
  );

  const head = (
    <div className="schedEdHead">
      <label>Name <input className={edited ? "src-user" : ""} value={name} disabled={!edited} placeholder={base === blank ? "type a name for the new schedule" : ""} onChange={(e) => setName(e.target.value)}
        title={edited ? "the name your copy is saved under — it may not repeat a schedule the library holds" : "the schedule's own name — edit an hour and this becomes the name of your copy"} /></label>
      <span className="muted">{base === blank ? "a new schedule" : `${scheduleFileName(base.file)} · ${base.cls.replace(/^Schedule:/, "")}${base.typeLimits ? ` · ${base.typeLimits}` : ""}`}</span>
      <button className="apply" disabled={!edited || !complete || !!problem || !!seasonProblem || busy || !draft || !!draft.profile.problem} onClick={() => void save()}
        title="writes the copy into your schedules (data/schedules-user.idf, read by every project) and stages it for this role; Apply in the column keeps it in the project">
        {busy ? "saving…" : "Save as yours"}</button>
      {edited && <button onClick={discard}>discard edits</button>}
      {edited && problem && <span className="src-warn">{problem}</span>}
      {edited && seasonProblem && <span className="src-warn">the season: {seasonProblem}</span>}
      {edited && !complete && <span className="src-warn">{untyped} {untyped === 1 ? "hour has" : "hours have"} no value yet — type {untyped === 1 ? "it" : "them"}{temp ? "" : ", or"}</span>}
      {edited && !complete && !temp && <button onClick={fillUntyped} title={`every hour still blank becomes ${range.lo.toFixed(1)}; the hours you typed are kept — then Save as yours`}>set the {untyped} blank {untyped === 1 ? "hour" : "hours"} to {range.lo.toFixed(1)}</button>}
    </div>
  );
  const footer = msg && <div className={msg.bad ? "src-warn" : "src-user"}>{msg.text}</div>;

  // ── THE DAY PROFILES: a schedule the buttons cannot hold
  if (!orig) {
    const reason = read && "reason" in read ? read.reason : "";
    const convert = (): void => {
      const per = base.periods[0];
      if (!per) return;
      const r = (t: Parameters<typeof ruleWith>[1], ...alt: Array<Parameters<typeof ruleWith>[1]>): number[] => [...((ruleWith(per.rules, t) ?? alt.map((a) => ruleWith(per.rules, a)).find(Boolean))?.hours ?? Array(24).fill(NaN))];
      const wk = r("monday");
      const s: PartSchedule = { mode: "split", season: null, hours: { all: wk, weekdays: wk, weekends: r("saturday", "sunday"), holiday: r("holiday", "sunday"), seasonal: [...wk], summerDD: r("summerdesignday", "monday"), winterDD: r("winterdesignday", "monday") } };
      if (!window.confirm(`Hold "${base.name}" in the buttons? ${reason}. Its first date block's profiles are taken: Monday for Weekdays, Saturday for Weekends${base.periods.length > 1 ? `, and its other ${base.periods.length - 1} date block(s) are left out` : ""}. Nothing changes in the engine's file; what you save is your copy.`)) return;
      setConverted(s); setParts(s); setSel("weekdays");
    };
    return (
      <div className="schedEd">
        {head}
        <div className="schedEdNote"><span className="src-warn">the buttons cannot hold this schedule: {reason}</span> — its own day profiles below, a chip each · <button onClick={convert} title="take its first date block into the buttons, what changes named before it happens">hold it in the buttons…</button></div>
        <div className="schedEdChips">
          {list.map((d) => <button key={d.key} className={`chip${curChip?.key === d.key ? " on" : ""}${edits[d.key] ? " edited" : ""}`} onClick={() => { chipPicked.current = true; setChip(d.key); }}
            title={`${d.types.length} of the engine's 12 day types${onCal === d.key ? ` · ${dayLabel(p.cal, p.at.n)} in the calendar takes this one` : ""}`}>{onCal === d.key ? "◆ " : ""}{d.label}</button>)}
        </div>
        {curChip && <HourBars hours={chipHours(curChip.key)} orig={curChip.hours} temp={temp} imperial={p.imperial} range={range} resetKey={`${key}|${curChip.key}`}
          onHours={(h) => setEdits((e) => ({ ...e, [curChip.key]: h }))} />}
        {footer}
      </div>
    );
  }

  // ── THE PARTS
  const c = cur!;
  const pickPart = (k: PartKey): void => {
    if (k === "all") {
      // already one profile: the click applies the hours shown to every day — a blank hour reads as the role's low value
      // (a fraction's 0.0; a setpoint's blanks still wait to be typed)
      if (c.mode === "all") {
        if (!temp && untyped) { fillUntyped(); setMsg({ text: `All Days: the profile shown applies to every day of the year — its ${untyped} blank ${untyped === 1 ? "hour is" : "hours are"} ${range.lo.toFixed(1)}`, bad: false }); }
        return;
      }
      // the profile shown becomes every day's (the user, 2026-10-05); the parts it would wipe out are named first
      const from = sel === "all" ? "weekdays" : sel;
      const lost = joinWords(c, from);
      if (lost && !window.confirm(`All Days: the ${PART_LABELS[from]} profile shown applies to every day of the year. Replaced: ${lost}.`)) return;
      const j = joinAll(c, from);
      setParts(temp ? j : { ...j, hours: { ...j.hours, all: j.hours.all.map((v) => (Number.isFinite(v) ? v : range.lo)) } }); setSel("all"); return;
    }
    if (c.mode === "all") setParts(splitFrom(c));
    setSel(k);
  };
  const shownKey: PartKey = c.mode === "all" ? "all" : sel === "all" ? "weekdays" : sel;
  const holidayDays = p.holidays?.days.length ?? 0;
  const partTip: Record<PartKey, string> = {
    all: c.mode === "split" ? `click: the ${PART_LABELS[sel === "all" ? "weekdays" : sel]} profile shown applies to every day of the year, the design days too` : "one profile for every day of the year — the design days too",
    weekdays: "Monday to Friday, every week of the year (outside the season)",
    weekends: "Saturday and Sunday, every week of the year (outside the season)",
    holiday: `the project's holidays — ${holidayDays ? `${holidayDays} days` : "none yet"}; one list for every schedule (the engine's RunPeriodControl:SpecialDays)`,
    seasonal: c.season ? `the season "${c.season.id}", ${c.season.days.length} days — overrides Weekdays, Weekends and Holiday on its days` : "no season yet — pick one under the graph",
    summerDD: "the summer design day the sizing runs on — never a day of the run",
    winterDD: "the winter design day the sizing runs on — never a day of the run",
  };
  return (
    <div className="schedEd">
      {head}
      <div className="schedEdParts">
        {PART_KEYS.map((k) => {
          const on = k === shownKey, dim = c.mode === "all" ? k !== "all" : k === "all";
          const changed = orig && c.mode === "split" && k !== "all" && (k === "seasonal" ? JSON.stringify(orig.season) !== JSON.stringify(c.season) || (!!c.season && JSON.stringify(hoursOfPart(orig, k)) !== JSON.stringify(hoursOfPart(c, k))) : JSON.stringify(hoursOfPart(orig, k)) !== JSON.stringify(hoursOfPart(c, k)));
          return <button key={k} className={`${on ? "on" : ""}${dim ? " dim" : ""}${changed ? " edited" : ""}${k === "seasonal" && c.mode === "split" && !c.season ? " unset" : ""}`} onClick={() => pickPart(k)} title={partTip[k]}>{PART_LABELS[k]}</button>;
        })}
      </div>
      <HourBars hours={hoursOfPart(c, shownKey)} orig={hoursOfPart(orig, shownKey)} temp={temp} imperial={p.imperial} range={range} resetKey={`${key}|${shownKey}`}
        onHours={(h) => setPartsFn((s) => ({ ...s, hours: { ...s.hours, [shownKey]: h } }))} />
      {c.mode === "split" && shownKey === "holiday" && (
        <>
          <DaySetPicker kind="holidays" value={p.holidays} presets={HOLIDAY_PRESETS} mine={p.calendars.holidays} onValue={p.onHolidays} onKeep={(d) => void keep("holidays", d)} kept={kept?.kind === "holidays" ? kept.text : null} />
          <div className="muted schedEdSetDays">one holiday list for the project: every schedule runs its own Holiday profile on these days (the engine's RunPeriodControl:SpecialDays{p.cal.holidays.length ? `; the weather file names its own too` : ""}) · a change is staged — Apply in the column</div>
        </>
      )}
      {c.mode === "split" && shownKey === "seasonal" && (
        <>
          <DaySetPicker kind="seasons" value={c.season} presets={SEASON_PRESETS} mine={p.calendars.seasons} onValue={(d) => setPartsFn((s) => ({ ...s, season: d }))} onKeep={(d) => void keep("seasons", d)} kept={kept?.kind === "seasons" ? kept.text : null} />
          <div className="muted schedEdSetDays">this schedule's one season: on its days the Seasonal profile overrides Weekdays, Weekends and Holiday; the design days keep their own{c.season ? "" : " · no season: these hours are not written"}</div>
        </>
      )}
      {converted && !(read && "parts" in read) && <div className="muted">held in the buttons from {base.name}'s first date block — {read && "reason" in read ? read.reason : ""}</div>}
      {footer}
    </div>
  );
}
