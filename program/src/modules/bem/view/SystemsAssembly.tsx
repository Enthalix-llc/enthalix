// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ASSEMBLY CANVAS (user, 2026-09-10): a white sheet, rectangles standing
// in for equipment, typed CONNECTORS on each — water on the left, air on the
// right, the arrow the flow's direction relative to the box — and Visio-like
// lines between them: a line leaves an out-port as a thick stub, runs
// orthogonally through corners the sheet routes or the user drags, and ends
// at a compatible in-port. React Flow (MIT) does the mechanics; every node,
// port and line is our own. The assembly itself lives in the SYSTEMS stage.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, Position, ConnectionMode, BaseEdge, EdgeLabelRenderer, applyNodeChanges, useReactFlow,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps, type EdgeProps, type IsValidConnection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type Assembly, type AsmNode, type CompiledAssembly, type NodeKind, type Port, type ZoneAssign, type XY, type Dir, NODE_LABEL, NODE_CLASS, ATTACH_LABEL, GROUP_OF, PORTS, portsOfNode, classOf, compatible, isLoop, nodeSize, portY, portX, addNode, addEdge, removeNode, removeEdge, moveNode, setEdgePoints, attach, attachVerdict, recoveryOnUnit, zonesOf, addRoom, removeRoom, toggleZone, toggleThermostat, routePoints, orthoPathFrom, pinCorners, cleanCorners, jogCorners, shiftSegment, segmentKind, substitutesFor, substitute, type Substitute, type AsmEdge } from "../core/assembly.js";
import { foldTerminals } from "../core/assembly.js";   // the terminal cards fold into their Zones (2026-09-13)
import { isNarrow } from "../core/assembly.js";
import { QA_RULES, type SystemQaRow } from "../core/systemQa.js";
import { registerDropTarget, registerFit, type DragPayload } from "./assemblyDrag.js";
import type { Catalogue } from "../core/epCatalogue.js";

/** the group's colour — the bar on the node, the tile in the bench */
export const GROUP_COLOR: Record<string, string> = { "ZONE EQUIPMENT": "#3b6fd6", "AIR LOOP": "#3fa86b", COILS: "#2f9e9e", "PLANT LOOP": "#d6553b", RESOURCE: "#8a6d3b", CONTROLS: "#7a7f8c" };
const MEDIUM_WORD: Record<string, string> = { wtr: "water", air: "air", oa: "outdoor air", exh: "exhaust", loc: "location", dc: "direct current", ac: "alternating current", hw: "hot water" };
/** A ZONE'S COLOUR (user, 2026-09-10): each Zone has its own border colour from the moment it is placed, and a room held by it
 *  reads in that colour in LEVELS · SPACES — twelve hues told apart at a glance, keyed to the zone's number (`zone-3` is the
 *  third hue whatever else is on the sheet; a number freed by a removal is reused, with its hue) */
export const ZONE_COLORS = ["#d6553b", "#2f6fd6", "#2e9e5e", "#b8860b", "#8e44ad", "#16a085", "#e67e22", "#c2185b", "#1f7fa8", "#6d4c41", "#5b8c00", "#7b1fa2"];
export const zoneColor = (id: string): string => { const n = Number(/(\d+)$/.exec(id)?.[1] ?? 1); return ZONE_COLORS[(Math.max(1, n) - 1) % ZONE_COLORS.length]!; };
/** the arrow on the sheet is the flow's direction: on the left, ‹ leaves and › enters; on the right, › leaves and ‹ enters */
const glyphOf = (q: Port): string => (q.side === "top" ? (q.dir === "out" ? "▴" : "▾") : q.side === "left" ? (q.dir === "out" ? "‹" : "›") : (q.dir === "out" ? "›" : "‹"));
const glyphLabel = (q: Port): string => (q.side === "left" ? `${glyphOf(q)} ${q.label}` : `${q.label} ${glyphOf(q)}`);
const portWord = (q: Port): string => `${glyphLabel(q)} (${MEDIUM_WORD[q.medium]} ${q.dir})`;

// CONNECT BY CLICK (user, 2026-09-10): a right-click on a connector opens "Connect to …"; that ARMS the connector — every
// compatible connector on the sheet lights, the rest dim — and a click on a lit one draws the routed line. The nodes read
// the arm through a context so a handle knows whether it is the armed one, a taker, or neither.
interface Arm { node: string; port: string }
interface PortCtx { arm: Arm | null; takes: (n: AsmNode, q: Port) => boolean; onMenu: (n: AsmNode, q: Port, e: React.MouseEvent) => void; onPick: (n: AsmNode, q: Port, e: React.MouseEvent) => void;
  /** a card's connectors: read from its EnergyPlus class when it is a catalogue card, hand-shaped otherwise */
  ports: (n: AsmNode) => Port[];
  /** a card drawn at half width (a pump) */
  narrow: (n: AsmNode) => boolean;
  /** THE HOVER TIP (2026-09-13: native titles never showed inside the flow): a mark shows its words in the sheet's own tip; null hides it */
  tip: (e: React.MouseEvent | null, head?: string, lines?: TipLine[]) => void }
const PortContext = createContext<PortCtx>({ arm: null, takes: () => false, onMenu: () => undefined, onPick: () => undefined, ports: (n) => PORTS[n.kind], narrow: () => false, tip: () => undefined });

interface AsmData extends Record<string, unknown> { node: AsmNode; label: string; sub: string; refused: string[]; cautions: string[]; notWritten: string[]; qa: SystemQaRow[]; zones: string[]; rooms: string[]; onRoomOut: (id: string, room: string) => void; onToggle: (id: string) => void; onThermostat: (id: string) => void }
/** a line of a hover tip: the QA's own colours — ok, gap, n/a */
interface TipLine { kind: "ok" | "gap" | "na"; text: string }
type AsmFlowNode = Node<AsmData, "asm">;
interface EdgeData extends Record<string, unknown> { points?: XY[]; onPoints: (id: string, pts: XY[]) => void; onMenu: (id: string, x: number, y: number) => void }
type AsmFlowEdge = Edge<EdgeData, "ortho">;

