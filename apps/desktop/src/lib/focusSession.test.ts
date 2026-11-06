import assert from 'node:assert/strict';
import test from 'node:test';
import { elapsedSeconds, endFocus, pauseFocus, recoverFocusSession, remainingSeconds, resumeFocus, startFocus } from './focusSession.ts';

test('focus session uses timestamps for accurate pause, resume and remaining time', () => {
  let session = startFocus('focus', 25, 100_000);
  assert.equal(remainingSeconds(session, 101_000), 1499);
  session = pauseFocus(session, 110_000);
  assert.equal(elapsedSeconds(session, 999_999), 10);
  session = resumeFocus(session, 200_000);
  assert.equal(remainingSeconds(session, 201_000), 1489);
  assert.equal(endFocus(session).status, 'ended');
});

test('reload recovery completes expired sessions without mutating tasks', () => {
  const session = startFocus('break', 5, 100_000);
  const recovered = recoverFocusSession(session, 401_000);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.taskId, null);
});
