/**
 * MOW CMS OS — Shared Schema Engine
 * =================================
 * A single source of truth for content structure, validation, defaults and
 * diffing. This module is pure ESM with ZERO dependencies so it runs
 * identically in the Node backend and the browser frontend. The same code
 * validating a write on the server is the code guarding the form in the UI —
 * this is what makes the "Zero Drift" guarantee real.
 *
 * A *schema* describes a content collection:
 *   {
 *     name:   "home",
 *     label:  "Homepage",
 *     kind:   "single" | "collection",   // single file vs folder of docs
 *     path:   "content/home.json",        // single: file path
 *     // OR for collection:
 *     folder: "content/events", extension: "json", primaryField: "title",
 *     fields: [ Field, ... ]
 *   }
 *
 * A *field*:
 *   {
 *     name: "title", label: "Title", type: FieldType,
 *     required?: bool, default?: any, help?: string,
 *     min?, max?, minLength?, maxLength?, pattern?: string (regex),
 *     options?: [ {value,label} | "value" ],   // for "select"
 *     fields?: [Field],                         // for "object"
 *     of?: Field,                               // for "list" (array item schema)
 *     language?: string,                        // for "code"
 *     ui?: { widget?, rows?, placeholder?, group?, hidden? }
 *   }
 *
 * FieldType: string | text | richtext | code | number | boolean | date |
 *            datetime | select | image | url | email | color | object | list
 */

export const FIELD_TYPES = [
  'string', 'text', 'richtext', 'code', 'number', 'boolean',
  'date', 'datetime', 'select', 'image', 'url', 'email', 'color',
  'object', 'list',
];

/** Map a field type to the default UI widget the renderer should mount. */
export function widgetFor(field) {
  if (field.ui && field.ui.widget) return field.ui.widget;
  switch (field.type) {
    case 'text': return 'textarea';
    case 'richtext': return 'richtext';
    case 'code': return 'code';
    case 'number': return 'number';
    case 'boolean': return 'toggle';
    case 'date': return 'date';
    case 'datetime': return 'datetime';
    case 'select': return 'select';
    case 'image': return 'image';
    case 'url': return 'url';
    case 'email': return 'email';
    case 'color': return 'color';
    case 'object': return 'object';
    case 'list': return 'list';
    default: return 'text-input';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|\/|\.\/|\.\.\/)[^\s]*$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Build a fully-defaulted value for a schema (used for "new document"). */
export function defaultsFor(schema) {
  const obj = {};
  for (const f of schema.fields || []) obj[f.name] = defaultForField(f);
  return obj;
}

export function defaultForField(field) {
  if (field.default !== undefined) return clone(field.default);
  switch (field.type) {
    case 'boolean': return false;
    case 'number': return null;
    case 'list': return [];
    case 'object': {
      const o = {};
      for (const f of field.fields || []) o[f.name] = defaultForField(f);
      return o;
    }
    case 'select':
      return field.required && field.options && field.options.length
        ? optionValue(field.options[0]) : '';
    default: return '';
  }
}

function optionValue(opt) { return typeof opt === 'string' ? opt : opt.value; }

/**
 * Validate `value` against `schema`. Returns { valid, errors } where each
 * error is { path, message }. `path` is a dotted/indexed path so the UI can
 * highlight the exact offending field (e.g. "labels.hero_h1a", "items.2.url").
 */
export function validate(schema, value) {
  const errors = [];
  validateFields(schema.fields || [], value || {}, '', errors);
  return { valid: errors.length === 0, errors };
}

function validateFields(fields, obj, prefix, errors) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push({ path: prefix || '(root)', message: 'Expected an object.' });
    return;
  }
  const allowed = new Set(fields.map((f) => f.name));
  for (const f of fields) {
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    validateValue(f, obj[f.name], p, errors);
  }
  // Reject unknown keys — drift prevention.
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      errors.push({ path: prefix ? `${prefix}.${k}` : k, message: `Unknown field "${k}" not permitted by schema.` });
    }
  }
}

function isEmpty(v) { return v === undefined || v === null || v === ''; }

function validateValue(field, value, path, errors) {
  if (isEmpty(value)) {
    if (field.required) errors.push({ path, message: `${field.label || field.name} is required.` });
    return;
  }
  switch (field.type) {
    case 'string': case 'text': case 'richtext': case 'code': case 'color':
      if (typeof value !== 'string') return errors.push({ path, message: 'Must be text.' });
      checkLength(field, value, path, errors);
      checkPattern(field, value, path, errors);
      break;
    case 'url':
      if (typeof value !== 'string' || !URL_RE.test(value))
        errors.push({ path, message: 'Must be a valid URL or path.' });
      break;
    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value))
        errors.push({ path, message: 'Must be a valid email address.' });
      break;
    case 'image':
      if (typeof value !== 'string') errors.push({ path, message: 'Must be an image path.' });
      break;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) return errors.push({ path, message: 'Must be a number.' });
      if (field.min != null && n < field.min) errors.push({ path, message: `Must be ≥ ${field.min}.` });
      if (field.max != null && n > field.max) errors.push({ path, message: `Must be ≤ ${field.max}.` });
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push({ path, message: 'Must be true or false.' });
      break;
    case 'date':
      if (typeof value !== 'string' || !ISO_DATE_RE.test(value))
        errors.push({ path, message: 'Must be a date (YYYY-MM-DD).' });
      break;
    case 'datetime':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
        errors.push({ path, message: 'Must be a valid date/time.' });
      break;
    case 'select': {
      const vals = (field.options || []).map(optionValue);
      if (!vals.includes(value)) errors.push({ path, message: `Must be one of: ${vals.join(', ')}.` });
      break;
    }
    case 'object':
      validateFields(field.fields || [], value, path, errors);
      break;
    case 'list': {
      if (!Array.isArray(value)) return errors.push({ path, message: 'Must be a list.' });
      if (field.min != null && value.length < field.min) errors.push({ path, message: `Needs at least ${field.min} item(s).` });
      if (field.max != null && value.length > field.max) errors.push({ path, message: `Allows at most ${field.max} item(s).` });
      value.forEach((item, i) => validateValue(field.of, item, `${path}.${i}`, errors));
      break;
    }
    default:
      errors.push({ path, message: `Unknown field type "${field.type}".` });
  }
}

