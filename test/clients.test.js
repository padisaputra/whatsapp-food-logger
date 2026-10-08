import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import {
  normalizeNumber, addClient, resolveClientRef, removeClient, pauseClient, resumeClient,
  deleteClientData, listClients, isActiveClient, seedClientsFromAllowedNumbers, buildInviteText,
} from '../src/clients.js';
import { addEntries, setTargets, hasAnyEntries, getTargets } from '../src/food/store.js';

test('normalizeNumber strips formatting and accepts a plausible E.164-range number', () => {
  const res = normalizeNumber('+44 7700 900123');
  assert.equal(res.ok, true);
  assert.equal(res.digits, '447700900123');
});

test('normalizeNumber expands a leading 0 using the default country code', () => {
  const res = normalizeNumber('0812-3456-7890', '62');
  assert.equal(res.ok, true);
  assert.equal(res.digits, '6281234567890');
});

test('normalizeNumber leaves a leading 0 as-is when no default country code is configured', () => {
  const res = normalizeNumber('0812 3456 7890', '');
  assert.equal(res.ok, true);
  assert.equal(res.digits, '081234567890');
});

test('normalizeNumber still rejects a too-short leading-0 number with no default country code', () => {
  const res = normalizeNumber('0812345', '');
  assert.equal(res.ok, false);
});

test('normalizeNumber rejects numbers outside the 8-15 digit range', () => {
  assert.equal(normalizeNumber('12345').ok, false);
  assert.equal(normalizeNumber('1'.repeat(20)).ok, false);
});

test('addClient inserts a new active client', () => {
  const db = createDb(':memory:');
  const result = addClient(db, { clientId: '447700900123', name: 'Alex' });
  assert.equal(result.reactivated, false);
  assert.equal(result.client.status, 'active');
  assert.equal(result.client.name, 'Alex');
});

test('addClient rejects a duplicate active client', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '447700900123', name: 'Alex' });
  const second = addClient(db, { clientId: '447700900123', name: 'Alex again' });
  assert.equal(second.error, 'duplicate');
});

test('addClient reactivates a previously removed client instead of rejecting it', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '447700900123', name: 'Alex' });
  removeClient(db, '447700900123');
  const result = addClient(db, { clientId: '447700900123' });
  assert.equal(result.reactivated, true);
  assert.equal(result.client.status, 'active');
  assert.equal(result.client.name, 'Alex'); // name preserved when not re-supplied
});

test('resolveClientRef finds a client by number or by exact case-insensitive name', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '447700900123', name: 'Alex' });
  assert.equal(resolveClientRef(db, '447700900123').client.client_id, '447700900123');
  assert.equal(resolveClientRef(db, '+44 7700 900123').client.client_id, '447700900123');
  assert.equal(resolveClientRef(db, 'alex').client.client_id, '447700900123');
  assert.equal(resolveClientRef(db, 'ALEX').client.client_id, '447700900123');
});

test('resolveClientRef reports ambiguous when two clients share a name', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '111', name: 'Sam' });
  addClient(db, { clientId: '222', name: 'Sam' });
  const result = resolveClientRef(db, 'Sam');
  assert.equal(result.error, 'ambiguous');
  assert.equal(result.matches.length, 2);
});

test('resolveClientRef reports not_found for an unknown reference', () => {
  const db = createDb(':memory:');
  assert.equal(resolveClientRef(db, 'nobody').error, 'not_found');
});

test('pauseClient and resumeClient toggle status without losing the client row', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '111', name: 'Sam' });
  pauseClient(db, '111');
  assert.equal(isActiveClient(db, '111'), false);
  assert.equal(listClients(db)[0].status, 'paused');
  resumeClient(db, '111');
  assert.equal(isActiveClient(db, '111'), true);
});

test('removeClient blocks the allowlist check but listClients excludes them', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '111', name: 'Sam' });
  removeClient(db, '111');
  assert.equal(isActiveClient(db, '111'), false);
  assert.equal(listClients(db).length, 0);
});

test('isActiveClient is false for a number that was never added', () => {
  const db = createDb(':memory:');
  assert.equal(isActiveClient(db, '999'), false);
});

test('deleteClientData removes entries, targets, and the client row', () => {
  const db = createDb(':memory:');
  addClient(db, { clientId: '111', name: 'Sam' });
  setTargets(db, '111', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  addEntries(db, { clientId: '111', date: '2026-10-08', time: '12:00', items: [{ name: 'rice', kcal: 100, protein_g: 2, carbs_g: 20, fat_g: 0 }], source: 'text' });

  deleteClientData(db, '111');

  assert.equal(hasAnyEntries(db, '111'), false);
  assert.deepEqual(getTargets(db, '111', { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }), { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 });
  assert.equal(resolveClientRef(db, '111').error, 'not_found');
});

test('seedClientsFromAllowedNumbers is idempotent and never overwrites an existing status', () => {
  const db = createDb(':memory:');
  seedClientsFromAllowedNumbers(db, ['111', '222']);
  pauseClient(db, '111');
  seedClientsFromAllowedNumbers(db, ['111', '222']); // simulate a second bot restart
  assert.equal(isActiveClient(db, '111'), false); // still paused, not reset to active
  assert.equal(isActiveClient(db, '222'), true);
});

test('buildInviteText includes a wa.me link when a bot number is known, and degrades gracefully without one', () => {
  assert.match(buildInviteText('15550001111'), /wa\.me\/15550001111/);
  assert.doesNotMatch(buildInviteText(''), /wa\.me/);
});
