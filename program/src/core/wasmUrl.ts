// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// WHERE THE WEBASSEMBLY IS (2026-10-20, the installers): beside the page, wherever the page was loaded from. Under the dev server that
// is http://localhost:<port>/wasm/; in an installed app the page is a file (…/dist/index.html), where "/wasm/" would name the root of
// the disk. So every .wasm and worker is named relative to the page's own address.
export const WASM_DIR = new URL("wasm/", document.baseURI).href;
export const wasmUrl = (file: string): string => WASM_DIR + file;
