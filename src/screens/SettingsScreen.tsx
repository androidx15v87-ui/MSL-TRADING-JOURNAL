import React, { useEffect, useState } from 'react';
import {
  Bell,
  Cloud,
  CloudOff,
  Download,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Palette,
  RefreshCw,
  Save,
  ScanFace,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { ConfirmModal } from '../components/ConfirmModal';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { useFirebase } from '../context/FirebaseContext';
import {
  type BiometricModality,
  type BiometricSupportStatus,
  checkBiometricSupport,
  enrollBiometric,
  getAutoLockRemainingMs,
  getAutoLockTimeoutMinutes,
  getEnrolledBiometrics,
  hasAppPin,
  isAppLockEnabled,
  isValidPinFormat,
  recordUserActivity,
  removeBiometric,
  saveAppPin,
  setAppLockEnabled,
  setAutoLockTimeoutMinutes,
  setBiometricAutoPrompt,
  verifyBiometric,
} from '../lib/appLock';
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
  GlassTheme,
  JournalSettings,
  JournalState,
  MetricUnit,
  SessionAlarm,
  UserProfile,
} from '../types/journal';

const GLASS_THEME_OPTIONS: {
  id: GlassTheme;
  label: string;
  swatchClass: string;
}[] = [
  {
    id: 'midnight-glass',
    label: 'Midnight Glass',
    swatchClass: 'from-[#0f1d38] via-[#27467a] to-[#47dca0]',
  },
  {
    id: 'frost-blue',
    label: 'Frost Blue',
    swatchClass: 'from-[#163a70] via-[#4ea8ff] to-[#ccebff]',
  },
  {
    id: 'obsidian-gold',
    label: 'Obsidian Gold',
    swatchClass: 'from-[#161218] via-[#b88936] to-[#f7dc94]',
  },
];

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
  onLockApp: () => void;
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
  onLockApp,
  onToast,
}) => {
  const { user, authBusy, cloudStatus, isSyncing, cloudError } = useFirebase();
  const [alarmDraft, setAlarmDraft] = useState<SessionAlarm[]>(alarms);
  const [quoteFreq, setQuoteFreq] = useState<number>(settings.quoteFrequency);
  const [quoteNotifs, setQuoteNotifs] = useState<boolean>(settings.quoteNotifications);
  const [defaultPnlUnit, setDefaultPnlUnit] = useState<MetricUnit>(settings.defaultPnlUnit || 'r');
  const [defaultRiskUnit, setDefaultRiskUnit] = useState<MetricUnit>(settings.defaultRiskUnit || 'r');
  const [currencySymbol, setCurrencySymbol] = useState<string>(settings.currency || 'R');
  const [glassTheme, setGlassTheme] = useState<GlassTheme>(settings.glassTheme || 'midnight-glass');

  const [displayName, setDisplayName] = useState(profile.name);
  const [defaultMarket, setDefaultMarket] = useState(profile.market);

  const [pinLockActive, setPinLockActive] = useState<boolean>(() => isAppLockEnabled());
  const [pinExists, setPinExists] = useState<boolean>(() => hasAppPin());
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => getAutoLockTimeoutMinutes());
  const [remainingLockMs, setRemainingLockMs] = useState<number>(() => getAutoLockRemainingMs());
  const [newPinInput, setNewPinInput] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const [biometrics, setBiometrics] = useState(() => getEnrolledBiometrics());
  const [bioSupport, setBioSupport] = useState<BiometricSupportStatus | null>(null);
  const [bioBusy, setBioBusy] = useState<BiometricModality | null>(null);

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
    setDefaultPnlUnit(settings.defaultPnlUnit || 'r');
    setDefaultRiskUnit(settings.defaultRiskUnit || 'r');
    setCurrencySymbol(settings.currency || 'R');
    setGlassTheme(settings.glassTheme || 'midnight-glass');
  }, [settings]);

  useEffect(() => {
    setDisplayName(profile.name);
    setDefaultMarket(profile.market);
  }, [profile]);

  useEffect(() => {
    checkPersistentStorage().then(setStorageState);
    checkBiometricSupport().then(setBioSupport);
  }, []);

  useEffect(() => {
    setRemainingLockMs(getAutoLockRemainingMs());
    if (!pinLockActive || !pinExists || autoLockMinutes <= 0) return;
    const timer = window.setInterval(() => {
      setRemainingLockMs(getAutoLockRemainingMs());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pinLockActive, pinExists, autoLockMinutes]);

  const nativeAndroid = hasAndroidNativeAlarms();

  const handleSelectTheme = async (nextTheme: GlassTheme) => {
    setGlassTheme(nextTheme);
    document.documentElement.dataset.glassTheme = nextTheme;
    try {
      localStorage.setItem('msl_v10_glass_theme', nextTheme);
    } catch {
      // Ignore storage failures
    }
    const nextSettings: JournalSettings = {
      quoteFrequency: quoteFreq,
      quoteNotifications: quoteNotifs,
      defaultPnlUnit,
      defaultRiskUnit,
      currency: currencySymbol.trim() || 'R',
      glassTheme: nextTheme,
    };
    await onSaveAlarmsAndSettings(alarmDraft, nextSettings);
    const chosen = GLASS_THEME_OPTIONS.find((t) => t.id === nextTheme)?.label || 'Midnight Glass';
    onToast(`Theme switched to ${chosen}.`);
  };

  const handleSaveAlarms = async () => {
    const nextSettings: JournalSettings = {
      quoteFrequency: quoteFreq,
      quoteNotifications: quoteNotifs,
      defaultPnlUnit,
      defaultRiskUnit,
      currency: currencySymbol.trim() || 'R',
      glassTheme,
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
    const cleanCurr = currencySymbol.trim().slice(0, 8) || 'R';
    await onSaveProfile({
      name: displayName.trim(),
      market: defaultMarket.trim(),
    });
    await onSaveAlarmsAndSettings(alarmDraft, {
      quoteFrequency: quoteFreq,
      quoteNotifications: quoteNotifs,
      defaultPnlUnit,
      defaultRiskUnit,
      currency: cleanCurr,
      glassTheme,
    });
  };

  const handleTogglePinLock = () => {
    const next = !pinLockActive;
    setAppLockEnabled(next);
    setPinLockActive(next);
    if (next) {
      recordUserActivity(true);
      setRemainingLockMs(getAutoLockRemainingMs());
    }
    onToast(
      next
        ? '4-digit PIN lock enabled after startup animation.'
        : '4-digit PIN lock paused.'
    );
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newPinInput.replace(/\D/g, '').slice(0, 4);
    if (!isValidPinFormat(cleaned)) {
      onToast('Enter a valid 4-digit PIN (0–9).');
      return;
    }
    setSavingPin(true);
    try {
      await saveAppPin(cleaned);
      recordUserActivity(true);
      setPinExists(true);
      setPinLockActive(true);
      setRemainingLockMs(getAutoLockRemainingMs());
      setNewPinInput('');
      onToast('4-digit app PIN updated.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update PIN.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleEnrollBiometric = async (modality: BiometricModality) => {
    if (bioBusy) return;
    setBioBusy(modality);
    try {
      const res = await enrollBiometric(
        modality,
        (profile.name || user?.displayName || '').trim()
      );
      setBiometrics(getEnrolledBiometrics());
      onToast(res.message);
    } finally {
      setBioBusy(null);
    }
  };

  const handleTestBiometric = async (modality: BiometricModality) => {
    if (bioBusy) return;
    setBioBusy(modality);
    try {
      const res = await verifyBiometric(modality);
      const label = modality === 'faceId' ? 'Face ID' : 'Fingerprint';
      onToast(res.ok ? `${label} verified successfully.` : res.message || `${label} check failed.`);
    } finally {
      setBioBusy(null);
    }
  };

  const handleRemoveBiometric = (modality: BiometricModality) => {
    removeBiometric(modality);
    setBiometrics(getEnrolledBiometrics());
    onToast(`${modality === 'faceId' ? 'Face ID' : 'Fingerprint'} removed from this device.`);
  };

  const handleToggleBioAutoPrompt = () => {
    const next = !biometrics.autoPrompt;
    setBiometricAutoPrompt(next);
    setBiometrics(getEnrolledBiometrics());
    onToast(
      next
        ? 'Biometrics will automatically prompt on the lock screen.'
        : 'Biometric auto-prompt paused — tap Fingerprint or Face ID when needed.'
    );
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
        <p className="text-xs font-medium text-[#8df0c0]">
          Workspace controls
        </p>
        <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">Settings</h2>
        <p className="mt-1 text-sm text-[#8b9ab0]">
          Manage your 4-digit PIN lock, cloud sync, session alarms, discipline reminders, and backups.
        </p>
      </div>

      {/* Compact Glassmorphism Theme Switcher */}
      <article className="rounded-2xl glass-card px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl glass-subcard flex items-center justify-center shrink-0 text-[#8df0c0]">
            <Palette className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[#eef3fb]">Theme</h3>
            <p className="text-xs text-[#8b9ab0] truncate">
              Glassmorphism surface tone across cards &amp; overlays
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Glassmorphism theme"
          className="inline-flex flex-wrap items-center gap-1.5 rounded-xl glass-subcard p-1 shrink-0"
        >
          {GLASS_THEME_OPTIONS.map((option) => {
            const active = glassTheme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => void handleSelectTheme(option.id)}
                className={`min-h-[36px] inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white/[0.12] border border-white/25 text-[#eef3fb] shadow-sm'
                    : 'border border-transparent text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.04]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-3 w-3 rounded-full bg-gradient-to-br ${option.swatchClass} ring-1 ring-white/25 shrink-0`}
                />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </article>

      {/* Cloud Account & Firestore Sync */}
      <article className="rounded-2xl glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">
              Account &amp; Cloud Database
            </p>
            <h3 className="text-base font-bold text-[#eef3fb]">
              {user ? 'Cloud Firestore sync active' : 'Connect Google Account & Cloud Database'}
            </h3>
          </div>
          {user ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#47dca0]/15 border border-[#47dca0]/35 px-2.5 py-1 text-xs font-semibold text-[#8df0c0]">
              {isSyncing || cloudStatus === 'connecting' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
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
              <p className="text-xs font-medium text-[#8df0c0]">
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
                ? 'Android native alarm engine active. Alerts silence & auto-snooze while logging a trade.'
                : `Browser permission: ${notifPerm}. Alerts silence & auto-snooze while logging a trade.`}
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
                    defaultPnlUnit,
                    defaultRiskUnit,
                    currency: currencySymbol.trim() || 'R',
                    glassTheme,
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
                    defaultPnlUnit,
                    defaultRiskUnit,
                    currency: currencySymbol.trim() || 'R',
                    glassTheme,
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

        {/* Security & App Lock + Backup, Privacy & Preferences */}
        <article className="rounded-2xl glass-card p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                App security &amp; data control
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">PIN Lock, Biometrics &amp; Privacy</h3>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#47dca0]" />
          </div>

          {/* 4-Digit PIN & Biometrics Authentication Controls */}
          <div className="rounded-xl glass-subcard p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#eef3fb]">4-Digit PIN App Lock</p>
                <p className="text-xs text-[#8b9ab0]">
                  Show full-screen lock vault after entry animation
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pinLockActive}
                aria-label="Toggle 4-digit PIN app lock"
                onClick={handleTogglePinLock}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                  pinLockActive
                    ? 'bg-[#47dca0] border-[#47dca0]'
                    : 'bg-[#131d31] border-[#263754]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-[#080d18] transition-transform ${
                    pinLockActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <form onSubmit={handleUpdatePin} className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder={pinExists ? 'New 4-digit PIN' : 'Set 4-digit PIN'}
                aria-label="4-digit PIN"
                className="flex-1 min-w-[140px] min-h-[42px] rounded-xl glass-input px-3 py-2 text-sm font-mono tabular-nums tracking-[0.35em] text-[#eef3fb] placeholder:tracking-normal focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingPin || newPinInput.length !== 4}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#47dca0] px-4 py-2 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-45 transition whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{pinExists ? 'Update PIN' : 'Save PIN'}</span>
              </button>
              <button
                type="button"
                onClick={onLockApp}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-[#8df0c0]" />
                <span>Lock now</span>
              </button>
            </form>

            {pinLockActive && pinExists && (
              <div className="space-y-3 pt-2 border-t border-white/[0.08]">
                {/* Subtle Security Active live inactivity indicator */}
                <div
                  className="rounded-xl border border-white/[0.08] bg-[#0a1222]/80 px-3.5 py-2.5 space-y-2"
                  aria-live="off"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldCheck className="w-4 h-4 text-[#47dca0] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#eef3fb]">Security Active</p>
                        <p className="text-[11px] text-[#7c8ca6] truncate">
                          {autoLockMinutes > 0
                            ? 'Time remaining before auto-lock'
                            : 'Vault armed for launch & manual lock'}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold tabular-nums text-[#8df0c0] shrink-0 whitespace-nowrap">
                      {autoLockMinutes > 0
                        ? (() => {
                            const totalSec = Math.ceil(remainingLockMs / 1000);
                            const mins = Math.floor(totalSec / 60);
                            const secs = totalSec % 60;
                            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                          })()
                        : 'Launch only'}
                    </span>
                  </div>
                  {autoLockMinutes > 0 && (
                    <div className="h-[2px] w-full rounded-full bg-white/[0.07] overflow-hidden">
                      <div
                        className="h-full w-full origin-left bg-gradient-to-r from-[#47dca0] to-[#8ebeff] transition-transform duration-500 ease-out"
                        style={{
                          transform: `scaleX(${Math.max(
                            0,
                            Math.min(1, remainingLockMs / (autoLockMinutes * 60_000))
                          )})`,
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#c9d4e7]">Auto-lock on inactivity</p>
                    <p className="text-[11px] text-[#7c8ca6]">
                      Re-locks vault automatically after idle time or switching away
                    </p>
                  </div>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => {
                      const mins = Number(e.target.value);
                      setAutoLockMinutes(mins);
                      setAutoLockTimeoutMinutes(mins);
                      setRemainingLockMs(getAutoLockRemainingMs());
                      onToast(
                        mins === 0
                          ? 'Inactivity auto-lock set to launch only.'
                          : `Auto-lock set to ${mins} min${mins === 1 ? '' : 's'} of inactivity.`
                      );
                    }}
                    aria-label="Auto-lock on inactivity"
                    className="min-h-[38px] rounded-lg glass-input px-2.5 text-xs font-medium text-[#eef3fb] focus:outline-none shrink-0 whitespace-nowrap"
                  >
                    <option value={1}>After 1 min</option>
                    <option value={5}>After 5 mins</option>
                    <option value={15}>After 15 mins</option>
                    <option value={0}>Launch only</option>
                  </select>
                </div>
              </div>
            )}

            {/* Fingerprint & Face ID Enrollment */}
            <div className="pt-3.5 border-t border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-[#eef3fb]">
                    Biometrics (Fingerprint &amp; Face ID)
                  </p>
                  <p className="text-[11px] text-[#7c8ca6]">
                    Hardware WebAuthn credentials bound to this device
                  </p>
                </div>
                {biometrics.hasAny && (
                  <button
                    type="button"
                    onClick={handleToggleBioAutoPrompt}
                    className={`min-h-[30px] rounded-lg px-2.5 text-[11px] font-semibold border transition ${
                      biometrics.autoPrompt
                        ? 'bg-[#47dca0]/15 border-[#47dca0]/40 text-[#8df0c0]'
                        : 'bg-[#111c2d] border-[#23344f] text-[#8b9ab0]'
                    }`}
                  >
                    {biometrics.autoPrompt ? 'Auto-prompt on' : 'Auto-prompt off'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Fingerprint Card */}
                <div className="rounded-xl border border-white/[0.08] bg-[#0a1222]/85 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-[#8df0c0]" />
                      <span className="text-xs font-bold text-[#eef3fb]">Fingerprint</span>
                    </div>
                    <span
                      className={`text-[11px] font-semibold ${
                        biometrics.fingerprint ? 'text-[#47dca0]' : 'text-[#7c8ca6]'
                      }`}
                    >
                      {biometrics.fingerprint ? 'Enrolled' : 'Not set'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {biometrics.fingerprint ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleTestBiometric('fingerprint')}
                          disabled={Boolean(bioBusy)}
                          className="flex-1 min-h-[34px] rounded-lg bg-[#111c2d] border border-[#23344f] px-2.5 text-[11px] font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
                        >
                          {bioBusy === 'fingerprint' ? 'Checking…' : 'Test'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveBiometric('fingerprint')}
                          disabled={Boolean(bioBusy)}
                          className="min-h-[34px] rounded-lg border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-2.5 text-[11px] font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/20 transition"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleEnrollBiometric('fingerprint')}
                        disabled={Boolean(bioBusy)}
                        className="w-full min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#47dca0]/15 border border-[#47dca0]/40 px-3 text-xs font-bold text-[#8df0c0] hover:bg-[#47dca0]/25 disabled:opacity-50 transition"
                      >
                        {bioBusy === 'fingerprint' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Fingerprint className="w-3.5 h-3.5" />
                        )}
                        <span>Enroll Fingerprint</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Face ID Card */}
                <div className="rounded-xl border border-white/[0.08] bg-[#0a1222]/85 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ScanFace className="w-4 h-4 text-[#8ebeff]" />
                      <span className="text-xs font-bold text-[#eef3fb]">Face ID</span>
                    </div>
                    <span
                      className={`text-[11px] font-semibold ${
                        biometrics.faceId ? 'text-[#8ebeff]' : 'text-[#7c8ca6]'
                      }`}
                    >
                      {biometrics.faceId ? 'Enrolled' : 'Not set'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {biometrics.faceId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleTestBiometric('faceId')}
                          disabled={Boolean(bioBusy)}
                          className="flex-1 min-h-[34px] rounded-lg bg-[#111c2d] border border-[#23344f] px-2.5 text-[11px] font-semibold text-[#eef3fb] hover:border-[#8ebeff]/45 transition"
                        >
                          {bioBusy === 'faceId' ? 'Checking…' : 'Test'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveBiometric('faceId')}
                          disabled={Boolean(bioBusy)}
                          className="min-h-[34px] rounded-lg border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-2.5 text-[11px] font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/20 transition"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleEnrollBiometric('faceId')}
                        disabled={Boolean(bioBusy)}
                        className="w-full min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#8ebeff]/15 border border-[#8ebeff]/40 px-3 text-xs font-bold text-[#eef3fb] hover:bg-[#8ebeff]/25 disabled:opacity-50 transition"
                      >
                        {bioBusy === 'faceId' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ScanFace className="w-3.5 h-3.5" />
                        )}
                        <span>Enroll Face ID</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {bioSupport?.reason && (
                <p className="text-[11px] text-[#7c8ca6] leading-relaxed">
                  {bioSupport.reason}
                </p>
              )}
            </div>
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
            <h4 className="text-sm font-bold text-[#eef3fb]">Preferences &amp; Default Units</h4>
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

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Default P&amp;L unit</span>
                <select
                  value={defaultPnlUnit}
                  onChange={(e) => setDefaultPnlUnit(e.target.value as MetricUnit)}
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                >
                  <option value="r">R-Multiple (Ratio)</option>
                  <option value="percent">Percentage (%)</option>
                  <option value="money">
                    Money ({currencySymbol && currencySymbol.toUpperCase() !== 'R' ? currencySymbol : '$'})
                  </option>
                  <option value="value">Value / Points</option>
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Default risk unit</span>
                <select
                  value={defaultRiskUnit}
                  onChange={(e) => setDefaultRiskUnit(e.target.value as MetricUnit)}
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                >
                  <option value="r">R-Multiple (Ratio)</option>
                  <option value="percent">Percentage (%)</option>
                  <option value="money">
                    Money ({currencySymbol && currencySymbol.toUpperCase() !== 'R' ? currencySymbol : '$'})
                  </option>
                  <option value="value">Value / Points</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl glass-subcard px-3.5 py-2.5">
              <div>
                <span className="text-xs font-medium text-[#a9b7cc]">Preferred currency</span>
                <p className="text-[11px] text-[#7c8ca6]">Default is R (Risk / Reward)</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {['R', '$', '€', '£', '¥', '₦'].map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setCurrencySymbol(sym)}
                    className={`min-h-[32px] min-w-[34px] rounded-lg border px-2.5 text-xs font-bold transition ${
                      currencySymbol.toUpperCase() === sym.toUpperCase()
                        ? 'bg-[#47dca0]/18 border-[#47dca0]/55 text-[#8df0c0]'
                        : 'bg-[#080d18]/80 border-white/[0.08] text-[#8b9ab0] hover:text-[#eef3fb]'
                    }`}
                  >
                    {sym === 'R' ? 'Default (R)' : sym}
                  </button>
                ))}
                <input
                  type="text"
                  maxLength={8}
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value.slice(0, 8))}
                  aria-label="Preferred currency symbol"
                  className="w-16 min-h-[32px] rounded-lg glass-input px-2 text-center text-xs font-mono text-[#eef3fb]"
                />
              </div>
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

      {/* App Version & Developer Attribution */}
      <article className="rounded-2xl liquid-glass px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-bold text-[#eef3fb]">MSL Trading Journal</p>
          <p className="text-xs text-[#8b9ab0]">
            Private, local-first &amp; cloud-synced workspace · Read the market. Respect the plan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums shrink-0">
          <span className="font-semibold text-[#8df0c0]">Version 11</span>
          <span aria-hidden="true" className="text-[#56647c]">·</span>
          <span className="font-semibold text-[#eef3fb]">Developed by ANDROID</span>
        </div>
      </article>

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
