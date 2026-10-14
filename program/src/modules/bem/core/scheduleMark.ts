// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SCHEDULE MARKERS a component card's field may carry (user, 2026-09-14: "a
// Schedule dropdown is needed" on the component's inputs): `@always` (a constant
// 1) · `@never` (a constant 0 — how a supplemental heater is switched off, the
// engine's own way: an availability schedule of 0) · `@hvac-availability` (the
// SCHEDULES tab's HVAC availability role) · `@schedule:<file>|<name>` (one of the
// library's own, by its file and name). A marker rides in the card's fields as a
// string, becomes a FieldRef in the resolver and the generator, and the writer
// fills it with the emitted name — the schedule itself emitted once ahead.
// Pure; shared by the compile, the resolver, the generator and the settings.

import type { FieldRef } from "./bemSystems.js";
import type { FieldValue } from "./bemDb.js";
import type { ScheduleRef } from "./schedules.js";

export const SCHEDULE_MARK = "@schedule:";
export const scheduleMark = (ref: ScheduleRef): string => `${SCHEDULE_MARK}${ref.file}|${ref.name}`;
/** the library schedule a marker names, null for any other value */
export function scheduleRefOfMark(v: FieldValue | undefined): ScheduleRef | null {
  if (typeof v !== "string" || !v.startsWith(SCHEDULE_MARK)) return null;
  const rest = v.slice(SCHEDULE_MARK.length), i = rest.indexOf("|");
  return i > 0 ? { file: rest.slice(0, i), name: rest.slice(i + 1) } : null;
}
/** a marker as the reference the writer fills; null when the value is not a marker */
export function markerRef(v: FieldValue | undefined): FieldRef | null {
  if (typeof v !== "string" || !v.startsWith("@")) return null;
  if (v === "@always") return { schedule: "always" };
  if (v === "@never") return { schedule: "never" };
  if (v === "@hvac-availability") return { schedule: "hvac-availability" };
  const ref = scheduleRefOfMark(v);
  return ref ? { schedule: ref } : null;
}
/** the words for a marker, for the settings and the notes; null when the value is not a marker */
export function markerWord(v: FieldValue | undefined): string | null {
  const r = markerRef(v);
  if (!r?.schedule) return null;
  const s = r.schedule;
  return s === "always" ? "always on" : s === "never" ? "always off" : s === "hvac-availability" ? "the SCHEDULES › HVAC availability role" : s === "ventilation" ? "the SCHEDULES › ventilation role" : `${s.name} (${s.file})`;
}
