export const MASCOT_SIZE_MIN = 96;
export const MASCOT_SIZE_MAX = 192;
export const DEFAULT_MASCOT_SIZE = 128;
export interface MoonieSettings { focusMinutes: number; breakMinutes: number; remindersEnabled: boolean; mascotSize: number; }
export const defaultSettings: MoonieSettings = { focusMinutes: 25, breakMinutes: 5, remindersEnabled: true, mascotSize: DEFAULT_MASCOT_SIZE };
const KEY = 'moonie.settings.v1';

export function loadSettings(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): MoonieSettings {
  try { const saved = storage?.getItem(KEY); if (!saved) return defaultSettings; const parsed = JSON.parse(saved); return { focusMinutes: clamp(parsed.focusMinutes, 1, 120, 25), breakMinutes: clamp(parsed.breakMinutes, 1, 60, 5), remindersEnabled: parsed.remindersEnabled !== false, mascotSize: clamp(parsed.mascotSize, MASCOT_SIZE_MIN, MASCOT_SIZE_MAX, DEFAULT_MASCOT_SIZE) }; } catch { return defaultSettings; }
}

export function saveSettings(settings: MoonieSettings, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  const safe = { focusMinutes: clamp(settings.focusMinutes, 1, 120, 25), breakMinutes: clamp(settings.breakMinutes, 1, 60, 5), remindersEnabled: settings.remindersEnabled, mascotSize: clamp(settings.mascotSize, MASCOT_SIZE_MIN, MASCOT_SIZE_MAX, DEFAULT_MASCOT_SIZE) };
  try { storage?.setItem(KEY, JSON.stringify(safe)); } catch { /* private storage may be unavailable */ }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback; }
