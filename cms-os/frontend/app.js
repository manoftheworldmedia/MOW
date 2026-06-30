/**
 * MOW CMS OS — frontend application.
 * Vanilla ESM SPA: auth, project switching, schema-driven editor, autosave-to-
 * staging, live preview, publish (atomic commit), and revision history/rollback.
 */
import { api, getToken, setToken } from '/api.js';
import { SchemaForm, h } from '/forms.js';
import { defaultsFor } from '/shared/schema-engine.js';

const app = document.getElementById('app');
const state = {
  user: null,
  projects: [],
  projectId: localStorage.getItem('mow_cms_project') || null,
  schemas: [],
  languages: { available: [], enabled: [] },
  active: null,        // { schema, path }
  form: null,
  stagedCount: 0,
  saveStatus: 'idle',  // idle|dirty|saving|saved|error
  undoStack: [],
  undoDebounceTimer: null,
  lastUndoSnapshot: null,
  editorSchema: null,
  editorPath: null,
};

// ---------------- toast ----------------
function toast(msg, kind = 'info', ms = 3200) {
  const stack = document.getElementById('toast');
  const t = h('div', { class: `toast ${kind}` }, msg);
  stack.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------- global error surfacing ----------------
// Auto-translate browser extensions can mutate the DOM and throw benign
// "removeChild" errors; we swallow those and surface anything else as a toast.
function isBenignDomError(msg) {
  return /removeChild|insertBefore|not a child of this node/i.test(msg || '');
}
window.addEventListener('error', (e) => {
  if (isBenignDomError(e.message)) { e.preventDefault?.(); return; }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  if (isBenignDomError(msg)) return;
  toast(msg || 'Something went wrong', 'error');
});

// Cmd/Ctrl+Z — form-level undo; skip when focus is inside a text input so native browser undo still works there
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    doUndo();
  }
});

// ---------------- boot ----------------
(async function boot() {
  if (getToken()) {
    try { const { user } = await api.me(); state.user = user; await loadProjects(); return renderApp(); }
    catch { setToken(null); }
  }
  renderLogin();
})();

// ---------------- login ----------------
function renderLogin() {
  app.innerHTML = '';
  const email = h('input', { type: 'email', placeholder: 'you@mow.media', value: '' });
  const pass = h('input', { type: 'password', placeholder: '••••••••' });
  const err = h('div', { class: 'err' });
  const submit = async (e) => {
    e?.preventDefault();
    err.textContent = '';
    try {
      const { token, user } = await api.login(email.value.trim(), pass.value);
      setToken(token); state.user = user;
      await loadProjects(); renderApp();
    } catch (ex) { err.textContent = ex.message; }
  };
  const form = h('form', { onsubmit: submit },
    h('h1', { class: 'logo' }, 'MOW ', h('b', {}, 'CMS OS')),
    h('p', { class: 'sub' }, 'Content Operating System'),
    h('div', { class: 'field' }, h('label', {}, 'Email'), email),
    h('div', { class: 'field' }, h('label', {}, 'Password'), pass),
    err,
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;justify-content:center;margin-top:8px' }, 'Sign in'),
  );
  app.appendChild(h('div', { class: 'center' }, h('div', { class: 'login-wrap' }, form)));
  email.focus();
}

// ---------------- data ----------------
async function loadProjects() {
  const { projects } = await api.projects();
  state.projects = projects;
  if (!state.projectId || !projects.find((p) => p.id === state.projectId)) {
    state.projectId = projects[0]?.id || null;
  }
  if (state.projectId) await loadSchemas();
}
async function loadSchemas() {
  if (!state.projectId) { state.schemas = []; state.languages = { available: [], enabled: [] }; return; }
  const { schemas, languages } = await api.schemas(state.projectId);
  state.schemas = schemas;
  state.languages = languages || { available: [], enabled: [] };
  await refreshStaged();
}
async function refreshStaged() {
  if (!state.projectId) return;
  try { const { count } = await api.staged(state.projectId); state.stagedCount = count; updatePublishBar(); }
  catch { /* ignore */ }
}

