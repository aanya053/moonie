import assert from 'node:assert/strict';
import test from 'node:test';
import { isMoonieShortcut, isPrimaryPointerClick } from './interaction.ts';

test('keyboard shortcut and mascot primary click use shared interaction predicates', () => {
  assert.equal(isMoonieShortcut({ ctrlKey: true, shiftKey: true, code: 'Space', key: ' ' }), true);
  assert.equal(isMoonieShortcut({ ctrlKey: true, shiftKey: false, code: 'Space', key: ' ' }), false);
  assert.equal(isPrimaryPointerClick({ button: 0 }), true);
  assert.equal(isPrimaryPointerClick({ button: 2 }), false);
});
