// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Copy the wasm/worker assets the renderer loads at runtime into public/wasm
// (same pattern the predecessor project settled on): web-ifc's wasm, the
// Fragments worker, and sql.js's wasm.
function copyWasm() {
  return {
    name: "copy-wasm",
    // `config` runs before the dev server lists public/ — a copy made later (buildStart) is not served on a fresh checkout's first run
    config() {
      const dest = path.resolve(__dirname, "public/wasm");
      fs.mkdirSync(dest, { recursive: true });
      const jobs: Array<[string, string]> = [
        ["node_modules/web-ifc/web-ifc.wasm", "web-ifc.wasm"],
        ["node_modules/web-ifc/web-ifc-mt.wasm", "web-ifc-mt.wasm"],
        ["node_modules/@thatopen/fragments/dist/Worker/worker.mjs", "fragments-worker.mjs"],
        // sql.js resolves its BROWSER entry under vite, and that build asks
        // for the -browser wasm name (the first run shipped only the node
        // name — the fetch fell through to index.html and wasm instantiate
        // saw "<!do" instead of "\0asm").
        ["node_modules/sql.js/dist/sql-wasm-browser.wasm", "sql-wasm-browser.wasm"],
        ["node_modules/sql.js/dist/sql-wasm.wasm", "sql-wasm.wasm"],
      ];
      for (const [src, name] of jobs) {
        fs.copyFileSync(path.resolve(__dirname, src), path.join(dest, name));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyWasm(), react()],
  server: { port: 5190, strictPort: true },
  build: { chunkSizeWarningLimit: 4000 },
});
