// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SETUP CHECK: what Enthalix needs, what is on this computer, and where to get what is missing — each part from its own
// publisher, under its own terms. It INSTALLS NOTHING and changes nothing: it reads, and says. Run it from program/:
//
//   pnpm setup:check
//
// Exit code 0 when everything needed to run a model is in place, 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const program = path.resolve(here, "..");
const repo = path.resolve(program, "..");
const TESTED_ENERGYPLUS = "26.1";

const rows = [];
let missing = 0;
const ok = (part, what) => rows.push(["ok", part, what]);
const need = (part, what, where) => { missing++; rows.push(["MISSING", part, `${what}\n      → ${where}`]); };
const note = (part, what, where) => rows.push(["note", part, where ? `${what}\n      → ${where}` : what]);
const csvRows = (f) => { try { return fs.readFileSync(f, "utf8").split(/\r?\n/).slice(1).filter((l) => l.trim()).length; } catch { return null; } };

// 1. Node.js and the program's packages
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 22) ok("Node.js", `version ${process.versions.node}`);
else need("Node.js", `version ${process.versions.node} — 22 or newer is needed`, "https://nodejs.org/");
if (fs.existsSync(path.join(program, "node_modules", "web-ifc"))) ok("packages", "installed (program/node_modules)");
else need("packages", "not installed", "run `pnpm install` in program/ (pnpm: https://pnpm.io/installation)");
if (fs.existsSync(path.join(program, "node_modules", "electron", "dist"))) ok("Electron", "its binary is downloaded");
else note("Electron", "its binary is not downloaded yet — Electron fetches it the first time `pnpm dev` starts it");

// 2. EnergyPlus — installed separately, run as its own program
try {
  const { listEngines } = require(path.join(program, "electron", "engineLocate.cjs"));
  const engines = listEngines();
  if (!engines.length) need("EnergyPlus", "no installation found (looked in /Applications, /usr/local/bin, /opt/homebrew/bin and $ENERGYPLUS)",
    `install EnergyPlus ${TESTED_ENERGYPLUS} from https://github.com/NatLabRockies/EnergyPlus/releases (or set ENERGYPLUS to its program)`);
  else {
    const e = engines[0];
    const v = `${e.v?.major ?? "?"}.${e.v?.minor ?? "?"}.${e.v?.patch ?? "?"}`;
    if (`${e.v?.major}.${e.v?.minor}` === TESTED_ENERGYPLUS) ok("EnergyPlus", `version ${v} at ${e.dir ?? e.exe}`);
    else note("EnergyPlus", `version ${v} at ${e.dir ?? e.exe} — this preview is tested with ${TESTED_ENERGYPLUS}`, "https://github.com/NatLabRockies/EnergyPlus/releases");
  }
} catch (err) { note("EnergyPlus", `could not be looked for: ${err instanceof Error ? err.message : String(err)}`); }

// 3. Weather — a typical-year file for the site
const weatherDir = path.join(repo, "Weather");
const epws = fs.existsSync(weatherDir) ? fs.readdirSync(weatherDir).filter((f) => /\.epw$/i.test(f)) : [];
if (epws.length) ok("weather", `${epws.length} file${epws.length === 1 ? "" : "s"} in Weather/`);
else note("weather", "no file in Weather/ yet — the app opens on a placeholder (Golden, CO, from EnergyPlus's own WeatherData)",
  "pick your site's file on the map in BEM › SITE (EnergyPlus's weather repository, https://energyplus.net/weather), or put a .epw with its .ddy in Weather/");

// 4. The energy code — the user's own tables
const codes = path.join(repo, "data", "energy-codes");
const eds = csvRows(path.join(codes, "editions.csv")), vals = csvRows(path.join(codes, "values.csv"));
if (eds && vals) ok("energy code", `${eds} edition${eds === 1 ? "" : "s"}, ${vals} value${vals === 1 ? "" : "s"} in data/energy-codes/`);
else need("energy code", "no code values on record — the model is not written without them",
  "copy references/energy-codes/*.csv to data/energy-codes/ and enter your code's values (references/energy-codes/README.md); the IECC is free to read at https://codes.iccsafe.org/");

// 5. The tariff — optional, for costs
const tariff = path.join(repo, "data", "tariffs", "tariff.json");
if (fs.existsSync(tariff)) {
  let inForce = 0;
  try { inForce = (JSON.parse(fs.readFileSync(tariff, "utf8")).cards ?? []).filter((c) => c.status === "in force").length; } catch { /* reported below */ }
  if (inForce) ok("tariff", `${inForce} card${inForce === 1 ? "" : "s"} in force in data/tariffs/tariff.json`);
  else note("tariff", "data/tariffs/tariff.json has no card marked \"in force\"", "references/tariffs/README.md");
} else note("tariff", "none — runs report energy only, without costs (optional)", "references/tariffs/README.md");

// 6. A building
const ifcDir = path.join(repo, "references", "ifc");
const ifcs = fs.existsSync(ifcDir) ? fs.readdirSync(ifcDir).filter((f) => /\.ifc$/i.test(f)) : [];
if (ifcs.length) ok("building", `${ifcs.length} IFC file${ifcs.length === 1 ? "" : "s"} in references/ifc/`);
else note("building", "no IFC file in references/ifc/ — open any IFC from the app (BIM › Open IFC…)", "a sample building: see SETUP.md");

// 7. Terms to know before paid work
note("terms", "the actual-year weather's sun and sky come from the Open-Meteo archive, whose free API is for NON-COMMERCIAL use only — for paid work use your own actual-year file (BOM › calibration)");

for (const [s, part, what] of rows) console.log(`${s.padEnd(8)} ${part.padEnd(12)} ${what}`);
console.log(missing ? `\n${missing} part${missing === 1 ? "" : "s"} missing — see above, and SETUP.md` : "\nEverything needed to run a model is in place.");
process.exit(missing ? 1 : 0);
