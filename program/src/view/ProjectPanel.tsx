// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE PROJECT AND ITS VERSIONS (2026-09-30, the user's rulings): the project the open file belongs to (its IfcProject
 * GlobalId), every version the store holds for it as a tree — a version under the one it was made from, so two edits of
 * one parent read as two branches — how each was made, which ledgers it carries, and the open one marked. Export writes
 * the project as one file (to move machines or keep a copy); Import merges one back. Reads the store; changes nothing else.
 */
export interface ProjectView {
  id: string; name: string | null; longName: string | null; file: string;
  versions: StoredVersion[];
}

export function ProjectPanel(p: { project: ProjectView; currentSha: string; busy: boolean; note: string; onExport: () => void; onImport: () => void }): React.ReactElement {
  const { project, currentSha } = p;
  const bySha = new Map(project.versions.map((v) => [v.sha, v]));
  const kids = new Map<string, StoredVersion[]>();
  const roots: StoredVersion[] = [];
  for (const v of project.versions) {
    if (v.parentSha && bySha.has(v.parentSha)) (kids.get(v.parentSha) ?? kids.set(v.parentSha, []).get(v.parentSha)!).push(v);
    else roots.push(v);
  }
  const rows: Array<{ v: StoredVersion; depth: number }> = [];
  const walk = (v: StoredVersion, depth: number): void => { rows.push({ v, depth }); for (const k of kids.get(v.sha) ?? []) walk(k, depth + 1); };
  for (const r of roots) walk(r, 0);
  return (
    <div className="qaPanel projectPanel">
      <div className="muted" title={`the store: ${project.file}`}>
        {project.longName ?? project.name ?? "a project"} · IfcProject <b>{project.id}</b> · {project.versions.length} version{project.versions.length === 1 ? "" : "s"}
      </div>
      <table>
        <thead><tr><th title="the file's sha256 (first 12)">version</th><th>file</th><th title="when the store first recorded it">recorded</th><th title="how it was made: opened · carried (rulings carried across the diff) · inferred (the closest by GlobalIds) · bimedit · delete-from-ifc · migrated">made by</th><th title="the ledgers it carries">rulings</th></tr></thead>
        <tbody>
          {rows.map(({ v, depth }) => (
            <tr key={v.sha} className={v.sha === currentSha ? "on" : ""} title={`${v.sha}${v.parentSha ? `\nmade from ${v.parentSha}` : "\na root: no parent recorded"}${v.note ? `\n${v.note}` : ""}${v.filePath ? `\n${v.filePath}` : ""}`}>
              <td style={{ paddingLeft: 4 + depth * 14 }}>{depth ? "↳ " : ""}{v.sha.slice(0, 12)}{v.sha === currentSha ? " · open" : ""}</td>
              <td>{v.fileName ?? "—"}</td>
              <td>{v.createdAt.slice(0, 10)}</td>
              <td>{v.madeBy}</td>
              <td>{v.ledgers.length ? v.ledgers.join(" · ") : "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="allRow">
        <button className="qaBtn" disabled={p.busy} onClick={p.onExport} title="write this project — every version, its rulings and their history — as one .bimproject file">Export…</button>
        <button className="qaBtn" disabled={p.busy} onClick={p.onImport} title="merge a .bimproject file into the store: versions and rulings it lacks are added; a ruling it has is kept unless the file's is newer">Import…</button>
        {p.note && <span className="muted">{p.note}</span>}
      </div>
    </div>
  );
}
