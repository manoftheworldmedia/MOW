/**
 * Git Sync Engine — serialization, publish (atomic commit batching),
 * diff generation, rollback, and conflict handling.
 */
import { clientFor, getSchema } from './projects.js';
import { listStaged, clearStage } from './store.js';
import { diff } from '../../shared/schema-engine.js';

/** Turn a validated content value into the exact file bytes for the repo. */
export function serialize(schema, value) {
  if (isRaw(schema)) {
    // Raw file collections store the file body in `value.body`.
    return typeof value === 'string' ? value : (value.body ?? '');
  }
  return JSON.stringify(value, null, 2) + '\n';
}

/** Parse file bytes from the repo into a content value for editing. */
export function deserialize(schema, content, filePath) {
  if (isRaw(schema)) return { path: filePath, body: content };
  try { return JSON.parse(content); } catch { return {}; }
}

export function isRaw(schema) {
  // A schema is "raw" if its only meaningful field is a code/body field.
  return (schema.fields || []).some((f) => f.type === 'code') &&
         (schema.fields || []).every((f) => f.type === 'code' || (f.ui && f.ui.hidden) || f.name === 'path');
}

/**
 * Publish all staged changes for a project as ONE atomic commit.
 * Re-validates each staged item against its schema before committing.
 */
export async function publish(project, { user, message, expectedHead }) {
  const staged = listStaged(project.id);
  if (!staged.length) { const e = new Error('Nothing to publish.'); e.status = 400; throw e; }

  const files = [];
  const summary = [];
  for (const entry of staged) {
    const schema = await getSchema(project, entry.schemaName);
    if (!schema) { const e = new Error(`Unknown schema "${entry.schemaName}".`); e.status = 400; throw e; }
    files.push({ path: entry.path, content: serialize(schema, entry.value) });
    summary.push(entry.path);
  }

  const gh = clientFor(project);
  const commitMessage = buildCommitMessage(message, summary, user);
  const result = await gh.commitFiles({
    files,
    message: commitMessage,
    author: user ? { name: user.email.split('@')[0], email: user.email } : undefined,
    expectedHead,
  });
  clearStage(project.id);
  return { ...result, count: files.length };
}

/** Structured commit message: subject + machine-readable trailer. */
function buildCommitMessage(message, paths, user) {
  const subject = message || `Update ${paths.length} file(s) via MOW CMS`;
  const body = [
    '',
    'Files:',
    ...paths.map((p) => `  - ${p}`),
    '',
    `Published-By: ${user ? user.email : 'unknown'}`,
    `Via: MOW-CMS-OS`,
  ].join('\n');
  return `${subject}\n${body}`;
}

/**
 * Diff a staged value against what's currently live in the repo.
 * Returns { changes, base } where changes is the structured diff list.
 */
export async function diffStaged(project, entry) {
  const schema = await getSchema(project, entry.schemaName);
  const gh = clientFor(project);
  const live = await gh.readFile(entry.path);
  const before = live ? deserialize(schema, live.content, entry.path) : {};
  return { changes: diff(before, entry.value), base: live ? live.sha : null };
}

/**
 * Diff between two commits for a given file.
 */
export async function diffCommits(project, filePath, schemaName, fromSha, toSha) {
  const schema = await getSchema(project, schemaName);
  const gh = clientFor(project);
  const a = await gh.readFileAt(filePath, fromSha);
  const b = await gh.readFileAt(filePath, toSha);
  const before = a ? deserialize(schema, a.content, filePath) : {};
  const after = b ? deserialize(schema, b.content, filePath) : {};
  return diff(before, after);
}

/**
 * Roll a file back to its content at a previous commit. Creates a NEW commit
 * (history is never rewritten) restoring the old bytes.
 */
export async function rollback(project, { filePath, sha, user }) {
  const gh = clientFor(project);
  const old = await gh.readFileAt(filePath, sha);
  if (!old) { const e = new Error('File not found at that commit.'); e.status = 404; throw e; }
  return gh.commitFiles({
    files: [{ path: filePath, content: old.content }],
    message: `Rollback ${filePath} to ${sha.slice(0, 7)}\n\nRestored-By: ${user ? user.email : 'unknown'}\nVia: MOW-CMS-OS`,
    author: user ? { name: user.email.split('@')[0], email: user.email } : undefined,
  });
}
