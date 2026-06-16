/**
 * Minimal zero-dependency HTTP router with middleware, JSON body parsing,
 * route params (/api/projects/:id/content/:name) and static file serving.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export class Router {
  constructor() { this.routes = []; this.middleware = []; this.statics = []; }

  use(fn) { this.middleware.push(fn); }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }
  put(p, h) { this.add('PUT', p, h); }

  /** Serve static files from `dir` mounted at urlPrefix. */
  serveStatic(urlPrefix, dir, { spa = false } = {}) { this.statics.push({ urlPrefix, dir, spa }); }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), params: {}, state: {} };
    try {
      for (const mw of this.middleware) { const stop = await mw(ctx); if (stop === false) return; }

      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) ctx.body = await readJson(req);

      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        const result = await r.handler(ctx);
        if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
        return;
      }

      // static
      for (const s of this.statics) {
        if (url.pathname === s.urlPrefix || url.pathname.startsWith(s.urlPrefix === '/' ? '/' : s.urlPrefix + '/')) {
          if (serveFile(s, url.pathname, res)) return;
        }
      }
      sendJson(res, 404, { error: 'Not found', path: url.pathname });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[error]', err);
      if (!res.writableEnded) sendJson(res, status, { error: err.message, ...(err.errors ? { errors: err.errors } : {}), ...(err.code ? { code: err.code } : {}) });
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 25 * 1024 * 1024) reject(new Error('Payload too large')); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); } });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(mount, pathname, res) {
  let rel = pathname.slice(mount.urlPrefix === '/' ? 1 : mount.urlPrefix.length + 1);
  if (rel === '' ) rel = 'index.html';
  let file = path.join(mount.dir, rel);
  if (!file.startsWith(path.resolve(mount.dir))) return false; // traversal guard
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (mount.spa) file = path.join(mount.dir, 'index.html');
    else return false;
  }
  if (!fs.existsSync(file)) return false;
  const ext = path.extname(file);
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
  res.end(body);
  return true;
}
