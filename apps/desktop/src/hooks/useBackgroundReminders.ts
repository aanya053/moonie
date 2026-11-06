import { useEffect, useState } from 'react';
import { moonieApi } from '../lib/api';
import { getBackendStatus } from '../lib/backendStatus';
import { sendDesktopNotification, getDesktopNotificationPermission } from '../lib/notifications';
import { ReminderTracker, type ReminderEvent } from '../lib/reminders';
import { loadSettings } from '../lib/settings';

export function useBackgroundReminders(): string | null {
  const [tracker] = useState(() => new ReminderTracker());
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const settings = loadSettings();
      if (!settings.remindersEnabled) return;
      try {
        const backendStatus = await getBackendStatus();
        if (backendStatus?.error || (backendStatus?.managed && !backendStatus.ready)) {
          setNotice(backendStatus.error ?? 'Moonie backend is not ready.');
          return;
        }
        const tasks = await moonieApi.listTasks();
        if (cancelled) return;
        const permission = await getDesktopNotificationPermission();
        if (permission !== 'granted') {
          setNotice(permission === 'denied' ? 'Notifications are disabled. Enable them in Windows settings to receive reminders.' : 'Desktop notifications are unavailable in this environment.');
          return;
        }
        const delivered: ReminderEvent[] = [];
        for (const event of tracker.pending(tasks)) {
          if (await sendDesktopNotification('Moonie reminder', `${event.title} is ready for your attention.`, event.occurrence)) delivered.push(event);
        }
        tracker.markSent(delivered);
        setNotice(null);
      } catch { if (!cancelled) setNotice('Moonie backend is unavailable right now.'); }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 30_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [tracker]);
  return notice;
}
