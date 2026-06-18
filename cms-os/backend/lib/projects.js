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

export function createProject({ label, owner, repo, branch = 'main', token, schemaFile, schemaRepoPath, previewUrl, stripeSecretKey }) {
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
  // 1. Try in-repo schema directory.
  if (project.schemaRepoPath) {
    try {
      const gh = clientFor(project);
      const entries = await gh.listDir(project.schemaRepoPath);
      const jsonFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
      if (jsonFiles.length) {
        const schemas = [];
        for (const f of jsonFiles) {
          const file = await gh.readFile(f.path);
          if (file) {
            const parsed = JSON.parse(file.content);
            if (Array.isArray(parsed.schemas)) schemas.push(...parsed.schemas);
            else schemas.push(parsed);
          }
        }
        if (schemas.length) return { project: project.id, schemas };
      }
    } catch { /* fall through to bundled */ }
  }
  // 2. Bundled fallback.
  const file = project.schemaFile || 'mow-site.json';
  const raw = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
  return { project: project.id, label: raw.label, schemas: raw.schemas };
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
