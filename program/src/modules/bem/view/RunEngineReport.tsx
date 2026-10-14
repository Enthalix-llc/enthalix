// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN · THE ENGINE'S OWN REPORT (user, 2026-10-07: "We need a results output based on standard energyplus html output, as it breaks
// down loads into multiple detailed segments"). The run's eplustbl.htm as EnergyPlus wrote it — the Annual Building Utility
// Performance Summary, the end uses and their demand, the Zone and Space Component Load Summaries (each peak broken into people,
// lights, equipment, walls, roofs, windows, infiltration, ventilation …), sizing, envelope, the tariff — shown untouched in a frame
// with no scripts. Two pickers above it jump to a report and the zone or space it is for, read from the report's own anchors. A run
// that ended Fatal wrote no report: its eplusout.err is shown instead, the engine's word on why.

import { useEffect, useMemo, useRef, useState } from "react";

interface Section { report: string; forWhat: string; anchor: string }

/** the report's sections from its own markup: `<a name=X></a>` then `<p>Report:<b> R</b></p>` then `<p>For:<b> F</b></p>` */
export function reportSections(html: string): Section[] {
  const out: Section[] = [];
  const re = /<a name=([^>\s]+)><\/a>\s*<p>Report:<b>\s*([^<]*?)\s*<\/b><\/p>\s*<p>For:<b>\s*([^<]*?)\s*<\/b><\/p>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ anchor: m[1]!.replace(/^"|"$/g, ""), report: m[2]!, forWhat: m[3]! });
  return out;
}

/** the units the engine wrote the report in (2026-10-11): inch-pound tables carry kBtu and Btu/h, SI ones kWh and W */
export function reportUnitsOf(html: string): "ip" | "si" { return /\[(kBtu|Btu\/h|kBtu\/ft2|F)\]/.test(html) ? "ip" : "si"; }

export function RunEngineReport({ stamp, fatal, project, imperial }: { stamp: string | null; fatal: boolean; project?: string; imperial?: boolean }): React.ReactElement {
  const [out, setOut] = useState<string | null>(null);
  const send = async (mode: "print" | "pdf"): Promise<void> => {
    if (!stamp) return;
    setOut(mode === "pdf" ? "writing the PDF …" : "opening the print dialog …");
    const r = await window.bem.reportOut(stamp, mode, `EnergyPlus report — ${project ? `${project} — ` : ""}run ${stamp}`);
    setOut(r.error ? `✗ ${r.error}` : r.saved ? `saved ${r.saved}` : r.printed ? "sent to the printer" : "cancelled");
  };
  const [doc, setDoc] = useState<{ stamp: string; html: string | null; err: string | null } | null>(null);
  const [report, setReport] = useState("");
  const [forWhat, setForWhat] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!stamp) { setDoc(null); return; }
    let live = true;
    void (async () => {
      const tbl = await window.bem.readRunFile(stamp, "eplustbl.htm");
      const err = tbl ? null : await window.bem.readRunFile(stamp, "eplusout.err");
      if (live) setDoc({ stamp, html: tbl ? new TextDecoder().decode(tbl) : null, err: err ? new TextDecoder().decode(err) : null });
    })();
    return () => { live = false; };
  }, [stamp]);
  const sections = useMemo(() => (doc?.html ? reportSections(doc.html) : []), [doc]);
  const reports = useMemo(() => [...new Set(sections.map((s) => s.report))], [sections]);
  const fors = useMemo(() => sections.filter((s) => s.report === report), [sections, report]);
  const jump = (anchor: string): void => {
    const d = frame.current?.contentDocument;
    const at = d?.getElementsByName(anchor)[0];
    if (at) at.scrollIntoView({ block: "start" });
  };
  if (!stamp) return <div className="muted runReportEmpty">no run yet — run the model in the column; the engine's report shows here</div>;
  if (!doc || doc.stamp !== stamp) return <div className="muted runReportEmpty">reading run {stamp} …</div>;
  if (!doc.html) {
    const lines = (doc.err ?? "").split(/\r?\n/);
    const hot = lines.filter((l) => /\*\*\s+(Severe|Fatal)\s+\*\*|~~~/.test(l)).slice(0, 60);
    return (
      <div className="runReportErr">
        <div><b>run {stamp} — the engine wrote no report</b>{fatal ? " · it ended Fatal" : ""}. Its error file, the Severe and Fatal lines first:</div>
        <pre>{hot.length ? hot.join("\n") : "(no Severe or Fatal lines)"}</pre>
        <details><summary>the whole eplusout.err ({lines.length.toLocaleString()} lines)</summary><pre>{doc.err ?? "no eplusout.err in the run folder"}</pre></details>
      </div>
    );
  }
  return (
    <div className="runReport">
      <div className="runReportBar">
        <span>EnergyPlus's own report · eplustbl.htm · run {stamp} · {sections.length} tables · {reportUnitsOf(doc.html) === "ip" ? "inch-pound" : "SI"}</span>
        {imperial !== undefined && (reportUnitsOf(doc.html) === "ip") !== imperial && <span className="runStale" title="the engine writes its report once, in the units shown when Run was pressed; the results the app reads are the same either way">this run's report is in {imperial ? "SI" : "inch-pound"} — Run again to write it in {imperial ? "inch-pound" : "SI"} units</span>}
        <select value={report} onChange={(e) => { const r = e.target.value; setReport(r); setForWhat(""); const first = sections.find((s) => s.report === r); if (first) jump(first.anchor); }} title="jump to one of the engine's reports">
          <option value="">report …</option>
          {reports.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {fors.length > 1 && (
          <select value={forWhat} onChange={(e) => { setForWhat(e.target.value); jump(e.target.value); }} title="the zone or space the report is for">
            <option value="">for …</option>
            {fors.map((s) => <option key={s.anchor} value={s.anchor}>{s.forWhat}</option>)}
          </select>
        )}
        <button onClick={() => { setReport(""); setForWhat(""); jump("toc"); }} title="the report's own table of contents">contents</button>
        <button onClick={() => void send("print")} title="the whole report through the system's print dialog (which can also save a PDF)">Print…</button>
        <button onClick={() => void send("pdf")} title="the whole report written as a PDF where you pick">Save PDF…</button>
        {out && <span className="muted">{out}</span>}
      </div>
      {/* sandboxed with no scripts; same origin only so the pickers can scroll it */}
      <iframe ref={frame} className="runReportFrame" title={`EnergyPlus report, run ${stamp}`} sandbox="allow-same-origin" srcDoc={doc.html} />
    </div>
  );
}
