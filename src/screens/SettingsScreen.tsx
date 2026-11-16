import React, { useEffect, useState } from 'react';
import {
  Bell,
  Cloud,
  CloudOff,
  Download,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { ConfirmModal } from '../components/ConfirmModal';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { useFirebase } from '../context/FirebaseContext';
import {
  checkPersistentStorage,
  parseBackupFile,
  requestPersistentStorage,
} from '../lib/db';
import {
  getNotificationPermission,
  hasAndroidNativeAlarms,
  requestAppNotifications,
  sendLocalNotification,
  syncNativeAlarms,
} from '../lib/notifications';
import type {
  JournalSettings,
  JournalState,
  SessionAlarm,
  UserProfile,
} from '../types/journal';

interface SettingsScreenProps {
  alarms: SessionAlarm[];
  settings: JournalSettings;
  profile: UserProfile;
  onSaveAlarmsAndSettings: (alarms: SessionAlarm[], settings: JournalSettings) => Promise<void> | void;
  onSaveProfile: (profile: UserProfile) => Promise<void> | void;
  onDownloadBackup: () => void;
  onRestoreBackup: (restored: JournalState) => Promise<void> | void;
  onClearAllData: () => Promise<void> | void;
  onSignIn: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
  onForceSyncToCloud: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  alarms,
  settings,
  profile,
  onSaveAlarmsAndSettings,
  onSaveProfile,
  onDownloadBackup,
  onRestoreBackup,
  onClearAllData,
  onSignIn,
  onSignOut,
  onForceSyncToCloud,
  onToast,
}) => {
  const { user, authBusy, cloudStatus, cloudError } = useFirebase();
  const [alarmDraft, setAlarmDraft] = useState<SessionAlarm[]>(alarms);
  const [quoteFreq, setQuoteFreq] = useState<number>(settings.quoteFrequency);
  const [quoteNotifs, setQuoteNotifs] = useState<boolean>(settings.quoteNotifications);

  const [displayName, setDisplayName] = useState(profile.name);
  const [defaultMarket, setDefaultMarket] = useState(profile.market);

  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission()
  );
  const [storageState, setStorageState] = useState<{ supported: boolean; persisted: boolean }>({
    supported: true,
    persisted: false,
  });
  const [syncingNow, setSyncingNow] = useState(false);

  const [pendingRestore, setPendingRestore] = useState<JournalState | null>(null);
  const [clearStep, setClearStep] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setAlarmDraft(alarms);
  }, [alarms]);

  useEffect(() => {
    setQuoteFreq(settings.quoteFrequency);
    setQuoteNotifs(settings.quoteNotifications);
  }, [settings]);

  useEffect(() => {
    setDisplayName(profile.name);
    setDefaultMarket(profile.market);
  }, [profile]);

  useEffect(() => {
    checkPersistentStorage().then(setStorageState);
  }, []);

  const nativeAndroid = hasAndroidNativeAlarms();

  const handleSaveAlarms = async () => {
    const nextSettings: JournalSettings = {
      quoteFrequency: quoteFreq,
      quoteNotifications: quoteNotifs,
    };
    await onSaveAlarmsAndSettings(alarmDraft, nextSettings);
    const synced = syncNativeAlarms(alarmDraft);
    onToast(
      synced
        ? 'Session times saved and synced to Android native alarms.'
        : 'Session times saved.'
    );
  };

  const handleEnableNotifications = async () => {
    const res = await requestAppNotifications(alarmDraft);
    setNotifPerm(getNotificationPermission());
    onToast(res.message);
  };

  const handleTestNotification = async () => {
    const sent = await sendLocalNotification(
      'MSL Trading Journal',
      'Read the market. Respect the plan.',
      `msl-test-${Date.now()}`
    );
    onToast(
      sent
        ? 'Test notification sent.'
        : 'Enable notifications first to receive local reminders.'
    );
  };

  const handleProtectStorage = async () => {
    const granted = await requestPersistentStorage();
    setStorageState(await checkPersistentStorage());
    onToast(
      granted
        ? 'Persistent local storage protection granted.'
        : 'Browser did not grant persistent flag. Download JSON backups regularly.'
    );
  };

  const handleRestoreInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackupFile(String(reader.result));
        setPendingRestore(parsed);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not read backup file.');
      }
    };
    reader.onerror = () => onToast('Failed to read selected file.');
    reader.readAsText(file);
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    await onRestoreBackup(pendingRestore);
    setPendingRestore(null);
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveProfile({
      name: displayName.trim(),
      market: defaultMarket.trim(),
    });
  };

  const handleForceSync = async () => {
    setSyncingNow(true);
    try {
      await onForceSyncToCloud();
    } finally {
      setSyncingNow(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
          Workspace controls
        </p>
        <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">Settings</h2>
        <p className="mt-1 text-sm text-[#8b9ab0]">
          Connect Google cloud sync, configure local session alarms, discipline reminders, and backups.
        </p>
      </div>

      {/* Cloud Account & Firestore Sync */}
      <article className="rounded-2xl glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
              Account & Cloud Database
            </p>
            <h3 className="text-base font-bold text-[#eef3fb]">
              {user ? 'Cloud Firestore sync active' : 'Connect Google Account & Cloud Database'}
            </h3>
          </div>
          {user ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#47dca0]/15 border border-[#47dca0]/35 px-2.5 py-1 text-xs font-semibold text-[#8df0c0]">
              {cloudStatus === 'connecting' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Syncing…</span>
                </>
              ) : cloudStatus === 'error' ? (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-[#ff7d91]" />
                  <span className="text-[#ff7d91]">Error</span>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Synced</span>
                </>
              )}
            </span>
          ) : (
            <Cloud className="w-5 h-5 text-[#8ebeff]" />
          )}
        </div>

        {cloudError && (
          <div className="rounded-xl border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-3.5 py-2.5 text-xs text-[#ffb4bf]">
            {cloudError}
          </div>
        )}

        {user ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl glass-subcard p-4">
            <div className="flex items-center gap-3 min-w-0">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Google profile'}
                  referrerPolicy="no-referrer"
                  className="h-11 w-11 rounded-xl object-cover border border-white/15 shrink-0"
                />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-[#47dca0]/20 border border-[#47dca0]/35 flex items-center justify-center font-display text-sm font-bold text-[#8df0c0] shrink-0">
                  {(user.displayName || user.email || 'T').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#eef3fb] truncate">
                  {user.displayName || 'Verified Trader'}
                </p>
                <p className="text-xs text-[#8b9ab0] truncate">{user.email}</p>
                <p className="mt-0.5 text-[11px] text-[#8df0c0]">
                  Private Cloud Firestore vault · Real-time multi-device sync
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleForceSync}
                disabled={syncingNow || authBusy}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#8df0c0] ${syncingNow ? 'animate-spin' : ''}`} />
                <span>{syncingNow ? 'Uploading…' : 'Push local to cloud'}</span>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                disabled={authBusy}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-3.5 py-2 text-xs font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/20 disabled:opacity-50 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl glass-subcard p-4">
            <div className="space-y-1">
              <p className="text-sm font-bold text-[#eef3fb]">
                Sync your journal privately across devices
              </p>
              <p className="text-xs text-[#8b9ab0] leading-relaxed">
                Currently running offline-first on this device. Sign in with Google to back up and sync all trades, chart screenshots, models, custom properties, playbook, and alarms to your private Cloud Firestore database.
              </p>
            </div>
            <button
              type="button"
              onClick={onSignIn}
              disabled={authBusy}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2.5 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition shrink-0 whitespace-nowrap"
            >
              <LogIn className="w-4 h-4" />
              <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
            </button>
          </div>
        )}
      </article>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Session Alarms & Quote Reminders */}
        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
                Local alerts
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Session alarms</h3>
            </div>
            <Bell className="w-5 h-5 text-[#47dca0]" />
          </div>

          <div className="space-y-2.5">
            {alarmDraft.map((alarm, idx) => (
              <div
                key={alarm.id}
                className="flex items-center justify-between gap-3 rounded-xl glass-subcard px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#eef3fb]">{alarm.name}</p>
                  <p className="text-[11px] text-[#7c8ca6]">Device local timezone</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <input
                    type="time"
                    value={alarm.time}
                    aria-label={`${alarm.name} time`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAlarmDraft((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, time: val } : item))
                      );
                    }}
                    className="min-h-[40px] rounded-lg bg-[#0d1423] border border-[#24344d] px-2.5 py-1 text-sm font-mono tabular-nums text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                  />

                  <button
                    type="button"
                    role="switch"
                    aria-checked={alarm.enabled}
                    aria-label={`Toggle ${alarm.name}`}
                    onClick={() =>
                      setAlarmDraft((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, enabled: !item.enabled } : item
                        )
                      )
                    }
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                      alarm.enabled
                        ? 'bg-[#47dca0] border-[#47dca0]'
                        : 'bg-[#131d31] border-[#263754]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-[#080d18] transition-transform ${
                        alarm.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleSaveAlarms}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-4 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition"
            >
              <Save className="w-4 h-4" />
              <span>Save session times</span>
            </button>
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <span>Enable notifications</span>
            </button>
          </div>

          <div className="rounded-xl glass-subcard px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-[#8b9ab0]">
            <span>
              {nativeAndroid
                ? 'Android native alarm engine active.'
                : `Browser permission: ${notifPerm}. Keep app open or installed for PWA reminders.`}
            </span>
            {notifPerm === 'granted' && (
              <button
                type="button"
                onClick={handleTestNotification}
                className="font-semibold text-[#8df0c0] hover:underline shrink-0"
              >
                Test
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-white/[0.08] space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Quote reminder frequency</span>
              <select
                value={quoteFreq}
                onChange={async (e) => {
                  const val = Number(e.target.value);
                  setQuoteFreq(val);
                  await onSaveAlarmsAndSettings(alarmDraft, {
                    quoteFrequency: val,
                    quoteNotifications: quoteNotifs,
                  });
                }}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
              >
                <option value={30}>Every 30 minutes while open</option>
                <option value={60}>Every 1 hour while open</option>
                <option value={120}>Every 2 hours while open</option>
                <option value={240}>Every 4 hours while open</option>
                <option value={0}>Only at session alarms</option>
              </select>
            </label>

            <div className="flex items-center justify-between gap-3 rounded-xl glass-subcard px-3.5 py-3">
              <div>
                <p className="text-sm font-semibold text-[#eef3fb]">
                  Motivational quote notifications
                </p>
                <p className="text-xs text-[#7c8ca6]">
                  Verses, life and trading discipline reminders
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={quoteNotifs}
                aria-label="Toggle motivational quote notifications"
                onClick={async () => {
                  const next = !quoteNotifs;
                  setQuoteNotifs(next);
                  await onSaveAlarmsAndSettings(alarmDraft, {
                    quoteFrequency: quoteFreq,
                    quoteNotifications: next,
                  });
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                  quoteNotifs
                    ? 'bg-[#47dca0] border-[#47dca0]'
                    : 'bg-[#131d31] border-[#263754]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-[#080d18] transition-transform ${
                    quoteNotifs ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </article>

        {/* Backup, Privacy, Preferences & Danger Zone */}
        <article className="rounded-2xl glass-card p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
                Data control
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Backup & privacy</h3>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#47dca0]" />
          </div>

          <div className="rounded-xl glass-subcard p-3.5 space-y-1">
            <p className="text-sm font-bold text-[#eef3fb]">Local-first + Private Cloud Vault</p>
            <p className="text-xs leading-relaxed text-[#8b9ab0]">
              All trades, chart screenshots, models, custom properties, and playbook notes live offline-first in IndexedDB on this device, and sync privately to your personal Cloud Firestore workspace whenever you sign in with Google.
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onDownloadBackup}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <Download className="w-4 h-4 text-[#8df0c0]" />
              <span>Download full backup</span>
            </button>

            <label className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 cursor-pointer transition">
              <Upload className="w-4 h-4 text-[#8ebeff]" />
              <span>Restore from backup</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreInput}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={handleProtectStorage}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <Lock className="w-4 h-4 text-[#47dca0]" />
              <span>
                {storageState.persisted
                  ? 'Local storage protected'
                  : 'Protect local storage'}
              </span>
            </button>

            <PWAInstallButton variant="full" />
          </div>

          {/* Preferences */}
          <form onSubmit={handleSavePreferences} className="pt-4 border-t border-white/[0.08] space-y-3.5">
            <h4 className="text-sm font-bold text-[#eef3fb]">Preferences</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Display name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Trader"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Default market</span>
                <input
                  type="text"
                  value={defaultMarket}
                  onChange={(e) => setDefaultMarket(e.target.value)}
                  placeholder="Forex / Crypto / Metals"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>
            </div>
            <button
              type="submit"
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition"
            >
              <Save className="w-4 h-4" />
              <span>Save preferences</span>
            </button>
          </form>

          {/* Danger Zone */}
          <div className="pt-4 border-t border-white/[0.08] space-y-2">
            <button
              type="button"
              onClick={() => setClearStep(1)}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-4 py-2 text-sm font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/20 transition"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear all journal data</span>
            </button>
            <p className="text-[11px] text-[#7c8ca6]">
              Clearing data is permanent. Download a JSON backup first if you need to keep your history.
            </p>
          </div>
        </article>
      </div>

      {/* Restore Confirmation Modal */}
      <ConfirmModal
        open={Boolean(pendingRestore)}
        title="Restore journal backup?"
        description={
          pendingRestore
            ? `This will replace the current data on this device with ${pendingRestore.trades.length} trades, ${pendingRestore.models.length} models, and ${pendingRestore.fields.length} custom properties from the selected backup.`
            : ''
        }
        confirmLabel="Restore backup"
        onConfirm={handleConfirmRestore}
        onCancel={() => setPendingRestore(null)}
      />

      {/* Two-step Clear Data Confirmation Modals */}
      <ConfirmModal
        open={clearStep === 1}
        danger
        title="Clear all journal data?"
        description="This will erase all logged trades, screenshots, models, custom fields, playbook entries, and preferences from this device. Download a backup first if you want to keep your records."
        confirmLabel="Continue"
        onConfirm={() => setClearStep(2)}
        onCancel={() => setClearStep(0)}
      />

      <ConfirmModal
        open={clearStep === 2}
        danger
        title="Final confirmation — permanent deletion"
        description="This action cannot be undone. Are you completely sure you want to permanently clear all local journal data?"
        confirmLabel="Yes, delete everything"
        onConfirm={async () => {
          setClearStep(0);
          await onClearAllData();
        }}
        onCancel={() => setClearStep(0)}
      />
    </div>
  );
};
