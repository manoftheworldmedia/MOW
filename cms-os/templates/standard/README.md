# MOW CMS — Standard Starter Kit

The default content model for **every** MOW site. Drop it into a new site repo
and that site is instantly manageable in the portal, with the same structure,
the same multilingual setup, and the same editing experience as every other
MOW project. This is what makes onboarding a new site (or a client) take
minutes instead of a rebuild.

## What's in the box

```
.mowcms/schemas/site.json     ← the content model (what's editable & how)
content/home.json             ← starter homepage content
content/navigation.json       ← starter menu
content/settings.json         ← contact + social + footer
content/news/hello-world.json ← one sample blog post
content/pages/about.json       ← one sample page
```

### The five standard content types
| Type | Where it lives | What it is |
|------|----------------|------------|
| **Homepage** | `content/home.json` (single) | SEO + hero + images, per language |
| **Blog / News** | `content/news/*.json` (collection) | Add/edit/reorder posts: date, cover, featured, title/excerpt/body per language |
| **FAQ** | `content/faqs/*.json` (collection) | Add/edit/reorder Q&A: category, featured, question/answer per language |
| **Pages** | `content/pages/*.json` (collection) | Standalone pages: title + rich-text body per language |
| **Shop / Products** | `content/products/*.json` (collection) | Sellable products: SKU, price, currency, image, name/description per language |
| **Navigation** | `content/navigation.json` (single) | Drag-and-drop menu: link + label per language |
| **Settings** | `content/settings.json` (single) | Email, phone, social links, footer, shop on/off + currency |

### Multilingual by default
Languages are defined **once**, at the top of the generator that built
`site.json`, and currently set to **English / فارسی / Español**. Every text
field is captured per language. To change a site's languages, edit the `LANGS`
list and the per-language blocks in `site.json` (or just delete the `fa`/`es`
blocks for a single-language site).

### Language toggle (on/off per site)

Each site declares its languages once (`"languages": ["en","fa","es"]` at the top
of `site.json`). In the portal, **Projects → (a project) → Languages** lets an
admin turn languages on or off without editing code. Turning a language off
hides it everywhere in the editor; the underlying content is kept, so turning it
back on is lossless. The **primary** language (first in the list) always stays on.

### Auto-translate (English → other languages)

In the editor, every non-primary language block shows a **"🌐 Translate from
English"** button. Click it and the English copy for that section is translated
into that language (you review/tweak before Publish — it never auto-overwrites on
save). Translation uses the Claude API; set **`ANTHROPIC_API_KEY`** in the portal
environment (Render) to enable it. Optional: `MOW_TRANSLATE_MODEL` to pick a model.

## Onboarding a new site (3 steps)

1. **Copy the kit into the new site's repo:**
   ```
   cp -r cms-os/templates/standard/.mowcms   /path/to/new-site/
   cp -r cms-os/templates/standard/content   /path/to/new-site/
   ```
   Commit & push to the new repo.
2. **Connect it in the portal:** sign in as admin → **Projects → Connect a
   repository** → enter owner / repo / branch (the portal reads `.mowcms/schemas/`
   automatically).
3. **Invite the client (optional):** **Users → Add user** → role **Editor**,
   scoped to that one project. They log in and see only their site.

That's it — the new site has the exact same editing UI as mow.media.

## Using it with Claude (your build flow)

When you have Claude build a new site, add this instruction so the site ships
CMS-ready every time:

> **"Follow the MOW CMS Standard. Create a `.mowcms/schemas/site.json` using the
> standard content model (homepage, news, pages, navigation, settings),
> multilingual for [list the languages]. Wire the site's HTML to read from the
> matching `content/*.json` files (use `data-cms="path.to.field"` attributes and
> a small loader like `cms.js`), and generate starter `content/` files that
> validate against the schema."**

Claude then produces the site **and** its CMS config together, so the moment you
push to GitHub and connect the repo, it's editable in the portal.

## Shop (Stripe Checkout)

Any MOW site can sell products with zero extra services beyond Stripe.

**How it works:** products are CMS content (`content/products/*.json`). The
storefront keeps a cart in the browser, then hands off to **Stripe Checkout** —
your CMS backend creates the secure session and reads the price from Git, so
the amount charged can never be tampered with in the browser. Customers pay on
Stripe's hosted page; you handle no card data.

**Turn it on for a site (3 steps):**
1. **Add your Stripe secret key** in the portal: *Projects → (the project) →
   Stripe secret key* (`sk_live_…` or `sk_test_…`). It's stored server-side only,
   never sent to the browser.
2. **Add products** in the portal: *Shop / Products → + New* (SKU, price,
   currency, image, name/description). Publish.
3. **Drop the storefront script** on the site's shop page:
   ```html
   <script>window.MOW_SHOP = {
     api: 'https://YOUR-PORTAL.onrender.com',
     project: 'YOUR-PROJECT-ID'
   };</script>
   <script src="/assets/shop.js" defer></script>

   <!-- a product -->
   <button data-mow-add="mow-tee">Add to cart</button>
   <!-- cart + checkout -->
   Cart: <span data-mow-cart-count>0</span>
   <button data-mow-checkout>Checkout</button>
   ```
   (`assets/shop.js` ships in this kit.) Clicking **Checkout** redirects the
   customer to Stripe; on success/cancel they return to your site.

Start with Stripe **test keys** and test cards, then swap to live keys when ready.

## Field types available
`string · text · richtext · code · number · boolean · date · datetime · select ·
image · url · email · color · object · list`

Everything is validated by the shared schema engine on both the form and the
server, so no site can be saved into an invalid state.