// ---------------- app shell ----------------
function renderApp() {
  app.innerHTML = '';
  app.appendChild(renderTopbar());
  const ws = h('div', { class: 'workspace' });
  ws.appendChild(renderSidebar());
  const main = h('div', { class: 'main', id: 'main' });
  ws.appendChild(main);
  app.appendChild(ws);
  app.appendChild(renderPublishBar());

  if (!state.projectId) { main.appendChild(renderNoProject()); return; }
  // open first single schema by default
  const first = state.schemas.find((s) => s.kind === 'single') || state.schemas[0];
  if (first) openSchema(first);
  else main.appendChild(h('div', { class: 'empty-state' }, 'No schemas found for this project.'));
}

function renderTopbar() {
  const picker = h('select', { class: 'project-pick',
    onchange: async (e) => {
      state.projectId = e.target.value; localStorage.setItem('mow_cms_project', state.projectId);
      state.active = null; await loadSchemas(); renderApp();
    } });
  for (const p of state.projects) {
    const o = h('option', { value: p.id }, p.label); if (p.id === state.projectId) o.selected = true; picker.appendChild(o);
  }
  const badge = state.stagedCount ? h('span', { class: 'publish-badge', id: 'staged-badge' }, String(state.stagedCount)) : '';
  const tools = [];
  if (state.user.role === 'admin') {
    tools.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: openProjectsManager }, '⊞ Projects'));
    tools.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: openUsersManager }, '👤 Users'));
  }
  return h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, 'MOW ', h('b', {}, 'CMS')),
    picker,
    badge,
    h('div', { class: 'spacer' }),
    ...tools,
    h('span', { class: `pill role-${state.user.role}` }, state.user.role),
    h('span', { class: 'who' }, state.user.email),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { setToken(null); location.reload(); } }, 'Sign out'),
  );
}

function renderSidebar() {
  const sb = h('div', { class: 'sidebar', id: 'sidebar' });
  const singles = state.schemas.filter((s) => s.kind === 'single');
  const collections = state.schemas.filter((s) => s.kind === 'collection');
  if (singles.length) {
    sb.appendChild(h('h4', {}, 'Content'));
    for (const s of singles) sb.appendChild(navItem(s));
  }
  if (collections.length) {
    sb.appendChild(h('h4', {}, 'Collections'));
    for (const s of collections) sb.appendChild(navItem(s));
  }
  sb.appendChild(h('h4', {}, 'History'));
  sb.appendChild(h('div', { class: 'nav-item', onclick: () => openHistory(null) },
    h('span', { class: 'ic' }, '🕘'), 'All revisions'));
  return sb;
}

function navItem(schema) {
  const active = state.active && state.active.schema.name === schema.name;
  return h('div', {
    class: 'nav-item' + (active ? ' active' : ''),
    onclick: () => openSchema(schema),
  }, h('span', { class: 'ic' }, iconFor(schema)), schema.label || schema.name);
}
function iconFor(s) { return ({ home: '🏠', menu: '☰', file: '📄' })[s.icon] || (s.kind === 'collection' ? '🗂' : '📄'); }

function renderNoProject() {
  return h('div', { class: 'page' },
    h('h1', {}, 'No project yet'),
    h('p', { class: 'lead' }, 'Connect a GitHub repository to start editing content.'),
    state.user.role === 'admin'
      ? h('button', { class: 'btn btn-primary', onclick: openProjectsManager }, '+ Connect a repository')
      : h('p', { class: 'muted' }, 'Ask an admin to grant you access to a project.'),
  );
}

