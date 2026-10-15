// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// The user's explain.md, bundled as text (Vite's ?raw) and parsed once; a saved edit of the file reloads this module alone.

import raw from "./explain.md?raw";
import { parseExplain, type ExplainEntry } from "./explainParse";

export const EXPLAIN: ExplainEntry[] = parseExplain(raw);
