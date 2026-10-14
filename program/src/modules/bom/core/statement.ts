// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A UTILITY BILL AS THE UTILITY PRINTS IT: three usage rows (consumption, generation, net), the charges in groups and lines, and a
// dialog that lets the user define their own bill's layout. A FORMAT says what a utility's bill holds — its usage rows, its charge
// groups and lines, how each line is figured and what carries to the next month; a STATEMENT is one bill typed from paper. Every
// charge is editable each month, the previous month's RATES are carried unless overwritten (a power cost adjustment moves monthly),
// and taxes are typed and, until typed, estimated from the previous month's amounts. Nothing here is assumed: the arithmetic is the
// bill's own (qty × rate to the cent), the total is checked against the Current Charges printed, and a carried or estimated value
// says so until the user types it. Pure.

import type { BillRow } from "./csvRead.js";
import { parseCsv } from "./csvRead.js";

export type UsageRole = "consumption" | "generation" | "net";
export const USAGE_ROLES: UsageRole[] = ["consumption", "generation", "net"];
export const ROLE_WORDS: Record<UsageRole, string> = {
  consumption: "delivered by the grid (less than the house's use: some PV is used on site)",
  generation: "sent to the grid (less than the PV produced: some is used on site)",
  net: "consumption − generation: what the energy charges are figured on",
};
export interface UsageRowDef { role: UsageRole; label: string; kw: boolean }

/** how a line is figured: a fixed $ a month · a rate per kWh of a usage row · a rate per kW of a usage row · an amount typed (a tax) */
export type LineBasis = "fixed" | "per-kwh" | "per-kw" | "amount";
export const BASIS_WORDS: Record<LineBasis, string> = { fixed: "$ a month", "per-kwh": "per kWh", "per-kw": "per kW", amount: "an amount typed" };
/** a block of a tiered rate: the rate applies to the kWh up to `upTo` (the rest of the block's kWh), the last block open (null) */
export interface Tier { upTo: number | null; rate: number }
/** a quantity priced block by block */
export function tieredAmount(qty: number, tiers: Tier[]): number {
  let left = qty, from = 0, sum = 0;
  for (const t of tiers) {
    const span = t.upTo === null ? left : Math.max(0, Math.min(left, t.upTo - from));
    sum += span * t.rate; left -= span; from = t.upTo ?? from;
    if (left <= 0) break;
  }
  return sum;
}

export interface LineDef {
  id: string; label: string; basis: LineBasis;
  /** a tiered rate (a consumption tax) — used while no flat rate is typed or derived */
  tiers?: Tier[]; tierSource?: string;
  /** the usage row a per-kWh / per-kW line is figured on (net by default) */
  of?: UsageRole;
  /** what the next month starts from: the RATE (a $ or a $/unit) or the AMOUNT (estimated until typed) */
  carry: "rate" | "amount";
  /** the power cost adjustment — its rate becomes the tariff's PCA for the bill's month */
  pca?: boolean;
}
export interface GroupDef { id: string; label: string; lines: LineDef[] }
export interface BillFormat { id: string; utility: string; schedule: string; service: string; usage: UsageRowDef[]; groups: GroupDef[] }

/** THE DEFAULT BILL LAYOUT: a residential electric bill with net metering in its commonest arrangement — delivery, supply, taxes and
 *  other charges. The user renames, adds or removes groups and lines in the bill-format dialog to match their own bill. */