function AsmNodeView(p: NodeProps<AsmFlowNode>): React.ReactElement {
  const d = p.data, n = d.node, loop = isLoop(n.kind);
  const ctx = useContext(PortContext);
  const ports = ctx.ports(n);
  const narrow = ctx.narrow(n);
  const { w, h } = nodeSize(n, ports, narrow);
  const bar = n.kind === "zone" ? zoneColor(n.id) : GROUP_COLOR[GROUP_OF[n.kind]];
  return (
    <div className={`asmNode${p.selected ? " sel" : ""}${d.refused.length ? " refused" : ""}${loop ? " loop" : ""}${n.kind === "zone" ? " zoneBox" : ""}${narrow ? " narrow" : ""}`} style={n.kind === "zone" ? { width: w, minHeight: h, borderColor: bar, borderLeftColor: bar } : { width: w, minHeight: h, borderLeftColor: bar }} title={d.refused.join("\n") || d.sub}>
      {/* a zone card SAYS it is one (user, 2026-10-16: "doesn't state what those cards represent") */}
      {n.kind === "zone" && <div className="asmKindTag" style={{ color: bar }} title="a thermal ZONE: its rooms run as one air volume on one thermostat; what joins its Loc (top) serves it">ZONE</div>}
      <div className="asmTitle">{d.label}</div>
      {n.ident && <div className="asmIdent" title="the component's ID">{n.ident}</div>}
      {n.kind === "zone" && (
        // THE THERMOSTAT (user, 2026-09-12): a T in a circle at the card's top right — on, the zone has the thermostat and controls
        // the unit that serves it; off (greyed), the zone is served, not controlled: it takes what the supply gives
        <button className={`asmTstat nodrag nopan${n.thermostat === false ? " off" : ""}`} onClick={(e) => { e.stopPropagation(); d.onThermostat(n.id); }}
          title={n.thermostat === false ? "thermostat OFF — no ZoneControl:Thermostat is written for the zone: under SetPoint control its damper holds its minimum and it reports no demand; under Load control it is served, not controlled. Click to switch on." : "thermostat ON — the zone reports its demand: under SetPoint control its own damper follows it and the neediest zone sets the unit's supply setpoint; under Load control it is the unit's control zone. Click to switch off."}>T</button>
      )}
      {n.kind === "zone" && (
        <div className={`asmRooms${n.collapsed ? " closed" : ""}`}>
          <button className="asmToggle nodrag nopan" style={{ color: bar }} onClick={(e) => { e.stopPropagation(); d.onToggle(n.id); }} title={n.collapsed ? "expand: list the rooms" : "collapse: count the rooms"}>{n.collapsed ? "▸" : "▾"} {d.rooms.length} room{d.rooms.length === 1 ? "" : "s"}</button>
          {!n.collapsed && d.rooms.map((r) => <div key={r} className="asmRoom"><span>{r}</span><button className="asmRoomX nodrag nopan" onClick={(e) => { e.stopPropagation(); d.onRoomOut(n.id, r); }} title="take this room out of the zone">×</button></div>)}
          {!n.collapsed && !d.rooms.length && <div className="asmRoomHint">drag rooms here from LEVELS · SPACES</div>}
        </div>
      )}
      {d.zones.length > 0 && n.kind !== "zone" && <div className="asmZones" title={d.zones.join(", ")}>serves {d.zones.length === 1 ? d.zones[0] : `${d.zones.slice(0, 2).join(", ")}${d.zones.length > 2 ? ` +${d.zones.length - 2}` : ""}`}</div>}
      {!!n.attached?.length && <div className="asmPills">{n.attached.map((a) => <span key={a} className="asmPill" title={ATTACH_LABEL[a]}>{ATTACH_LABEL[a]}</span>)}</div>}
      {d.refused.length > 0 && <span className="asmMark nodrag nopan" onMouseEnter={(e) => ctx.tip(e, "refused — nothing is written for this card until it is fixed", d.refused.map((t) => ({ kind: "gap" as const, text: t })))} onMouseLeave={() => ctx.tip(null)}>!</span>}
      {d.cautions.length > 0 && <span className="asmMark caution nodrag nopan" onMouseEnter={(e) => ctx.tip(e, "a caution — legal input the engine runs; read it", d.cautions.map((t) => ({ kind: "na" as const, text: t })))} onMouseLeave={() => ctx.tip(null)}>!</span>}
      {/* THE "NOT WRITTEN" MARK (2026-09-15): the SAVED model refused this card — drawn on the sheet, absent from the IDF; the reasons on hover, the fix on the sheet, then Save */}
      {d.notWritten.length > 0 && <span className="asmMark notWritten nodrag nopan" onMouseEnter={(e) => ctx.tip(e, "not written — the saved model refused this card: nothing of it is in the IDF. Fix it on the sheet, then Save", d.notWritten.map((t) => ({ kind: "gap" as const, text: t })))} onMouseLeave={() => ctx.tip(null)}>not written</span>}
      {d.qa.length > 0 && (() => {
        // THE QA ON THE CARD (2026-09-13): the model's rows for this card, read back from bem.db — sound, or the gaps counted; the rules on hover
        const gaps = d.qa.reduce((t, r) => t + r.gaps, 0);
        const lines: TipLine[] = d.qa.flatMap((r) => r.checks.map((c) => ({ kind: (c.verdict === "ok" ? "ok" : c.verdict === "gap" ? "gap" : "na") as TipLine["kind"], text: `${c.verdict === "ok" ? "✓" : c.verdict === "gap" ? "✗" : "–"} ${c.rule} · ${QA_RULES[c.rule]}${c.text ? ` — ${c.text}` : ""}` })));
        return <span className={`asmQa nodrag nopan ${gaps ? "gap" : "ok"}`} onMouseEnter={(e) => ctx.tip(e, `system QA · ${d.qa.map((r) => `${r.subject} [${r.kind}]`).join(", ")}: ${gaps ? `${gaps} gap${gaps === 1 ? "" : "s"}` : "sound on all eight rules"}`, lines)} onMouseLeave={() => ctx.tip(null)}>{gaps ? `✗ ${gaps}` : "✓"}</span>;
      })()}
      {ports.map((q) => {
        const top = q.side === "top";
        const y = portY(n, q.id, ports), x = portX(n, q.id, ports);
        const glyph = glyphOf(q);
        const from = ctx.arm?.node === n.id && ctx.arm.port === q.id;
        const state = ctx.arm ? (from ? " from" : ctx.takes(n, q) ? " can" : " cannot") : "";
        const title = ctx.arm ? (from ? "the connector being connected — click to cancel" : ctx.takes(n, q) ? `connect to ${portWord(q)}` : `${portWord(q)} — not compatible`) : `${portWord(q)} · right-click to connect`;
        const menu = (e: React.MouseEvent): void => ctx.onMenu(n, q, e);
        const pick = (e: React.MouseEvent): void => { if (ctx.arm) ctx.onPick(n, q, e); };
        return (
          <span key={q.id}>
            <Handle type={q.dir === "out" ? "source" : "target"} id={q.id} position={top ? Position.Top : q.side === "left" ? Position.Left : Position.Right} className={`asmPort ${q.medium} ${q.dir}${state}`} style={top ? { left: x } : { top: y }} title={title} isConnectableStart={!ctx.arm} onContextMenu={menu} onClick={pick} />
            <span className={`asmPortLabel ${q.side}${state}`} style={top ? { left: x } : { top: y }} title={title} onContextMenu={menu} onClick={pick}>{top ? `${glyph} ${q.label}` : q.side === "left" ? `${glyph} ${q.label}` : `${q.label} ${glyph}`}</span>
          </span>
        );
      })}
    </div>
  );
}
const nodeTypes = { asm: AsmNodeView };

