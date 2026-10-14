// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE BILLS, MONTH BY MONTH, AS THE UTILITY PRINTS THEM (user, 2026-10-09: "suggest dropdown section for each month by clicking on the month
// row — the month row should show net summary for month and total cost for month including sum of Detail of Charges"). A row per bill,
// newest first; a click drops down the bill laid out as the utility prints it — the meter and period, the usage table (Consumption · Generation ·
// Net, kWh and the kW on Net), the banked energy, the Detail of Charges in its groups with subtotals, the Current Charges and the amount
// printed. Every value is typed in place; a rate carried from the last bill or a tax estimated from it reads in the inherited colour until
// typed. "+ next month's bill" starts from the last one (core/statement.ts nextStatement); "bill format…" opens the format's dialog.

import { useEffect, useState, type ReactNode } from "react";
import { lineFigures, groupSubtotals, statementTotal, checkStated, statementDays, statementMonth, newStatement, nextStatement, earlierStatement, fillRates, usageOf, addOneOff, ROLE_WORDS, BASIS_WORDS,
  type BillFormat, type Statement, type StatementLine, type StatementsLedger, type UsageRole } from "../core/statement.js";
import { parseDate } from "../core/csvRead.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = (v: number): string => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const k0 = (v: number | null): string => (v === null ? "—" : Math.round(v).toLocaleString());
const md = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : "—");
const monthWords = (ym: string): string => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "no date yet");

/** a number field that owns its text while typed: "1,918" and "$300.82" read as the bill prints them (commas and $ ignored) */
function Num({ value, onValue, cls, placeholder, title, width }: { value: number | null; onValue: (v: number | null) => void; cls?: string; placeholder?: string; title?: string; width?: number }): ReactNode {
  const fmt = (v: number | null): string => (v === null ? "" : String(v));
  const [text, setText] = useState(fmt(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(fmt(value)); }, [value, focus]);
  return (
    <input type="text" inputMode="decimal" className={`stmtNum ${cls ?? ""}`} style={width ? { width } : undefined} value={text} placeholder={placeholder} title={title}
      onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setText(fmt(value)); }}
      onChange={(e) => {
        const t = e.target.value; setText(t);
        const c = t.replace(/[$,\s]/g, "");
        if (c === "") { onValue(null); return; }
        const v = Number(c);
        if (Number.isFinite(v) && !/[.]$/.test(c)) onValue(v);
      }} />
  );
}
/** a date typed as the bill prints it (09/14/26, 9/14/2026, 2026-09-14), kept ISO */
function DateIn({ value, onValue, title }: { value: string; onValue: (v: string) => void; title: string }): ReactNode {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <input type="text" className="stmtDate" value={text} placeholder="mm/dd/yy" title={title} onChange={(e) => setText(e.target.value)}
    onBlur={() => { const t = text.trim(); const iso = t === "" ? "" : parseDate(t.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, "$1/$2/20$3")); if (iso !== null) onValue(iso); else setText(value); }} />;
}

