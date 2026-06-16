/**
 * Staging store — the publish batching layer.
 * Edits made in the UI are validated and staged here (in-memory, per project)
 * WITHOUT touching GitHub. A "publish" flushes all staged changes into a single
 * atomic commit. This gives Webflow-style "make a bunch of edits, then publish".
 *
 * For raw (HTML) collections the staged value is { body }; for structured
 * collections it's the validated JSON object. Serialization to the actual file
 * bytes happens at publish time in git-sync.
 */
const stages = new Map(); // key: projectId -> Map<filePath, stagedEntry>

function projectStage(projectId) {
  if (!stages.has(projectId)) stages.set(projectId, new Map());
  return stages.get(projectId);
}

export function stageChange(projectId, { path, schemaName, itemId, value, baseSha }) {
  const ps = projectStage(projectId);
  ps.set(path, { path, schemaName, itemId, value, baseSha, stagedAt: new Date().toISOString() });
  return listStaged(projectId);
}

export function unstage(projectId, filePath) {
  projectStage(projectId).delete(filePath);
  return listStaged(projectId);
}

export function getStaged(projectId, filePath) {
  return projectStage(projectId).get(filePath) || null;
}

export function listStaged(projectId) {
  return Array.from(projectStage(projectId).values());
}

export function clearStage(projectId) {
  projectStage(projectId).clear();
}

export function stageCount(projectId) {
  return projectStage(projectId).size;
}
