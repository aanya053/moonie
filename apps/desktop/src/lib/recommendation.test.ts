import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../types/backend';
import { getRecommendation } from './recommendation.ts';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', recurring_rule_id: null, title: 'Flexible work', notes: null, status: 'pending', task_type: 'flexible',
  due_at: null, scheduled_at: null, snoozed_until: null, snooze_count: 0, estimated_minutes: null, energy_level: null,
  completed_at: null, dropped_at: null, created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z',
  is_blocked: false, prerequisite_ids: [], dependent_ids: [], ...overrides,
});

test('prioritizes overdue deadlines over flexible work and explains why', () => {
  const result = getRecommendation([
    task({ id: 'flexible', title: 'Tidy desk' }),
    task({ id: 'late', title: 'Submit report', task_type: 'deadline', due_at: '2030-01-09T10:00:00Z' }),
  ], new Date('2030-01-10T10:00:00Z'));
  assert.equal(result.task?.id, 'late');
  assert.equal(result.reason, 'This deadline is overdue.');
});

test('excludes blocked, completed, dropped, future-snoozed and future-scheduled tasks', () => {
  const result = getRecommendation([
    task({ id: 'blocked', is_blocked: true }),
    task({ id: 'done', status: 'completed' }),
    task({ id: 'dropped', status: 'dropped' }),
    task({ id: 'snoozed', status: 'snoozed', snoozed_until: '2030-01-12T10:00:00Z' }),
    task({ id: 'scheduled', scheduled_at: '2030-01-12T10:00:00Z' }),
  ], new Date('2030-01-10T10:00:00Z'));
  assert.equal(result.task, null);
});

test('uses a deterministic tie-breaker and can recommend an eligible snoozed task', () => {
  const result = getRecommendation([
    task({ id: 'later', title: 'Later', created_at: '2030-01-02T00:00:00Z' }),
    task({ id: 'ready', title: 'Ready', status: 'snoozed', snoozed_until: '2030-01-09T00:00:00Z', created_at: '2030-01-01T00:00:00Z' }),
  ], new Date('2030-01-10T10:00:00Z'));
  assert.equal(result.task?.id, 'ready');
  assert.equal(getRecommendation([task({ id: 'b' }), task({ id: 'a' })]).task?.id, 'a');
});