// ---------------- editor ----------------
async function openSchema(schema) {
  state.active = { schema };
  // refresh sidebar active state
  const sb = document.getElementById('sidebar');
  if (sb) { sb.replaceWith(renderSidebar()); }
  const main = document.getElementById('main');
  main.innerHTML = '';
  main.appendChild(h('div', { class: 'center' }, h('div', { class: 'spinner' })));

  if (schema.kind === 'collection') return openCollection(schema);

  try {
    const data = await api.content(state.projectId, schema.name);
    renderEditor(schema, data.path, data.value);
  } catch (ex) { main.innerHTML = ''; main.appendChild(errorPane(ex)); }
}

async function openCollection(schema) {
  const main = document.getElementById('main');
  try {
    const { items } = await api.content(state.projectId, schema.name);
    main.innerHTML = '';
    main.appendChild(h('div', { class: 'editor-head' },
      h('h2', {}, schema.label),
      h('div', { style: 'flex:1' }),
      state.user.role !== 'viewer' ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => createDoc(schema) }, '+ New') : null,
    ));
    const page = h('div', { class: 'page' });
    if (!items.length) page.appendChild(h('div', { class: 'empty-state' }, 'No documents yet — click “+ New” to add one.'));
    const cards = h('div', { class: 'cards' });
    for (const it of items) {
      cards.appendChild(h('div', { class: 'card', onclick: () => openDoc(schema, it.path) },
        h('h3', {}, it.label, it.staged ? h('span', { class: 'publish-badge' }, 'edited') : ''),
        h('div', { class: 'meta' }, it.path),
      ));
    }
    page.appendChild(cards);
    main.appendChild(page);
  } catch (ex) { main.innerHTML = ''; main.appendChild(errorPane(ex)); }
}

function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Create a brand-new document in a collection. It opens an empty (defaulted)
// editor; the file is actually created in Git on the next Publish.
function createDoc(schema) {
  const name = prompt(`New ${schema.label}\n\nEnter a short name/slug (letters, numbers, dashes):`);
  if (!name) return;
  const slug = slugify(name);
  if (!slug) return toast('Please use letters, numbers, or dashes.', 'error');
  const ext = schema.extension || 'json';
  const folder = (schema.folder || '.').replace(/\/$/, '');
  const path = folder === '.' ? `${slug}.${ext}` : `${folder}/${slug}.${ext}`;
  const value = defaultsFor(schema);
  if (schema.primaryField && Object.prototype.hasOwnProperty.call(value, schema.primaryField)) {
    value[schema.primaryField] = slug;
  }
  renderEditor(schema, path, value, true);
  toast('New item created — fill it in, then Publish to save it.', 'info', 4500);
}

async function openDoc(schema, path) {
  const main = document.getElementById('main');
  main.innerHTML = '';
  main.appendChild(h('div', { class: 'center' }, h('div', { class: 'spinner' })));
  try {
    const data = await api.doc(state.projectId, schema.name, path);
    renderEditor(schema, data.path, data.value, true);
  } catch (ex) { main.innerHTML = ''; main.appendChild(errorPane(ex)); }
}

function isRawSchema(schema) {
  return (schema.fields || []).some((f) => f.type === 'code') &&
         (schema.fields || []).every((f) => f.type === 'code' || (f.ui && f.ui.hidden) || f.name === 'path');
}

