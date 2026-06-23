/**
 * Project registry. A "project" is a GitHub repo workspace (like a Webflow
 * site). Stored in backend/data/projects.json (operational config, gitignored).
 * Tokens may be per-project; otherwise the MOW_GITHUB_TOKEN env var is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GitHubClient } from './github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'projects.json');
const SCHEMA_DIR = path.join(__dirname, '..', '..', 'shared', 'schemas');

function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { projects: [] }; } }
function write(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

export function listProjects() {
  // Never expose secrets (GitHub token, Stripe key) to the client.
  return read().projects.map(({ token, stripeSecretKey, ...rest }) =>
    ({ ...rest, hasToken: !!token, hasStripe: !!stripeSecretKey }));
}
export function getProject(id) { return read().projects.find((p) => p.id === id); }

export function createProject({ label, owner, repo, branch = 'main', token, schemaFile, schemaRepoPath, previewUrl, stripeSecretKey, languages }) {
  const db = read();
  const id = slug(`${owner}-${repo}`);
  if (db.projects.some((p) => p.id === id)) throw new Error('Project already exists.');
  const project = {
    id, label: label || `${owner}/${repo}`, owner, repo, branch,
    token: token || null,
    stripeSecretKey: stripeSecretKey || null,  // server-side only; enables the shop
    previewUrl: previewUrl || null,        // embedded in the live-preview pane
    schemaFile: schemaFile || null,        // bundled file in shared/schemas
    schemaRepoPath: schemaRepoPath || '.mowcms/schemas', // in-repo schema dir
    languages: Array.isArray(languages) && languages.length ? languages : null, // enabled subset; null = all the schema declares
    createdAt: new Date().toISOString(),
  };
  db.projects.push(project);
  write(db);
  const { token: _t, ...safe } = project;
  return { ...safe, hasToken: !!project.token };
}

export function deleteProject(id) {
  const db = read();
  db.projects = db.projects.filter((p) => p.id !== id);
  write(db);
}

/** Update editable project fields (admin). Secret-preserving. Returns safe view. */
export function updateProject(id, patch = {}) {
  const db = read();
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw new Error('Project not found.');
  const allow = ['label', 'branch', 'previewUrl', 'schemaFile', 'schemaRepoPath', 'languages', 'token', 'stripeSecretKey'];
  for (const k of allow) {
    if (patch[k] === undefined) continue;
    if (k === 'languages') { p.languages = Array.isArray(patch.languages) && patch.languages.length ? patch.languages : null; }
    else p[k] = patch[k];
  }
  write(db);
  const { token, stripeSecretKey, ...safe } = p;
  return { ...safe, hasToken: !!token, hasStripe: !!stripeSecretKey };
}

/**
 * Produce a per-project "effective" copy of the schemas given which languages
 * are enabled. A language is a top-level object field whose name is one of the
 * schema's declared `languages`. Disabled languages are kept in the schema (so
 * existing content stays valid and re-enabling is lossless) but marked hidden
 * and stripped of `required`, so the form skips them and validation passes.
 */
export function applyLanguageToggle(schemas, available, enabled) {
  if (!Array.isArray(available) || !available.length) return schemas;
  const avail = new Set(available);
  const on = new Set(enabled && enabled.length ? enabled : available);
  const stripRequired = (fields) => (fields || []).map((f) => {
    const c = { ...f };
    delete c.required;
    if (c.fields) c.fields = stripRequired(c.fields);
    if (c.of && c.of.fields) c.of = { ...c.of, fields: stripRequired(c.of.fields) };
    return c;
  });
  return schemas.map((s) => ({
    ...s,
    fields: (s.fields || []).map((f) =>
      (f.type === 'object' && avail.has(f.name) && !on.has(f.name))
        ? { ...f, ui: { ...(f.ui || {}), hidden: true }, fields: stripRequired(f.fields) }
        : f),
  }));
}

export function clientFor(project) {
  const token = project.token || process.env.MOW_GITHUB_TOKEN;
  if (!token) throw new Error('No GitHub token configured for this project.');
  return new GitHubClient({ token, owner: project.owner, repo: project.repo, branch: project.branch });
}

/**
 * Resolve the schema set for a project. Priority:
 *  1. in-repo schemas at schemaRepoPath (Git-native, travels with content)
 *  2. bundled schemaFile in shared/schemas
 * Returns { project, label, schemas: [...] }.
 */
