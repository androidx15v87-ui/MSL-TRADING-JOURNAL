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

async function resolveSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (cachedSwReg !== undefined) return cachedSwReg;
  try {
    cachedSwReg = (await navigator.serviceWorker.getRegistration()) || null;
  } catch {
    cachedSwReg = null;
  }
  return cachedSwReg;
}

export async function silenceActiveNotifications(): Promise<void> {
  try {
    const reg = await resolveSwRegistration();
    if (!reg || typeof reg.getNotifications !== 'function') return;
    const active = await reg.getNotifications();
    for (const notif of active) {
      notif.close();
    }
  } catch {
    // Ignore notification cleanup errors
  }
}

export async function sendLocalNotification(
  title: string,
  body: string,
  tag: string
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const reg = await resolveSwRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
      });
      return true;
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

interface SnoozedAlarmEntry {
  alarm: SessionAlarm;
  key: string;
  snoozeUntilMs: number;
}

const snoozedAlarms = new Map<string, SnoozedAlarmEntry>();
const handledAlarmKeys = new Set<string>();

function rememberHandledKey(key: string): void {
  handledAlarmKeys.add(key);
  if (handledAlarmKeys.size > 64) {
    const oldest = handledAlarmKeys.values().next().value;
    if (oldest) handledAlarmKeys.delete(oldest);
  }
}

export function getSnoozedAlarmsCount(): number {
  return snoozedAlarms.size;
}

export interface AlarmTickOptions {
  isLoggingTrade?: boolean;
  snoozeMinutes?: number;
}

export interface AlarmTickResult {
  triggeredKey: string | null;
  toastMessage?: string;
  quote?: QuoteItem;
  snoozedAlarmName?: string;
  snoozedCount?: number;
}

export async function evaluateAlarmsAndQuotes(
  alarms: SessionAlarm[],
  settings: JournalSettings,
  lastKey: string,
  options?: AlarmTickOptions
): Promise<AlarmTickResult> {
  const isLoggingTrade = Boolean(options?.isLoggingTrade);
  const snoozeMs = Math.max(1, options?.snoozeMinutes ?? 5) * 60_000;
  const now = new Date();
  const nowMs = now.getTime();

  // Prune any snoozed alarm that the user later disabled or deleted
  for (const [alarmId] of snoozedAlarms) {
    const current = alarms.find((a) => a.id === alarmId && a.enabled);
    if (!current) {
      snoozedAlarms.delete(alarmId);
    }
  }

  const hasEnabledAlarm = alarms.some((a) => a.enabled);
  const canQuoteNotify =
    settings.quoteNotifications &&
    settings.quoteFrequency > 0 &&
    getNotificationPermission() === 'granted';

  if (!hasEnabledAlarm && !canQuoteNotify && snoozedAlarms.size === 0) {
    return { triggeredKey: null, snoozedCount: 0 };
  }

  const day = isoDate(now);
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // While user is actively logging a trade, silence alerts & auto-snooze due alarms to protect focus
  if (isLoggingTrade) {
    for (const [, entry] of snoozedAlarms) {
      if (entry.snoozeUntilMs <= nowMs) {
        entry.snoozeUntilMs = nowMs + 2 * 60_000;
      }
    }

    if (hasEnabledAlarm) {
      for (const alarm of alarms) {
        if (!alarm.enabled || alarm.time !== hm) continue;
        const key = `alarm:${day}:${alarm.id}:${alarm.time}`;
        if (lastKey === key || handledAlarmKeys.has(key)) continue;

        rememberHandledKey(key);
        snoozedAlarms.set(alarm.id, {
          alarm,
          key,
          snoozeUntilMs: nowMs + snoozeMs,
        });

        return {
          triggeredKey: key,
          snoozedAlarmName: alarm.name,
          snoozedCount: snoozedAlarms.size,
        };
      }
    }

    return { triggeredKey: null, snoozedCount: snoozedAlarms.size };
  }

  // User is back on main workspace: fire any snoozed alarm whose snooze window has elapsed
  for (const [alarmId, entry] of snoozedAlarms) {
    if (nowMs >= entry.snoozeUntilMs) {
      snoozedAlarms.delete(alarmId);
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      const snoozeKey = `${entry.key}:snoozed`;
      await sendLocalNotification(
        `${entry.alarm.name} reminder (snoozed)`,
        `${quote.text} — ${quote.source}`,
        snoozeKey
      );
      return {
        triggeredKey: snoozeKey,
        toastMessage: `${entry.alarm.name} reminder (snoozed during trade entry)`,
        quote: settings.quoteNotifications ? quote : undefined,
        snoozedCount: snoozedAlarms.size,
      };
    }
  }

  if (hasEnabledAlarm) {
    for (const alarm of alarms) {
      if (!alarm.enabled || alarm.time !== hm) continue;
      const key = `alarm:${day}:${alarm.id}:${alarm.time}`;
      if (lastKey === key || handledAlarmKeys.has(key)) continue;

      rememberHandledKey(key);
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
        snoozedCount: snoozedAlarms.size,
      };
    }
  }

  if (canQuoteNotify) {
    const minute = Math.floor(nowMs / 60000);
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
          snoozedCount: snoozedAlarms.size,
        };
      }
    }
  }

  return { triggeredKey: null, snoozedCount: snoozedAlarms.size };
}
