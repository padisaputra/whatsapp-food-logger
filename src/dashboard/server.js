import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { openDashboardDb, listClientIds } from './dbAccess.js';
import { createSession, isValidSession, destroySession, checkPassword, parseCookies } from './auth.js';
import { todayView, trendsView, foodStats, coachOverview, photoPathFor, exportEntries } from './queries.js';
import { entriesToCsv } from '../food/csv.js';
import {
  addClient, removeClient, pauseClient, resumeClient, listClients, normalizeNumber,
  seedClientsFromAllowedNumbers,
} from '../clients.js';
import { setTargets } from '../food/store.js';

const DASHBOARD_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(DASHBOARD_DIR, '..', '..', 'dashboard', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PUBLIC_PATHS = new Set(['/style.css', '/app.js', '/login.html', '/login.js']);
const VALID_RANGES = new Set([7, 30, 90]);

export function loadDashboardConfig(env = process.env) {
  const base = loadConfig(env);
  const host = env.DASHBOARD_HOST || '127.0.0.1';
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const password = env.DASHBOARD_PASSWORD || '';
  if (!isLocal && !password) {
    throw new Error('DASHBOARD_PASSWORD is required when DASHBOARD_HOST is not 127.0.0.1/localhost.');
  }
  return {
    ...base,
    dashboardHost: host,
    dashboardPort: Number(env.DASHBOARD_PORT || 4870),
    isLocal,
    password,
    dbPath: env.DASHBOARD_DB ? path.resolve(env.DASHBOARD_DB) : path.join(base.dataDir, 'food.db'),
  };
}

// Sent on every response. The CSP allows only same-origin scripts (no
// inline), and frame-ancestors/X-Frame-Options stop another site from
// framing the Coach tab and click-jacking its Remove/Pause buttons.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
};

