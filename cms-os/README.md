# MOW CMS OS — Content Operating System

A **Git-native, schema-enforced, multi-user, UI-first** CMS that replaces
PagesCMS / Sanity / Webflow CMS for structured content. GitHub is the only
database. Every change is a commit. The UI is generated entirely from schemas,
and the **same validator runs in the browser and on the server**, so an invalid
content state is impossible (Zero Drift).

```
┌──────────────┐    HTTPS/JSON    ┌────────────────────┐   GitHub REST   ┌──────────────┐
│  CMS Frontend │ ───────────────▶ │   CMS Engine (API)  │ ──────────────▶ │  GitHub repo  │
│  (SPA, ESM)   │ ◀─────────────── │  auth · validate ·  │ ◀────────────── │ (the database)│
│  Webflow-ish  │                  │  stage · commit     │                 │  JSON + HTML  │
└──────┬────────┘                  └─────────┬──────────┘                 └──────────────┘
       │   imports the SAME schema engine ───┘
       └────────────  /shared/schema-engine.js  ────────────┘
```

---

## 1. System architecture

Three layers, one shared brain:

| Layer | What it is | Key property |
|-------|------------|--------------|
| **Content DB** | A GitHub repo. Content = JSON files (structured) or files of any type (raw HTML). | No external DB. Every write is a commit. |
| **CMS Engine** (`/backend`) | Zero-dependency Node HTTP service. Authn/z, schema validation, staging, atomic commits, history, diffs, rollback. | Rejects invalid writes even if the UI is bypassed. |
| **CMS Frontend** (`/frontend`) | Zero-build ESM SPA. Login, project switcher, schema-driven editor, drag-drop arrays, autosave, live preview, publish, history. | Users never see Git. |
| **Schema Engine** (`/shared`) | One ESM module: field→widget mapping, validation, defaults, coercion, diff. | Imported by **both** frontend and backend → zero drift. |

**Interaction flow:** sign in → pick a project (a repo) → the engine loads its
schemas (from `.mowcms/schemas/` in the repo, falling back to a bundled file) →
the frontend renders forms from those schemas → edits autosave to a server-side
**staging area** (validated on the way in) → **Publish** flushes all staged
edits into **one atomic commit** via the GitHub Git Data API → history & diffs
are read straight from Git; **rollback** writes a new commit restoring old bytes.

## 2. Monorepo structure

```
cms-os/
├── shared/                     # the shared brain
│   ├── schema-engine.js        #   validate · coerce · defaults · diff · widgetFor
│   └── schemas/mow-site.json   #   bundled fallback schema for the MOW site
├── backend/                    # CMS engine — ZERO runtime dependencies
│   ├── server.js               #   HTTP server + all routes
│   ├── cli.js                  #   user/project admin from the terminal
│   └── lib/
│       ├── http.js             #   tiny router + static server
│       ├── auth.js             #   JWT (HMAC) + scrypt + RBAC
│       ├── github.js           #   GitHub REST/Git-Data driver
│       ├── projects.js         #   project (repo) registry + schema loading
│       ├── store.js            #   staging area (publish batching)
│       ├── git-sync.js         #   serialize · publish · diff · rollback
│       └── validation.js       #   bridge to the shared engine
├── frontend/                   # CMS UI — ZERO build step (native ESM)
│   ├── index.html · styles.css
│   ├── api.js · forms.js · app.js
├── infra/                      # Dockerfile · docker-compose · render.yaml
└── README.md

.mowcms/schemas/site.json       # (in the CONTENT repo root) Git-native schemas
content/home.json               # (in the CONTENT repo) the structured content
```

## 3. Backend (CMS engine)

Zero npm dependencies — built on Node 18+ built-ins (`http`, `crypto`, `fetch`).
That means **no install step** and it deploys anywhere.

**API surface**