export function BomStatements({ led, format, busy, onChange, onFormat }: { led: StatementsLedger; format: BillFormat; busy: boolean;
  onChange: (next: StatementsLedger) => void; onFormat: () => void }): ReactNode {
  const [open, setOpen] = useState<string | null>(null);
  const bills = [...led.bills].sort((a, b) => (b.from || "9999").localeCompare(a.from || "9999"));
  // every change: the rates worked out from amounts typed and filled across the bills (core/statement.ts fillRates)
  const commit = (bills: Statement[]): void => onChange({ ...led, bills: fillRates(bills), at: new Date().toISOString() });
  const put = (s: Statement): void => commit(led.bills.map((x) => (x.id === s.id ? s : x)));
  const dated = [...led.bills].filter((b) => b.from && b.to).sort((a, b) => a.from.localeCompare(b.from));
  const add = (): void => {
    const last = dated[dated.length - 1];
    const s = last ? nextStatement(format, last) : newStatement(format);
    commit([...led.bills, s]); setOpen(s.id);
  };
  const addEarlier = (): void => {
    const first = dated[0]; if (!first) return;
    const s = earlierStatement(format, first);
    commit([...led.bills, s]); setOpen(s.id);
  };
  const remove = (s: Statement): void => {
    if (!window.confirm(`Delete the bill for ${monthWords(statementMonth(s))} (${md(s.from)}–${md(s.to)})? It cannot be undone except from the ledger's history.`)) return;
    commit(led.bills.filter((x) => x.id !== s.id)); setOpen(null);
  };
  const year = bills.map((s) => ({ t: statementTotal(s), r: s })).filter((x) => !x.t.open);
  return (
    <div className="stmtList">
      <div className="allRow">
        <button className="apply" disabled={busy} onClick={add} title="a new bill: the period opens on the day the last one was read, its rates carried, its taxes estimated from it until typed">+ {led.bills.length ? "next month's bill" : "a bill"}</button>
        {dated.length > 0 && <button className="qaBtn" disabled={busy} onClick={addEarlier} title="a bill a month before the oldest: it closes on the day the oldest opens, its rates carried until typed">+ earlier month</button>}
        <button className="qaBtn" onClick={onFormat} title="what a bill holds: its usage rows, its charge groups and lines, how each is figured and what carries to the next month">bill format…</button>
        <span className="muted">{format.utility}</span>
      </div>
      {bills.length === 0 && <div className="idfInfo">no bills yet — "+ a bill" and type the first from paper, the meter number and the period first</div>}
      {bills.map((s) => {
        const t = statementTotal(s), c = checkStated(s), d = statementDays(s), on = open === s.id;
        const flag = t.open ? `${t.open} line${t.open === 1 ? "" : "s"} open` : c.ok === null ? "" : c.ok ? "✓" : `✗ ${c.diff > 0 ? "+" : ""}${c.diff.toFixed(2)}`;
        return (
          <div key={s.id} className={`stmt${on ? " open" : ""}`}>
            <button className="stmtRow" onClick={() => setOpen(on ? null : s.id)} title={on ? "close the bill" : "open the bill — every value typed in place"}>
              <span className="stmtArrow">{on ? "▾" : "▸"}</span>
              <b>{monthWords(statementMonth(s))}</b>
              <span>{md(s.from)}–{md(s.to)}{d !== null ? ` · ${d} d` : ""}</span>
              <span>net {k0(usageOf(s, "net").kwh)} kWh{s.usage.net.kw !== null ? ` · ${s.usage.net.kw} kW` : ""}</span>
              <span className="stmtTotal">{usd(t.total)}</span>
              <span className={c.ok === false ? "bad" : c.ok ? "ok" : "muted"} title={c.ok === null ? "type the Current Charges printed to check the sum" : c.ok ? "the Detail of Charges sums to the Current Charges printed" : `the Detail of Charges sums to ${usd(t.total)}, the bill prints ${usd(s.stated ?? 0)}`}>{flag}</span>
              {t.estimated > 0 && <span className="src-inherited" title="an amount estimated from the last bill — type the bill's">est.</span>}
            </button>
            {on && <StatementEditor s={s} put={put} onDelete={() => remove(s)} />}
          </div>
        );
      })}
      {year.length > 0 && <div className="idfInfo">{year.length} bill{year.length === 1 ? "" : "s"} summed · net {k0(year.reduce((a, x) => a + (x.r.usage.net.kwh ?? 0), 0))} kWh · {usd(year.reduce((a, x) => a + x.t.total, 0))}</div>}
    </div>
  );
}

