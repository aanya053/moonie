import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MASCOT_SIZE, MASCOT_SIZE_MAX, MASCOT_SIZE_MIN, loadSettings, saveSettings } from './settings.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } as unknown as Storage;
}

test('mascot size defaults comfortably and persists through settings storage', () => {
  const store = storage();
  assert.equal(loadSettings(store).mascotSize, DEFAULT_MASCOT_SIZE);
  saveSettings({ focusMinutes: 25, breakMinutes: 5, remindersEnabled: true, mascotSize: 160 }, store);
  assert.equal(loadSettings(store).mascotSize, 160);
});

test('mascot size is clamped to supported native window bounds', () => {
  const store = storage();
  saveSettings({ focusMinutes: 25, breakMinutes: 5, remindersEnabled: true, mascotSize: MASCOT_SIZE_MIN - 20 }, store);
  assert.equal(loadSettings(store).mascotSize, MASCOT_SIZE_MIN);
  saveSettings({ focusMinutes: 25, breakMinutes: 5, remindersEnabled: true, mascotSize: MASCOT_SIZE_MAX + 20 }, store);
  assert.equal(loadSettings(store).mascotSize, MASCOT_SIZE_MAX);
});
