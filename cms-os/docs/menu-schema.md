# Automatic Menu Schema (CMS → schema.org/Menu)

A standard MOW CMS capability: a client edits their food & drink menu in the
CMS, and on **Publish** the platform regenerates `schema.org/Menu` JSON-LD and
bakes it into the menu page's **static HTML** — in the same atomic commit. No
hand-written structured data, no drift, and it's visible to search engines
**and** to AI crawlers that don't run JavaScript.

This is the same idea the homepage already uses for its FAQ schema, made into a
reusable, schema-driven platform feature.

---

## Why baked-in (static), not runtime-only

The site's runtime loaders (`cms.js`, `assets/menu.js`) inject JSON-LD in the
browser. Googlebot renders JS and can read that, but **ClaudeBot, GPTBot,
PerplexityBot and most LLM ingestion pipelines do not execute JavaScript** —
they read raw HTML. So the canonical menu schema is written into the page's
`<head>` at publish time; the runtime loader is only a best-effort enrichment of
the live, human-visible menu.

| Layer | Source | Seen by JS-blind AI crawlers? |
|-------|--------|-------------------------------|
| **Static `<head>` JSON-LD** (canonical) | generated at Publish | ✅ yes |
| Runtime `assets/menu.js` (fallback) | `content/menu.json` | ❌ no |

---

## How it works

```
content/menu.json  ──Publish──▶  buildMenuJsonLdFile()  ──▶  menu/index.html
   (CMS edits)                    (git-sync.js step)          <head> JSON-LD
                                                              committed atomically
```

1. **Schema** (`.mowcms/schemas/site.json` → `menu`) drives the CMS editor:
   business type, currency, and drag-to-reorder **sections → items** with
   per-language name/description, price, photo and dietary tags.
2. The schema opts into projection with a `jsonld` block:
   ```json
   "jsonld": { "type": "menu", "into": "menu/index.html", "langs": ["en", "fa"] }
   ```
   Any schema can declare a projection target — the platform stays generic.
3. On **Publish** (`backend/lib/git-sync.js`), for every staged doc whose schema
   declares `jsonld`, `buildMenuJsonLdFile()` reads the target page, replaces the
   marked region, and adds the updated page to the **same commit**. It's
   best-effort: if the target page doesn't exist yet, the publish still succeeds.
4. The generator (`backend/lib/menu-schema.js`) emits, for each language:
   - `CafeOrCoffeeShop` / `Restaurant` (etc.) → `hasMenu` → `Menu`
   - `Menu` → `hasMenuSection` → `MenuSection` → `hasMenuItem` → `MenuItem`
   - `MenuItem` → `offers` (`Offer` with price + `priceCurrency`)
   - dietary tags → `suitableForDiet` (schema.org `RestrictedDiet` URLs)

Output lands between markers so regeneration is idempotent:

```html
<!-- MOW:MENU-SCHEMA -->
<script type="application/ld+json" data-mow-menu>{ …Menu… }</script>
<!-- /MOW:MENU-SCHEMA -->
```

---

## Files

| File | Role |
|------|------|
| `backend/lib/menu-schema.js` | Pure generator + HTML injector (zero-dep) |
| `backend/test/menu-schema.test.js` | Unit tests (`npm test`) |
| `backend/lib/git-sync.js` | Publish-time projection hook |
| `templates/standard/.mowcms/schemas/site.json` | `menu` schema (CMS editor) |
| `templates/standard/content/menu.json` | Seed menu |
| `templates/standard/menu/index.html` | Starter menu page (visible + baked JSON-LD) |
| `templates/standard/assets/menu.js` | Runtime renderer + JSON-LD sync (fallback) |
| `docs/examples/caspian-coast.menu.json` | Paste-ready Caspian menu (en/fa) |

Every **new** site scaffolded from `templates/standard/` gets this out of the box.

---

## Rolling out to an existing site (e.g. Caspian Coast Coffee)

Caspian lives in its own repo (`manoftheworldmedia/caspiancoast`,
`caspiancoast.com`, languages en/fa). To enable the menu there:

1. Copy `templates/standard/.mowcms/schemas/site.json`'s `menu` schema entry
   into the caspiancoast repo's `.mowcms/schemas/site.json` (keep `langs`
   `["en","fa"]` to match the site).
2. Copy `templates/standard/menu/index.html` and `templates/standard/assets/menu.js`
   into the caspiancoast repo (adjust styling to the Caspian brand).
3. Use `docs/examples/caspian-coast.menu.json` as the starting `content/menu.json`
   — **confirm the real item names, descriptions, prices and dietary tags with
   the client first** (the example values are placeholders drawn from the brand
   world).
4. Open the CMS → Caspian → **Menu**, edit, **Publish**. The `schema.org/Menu`
   JSON-LD is baked into `/menu/index.html` automatically.

Validate the result with Google's Rich Results Test and schema.org's validator.

---

## Supported values

- **Business types:** `CafeOrCoffeeShop`, `Restaurant`, `Bakery`, `BarOrPub`,
  `FastFoodRestaurant`, `IceCreamShop`, `Winery`, `Brewery`.
- **Dietary tags → schema.org:** `vegan`, `vegetarian`, `gluten-free`, `halal`,
  `kosher`, `low-calorie`, `low-fat`, `low-lactose`, `low-salt`, `diabetic`.
- **Currencies:** `usd`, `eur`, `gbp`, `cad`, `aud` (emitted upper-cased per
  ISO 4217). Prices are normalized to two decimals (`5` → `"5.00"`).
