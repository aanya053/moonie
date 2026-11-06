import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { isTauriEnvironment } from './tauriWindow';

export type NotificationPermission = 'granted' | 'denied' | 'unsupported';

export async function getDesktopNotificationPermission(): Promise<NotificationPermission> {
  try {
    if (isTauriEnvironment()) return (await isPermissionGranted()) ? 'granted' : 'denied';
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'unsupported';
  } catch { return 'unsupported'; }
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission> {
  try {
    if (isTauriEnvironment()) return (await requestPermission()) === 'granted' ? 'granted' : 'denied';
    if (typeof Notification === 'undefined') return 'unsupported';
    const permission = await Notification.requestPermission();
    return permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'unsupported';
  } catch { return 'unsupported'; }
}

export async function sendDesktopNotification(title: string, body: string, tag?: string): Promise<boolean> {
  try {
    if (isTauriEnvironment()) { await sendNotification({ title, body }); return true; }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    new Notification(title, { body, tag });
    return true;
  } catch { return false; }
}
