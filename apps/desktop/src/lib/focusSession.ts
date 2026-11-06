export type FocusMode = 'focus' | 'break';
export type FocusStatus = 'idle' | 'running' | 'paused' | 'completed' | 'ended';
export interface FocusSession { mode: FocusMode; status: FocusStatus; durationSeconds: number; startedAt: number | null; pausedAt: number | null; pausedElapsedSeconds: number; taskId: string | null; taskTitle: string | null; }
export interface FocusStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const KEY = 'moonie.focus-session.v1';
export const emptyFocusSession: FocusSession = { mode: 'focus', status: 'idle', durationSeconds: 1500, startedAt: null, pausedAt: null, pausedElapsedSeconds: 0, taskId: null, taskTitle: null };

export function loadFocusSession(storage: FocusStorage | null = typeof localStorage === 'undefined' ? null : localStorage): FocusSession {
  try { const saved = storage?.getItem(KEY); if (!saved) return emptyFocusSession; const parsed = { ...emptyFocusSession, ...JSON.parse(saved) } as FocusSession; return recoverFocusSession(parsed, Date.now()); } catch { return emptyFocusSession; }
}

export function saveFocusSession(session: FocusSession, storage: FocusStorage | null = typeof localStorage === 'undefined' ? null : localStorage): void { try { storage?.setItem(KEY, JSON.stringify(session)); } catch { /* private storage may be unavailable */ } }

export function elapsedSeconds(session: FocusSession, now = Date.now()): number { if (session.status === 'idle') return 0; if (session.status === 'paused' || session.status === 'ended') return Math.min(session.durationSeconds, session.pausedElapsedSeconds); if (!session.startedAt) return 0; return Math.min(session.durationSeconds, session.pausedElapsedSeconds + Math.max(0, Math.floor((now - session.startedAt) / 1000))); }
export function remainingSeconds(session: FocusSession, now = Date.now()): number { return Math.max(0, session.durationSeconds - elapsedSeconds(session, now)); }
export function recoverFocusSession(session: FocusSession, now = Date.now()): FocusSession { if (session.status !== 'running') return session; return remainingSeconds(session, now) <= 0 ? { ...session, status: 'completed', pausedElapsedSeconds: session.durationSeconds } : session; }
export function startFocus(mode: FocusMode, durationMinutes: number, now = Date.now(), taskId: string | null = null, taskTitle: string | null = null): FocusSession { return { mode, status: 'running', durationSeconds: Math.max(60, Math.round(durationMinutes * 60)), startedAt: now, pausedAt: null, pausedElapsedSeconds: 0, taskId, taskTitle }; }
export function pauseFocus(session: FocusSession, now = Date.now()): FocusSession { if (session.status !== 'running') return session; return { ...session, status: 'paused', pausedAt: now, pausedElapsedSeconds: elapsedSeconds(session, now), startedAt: null }; }
export function resumeFocus(session: FocusSession, now = Date.now()): FocusSession { if (session.status !== 'paused') return session; return { ...session, status: 'running', pausedAt: null, startedAt: now }; }
export function endFocus(session: FocusSession): FocusSession { return session.status === 'idle' ? session : { ...session, status: 'ended', startedAt: null, pausedAt: null, pausedElapsedSeconds: elapsedSeconds(session) }; }
