import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../types/backend';
import { ReminderTracker, reminderForTask } from './reminders.ts';

const task = (overrides: Partial<Task> = {}): Task => ({ id: 'task-1', recurring_rule_id: null, title: 'Review', notes: null, status: 'pending', task_type: 'deadline', due_at: '2030-01-01T10:00:00Z', scheduled_at: null, snoozed_until: null, snooze_count: 0, estimated_minutes: null, energy_level: null, completed_at: null, dropped_at: null, created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', is_blocked: false, prerequisite_ids: [], dependent_ids: [], ...overrides });

const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }; };

test('reminder eligibility excludes completed, dropped, blocked and future snoozed tasks', () => {
  const now = new Date('2030-01-01T10:05:00Z');
  assert.ok(reminderForTask(task(), now));
  assert.equal(reminderForTask(task({ status: 'completed' }), now), null);
  assert.equal(reminderForTask(task({ status: 'dropped' }), now), null);
  assert.equal(reminderForTask(task({ is_blocked: true }), now), null);
  assert.equal(reminderForTask(task({ status: 'snoozed', snoozed_until: '2030-01-01T11:00:00Z' }), now), null);
});

test('tracker deduplicates polling and persists sent occurrences', () => {
  const shared = storage();
  const now = new Date('2030-01-01T10:05:00Z');
  const first = new ReminderTracker(shared);
  assert.equal(first.pending([task()], now).length, 1);
  first.markSent(first.pending([task()], now));
  assert.equal(first.pending([task()], now).length, 0);
  const afterReload = new ReminderTracker(shared);
  assert.equal(afterReload.pending([task()], now).length, 0);
});

test('missed reminders older than the catch-up window are ignored', () => {
  assert.equal(reminderForTask(task(), new Date('2030-01-01T10:16:00Z')), null);
});