function renderEditor(schema, path, value, isDoc = false) {
  const main = document.getElementById('main');
  main.innerHTML = '';
  const raw = isRawSchema(schema);

  const saveInd = h('div', { class: 'save-indicator', id: 'save-ind' }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, 'Up to date'));
  const head = h('div', { class: 'editor-head' },
    isDoc ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openSchema(schema) }, '← Back') : null,
    h('h2', {}, schema.label),
    h('span', { class: 'path' }, path),
    h('div', { class: 'spacer', style: 'flex:1' }),
    saveInd,
    h('button', { class: 'btn btn-sm btn-ghost', id: 'undo-btn', disabled: true, title: 'Nothing to undo', onclick: doUndo }, '↩ Undo'),
    h('button', { class: 'btn btn-sm', onclick: () => openHistory(path) }, '🕘 History'),
  );
  main.appendChild(head);

  const body = h('div', { class: 'editor-body' });
  const formPane = h('div', { class: 'form-pane with-preview' });
  const previewPane = renderPreview(schema, value, raw);
  body.appendChild(formPane);
  body.appendChild(previewPane.el);
  main.appendChild(body);

  const form = new SchemaForm(schema, value, {
    mediaBase: previewMediaBase(),
    languages: (state.languages && state.languages.available) || [],
    sourceLang: 'en',
    sourceLangLabel: 'English',
    onTranslate: async (toLang, sourceFields) => {
      const { translations } = await api.translate(state.projectId, { from: 'en', to: toLang, fields: sourceFields });
      return translations;
    },
    onError: (e) => toast('Translate failed: ' + e.message, 'error'),
    onChange: (val) => {
      setSaveStatus('dirty');
      previewPane.update(val);
      scheduleSave(schema, path, form);
      scheduleUndoPush();
    },
  });
  state.form = form;
  state.editorSchema = schema;
  state.editorPath = path;
  state.undoStack = [];
  state.lastUndoSnapshot = JSON.parse(JSON.stringify(value || {}));
  formPane.appendChild(form.render());
  form.validateAndPaint();
  updateUndoButton();
}

function errorPane(ex) {
  return h('div', { class: 'page' },
    h('h1', {}, 'Could not load content'),
    h('p', { class: 'lead' }, ex.message),
    h('p', { class: 'muted' }, ex.status === 401 ? 'Your session expired — sign in again.'
      : 'Check that the project has a valid GitHub token and the repo is reachable (/api/projects/:id/verify).'),
  );
}

// ---------------- preview ----------------
function projectPreviewUrl() {
  const p = state.projects.find((x) => x.id === state.projectId);
  return (p && p.previewUrl) || null;
}
function previewMediaBase() {
  const u = projectPreviewUrl();
  return u ? u.replace(/\/$/, '') + '/' : '';
}

function renderPreview(schema, value, raw) {
  const el = h('div', { class: 'preview-pane' });
  if (raw) {
    const iframe = h('iframe', { sandbox: 'allow-same-origin' });
    el.appendChild(iframe);
    const update = (val) => { iframe.srcdoc = (val && val.body) || ''; };
    update(value);
    return { el, update };
  }
  const url = projectPreviewUrl();
  if (url) {
    const iframe = h('iframe', { src: url });
    el.appendChild(iframe);
    return { el, update: () => {} };
  }
  el.classList.remove('preview-pane'); el.className = 'preview-empty';
  el.appendChild(h('div', {}, h('p', {}, '🪟  Live preview'),
    h('p', { class: 'muted', style: 'font-size:12px;max-width:240px;text-align:center' },
      'Structured changes appear on the site after you publish. Set a "previewUrl" on the project to embed the live site here.')));
  return { el, update: () => {} };
}

// ---------------- autosave -> staging ----------------
let saveTimer = null;
function scheduleSave(schema, path, form) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => doSave(schema, path, form), 800);
}
async function doSave(schema, path, form) {
  const { valid, errors } = form.validateAndPaint();
  if (!valid) { setSaveStatus('error', `${errors.length} field(s) need attention`); return; }
  setSaveStatus('saving');
  try {
    await api.stage(state.projectId, schema.name, { path, value: form.value });
    setSaveStatus('saved');
    await refreshStaged();
  } catch (ex) {
    setSaveStatus('error', ex.message);
    if (ex.errors) for (const e of ex.errors) toast(`${e.path}: ${e.message}`, 'error');
  }
}
function setSaveStatus(status, msg) {
  state.saveStatus = status;
  const ind = document.getElementById('save-ind');
  if (!ind) return;
  ind.className = `save-indicator ${status}`;
  const txt = { idle: 'Up to date', dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'Saved to staging', error: msg || 'Validation error' }[status];
  ind.querySelector('.txt').textContent = txt;
}

