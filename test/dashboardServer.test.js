import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { addEntries, setTargets } from '../src/food/store.js';
import { addClient } from '../src/clients.js';
import http from 'node:http';
import { createServer, isLocalHostHeader, loadDashboardConfig } from '../src/dashboard/server.js';

function baseConfig(overrides = {}) {
  return {
    tz: 'UTC',
    dataDir: '/tmp/wfl-dashboard-test',
    allowedNumbers: ['alex'],
    coachNumber: null,
    isLocal: true,
    password: '',
    ...overrides,
  };
}

function seedDb() {
  const db = createDb(':memory:');
  addClient(db, { clientId: 'alex', name: 'Alex' });
  setTargets(db, 'alex', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  addEntries(db, {
    clientId: 'alex',
    date: '2026-10-08',
    time: '12:00',
    items: [{ name: 'chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9 }],
    source: 'text',
  });
  return db;
}

async function withServer(config, db, fn) {
  const server = createServer(config, db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/clients lists clients without auth when local', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/clients`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.clients, ['alex']);
    assert.equal(body.coachEnabled, false);
  });
});

test('GET /api/today returns the day report with meals grouped', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/today?client=alex&date=2026-10-08`);
    const body = await res.json();
    assert.equal(body.eaten.kcal, 330);
    assert.equal(body.meals[0].meal, 'lunch');
  });
});

test('GET /api/coach is forbidden when coach mode is off', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/coach`);
    assert.equal(res.status, 403);
  });
});

test('GET /api/coach returns client flags when coach mode is on', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/coach`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clients[0].clientId, 'alex');
  });
});

function postJson(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('POST /api/clients/add is forbidden when coach mode is off', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });
    assert.equal(res.status, 403);
  });
});

test('POST /api/clients/add requires an application/json body (CSRF defense)', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/clients/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'number=15550001111&name=Sam',
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/clients/add creates a client that then shows up in /api/clients and /api/coach', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    const addRes = await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam', kcal: 2100, protein_g: 160, carbs_g: 220, fat_g: 60 });
    assert.equal(addRes.status, 200);
    const added = await addRes.json();
    assert.equal(added.client.client_id, '15550001111');
    assert.equal(added.client.name, 'Sam');

    const clientsRes = await fetch(`${base}/api/clients`);
    const clientsBody = await clientsRes.json();
    assert.ok(clientsBody.clients.includes('15550001111'));

    const coachRes = await fetch(`${base}/api/coach`);
    const coachBody = await coachRes.json();
    const sam = coachBody.clients.find((c) => c.clientId === '15550001111');
    assert.equal(sam.name, 'Sam');
    assert.equal(sam.status, 'active');
    assert.equal(sam.today.targets.kcal, 2100); // the optional targets on the add form were applied
  });
});

test('POST /api/clients/add rejects a duplicate and an implausible number', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });
    const dup = await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });
    assert.equal(dup.status, 400);

    const bad = await postJson(base, '/api/clients/add', { number: '123', name: 'Bad' });
    assert.equal(bad.status, 400);
  });
});

test('POST /api/clients/pause and /resume toggle a client out of and back into the active roster', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });

    const paused = await postJson(base, '/api/clients/pause', { client: 'Sam' });
    assert.equal(paused.status, 200);
    const pausedBody = await paused.json();
    assert.equal(pausedBody.client.status, 'paused');

    const resumed = await postJson(base, '/api/clients/resume', { client: '15550001111' });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).client.status, 'active');
  });
});

test('POST /api/clients/remove drops a client out of the coach roster', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });
    const removed = await postJson(base, '/api/clients/remove', { client: '15550001111' });
    assert.equal(removed.status, 200);

    const coachBody = await (await fetch(`${base}/api/coach`)).json();
    assert.ok(!coachBody.clients.some((c) => c.clientId === '15550001111'));
  });
});

test('POST /api/clients/pause 404s for an unknown client and 409s for an ambiguous name', async () => {
  await withServer(baseConfig({ coachNumber: 'alex' }), seedDb(), async (base) => {
    const notFound = await postJson(base, '/api/clients/pause', { client: 'nobody' });
    assert.equal(notFound.status, 404);

    await postJson(base, '/api/clients/add', { number: '15550001111', name: 'Sam' });
    await postJson(base, '/api/clients/add', { number: '15550002222', name: 'Sam' });
    const ambiguous = await postJson(base, '/api/clients/pause', { client: 'Sam' });
    assert.equal(ambiguous.status, 409);
  });
});

test('API requests are rejected without a session when not local', async () => {
  await withServer(baseConfig({ isLocal: false, password: 'secret123' }), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/today`);
    assert.equal(res.status, 401);
  });
});

