import assert from 'node:assert/strict';
import test from 'node:test';
import type { MoonieApi } from './api.ts';
import { TaskStore } from './taskStore.ts';
import type { SnoozeRequest, Task, TaskCreate, TaskUpdate } from '../types/backend';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', recurring_rule_id: null, title: 'Read', notes: null, status: 'pending', task_type: 'flexible',
  due_at: null, scheduled_at: null, snoozed_until: null, snooze_count: 0, estimated_minutes: null,
  energy_level: null, completed_at: null, dropped_at: null, created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z', is_blocked: false, prerequisite_ids: [], dependent_ids: [], ...overrides,
});

function fakeApi(initialTasks: Task[] = []): MoonieApi & { tasks: Task[] } {
  const api: MoonieApi & { tasks: Task[] } = {
    tasks: initialTasks,
    health: async () => ({ status: 'ok', service: 'Moonie Task Engine', version: 'test' }),
    listTasks: async () => api.tasks,
    createTask: async (input: TaskCreate) => {
      const created = task({ id: `task-${api.tasks.length + 1}`, title: input.title });
      api.tasks = [...api.tasks, created];
      return created;
    },
    updateTask: async (id: string, input: TaskUpdate) => {
      api.tasks = api.tasks.map((item) => item.id === id ? { ...item, ...input } : item);
      return api.tasks.find((item) => item.id === id) as Task;
    },
    deleteTask: async (id: string) => { api.tasks = api.tasks.filter((item) => item.id !== id); },
    startTask: async (id: string) => api.tasks.find((item) => item.id === id) as Task,
    completeTask: async (id: string) => api.tasks.find((item) => item.id === id) as Task,
    reopenTask: async (id: string) => api.tasks.find((item) => item.id === id) as Task,
    dropTask: async (id: string) => api.tasks.find((item) => item.id === id) as Task,
    snoozeTask: async (id: string, _input: SnoozeRequest) => api.tasks.find((item) => item.id === id) as Task,
    addDependency: async () => ({ id: 'dependency-1', task_id: 'task-1', depends_on_task_id: 'task-2', created_at: '2030-01-01T00:00:00Z' }),
    removeDependency: async () => undefined,
    listRecurringRules: async () => [],
    createRecurringRule: async () => { throw new Error('not used'); },
    updateRecurringRule: async () => { throw new Error('not used'); },
    deleteRecurringRule: async () => undefined,
    parseBrainDump: async () => ({ provider: 'openai_compatible', proposals: [] }),
  };
  return api;
}

test('loads tasks and refreshes after creation', async () => {
  const api = fakeApi([task()]);
  const store = new TaskStore(api);

  await store.load();
  assert.equal(store.getSnapshot().tasks.length, 1);
  assert.equal(await store.createTask({ title: 'Write' }), true);
  assert.deepEqual(store.getSnapshot().tasks.map((item) => item.title), ['Read', 'Write']);
});

test('prevents duplicate mutations while preserving server state after failure', async () => {
  let release: (() => void) | undefined;
  const api = fakeApi([task()]);
  api.updateTask = async () => new Promise((resolve) => {
    release = () => resolve(task());
  });
  const store = new TaskStore(api);
  await store.load();

  const first = store.updateTask('task-1', { title: 'Updated' });
  const second = await store.updateTask('task-1', { title: 'Duplicate' });
  assert.equal(second, false);
  release?.();
  assert.equal(await first, true);
  assert.equal(store.getSnapshot().tasks[0]?.title, 'Read');
});

test('preserves tasks and reports an error when a mutation fails', async () => {
  const api = fakeApi([task()]);
  api.updateTask = async () => { throw new Error('Update failed'); };
  const store = new TaskStore(api);
  await store.load();

  assert.equal(await store.updateTask('task-1', { title: 'Will fail' }), false);
  assert.equal(store.getSnapshot().tasks[0]?.title, 'Read');
  assert.equal(store.getSnapshot().error, 'Update failed');
});

test('ignores an older load response when a newer load completes first', async () => {
  const api = fakeApi();
  let resolveFirst: ((value: Task[]) => void) | undefined;
  let resolveSecond: ((value: Task[]) => void) | undefined;
  let call = 0;
  api.listTasks = () => new Promise((resolve) => {
    call += 1;
    if (call === 1) resolveFirst = resolve;
    else resolveSecond = resolve;
  });
  const store = new TaskStore(api);
  const first = store.load();
  const second = store.load(true);
  resolveSecond?.([task({ id: 'new', title: 'New result' })]);
  await second;
  resolveFirst?.([task({ id: 'old', title: 'Old result' })]);
  await first;

  assert.equal(store.getSnapshot().tasks[0]?.id, 'new');
});