// ---------------- undo ----------------
function scheduleUndoPush() {
  clearTimeout(state.undoDebounceTimer);
  const snapshot = state.lastUndoSnapshot;
  state.undoDebounceTimer = setTimeout(() => {
    if (snapshot != null) {
      const top = state.undoStack[state.undoStack.length - 1];
      if (!top || JSON.stringify(top) !== JSON.stringify(snapshot)) {
        state.undoStack.push(snapshot);
        if (state.undoStack.length > 20) state.undoStack.shift();
      }
    }
    state.lastUndoSnapshot = state.form ? JSON.parse(JSON.stringify(state.form.value)) : null;
    updateUndoButton();
  }, 800);
}

function doUndo() {
  if (!state.undoStack.length || !state.form) return;
  clearTimeout(state.undoDebounceTimer);
  const prev = state.undoStack.pop();
  state.form.value = prev;
  state.form.rerender();
  state.lastUndoSnapshot = JSON.parse(JSON.stringify(prev));
  setSaveStatus('dirty');
  if (state.editorSchema && state.editorPath) scheduleSave(state.editorSchema, state.editorPath, state.form);
  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  const count = state.undoStack.length;
  btn.disabled = count === 0;
  btn.title = count > 0 ? `Undo (${count} step${count === 1 ? '' : 's'} available)` : 'Nothing to undo';
}

// ---------------- publish bar ----------------
function renderPublishBar() {
  const bar = h('div', { class: 'publish-bar', id: 'publish-bar', style: state.stagedCount ? '' : 'display:none' });
  updatePublishBarInto(bar);
  return bar;
}
function updatePublishBar() {
  const bar = document.getElementById('publish-bar');
  if (!bar) return;
  bar.style.display = state.stagedCount ? '' : 'none';
  updatePublishBarInto(bar);
  const badge = document.getElementById('staged-badge');
  if (badge) badge.textContent = String(state.stagedCount);
  else if (state.stagedCount) { const tb = document.querySelector('.topbar .project-pick'); /* re-render topbar lazily */ }
}
function updatePublishBarInto(bar) {
  bar.innerHTML = '';
  bar.appendChild(h('span', { class: 'status' }, h('b', {}, String(state.stagedCount)), ` change${state.stagedCount === 1 ? '' : 's'} staged`));
  bar.appendChild(h('button', { class: 'btn btn-sm btn-ghost', onclick: openStagedReview }, 'Review'));
  bar.appendChild(h('button', { class: 'btn btn-sm btn-ghost btn-danger', onclick: discardAll }, 'Discard'));
  bar.appendChild(h('button', { class: 'btn btn-primary', onclick: openPublishModal, disabled: state.user.role === 'viewer' }, '↑ Publish'));
}

async function discardAll() {
  if (!confirm('Discard all staged changes? This cannot be undone.')) return;
  await api.unstage(state.projectId);
  await refreshStaged();
  toast('Staged changes discarded', 'info');
  if (state.active) openSchema(state.active.schema);
}

async function openStagedReview() {
  const { staged } = await api.staged(state.projectId);
  const body = h('div', {});
  if (!staged.length) body.appendChild(h('p', { class: 'muted' }, 'Nothing staged.'));
  for (const entry of staged) {
    const block = h('div', { style: 'margin-bottom:18px' });
    block.appendChild(h('div', { class: 'row' },
      h('strong', { class: 'mono' }, entry.path),
      h('button', { class: 'btn btn-sm btn-ghost btn-danger', onclick: async () => { await api.unstage(state.projectId, entry.path); await refreshStaged(); modal.close(); openStagedReview(); } }, 'Unstage')));
    const diffBox = h('div', { class: 'muted', style: 'font-size:12px' }, 'Loading diff…');
    block.appendChild(diffBox);
    api.stagedDiff(state.projectId, entry.path).then(({ changes }) => {
      diffBox.innerHTML = '';
      if (!changes.length) { diffBox.textContent = 'No differences vs. live.'; return; }
      for (const c of changes.slice(0, 50)) diffBox.appendChild(renderDiffRow(c));
    }).catch((e) => { diffBox.textContent = e.message; });
    body.appendChild(block);
  }
  const modal = openModal('Review staged changes', body, [
    { label: 'Close', onClick: () => modal.close() },
    { label: '↑ Publish', primary: true, onClick: () => { modal.close(); openPublishModal(); } },
  ]);
}