// Local mode skips the password, so it must only answer requests that were
// actually addressed to this machine. Checking the Host header blocks DNS
// rebinding, where a web page you visit re-points its own hostname at
// 127.0.0.1 and reads the dashboard API from your browser.
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLocalHostHeader(host) {
  if (!host) return false;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

// Login throttle: after MAX_LOGIN_FAILURES wrong passwords from one address
// within the window, further attempts are refused until it expires.
const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginThrottle() {
  const failures = new Map(); // ip -> { count, resetAt }
  return {
    isLocked(ip) {
      const f = failures.get(ip);
      if (!f) return false;
      if (Date.now() > f.resetAt) {
        failures.delete(ip);
        return false;
      }
      return f.count >= MAX_LOGIN_FAILURES;
    },
    fail(ip) {
      const f = failures.get(ip);
      if (!f || Date.now() > f.resetAt) failures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
      else f.count += 1;
    },
    clear(ip) {
      failures.delete(ip);
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Coach actions (add/remove/pause/resume client) require an application/json
// body on purpose: a cross-site <form> POST can only send simple content
// types (urlencoded/multipart/text), and a cross-origin fetch() sending JSON
// triggers a CORS preflight this server never approves — so neither can reach
// these routes with the session cookie attached. Combined with the session
// cookie's SameSite=Lax, that's the CSRF defense; no extra token needed.
async function readJsonBody(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) return { error: 'expected an application/json request body' };
  const raw = await readBody(req);
  try {
    return { body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: 'invalid JSON body' };
  }
}

function serveStatic(res, pathname) {
  const resolved = path.resolve(path.join(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readSessionToken(req) {
  return parseCookies(req.headers.cookie).dash_session;
}

function resolveClientId(searchParams, config, db) {
  const requested = searchParams.get('client');
  const clients = listClientIds(db);
  if (requested && clients.includes(requested)) return requested;
  if (clients.includes(config.allowedNumbers[0])) return config.allowedNumbers[0];
  return clients[0] || config.allowedNumbers[0] || null;
}

async function handleLogin(req, res, config, throttle) {
  const ip = req.socket.remoteAddress || '';
  if (throttle.isLocked(ip)) {
    res.writeHead(302, { Location: '/login.html?error=locked' });
    return res.end();
  }
  const body = await readBody(req);
  const candidate = new URLSearchParams(body).get('password') || '';
  if (!checkPassword(candidate, config.password)) {
    throttle.fail(ip);
    res.writeHead(302, { Location: '/login.html?error=1' });
    return res.end();
  }
  throttle.clear(ip);
  const token = createSession();
  res.writeHead(302, {
    'Set-Cookie': `dash_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,
    Location: '/',
  });
  res.end();
}

function handleLogout(req, res) {
  destroySession(readSessionToken(req));
  res.writeHead(302, { 'Set-Cookie': 'dash_session=; HttpOnly; Path=/; Max-Age=0', Location: '/login.html' });
  res.end();
}

function handlePhoto(pathname, searchParams, res, config, db) {
  const id = Number(pathname.split('/')[3]);
  const clientId = resolveClientId(searchParams, config, db);
  const photoPath = clientId && id ? photoPathFor(db, clientId, id) : null;
  if (!photoPath) {
    res.writeHead(404);
    return res.end();
  }
  const dataDir = path.resolve(config.dataDir);
  const resolved = path.resolve(dataDir, photoPath);
  if (!resolved.startsWith(dataDir + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(data);
  });
}

function handleApi(pathname, searchParams, res, config, db) {
  if (pathname === '/api/clients') {
    const names = {};
    for (const c of db.prepare('SELECT client_id, name FROM clients WHERE name IS NOT NULL').all()) names[c.client_id] = c.name;
    return sendJson(res, 200, {
      clients: listClientIds(db),
      names,
      coachEnabled: Boolean(config.coachNumber),
      authRequired: !config.isLocal,
    });
  }

  if (pathname === '/api/today') {
    const clientId = resolveClientId(searchParams, config, db);
    return sendJson(res, 200, clientId ? todayView(db, clientId, config.tz, searchParams.get('date') || undefined) : null);
  }

  if (pathname === '/api/trends') {
    const clientId = resolveClientId(searchParams, config, db);
    const requestedRange = Number(searchParams.get('range') || 30);
    const range = VALID_RANGES.has(requestedRange) ? requestedRange : 30;
    return sendJson(res, 200, clientId ? trendsView(db, clientId, config.tz, range) : null);
  }

  if (pathname === '/api/foods') {
    const clientId = resolveClientId(searchParams, config, db);
    return sendJson(res, 200, clientId ? foodStats(db, clientId, searchParams.get('q') || '') : { mostLogged: [], history: [] });
  }

  if (pathname === '/api/coach') {
    if (!config.coachNumber) return sendJson(res, 403, { error: 'coach mode disabled' });
    const roster = listClients(db);
    const overview = coachOverview(db, roster.map((c) => c.client_id), config.tz);
    const byId = new Map(roster.map((c) => [c.client_id, c]));
    const clients = overview.map((o) => ({
      ...o,
      name: byId.get(o.clientId)?.name || null,
      status: byId.get(o.clientId)?.status || 'active',
    }));
    return sendJson(res, 200, { clients });
  }

  if (pathname === '/api/export.csv') {
    const clientId = resolveClientId(searchParams, config, db);
    const csv = entriesToCsv(clientId ? exportEntries(db, clientId) : []);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${clientId || 'export'}-food-log.csv"`,
    });
    return res.end(csv);
  }

  sendJson(res, 404, { error: 'not found' });
}

async function handleClientsMutation(req, res, pathname, config, db) {
  if (!config.coachNumber) return sendJson(res, 403, { error: 'coach mode disabled' });
  const { body, error } = await readJsonBody(req);
  if (error) return sendJson(res, 400, { error });

  const action = pathname.slice('/api/clients/'.length);

  if (action === 'add') {
    const numberRaw = String(body.number || '').trim();
    const name = String(body.name || '').trim() || null;
    if (!numberRaw) return sendJson(res, 400, { error: 'number is required' });

    const norm = normalizeNumber(numberRaw, config.defaultCountryCode);
    if (!norm.ok) return sendJson(res, 400, { error: norm.reason });

    const result = addClient(db, { clientId: norm.digits, name });
    if (result.error === 'duplicate') return sendJson(res, 400, { error: 'already a client', client: result.client });

    const targetFields = ['kcal', 'protein_g', 'carbs_g', 'fat_g'].map((k) => Number(body[k]));
    if (targetFields.every((n) => Number.isFinite(n) && n > 0)) {
      const [kcal, protein_g, carbs_g, fat_g] = targetFields;
      setTargets(db, norm.digits, { kcal, protein_g, carbs_g, fat_g }, config.defaultTargets);
    }

    return sendJson(res, 200, { ok: true, client: result.client, reactivated: Boolean(result.reactivated) });
  }

  if (action === 'remove' || action === 'pause' || action === 'resume') {
    const ref = String(body.client || '').trim();
    if (!ref) return sendJson(res, 400, { error: 'client is required' });
    const fn = action === 'remove' ? removeClient : action === 'pause' ? pauseClient : resumeClient;
    const result = fn(db, ref);
    if (result.error === 'not_found') return sendJson(res, 404, { error: `no client matching "${ref}"` });
    if (result.error === 'ambiguous') return sendJson(res, 409, { error: 'ambiguous', matches: result.matches });
    return sendJson(res, 200, { ok: true, client: result.client });
  }

  return sendJson(res, 404, { error: 'not found' });
}

export function createServer(config, db) {
  const throttle = loginThrottle();
  return http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    try {
      if (config.isLocal && !isLocalHostHeader(req.headers.host)) {
        res.writeHead(421, { 'Content-Type': 'text/plain' });
        return res.end('This dashboard only answers on 127.0.0.1 or localhost. To open it from another device, see docs/DASHBOARD.md.');
      }
      const url = new URL(req.url, 'http://localhost');
      const { pathname, searchParams } = url;

      if (req.method === 'GET' && PUBLIC_PATHS.has(pathname)) return serveStatic(res, pathname);
      if (req.method === 'POST' && pathname === '/login') return await handleLogin(req, res, config, throttle);
      if (req.method === 'POST' && pathname === '/logout') return handleLogout(req, res);

      const authed = config.isLocal || isValidSession(readSessionToken(req));
      if (!authed) {
        if (pathname.startsWith('/api/')) return sendJson(res, 401, { error: 'unauthorized' });
        res.writeHead(302, { Location: '/login.html' });
        return res.end();
      }

      if (req.method === 'GET' && pathname === '/') return serveStatic(res, '/index.html');
      if (req.method === 'POST' && pathname.startsWith('/api/clients/')) return await handleClientsMutation(req, res, pathname, config, db);
      if (req.method === 'GET' && pathname.startsWith('/api/photo/')) return handlePhoto(pathname, searchParams, res, config, db);
      if (req.method === 'GET' && pathname.startsWith('/api/')) return handleApi(pathname, searchParams, res, config, db);

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
}

export function startServer(config) {
  const db = openDashboardDb(config.dbPath);
  seedClientsFromAllowedNumbers(db, config.allowedNumbers);
  const server = createServer(config, db);
  server.listen(config.dashboardPort, config.dashboardHost, () => {
    const mode = config.isLocal ? 'local only' : 'password protected';
    console.log(`dashboard listening on http://${config.dashboardHost}:${config.dashboardPort} (${mode})`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(loadDashboardConfig());
}
