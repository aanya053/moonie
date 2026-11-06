import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import { endFocus, loadFocusSession, pauseFocus, recoverFocusSession, remainingSeconds, resumeFocus, saveFocusSession, startFocus, type FocusSession } from '../lib/focusSession';
import { loadSettings, saveSettings, MASCOT_SIZE_MAX, MASCOT_SIZE_MIN } from '../lib/settings';
import { getDesktopNotificationPermission, requestDesktopNotificationPermission, sendDesktopNotification } from '../lib/notifications';
import type { Task } from '../types/backend';

interface FocusSessionPanelProps { tasks: Task[]; onStateChange?: (session: FocusSession) => void; onMascotSizeChange?: (size: number) => void; }

function format(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }

export const FocusSessionPanel: React.FC<FocusSessionPanelProps> = ({ tasks, onStateChange, onMascotSizeChange }) => {
  const [session, setSession] = useState<FocusSession>(() => loadFocusSession());
  const [settings, setSettings] = useState(() => loadSettings());
  const [now, setNow] = useState(() => Date.now());
  const [taskId, setTaskId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const completionNotificationRef = useRef<string | null>(null);

  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  const displaySession = recoverFocusSession(session, now);
  const update = (next: FocusSession) => { setSession(next); saveFocusSession(next); onStateChange?.(next); };
  const selectedTask = tasks.find((task) => task.id === taskId);
  const running = displaySession.status === 'running';
  const active = !['idle', 'ended', 'completed'].includes(displaySession.status);
  const begin = (mode: 'focus' | 'break') => update(startFocus(mode, mode === 'focus' ? settings.focusMinutes : settings.breakMinutes, Date.now(), mode === 'focus' ? selectedTask?.id ?? null : null, mode === 'focus' ? selectedTask?.title ?? null : null));
  const savePreference = (key: 'focusMinutes' | 'breakMinutes', value: number) => { const next = { ...settings, [key]: Math.min(key === 'focusMinutes' ? 120 : 60, Math.max(1, Math.round(value || 1))) }; setSettings(next); saveSettings(next); };
  const saveMascotSize = (value: number) => { const mascotSize = Math.min(MASCOT_SIZE_MAX, Math.max(MASCOT_SIZE_MIN, Math.round(value))); const next = { ...settings, mascotSize }; setSettings(next); saveSettings(next); onMascotSizeChange?.(mascotSize); };
  useEffect(() => {
    if (displaySession.status !== 'completed' || !settings.remindersEnabled) return;
    const key = `${displaySession.mode}:${displaySession.startedAt}`;
    if (completionNotificationRef.current === key) return;
    completionNotificationRef.current = key;
    void (async () => {
      if (await getDesktopNotificationPermission() === 'granted') await sendDesktopNotification('Moonie session complete', displaySession.mode === 'focus' ? 'A gentle pause is enough.' : 'Ready when you are.', key);
    })();
  }, [displaySession.mode, displaySession.startedAt, displaySession.status, settings.remindersEnabled]);

  const requestNotifications = async () => { const permission = await requestDesktopNotificationPermission(); if (permission === 'granted') { const next = { ...settings, remindersEnabled: true }; setSettings(next); saveSettings(next); } };
  return <section className="focus-panel" aria-labelledby="focus-heading"><div className="panel-heading"><div><h3 id="focus-heading">Focus &amp; breaks</h3><p>{active && session.taskTitle ? `Returning to: ${session.taskTitle}` : 'A quiet timer with no scorekeeping.'}</p></div><button type="button" className="text-button" onClick={() => setShowSettings((value) => !value)}>{showSettings ? 'Hide settings' : 'Settings'}</button></div>{showSettings && <div className="focus-settings"><label>Focus minutes<input type="number" min="1" max="120" value={settings.focusMinutes} onChange={(event) => savePreference('focusMinutes', Number(event.target.value))} /></label><label>Break minutes<input type="number" min="1" max="60" value={settings.breakMinutes} onChange={(event) => savePreference('breakMinutes', Number(event.target.value))} /></label><label className="settings-slider">Mascot size <span>{settings.mascotSize}px</span><input aria-label="Mascot size" type="range" min={MASCOT_SIZE_MIN} max={MASCOT_SIZE_MAX} step="4" value={settings.mascotSize} onChange={(event) => saveMascotSize(Number(event.target.value))} /></label><label className="settings-check"><input type="checkbox" checked={settings.remindersEnabled} onChange={(event) => { const next = { ...settings, remindersEnabled: event.target.checked }; setSettings(next); saveSettings(next); }} />Reminders enabled</label><button type="button" className="text-button" onClick={() => void requestNotifications()}>Enable desktop notifications</button></div>}{!active ? <><div className="focus-start-row"><select aria-label="Task for focus session" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">No task selected</option>{tasks.filter((task) => !task.is_blocked && !['completed', 'dropped'].includes(task.status)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><button type="button" className="action-button primary" onClick={() => begin('focus')}><Play size={13} />Start focus</button><button type="button" className="action-button" onClick={() => begin('break')}><RotateCcw size={13} />Start break</button></div>{displaySession.status === 'completed' && <div className="feedback">Session complete. A gentle pause is enough.</div>}</> : <div className="focus-active"><div className="focus-clock" aria-live="polite">{format(remainingSeconds(displaySession, now))}</div><span className="focus-state">{displaySession.mode === 'focus' ? 'Focusing softly' : 'Taking a break'}</span><div className="task-actions">{running ? <button type="button" className="action-button" onClick={() => update(pauseFocus(session))}><Pause size={13} />Pause</button> : <button type="button" className="action-button primary" onClick={() => update(resumeFocus(session))}><Play size={13} />Resume</button>}<button type="button" className="action-button" onClick={() => update(endFocus(session))}><Square size={12} />End early</button></div></div>}</section>;
};