function renderDiffRow(c) {
  return h('div', { class: 'diff-row' },
    h('div', { class: 'dpath' }, h('span', { class: `op-${c.op}` }, `[${c.op}] `), c.path),
    c.before !== undefined ? h('div', { class: 'diff-before' }, '− ' + truncate(c.before)) : null,
    c.after !== undefined ? h('div', { class: 'diff-after' }, '+ ' + truncate(c.after)) : null,
  );
}
function truncate(v) { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 160 ? s.slice(0, 160) + '…' : s; }

function openPublishModal() {
  const msg = h('input', { type: 'text', placeholder: 'Describe this change (commit message)' });
  const body = h('div', {},
    h('p', { class: 'muted' }, `Publishing ${state.stagedCount} change(s) as one atomic commit to GitHub.`),
    h('div', { class: 'field' }, h('label', {}, 'Commit message'), msg));
  const modal = openModal('Publish to GitHub', body, [
    { label: 'Cancel', onClick: () => modal.close() },
    { label: '↑ Publish now', primary: true, onClick: async (btn) => {
        btn.disabled = true; btn.textContent = 'Publishing…';
        try {
          const { commit } = await api.publish(state.projectId, msg.value.trim());
          modal.close();
          toast(`Published ✓ ${commit.sha.slice(0, 7)} (${commit.count} file${commit.count === 1 ? '' : 's'})`, 'success', 5000);
          await refreshStaged();
          if (state.active) openSchema(state.active.schema);
        } catch (ex) {
          btn.disabled = false; btn.textContent = '↑ Publish now';
          toast('Publish failed: ' + ex.message, 'error', 6000);
        }
      } },
  ]);
  setTimeout(() => msg.focus(), 50);
}

