import type { Task } from '../types/backend';

export interface ReminderEvent { taskId: string; occurrence: string; title: string; kind: 'due' | 'scheduled'; }
export interface ReminderStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }

const STORAGE_KEY = 'moonie.reminders.v1';
const CATCH_UP_WINDOW_MS = 15 * 60 * 1000;

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function reminderForTask(task: Task, now = new Date()): ReminderEvent | null {
  if (['completed', 'dropped'].includes(task.status) || task.is_blocked) return null;
  const snooze = timestamp(task.snoozed_until);
  if (task.status === 'snoozed' && snooze !== null && snooze > now.getTime()) return null;
  const due = timestamp(task.due_at);
  const scheduled = timestamp(task.scheduled_at);
  const candidates = [
    due === null ? null : { time: due, kind: 'due' as const },
    scheduled === null ? null : { time: scheduled, kind: 'scheduled' as const },
  ].filter((candidate): candidate is { time: number; kind: 'due' | 'scheduled' } => candidate !== null && candidate.time <= now.getTime());
  if (!candidates.length) return null;
  const selected = candidates.sort((left, right) => left.time - right.time)[0];
  if (now.getTime() - selected.time > CATCH_UP_WINDOW_MS) return null;
  return { taskId: task.id, occurrence: `${task.id}:${selected.kind}:${selected.time}`, title: task.title, kind: selected.kind };
}

export class ReminderTracker {
  private readonly storage: ReminderStorage | null;
  private sent = new Set<string>();

  constructor(storage?: ReminderStorage | null) {
    this.storage = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    try { const saved = this.storage?.getItem(STORAGE_KEY); if (saved) this.sent = new Set(JSON.parse(saved)); } catch { this.sent = new Set(); }
  }

  pending(tasks: Task[], now = new Date()): ReminderEvent[] {
    return tasks.map((task) => reminderForTask(task, now)).filter((event): event is ReminderEvent => event !== null && !this.sent.has(event.occurrence));
  }

  markSent(events: ReminderEvent[]): void {
    events.forEach((event) => this.sent.add(event.occurrence));
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.sent].slice(-500))); } catch { /* private storage may be unavailable */ }
  }
}

export function deliverReminder(event: ReminderEvent, notify: (title: string, options: NotificationOptions) => void): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try { notify('Moonie reminder', { body: `${event.title} is ready for your attention.`, tag: event.occurrence }); return true; } catch { return false; }
}
