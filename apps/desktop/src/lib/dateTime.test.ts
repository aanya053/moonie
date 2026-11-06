import assert from 'node:assert/strict';
import test from 'node:test';
import { fromApiDateTime, isToday, isUpcoming, toApiDateTime } from './dateTime.ts';

test('converts local datetime input to an API ISO timestamp and back', () => {
  const input = '2030-06-15T09:30';
  const apiValue = toApiDateTime(input);
  assert.ok(apiValue?.startsWith('2030-06-15T'));
  assert.equal(fromApiDateTime(apiValue), input);
});

test('groups dates deterministically for today and upcoming views', () => {
  const now = new Date('2030-06-15T12:00:00');
  assert.equal(isToday('2030-06-15T09:30:00', now), true);
  assert.equal(isUpcoming('2030-06-16T09:30:00', now), true);
  assert.equal(isUpcoming('2030-06-14T09:30:00', now), false);
});
