// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// The eye: open shows, closed hides — the tree's toggle, drawn inline.
export function Eye({ on }: { on: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 16" width="16" height="11" aria-hidden="true">
      <path d="M1.5 8s4-6.5 10.5-6.5S22.5 8 22.5 8s-4 6.5-10.5 6.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {on
        ? <circle cx="12" cy="8" r="3" fill="currentColor" />
        : <line x1="4" y1="14.5" x2="20" y2="1.5" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}