test('logging in with the right password grants a session cookie that unlocks the API', async () => {
  await withServer(baseConfig({ isLocal: false, password: 'secret123' }), seedDb(), async (base) => {
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=secret123',
    });
    assert.equal(loginRes.status, 302);
    const cookie = loginRes.headers.get('set-cookie');
    assert.match(cookie, /^dash_session=/);

    const apiRes = await fetch(`${base}/api/today`, { headers: { cookie } });
    assert.equal(apiRes.status, 200);
  });
});

test('logging in with the wrong password does not grant a session', async () => {
  await withServer(baseConfig({ isLocal: false, password: 'secret123' }), seedDb(), async (base) => {
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    });
    assert.equal(loginRes.status, 302);
    assert.match(loginRes.headers.get('location'), /\/login\.html/);
    assert.equal(loginRes.headers.get('set-cookie'), null);
  });
});

test('GET /api/export.csv streams a CSV file for the client', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/export.csv?client=alex`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const text = await res.text();
    assert.match(text, /chicken breast/);
  });
});

test('photo endpoint 404s when the entry has no photo_path column', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/photo/1?client=alex`);
    assert.equal(res.status, 404);
  });
});

function rawGet(base, pathname, headers = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: pathname, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

test('local mode refuses requests addressed to a foreign Host (DNS rebinding)', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const evil = await rawGet(base, '/api/today?client=alex', { Host: 'attacker.example:4870' });
    assert.equal(evil.statusCode, 421);
    const ok = await rawGet(base, '/api/today?client=alex', { Host: 'localhost:4870' });
    assert.equal(ok.statusCode, 200);
  });
});

test('isLocalHostHeader accepts loopback names only', () => {
  assert.equal(isLocalHostHeader('127.0.0.1:4870'), true);
  assert.equal(isLocalHostHeader('localhost'), true);
  assert.equal(isLocalHostHeader('[::1]:4870'), true);
  assert.equal(isLocalHostHeader('127.0.0.1.evil.example'), false);
  assert.equal(isLocalHostHeader(undefined), false);
});

test('every response carries anti-framing and nosniff headers', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  });
});

test('repeated wrong passwords lock out further login attempts, even the right one', async () => {
  await withServer(baseConfig({ isLocal: false, password: 'secret123' }), seedDb(), async (base) => {
    const attempt = (password) =>
      fetch(`${base}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `password=${password}`,
      });
    for (let i = 0; i < 10; i++) await attempt('wrong');
    const locked = await attempt('secret123');
    assert.match(locked.headers.get('location'), /error=locked/);
    assert.equal(locked.headers.get('set-cookie'), null);
  });
});

test('/api/clients reports display names and whether a login is required', async () => {
  await withServer(baseConfig(), seedDb(), async (base) => {
    const body = await (await fetch(`${base}/api/clients`)).json();
    assert.deepEqual(body.names, { alex: 'Alex' });
    assert.equal(body.authRequired, false);
  });
  await withServer(baseConfig({ isLocal: false, password: 'secret123' }), seedDb(), async (base) => {
    const res = await fetch(`${base}/api/clients`);
    assert.equal(res.status, 401);
  });
});

test('dashboard binds to localhost by default and needs a password anywhere else', () => {
  const env = { ALLOWED_NUMBERS: '15550100100' };
  const local = loadDashboardConfig(env);
  assert.equal(local.dashboardHost, '127.0.0.1');
  assert.equal(local.isLocal, true);
  assert.throws(() => loadDashboardConfig({ ...env, DASHBOARD_HOST: '0.0.0.0' }), /DASHBOARD_PASSWORD/);
  assert.equal(loadDashboardConfig({ ...env, DASHBOARD_HOST: '0.0.0.0', DASHBOARD_PASSWORD: 'pw' }).isLocal, false);
});

test('photo endpoint never serves another client\'s photo', async () => {
  const db = seedDb();
  if (!db.prepare('PRAGMA table_info(entries)').all().some((c) => c.name === 'photo_path')) {
    db.exec('ALTER TABLE entries ADD COLUMN photo_path TEXT');
  }
  addClient(db, { clientId: 'sam', name: 'Sam' });
  db.prepare("UPDATE entries SET photo_path = 'photos/alex-1.jpg' WHERE client_id = 'alex'").run();
  const { id } = db.prepare("SELECT id FROM entries WHERE client_id = 'alex'").get();
  await withServer(baseConfig(), db, async (base) => {
    const res = await fetch(`${base}/api/photo/${id}?client=sam`);
    assert.equal(res.status, 404);
  });
});
