// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// WHY THE RUN CANNOT GO (user, 2026-10-16: "pop up a dialog box stating that the run can't occur because …, which clears when the
// issues are resolved"): opened by Run EnergyPlus when something stands in the way; each reason with the tab where it is resolved.
// It does not cover the screen, so the tabs stay usable while it is open, and it closes itself once the list is empty.

import { useEffect } from "react";
import type { TabId } from "../../../shell/registry.js";

export interface RunBlock { what: string; how: string; tab?: TabId }

export function RunBlockedDialog(p: { blocks: RunBlock[]; tabLabel: (t: TabId) => string; onGo: (t: TabId) => void; onClose: () => void }): React.ReactElement {
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);
  return (
    <div className="dialog runBlocked" role="alertdialog" aria-label="the run cannot occur">
      <div className="dialogHead">EnergyPlus cannot run yet, because:</div>
      <ul>
        {p.blocks.map((b, i) => (
          <li key={i}>
            <span className="bad">{b.what}</span>
            <div className="muted">{b.how}{b.tab && <> · <button className="chip" onClick={() => p.onGo(b.tab!)}>go to {p.tabLabel(b.tab)}</button></>}</div>
          </li>
        ))}
      </ul>
      <div className="muted">This box closes by itself when nothing is left in the way; then Run EnergyPlus again.</div>
      <div className="allRow"><span style={{ flex: 1 }} /><button className="qaBtn" onClick={p.onClose}>Close</button></div>
    </div>
  );
}
