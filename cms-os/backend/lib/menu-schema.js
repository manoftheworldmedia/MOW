/**
 * Menu schema generator — turn a CMS "menu" document into schema.org/Menu
 * JSON-LD, and inject it into a static HTML page at publish time.
 *
 * Zero dependencies (same constraint as the rest of the engine). Pure and
 * testable: `menuToJsonLd` and `injectMenuJsonLd` have no I/O. The publish
 * pipeline (git-sync.js) calls `buildMenuJsonLdFile` with a `readFile` callback
 * so the generated <script type="application/ld+json"> is baked into the
 * page's STATIC HTML — visible to search engines AND to AI crawlers that do
 * not execute JavaScript. The runtime loader (assets/menu.js) is only a
 * best-effort fallback; this static copy is the canonical one.
 *
 * A menu document looks like:
 * {
 *   "establishmentType": "CafeOrCoffeeShop",   // optional, wraps Menu in the business
 *   "businessName": "Caspian Coast Coffee",     // optional
 *   "url": "https://caspiancoast.com",          // optional
 *   "currency": "usd",
 *   "image": "assets/caspian/j8.jpg",           // optional
 *   "sections": [
 *     { "en": { "name": "Coffee", "description": "" },
 *       "fa": { "name": "قهوه" },
 *       "items": [
 *         { "price": 5.5, "dietary": ["vegan"], "image": "assets/caspian/j8.jpg",
 *           "en": { "name": "Saffron Latte", "description": "Espresso, milk, saffron." },
 *           "fa": { "name": "لاته زعفران" } }
 *       ] }
 *   ]
 * }
 */

// Establishment @types that legitimately carry a food menu (schema.org).
export const ESTABLISHMENT_TYPES = new Set([
  'FoodEstablishment', 'Restaurant', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub',
  'FastFoodRestaurant', 'IceCreamShop', 'Winery', 'Brewery', 'Distillery',
]);

// CMS dietary tags → schema.org RestrictedDiet enumeration URLs.
export const DIET_MAP = {
  vegan: 'https://schema.org/VeganDiet',
  vegetarian: 'https://schema.org/VegetarianDiet',
  'gluten-free': 'https://schema.org/GlutenFreeDiet',
  halal: 'https://schema.org/HalalDiet',
  kosher: 'https://schema.org/KosherDiet',
  'low-calorie': 'https://schema.org/LowCalorieDiet',
  'low-fat': 'https://schema.org/LowFatDiet',
  'low-lactose': 'https://schema.org/LowLactoseDiet',
  'low-salt': 'https://schema.org/LowSaltDiet',
  diabetic: 'https://schema.org/DiabeticDiet',
};

const MARK_START = '<!-- MOW:MENU-SCHEMA -->';
const MARK_END = '<!-- /MOW:MENU-SCHEMA -->';

/** Read a localized field, falling back lang → English → flat (e.g. obj.name). */
export function localized(obj, field, lang = 'en') {
  if (!obj || typeof obj !== 'object') return undefined;
  const pick = (o) => (o && o[field] != null && o[field] !== '' ? o[field] : undefined);
  return pick(obj[lang]) ?? pick(obj.en) ?? pick(obj);
}

