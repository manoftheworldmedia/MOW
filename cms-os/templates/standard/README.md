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
| **Pages** | `content/pages/*.json` (collection) | Standalone pages: title + rich-text body per language |
| **Navigation** | `content/navigation.json` (single) | Drag-and-drop menu: link + label per language |
| **Settings** | `content/settings.json` (single) | Email, phone, social links, footer tagline |

### Multilingual by default
Languages are defined **once**, at the top of the generator that built
`site.json`, and currently set to **English / فارسی / Español**. Every text
field is captured per language. To change a site's languages, edit the `LANGS`
list and the per-language blocks in `site.json` (or just delete the `fa`/`es`
blocks for a single-language site).

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

## Field types available
`string · text · richtext · code · number · boolean · date · datetime · select ·
image · url · email · color · object · list`

Everything is validated by the shared schema engine on both the form and the
server, so no site can be saved into an invalid state.