/** the line: a thick stub out of the port, the orthogonal run, and — when the line is selected — a joint on EVERY segment
 *  between the stubs: an interior one shifts across itself (a vertical left or right, a horizontal up or down), an end one,
 *  tied to its port, bends into a jog on the first move and the drag goes on with the jog's middle run; the ends stay pinned
 *  to the stubs, collapsed runs are merged when the pointer lifts (user, 2026-09-10: "editable to shift them around with
 *  clean up on lines to maintain orthogonal"); a right-click on the line or a joint opens its menu */
function OrthoEdge(p: EdgeProps<AsmFlowEdge>): React.ReactElement {
  const rf = useReactFlow();
  const dirOf = (pos: Position): Dir => (pos === Position.Right ? "right" : pos === Position.Left ? "left" : pos === Position.Top ? "up" : "down");
  const sDir = dirOf(p.sourcePosition), tDir = dirOf(p.targetPosition), endIsH = sDir === "left" || sDir === "right";
  const drag = useRef<{ j: number; kind: "end" | "v" | "h" } | null>(null);
  const pts = routePoints([p.sourceX, p.sourceY], sDir, [p.targetX, p.targetY], tDir, p.data?.points, !!drag.current);
  const sp = pts[1]!, tp = pts[pts.length - 2]!, corners = pts.slice(2, -2), n = corners.length;
  const segs: XY[] = [sp, ...corners, tp];
  const stub = `M ${pts[0]![0]} ${pts[0]![1]} L ${sp[0]} ${sp[1]}`;
  // the drag listens on the DOCUMENT from a snapshot of the corners taken at the press, so it survives the re-renders its own
  // moves cause (a pointer capture on the joint was lost part-way, measured: 20 of 56 px) and never waits on React
  const onDown = (j: number) => (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const g = { j, kind: segmentKind(n, j, sDir), base: corners.map(([x, y]) => [x, y] as XY), moved: false, last: null as XY[] | null };
    drag.current = g;
    const onPoints = p.data?.onPoints, id = p.id, v0 = endIsH ? segs[j]![1] : segs[j]![0];
    const move = (ev: PointerEvent): void => {
      const f = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      let next: XY[];
      if (g.kind === "end") {
        const v = endIsH ? f.y : f.x;         // an end on a horizontal stub bends in y, one on a vertical stub in x
        if (Math.abs(v - v0) < 4) return;     // the first move away turns the end segment into a jog
        const atStart = g.j === 0;
        next = jogCorners(sp, g.base, tp, atStart, v, sDir);
        g.j = atStart ? 2 : g.base.length; g.kind = endIsH ? "h" : "v";
      } else next = shiftSegment(g.base, g.j, g.kind === "v" ? f.x : f.y, sDir);
      next = pinCorners(sp, sDir, next, tp, tDir);
      g.base = next; g.moved = true; g.last = next;
      onPoints?.(id, next);
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      drag.current = null;
      if (g.moved && g.last) onPoints?.(id, cleanCorners(g.last));
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  };
  const onMenu = (e: React.MouseEvent): void => { e.preventDefault(); e.stopPropagation(); p.data?.onMenu(p.id, e.clientX, e.clientY); };
  return (
    <>
      <BaseEdge id={p.id} path={orthoPathFrom(pts)} className="asmLine" />
      <path d={stub} className="asmStub" />
      {p.selected && (
        <EdgeLabelRenderer>
          {segs.slice(0, -1).map(([x0, y0], j) => {
            const [x1, y1] = segs[j + 1]!;
            if (Math.hypot(x1 - x0, y1 - y0) < 6) return null;
            const kind = segmentKind(n, j, sDir), vertical = kind === "v";
            return <div key={j} className={`asmJoint nopan nodrag${vertical ? " v" : " h"}${kind === "end" ? " end" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${(x0 + x1) / 2}px, ${(y0 + y1) / 2}px)` }} title={kind === "end" ? (endIsH ? "drag up or down to bend the line here" : "drag left or right to bend the line here") : vertical ? "drag left or right" : "drag up or down"} onPointerDown={onDown(j)} onContextMenu={onMenu} />;
          })}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { ortho: OrthoEdge };

export interface AssemblyProps {
  asm: Assembly; assign: ZoneAssign;
  onChange: (a: Assembly, assign?: ZoneAssign) => void;
  sel: string | null; onSel: (id: string | null) => void;
  compiled: Pick<CompiledAssembly, "refusals" | "cautions"> & Partial<Pick<CompiledAssembly, "zones">>;
  /** THE ELECTRICAL SHEET (2026-10-02) is this canvas with its own cards: no rooms dropped onto it, no MECHANICAL kinds in a card's
   *  "change to" list, its own words on an empty sheet */
  rooms?: boolean; paletteKinds?: boolean; emptyText?: React.ReactNode;
  /** the component catalogue: a card that IS an EnergyPlus class takes its connectors from it */
  catalogue?: Catalogue | null;
  /** the system QA's rows per card (2026-09-13), read back from bem.db through qaRowsByNode */
  qa?: Map<string, SystemQaRow[]>;
  /** THE "NOT WRITTEN" MARK (2026-09-15): what the SAVED model refused, per card (refusedByNode over bem.db's systems rows) */
  notWritten?: Map<string, string[]>;
  /** what the load moved or dropped on the sheet (a line on a connector this build no longer draws), shown once */
  migration?: string[];
  onMigrationSeen?: () => void;
}
/** a node's connectors — a catalogue card's read from its class, every other kind's hand-shaped */
const portsFor = (n: AsmNode, cat: Catalogue | null | undefined): Port[] => portsOfNode(n, cat ?? null);
/** one connector by its id (2026-09-12: a lookup by KIND alone was blind to a catalogue card, whose connectors come from its class) */
const portFor = (n: AsmNode, cat: Catalogue | null | undefined, id: string | undefined): Port | undefined => portsFor(n, cat).find((q) => q.id === id);

function Canvas(p: AssemblyProps): React.ReactElement {
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const label = (n: AsmNode): string => {
    if (n.kind !== "component") return n.label ?? NODE_LABEL[n.kind];
    const e = p.catalogue?.of(n.cls ?? ""), base = e?.narrow ?? n.label ?? e?.label ?? n.cls ?? "Component";
    return e?.tag && !base.includes(e.tag) ? `${base} · ${e.tag}` : base;
  };
  const sub = (n: AsmNode): string => classOf(n);
  // WHAT A CARD SERVES (2026-10-16): the ZONES tab's assignment AND every Zone card joined to it by Loc — the line drawn is a serving
  // too ("Ideal loads" serving two Zone cards read "serves —")
  const servedBy = (id: string): string[] => [...new Set([...zonesOf(p.assign, id), ...(p.compiled.zones ?? []).filter((z) => z.fedBy === id).map((z) => z.name)])];
  const refusedOf = useMemo(() => { const m = new Map<string, string[]>(); for (const r of p.compiled.refusals) (m.get(r.node) ?? m.set(r.node, []).get(r.node)!).push(r.text); return m; }, [p.compiled]);
  const cautionsOf = useMemo(() => { const m = new Map<string, string[]>(); for (const r of p.compiled.cautions) (m.get(r.node) ?? m.set(r.node, []).get(r.node)!).push(r.text); return m; }, [p.compiled]);
  const [tip, setTip] = useState<{ x: number; y: number; above: number | null; head: string; lines: TipLine[] } | null>(null);
  /** BELOW THE CARD (user, 2026-09-13: a tip at the pointer covered the card's other mark — a caution under a refusal could not be read): the tip sits
   *  under the card the mark belongs to, left-aligned with it, and moves ABOVE the card only when the sheet has no room below (the layout effect);
   *  at the pointer when no card is under the mark */
  const tipFn = useCallback((e: React.MouseEvent | null, head?: string, lines?: TipLine[]) => {
    if (!e) { setTip(null); return; }
    const r = wrap.current?.getBoundingClientRect(); const ox = r?.left ?? 0, oy = r?.top ?? 0;
    const card = (e.currentTarget as Element | null)?.closest(".asmNode")?.getBoundingClientRect() ?? null;
    setTip(card ? { x: card.left - ox, y: card.bottom - oy + 6, above: card.top - oy - 6, head: head ?? "", lines: lines ?? [] }
                : { x: e.clientX - ox + 14, y: e.clientY - oy + 14, above: null, head: head ?? "", lines: lines ?? [] });
  }, []);
  const tipEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {   // keep the tip inside the sheet: shifted left at the right edge; above the card when nothing fits below it
    const el = tipEl.current, w = wrap.current; if (!el || !w || !tip) return;
    let x = tip.x, y = tip.y; const tw = el.offsetWidth, th = el.offsetHeight;
    if (x + tw > w.clientWidth - 4) x = Math.max(4, w.clientWidth - 4 - tw);
    if (y + th > w.clientHeight - 4 && tip.above != null) y = Math.max(4, tip.above - th);
    el.style.left = `${x}px`; el.style.top = `${y}px`;
  }, [tip]);
  const narrowFn = useCallback((n: AsmNode): boolean => isNarrow(n, p.catalogue), [p.catalogue]);
  // the flow's nodes mirror the assembly; positions move locally while a drag is on and land in the assembly at its end
  const pRef = useRef(p); pRef.current = p;   // the node's own buttons act on the LIVE props, never the render they were made in
  const onRoomOut = useCallback((id: string, room: string) => { const q = pRef.current; q.onChange(removeRoom(q.asm, id, room)); }, []);
  const onToggle = useCallback((id: string) => { const q = pRef.current; q.onChange(toggleZone(q.asm, id)); }, []);
  const onThermostat = useCallback((id: string) => { const q = pRef.current; q.onChange(toggleThermostat(q.asm, id)); q.onSel(id); }, []);
  const toFlow = useCallback((a: Assembly, selected: string | null): AsmFlowNode[] => a.nodes.map((n) => ({
    id: n.id, type: "asm" as const, position: { x: n.x, y: n.y }, selected: n.id === selected,
    data: { node: n, label: label(n), sub: sub(n), refused: refusedOf.get(n.id) ?? [], cautions: cautionsOf.get(n.id) ?? [], notWritten: p.notWritten?.get(n.id) ?? [], qa: p.qa?.get(n.id) ?? [], zones: servedBy(n.id), rooms: n.rooms ?? [], onRoomOut, onToggle, onThermostat },
  })), [refusedOf, cautionsOf, p.qa, p.notWritten, p.assign, onRoomOut, onToggle, onThermostat]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes] = useState<AsmFlowNode[]>(() => toFlow(p.asm, p.sel));
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setNodes(toFlow(p.asm, p.sel)); }, [p.asm, p.sel, toFlow]);
  // A CLICK ON A CONNECTOR SELECTS THE CARD (2026-09-15; the user's quirk of 2026-09-14: on a zoomed-out sheet a click at a card's top
  // centre lands on its Loc connector's hit zone — React Flow starts a connection on the press and a release without a drag ends it
  // with nothing selected). The press is remembered; a release within 4 px that made no line is read as the click it was.
  const connStart = useRef<{ node: string; x: number; y: number } | null>(null);
  const pointOf = (e: MouseEvent | TouchEvent): { x: number; y: number } => ("clientX" in e ? { x: e.clientX, y: e.clientY } : { x: e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? 0, y: e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY ?? 0 });
  const onConnectStart = useCallback((e: MouseEvent | TouchEvent, st: { nodeId: string | null }) => { const q = pointOf(e); connStart.current = st.nodeId ? { node: st.nodeId, ...q } : null; }, []);
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent, st: { isValid: boolean | null }) => {
    const c = connStart.current; connStart.current = null;
    if (!c || st.isValid) return;
    const q = pointOf(e);
    if (Math.hypot(q.x - c.x, q.y - c.y) < 4) { setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === c.node }))); setArm(null); pRef.current.onSel(c.node); }
  }, [setNodes]);
  const onPoints = useCallback((id: string, pts: XY[]) => p.onChange(setEdgePoints(p.asm, id, pts)), [p]);
  const [arm, setArm] = useState<Arm | null>(null);
  const onEdgeMenu = useCallback((id: string, x: number, y: number) => {
    const e = p.asm.edges.find((z) => z.id === id); if (!e) return;
    setArm(null); p.onSel(id);
    setMenu({ x: Math.min(x, window.innerWidth - 260), y: Math.min(y, window.innerHeight - 160), edge: e });
  }, [p]);
  const edges: AsmFlowEdge[] = useMemo(() => p.asm.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.fromPort ?? null, targetHandle: e.toPort ?? null, type: "ortho" as const, selected: e.id === p.sel, data: { points: e.points, onPoints, onMenu: onEdgeMenu } })), [p.asm.edges, p.sel, onPoints, onEdgeMenu]);
  const onNodesChange = useCallback((changes: NodeChange<AsmFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) {
      if (c.type === "remove") p.onChange(removeNode(p.asm, c.id));
      if (c.type === "select" && c.selected) p.onSel(c.id);
      if (c.type === "select" && !c.selected && p.sel === c.id) p.onSel(null);
    }
  }, [p]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) {
      if (c.type === "remove") p.onChange(removeEdge(p.asm, c.id));
      if (c.type === "select" && c.selected) p.onSel(c.id);
    }
  }, [p]);
  // a line joins an OUT port to an IN port of a compatible medium, whichever end it was drawn from
  const portsOf = useCallback((c: Connection | { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
    const s = p.asm.nodes.find((n) => n.id === c.source), t = p.asm.nodes.find((n) => n.id === c.target);
    if (!s || !t || s.id === t.id) return null;
    const ps = portFor(s, p.catalogue, c.sourceHandle ?? undefined), pt = portFor(t, p.catalogue, c.targetHandle ?? undefined);
    return ps && pt ? { s, t, ps, pt } : null;
  }, [p.asm.nodes, p.catalogue]);
  const isValid: IsValidConnection<AsmFlowEdge> = useCallback((c) => { const r = portsOf(c); return !!r && compatible(r.ps, r.pt); }, [portsOf]);
  // stored out → in, whichever port the line was started from; the new line is selected so its joints show
  const join = useCallback((a: AsmNode, pa: Port, b: AsmNode, pb: Port): void => {
    const next = pa.dir === "out" ? addEdge(p.asm, a.id, b.id, pa.id, pb.id) : addEdge(p.asm, b.id, a.id, pb.id, pa.id);
    if (next === p.asm) return;
    const made = next.edges[next.edges.length - 1]!;
    p.onChange(next); p.onSel(made.id);
  }, [p]);
  const onConnect = useCallback((c: Connection) => {
    const r = portsOf(c);
    if (!r || !compatible(r.ps, r.pt)) return;
    join(r.s, r.ps, r.t, r.pt);
  }, [portsOf, join]);
  // connect by click: the menu on a connector, the arm, the pick
  const [menu, setMenu] = useState<{ x: number; y: number; port?: { node: AsmNode; port: Port }; edge?: AsmEdge; node?: AsmNode } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const armed = useMemo(() => { if (!arm) return null; const n = p.asm.nodes.find((x) => x.id === arm.node); const q = n && portFor(n, p.catalogue, arm.port); return n && q ? { n, q } : null; }, [arm, p.asm.nodes, p.catalogue]);
  useEffect(() => { if (arm && !armed) setArm(null); }, [arm, armed]);   // the armed node was removed
  const takes = useCallback((n: AsmNode, q: Port): boolean => !!armed && armed.n.id !== n.id && compatible(armed.q, q), [armed]);
  const targetsFor = useCallback((n: AsmNode, q: Port): number => p.asm.nodes.reduce((k, x) => (x.id === n.id ? k : k + portsFor(x, p.catalogue).filter((y) => compatible(q, y)).length), 0), [p.asm.nodes, p.catalogue]);
  const linesOn = useCallback((n: AsmNode, q: Port) => p.asm.edges.filter((e) => (e.from === n.id && e.fromPort === q.id) || (e.to === n.id && e.toPort === q.id)).map((e) => {
    const other = p.asm.nodes.find((x) => x.id === (e.from === n.id ? e.to : e.from));
    const op = other ? portFor(other, p.catalogue, e.from === n.id ? e.toPort : e.fromPort) : undefined;
    return { e, other, op };
  }), [p.asm, p.catalogue]);
  const onMenu = useCallback((n: AsmNode, q: Port, e: React.MouseEvent): void => {
    e.preventDefault(); e.stopPropagation();
    setArm(null);
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 160), port: { node: n, port: q } });
  }, []);
  const onPick = useCallback((n: AsmNode, q: Port, e: React.MouseEvent): void => {
    e.preventDefault(); e.stopPropagation();
    if (!armed) return;
    if (armed.n.id === n.id && armed.q.id === q.id) { setArm(null); return; }
    if (!takes(n, q)) return;
    join(armed.n, armed.q, n, q);
    setArm(null);
  }, [armed, takes, join]);
  const cardPorts = useCallback((n: AsmNode) => portsFor(n, p.catalogue), [p.catalogue]);
  // CHANGE A CARD IN PLACE (user, 2026-09-12): a right-click on a card lists what it can become — the id, position, ID and
  // lines kept, each line re-hung on the new card's matching connector; what cannot come along is said in the bar
  const [showMore, setShowMore] = useState(false);
  const [swapNote, setSwapNote] = useState<string | null>(null);
  useEffect(() => { if (!swapNote) return; const t = window.setTimeout(() => setSwapNote(null), 9000); return () => window.clearTimeout(t); }, [swapNote]);
  const onNodeMenu = useCallback((n: AsmNode, x: number, y: number): void => { setArm(null); setShowMore(false); setMenu({ x: Math.min(x, window.innerWidth - 300), y: Math.min(y, window.innerHeight - 360), node: n }); }, []);
  const swap = useCallback((n: AsmNode, to: Substitute): void => {
    const r = substitute(p.asm, n.id, { node: to.node, ...(to.cls ? { cls: to.cls } : {}), label: to.label }, p.catalogue ?? null);
    p.onChange(r.asm); p.onSel(n.id); setMenu(null);
    const kept = p.asm.edges.filter((e) => e.from === n.id || e.to === n.id).length - r.dropped.length;
    const named = (id: string): string => { const o = p.asm.nodes.find((x) => x.id === id); return o ? label(o) : id; };
    setSwapNote(`${label(n)} → ${to.label} · ${kept} line${kept === 1 ? "" : "s"} kept${r.dropped.length ? ` · dropped: ${r.dropped.map((d) => `the ${d.port} line to ${named(d.other)}`).join(", ")} (the new card has no such connector free)` : ""}${r.fieldsDropped.length ? ` · fields dropped: ${r.fieldsDropped.map((k) => k.replace(/_/g, " ")).join(", ")}` : ""}${r.attachmentsDropped.length ? ` · attachments dropped: ${r.attachmentsDropped.map((a) => ATTACH_LABEL[a]).join(", ")}` : ""}`);
  }, [p]);
  const portCtx = useMemo<PortCtx>(() => ({ arm, takes, onMenu, onPick, ports: cardPorts, narrow: narrowFn, tip: tipFn }), [arm, takes, onMenu, onPick, cardPorts, narrowFn, tipFn]);
  // the menu closes on a press outside it, a wheel, or Escape; Escape also disarms
  useEffect(() => {
    if (!menu && !arm) return;
    const down = (e: PointerEvent): void => { if (menu && !(e.target instanceof Element && menuRef.current?.contains(e.target))) setMenu(null); };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") { setMenu(null); setArm(null); } };
    const wheel = (): void => setMenu(null);
    document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key); document.addEventListener("wheel", wheel, { passive: true });
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); document.removeEventListener("wheel", wheel); };
  }, [menu, arm]);
  // a drop from the bench: an attachment onto the node under the pointer, a component at the point
  useEffect(() => {
    registerDropTarget((payload: DragPayload, cx: number, cy: number) => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
      // A ROOM from the level tree (2026-09-10): onto a Zone it joins it; onto the sheet it makes a Zone holding it
      if ("room" in payload) {
        if (p.rooms === false) return;
        const el = document.elementFromPoint(cx, cy)?.closest<HTMLElement>(".react-flow__node");
        const id = el?.dataset.id;
        const n = id ? p.asm.nodes.find((x) => x.id === id) : null;
        if (n?.kind === "zone") { p.onChange(addRoom(p.asm, n.id, payload.room)); p.onSel(n.id); return; }
        const pos = rf.screenToFlowPosition({ x: cx, y: cy });
        const made = addNode(p.asm, { node: "zone", label: "Zone" }, pos.x, pos.y);
        p.onChange(addRoom(made.asm, made.id, payload.room)); p.onSel(made.id);
        return;
      }
      if (payload.item.attach) {
        const el = document.elementFromPoint(cx, cy)?.closest<HTMLElement>(".react-flow__node");
        const id = el?.dataset.id;
        const n = id ? p.asm.nodes.find((x) => x.id === id) : null;
        const what = ATTACH_LABEL[payload.item.attach];
        // A REFUSED DROP SAYS WHY on the sheet (2026-10-03: the ERV tile vanished on the user's heat pumps with no word)
        if (!n) { setSwapNote(`${what}: drop it ONTO a card — it is part of a system, not a card of its own`); return; }
        const hr = payload.item.attach === "hr-enthalpy" || payload.item.attach === "hr-sensible" ? payload.item.attach : null;
        if (hr && n.kind === "component") {
          const r = recoveryOnUnit(p.asm, n.id, hr);
          if ("refused" in r) { setSwapNote(r.refused); p.onSel(n.id); return; }
          p.onChange(r.asm); p.onSel(r.id);
          setSwapNote(`${what}: a heat-recovery core on ${label(n)}'s outdoor-air intake — its inputs are in the column`);
          return;
        }
        const v = attachVerdict(n.kind, payload.item.attach);
        if (v.refused) { setSwapNote(v.refused); p.onSel(n.id); return; }
        p.onChange(attach(p.asm, n.id, payload.item.attach)); p.onSel(n.id);
        return;
      }
      const pos = rf.screenToFlowPosition({ x: cx, y: cy });
      if (payload.item.node) { const { asm, id } = addNode(p.asm, { node: payload.item.node as NodeKind, label: payload.item.label, ...(payload.item.cls ? { cls: payload.item.cls } : {}) }, pos.x, pos.y); p.onChange(asm); p.onSel(id); }
    });
    return () => registerDropTarget(null);
  }, [p, rf]);
  useEffect(() => { registerFit(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 200 })); return () => registerFit(null); }, [rf]);
  const empty = p.asm.nodes.length === 0;
  const targets = menu?.port ? targetsFor(menu.port.node, menu.port.port) : 0;
  return (
    <div className={`asmWrap${arm ? " arming" : ""}`} ref={wrap}>
      <PortContext.Provider value={portCtx}>
      <ReactFlow<AsmFlowNode, AsmFlowEdge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValid}
        onConnectStart={onConnectStart} onConnectEnd={onConnectEnd}
        onNodeDragStart={() => { dragging.current = true; }}
        onNodeDragStop={(_e, n) => { dragging.current = false; p.onChange(moveNode(p.asm, n.id, n.position.x, n.position.y)); }}
        onPaneClick={() => { p.onSel(null); setArm(null); }}
        onEdgeContextMenu={(e, edge) => { e.preventDefault(); onEdgeMenu(edge.id, e.clientX, e.clientY); }}
        onNodeContextMenu={(e, node) => { e.preventDefault(); const n = p.asm.nodes.find((x) => x.id === node.id); if (n && n.kind !== "zone") onNodeMenu(n, e.clientX, e.clientY); }}
        connectionMode={ConnectionMode.Loose} connectionRadius={14} connectOnClick={false}
        snapToGrid snapGrid={[8, 8]} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.25} maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]} selectionKeyCode={null} multiSelectionKeyCode={null}
        nodesConnectable elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="#d3d9e2" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      </PortContext.Provider>
      {menu?.port && (
        <div className="ctxMenu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctxHead">{portWord(menu.port.port)} · {label(menu.port.node)}</div>
          <button disabled={targets === 0} title={targets ? `then click the connector it should reach — the ${targets} compatible one${targets === 1 ? "" : "s"} light` : `no compatible connector on the sheet — drop a component with a ${MEDIUM_WORD[menu.port.port.medium]} ${menu.port.port.dir === "out" ? "in" : "out"}-port first`}
            onClick={() => { setArm({ node: menu.port!.node.id, port: menu.port!.port.id }); setMenu(null); }}>Connect to …</button>
          {linesOn(menu.port.node, menu.port.port).map(({ e, other, op }) => (
            <button key={e.id} onClick={() => { p.onChange(removeEdge(p.asm, e.id)); if (p.sel === e.id) p.onSel(null); setMenu(null); }} title="remove this line">Disconnect from {other ? label(other) : e.from === menu.port!.node.id ? e.to : e.from}{op ? ` (${op.label} ${op.dir})` : ""}</button>
          ))}
        </div>
      )}
      {menu?.edge && (() => {
        const e = menu.edge, a = p.asm.nodes.find((x) => x.id === e.from), b = p.asm.nodes.find((x) => x.id === e.to);
        const pa = a && portFor(a, p.catalogue, e.fromPort), pb = b && portFor(b, p.catalogue, e.toPort);
        return (
          <div className="ctxMenu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={(ev) => ev.preventDefault()}>
            <div className="ctxHead">{a ? label(a) : e.from}{pa ? ` ${glyphLabel(pa)}` : ""} → {b ? label(b) : e.to}{pb ? ` ${glyphLabel(pb)}` : ""}</div>
            <button onClick={() => { p.onChange(removeEdge(p.asm, e.id)); if (p.sel === e.id) p.onSel(null); setMenu(null); }} title="remove this connector — the two components stay">Delete connector</button>
            <button disabled={!e.points} onClick={() => { p.onChange(setEdgePoints(p.asm, e.id, [])); setMenu(null); }} title={e.points ? "drop the corners you dragged; the sheet routes the line again" : "the sheet routes this line already"}>Route by the sheet</button>
          </div>
        );
      })()}
      {menu?.node && (() => {
        const n = menu.node;
        const subs = substitutesFor(p.asm, n.id, p.catalogue ?? null, p.paletteKinds !== false);
        const nLines = p.asm.edges.filter((e) => e.from === n.id || e.to === n.id).length;
        const fits = subs.filter((x) => x.drops.length === 0), rest = subs.filter((x) => x.drops.length > 0);
        const row = (x: Substitute): React.ReactElement => (
          <button key={`${x.node}:${x.cls ?? ""}`} onClick={() => swap(n, x)} title={`${x.cls ?? NODE_CLASS[x.node]} — ${x.sub}${x.drops.length ? `\ndrops ${x.drops.length} line${x.drops.length === 1 ? "" : "s"}: ${x.drops.map((d) => d.port).join(", ")}` : nLines ? `\nkeeps all ${nLines} line${nLines === 1 ? "" : "s"}` : ""}`}>
            {x.label} <span className="ctxDim">· {x.group.toLowerCase()}{x.tier === "component" ? "" : x.tier === "kind" ? " · template" : ` · ${x.tier}`}{x.drops.length ? ` · drops ${x.drops.length}` : ""}</span>
          </button>
        );
        let lastGroup = "";
        const grouped = fits.flatMap((x) => { const head = x.group !== lastGroup ? [<div key={`g:${x.group}`} className="ctxGroup">{x.group}</div>] : []; lastGroup = x.group; return [...head, row(x)]; });
        return (
          <div className="ctxMenu long" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={(ev) => ev.preventDefault()}>
            <div className="ctxHead">{label(n)} · {classOf(n) || NODE_CLASS[n.kind]}</div>
            {(n.kind === "terminal" || (n.kind === "component" && (n.cls ?? "").startsWith("AirTerminal:"))) && (() => {
              // THE FOLD (user, 2026-09-13): the Zone's Air in is the terminal — every terminal card between one unit and one Zone folds into its Zone
              const f = foldTerminals(p.asm, p.assign);
              return <button className="ctxFold" disabled={!f.folded.length} onClick={() => { p.onChange(f.asm, f.assign); p.onSel(null); setMenu(null); setSwapNote(`folded ${f.folded.join(", ")} into ${f.folded.length === 1 ? "its Zone" : "their Zones"} — each unit's Air out now runs straight to the Zone, the damper's class kept on the Zone${f.left.length ? ` · left as drawn: ${f.left.join(", ")}` : ""}`); }} title="the Zone's Air in is the terminal now: the card goes, its unit's line runs to its Zone, its damper's class becomes the Zone's setting">Fold {f.folded.length} terminal card{f.folded.length === 1 ? "" : "s"} into {f.folded.length === 1 ? "its Zone" : "their Zones"}</button>;
            })()}
            <div className="ctxSub">change to — its {nLines} line{nLines === 1 ? "" : "s"}, ID and place are kept; a line the new card cannot take is named</div>
            {grouped}
            {!fits.length && <div className="ctxSub">nothing takes every line of this card</div>}
            {rest.length > 0 && <button className="ctxMore" onClick={(ev) => { ev.stopPropagation(); setShowMore(!showMore); }}>{showMore ? "fewer" : `${rest.length} more that drop a line…`}</button>}
            {showMore && rest.map(row)}
            <div className="ctxFoot"><button onClick={() => { p.onChange(removeNode(p.asm, n.id)); if (p.sel === n.id) p.onSel(null); setMenu(null); }} title="remove the card and its lines">Remove {label(n)}</button></div>
          </div>
        );
      })()}
      {tip && (
        <div className="asmTip" ref={tipEl} style={{ left: tip.x, top: tip.y }}>
          <div className="tipHead">{tip.head}</div>
          {tip.lines.map((l, i) => <div key={i} className={l.kind === "ok" ? "tipOk" : l.kind === "gap" ? "tipGap" : "tipNa"}>{l.text}</div>)}
        </div>
      )}
      {!!p.migration?.length && (
        <div className="asmMigration" title="a connector this build no longer draws: the line moved to what it meant, or was dropped and named">
          <b>on load:</b> {p.migration.join(" · ")} <button className="chip" onClick={p.onMigrationSeen}>ok</button>
        </div>
      )}
      {swapNote && (
        <div className="asmArm asmSwapNote" title="what the change kept and what it could not">
          {swapNote}
          <button onClick={() => setSwapNote(null)}>ok</button>
        </div>
      )}
      {armed && (
        <div className="asmArm">
          <b>Connect</b> <i>{portWord(armed.q)}</i> of <i>{label(armed.n)}</i> to … — click a lit connector · Esc cancels
          <button onClick={() => setArm(null)}>cancel</button>
        </div>
      )}
      {empty && p.emptyText && <div className="asmEmpty">{p.emptyText}</div>}
      {empty && !p.emptyText && (
        <div className="asmEmpty">
          <div><b>MECHANICAL — the assembly</b></div>
          <div>drag a component from the shelf below onto this sheet, and rooms from LEVELS · SPACES into a Zone. Each has its connectors: water on the left, air on the right, the arrow the flow's direction. Draw a line from an out-port to a compatible in-port — or right-click a connector, <b>Connect to …</b>, and click the connector it should reach. Select a line to drag its segments (an end segment bends into a new jog); right-click a line to delete it. Drop a coil onto a system to set its coil.</div>
          <div className="muted">the zones a component serves are assigned in ZONES; nothing drawn here changes the model until Apply.</div>
        </div>
      )}
    </div>
  );
}

export function SystemsAssembly(p: AssemblyProps): React.ReactElement {
  return <ReactFlowProvider><Canvas {...p} /></ReactFlowProvider>;
}