```
POST   /api/auth/login                         email/password → JWT
GET    /api/auth/me

GET    /api/projects                           projects the user can see
POST   /api/projects                 (admin)   connect a repo
DELETE /api/projects/:id             (admin)
GET    /api/projects/:id/verify                check token/repo reachability

GET    /api/projects/:id/schemas               schema set (Git-native or bundled)
GET    /api/projects/:id/schemas/:name

GET    /api/projects/:id/content/:name         single → doc; collection → item list
GET    /api/projects/:id/content/:name/doc     one document (?path=)
POST   /api/projects/:id/content/:name/validate
POST   /api/projects/:id/content/:name/stage   (editor) validate + stage

GET    /api/projects/:id/staged
DELETE /api/projects/:id/staged                (editor) discard (?path= or all)
POST   /api/projects/:id/staged/diff           staged value vs. live
POST   /api/projects/:id/publish               (editor) ATOMIC commit of all staged

GET    /api/projects/:id/revisions             commit history (?path=)
POST   /api/projects/:id/diff                  diff between two commits
POST   /api/projects/:id/rollback              (editor) restore a file to a commit

GET/POST/PATCH/DELETE /api/users               (admin) team management
```

**Roles:** `admin` (everything) · `editor` (content write/publish) · `viewer`
(read-only). Project access is `*` (all) or an explicit list of project ids.

## 4. Frontend (Webflow-level UX)

- **Login** → JWT stored locally.
- **Project switcher** in the top bar (switch sites like Webflow).
- **Content navigator** sidebar: single docs, collections, history.
- **Schema-driven editor**: every widget is generated from the schema —
  text, textarea, code, number, toggle, select, date, image (with thumbnail),
  nested objects, and **drag-and-drop lists** for menus/ordering.
- **Autosave** (debounced 800 ms) → validates client-side → stages on the server.
- **Live preview** pane: for raw HTML docs it renders the edited body instantly
  via `srcdoc`; for structured docs it can embed the live site (`previewUrl`).
- **Publish bar**: review staged diffs → publish all as one commit with a message.
- **History / rollback** modal per document and globally.

## 5. Schema engine (shared)

A schema describes a collection (`single` file or `collection` folder) and its
fields. Field types: `string, text, richtext, code, number, boolean, date,
datetime, select, image, url, email, color, object, list`. The engine provides
`validate`, `coerce` (loose form input → correct types), `defaultsFor`,
`widgetFor` (type → UI widget) and `diff`. Unknown keys are rejected — drift
cannot enter. Because the browser imports the exact same file the server uses,
the form and the commit are validated by identical logic.

## 6. Git sync engine

- **Staging / batching** — edits accumulate server-side without touching Git.
- **Atomic publish** — blobs → tree → commit → ref update in one shot, with a
  structured commit message (`Published-By:` / `Via: MOW-CMS-OS` trailers).
- **Conflict handling** — optimistic locking via `expectedHead`; if the branch
  moved, publish fails with `CONFLICT` instead of clobbering.
- **Diffs** — structured field-level diffs (staged-vs-live and commit-vs-commit).
- **Rollback** — never rewrites history; restores old bytes as a new commit.

## 7. Deployment (time-to-first-site < 15 min)

**Run locally (≈2 min):**
```bash
cd cms-os/backend
cp .env.example .env          # set MOW_GITHUB_TOKEN + a JWT secret
node --env-file=.env server.js
# open http://localhost:4000  → sign in with MOW_ADMIN_EMAIL / MOW_ADMIN_PASSWORD
```
No `npm install` — there are no dependencies.

**Deploy (≈10 min):** push the repo and use `infra/render.yaml` (Render
Blueprint) or `infra/Dockerfile` (any container host / Fly / a VM). Set
`MOW_GITHUB_TOKEN`, `MOW_JWT_SECRET`, `MOW_ADMIN_*`. Mount a volume at
`backend/data` to persist users & project config.

**Onboard the first project:**
1. Create a GitHub fine-grained PAT with **Contents: read & write** on the repo.
2. Sign in as admin → **Projects → Connect a repository** (owner / repo / branch
   / token / optional `previewUrl`) → **Verify**.
3. Commit your schemas to `.mowcms/schemas/*.json` in that repo (a copy of
   `shared/schemas/mow-site.json` is already in this repo) — or rely on the
   bundled fallback. Start editing; **Publish** writes back to GitHub.

## Non-negotiables — how they're met
- **Git-native only** — GitHub is the sole content store; every change is a commit.
- **Schema-safe always** — one validator on both sides; unknown/invalid data rejected pre-commit.
- **Multi-user** — JWT auth + admin/editor/viewer roles + per-project access.
- **Multi-project** — a project = a repo; switch instantly in the UI.
- **Production-grade** — zero-dependency service, atomic commits, conflict detection, RBAC, rollback.
- **UX-first** — schema-driven forms, autosave, drag-drop, preview, one-click publish; Git stays invisible.
