# Inviting Clients to the CMS Portal

This guide covers how to give a client (or collaborator) access to the MOW CMS OS portal so they can edit and publish their own site without ever seeing GitHub.

---

## Roles at a glance

| Role | What they can do |
|------|-----------------|
| **viewer** | Browse content and history — read-only, cannot stage or publish |
| **editor** | Edit content, stage changes, publish to GitHub, view history and diffs |
| **admin** | Everything above + manage users, add/remove projects |

For most clients: **editor** is the right role. Give `viewer` to stakeholders who only need to review.

---

## Option A — Admin UI (easiest)

1. Sign in to the portal as **admin**.
2. Click **Team** in the sidebar.
3. Click **Invite user**.
4. Enter the client's email and a temporary password.
5. Set **Role → Editor**.
6. Under **Project access**, choose either:
   - **All projects** — they see every site in the portal.
   - **Specific projects** — select only their site (recommended).
7. Click **Create**. Send the client the portal URL + their temporary credentials. Ask them to change their password on first login.

---

## Option B — CLI (when the portal isn't reachable)

SSH or Render Shell into the backend and run:

```bash
# Full access to one project only (most common for a client)
node cli.js user:add client@example.com TempPass123! editor caspian-coast-coffee

# Access to multiple projects (comma-separated project ids)
node cli.js user:add client@example.com TempPass123! editor caspian-coast-coffee,all-model-repair

# All projects (leave the last argument blank or omit)
node cli.js user:add client@example.com TempPass123! editor
```

The **project id** is the slugified `owner-repo` — e.g. `caspiancoast` repo → id `manoftheworldmedia-caspiancoast`. Find ids with:

```bash
node cli.js project:list
```

---

## What the client sees

- They land on the portal login page.
- After signing in they see **only the projects they have access to** in the project switcher.
- They click into a project → pick a content type from the sidebar → fill in the form → **Publish**. That's the entire workflow. Git, branches, and commits are invisible.
- The portal URL is whatever your Render service URL is (e.g. `https://mow-cms-os.onrender.com`).

---

## Updating or revoking access

**Via admin UI** → Team → click the user → edit role/projects or click **Delete**.

**Via CLI:**

```bash
# Not in the CLI tool — use the API directly or the admin UI.
# The admin UI is the easiest path for edits.
```

---

## Important: the client's GitHub token

The client **does not need a GitHub account or token** — their Publish clicks use the shared `MOW_GITHUB_TOKEN` configured in Render. That token must have **Contents: read & write** access to every repo the client will publish to. If you see a 403 on Publish, check that the token covers the right repos (see the GitHub token setup note in the Render dashboard).

---

## Quick checklist

- [ ] Portal deployed on Render with a persistent disk (see `infra/render.yaml`)
- [ ] `MOW_GITHUB_TOKEN` in Render covers all repos clients will publish to
- [ ] Client user created with **editor** role + correct project access
- [ ] Client given the portal URL and their temporary credentials
- [ ] Client told to change their password after first login
