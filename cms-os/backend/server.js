/**
 * MOW CMS OS — Backend service entrypoint.
 * Zero-dependency Node HTTP server. Serves the API + the frontend SPA + the
 * shared schema engine (so the browser imports the exact same validator).
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router, sendJson } from './lib/http.js';
import * as auth from './lib/auth.js';
import * as projects from './lib/projects.js';
import * as store from './lib/store.js';
import * as sync from './lib/git-sync.js';
import * as shop from './lib/shop.js';
import * as translate from './lib/translate.js';
import { assertValid, validateContent } from './lib/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const router = new Router();

// ---- seed on boot ----
const seededAdmin = auth.ensureSeedAdmin();
// Register every MOW-managed site on each boot (survives free/no-disk restarts).
const seededProjects = projects.ensureSeedProjects();

// ---- CORS + auth context middleware ----
router.use((ctx) => {
  const { res, req } = ctx;
  res.setHeader('Access-Control-Allow-Origin', process.env.MOW_CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return false; }
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  ctx.state.user = auth.currentUser(auth.verifyToken(token));
});

// ---- helpers ----
function requireAuth(ctx, min = 'viewer') {
  if (!ctx.state.user) { const e = new Error('Authentication required.'); e.status = 401; throw e; }
  if (!auth.hasRole(ctx.state.user, min)) { const e = new Error('Insufficient role.'); e.status = 403; throw e; }
  return ctx.state.user;
}
function requireProject(ctx) {
  const p = projects.getProject(ctx.params.id);
  if (!p) { const e = new Error('Project not found.'); e.status = 404; throw e; }
  if (!auth.canAccessProject(ctx.state.user, p.id)) { const e = new Error('No access to this project.'); e.status = 403; throw e; }
  return p;
}

// ================= AUTH =================
router.post('/api/auth/login', async (ctx) => {
  const { email, password } = ctx.body || {};
  const result = auth.login(email, password);
  if (!result) { const e = new Error('Invalid email or password.'); e.status = 401; throw e; }
  return result;
});
router.get('/api/auth/me', (ctx) => { requireAuth(ctx); return { user: ctx.state.user }; });

// ================= USERS (admin) =================
router.get('/api/users', (ctx) => { requireAuth(ctx, 'admin'); return { users: auth.listUsers() }; });
router.post('/api/users', (ctx) => { requireAuth(ctx, 'admin'); return { user: auth.createUser(ctx.body) }; });
router.patch('/api/users/:uid', (ctx) => { requireAuth(ctx, 'admin'); return { user: auth.updateUser(ctx.params.uid, ctx.body) }; });
router.delete('/api/users/:uid', (ctx) => { requireAuth(ctx, 'admin'); auth.deleteUser(ctx.params.uid); return { ok: true }; });

// ================= PROJECTS =================
router.get('/api/projects', (ctx) => {
  requireAuth(ctx);
  const all = projects.listProjects();
  const visible = ctx.state.user.role === 'admin'
    ? all : all.filter((p) => auth.canAccessProject(ctx.state.user, p.id));
  return { projects: visible };
});
router.post('/api/projects', (ctx) => { requireAuth(ctx, 'admin'); return { project: projects.createProject(ctx.body) }; });
router.delete('/api/projects/:id', (ctx) => { requireAuth(ctx, 'admin'); projects.deleteProject(ctx.params.id); return { ok: true }; });
router.patch('/api/projects/:id', (ctx) => { requireAuth(ctx, 'admin'); return { project: projects.updateProject(ctx.params.id, ctx.body) }; });
// Translate a flat map of fields EN->target via Claude (editors+). Manual, on demand.
router.post('/api/projects/:id/translate', async (ctx) => {
  requireAuth(ctx, 'editor'); requireProject(ctx);
  const { from = 'en', to, fields } = ctx.body || {};
  if (!to || !fields) { const e = new Error('Provide { to, fields }.'); e.status = 400; throw e; }
  return { translations: await translate.translateFields(fields, from, to) };
});
router.get('/api/projects/:id/verify', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  return { repo: await projects.clientFor(p).verify() };
});

// ================= SCHEMAS =================
router.get('/api/projects/:id/schemas', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  return await projects.loadSchemas(p);
});
router.get('/api/projects/:id/schemas/:name', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const s = await projects.getSchema(p, ctx.params.name);
  if (!s) { const e = new Error('Schema not found.'); e.status = 404; throw e; }
  return { schema: s };
});

// ================= CONTENT =================
// List/read content for a schema. Single -> the doc; collection -> item list.
router.get('/api/projects/:id/content/:name', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const schema = await projects.getSchema(p, ctx.params.name);
  if (!schema) { const e = new Error('Schema not found.'); e.status = 404; throw e; }
  const gh = projects.clientFor(p);

  if (schema.kind === 'single') {
    const file = await gh.readFile(schema.path);
    const staged = store.getStaged(p.id, schema.path);
    const value = staged ? staged.value : (file ? sync.deserialize(schema, file.content, schema.path) : {});
    return { schema: schema.name, kind: 'single', path: schema.path, value, sha: file?.sha || null, staged: !!staged };
  }

  // collection
  let paths = [];
  if (schema.include && schema.include.length) paths = schema.include;
  else {
    const entries = await gh.listDir(schema.folder);
    paths = entries.filter((e) => e.type === 'file' && e.name.endsWith('.' + (schema.extension || 'json')))
      .map((e) => e.path);
  }
  const items = paths.map((pth) => ({
    path: pth,
    id: pth,
    label: pth.split('/').pop(),
    staged: !!store.getStaged(p.id, pth),
  }));
  return { schema: schema.name, kind: 'collection', items };
});

// Read a single document within a collection (or re-read a single schema doc).
router.get('/api/projects/:id/content/:name/doc', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const schema = await projects.getSchema(p, ctx.params.name);
  if (!schema) { const e = new Error('Schema not found.'); e.status = 404; throw e; }
  const filePath = ctx.query.path || schema.path;
  const gh = projects.clientFor(p);
  const file = await gh.readFile(filePath);
  const staged = store.getStaged(p.id, filePath);
  const value = staged ? staged.value : (file ? sync.deserialize(schema, file.content, filePath) : {});
  return { schema: schema.name, path: filePath, value, sha: file?.sha || null, staged: !!staged };
});

// Validate without staging (used for live form feedback if desired server-side).
router.post('/api/projects/:id/content/:name/validate', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const schema = await projects.getSchema(p, ctx.params.name);
  if (!schema) { const e = new Error('Schema not found.'); e.status = 404; throw e; }
  return validateContent(schema, ctx.body?.value);
});

// Stage a change (validated). Editors+ only.
router.post('/api/projects/:id/content/:name/stage', async (ctx) => {
  requireAuth(ctx, 'editor'); const p = requireProject(ctx);
  const schema = await projects.getSchema(p, ctx.params.name);
  if (!schema) { const e = new Error('Schema not found.'); e.status = 404; throw e; }
  const filePath = ctx.body?.path || schema.path;
  const coerced = assertValid(schema, ctx.body?.value);   // throws 422 if invalid
  store.stageChange(p.id, {
    path: filePath, schemaName: schema.name, itemId: ctx.body?.itemId || filePath,
    value: coerced, baseSha: ctx.body?.baseSha || null,
  });
  return { ok: true, staged: store.listStaged(p.id) };
});

// ================= MEDIA =================
// Upload an image straight to the repo (Contents API single-file commit).
// Editors+ only. Body: { folder, filename, dataUrl } — dataUrl is a
// "data:<mime>;base64,<payload>" string from FileReader.readAsDataURL.
router.post('/api/projects/:id/media/upload', async (ctx) => {
  const user = requireAuth(ctx, 'editor'); const p = requireProject(ctx);
  const { folder, filename, dataUrl } = ctx.body || {};
  if (!filename || !dataUrl) { const e = new Error('Provide { filename, dataUrl }.'); e.status = 400; throw e; }
  const m = /^data:([\w/.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) { const e = new Error('dataUrl must be a base64 data: URL.'); e.status = 400; throw e; }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const dest = (folder || 'uploads').replace(/^\/+|\/+$/g, '') + '/' + safeName;
  const gh = projects.clientFor(p);
  const result = await gh.commitBinaryFile({
    path: dest, base64Content: m[2],
    message: `Upload image: ${dest}`,
    author: user ? { name: user.name || user.email, email: user.email } : null,
  });
  return { ok: true, path: dest, sha: result.sha };
});

// ================= STAGING / PUBLISH =================
router.get('/api/projects/:id/staged', (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  return { staged: store.listStaged(p.id), count: store.stageCount(p.id) };
});
router.delete('/api/projects/:id/staged', (ctx) => {
  requireAuth(ctx, 'editor'); const p = requireProject(ctx);
  if (ctx.query.path) return { staged: store.unstage(p.id, ctx.query.path) };
  store.clearStage(p.id); return { staged: [] };
});
router.post('/api/projects/:id/staged/diff', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const entry = store.getStaged(p.id, ctx.body?.path);
  if (!entry) { const e = new Error('Nothing staged for that path.'); e.status = 404; throw e; }
  return await sync.diffStaged(p, entry);
});
router.post('/api/projects/:id/publish', async (ctx) => {
  const user = requireAuth(ctx, 'editor'); const p = requireProject(ctx);
  const result = await sync.publish(p, { user, message: ctx.body?.message, expectedHead: ctx.body?.expectedHead });
  return { ok: true, commit: result };
});

// ================= REVISIONS / DIFF / ROLLBACK =================
router.get('/api/projects/:id/revisions', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const gh = projects.clientFor(p);
  return { revisions: await gh.history(ctx.query.path || null, { limit: Number(ctx.query.limit) || 30 }) };
});
router.post('/api/projects/:id/diff', async (ctx) => {
  requireAuth(ctx); const p = requireProject(ctx);
  const { path: fp, schema, from, to } = ctx.body || {};
  return { changes: await sync.diffCommits(p, fp, schema, from, to) };
});
router.post('/api/projects/:id/rollback', async (ctx) => {
  const user = requireAuth(ctx, 'editor'); const p = requireProject(ctx);
  const { path: fp, sha } = ctx.body || {};
  return { ok: true, commit: await sync.rollback(p, { filePath: fp, sha, user }) };
});

// ================= SHOP / CHECKOUT (public) =================
// Public product catalog for storefronts (no secrets, active products only).
router.get('/api/projects/:id/shop/products', async (ctx) => {
  const p = projects.getProject(ctx.params.id);
  if (!p) { const e = new Error('Project not found.'); e.status = 404; throw e; }
  return { products: await shop.listProducts(p), stripeReady: !!(p.stripeSecretKey || process.env.MOW_STRIPE_SECRET_KEY) };
});

// Called by a site visitor's browser (no CMS login). Integrity is enforced
// server-side: prices are read from Git, never trusted from the client.
router.post('/api/projects/:id/checkout', async (ctx) => {
  const p = projects.getProject(ctx.params.id);
  if (!p) { const e = new Error('Project not found.'); e.status = 404; throw e; }
  const { items, successUrl, cancelUrl } = ctx.body || {};
  const session = await shop.createCheckoutSession(p, { items, successUrl, cancelUrl });
  return { url: session.url };
});

// ================= HEALTH =================
router.get('/api/health', () => ({ ok: true, service: 'mow-cms-os', time: new Date().toISOString() }));

// ================= STATIC (frontend + shared engine) =================
router.serveStatic('/shared', path.join(__dirname, '..', 'shared'));
router.serveStatic('/', path.join(__dirname, '..', 'frontend'), { spa: true });

// ---- boot ----
const server = http.createServer((req, res) => router.handle(req, res));
server.listen(PORT, () => {
  console.log(`\n  MOW CMS OS backend  →  http://localhost:${PORT}`);
  console.log(`  Frontend            →  http://localhost:${PORT}/`);
  if (seededAdmin) console.log(`  Seeded admin        →  ${seededAdmin.email} / ${seededAdmin.password}  (change this!)`);
  if (seededProjects && seededProjects.length) console.log(`  Seeded projects     →  ${seededProjects.join(', ')}`);
  if (!process.env.MOW_GITHUB_TOKEN) console.log(`  ⚠  No MOW_GITHUB_TOKEN set — set it to read/write the repo.`);
  console.log('');
});