// ---------------- history / rollback ----------------
async function openHistory(path) {
  const body = h('div', {}, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
  const modal = openModal(path ? `History — ${path}` : 'All revisions', body, [{ label: 'Close', onClick: () => modal.close() }]);
  try {
    const { revisions } = await api.revisions(state.projectId, path);
    body.innerHTML = '';
    if (!revisions.length) { body.appendChild(h('p', { class: 'muted' }, 'No revisions found.')); return; }
    const table = h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Commit'), h('th', {}, 'Message'), h('th', {}, 'Author'), h('th', {}, 'When'), h('th', {}, ''))));
    const tbody = h('tbody', {});
    for (const r of revisions) {
      const subject = (r.message || '').split('\n')[0];
      tbody.appendChild(h('tr', {},
        h('td', { class: 'mono' }, h('a', { href: r.url, target: '_blank' }, r.sha.slice(0, 7))),
        h('td', {}, subject),
        h('td', { class: 'muted' }, r.author || '—'),
        h('td', { class: 'muted' }, r.date ? new Date(r.date).toLocaleString() : '—'),
        h('td', {}, path && state.user.role !== 'viewer'
          ? h('button', { class: 'btn btn-sm', onclick: () => doRollback(path, r.sha, modal) }, 'Restore')
          : ''),
      ));
    }
    table.appendChild(tbody);
    body.appendChild(table);
  } catch (ex) { body.innerHTML = ''; body.appendChild(h('p', { class: 'muted' }, ex.message)); }
}

async function doRollback(path, sha, modal) {
  if (!confirm(`Restore ${path} to ${sha.slice(0, 7)}? This creates a new commit.`)) return;
  try {
    const { commit } = await api.rollback(state.projectId, path, sha);
    toast(`Restored ✓ ${commit.sha.slice(0, 7)}`, 'success');
    modal.close();
    if (state.active) openSchema(state.active.schema);
  } catch (ex) { toast('Rollback failed: ' + ex.message, 'error'); }
}

// ---------------- admin: projects ----------------
async function openProjectsManager() {
  const { projects } = await api.projects();
  const body = h('div', {});
  const list = h('div', {});
  const refresh = (projs) => {
    list.innerHTML = '';
    for (const p of projs) {
      list.appendChild(h('div', { class: 'row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-soft)' },
        h('div', {}, h('strong', {}, p.label), h('div', { class: 'mono muted' }, `${p.owner}/${p.repo} · ${p.branch}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', onclick: () => openLanguageToggle(p) }, 'Languages'),
          h('button', { class: 'btn btn-sm', onclick: async () => { try { await api.verifyProject(p.id); toast('Repo reachable ✓', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Verify'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (confirm(`Remove project ${p.label}?`)) { await api.deleteProject(p.id); modal.close(); openProjectsManager(); } } }, 'Remove')),
      ));
    }
  };
  refresh(projects);
  body.appendChild(h('h3', { style: 'font-size:13px;margin:0 0 8px' }, 'Connected repositories'));
  body.appendChild(list);

  const f = { label: h('input', { type: 'text', placeholder: 'My Site' }), owner: h('input', { type: 'text', placeholder: 'org-or-user' }),
    repo: h('input', { type: 'text', placeholder: 'repo' }), branch: h('input', { type: 'text', value: 'main' }),
    token: h('input', { type: 'password', placeholder: 'GitHub token (optional if MOW_GITHUB_TOKEN set)' }),
    previewUrl: h('input', { type: 'text', placeholder: 'https://yoursite.com (optional)' }),
    stripeSecretKey: h('input', { type: 'password', placeholder: 'Stripe secret key (optional — enables the shop)' }) };
  body.appendChild(h('h3', { style: 'font-size:13px;margin:22px 0 8px' }, 'Connect a new repository'));
  for (const [k, label] of [['label', 'Label'], ['owner', 'Owner'], ['repo', 'Repo'], ['branch', 'Branch'], ['token', 'Token'], ['previewUrl', 'Preview URL'], ['stripeSecretKey', 'Stripe secret key']])
    body.appendChild(h('div', { class: 'field' }, h('label', {}, label), f[k]));

  const modal = openModal('Projects', body, [
    { label: 'Close', onClick: () => modal.close() },
    { label: '+ Connect', primary: true, onClick: async () => {
        try {
          await api.createProject({ label: f.label.value, owner: f.owner.value.trim(), repo: f.repo.value.trim(),
            branch: f.branch.value.trim() || 'main', token: f.token.value || undefined, previewUrl: f.previewUrl.value || undefined,
            stripeSecretKey: f.stripeSecretKey.value || undefined });
          toast('Project connected ✓', 'success');
          modal.close(); await loadProjects(); renderApp();
        } catch (ex) { toast(ex.message, 'error'); }
      } },
  ]);
}

// ---------------- admin: language toggle ----------------
async function openLanguageToggle(p) {
  let langs;
  try { langs = (await api.schemas(p.id)).languages; } catch (e) { return toast(e.message, 'error'); }
  const available = (langs && langs.available) || [];
  if (!available.length) return toast('This site has no multilingual fields to toggle.', 'info');
  const primary = available[0];
  const enabled = new Set((langs.enabled && langs.enabled.length) ? langs.enabled : available);
  const body = h('div', {});
  body.appendChild(h('p', { class: 'muted', style: 'font-size:12px;margin:0 0 12px' },
    'Turn languages on or off for this site. The primary language stays on. Turning one off hides it in the editor (content is kept); turning it back on restores it.'));
  const boxes = {};
  for (const code of available) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = enabled.has(code) || code === primary;
    if (code === primary) cb.disabled = true;
    boxes[code] = cb;
    body.appendChild(h('label', { class: 'row', style: 'gap:10px;padding:7px 0;align-items:center' },
      cb, h('span', { class: 'mono' }, code), code === primary ? h('span', { class: 'muted', style: 'font-size:11px' }, '(primary)') : null));
  }
  const modal = openModal('Languages — ' + p.label, body, [
    { label: 'Cancel', onClick: () => modal.close() },
    { label: 'Save', primary: true, onClick: async () => {
        const chosen = available.filter((c) => c === primary || boxes[c].checked);
        try {
          await api.updateProject(p.id, { languages: chosen });
          toast('Languages updated ✓', 'success');
          modal.close();
          if (p.id === state.projectId) { await loadSchemas(); renderApp(); }
        } catch (e) { toast(e.message, 'error'); }
      } },
  ]);
}

// ---------------- admin: users ----------------
async function openUsersManager() {
  const { users } = await api.users();
  const body = h('div', {});
  const list = h('div', {});
  for (const u of users) {
    list.appendChild(h('div', { class: 'row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-soft)' },
      h('div', {}, h('strong', {}, u.email), h('div', { class: 'mono muted' }, `${u.role} · ${(u.projects || []).join(', ') || 'no projects'}`)),
      h('div', { class: 'row' },
        h('select', { onchange: async (e) => { await api.updateUser(u.id, { role: e.target.value }); toast('Role updated', 'success'); } },
          ...['viewer', 'editor', 'admin'].map((r) => { const o = h('option', { value: r }, r); if (r === u.role) o.selected = true; return o; })),
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (confirm(`Delete ${u.email}?`)) { await api.deleteUser(u.id); modal.close(); openUsersManager(); } } }, 'Delete')),
    ));
  }
  body.appendChild(h('h3', { style: 'font-size:13px;margin:0 0 8px' }, 'Team'));
  body.appendChild(list);
  const nf = { email: h('input', { type: 'email', placeholder: 'person@mow.media' }), password: h('input', { type: 'password', placeholder: 'temp password' }),
    role: h('select', {}, ...['editor', 'viewer', 'admin'].map((r) => h('option', { value: r }, r))),
    projects: h('input', { type: 'text', placeholder: 'project-ids,comma,separated or *' }) };
  body.appendChild(h('h3', { style: 'font-size:13px;margin:22px 0 8px' }, 'Add a user'));
  for (const [k, label] of [['email', 'Email'], ['password', 'Password'], ['role', 'Role'], ['projects', 'Projects']])
    body.appendChild(h('div', { class: 'field' }, h('label', {}, label), nf[k]));
  const modal = openModal('Users', body, [
    { label: 'Close', onClick: () => modal.close() },
    { label: '+ Add user', primary: true, onClick: async () => {
        try {
          await api.createUser({ email: nf.email.value.trim(), password: nf.password.value,
            role: nf.role.value, projects: nf.projects.value ? nf.projects.value.split(',').map((s) => s.trim()) : [] });
          toast('User created ✓', 'success'); modal.close(); openUsersManager();
        } catch (ex) { toast(ex.message, 'error'); }
      } },
  ]);
}

// ---------------- modal helper ----------------
function openModal(title, bodyEl, actions = []) {
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const foot = h('div', { class: 'modal-foot' });
  const modalObj = { close };
  for (const a of actions) {
    const btn = h('button', { class: 'btn ' + (a.primary ? 'btn-primary' : ''), onclick: () => a.onClick(btn) }, a.label);
    foot.appendChild(btn);
  }
  const modal = h('div', { class: 'modal' },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn btn-ghost btn-sm x', onclick: () => close() }, '✕')),
    h('div', { class: 'modal-body' }, bodyEl), foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  function close() { overlay.remove(); }
  return modalObj;
}
