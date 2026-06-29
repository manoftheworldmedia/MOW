/**
 * GitHub integration layer — the "database driver".
 * Uses the GitHub REST + Git Data APIs via global fetch (Node 18+). No SDK.
 *
 * Capabilities:
 *  - read a file / list a directory at a ref
 *  - atomic multi-file commit (blobs -> tree -> commit -> ref) for publish batching
 *  - single-file commit (Contents API) convenience
 *  - commit history for a path, read a file at a specific commit (rollback/diff)
 *  - read latest commit sha of a branch (conflict detection)
 */

const API = 'https://api.github.com';

export class GitHubClient {
  constructor({ token, owner, repo, branch = 'main' }) {
    if (!token) throw new Error('GitHub token required.');
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  async _fetch(url, opts = {}) {
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'MOW-CMS-OS',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 404) return { __notFound: true, status: 404 };
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}: ${body.message || res.statusText}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  _base() { return `/repos/${this.owner}/${this.repo}`; }

  /** Verify the repo is reachable and the token has access. */
  async verify() {
    const r = await this._fetch(this._base());
    if (r.__notFound) throw new Error('Repository not found or token lacks access.');
    return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private };
  }

  /** Read a UTF-8 file. Returns { content, sha } or null if missing. */
  async readFile(filePath, ref = this.branch) {
    const r = await this._fetch(`${this._base()}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`);
    if (r.__notFound) return null;
    if (Array.isArray(r)) throw new Error(`${filePath} is a directory, not a file.`);
    const content = Buffer.from(r.content || '', r.encoding || 'base64').toString('utf8');
    return { content, sha: r.sha, path: r.path };
  }

  /** List entries in a directory. Returns [{ name, path, type, sha }]. */
  async listDir(dirPath, ref = this.branch) {
    const p = dirPath && dirPath !== '.' ? `/${encodePath(dirPath)}` : '';
    const r = await this._fetch(`${this._base()}/contents${p}?ref=${encodeURIComponent(ref)}`);
    if (r.__notFound) return [];
    if (!Array.isArray(r)) return [];
    return r.map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha }));
  }

  /** Latest commit sha on the working branch (used for optimistic locking). */
  async headSha(ref = this.branch) {
    const r = await this._fetch(`${this._base()}/git/ref/heads/${encodeURIComponent(ref)}`);
    return r.object.sha;
  }

  /**
   * Atomic multi-file commit. `files` = [{ path, content }] (content is UTF-8
   * string) or { path, delete: true }. Returns the new commit metadata.
   * `expectedHead` (optional) enables conflict detection — if HEAD moved, throw.
   */
  async commitFiles({ files, message, author, expectedHead }) {
    const branch = this.branch;
    const head = await this.headSha(branch);
    if (expectedHead && head !== expectedHead) {
      const err = new Error('Branch moved since edits began (conflict).');
      err.code = 'CONFLICT';
      err.currentHead = head;
      throw err;
    }
    const baseCommit = await this._fetch(`${this._base()}/git/commits/${head}`);
    const baseTreeSha = baseCommit.tree.sha;

    // Create blobs for each written file.
    const tree = [];
    for (const f of files) {
      if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await this._fetch(`${this._base()}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' }),
      });
      tree.push({ path: f.path, mode: f.mode || '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await this._fetch(`${this._base()}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });

    const commit = await this._fetch(`${this._base()}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [head],
        ...(author ? { author: { name: author.name, email: author.email, date: new Date().toISOString() } } : {}),
      }),
    });

    await this._fetch(`${this._base()}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return { sha: commit.sha, message, url: commit.html_url, files: files.map((f) => f.path) };
  }

  /** Commit history for a path. Returns [{ sha, message, author, date, url }]. */
  async history(filePath, { limit = 30 } = {}) {
    const q = new URLSearchParams({ sha: this.branch, per_page: String(limit) });
    if (filePath) q.set('path', filePath);
    const r = await this._fetch(`${this._base()}/commits?${q.toString()}`);
    if (r.__notFound || !Array.isArray(r)) return [];
    return r.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name,
      email: c.commit.author?.email,
      date: c.commit.author?.date,
      url: c.html_url,
    }));
  }

  /** Read a file's content at a specific commit (for diff/rollback preview). */
  async readFileAt(filePath, sha) {
    return this.readFile(filePath, sha);
  }

  /**
   * Commit a single binary file (image upload) via the Contents API.
   * `base64Content` is the raw base64 payload (no data: prefix).
   * Overwrites if a file already exists at that path.
   */
  async commitBinaryFile({ path: filePath, base64Content, message, author }) {
    const existing = await this._fetch(`${this._base()}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(this.branch)}`);
    const body = {
      message,
      content: base64Content,
      branch: this.branch,
      ...(existing && !existing.__notFound ? { sha: existing.sha } : {}),
      ...(author ? { committer: { name: author.name, email: author.email } } : {}),
    };
    const r = await this._fetch(`${this._base()}/contents/${encodePath(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return { path: filePath, sha: r.content?.sha, url: r.commit?.html_url };
  }
}

function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}
