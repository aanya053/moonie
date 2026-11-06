import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, moonieApi } from './api.ts';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('lists tasks with the backend filters and parses JSON', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{ id: 'task-1', title: 'Read', status: 'pending' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const tasks = await moonieApi.listTasks({ status: 'pending', task_type: 'flexible' });

  assert.equal(tasks[0]?.id, 'task-1');
  assert.match(requestedUrl, /status=pending/);
  assert.match(requestedUrl, /task_type=flexible/);
});

test('normalizes FastAPI validation details', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: [{ loc: ['body', 'title'], msg: 'Field required', type: 'missing' }],
  }), { status: 422, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    moonieApi.createTask({ title: '' }),
    (error: unknown) => error instanceof ApiError
      && error.status === 422
      && error.kind === 'http'
      && error.message === 'Field required',
  );
});

test('normalizes connection failures and preserves cancellation', async () => {
  globalThis.fetch = async () => { throw new TypeError('connection refused'); };
  await assert.rejects(
    moonieApi.listTasks(),
    (error: unknown) => error instanceof ApiError && error.kind === 'network',
  );

  globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  await assert.rejects(
    moonieApi.listTasks(),
    (error: unknown) => error instanceof ApiError && error.kind === 'cancelled',
  );
});

test('uses the dependency and recurring-rule endpoints without changing their payloads', async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    const isRule = String(input).includes('recurring-rules');
    return new Response(isRule ? JSON.stringify({ id: 'rule-1', title: 'Weekly review' }) : JSON.stringify({ id: 'dep-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await moonieApi.addDependency('task-1', 'task-2');
  await moonieApi.createRecurringRule({ title: 'Weekly review', frequency: 'weekly', interval_val: 2, days_of_week: [0, 4], time_of_day: '09:00' });

  assert.equal(requests[0]?.method, 'POST');
  assert.match(requests[0]?.url ?? '', /tasks\/task-1\/dependencies$/);
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), { depends_on_task_id: 'task-2' });
  assert.equal(requests[1]?.method, 'POST');
  assert.match(requests[1]?.url ?? '', /recurring-rules$/);
  assert.equal(JSON.parse(requests[1]?.body ?? '{}').interval_val, 2);
});
