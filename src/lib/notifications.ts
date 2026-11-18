import { QUOTES, type QuoteItem } from '../data/quotes';
import type { JournalSettings, SessionAlarm } from '../types/journal';
import { isoDate } from './calculations';

declare global {
  interface Window {
    AndroidAlarm?: {
      scheduleAlarms?: (json: string) => void;
      requestPermissions?: () => void;
    };
  }
}

export function hasAndroidNativeAlarms(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      window.AndroidAlarm &&
      typeof window.AndroidAlarm.scheduleAlarms === 'function'
  );
}

export function syncNativeAlarms(alarms: SessionAlarm[]): boolean {
  try {
    if (hasAndroidNativeAlarms() && window.AndroidAlarm?.scheduleAlarms) {
      window.AndroidAlarm.scheduleAlarms(JSON.stringify(alarms));
      return true;
    }
  } catch {
    // Ignore native bridge failures on web
  }
  return false;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestAppNotifications(alarms: SessionAlarm[]): Promise<{
  status: 'granted' | 'denied' | 'unsupported' | 'android-native';
  message: string;
}> {
  if (window.AndroidAlarm?.requestPermissions) {
    try {
      window.AndroidAlarm.requestPermissions();
      syncNativeAlarms(alarms);
      return {
        status: 'android-native',
        message: 'Android permission prompt opened. Allow Notifications and Alarms & reminders.',
      };
    } catch {
      // Fallback to web notifications
    }
  }

  if (!('Notification' in window)) {
    return {
      status: 'unsupported',
      message: 'This browser does not support local web notifications.',
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await sendLocalNotification(
        'MSL Trading Journal',
        'Local session and quote notifications are active.',
        'msl-setup'
      );
      return {
        status: 'granted',
        message: 'Notifications enabled on this device.',
      };
    }
    return {
      status: 'denied',
      message: 'Notification permission was not granted. Check browser site settings.',
    };
  } catch {
    return {
      status: 'denied',
      message: 'Could not request notification permission.',
    };
  }
}

let cachedSwReg: ServiceWorkerRegistration | null | undefined;

export async function sendLocalNotification(
  title: string,
  body: string,
  tag: string
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    if ('serviceWorker' in navigator) {
      if (cachedSwReg === undefined) {
        cachedSwReg = (await navigator.serviceWorker.getRegistration()) || null;
      }
      if (cachedSwReg && typeof cachedSwReg.showNotification === 'function') {
        await cachedSwReg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
        });
        return true;
      }
    }
  } catch {
    cachedSwReg = null;
  }

  try {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag,
    });
    return true;
  } catch {
    return false;
  }
}

export interface AlarmTickResult {
  triggeredKey: string | null;
  toastMessage?: string;
  quote?: QuoteItem;
}

export async function evaluateAlarmsAndQuotes(
  alarms: SessionAlarm[],
  settings: JournalSettings,
  lastKey: string
): Promise<AlarmTickResult> {
  const hasEnabledAlarm = alarms.some((a) => a.enabled);
  const canQuoteNotify =
    settings.quoteNotifications &&
    settings.quoteFrequency > 0 &&
    getNotificationPermission() === 'granted';

  if (!hasEnabledAlarm && !canQuoteNotify) {
    return { triggeredKey: null };
  }

  const now = new Date();
  const day = isoDate(now);
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (hasEnabledAlarm) {
    for (const alarm of alarms) {
      if (!alarm.enabled || alarm.time !== hm) continue;
      const key = `alarm:${day}:${alarm.id}:${alarm.time}`;
      if (lastKey === key) continue;

      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      await sendLocalNotification(
        `${alarm.name} reminder`,
        `${quote.text} — ${quote.source}`,
        key
      );

      return {
        triggeredKey: key,
        toastMessage: `${alarm.name} reminder`,
        quote: settings.quoteNotifications ? quote : undefined,
      };
    }
  }

  if (canQuoteNotify) {
    const minute = Math.floor(now.getTime() / 60000);
    if (minute % settings.quoteFrequency === 0 && now.getSeconds() < 15) {
      const key = `quote:${day}:${minute}`;
      if (lastKey !== key) {
        const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
        await sendLocalNotification(
          'A moment to reset',
          `${quote.text} — ${quote.source}`,
          key
        );
        return {
          triggeredKey: key,
          quote,
        };
      }
    }
  }

  return { triggeredKey: null };
}
