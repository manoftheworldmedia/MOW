import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineItems } from '../lib/shop.js';

const products = {
  'tee': { price: 29.99, currency: 'usd', active: true, en: { name: 'MOW Tee', description: 'Soft cotton' }, image: 'assets/tee.jpg' },
  'hat': { price: 19, currency: 'usd', active: true, name: 'Cap' },
  'sold-out': { price: 10, active: false, name: 'Gone' },
};

test('builds line items with server-side prices in cents', () => {
  const li = buildLineItems(products, [{ productId: 'tee', qty: 2 }], { mediaBase: 'https://x.com/' });
  assert.equal(li.length, 1);
  assert.equal(li[0].amount, 2999);
  assert.equal(li[0].qty, 2);
  assert.equal(li[0].name, 'MOW Tee');
  assert.deepEqual(li[0].images, ['https://x.com/assets/tee.jpg']);
});

test('ignores any client-supplied price (anti-tamper)', () => {
  const li = buildLineItems(products, [{ productId: 'hat', qty: 1, price: 0.01, amount: 1 }]);
  assert.equal(li[0].amount, 1900); // from Git, not from client
});

test('rejects unknown product', () => {
  assert.throws(() => buildLineItems(products, [{ productId: 'nope', qty: 1 }]), /Unknown product/);
});

test('rejects inactive product', () => {
  assert.throws(() => buildLineItems(products, [{ productId: 'sold-out', qty: 1 }]), /not for sale/);
});

test('clamps quantity to a sane range', () => {
  assert.equal(buildLineItems(products, [{ productId: 'hat', qty: 99999 }])[0].qty, 999);
  assert.equal(buildLineItems(products, [{ productId: 'hat', qty: -5 }])[0].qty, 1);
  assert.equal(buildLineItems(products, [{ productId: 'hat', qty: 'abc' }])[0].qty, 1);
});

test('empty cart throws', () => {
  assert.throws(() => buildLineItems(products, []), /empty/);
});

test('sanitizes product ids (no path traversal)', () => {
  assert.throws(() => buildLineItems(products, [{ productId: '../../secret', qty: 1 }]), /Unknown product/);
});