/** Prefix a relative asset path with the site's media base (absolute URL). */
function absolutize(src, mediaBase) {
  if (!src) return undefined;
  if (/^https?:\/\//i.test(src)) return src;
  if (!mediaBase) return src;
  return mediaBase.replace(/\/+$/, '') + '/' + String(src).replace(/^\/+/, '');
}

/** Format a numeric price as a schema.org price string (e.g. 5 -> "5.00"). */
function priceString(value) {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : undefined;
}

function dietNodes(dietary) {
  const out = [];
  for (const d of dietary || []) {
    const url = DIET_MAP[String(d).toLowerCase().trim()];
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

function itemNode(item, { lang, currency, mediaBase }) {
  const node = { '@type': 'MenuItem' };
  const name = localized(item, 'name', lang);
  if (name) node.name = name;
  const description = localized(item, 'description', lang);
  if (description) node.description = description;
  const price = priceString(item.price);
  if (price) {
    node.offers = { '@type': 'Offer', price, priceCurrency: String(currency || 'usd').toUpperCase() };
  }
  const diets = dietNodes(item.dietary);
  if (diets.length) node.suitableForDiet = diets.length === 1 ? diets[0] : diets;
  const image = absolutize(item.image, mediaBase);
  if (image) node.image = image;
  return node;
}

/**
 * Build the schema.org/Menu (or establishment-with-hasMenu) JSON-LD object for
 * one language. Returns a plain object ready for JSON.stringify.
 */
export function menuToJsonLd(menu = {}, opts = {}) {
  const lang = opts.lang || 'en';
  const currency = menu.currency || opts.currency || 'usd';
  const mediaBase = opts.mediaBase || '';

  const sections = (menu.sections || []).map((sec) => {
    const node = { '@type': 'MenuSection' };
    const name = localized(sec, 'name', lang);
    if (name) node.name = name;
    const description = localized(sec, 'description', lang);
    if (description) node.description = description;
    const items = (sec.items || [])
      .map((it) => itemNode(it, { lang, currency, mediaBase }))
      .filter((n) => n.name);
    if (items.length) node.hasMenuItem = items;
    return node;
  }).filter((s) => s.name || s.hasMenuItem);

  const menuNode = { '@context': 'https://schema.org', '@type': 'Menu' };
  if (lang) menuNode.inLanguage = lang;
  if (sections.length) menuNode.hasMenuSection = sections;

  const businessName = menu.businessName || opts.businessName;
  if (menu.establishmentType && ESTABLISHMENT_TYPES.has(menu.establishmentType) && businessName) {
    const est = { '@context': 'https://schema.org', '@type': menu.establishmentType, name: businessName };
    const url = menu.url || opts.siteUrl;
    if (url) est.url = url;
    const image = absolutize(menu.image, mediaBase);
    if (image) est.image = image;
    delete menuNode['@context']; // nested node inherits the outer context
    est.hasMenu = menuNode;
    return est;
  }
  return menuNode;
}

/** Wrap a JSON-LD object in a <script> tag (compact JSON, matching site style). */
export function renderMenuScript(menu, opts = {}) {
  const json = JSON.stringify(menuToJsonLd(menu, opts));
  return `<script type="application/ld+json" data-mow-menu>${json}</script>`;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Inject (or replace) the menu JSON-LD inside a marked region of an HTML page.
 * Idempotent: re-running with the same menu produces identical HTML. If the
 * markers are absent, the block is inserted just before </head>.
 */
export function injectMenuJsonLd(html, scriptTag) {
  const block = `${MARK_START}\n${scriptTag}\n${MARK_END}`;
  if (html.includes(MARK_START) && html.includes(MARK_END)) {
    const re = new RegExp(escapeRe(MARK_START) + '[\\s\\S]*?' + escapeRe(MARK_END));
    return html.replace(re, block);
  }
  if (html.includes('</head>')) return html.replace('</head>', `${block}\n</head>`);
  return `${html}\n${block}\n`;
}

/**
 * Publish-time hook: given a staged menu value and its schema, regenerate the
 * static JSON-LD and return the updated target-page file, or null if nothing
 * needs to change. `readFile(path)` resolves to `{ content }` or null.
 *
 * The schema opts in to generation with:
 *   "jsonld": { "type": "menu", "into": "menu/index.html" }
 * so the platform stays generic — any schema can declare a projection target.
 */
export async function buildMenuJsonLdFile(menuValue, schema, { readFile, mediaBase, siteUrl } = {}) {
  const cfg = schema && schema.jsonld;
  if (!cfg || cfg.type !== 'menu' || !cfg.into || typeof readFile !== 'function') return null;

  const file = await readFile(cfg.into);
  if (!file || typeof file.content !== 'string') return null;

  const langs = cfg.langs && cfg.langs.length ? cfg.langs : ['en'];
  // The primary language carries the canonical Menu; extra languages can be
  // appended as additional <script> blocks if a site is multilingual.
  const scripts = langs.map((lang) =>
    renderMenuScript(menuValue, { lang, mediaBase, siteUrl })).join('\n');

  const updated = injectMenuJsonLd(file.content, scripts);
  if (updated === file.content) return null; // no change → don't bloat the commit
  return { path: cfg.into, content: updated };
}
