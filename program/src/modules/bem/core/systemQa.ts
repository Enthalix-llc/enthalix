// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SYSTEM QA (user, 2026-09-11: the wiring generated, "but we need to develop a QA approach that identifies missing
// elements — for example, water connections need a pump in the system connections either side of the flow direction").
//
// The per-wall QA's discipline applied to systems: one row per loop, per air loop and per zone on real equipment, each of
// the eight rules of references/energyplus-systems-modelling.md §4 given a verdict and, where it fails, WHAT IS MISSING —
// in words a person can act on. It repairs nothing.
//
// It reads the IDF AS WRITTEN — the text the engine will read — parsed back and keyed by the engine's own schema, never the
// generator's in-memory intent. That is the same choice wall_qa made (the DB rows, not the pipeline), and for the same reason:
// the instrument must read what a downstream reads. A template object (HVACTemplate:*) gets its plumbing from the expansion
// and is reported as such, not checked; an ideal-loads zone is the writer's default and says so.

import type { EpSchema, EpClass } from "./epSchema.js";
import { parseIdfObjects, type IdfObject } from "./idfLib.js";

export type QaVerdict = "ok" | "gap" | "n/a";
export interface QaCheck { rule: number; verdict: QaVerdict; text: string }
export type QaKind = "plant loop" | "condenser loop" | "air loop" | "zone" | "template" | "ideal loads" | "loose" | "zones";
export interface SystemQaRow {
  /** the loop's, air loop's or zone's emitted name */
  subject: string;
  kind: QaKind;
  cls: string;
  checks: QaCheck[];
  gaps: number;
}
export interface SystemQaCtx {
  /** the conditioned zones by their EMITTED names (the writer's zoneRows carry both) */
  conditioned: string[];
}
/** the rules, numbered as the report numbers them */
export const QA_RULES: Record<number, string> = {
  1: "a fluid loop has a pump on its supply side",
  2: "every node named is named twice — nothing dangles",
  3: "both sides of a loop are populated",
  4: "producers on supply, consumers on demand; every water side on a loop",
  5: "an air loop has its supply path, its return path and a terminal per zone",
  6: "a zone with equipment has one list and its connections; every conditioned zone has something",
  7: "every control has its setpoint",
  8: "sizing once for every zone, air loop and plant loop",
};

/** a field of a written object, keyed through the schema: `base` is the schema's key, `key` carries the group index for an extensible */
interface KeyedField { key: string; base: string; value: string }
interface Keyed { o: IdfObject; fields: KeyedField[]; get: (base: string, k?: number) => string }

const NODE_FIELD = /(inlet|outlet)(_\d+)?_node(_or_nodelist)?_names?$/;
const ZONE_OWN_NODE = /^(zone_air_exhaust_node_or_nodelist_name|zone_return_air_node_or_nodelist_name)$/;
/** the outdoor-air system's own namings (2026-09-13): the mixer's four streams, the controller's actuator, the outdoor node list — node fields whose names say neither inlet nor outlet */
const OA_NODE_FIELD = /^(mixed_air_node_name|outdoor_air_stream_node_name|relief_air_stream_node_name|return_air_stream_node_name|return_air_node_name|actuator_node_name|node_or_nodelist_name)$/;
/** what produces heat or cold for a loop — stands on its SUPPLY side (the engine's own grouping, by class prefix) */
const PRODUCER = /^(Boiler:|Chiller:|CoolingTower:|GroundHeatExchanger:|HeatPump:|WaterHeater:|District(Heating|Cooling)|EvaporativeFluidCooler:|FluidCooler:|SolarCollector:|HeatExchanger:FluidToFluid|PlantComponent:|ThermalStorage:|CentralHeatPumpSystem)/;
/** what consumes from a loop — its DEMAND side */
const CONSUMER = /^(Coil:|ZoneHVAC:Baseboard:.*:Water|ZoneHVAC:LowTemperatureRadiant|WaterUse:Connections|ZoneHVAC:CoolingPanel|Refrigeration:)/;
const PLUMBING = /^(Pipe:|Pump:|HeaderedPumps:)/;
/** classes a reference is never followed into when gathering a subject's members */
const NOT_A_MEMBER = /^(Zone$|ZoneList$|Schedule:|ScheduleTypeLimits$|Curve:|Table:|Site:|Construction|Material|Building|Output:|Sizing:|Space)/;

/** every written object keyed by the schema's fixed fields, then its extensible group cycled */
function keyAll(objects: IdfObject[], schema: EpSchema): Keyed[] {
  const out: Keyed[] = [];
  for (const o of objects) {
    const c: EpClass | null = schema.classOf(o.cls);
    const fields: KeyedField[] = o.fields.map((value, i) => {
      if (!c) return { key: `f${i}`, base: `f${i}`, value };
      if (i < c.fields.length) return { key: c.fields[i]!.key, base: c.fields[i]!.key, value };
      const ext = c.extensibles;
      if (!ext || !ext.length) return { key: `f${i}`, base: `f${i}`, value };
      const j = i - c.fields.length, k = Math.floor(j / ext.length) + 1, base = ext[j % ext.length]!;
      return { key: `${base}#${k}`, base, value };
    });
    const get = (base: string, k?: number): string => fields.find((f) => (k === undefined ? f.key === base : f.key === `${base}#${k}`))?.value ?? "";
    out.push({ o, fields, get });
  }
  return out;
}
/** the values of an extensible base across the groups, in order */
const groupValues = (k: Keyed, base: string): string[] => k.fields.filter((f) => f.base === base && f.key !== base).map((f) => f.value);
/** the node names an object names as connections (inlets and outlets, never a setpoint reference or the zone's air node) */
const nodeFields = (k: Keyed): KeyedField[] => k.fields.filter((f) => f.value && (NODE_FIELD.test(f.base) || ZONE_OWN_NODE.test(f.base) || OA_NODE_FIELD.test(f.base)));