export async function loadSchemas(project) {
  let schemas = null;
  let label;
  const available = [];
  // 1. Try in-repo schema directory.
  if (project.schemaRepoPath) {
    try {
      const gh = clientFor(project);
      const entries = await gh.listDir(project.schemaRepoPath);
      const jsonFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
      if (jsonFiles.length) {
        const acc = [];
        for (const f of jsonFiles) {
          const file = await gh.readFile(f.path);
          if (file) {
            const parsed = JSON.parse(file.content);
            if (Array.isArray(parsed.languages)) available.push(...parsed.languages);
            if (Array.isArray(parsed.schemas)) acc.push(...parsed.schemas);
            else acc.push(parsed);
          }
        }
        if (acc.length) schemas = acc;
      }
    } catch { /* fall through to bundled */ }
  }
  // 2. Bundled fallback.
  if (!schemas) {
    const file = project.schemaFile || 'mow-site.json';
    const raw = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
    schemas = raw.schemas;
    label = raw.label;
    if (Array.isArray(raw.languages)) available.push(...raw.languages);
  }
  const avail = [...new Set(available)];
  const enabled = (Array.isArray(project.languages) && project.languages.length)
    ? project.languages.filter((l) => avail.includes(l))
    : avail;
  const effective = applyLanguageToggle(schemas, avail, enabled);
  return { project: project.id, label, schemas: effective, languages: { available: avail, enabled } };
}

export async function getSchema(project, name) {
  const { schemas } = await loadSchemas(project);
  return schemas.find((s) => s.name === name);
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

/** Seed an example MOW project if registry empty and env owner/repo provided. */
export function ensureSeedProject() {
  const db = read();
  if (db.projects.length > 0) return null;
  const owner = process.env.MOW_REPO_OWNER || 'manoftheworldmedia';
  const repo = process.env.MOW_REPO_NAME || 'mow';
  return createProject({
    label: 'Man of the World — Site', owner, repo,
    branch: process.env.MOW_REPO_BRANCH || 'main',
    schemaFile: 'mow-site.json',
    previewUrl: process.env.MOW_PREVIEW_URL || 'https://www.mow.media',
  });
}

const SEED_FILE = path.join(__dirname, '..', 'data', 'seed-projects.json');

/**
 * Create a project, or refresh its descriptive fields if it already exists.
 * Idempotent and secret-preserving: never clears an existing token / Stripe key.
 */
export function upsertProject(spec) {
  const id = slug(`${spec.owner}-${spec.repo}`);
  const db = read();
  const existing = db.projects.find((p) => p.id === id);
  if (!existing) return createProject(spec);
  existing.label = spec.label || existing.label;
  existing.branch = spec.branch || existing.branch;
  existing.previewUrl = spec.previewUrl || existing.previewUrl;
  existing.schemaRepoPath = spec.schemaRepoPath || existing.schemaRepoPath || '.mowcms/schemas';
  if (spec.schemaFile) existing.schemaFile = spec.schemaFile;
  write(db);
  return existing;
}

/** The canonical MOW-managed sites, used when no seed file is present. */
function defaultSeeds() {
  return [
    { label: 'Man of the World — Site', owner: 'manoftheworldmedia', repo: 'mow', branch: 'main', schemaFile: 'mow-site.json', previewUrl: 'https://www.mow.media' },
    { label: 'Bananos Inteligentes', owner: 'manoftheworldmedia', repo: 'Bananos-Inteligentes', branch: 'main', previewUrl: 'https://bananosinteligentes.com' },
    { label: 'All Model Repair', owner: 'manoftheworldmedia', repo: 'all-model-repair', branch: 'main', previewUrl: 'https://allmodelrepair.com' },
    { label: 'Caspian Coast Coffee', owner: 'manoftheworldmedia', repo: 'caspiancoast', branch: 'main', previewUrl: 'https://caspiancoast.com' },
  ];
}

/**
 * Ensure every MOW-managed site is registered, on EVERY boot. This is what
 * keeps all projects visible to the admin even on a free/no-disk host where
 * data/projects.json does not survive restarts. Reads data/seed-projects.json
 * if present (so new sites are added by editing one committed file), otherwise
 * falls back to the built-in list. Upserts — existing projects (and their
 * tokens) are left intact. Returns the ids of projects newly created.
 */
export function ensureSeedProjects() {
  let seeds;
  try { seeds = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch { seeds = null; }
  if (!Array.isArray(seeds) || !seeds.length) seeds = defaultSeeds();
  const created = [];
  for (const s of seeds) {
    if (!s || !s.owner || !s.repo) continue;
    const id = slug(`${s.owner}-${s.repo}`);
    const before = getProject(id);
    upsertProject(s);
    if (!before) created.push(id);
  }
  return created;
}
