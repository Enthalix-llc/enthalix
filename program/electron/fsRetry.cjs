// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A SAVE THAT WINDOWS HOLDS OPEN (2026-10-20): every user file is written to a .tmp beside it and renamed over it. On Windows the
// rename fails for a moment with EPERM, EBUSY or EACCES while an antivirus scanner or the search indexer has the file open; it is
// tried again up to five times, 20 → 320 ms apart, then the error is thrown as before (and named to the windows by saveUser).
const fs = require("node:fs");

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) { if (i >= 5 || !TRANSIENT.has(e && e.code)) throw e; pause(20 * 2 ** i); }
  }
}

module.exports = { renameRetry };
