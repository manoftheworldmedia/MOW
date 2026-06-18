/**
 * Auth — zero-dependency JWT (HMAC-SHA256) + scrypt password hashing + RBAC.
 * Users live in backend/data/users.json (operational store, NOT content).
 * Roles: admin (full), editor (content write), viewer (read-only).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const SECRET = process.env.MOW_JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = 60 * 60 * 12; // 12h

export const ROLES = ['admin', 'editor', 'viewer'];
const RANK = { viewer: 0, editor: 1, admin: 2 };

// ---------- password hashing (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}
export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, dk] = stored.split('$');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(dk, 'hex'), Buffer.from(test, 'hex'));
}

// ---------- JWT ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function sign(payloadObj) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ ...payloadObj, iat: now, exp: now + TOKEN_TTL }));
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

// ---------- user store ----------
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return { users: [] }; }
}
function writeUsers(db) { fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2)); }

export function findUser(email) {
  return readUsers().users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}
export function listUsers() {
  return readUsers().users.map(({ passwordHash, ...rest }) => rest);
}
export function createUser({ email, password, role = 'editor', projects = [] }) {
  const db = readUsers();
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    throw new Error('A user with that email already exists.');
  if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}".`);
  const user = {
    id: crypto.randomUUID(), email, role,
    projects, passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeUsers(db);
  const { passwordHash, ...safe } = user;
  return safe;
}
export function updateUser(id, patch) {
  const db = readUsers();
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (patch.role) { if (!ROLES.includes(patch.role)) throw new Error('Invalid role.'); u.role = patch.role; }
  if (patch.projects) u.projects = patch.projects;
  if (patch.password) u.passwordHash = hashPassword(patch.password);
  writeUsers(db);
  const { passwordHash, ...safe } = u;
  return safe;
}
export function deleteUser(id) {
  const db = readUsers();
  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== id);
  if (db.users.length === before) throw new Error('User not found.');
  writeUsers(db);
}

export function login(email, password) {
  const u = findUser(email);
  if (!u || !verifyPassword(password, u.passwordHash)) return null;
  const token = sign({ sub: u.id, email: u.email, role: u.role });
  return { token, user: { id: u.id, email: u.email, role: u.role, projects: u.projects } };
}

/** Get the current user (with live role/projects) from a verified token. */
export function currentUser(claims) {
  if (!claims) return null;
  const u = readUsers().users.find((x) => x.id === claims.sub);
  if (!u) return null;
  return { id: u.id, email: u.email, role: u.role, projects: u.projects };
}

export function hasRole(user, min) { return user && RANK[user.role] >= RANK[min]; }
export function canAccessProject(user, projectId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.projects) && user.projects.includes(projectId);
}

/** Seed a default admin if the user store is empty (first boot). */
export function ensureSeedAdmin() {
  const db = readUsers();
  if (db.users.length > 0) return null;
  const email = process.env.MOW_ADMIN_EMAIL || 'admin@mow.media';
  const password = process.env.MOW_ADMIN_PASSWORD || 'changeme123';
  const user = createUser({ email, password, role: 'admin', projects: ['*'] });
  return { email, password, user };
}
