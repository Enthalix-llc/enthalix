// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE LEDGER STORE (2026-09-10): every ledger file — the BEM decisions, the corrections, the BOM ledger — is written
// ATOMICALLY (a temp file renamed over the file, so a crash mid-write never leaves a truncated JSON that reads as "no
// rulings") and the previous version is kept under <dir>/history/<base>.<stamp>.json, the last `keep` of them. The user's
// sheet was lost to a file overwritten in place with no history; a draft is never a one-way door again. A CommonJS module
// so main.cjs requires it and the gate tests it through createRequire.
const fs = require("node:fs");
const path = require("node:path");
const { renameRetry } = require("./fsRetry.cjs");   // Windows holds a file open for a moment (2026-10-20)

const historyDir = (file) => path.join(path.dirname(file), "history");
const baseOf = (file) => path.basename(file, ".json");
const stampNow = () => new Date().toISOString().replace(/[:.]/g, "-");
/** a history stamp back to ISO time: 2026-09-10T23-00-26-123Z(-2) → 2026-09-10T23:00:26.123Z */
const stampToIso = (stamp) => stamp.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/, "$1T$2:$3:$4.$5Z");

/** the previous versions of a ledger file, newest first */
function listHistory(file) {
  const hd = historyDir(file), base = baseOf(file);
  let names = [];
  try { names = fs.readdirSync(hd); } catch { return []; }
  return names
    .filter((n) => n.startsWith(`${base}.`) && n.endsWith(".json"))
    .map((n) => { const p = path.join(hd, n); return { stamp: n.slice(base.length + 1, -5), at: stampToIso(n.slice(base.length + 1, -5)), path: p, bytes: fs.statSync(p).size }; })
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
}
function prune(file, keep) {
  for (const e of listHistory(file).slice(keep)) { try { fs.unlinkSync(e.path); } catch { /* already gone */ } }
}
/** write `json` to `file`: the previous version copied into the history first (a unique stamp, a counter when two land in
 *  one millisecond), the history pruned to `keep`, the new bytes written to a temp file and renamed over the file */
function saveJson(file, json, opts) {
  const keep = (opts && opts.keep) || 30;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let kept = null;
  if (fs.existsSync(file)) {
    const hd = historyDir(file);
    fs.mkdirSync(hd, { recursive: true });
    const base = baseOf(file), stamp = stampNow();
    kept = path.join(hd, `${base}.${stamp}.json`);
    for (let i = 1; fs.existsSync(kept); i++) kept = path.join(hd, `${base}.${stamp}-${i}.json`);
    fs.copyFileSync(file, kept);
    prune(file, keep);
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
  renameRetry(tmp, file);
  return { path: file, kept };
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
module.exports = { saveJson, listHistory, readJson, historyDir, stampToIso };
