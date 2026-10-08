import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { wirePairingCode, scheduleReconnect } from '../src/whatsapp.js';

// Mirrors the shape Baileys' real makeWASocket() return value has for the bits
// wirePairingCode touches — lets us verify the code path against WhatsApp
// without ever opening a real socket or contacting WhatsApp's servers.
function fakeSock({ requestPairingCode } = {}) {
  const ev = new EventEmitter();
  return {
    ev: { on: (...args) => ev.on(...args), emit: (...args) => ev.emit(...args) },
    requestPairingCode: requestPairingCode || (async () => 'ABCD1234'),
  };
}

test('wirePairingCode requests a code on the first real qr payload and formats it with dashes', async () => {
  const sock = fakeSock({ requestPairingCode: async (num) => { assert.equal(num, '15551234567'); return 'ABCD1234'; } });
  const calls = [];
  wirePairingCode(sock, { pairingNumber: '15551234567' }, { creds: { registered: false } }, (...args) => calls.push(args));

  sock.ev.emit('connection.update', { connection: 'connecting', qr: undefined }); // too early, no real qr yet
  assert.equal(calls.length, 0);

  sock.ev.emit('connection.update', { qr: 'real-qr-ref-data' });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'ABCD-1234');
  assert.equal(typeof calls[0][1], 'function'); // requestNew
  assert.equal(calls[0][2], null);
});

test('wirePairingCode only requests once even if qr fires again (WhatsApp rotates it every ~20s)', async () => {
  let requests = 0;
  const sock = fakeSock({ requestPairingCode: async () => { requests++; return 'ABCD1234'; } });
  wirePairingCode(sock, { pairingNumber: '15551234567' }, { creds: { registered: false } }, () => {});

  sock.ev.emit('connection.update', { qr: 'ref-1' });
  await new Promise((r) => setTimeout(r, 0));
  sock.ev.emit('connection.update', { qr: 'ref-2' });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(requests, 1);
});

test('wirePairingCode never requests once already registered, even with a pairing number set', async () => {
  let requests = 0;
  const sock = fakeSock({ requestPairingCode: async () => { requests++; return 'ABCD1234'; } });
  wirePairingCode(sock, { pairingNumber: '15551234567' }, { creds: { registered: true } }, () => {});

  sock.ev.emit('connection.update', { qr: 'ref-1' });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(requests, 0);
});

test('wirePairingCode reports a failed request through onPairingCode instead of throwing', async () => {
  const sock = fakeSock({ requestPairingCode: async () => { throw new Error('boom'); } });
  const calls = [];
  wirePairingCode(sock, { pairingNumber: '15551234567' }, { creds: { registered: false } }, (...args) => calls.push(args));

  sock.ev.emit('connection.update', { qr: 'ref-1' });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], null);
  assert.equal(calls[0][2].message, 'boom');
});

test('wirePairingCode exposes a requestNew function that asks the socket for a fresh code on demand', async () => {
  const codes = ['AAAA1111', 'BBBB2222'];
  let requests = 0;
  const sock = fakeSock({ requestPairingCode: async () => codes[requests++] });
  const calls = [];
  wirePairingCode(sock, { pairingNumber: '15551234567' }, { creds: { registered: false } }, (...args) => calls.push(args));

  sock.ev.emit('connection.update', { qr: 'ref-1' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests, 1);
  assert.equal(calls[0][0], 'AAAA-1111');

  const requestNew = calls[0][1];
  await requestNew();
  assert.equal(requests, 2);
  assert.equal(calls[1][0], 'BBBB-2222');
});

test('scheduleReconnect catches a rejected reconnect attempt instead of letting it crash the process', async () => {
  // Node terminates the whole process on an unhandled rejection by default (since v15) — a
  // fire-and-forget `setTimeout(() => startBot(...), delay)` with no .catch would turn one
  // transient reconnect failure (e.g. a broken auth dir) into a full outage.
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const start = async () => { throw new Error('auth dir is broken'); };
    scheduleReconnect(start, {}, {}, 0, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled, null);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('scheduleReconnect calls start again with the incremented attempt count after the given delay', async () => {
  const calls = [];
  const start = async (config, deps, attempt) => { calls.push({ config, deps, attempt }); };
  scheduleReconnect(start, { x: 1 }, { y: 2 }, 3, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, [{ config: { x: 1 }, deps: { y: 2 }, attempt: 4 }]);
});