export const DEFAULT_BILL_FORMAT: BillFormat = {
  id: "default", utility: "", schedule: "Residential with net metering", service: "",
  usage: [
    { role: "consumption", label: "Consumption", kw: false },
    { role: "generation", label: "Generation", kw: false },
    { role: "net", label: "Net", kw: true },
  ],
  groups: [
    { id: "delivery", label: "Delivery Service", lines: [
      { id: "access", label: "Customer Charge", basis: "fixed", carry: "rate" },
      { id: "energy-delivery", label: "Energy Delivery Charge", basis: "per-kwh", of: "net", carry: "rate" },
      { id: "demand-delivery", label: "Demand Charge", basis: "per-kw", of: "net", carry: "rate" },
    ] },
    { id: "supply", label: "Supply Service", lines: [
      { id: "energy", label: "Energy Charge", basis: "per-kwh", of: "net", carry: "rate" },
      { id: "pca", label: "Power Cost Adjustment", basis: "per-kwh", of: "net", carry: "rate", pca: true },
    ] },
    { id: "taxes", label: "Taxes", lines: [
      { id: "state-tax", label: "State Tax", basis: "amount", carry: "amount" },
      { id: "local-tax", label: "Local Tax", basis: "amount", carry: "amount" },
    ] },
    { id: "other", label: "Other Charges and Credits", lines: [] },
  ],
};

