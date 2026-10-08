import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, mondayOf, datesBetween, todayInTz, mealTypeFromTime, isValidIanaTimeZone } from '../src/dates.js';

test('addDays moves across month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-10-08', 0), '2026-10-08');
});

test('mondayOf finds the Monday of the week containing the date', () => {
  assert.equal(mondayOf('2026-10-08'), '2026-10-05'); // Thursday -> Monday
  assert.equal(mondayOf('2026-10-05'), '2026-10-05'); // Monday -> itself
  assert.equal(mondayOf('2026-10-11'), '2026-10-05'); // Sunday -> previous Monday
});

test('datesBetween is inclusive of both ends', () => {
  assert.deepEqual(datesBetween('2026-10-05', '2026-10-08'), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
  ]);
});

test('todayInTz formats a known instant for two different timezones', () => {
  const instant = new Date('2026-10-08T23:30:00Z');
  assert.equal(todayInTz('UTC', instant), '2026-10-08');
  assert.equal(todayInTz('Asia/Bangkok', instant), '2026-10-09'); // UTC+7, already past midnight
});

test('todayInTz respects a DST transition', () => {
  // US DST ended 2026-11-01 02:00 EDT -> EST. Just before and after the transition,
  // the calendar date should still track local time, not flip early/late.
  const beforeFallback = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
  const afterFallback = new Date('2026-11-01T07:30:00Z'); // 01:30 EST (post fall-back)
  assert.equal(todayInTz('America/New_York', beforeFallback), '2026-11-01');
  assert.equal(todayInTz('America/New_York', afterFallback), '2026-11-01');
});

test('mealTypeFromTime buckets by hour of day', () => {
  assert.equal(mealTypeFromTime('07:30'), 'breakfast');
  assert.equal(mealTypeFromTime('12:00'), 'lunch');
  assert.equal(mealTypeFromTime('18:45'), 'dinner');
  assert.equal(mealTypeFromTime('23:10'), 'snack');
  assert.equal(mealTypeFromTime('02:00'), 'snack');
});

test('mealTypeFromTime returns null for unparseable input', () => {
  assert.equal(mealTypeFromTime(''), null);
  assert.equal(mealTypeFromTime(undefined), null);
});

test('isValidIanaTimeZone accepts real zones and rejects garbage', () => {
  assert.equal(isValidIanaTimeZone('Asia/Bangkok'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('Not/AZone'), false);
  assert.equal(isValidIanaTimeZone(''), false);
});