function checkLength(field, value, path, errors) {
  if (field.minLength != null && value.length < field.minLength)
    errors.push({ path, message: `Must be at least ${field.minLength} characters.` });
  if (field.maxLength != null && value.length > field.maxLength)
    errors.push({ path, message: `Must be at most ${field.maxLength} characters.` });
}

function checkPattern(field, value, path, errors) {
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value))
        errors.push({ path, message: field.patternMessage || `Does not match required format.` });
    } catch { /* invalid pattern in schema — ignore */ }
  }
}

/**
 * Coerce loosely-typed UI input (everything arrives as strings from forms)
 * into the correct JS types per schema, so a write is well-typed before it
 * is validated and serialized.
 */
export function coerce(schema, value) {
  const out = {};
  for (const f of schema.fields || []) out[f.name] = coerceValue(f, value ? value[f.name] : undefined);
  return out;
}

function coerceValue(field, value) {
  if (value === undefined) return defaultForField(field);
  switch (field.type) {
    case 'number':
      if (value === '' || value === null) return null;
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return value === true || value === 'true' || value === 'on' || value === 1;
    case 'object': {
      const o = {};
      for (const f of field.fields || []) o[f.name] = coerceValue(f, value ? value[f.name] : undefined);
      return o;
    }
    case 'list':
      return Array.isArray(value) ? value.map((v) => coerceValue(field.of, v)) : [];
    default:
      return value == null ? '' : value;
  }
}

/**
 * Structured diff between two content values. Returns a flat list of
 * { path, op: 'added'|'removed'|'changed', before, after } — used by the
 * revision/diff UI to render human-readable change sets.
 */
export function diff(before, after, prefix = '') {
  const changes = [];
  walkDiff(before, after, prefix, changes);
  return changes;
}

function walkDiff(a, b, path, changes) {
  if (deepEqual(a, b)) return;
  const aObj = isPlainObject(a), bObj = isPlainObject(b);
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aObj && bObj) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walkDiff(a[k], b[k], path ? `${path}.${k}` : k, changes);
    return;
  }
  if (aArr && bArr) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) walkDiff(a[i], b[i], `${path}.${i}`, changes);
    return;
  }
  if (a === undefined) changes.push({ path, op: 'added', before: undefined, after: b });
  else if (b === undefined) changes.push({ path, op: 'removed', before: a, after: undefined });
  else changes.push({ path, op: 'changed', before: a, after: b });
}

// ---- small utilities (no deps) ----
export function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Flatten a schema into an ordered list of leaf paths (for navigation/UX). */
export function leafPaths(schema) {
  const out = [];
  const walk = (fields, prefix) => {
    for (const f of fields) {
      const p = prefix ? `${prefix}.${f.name}` : f.name;
      if (f.type === 'object') walk(f.fields || [], p);
      else out.push({ path: p, field: f });
    }
  };
  walk(schema.fields || [], '');
  return out;
}

/** Validate that a schema definition itself is well-formed. */
export function validateSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') return { valid: false, errors: ['Schema must be an object.'] };
  if (!schema.name) errors.push('Schema needs a name.');
  if (!['single', 'collection'].includes(schema.kind)) errors.push('kind must be "single" or "collection".');
  if (schema.kind === 'single' && !schema.path) errors.push('single schema needs a path.');
  if (schema.kind === 'collection' && !schema.folder) errors.push('collection schema needs a folder.');
  const checkFields = (fields, loc) => {
    if (!Array.isArray(fields)) return errors.push(`${loc}: fields must be an array.`);
    for (const f of fields) {
      if (!f.name) errors.push(`${loc}: a field is missing "name".`);
      if (!FIELD_TYPES.includes(f.type)) errors.push(`${loc}.${f.name}: invalid type "${f.type}".`);
      if (f.type === 'object') checkFields(f.fields || [], `${loc}.${f.name}`);
      if (f.type === 'list') {
        if (!f.of) errors.push(`${loc}.${f.name}: list needs "of".`);
        else if (f.of.type === 'object') checkFields(f.of.fields || [], `${loc}.${f.name}[]`);
      }
    }
  };
  checkFields(schema.fields || [], schema.name);
  return { valid: errors.length === 0, errors };
}

export default {
  FIELD_TYPES, widgetFor, defaultsFor, defaultForField,
  validate, coerce, diff, clone, leafPaths, validateSchema,
};
