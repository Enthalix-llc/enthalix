// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A component dragged from the bottom pane into the assembly canvas. The
// bench and the canvas are two components in two panes, so the drag is a
// small pub/sub: the bench starts it on pointerdown (a ghost follows the
// pointer; a 4 px threshold tells a click from a drag), the canvas registers
// itself as the drop target and is handed the payload with the pointer's
// screen position on release. Pointer events, not HTML5 drag-and-drop, so
// the DevTools protocol's mouse events drive it the way a hand does.

import type { PaletteItem } from "../core/assembly.js";

/** a bench tile, or a ROOM from the LEVELS · SPACES column (2026-09-10) dropped onto a Zone */
export type DragPayload = { item: PaletteItem } | { room: string };
type DropFn = (payload: DragPayload, clientX: number, clientY: number) => void;
let dropTarget: DropFn | null = null;
export function registerDropTarget(fn: DropFn | null): void { dropTarget = fn; }

export function startPaletteDrag(payload: DragPayload, label: string, e: { clientX: number; clientY: number; pointerId?: number }): void {
  const x0 = e.clientX, y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const move = (ev: PointerEvent): void => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    if (!ghost) { ghost = document.createElement("div"); ghost.className = "asmGhost"; ghost.textContent = label; document.body.appendChild(ghost); }
    ghost.style.left = `${ev.clientX + 12}px`; ghost.style.top = `${ev.clientY + 12}px`;
  };
  const up = (ev: PointerEvent): void => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    const dragged = !!ghost;
    ghost?.remove(); ghost = null;
    if (dragged && ev.type === "pointerup") dropTarget?.(payload, ev.clientX, ev.clientY);
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
}

/** the canvas registers its fit-to-view; the bench asks for it after placing many nodes at once */
let fitFn: (() => void) | null = null;
export function registerFit(fn: (() => void) | null): void { fitFn = fn; }
export function requestFit(): void { setTimeout(() => fitFn?.(), 60); }