export function systemQa(idf: string, schema: EpSchema, ctx: SystemQaCtx): SystemQaRow[] {
  const all = keyAll(parseIdfObjects(idf, "qa"), schema);
  const byCls = (re: RegExp | string): Keyed[] => all.filter((k) => (typeof re === "string" ? k.o.cls === re : re.test(k.o.cls)));
  const byName = new Map<string, Keyed[]>();
  for (const k of all) { const l = byName.get(k.o.name) ?? []; l.push(k); byName.set(k.o.name, l); }
  const find = (cls: string, name: string): Keyed | null => (byName.get(name) ?? []).find((k) => k.o.cls === cls) ?? null;
  const exists = (name: string, re?: RegExp): boolean => (byName.get(name) ?? []).some((k) => !re || re.test(k.o.cls));

  // ── the node ledger: who names each node, as a connection
  const named = new Map<string, Keyed[]>();
  for (const k of all) for (const f of nodeFields(k)) { const l = named.get(f.value) ?? []; l.push(k); named.set(f.value, l); }
  // the OUTDOORS is named once by design (2026-09-13): a node declared outdoor (OutdoorAir:NodeList / OutdoorAir:Node) and a heat-recovery core's exhaust outlet, which goes outside
  const outdoors = new Set<string>();
  for (const k of all) {
    if (k.o.cls === "OutdoorAir:NodeList" || k.o.cls === "OutdoorAir:Node") for (const f of k.fields) if (f.value) outdoors.add(f.value);
    if (/^HeatExchanger:AirToAir:/.test(k.o.cls)) { const v = k.get("exhaust_air_outlet_node_name"); if (v) outdoors.add(v); }
  }
  const dangling = new Set<string>();
  for (const [n, who] of named) {
    // a zone's own return and exhaust nodes are named by its EquipmentConnections and, when nothing collects them, by nothing else — by design
    if (who.length === 1 && !(who[0]!.o.cls === "ZoneHVAC:EquipmentConnections") && !outdoors.has(n)) dangling.add(n);
  }

  // ── branches: what each holds, and whether it agrees with the component it holds
  interface Comp { cls: string; name: string; inlet: string; outlet: string }
  const branchComps = (b: Keyed): Comp[] => {
    const out: Comp[] = [];
    const n = Math.max(0, ...b.fields.filter((f) => f.base === "component_name").map((f) => Number(f.key.split("#")[1] ?? 0)));
    for (let i = 1; i <= n; i++) out.push({ cls: b.get("component_object_type", i), name: b.get("component_name", i), inlet: b.get("component_inlet_node_name", i), outlet: b.get("component_outlet_node_name", i) });
    return out.filter((c) => c.name);
  };
  const branchAgrees = (b: Keyed): string[] => {
    const gaps: string[] = [];
    for (const c of branchComps(b)) {
      const k = find(c.cls, c.name);
      if (!k) { gaps.push(`branch "${b.o.name}" holds ${c.cls} "${c.name}", which is not written`); continue; }
      let ins = nodeFields(k).filter((f) => /inlet/.test(f.base)).map((f) => f.value), outs = nodeFields(k).filter((f) => /outlet/.test(f.base)).map((f) => f.value);
      // an outdoor-air system has no node fields of its own: it enters at its mixer's return stream and leaves at its mixed air (2026-09-13)
      if (k.o.cls === "AirLoopHVAC:OutdoorAirSystem") {
        const eq = find("AirLoopHVAC:OutdoorAirSystem:EquipmentList", k.get("outdoor_air_equipment_list_name"));
        const mixerName = eq ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [eq.get(`component_${i}_object_type`), eq.get(`component_${i}_name`)]).find(([t]) => t === "OutdoorAir:Mixer")?.[1] ?? "" : "";
        const mx = mixerName ? find("OutdoorAir:Mixer", mixerName) : null;
        ins = mx ? [mx.get("return_air_stream_node_name")] : []; outs = mx ? [mx.get("mixed_air_node_name")] : [];
        if (!mx) gaps.push(`outdoor-air system "${c.name}" has no OutdoorAir:Mixer in its equipment list "${k.get("outdoor_air_equipment_list_name") || "(none named)"}" — nothing mixes the outdoor air into the return`);
      }
      if (!ins.includes(c.inlet)) gaps.push(`branch "${b.o.name}" says "${c.name}" enters at "${c.inlet}"; the ${c.cls} names no such inlet`);
      if (!outs.includes(c.outlet)) gaps.push(`branch "${b.o.name}" says "${c.name}" leaves at "${c.outlet}"; the ${c.cls} names no such outlet`);
    }
    return gaps;
  };
  const branchesOf = (listName: string): Keyed[] => {
    const l = find("BranchList", listName);
    return l ? groupValues(l, "branch_name").map((n) => find("Branch", n)).filter((b): b is Keyed => !!b) : [];
  };

  // ── members of a subject: every object reached from its roots by name reference (a loop → its lists → its branches → their
  //    components → their fans and coils), so a dangling node is reported on the row that names it
  const membersOf = (roots: Keyed[]): Set<Keyed> => {
    const seen = new Set<Keyed>(roots);
    const queue = [...roots];
    while (queue.length) {
      const k = queue.shift()!;
      for (const f of k.fields) {
        if (!/_names?$/.test(f.base) || NODE_FIELD.test(f.base) || OA_NODE_FIELD.test(f.base) || !f.value) continue;
        for (const t of byName.get(f.value) ?? []) if (!seen.has(t) && !NOT_A_MEMBER.test(t.o.cls)) { seen.add(t); queue.push(t); }
      }
    }
    return seen;
  };
  const danglingIn = (members: Set<Keyed>): string[] => {
    const out = new Set<string>();
    for (const k of members) for (const f of nodeFields(k)) if (dangling.has(f.value)) out.add(f.value);
    return [...out];
  };
  const claimed = new Set<Keyed>();
  const rows: SystemQaRow[] = [];
  const row = (subject: string, kind: QaKind, cls: string, checks: QaCheck[]): void => { rows.push({ subject, kind, cls, checks, gaps: checks.filter((c) => c.verdict === "gap").length }); };
  const ok = (rule: number, text: string): QaCheck => ({ rule, verdict: "ok", text });
  const gap = (rule: number, text: string): QaCheck => ({ rule, verdict: "gap", text });
  const na = (rule: number, text: string): QaCheck => ({ rule, verdict: "n/a", text });
  const nodeCheck = (members: Set<Keyed>): QaCheck => {
    const d = danglingIn(members);
    return d.length ? gap(2, `named once, joined to nothing: ${d.map((n) => `"${n}"`).join(", ")}`) : ok(2, `${[...members].reduce((t, k) => t + nodeFields(k).length, 0)} node namings, every node named twice`);
  };
  const setpointOn = (node: string): Keyed | null => byCls(/^SetpointManager:/).find((s) => s.get("setpoint_node_or_nodelist_name") === node) ?? null;
  const list = (xs: string[]): string => xs.map((x) => `"${x}"`).join(", ");

  // ── FLUID LOOPS
  for (const L of byCls(/^(PlantLoop|CondenserLoop)$/)) {
    const cond = L.o.cls === "CondenserLoop";
    const id = L.o.name;
    const supList = L.get(cond ? "condenser_side_branch_list_name" : "plant_side_branch_list_name"), demList = L.get(cond ? "condenser_demand_side_branch_list_name" : "demand_side_branch_list_name");
    const sup = branchesOf(supList), dem = branchesOf(demList);
    const supComps = sup.flatMap(branchComps), demComps = dem.flatMap(branchComps);
    const checks: QaCheck[] = [];
    // 1 · the pump: on the supply inlet branch (the splitter's inlet branch, else the list's first), or one on every parallel branch
    // the ConnectorList is NOT extensible in the schema: two fixed slots, connector_1 and connector_2
    const supConn = find("ConnectorList", L.get(cond ? "condenser_side_connector_list_name" : "plant_side_connector_list_name"));
    const splitterName = supConn ? [1, 2].map((i) => [supConn.get(`connector_${i}_object_type`), supConn.get(`connector_${i}_name`)]).find(([t]) => t === "Connector:Splitter")?.[1] ?? "" : "";
    const splitter = find("Connector:Splitter", splitterName);
    // the supply inlet branch: the one the splitter is fed by, else the first the branch list names (written or not)
    const supListObj = find("BranchList", supList);
    const inletBranchName = splitter?.get("inlet_branch_name") || (supListObj ? groupValues(supListObj, "branch_name")[0] ?? "" : "");
    const inletBranch = sup.find((b) => b.o.name === inletBranchName) ?? null;
    const pumpsOn = (b: Keyed): Comp[] => branchComps(b).filter((c) => /^(Pump:|HeaderedPumps:)/.test(c.cls));
    const inletPumps = inletBranch ? pumpsOn(inletBranch) : [];
    const parallel = splitter ? groupValues(splitter, "outlet_branch_name").map((n) => sup.find((b) => b.o.name === n)).filter((b): b is Keyed => !!b) : [];
    const demandPumps = dem.flatMap(pumpsOn);
    if (!sup.length) checks.push(gap(1, `no supply branch list ("${supList || "none named"}") — the loop has no supply side to put a pump on`));
    else if (inletPumps.length) checks.push(ok(1, `pump on the supply inlet branch: ${inletPumps.map((p) => `${p.name} (${p.cls})`).join(", ")}`));
    else if (parallel.length && parallel.every((b) => pumpsOn(b).length)) checks.push(ok(1, `a pump on each of the ${parallel.length} parallel supply branches`));
    else if (demandPumps.length) checks.push(gap(1, `the only pump is on the DEMAND side (${demandPumps.map((p) => p.name).join(", ")}) — a loop's pump belongs on its supply inlet branch, upstream of what produces`));
    else if (inletBranchName && !inletBranch) checks.push(gap(1, `the supply inlet branch "${inletBranchName}" is named but not written — a fluid loop needs a pump on it; without one no water moves`));
    else checks.push(gap(1, `no pump on the supply side — a fluid loop needs one on its supply inlet branch ("${inletBranchName}"), or one per parallel supply branch; without it no water moves`));
    // 2 · the nodes, and the branches agreeing with what they hold
    const members = membersOf([L]);
    for (const b of [...sup, ...dem]) members.add(b);
    for (const k of members) claimed.add(k);
    const bg = [...sup, ...dem].flatMap(branchAgrees);
    const nc = nodeCheck(members);
    checks.push(bg.length ? gap(2, `${bg.join("; ")}${nc.verdict === "gap" ? `; ${nc.text}` : ""}`) : nc);
    // 3 · both sides populated
    const producers = supComps.filter((c) => !PLUMBING.test(c.cls)), consumers = demComps.filter((c) => !PLUMBING.test(c.cls));
    if (!producers.length && !consumers.length) checks.push(gap(3, "nothing on either side — no source, no use"));
    else if (!producers.length) checks.push(gap(3, `nothing produces on the supply side (only ${supComps.length ? "pipes and the pump" : "an empty list"}) — the loop has no source of heat or cold`));
    else if (!consumers.length) checks.push(gap(3, `nothing on the demand side (only ${demComps.length ? "pipes" : "an empty list"}) — the loop serves nothing`));
    else checks.push(ok(3, `supply: ${producers.map((c) => c.name).join(", ")} · demand: ${consumers.map((c) => c.name).join(", ")}`));
    // 4 · producers on supply, consumers on demand, and the equipment list dispatching every producer
    const wrongSup = supComps.filter((c) => CONSUMER.test(c.cls)), wrongDem = demComps.filter((c) => PRODUCER.test(c.cls));
    const eqList = find(cond ? "CondenserEquipmentList" : "PlantEquipmentList", `${id} Equipment`) ?? byCls(cond ? "CondenserEquipmentList" : "PlantEquipmentList").find((e) => groupValues(e, "equipment_name").some((n) => producers.some((p) => p.name === n))) ?? null;
    const dispatched = eqList ? groupValues(eqList, "equipment_name") : [];
    const undispatched = producers.filter((p) => PRODUCER.test(p.cls) && !dispatched.includes(p.name));
    const g4: string[] = [];
    if (wrongSup.length) g4.push(`${wrongSup.map((c) => `${c.name} (${c.cls})`).join(", ")} consumes and sits on the SUPPLY side`);
    if (wrongDem.length) g4.push(`${wrongDem.map((c) => `${c.name} (${c.cls})`).join(", ")} produces and sits on the DEMAND side`);
    if (!eqList && producers.length) g4.push(`no ${cond ? "CondenserEquipmentList" : "PlantEquipmentList"} names the producers — the operation scheme dispatches nothing`);
    else if (undispatched.length) g4.push(`${undispatched.map((c) => c.name).join(", ")} on the supply side but not in the equipment list "${eqList!.o.name}" — never dispatched`);
    checks.push(g4.length ? gap(4, g4.join("; ")) : ok(4, `producers on supply, consumers on demand; the equipment list dispatches ${dispatched.length}`));
    checks.push(na(5, "not an air loop"));
    checks.push(na(6, "not a zone"));
    // 7 · the loop's setpoint node has a manager; the operation scheme exists
    const spNode = L.get(cond ? "condenser_loop_temperature_setpoint_node_name" : "loop_temperature_setpoint_node_name");
    const sp = spNode ? setpointOn(spNode) : null;
    const scheme = find(cond ? "CondenserEquipmentOperationSchemes" : "PlantEquipmentOperationSchemes", L.get(cond ? "condenser_equipment_operation_scheme_name" : "plant_equipment_operation_scheme_name"));
    const g7: string[] = [];
    if (!spNode) g7.push("no setpoint node named on the loop");
    else if (!sp) g7.push(`no SetpointManager on the loop's setpoint node "${spNode}" — the loop has no temperature to hold`);
    if (!scheme) g7.push(`no ${cond ? "CondenserEquipmentOperationSchemes" : "PlantEquipmentOperationSchemes"} "${L.get(cond ? "condenser_equipment_operation_scheme_name" : "plant_equipment_operation_scheme_name") || "(none named)"}"`);
    checks.push(g7.length ? gap(7, g7.join("; ")) : ok(7, `${sp!.o.cls} on "${spNode}" · operation scheme "${scheme!.o.name}"`));
    // 8 · one Sizing:Plant
    const sz = byCls("Sizing:Plant").filter((s) => s.get("plant_or_condenser_loop_name") === id);
    checks.push(sz.length === 1 ? ok(8, `Sizing:Plant once (${sz[0]!.get("loop_type")})`) : sz.length ? gap(8, `Sizing:Plant ${sz.length} times — the engine takes one`) : gap(8, "no Sizing:Plant — the autosized pump and flows have nothing to size from"));
    row(id, cond ? "condenser loop" : "plant loop", L.o.cls, checks);
  }

  // ── AIR LOOPS
  const terminalOfInlet = (node: string): Keyed[] => byCls(/^AirTerminal:/).filter((t) => nodeFields(t).some((f) => /inlet/.test(f.base) && f.value === node));
  const zoneOfConnections = (c: Keyed): string => c.get("zone_name");
  const connections = byCls("ZoneHVAC:EquipmentConnections");
  const zoneBehindTerminal = (t: Keyed): { zone: string; gaps: string[] } => {
    const gaps: string[] = [];
    const adu = byCls("ZoneHVAC:AirDistributionUnit").find((a) => a.get("air_terminal_name") === t.o.name);
    if (!adu) return { zone: "", gaps: [`terminal "${t.o.name}" is wrapped by no ZoneHVAC:AirDistributionUnit`] };
    const lists = byCls("ZoneHVAC:EquipmentList").filter((l) => groupValues(l, "zone_equipment_name").includes(adu.o.name));
    if (lists.length !== 1) return { zone: "", gaps: [`ADU "${adu.o.name}" is in ${lists.length ? `${lists.length} equipment lists` : "no zone's equipment list"}`] };
    const conn = connections.filter((c) => c.get("zone_conditioning_equipment_list_name") === lists[0]!.o.name);
    if (conn.length !== 1) return { zone: "", gaps: [`equipment list "${lists[0]!.o.name}" belongs to ${conn.length ? `${conn.length} zones` : "no zone's EquipmentConnections"}`] };
    return { zone: zoneOfConnections(conn[0]!), gaps };
  };
  for (const A of byCls("AirLoopHVAC")) {
    const id = A.o.name;
    const checks: QaCheck[] = [];
    checks.push(na(1, "not a fluid loop"));
    const branches = branchesOf(A.get("branch_list_name"));
    const members = membersOf([A]);
    for (const b of branches) members.add(b);
    // 5 · the paths and the terminals
    const demIn = A.get("demand_side_inlet_node_names"), demOut = A.get("demand_side_outlet_node_name");
    const supPath = byCls("AirLoopHVAC:SupplyPath").filter((p) => p.get("supply_air_path_inlet_node_name") === demIn);
    const retPath = byCls("AirLoopHVAC:ReturnPath").filter((p) => p.get("return_air_path_outlet_node_name") === demOut);
    const g5: string[] = [];
    if (supPath.length !== 1) g5.push(supPath.length ? `${supPath.length} supply paths start at "${demIn}"` : `no AirLoopHVAC:SupplyPath starts at the loop's demand inlet "${demIn}" — supply air reaches no zone`);
    if (retPath.length !== 1) g5.push(retPath.length ? `${retPath.length} return paths end at "${demOut}"` : `no AirLoopHVAC:ReturnPath ends at the loop's demand outlet "${demOut}" — return air comes from nowhere`);
    const splitters = supPath.flatMap((p) => groupValues(p, "component_name").map((n, i) => find(groupValues(p, "component_object_type")[i] ?? "", n)).filter((k): k is Keyed => !!k && k.o.cls === "AirLoopHVAC:ZoneSplitter"));
    const mixers = retPath.flatMap((p) => groupValues(p, "component_name").map((n, i) => find(groupValues(p, "component_object_type")[i] ?? "", n)).filter((k): k is Keyed => !!k && k.o.cls === "AirLoopHVAC:ZoneMixer"));
    for (const k of [...supPath, ...retPath, ...splitters, ...mixers]) members.add(k);
    const fedZones: string[] = [], terminals: Keyed[] = [];
    for (const s of splitters) for (const out of groupValues(s, "outlet_node_name")) {
      const ts = terminalOfInlet(out);
      if (!ts.length) { g5.push(`splitter outlet "${out}" feeds no air terminal`); continue; }
      if (ts.length > 1) g5.push(`splitter outlet "${out}" feeds ${ts.length} terminals (${ts.map((t) => t.o.name).join(", ")})`);
      for (const t of ts) {
        terminals.push(t); members.add(t);
        const feeders = byCls("AirLoopHVAC:ZoneSplitter").filter((q) => groupValues(q, "outlet_node_name").some((n) => nodeFields(t).some((f) => /inlet/.test(f.base) && f.value === n)));
        if (feeders.length > 1) g5.push(`terminal "${t.o.name}" is fed by ${feeders.length} air loops' splitters — a terminal belongs to one`);
        const z = zoneBehindTerminal(t);
        g5.push(...z.gaps);
        if (z.zone) fedZones.push(z.zone);
      }
    }
    const returned: string[] = [];
    for (const m of mixers) for (const inn of groupValues(m, "inlet_node_name")) {
      const c = connections.find((q) => q.get("zone_return_air_node_or_nodelist_name") === inn);
      if (!c) g5.push(`mixer inlet "${inn}" is no zone's return node`); else returned.push(zoneOfConnections(c));
    }
    const fedSet = new Set(fedZones), retSet = new Set(returned);
    const notReturned = [...fedSet].filter((z) => !retSet.has(z)), notFed = [...retSet].filter((z) => !fedSet.has(z));
    if (notReturned.length) g5.push(`fed but not collected by the return path: ${list(notReturned)}`);
    if (notFed.length) g5.push(`collected by the return path but fed by no terminal: ${list(notFed)}`);
    if (!terminals.length && !g5.some((x) => /feeds no air terminal|no AirLoopHVAC:SupplyPath/.test(x))) g5.push("no terminal — the loop reaches no zone");
    checks.push(g5.length ? gap(5, g5.join("; ")) : ok(5, `supply and return paths, ${terminals.length} terminal${terminals.length === 1 ? "" : "s"} → ${[...fedSet].join(", ")}`));
    // 2 · the nodes and the branches
    for (const k of members) claimed.add(k);
    const bg = branches.flatMap(branchAgrees);
    const nc = nodeCheck(members);
    checks.splice(1, 0, bg.length ? gap(2, `${bg.join("; ")}${nc.verdict === "gap" ? `; ${nc.text}` : ""}`) : nc);
    // 3 · the supply branch holds something that conditions air
    const comps = branches.flatMap(branchComps).filter((c) => !PLUMBING.test(c.cls));
    checks.splice(2, 0, comps.length ? ok(3, `supply branch: ${comps.map((c) => `${c.name} (${c.cls})`).join(", ")}`) : gap(3, "no component on the supply branch — nothing heats, cools or moves the air"));
    // 4 · the water side of every coil in the loop is on some plant loop's demand branch
    const waterUsers = [...members].filter((k) => nodeFields(k).some((f) => /water_inlet/.test(f.base)));
    const onDemand = new Set(byCls(/^(PlantLoop|CondenserLoop)$/).flatMap((L) => branchesOf(L.get(L.o.cls === "CondenserLoop" ? "condenser_demand_side_branch_list_name" : "demand_side_branch_list_name")).flatMap(branchComps).map((c) => c.name)));
    const unplumbed = waterUsers.filter((k) => !onDemand.has(k.o.name));
    checks.splice(3, 0, unplumbed.length ? gap(4, `${unplumbed.map((k) => `${k.o.name} (${k.o.cls})`).join(", ")} take${unplumbed.length === 1 ? "s" : ""} water and stand${unplumbed.length === 1 ? "s" : ""} on no plant loop's demand branch — connect the water side to a loop`)
      : waterUsers.length ? ok(4, `${waterUsers.length} water side${waterUsers.length === 1 ? "" : "s"} on a loop's demand branch`) : na(4, "no water side"));
    checks.push(na(6, "not a zone"));
    // 7 · availability managers; a SetPoint-controlled unit: EACH COIL's control node — its own outlet when a manager names it,
    //     else the unit's outlet — must be named by a SetpointManager (UnitarySystem.cc checkNodeSetPoint, per coil); and an EMS
    //     actuator on a node no manager names sets a temperature the unit never reads — its control node is bound by managers
    //     alone (SetPointManager.cc NodeHasSPMCtrlVarType; 2026-09-13)
    const g7: string[] = [];
    const aml = A.get("availability_manager_list_name");
    if (aml && !find("AvailabilityManagerAssignmentList", aml)) g7.push(`availability manager list "${aml}" is not written`);
    let coilsHeld = 0;
    for (const u of [...members].filter((k) => k.o.cls === "AirLoopHVAC:UnitarySystem" && k.get("control_type") === "SetPoint")) {
      const outNode = u.get("air_outlet_node_name");
      for (const [tk, nk, word] of [["cooling_coil_object_type", "cooling_coil_name", "cooling coil"], ["heating_coil_object_type", "heating_coil_name", "heating coil"], ["supplemental_heating_coil_object_type", "supplemental_heating_coil_name", "supplemental coil"]] as const) {
        const coil = u.get(nk) ? find(u.get(tk), u.get(nk)) : null;
        if (!coil) continue;
        const coilOut = nodeFields(coil).find((f) => /air_outlet/.test(f.base))?.value ?? "";
        if ((coilOut && setpointOn(coilOut)) || setpointOn(outNode)) coilsHeld++;
        else g7.push(`"${u.o.name}" is SetPoint-controlled and no SetpointManager names its ${word}'s outlet "${coilOut}" or the unit's outlet "${outNode}" — the ${word} has no temperature to hold`);
      }
    }
    const nodesHere = new Set([...members].flatMap((k) => nodeFields(k).map((f) => f.value)));
    const actuators = byCls("EnergyManagementSystem:Actuator").filter((a) => a.get("actuated_component_type") === "System Node Setpoint" && nodesHere.has(a.get("actuated_component_unique_name")));
    for (const a of actuators) {
      const node = a.get("actuated_component_unique_name");
      members.add(a); claimed.add(a);
      if (!setpointOn(node)) g7.push(`the arbiter's actuator "${a.o.name}" sets "${node}", which no SetpointManager names — the unit's control node is bound by a manager alone, so the actuator sets a temperature nothing reads`);
    }
    checks.push(g7.length ? gap(7, g7.join("; ")) : ok(7, `${aml ? `availability managers "${aml}"` : "no availability list (the engine's default: always on)"}${coilsHeld ? ` · ${coilsHeld} coil${coilsHeld === 1 ? "" : "s"} under SetPoint control, each with a manager on its outlet${actuators.length ? ` · the changeover arbiter's ${actuators.length} actuators on managed nodes` : ""}` : [...members].some((k) => k.o.cls === "AirLoopHVAC:UnitarySystem") ? " · the unit's control has what it needs" : ""}`));
    // 8 · one Sizing:System
    const sz = byCls("Sizing:System").filter((s) => s.get("airloop_name") === id);
    checks.push(sz.length === 1 ? ok(8, "Sizing:System once") : sz.length ? gap(8, `Sizing:System ${sz.length} times`) : gap(8, "no Sizing:System — the autosized coils and fan have nothing to size from"));
    row(id, "air loop", A.o.cls, checks);
  }

  // ── ZONES ON REAL EQUIPMENT
  const templateZones = new Map<string, string[]>();   // zone → template classes on it
  for (const t of byCls(/^HVACTemplate:Zone:/)) { const z = t.get("zone_name"); const l = templateZones.get(z) ?? []; l.push(t.o.cls); templateZones.set(z, l); }
  const realZones = new Map<string, Keyed[]>();
  for (const c of connections) { const z = zoneOfConnections(c); const l = realZones.get(z) ?? []; l.push(c); realZones.set(z, l); }
  const thermostatOf = (z: string): Keyed | null => byCls("ZoneControl:Thermostat").find((t) => t.get("zone_or_zonelist_name") === z) ?? null;
  for (const [z, conns] of realZones) {
    const checks: QaCheck[] = [];
    const c = conns[0]!;
    const members = membersOf(conns);
    for (const k of members) claimed.add(k);
    checks.push(na(1, "not a fluid loop"));
    checks.push(nodeCheck(members));
    checks.push(na(3, "not a loop"));
    checks.push(na(4, "not a loop"));
    checks.push(na(5, "not an air loop"));
    // 6 · one connections object, its list, every listed item written
    const g6: string[] = [];
    if (conns.length > 1) g6.push(`${conns.length} ZoneHVAC:EquipmentConnections for one zone — the engine takes one`);
    const listName = c.get("zone_conditioning_equipment_list_name");
    const l = find("ZoneHVAC:EquipmentList", listName);
    if (!l) g6.push(`equipment list "${listName || "(none named)"}" is not written`);
    else {
      const types = groupValues(l, "zone_equipment_object_type"), names = groupValues(l, "zone_equipment_name");
      if (!names.filter(Boolean).length) g6.push(`equipment list "${l.o.name}" is empty`);
      names.forEach((n, i) => { if (n && !find(types[i] ?? "", n)) g6.push(`listed ${types[i] ?? "?"} "${n}" is not written`); });
      const inlet = c.get("zone_air_inlet_node_or_nodelist_name");
      if (inlet && (named.get(inlet)?.length ?? 0) < 2) g6.push(`the zone's inlet "${inlet}" is delivered by nothing`);
    }
    if (templateZones.has(z)) g6.push(`the zone also carries ${templateZones.get(z)!.join(", ")} — the expansion writes a second equipment list, which is a Severe`);
    checks.push(g6.length ? gap(6, g6.join("; ")) : ok(6, `${l ? groupValues(l, "zone_equipment_name").filter(Boolean).map((n, i) => `${n} (${groupValues(l, "zone_equipment_object_type")[i]})`).join(", ") : ""}`));
    // 7 · a thermostat with its schedules — or, SERVED AND NOT CONTROLLED: a zone fed by an air loop whose parent names ANOTHER
    //     zone as its controlling zone lawfully has none (the engine's HeatPump.idf shape; the user's T-off, 2026-09-12)
    const t = thermostatOf(z);
    const g7: string[] = [];
    const controllerOf = (): string | null => {
      for (const u of [...members].filter((k) => /^AirLoopHVAC:Unitary/.test(k.o.cls))) { const cz = u.get("controlling_zone_or_thermostat_location"); if (cz && cz !== z) return `${u.o.name} → ${cz}`; }
      // the parent is reached through the air loop's branch, not the zone's members: find the terminal's loop by node
      const adu = byCls("ZoneHVAC:AirDistributionUnit").filter((a) => (l ? groupValues(l, "zone_equipment_name").includes(a.o.name) : false));
      for (const a of adu) {
        const term = find(a.get("air_terminal_object_type"), a.get("air_terminal_name"));
        const inlet = term ? nodeFields(term).find((f) => /inlet/.test(f.base))?.value : "";
        const spl = byCls("AirLoopHVAC:ZoneSplitter").find((q) => groupValues(q, "outlet_node_name").includes(inlet ?? ""));
        const path = spl ? byCls("AirLoopHVAC:SupplyPath").find((p) => groupValues(p, "component_name").includes(spl.o.name)) : null;
        const loop = path ? byCls("AirLoopHVAC").find((A) => A.get("demand_side_inlet_node_names") === path.get("supply_air_path_inlet_node_name")) : null;
        const parent = loop ? branchesOf(loop.get("branch_list_name")).flatMap(branchComps).map((c) => find(c.cls, c.name)).find((k): k is Keyed => !!k && /^AirLoopHVAC:Unitary/.test(k.o.cls)) : null;
        const cz = parent?.get("controlling_zone_or_thermostat_location");
        if (parent && cz && cz !== z) return `${parent.o.name} → ${cz}`;
      }
      return null;
    };
    const ctrlBy = t ? null : controllerOf();
    if (!t && ctrlBy) g7.push("");   // placeholder, replaced below
    else if (!t) g7.push("no ZoneControl:Thermostat — the equipment has no setpoint to meet");
    else {
      const cts = t.get("control_type_schedule_name");
      if (!exists(cts, /^Schedule:/)) g7.push(`control type schedule "${cts}" is not written`);
      const ctl = find(t.get("control_1_object_type"), t.get("control_1_name"));
      if (!ctl) g7.push(`control "${t.get("control_1_name")}" (${t.get("control_1_object_type")}) is not written`);
      else for (const f of ctl.fields) if (/schedule_name$/.test(f.base) && f.value && !exists(f.value, /^Schedule:/)) g7.push(`${ctl.o.cls}'s ${f.base.replace(/_/g, " ")} "${f.value}" is not written`);
      // THE THERMOSTAT ASKS ONLY FOR WHAT THE EQUIPMENT CAN GIVE (user, 2026-09-14): heating-only equipment (a baseboard, a unit heater) under
      // a live cooling setpoint would count every warm hour as unmet cooling — the writer puts that side out of reach (≥ 45 °C), and this reads it
      const eqCls = l ? groupValues(l, "zone_equipment_object_type").filter(Boolean) : [];
      const heatOnly = eqCls.length > 0 && eqCls.every((k) => /^ZoneHVAC:(Baseboard|UnitHeater)/.test(k));
      if (ctl && heatOnly) {
        if (ctl.o.cls === "ThermostatSetpoint:SingleCooling") g7.push(`asks for cooling its equipment cannot give (${eqCls.join(", ")} heats only)`);
        else if (ctl.o.cls === "ThermostatSetpoint:DualSetpoint") {
          const cs = find("Schedule:Constant", ctl.get("cooling_setpoint_temperature_schedule_name"));
          const v = cs ? Number(cs.get("hourly_value")) : NaN;
          if (!cs || !(v >= 45)) g7.push(`asks for cooling${cs ? ` at ${v} °C` : ""} its equipment cannot give (${eqCls.join(", ")} heats only) — put the cooling setpoint out of reach`);
        }
      }
    }
    checks.push(!t && ctrlBy ? ok(7, `served, not controlled — no thermostat by design; the unit follows its control zone (${ctrlBy})`) : g7.length ? gap(7, g7.join("; ")) : ok(7, `${t!.get("control_1_object_type")} with its schedules`));
    // 8 · one Sizing:Zone
    const sz = byCls("Sizing:Zone").filter((s) => s.get("zone_or_zonelist_name") === z);
    checks.push(sz.length === 1 ? ok(8, "Sizing:Zone once") : sz.length ? gap(8, `Sizing:Zone ${sz.length} times — the engine takes one`) : gap(8, "no Sizing:Zone — the autosized equipment has no design load"));
    row(z, "zone", "ZoneHVAC:EquipmentConnections", checks);
  }

  // ── TEMPLATES and IDEAL LOADS: the expansion supplies their plumbing; said, not checked
  const byTemplate = new Map<string, string[]>();
  for (const [z, clss] of templateZones) for (const cls of clss) { const l = byTemplate.get(cls) ?? []; l.push(z); byTemplate.set(cls, l); }
  for (const [cls, zs] of byTemplate) {
    const ideal = cls === "HVACTemplate:Zone:IdealLoadsAirSystem";
    const dup = zs.filter((z) => byCls("Sizing:Zone").filter((s) => s.get("zone_or_zonelist_name") === z).length > (ideal ? 1 : 0));
    const checks: QaCheck[] = [1, 2, 3, 4, 5].map((r) => na(r, "the expansion writes it"));
    checks.push(ok(6, `${zs.length} zone${zs.length === 1 ? "" : "s"}: ${zs.join(", ")}`));
    checks.push(na(7, ideal ? "the template's thermostat" : "the expansion writes it"));
    checks.push(dup.length ? gap(8, `Sizing:Zone written for ${list(dup)} as well — the expansion writes its own, and a second is a Severe`) : ideal ? ok(8, "Sizing:Zone once per zone (the writer's; the expansion writes none for this template)") : na(8, "the expansion writes it"));
    row(cls.replace(/^HVACTemplate:Zone:/, ""), ideal ? "ideal loads" : "template", cls, checks);
  }
  for (const t of byCls(/^HVACTemplate:(System|Plant):/)) {
    const checks: QaCheck[] = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => na(r, "the expansion writes it"));
    row(t.o.name, "template", t.o.cls, checks);
  }

  // ── EVERY CONDITIONED ZONE HAS SOMETHING, and nothing is written that belongs to no subject
  {
    const cond = ctx.conditioned;
    const none = cond.filter((z) => !realZones.has(z) && !templateZones.has(z));
    const checks: QaCheck[] = [1, 2, 3, 4, 5].map((r) => na(r, ""));
    checks.push(none.length ? gap(6, `conditioned and on nothing — no equipment, no template, no ideal loads: ${list(none)}`)
      : ok(6, `${cond.length} conditioned zones: real equipment ${cond.filter((z) => realZones.has(z)).length} · template ${cond.filter((z) => templateZones.has(z) && !templateZones.get(z)!.includes("HVACTemplate:Zone:IdealLoadsAirSystem")).length} · ideal loads ${cond.filter((z) => templateZones.get(z)?.includes("HVACTemplate:Zone:IdealLoadsAirSystem")).length}`));
    checks.push(na(7, ""));
    checks.push(na(8, ""));
    row("conditioned zones", "zones", "Zone", checks);
    // equipment written that no loop, air loop or zone reaches — a coil or a ground heat exchanger on nothing
    const loose = all.filter((k) => !claimed.has(k) && (PRODUCER.test(k.o.cls) || CONSUMER.test(k.o.cls) || /^(Fan:|Pump:|AirTerminal:|ZoneHVAC:(?!Equipment)|AirLoopHVAC:Unitary)/.test(k.o.cls)) && !/^(ZoneHVAC:EquipmentList|ZoneHVAC:EquipmentConnections)$/.test(k.o.cls));
    if (loose.length) {
      const checks2: QaCheck[] = [1, 2, 3, 5, 6, 7, 8].map((r) => na(r, ""));
      checks2.splice(3, 0, gap(4, `written but reached by no loop, air loop or zone: ${loose.map((k) => `${k.o.name} (${k.o.cls})`).join(", ")}${loose.some((k) => nodeFields(k).some((f) => dangling.has(f.value))) ? " — its nodes are named once" : ""}`));
      row("loose equipment", "loose", "", checks2);
    }
  }
  return rows;
}

/** one line per row, the way the gate and the column print it: the subject, its kind, and each rule's verdict or gap */
export function formatSystemQa(rows: SystemQaRow[]): string[] {
  return rows.map((r) => `${r.subject} [${r.kind}] · ${r.gaps ? `${r.gaps} gap${r.gaps === 1 ? "" : "s"}` : "sound"}: ${r.checks.map((c) => `${c.rule}${c.verdict === "ok" ? "✓" : c.verdict === "gap" ? `✗ ${c.text}` : "–"}`).join(" · ")}`);
}
