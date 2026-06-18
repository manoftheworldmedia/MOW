/**
 * Shop / Stripe Checkout engine — zero dependency (Stripe REST via fetch).
 *
 * Products are CMS-managed content at content/products/<id>.json. Checkout is a
 * PUBLIC endpoint (site visitors aren't logged into the CMS), so integrity comes
 * from the server: the browser sends only product ids + quantities, and the
 * server reads the authoritative price from Git and builds the Stripe session.
 * This makes price tampering impossible.
 */
import { clientFor } from './projects.js';

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const MAX_QTY = 999;

/**
 * Pure, testable: turn trusted product records + a requested cart into Stripe
 * line items. `products` is a map of id -> product JSON. Throws on bad input.
 */
export function buildLineItems(products, cart, { mediaBase = '' } = {}) {
  if (!Array.isArray(cart) || cart.length === 0) {
    const e = new Error('Cart is empty.'); e.status = 400; throw e;
  }
  const items = [];
  for (const entry of cart) {
    const id = sanitizeId(entry.productId);
    const product = products[id];
    if (!product) { const e = new Error(`Unknown product "${id}".`); e.status = 400; throw e; }
    if (product.active === false) { const e = new Error(`Product "${id}" is not for sale.`); e.status = 400; throw e; }
    const qty = clampQty(entry.qty);
    const amount = Math.round(Number(product.price) * 100); // dollars -> cents
    if (!Number.isFinite(amount) || amount <= 0) { const e = new Error(`Product "${id}" has no valid price.`); e.status = 400; throw e; }
    const name = localized(product, 'name') || id;
    const description = localized(product, 'description') || undefined;
    const images = product.image ? [absolutize(product.image, mediaBase)].filter(Boolean) : undefined;
    items.push({ currency: (product.currency || 'usd').toLowerCase(), name, description, amount, qty, images });
  }
  return items;
}

/** Create a Stripe Checkout Session and return its hosted URL. */
export async function createCheckoutSession(project, { items, successUrl, cancelUrl }) {
  const key = project.stripeSecretKey || process.env.MOW_STRIPE_SECRET_KEY;
  if (!key) { const e = new Error('Stripe is not configured for this project.'); e.status = 400; throw e; }

  // Load authoritative product data from Git for every id in the cart.
  const gh = clientFor(project);
  const ids = [...new Set((items || []).map((i) => sanitizeId(i.productId)))];
  const products = {};
  for (const id of ids) {
    const file = await gh.readFile(`content/products/${id}.json`);
    if (file) { try { products[id] = JSON.parse(file.content); } catch { /* skip malformed */ } }
  }

  const mediaBase = project.previewUrl ? project.previewUrl.replace(/\/$/, '') + '/' : '';
  const lineItems = buildLineItems(products, items, { mediaBase });

  const success = successUrl || (project.previewUrl ? project.previewUrl + '?checkout=success' : null);
  const cancel = cancelUrl || (project.previewUrl ? project.previewUrl + '?checkout=cancel' : null);
  if (!success || !cancel) { const e = new Error('Missing success/cancel URL.'); e.status = 400; throw e; }

  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', success);
  body.set('cancel_url', cancel);
  lineItems.forEach((li, i) => {
    const pd = `line_items[${i}][price_data]`;
    body.set(`${pd}[currency]`, li.currency);
    body.set(`${pd}[product_data][name]`, li.name);
    if (li.description) body.set(`${pd}[product_data][description]`, li.description);
    (li.images || []).forEach((img, j) => body.set(`${pd}[product_data][images][${j}]`, img));
    body.set(`${pd}[unit_amount]`, String(li.amount));
    body.set(`line_items[${i}][quantity]`, String(li.qty));
  });

  const res = await fetch(STRIPE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Stripe: ${data.error?.message || res.statusText}`); e.status = 502; throw e;
  }
  return { url: data.url, id: data.id };
}

/**
 * Public product catalog: read content/products/*.json from Git and return
 * display-safe records (no secrets). Used by storefronts to render the shop.
 */
export async function listProducts(project) {
  const gh = clientFor(project);
  const mediaBase = project.previewUrl ? project.previewUrl.replace(/\/$/, '') + '/' : '';
  const entries = await gh.listDir('content/products');
  const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
  const products = [];
  for (const f of files) {
    const file = await gh.readFile(f.path);
    if (!file) continue;
    let p; try { p = JSON.parse(file.content); } catch { continue; }
    if (p.active === false) continue;
    products.push({
      id: f.name.replace(/\.json$/, ''),
      sku: p.sku || f.name.replace(/\.json$/, ''),
      name: localized(p, 'name') || p.sku || '',
      description: localized(p, 'description') || '',
      price: Number(p.price) || 0,
      currency: (p.currency || 'usd').toLowerCase(),
      image: absolutize(p.image, mediaBase),
    });
  }
  return products;
}

// ---- helpers ----
function sanitizeId(id) { return String(id || '').replace(/[^a-z0-9_-]/gi, ''); }
function clampQty(q) { const n = parseInt(q, 10); return Number.isFinite(n) ? Math.max(1, Math.min(MAX_QTY, n)) : 1; }
function localized(product, field) {
  // Supports both flat ({name}) and multilingual ({en:{name}}) products.
  if (product[field] != null) return product[field];
  for (const code of ['en', 'es', 'fa']) if (product[code] && product[code][field]) return product[code][field];
  return null;
}
function absolutize(path, base) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return base ? base + path.replace(/^\//, '') : '';
}
