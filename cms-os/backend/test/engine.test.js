import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, coerce, defaultsFor, diff, validateSchema } from '../../shared/schema-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/schemas/mow-site.json'), 'utf8'));
const homeSchema = site.schemas.find((s) => s.name === 'home');
const homeData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../content/home.json'), 'utf8'));

test('all bundled schemas are well-formed', () => {
  for (const s of site.schemas) {
    const r = validateSchema(s);
    assert.ok(r.valid, `schema ${s.name}: ${r.errors.join('; ')}`);
  }
});

test('real home.json validates against the home schema', () => {
  const r = validate(homeSchema, homeData);
  assert.ok(r.valid, JSON.stringify(r.errors, null, 2));
});

test('missing required field is rejected', () => {
  const bad = JSON.parse(JSON.stringify(homeData));
  delete bad.meta.title;
  const r = validate(homeSchema, bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.path === 'meta.title'));
});

test('unknown field is rejected (zero drift)', () => {
  const bad = JSON.parse(JSON.stringify(homeData));
  bad.surprise = 'drift';
  const r = validate(homeSchema, bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.path === 'surprise'));
});

test('maxLength enforced on meta.title', () => {
  const bad = JSON.parse(JSON.stringify(homeData));
  bad.meta.title = 'x'.repeat(200);
  const r = validate(homeSchema, bad);
  assert.ok(r.errors.some((e) => e.path === 'meta.title'));
});

test('navigation list coercion + validation', () => {
  const nav = site.schemas.find((s) => s.name === 'navigation');
  const coerced = coerce(nav, { items: [{ label: 'Home', url: '/', newTab: 'true' }] });
  assert.equal(coerced.items[0].newTab, true);
  assert.ok(validate(nav, coerced).valid);
  // invalid url
  const bad = coerce(nav, { items: [{ label: 'x', url: 'not a url', newTab: false }] });
  assert.equal(validate(nav, bad).valid, false);
});

test('defaults produce a valid-shaped object', () => {
  const nav = site.schemas.find((s) => s.name === 'navigation');
  const d = defaultsFor(nav);
  assert.deepEqual(d.items, []);
});

test('diff detects changed/added/removed', () => {
  const a = { meta: { title: 'A' }, labels: { x: '1' } };
  const b = { meta: { title: 'B' }, labels: {}, extra: 'y' };
  const changes = diff(a, b);
  assert.ok(changes.find((c) => c.path === 'meta.title' && c.op === 'changed'));
  assert.ok(changes.find((c) => c.path === 'labels.x' && c.op === 'removed'));
  assert.ok(changes.find((c) => c.path === 'extra' && c.op === 'added'));
});