function StatementEditor({ s, put, onDelete }: { s: Statement; put: (s: Statement) => void; onDelete: () => void }): ReactNode {
  const set = (patch: Partial<Statement>): void => put({ ...s, ...patch });
  const setUsage = (role: UsageRole, k: "kwh" | "kw", v: number | null): void => set({ usage: { ...s.usage, [role]: { ...s.usage[role], [k]: v } } });
  const setLine = (id: string, patch: Partial<StatementLine>): void => set({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const subs = groupSubtotals(s), t = statementTotal(s), c = checkStated(s), d = statementDays(s);
  const net = s.usage.consumption.kwh !== null && s.usage.generation.kwh !== null ? s.usage.consumption.kwh - s.usage.generation.kwh : null;
  return (
    <div className="stmtBody">
      <table className="stmtHead"><tbody>
        <tr><td>meter</td><td><input type="text" className="stmtText" value={s.meter} placeholder="Meter No." onChange={(e) => set({ meter: e.target.value })} /></td>
          <td>service</td><td><input type="text" className="stmtText" value={s.service} onChange={(e) => set({ service: e.target.value })} /></td></tr>
        <tr><td>from</td><td><DateIn value={s.from} onValue={(v) => set({ from: v })} title="Service Dates · From — the earlier meter reading" /></td>
          <td>to</td><td><DateIn value={s.to} onValue={(v) => set({ to: v })} title="Service Dates · To — the later meter reading" /> {d !== null && <span className="muted">{d} days</span>}</td></tr>
        <tr><td>billing date</td><td><DateIn value={s.billingDate} onValue={(v) => set({ billingDate: v })} title="the Billing Date printed — names the bill's month" /></td><td></td><td></td></tr>
      </tbody></table>
      <table className="stmtUsage">
        <thead><tr><th>usage</th><th className="num">kWh</th><th className="num">kW</th></tr></thead>
        <tbody>
          {(["consumption", "generation", "net"] as UsageRole[]).map((r) => (
            <tr key={r} title={ROLE_WORDS[r]}>
              <td>{r === "consumption" ? "Consumption" : r === "generation" ? "Generation" : "Net"}</td>
              <td className="num"><Num value={s.usage[r].kwh} onValue={(v) => setUsage(r, "kwh", v)} placeholder={r === "net" && net !== null ? String(net) : ""} width={64} /></td>
              <td className="num"><Num value={s.usage[r].kw} onValue={(v) => setUsage(r, "kw", v)} width={48} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {net !== null && s.usage.net.kwh !== null && Math.abs(net - s.usage.net.kwh) > 0.5 && <div className="src-warn">consumption − generation = {k0(net)} kWh, the Net row reads {k0(s.usage.net.kwh)}</div>}
      <div className="stmtBank">banked energy · before <Num value={s.bank.before} onValue={(v) => set({ bank: { ...s.bank, before: v } })} width={48} /> · used <Num value={s.bank.used} onValue={(v) => set({ bank: { ...s.bank, used: v } })} width={48} /> · after <Num value={s.bank.after} onValue={(v) => set({ bank: { ...s.bank, after: v } })} width={48} /> kWh</div>
      <div className="stmtCharges">
        {s.groups.map((g) => {
          const lines = s.lines.filter((l) => l.group === g.id), sub = subs.find((x) => x.id === g.id);
          return (
            <div key={g.id} className="stmtGroup">
              <div className="stmtGroupHead">{g.label}
                {g.id === "other" && <button className="qaBtn stmtAdd" onClick={() => put(addOneOff(s, g.id))} title="add a charge or credit on this bill alone (a late charge, a one-time credit) — a reason and an amount, a credit negative; it does not carry to another month">+</button>}
              </div>
              {lines.map((l) => {
                const f = lineFigures(l, s);
                if (l.oneOff) return (
                  <div key={l.id} className="stmtLine" title="a charge or credit on this bill alone — it does not carry to another month">
                    <input type="text" className="stmtReason" value={l.label} placeholder="reason (e.g. Late Payment Charge)" onChange={(e) => setLine(l.id, { label: e.target.value })} autoFocus={!l.label && l.amount === null} />
                    <Num value={l.amount} onValue={(v) => setLine(l.id, { amount: v })} cls="amt" width={64} title="the amount printed — a credit is negative" />
                    <button className="qaBtn" onClick={() => set({ lines: s.lines.filter((x) => x.id !== l.id) })} title="remove this charge from the bill">×</button>
                  </div>
                );
                return (
                  <div key={l.id} className="stmtLine" title={`${l.label} — ${BASIS_WORDS[l.basis]}${l.of && l.basis !== "fixed" && l.basis !== "amount" ? ` of ${l.of}` : ""}${l.pca ? " · the PCA: its rate prices the model's month too" : ""}`}>
                    <span className="stmtLabel">{l.label}</span>
                    {(l.basis === "per-kwh" || l.basis === "per-kw") && (
                      <span className="stmtCalc">
                        <Num value={l.qty} onValue={(v) => setLine(l.id, { qty: v })} placeholder={f.qty !== null ? String(f.qty) : ""} width={52} title="the quantity printed (blank = the usage row's)" /> {f.unit} @
                        <Num value={l.rate} onValue={(v) => setLine(l.id, { rate: v, carried: false, derived: false, copied: false })} cls={l.carried || l.derived || l.copied ? "src-inherited" : ""} width={64}
                          placeholder={f.tiered && f.rate !== null ? String(f.rate) : ""}
                          title={f.tiered ? `${l.tierSource ?? "the tiers"}: ${(l.tiers ?? []).map((t) => `${t.rate} to ${t.upTo === null ? "∞" : t.upTo.toLocaleString()} kWh`).join(" · ")} — type a rate to replace them` : l.derived ? "worked out from the amount typed on this bill (amount ÷ quantity)" : l.carried ? "carried forward from the nearest earlier bill — type the rate printed" : l.copied ? "copied from the later bill this month was made from — type the rate printed" : "the rate printed"} />
                      </span>
                    )}
                    {l.basis === "fixed" && <span className="stmtCalc"><Num value={l.rate} onValue={(v) => setLine(l.id, { rate: v, carried: false, copied: false })} cls={l.carried || l.copied ? "src-inherited" : ""} width={60} title={l.carried ? "carried forward from the nearest earlier bill" : l.copied ? "copied from the later bill this month was made from" : "the charge printed"} /></span>}
                    {l.basis !== "fixed" && (
                      <Num value={l.amount} onValue={(v) => setLine(l.id, { amount: v, estimated: false })} cls={`amt ${l.estimated ? "src-inherited" : ""}`} width={64}
                        placeholder={l.basis !== "amount" && f.amount !== null ? f.amount.toFixed(2) : ""} title={l.estimated ? "estimated from the last bill — type the amount printed" : l.basis === "amount" ? "the amount printed" : "the amount printed (blank = qty × rate to the cent)"} />
                    )}
                    {l.basis === "fixed" && <span className="stmtAmt">{f.amount === null ? "—" : usd(f.amount)}</span>}
                  </div>
                );
              })}
              {lines.length === 0 && <div className="muted stmtLine">none on this bill</div>}
              <div className="stmtSub">{sub && sub.open ? `${sub.open} open · ` : ""}{usd(sub?.total ?? 0)}</div>
            </div>
          );
        })}
      </div>
      <div className="stmtFoot">
        <span>Current Charges (the Detail summed) <b>{usd(t.total)}</b>{t.open ? ` · ${t.open} line${t.open === 1 ? "" : "s"} open` : ""}</span>
        <span>printed <Num value={s.stated} onValue={(v) => set({ stated: v })} width={70} title="the Current Charges the bill prints — checks the sum" /></span>
        <span className={c.ok === false ? "bad" : c.ok ? "ok" : "muted"}>{c.ok === null ? "" : c.ok ? "✓ agrees" : `✗ off by ${usd(Math.abs(c.diff))}`}</span>
        <button className="qaBtn" onClick={onDelete}>delete bill</button>
      </div>
    </div>
  );
}