export interface Usage { kwh: number | null; kw: number | null }
export interface StatementLine {
  id: string; group: string; label: string; basis: LineBasis; of?: UsageRole; carry: "rate" | "amount"; pca?: boolean;
  /** a quantity typed over the usage row's (null = the row's) */
  qty: number | null;
  /** $ for a fixed line, $/kWh or $/kW for a per-unit line */
  rate: number | null;
  /** an amount typed — a tax, or a printed amount over qty × rate */
  amount: number | null;
  /** the rate came from the previous bill and has not been typed on this one */
  carried?: boolean;
  /** the amount is the previous bill's, standing in until typed */
  estimated?: boolean;
  /** the rate worked out from the amount typed on this bill (amount ÷ quantity) */
  derived?: boolean;
  /** a rate copied once from the later bill an earlier month was made from — this bill's own, shown dim until typed */
  copied?: boolean;
  /** a charge or credit on THIS bill alone (a late charge, a one-time credit): its reason and amount typed, never carried to another month */
  oneOff?: boolean;
  tiers?: Tier[]; tierSource?: string;
}
export interface Statement {
  id: string; format: string; meter: string; service: string;
  /** ISO dates as printed; days = to − from (the meter is read on both days) */
  from: string; to: string; billingDate: string;
  usage: Record<UsageRole, Usage>;
  bank: { before: number | null; used: number | null; after: number | null };
  groups: Array<{ id: string; label: string }>;
  lines: StatementLine[];
  /** the Current Charges as printed */
  stated: number | null;
}
export interface StatementsLedger { formats: BillFormat[]; bills: Statement[]; at: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const dayMs = 86_400_000;
const addDays = (iso: string, k: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + k * dayMs).toISOString().slice(0, 10);

/** the days a bill states: to − from (a bill printed 08/14 → 09/14 states 31) */
export const statementDays = (s: Pick<Statement, "from" | "to">): number | null =>
  ISO.test(s.from) && ISO.test(s.to) && s.to > s.from ? Math.round((Date.parse(`${s.to}T00:00:00Z`) - Date.parse(`${s.from}T00:00:00Z`)) / dayMs) : null;

/** a usage row as the bill reads it: typed, or — the Net's kWh — Consumption − Generation when both are typed (2026-10-09: "Consumption
 *  and Generation values compute Net, but energy delivery charge did not show that value") */
export function usageOf(s: Statement, role: UsageRole): Usage {
  const u = s.usage[role];
  if (role !== "net" || u.kwh !== null) return u;
  const c = s.usage.consumption.kwh, g = s.usage.generation.kwh;
  return { kwh: c !== null && g !== null ? c - g : null, kw: u.kw };
}
/** a line as figured: its quantity, the rate it is figured at (typed, derived, carried, or the first block of its tiers), its amount
 *  (null when it cannot be figured yet) */
export function lineFigures(line: StatementLine, s: Statement): { qty: number | null; unit: string; rate: number | null; tiered: boolean; amount: number | null } {
  if (line.basis === "amount") return { qty: null, unit: "", rate: null, tiered: false, amount: line.amount };
  if (line.basis === "fixed") return { qty: null, unit: "", rate: line.rate, tiered: false, amount: line.amount ?? line.rate };
  const u = usageOf(s, line.of ?? "net");
  const qty = line.qty ?? (line.basis === "per-kwh" ? u.kwh : u.kw);
  const unit = line.basis === "per-kwh" ? "kWh" : "kW";
  const tiered = line.rate === null && !!line.tiers?.length;
  const rate = line.rate ?? (tiered ? line.tiers![0]!.rate : null);
  if (line.amount !== null) return { qty, unit, rate, tiered, amount: line.amount };
  if (qty === null) return { qty, unit, rate, tiered, amount: null };
  if (line.rate !== null) return { qty, unit, rate, tiered, amount: round2(qty * line.rate) };
  return { qty, unit, rate, tiered, amount: tiered ? round2(tieredAmount(qty, line.tiers!)) : null };
}
export function groupSubtotals(s: Statement): Array<{ id: string; label: string; total: number; open: number }> {
  return s.groups.map((g) => {
    let total = 0, open = 0;
    for (const l of s.lines.filter((x) => x.group === g.id)) { const a = lineFigures(l, s).amount; if (a === null) open++; else total += a; }
    return { id: g.id, label: g.label, total: round2(total), open };
  });
}
/** the Detail of Charges summed; `open` lines not figured yet */
export function statementTotal(s: Statement): { total: number; open: number; estimated: number } {
  const g = groupSubtotals(s);
  return { total: round2(g.reduce((t, x) => t + x.total, 0)), open: g.reduce((t, x) => t + x.open, 0), estimated: s.lines.filter((l) => l.estimated).length };
}
/** the total against the Current Charges printed */
export function checkStated(s: Statement): { ok: boolean | null; diff: number } {
  if (s.stated === null) return { ok: null, diff: 0 };
  const diff = round2(statementTotal(s).total - s.stated);
  return { ok: Math.abs(diff) <= 0.01, diff };
}

/** a line of the format, empty */
const emptyLine = (g: GroupDef, d: LineDef): StatementLine => ({ id: d.id, group: g.id, label: d.label, basis: d.basis, ...(d.of ? { of: d.of } : {}), carry: d.carry, ...(d.pca ? { pca: true } : {}),
  ...(d.tiers ? { tiers: d.tiers, ...(d.tierSource ? { tierSource: d.tierSource } : {}) } : {}), qty: null, rate: null, amount: null });
const emptyUsage = (): Record<UsageRole, Usage> => ({ consumption: { kwh: null, kw: null }, generation: { kwh: null, kw: null }, net: { kwh: null, kw: null } });
let seq = 0;
const newId = (): string => `bill-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** the first bill of a format: every line empty */
export function newStatement(f: BillFormat, meter = ""): Statement {
  return { id: newId(), format: f.id, meter, service: f.service, from: "", to: "", billingDate: "", usage: emptyUsage(), bank: { before: null, used: null, after: null },
    groups: f.groups.map((g) => ({ id: g.id, label: g.label })), lines: f.groups.flatMap((g) => g.lines.map((d) => emptyLine(g, d))), stated: null };
}
/** THE NEXT MONTH'S BILL (the user's rulings): the period opens on the day the last one was read; every RATE carried unless typed over;
 *  every AMOUNT line (a tax) estimated from the last bill's amount until typed; the bank opens where the last one closed; usage blank */
export function nextStatement(f: BillFormat, prev: Statement): Statement {
  const s = newStatement(f, prev.meter);
  s.service = prev.service;
  if (ISO.test(prev.to)) { s.from = prev.to; s.to = addDays(prev.to, 30); }
  s.bank.before = prev.bank.after;
  s.lines = s.lines.map((l) => {
    const p = prev.lines.find((x) => x.id === l.id);
    if (!p) return l;
    if (l.carry === "amount") { const a = lineFigures(p, prev).amount; return a === null ? l : { ...l, amount: a, estimated: true }; }
    return p.rate === null ? l : { ...l, rate: p.rate, carried: true };
  });
  return s;
}
/** the bill a month back: its period closes on the day the given bill opens, 30 days before; its rates as the given bill's (carried
 *  until typed) — for typing the twelve months from the newest backwards */
export function earlierStatement(f: BillFormat, later: Statement): Statement {
  const s = newStatement(f, later.meter);
  s.service = later.service;
  if (ISO.test(later.from)) { s.to = later.from; s.from = addDays(later.from, -30); }
  // a copy made once, as the bill's own (marked so until typed) — never tied to the later bill, which must not reach back
  s.lines = s.lines.map((l) => { const p = later.lines.find((x) => x.id === l.id); return p && p.rate !== null && l.carry === "rate" ? { ...l, rate: p.rate, copied: true } : l; });
  return s;
}

/** THE RATES WORKED OUT AND FILLED (user, 2026-10-09: "the first entry in oldest month calculates the rate, and sets a rate before each
 *  line's total"). On every bill: an amount typed on a per-unit line with no rate of its own gives the rate — the tiers kept when the
 *  amount is the tiers' own to the cent, else amount ÷ quantity, marked derived. Then oldest to newest, a line with no rate and no amount
 *  typed takes the nearest EARLIER bill's own rate (marked carried, so it follows when that earlier one changes). Never backward: a later
 *  month never changes an earlier one. An amount the user typed is never replaced. */
export function fillRates(bills: Statement[]): Statement[] {
  const derive = (s: Statement): Statement => ({ ...s, lines: s.lines.map((l) => {
    // a $ a month typed as an amount IS its rate — it carries like one
    if (l.basis === "fixed" && l.amount !== null && !l.estimated) return { ...l, rate: l.amount, amount: null, carried: false };
    if (l.amount === null || l.estimated || (l.basis !== "per-kwh" && l.basis !== "per-kw")) return l;
    if (l.rate !== null && !l.derived && !l.carried) return l;
    const f = lineFigures({ ...l, rate: null, amount: null }, s);
    if (f.qty === null || f.qty === 0) return l;
    if (l.tiers?.length && f.amount !== null && Math.abs(f.amount - l.amount) <= 0.005) return { ...l, rate: null, derived: false, carried: false };
    return { ...l, rate: Number((l.amount / f.qty).toPrecision(4)), derived: true, carried: false };
  }) });
  const key = (s: Statement): string => s.from || s.to || "9999";
  const order = bills.map(derive).sort((a, b) => key(a).localeCompare(key(b)))
    .map((s) => ({ ...s, lines: s.lines.map((l) => (l.carried ? { ...l, rate: null, carried: false } : l)) }));
  const own = (l: StatementLine): boolean => l.rate !== null && !l.carried;
  // fill the lines still without a rate from the nearest bill along `list` that has its own
  const pass = (list: Statement[]): Statement[] => {
    const last = new Map<string, number>();
    return list.map((s) => ({ ...s, lines: s.lines.map((l) => {
      if (own(l)) { last.set(l.id, l.rate!); return l; }
      if (l.rate !== null || l.carry !== "rate" || (l.amount !== null && !l.estimated)) return l;
      const r = last.get(l.id);
      return r === undefined ? l : { ...l, rate: r, carried: true };
    }) }));
  };
  // FORWARD ONLY (user, 2026-10-09: "THE EARLIER MONTHS ARE NOT TO BE CHANGED BECAUSE A LATER MONTH CHANGES"): a line without its own rate
  // takes the nearest EARLIER bill's; a bill older than every rate stays as it is — a later month never reaches back
  return pass(order);
}

/** a ledger brought forward to the current format version — none so far: the ledger is returned as it is */
export function upgradeStatements(led: StatementsLedger): StatementsLedger {
  return led;
}

/** A ONE-OFF CHARGE OR CREDIT (user, 2026-10-09: "a late charge (direct withdrawal did not occur)"): a line typed on this bill alone, in
 *  the group given — a reason and an amount, a credit negative. The next and earlier months are made from the format, so it never carries;
 *  an amount line takes no rate, so the fill passes it by */
export function addOneOff(s: Statement, group: string, label = "", amount: number | null = null): Statement {
  const line: StatementLine = { id: `oneoff-${Date.now().toString(36)}-${(seq++).toString(36)}`, group, label, basis: "amount", carry: "amount", oneOff: true, qty: null, rate: null, amount };
  return { ...s, lines: [...s.lines, line] };
}

/** a format changed: a bill keeps its lines and gains the format's new ones, empty */
export function withFormat(s: Statement, f: BillFormat): Statement {
  const groups = [...s.groups];
  for (const g of f.groups) if (!groups.some((x) => x.id === g.id)) groups.push({ id: g.id, label: g.label });
  const lines = [...s.lines];
  for (const g of f.groups) for (const d of g.lines) if (!lines.some((l) => l.id === d.id)) lines.push(emptyLine(g, d));
  return { ...s, groups, lines };
}

/** the bill as a BillRow for the comparison, pricing and calibration: the net as `measured`, the generation as `receivedKwh` (so the
 *  delivered is the consumption), the net kW as the demand, the Detail of Charges as the cost, and the period as the MODEL'S days — the
 *  meter is read on `to`, so the bill covers from 00:00 on `from` to the end of the day before `to` */
export function statementToBillRow(s: Statement, line = 0): BillRow | null {
  const days = statementDays(s);
  const net = usageOf(s, "net").kwh;
  if (days === null || net === null) return null;
  const t = statementTotal(s);
  return { account: s.meter, fuel: "electricity", periodStart: s.from, periodEnd: addDays(s.to, -1), days, measured: net, unit: "kWh",
    costUsd: t.open ? null : t.total, demandKw: s.usage.net.kw, receivedKwh: s.usage.generation.kwh, line };
}
/** the month a bill is for: its billing date, else the day it was read */
export function statementMonth(s: Statement): string {
  const d = ISO.test(s.billingDate) ? s.billingDate : s.to;
  return ISO.test(d) ? d.slice(0, 7) : "";
}
/** THE PCA BILLED, by the month the tariff prices the bill under (its period's end month, as `monthFromBill` keys it) — $/kWh */
export function pcaFromStatements(bills: Statement[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of bills) {
    const r = statementToBillRow(s); const l = s.lines.find((x) => x.pca);
    if (r && l && l.rate !== null) out[r.periodEnd.slice(0, 7)] = l.rate;
  }
  return out;
}

/** YESTERDAY'S SHEET (2026-10-08, "bills entered by hand.csv"): each row a bill with its usage and the amount billed, no lines — the
 *  amount kept as the Current Charges stated, so nothing typed is lost */
export function statementsFromHandCsv(text: string, f: BillFormat): Statement[] {
  const csv = parseCsv(text), i = (h: string): number => csv.header.indexOf(h);
  const num = (v: string | undefined): number | null => (v === undefined || v.trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return csv.rows.map((r) => {
    const s = newStatement(f);
    s.from = r[i("period_start")] ?? ""; s.to = ISO.test(r[i("period_end")] ?? "") ? addDays(r[i("period_end")]!, 1) : "";
    s.usage.consumption.kwh = num(r[i("kwh_delivered")]); s.usage.generation.kwh = num(r[i("kwh_received")]);
    s.usage.net.kwh = num(r[i("kwh_net")]); s.usage.net.kw = num(r[i("demand_kw")]); s.stated = num(r[i("cost_usd")]);
    return s;
  }).filter((s) => ISO.test(s.from));
}

/** the newer of two copies, by `at` (the disk's wins a tie) */
export const newestStatements = (disk: StatementsLedger | undefined, journal: StatementsLedger | null): StatementsLedger | undefined =>
  !journal?.at ? disk : !disk?.at ? journal : journal.at > disk.at ? journal : disk;
