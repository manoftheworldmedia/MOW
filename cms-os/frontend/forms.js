/**
 * Schema-driven form renderer. Generates the entire editing UI from a schema —
 * no hardcoded forms. Uses the SHARED schema engine for widget mapping,
 * defaults and (client-side) validation, so the UI can never produce a state
 * the backend would reject (Zero Drift).
 */
import {
  widgetFor, defaultForField, validate, clone,
} from '/shared/schema-engine.js';

/** tiny hyperscript */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export class SchemaForm {
  constructor(schema, value, { onChange, mediaBase = '' } = {}) {
    this.schema = schema;
    this.value = clone(value) || {};
    this.onChange = onChange || (() => {});
    this.mediaBase = mediaBase;
    this.fieldEls = new Map(); // path -> wrapper element (for error highlighting)
  }

  emit() { this.onChange(this.value); }

  render() {
    this.fieldEls.clear();
    const root = h('div', { class: 'schema-form' });
    // group fields by ui.group; top-level objects render as groups themselves.
    for (const field of this.schema.fields || []) {
      root.appendChild(this.renderField(field, this.value, field.name));
    }
    this.root = root;
    return root;
  }

  renderField(field, parent, path) {
    if (field.ui && field.ui.hidden) return document.createTextNode('');
    const widget = widgetFor(field);
    if (field.type === 'object') return this.renderObject(field, parent, path);
    if (field.type === 'list') return this.renderList(field, parent, path);

    const wrap = h('div', { class: 'fld' });
    const label = h('label', {},
      field.label || field.name,
      field.required ? h('span', { class: 'req' }, '*') : null,
      field.help ? h('span', { class: 'help' }, '— ' + field.help) : null,
    );
    wrap.appendChild(label);
    wrap.appendChild(this.renderWidget(widget, field, parent, path, label));
    wrap.appendChild(h('div', { class: 'field-err' }));
    this.fieldEls.set(path, wrap);
    return wrap;
  }

  renderObject(field, parent, path) {
    if (parent[field.name] == null || typeof parent[field.name] !== 'object') parent[field.name] = {};
    const obj = parent[field.name];
    const block = h('div', { class: 'group' });
    block.appendChild(h('div', { class: 'group-title' }, field.label || field.name));
    for (const f of field.fields || []) block.appendChild(this.renderField(f, obj, `${path}.${f.name}`));
    return block;
  }

  renderList(field, parent, path) {
    if (!Array.isArray(parent[field.name])) parent[field.name] = [];
    const arr = parent[field.name];
    const wrap = h('div', { class: 'fld' });
    wrap.appendChild(h('label', {}, field.label || field.name, field.required ? h('span', { class: 'req' }, '*') : null));
    const listEl = h('div', { class: 'list-widget' });

    const rebuild = () => {
      listEl.innerHTML = '';
      arr.forEach((item, i) => listEl.appendChild(this.renderListItem(field, arr, i, `${path}.${i}`, rebuild)));
    };
    rebuild();

    const addBtn = h('button', {
      class: 'btn btn-sm list-add',
      onclick: () => { arr.push(defaultForField(field.of)); rebuild(); this.emit(); },
    }, '+ Add item');

    wrap.appendChild(listEl);
    wrap.appendChild(addBtn);
    wrap.appendChild(h('div', { class: 'field-err' }));
    this.fieldEls.set(path, wrap);
    return wrap;
  }

  renderListItem(field, arr, index, path, rebuild) {
    const item = arr[index];
    const titleField = (field.of.fields || []).find((f) => ['title', 'label', 'name', 'question', 'heading', 'q'].includes(f.name));
    const title = titleField ? (item[titleField.name] || '(untitled)') : `Item ${index + 1}`;

    const row = h('div', { class: 'list-item', draggable: 'false' });
    const handle = h('span', { class: 'handle', title: 'Drag to reorder' }, '⠿');
    handle.setAttribute('draggable', 'true');

    // drag-and-drop reordering
    handle.addEventListener('dragstart', (e) => { row.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; });
    handle.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop-target');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === index) return;
      const [moved] = arr.splice(from, 1);
      arr.splice(index, 0, moved);
      rebuild(); this.emit();
    });

    const head = h('div', { class: 'list-item-head' },
      handle,
      h('span', { class: 'title' }, title),
      h('span', { class: 'idx' }, `#${index + 1}`),
      h('button', { class: 'btn btn-sm', onclick: () => { if (index > 0) { [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]; rebuild(); this.emit(); } } }, '↑'),
      h('button', { class: 'btn btn-sm', onclick: () => { if (index < arr.length - 1) { [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]]; rebuild(); this.emit(); } } }, '↓'),
      h('button', { class: 'btn btn-sm btn-danger', onclick: () => { arr.splice(index, 1); rebuild(); this.emit(); } }, '✕'),
    );
    const body = h('div', { class: 'list-item-body' });
    if (field.of.type === 'object') {
      for (const f of field.of.fields || []) body.appendChild(this.renderField(f, item, `${path}.${f.name}`));
    } else {
      // primitive list item
      const holder = { __v: item };
      body.appendChild(this.renderWidget(widgetFor(field.of), { ...field.of, name: '__v' }, arr, String(index)));
    }
    row.appendChild(head); row.appendChild(body);
    return row;
  }

  // ---- widgets ----
  renderWidget(widget, field, parent, path, labelEl) {
    const set = (v) => { parent[field.name] = v; this.emit(); };
    const cur = parent[field.name];

    switch (widget) {
      case 'textarea':
        return this.input(h('textarea', { rows: field.ui?.rows || 3, placeholder: field.ui?.placeholder || '' }), cur, set, field, labelEl, 'text');
      case 'code':
        return this.input(h('textarea', { class: 'code', spellcheck: 'false', placeholder: field.ui?.placeholder || '' }), cur, set, field, labelEl, 'text');
      case 'richtext':
        return this.input(h('textarea', { rows: 6, placeholder: 'Rich text (markdown/html)…' }), cur, set, field, labelEl, 'text');
      case 'number':
        return this.input(h('input', { type: 'number', min: field.min, max: field.max }), cur, set, field, labelEl, 'number');
      case 'date':
        return this.input(h('input', { type: 'date' }), cur, set, field, labelEl, 'text');
      case 'datetime':
        return this.input(h('input', { type: 'datetime-local' }), cur, set, field, labelEl, 'text');
      case 'url':
        return this.input(h('input', { type: 'url', placeholder: 'https:// or /path' }), cur, set, field, labelEl, 'text');
      case 'email':
        return this.input(h('input', { type: 'email' }), cur, set, field, labelEl, 'text');
      case 'color': {
        const inp = h('input', { type: 'text', placeholder: '#c9a25a' });
        return this.input(inp, cur, set, field, labelEl, 'text');
      }
      case 'toggle': {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = !!cur;
        cb.addEventListener('change', () => set(cb.checked));
        return h('label', { class: 'toggle' }, cb, h('span', { class: 'track' }), h('span', { class: 'thumb' }));
      }
      case 'select': {
        const sel = h('select', {});
        sel.appendChild(h('option', { value: '' }, '— select —'));
        for (const opt of field.options || []) {
          const value = typeof opt === 'string' ? opt : opt.value;
          const text = typeof opt === 'string' ? opt : opt.label;
          const o = h('option', { value }, text); if (value === cur) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => set(sel.value));
        return sel;
      }
      case 'image': {
        const box = h('div', { class: 'image-widget' });
        const src = cur ? (this.mediaBase + cur) : '';
        const thumb = cur
          ? h('img', { class: 'thumb', src, onerror: function () { this.style.display = 'none'; } })
          : h('div', { class: 'thumb empty' }, '🖼');
        const inp = h('input', { type: 'text', value: cur || '', placeholder: 'assets/…' });
        inp.addEventListener('input', () => { set(inp.value); if (cur !== inp.value) { thumb.src = this.mediaBase + inp.value; } });
        box.appendChild(thumb);
        box.appendChild(h('div', { style: 'flex:1' }, inp));
        return box;
      }
      default: {
        const inp = h('input', { type: 'text', placeholder: field.ui?.placeholder || '' });
        return this.input(inp, cur, set, field, labelEl, 'text');
      }
    }
  }

  input(el, cur, set, field, labelEl, kind) {
    el.value = cur == null ? '' : cur;
    const max = field.maxLength;
    if (max && labelEl) {
      const counter = h('span', { class: 'counter' }, `${(cur || '').length}/${max}`);
      labelEl.appendChild(counter);
      el.addEventListener('input', () => { counter.textContent = `${el.value.length}/${max}`; });
    }
    el.addEventListener('input', () => set(kind === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value));
    return el;
  }

  /** Validate current value via shared engine; paint errors onto fields. */
  validateAndPaint() {
    // clear
    for (const wrap of this.fieldEls.values()) {
      wrap.classList.remove('invalid');
      const e = wrap.querySelector('.field-err'); if (e) e.textContent = '';
    }
    const { valid, errors } = validate(this.schema, this.value);
    for (const err of errors) {
      // find nearest registered field element
      let p = err.path;
      while (p && !this.fieldEls.has(p)) p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '';
      const wrap = this.fieldEls.get(p);
      if (wrap) {
        wrap.classList.add('invalid');
        const e = wrap.querySelector('.field-err');
        if (e && !e.textContent) e.textContent = err.message;
      }
    }
    return { valid, errors };
  }
}
