/**
 * Git Sync Engine — serialization, publish (atomic commit batching),
 * diff generation, rollback, and conflict handling.
 */
import { clientFor, getSchema } from './projects.js';
import { listStaged, clearStage } from './store.js';
import { diff } from '../../shared/schema-engine.js';
import { buildMenuJsonLdFile } from './menu-schema.js';
import { validateContent } from './validation.js';

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
  const schemas = [];
  const problems = [];
  for (const entry of staged) {
    const schema = await getSchema(project, entry.schemaName);
    if (!schema) { const e = new Error(`Unknown schema "${entry.schemaName}".`); e.status = 400; throw e; }
    // Validation gate: content is staged freely but only VALID content is
    // committed (Zero Drift). Collect every offending field across all docs.
    const { valid, errors } = validateContent(schema, entry.value);
    if (!valid) for (const err of errors) problems.push({ path: entry.path, field: err.path, message: err.message });
    files.push({ path: entry.path, content: serialize(schema, entry.value) });
    summary.push(entry.path);
    schemas.push(schema);
  }
  if (problems.length) {
    const e = new Error(`Can't publish — ${problems.length} field(s) need attention across ${new Set(problems.map((p) => p.path)).size} document(s).`);
    e.status = 422; e.errors = problems; throw e;
  }

  const gh = clientFor(project);

  // Automatic schema projection (Zero-Maintenance SEO): any schema that
  // declares a `jsonld` target gets its structured data (re)generated into a
  // STATIC page in the SAME atomic commit — so search engines AND JS-blind AI
  // crawlers read it straight from the HTML. Best-effort: a projection failure
  // (e.g. the target page doesn't exist yet) never blocks a publish.
  const emitted = new Set(files.map((f) => f.path));
  const mediaBase = project.previewUrl ? project.previewUrl.replace(/\/$/, '') + '/' : '';
  for (let i = 0; i < staged.length; i++) {
    const schema = schemas[i];
    if (!schema || !schema.jsonld) continue;
    try {
      const derived = await buildMenuJsonLdFile(staged[i].value, schema, {
        readFile: (p) => gh.readFile(p),
        mediaBase,
        siteUrl: project.previewUrl || '',
      });
      if (derived && !emitted.has(derived.path)) {
        files.push(derived);
        summary.push(derived.path);
        emitted.add(derived.path);
      }
    } catch { /* schema projection is best-effort — never block a publish */ }
  }
  // Auto-maintain collection indexes (e.g. content/articles.index.json) for
  // schemas that declare `index`. Static sites can't list a Git folder at
  // runtime, so the index file is the source of truth for what the live
  // front-end renders — it must stay in sync with the folder automatically,
  // or newly published items silently never appear.
  const indexedSchemas = new Map();
  for (const schema of schemas) {
    if (schema.index && schema.folder && !indexedSchemas.has(schema.name)) indexedSchemas.set(schema.name, schema);
  }
  for (const schema of indexedSchemas.values()) {
    const derived = await buildCollectionIndexFile(schema, { gh, staged, files });
    if (derived && !emitted.has(derived.path)) {
      files.push(derived);
      summary.push(derived.path);
      emitted.add(derived.path);
    }
  }

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

/**
 * Regenerate a collection's index file (e.g. content/articles.index.json) —
 * a flat array of slugs, sorted, that static front-ends fetch instead of
 * listing the Git folder. Combines the live folder listing with any
 * adds/deletes in this publish batch, then sorts by `schema.index.sortBy`.
 */
async function buildCollectionIndexFile(schema, { gh, staged, files }) {
  const { path: indexPath, sortBy, order = 'desc' } = schema.index;
  const slugOf = (p) => p.slice(schema.folder.length + 1).replace(/\.[^/.]+$/, '');

  const live = await gh.listDir(schema.folder);
  const ext = '.' + (schema.extension || 'json');
  const slugs = new Set(live.filter((e) => e.type === 'file' && e.name.endsWith(ext)).map((e) => slugOf(e.path)));

  const batchValues = new Map(); // slug -> value, for items touched in this publish
  for (let i = 0; i < staged.length; i++) {
    const entry = staged[i];
    if (entry.schemaName !== schema.name) continue;
    const slug = slugOf(entry.path);
    if (entry.delete) { slugs.delete(slug); continue; }
    slugs.add(slug);
    batchValues.set(slug, entry.value);
  }
  if (!slugs.size) return { path: indexPath, content: '[]\n' };

  const withSortKey = await Promise.all([...slugs].map(async (slug) => {
    if (batchValues.has(slug)) return { slug, key: batchValues.get(slug)?.[sortBy] };
    const file = await gh.readFile(`${schema.folder}/${slug}${ext}`);
    let value = {};
    try { value = file ? JSON.parse(file.content) : {}; } catch { /* ignore malformed */ }
    return { slug, key: value[sortBy] };
  }));
  withSortKey.sort((a, b) => {
    const av = a.key || '', bv = b.key || '';
    return order === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
  });

  return { path: indexPath, content: JSON.stringify(withSortKey.map((x) => x.slug), null, 2) + '\n' };
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
