import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLockScreen } from './components/AppLockScreen';
import { ConfirmModal } from './components/ConfirmModal';
import { EntrySplash } from './components/EntrySplash';
import { JournalModal } from './components/JournalModal';
import { Layout } from './components/Layout';
import { OfflineBanner } from './components/OfflineBanner';
import { TradeDetailModal } from './components/TradeDetailModal';
import { TradeModal } from './components/TradeModal';
import { useFirebase } from './context/FirebaseContext';
import {
  getAutoLockRemainingMs,
  getAutoLockTimeoutMinutes,
  hasAppPin,
  isAppLockEnabled,
  recordUserActivity,
  saveLockAccountName,
} from './lib/appLock';
import { createDefaultState, QUOTES, type QuoteItem } from './data/quotes';
import {
  calculateJournalSummary,
  formatTradePnL,
  formatTradeRisk,
  generateId,
  getAllTradeTags,
  getUnitShortLabel,
  isoDate,
  localDateTime,
  normalizeMetricUnit,
} from './lib/calculations';
import {
  loadAIMemories,
  removeAIMemory,
  saveAIMemories,
  upsertAIMemory,
} from './lib/aiMemory';
import {
  cloudDeleteAIMemory,
  cloudDeleteField,
  cloudDeleteModel,
  cloudDeleteTrade,
  cloudReplaceFullJournal,
  cloudSaveAIMemory,
  cloudSaveAlarmsAndSettings,
  cloudSaveField,
  cloudSaveJournal,
  cloudSaveModel,
  cloudSavePlaybook,
  cloudSaveProfile,
  cloudSaveTrade,
  cloudSoftDeleteJournal,
  ensureCloudWorkspace,
  mergeMissingLocalTradesToCloud,
  subscribeToCloudJournal,
  subscribeToCloudMemories,
} from './lib/cloudSync';
import {
  buildBackupPayload,
  clearAllJournalData,
  deleteTradeRecord,
  loadActiveJournalId,
  loadJournalState,
  loadPlaybookChecks,
  resolveActiveJournalId,
  saveActiveJournalId,
  saveFullJournalState,
  saveJournalRecord,
  saveKV,
  savePlaybookChecks,
  saveTradeRecord,
} from './lib/db';
import { formatCloudErrorMessage } from './lib/firebase';
import {
  evaluateAlarmsAndQuotes,
  silenceActiveNotifications,
  syncNativeAlarms,
} from './lib/notifications';
import { OverviewScreen } from './screens/OverviewScreen';
import type {
  AIAppAction,
  AIAppActionResult,
  AIMemoryCategory,
  AIMemoryItem,
  CustomField,
  Direction,
  GlassTheme,
  JournalSettings,
  JournalState,
  ModelType,
  PageId,
  Playbook,
  SessionAlarm,
  SessionType,
  SetupType,
  Trade,
  TradeOutcome,
  TradingJournal,
  TradingModel,
  UserProfile,
} from './types/journal';

// Lazy-load secondary screens for faster first paint & lighter memory footprint
const JournalsScreen = lazy(() =>
  import('./screens/JournalsScreen').then((m) => ({ default: m.JournalsScreen }))
);
const JournalScreen = lazy(() =>
  import('./screens/JournalScreen').then((m) => ({ default: m.JournalScreen }))
);
const CalendarScreen = lazy(() =>
  import('./screens/CalendarScreen').then((m) => ({ default: m.CalendarScreen }))
);
const ModelsScreen = lazy(() =>
  import('./screens/ModelsScreen').then((m) => ({ default: m.ModelsScreen }))
);
const AnalyticsScreen = lazy(() =>
  import('./screens/AnalyticsScreen').then((m) => ({ default: m.AnalyticsScreen }))
);
const PlaybookScreen = lazy(() =>
  import('./screens/PlaybookScreen').then((m) => ({ default: m.PlaybookScreen }))
);
const AIScreen = lazy(() =>
  import('./screens/AIScreen').then((m) => ({ default: m.AIScreen }))
);
const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
);

const LAST_SYNCED_UID_KEY = 'msl_v10_last_uid';
const VALID_PAGES = new Set<PageId>([
  'dashboard',
  'journals',
  'journal',
  'calendar',
  'models',
  'analytics',
  'playbook',
  'ai',
  'settings',
]);

function randomQuote(exclude?: QuoteItem): QuoteItem {
  if (QUOTES.length <= 1) return QUOTES[0];
  let pick = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  if (exclude && pick.text === exclude.text) {
    pick = QUOTES[(QUOTES.indexOf(pick) + 1) % QUOTES.length];
  }
  return pick;
}

function normalizeDirection(val: unknown): Direction {
  return String(val).toLowerCase() === 'short' ? 'Short' : 'Long';
}

function normalizeSetup(val: unknown): SetupType {
  const lower = String(val || '').toLowerCase();
  if (lower.includes('cont')) return 'Continuation';
  if (lower.includes('break')) return 'Breakout';
  if (lower.includes('other')) return 'Other';
  return 'Reversal';
}

function normalizeSession(val: unknown): SessionType {
  const lower = String(val || '').toLowerCase();
  if (lower.includes('ny') || lower.includes('new york')) return 'New York';
  if (lower.includes('asia') || lower.includes('tokyo')) return 'Asia';
  if (lower.includes('overlap')) return 'Overlap';
  if (lower.includes('other')) return 'Other';
  return 'London';
}

function normalizeOutcome(val: unknown): TradeOutcome {
  const lower = String(val || '').toLowerCase();
  if (lower.includes('miss')) return 'Missed';
  if (lower.startsWith('l')) return 'Loss';
  if (lower === 'be' || lower.includes('break')) return 'BE';
  return 'Win';
}

function normalizeModelType(val: unknown): ModelType {
  const lower = String(val || '').toLowerCase();
  if (lower.includes('cont')) return 'Continuation';
  if (lower.includes('both')) return 'Both';
  return 'Reversal';
}

const ScreenSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-36 rounded-2xl glass-card" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="h-28 rounded-2xl glass-card" />
      <div className="h-28 rounded-2xl glass-card" />
    </div>
  </div>
);

export default function App() {
  const [state, setState] = useState<JournalState>(() => createDefaultState());
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [splashPhase, setSplashPhase] = useState<1 | 2>(1);
  const [isLocked, setIsLocked] = useState<boolean>(() => isAppLockEnabled());
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [aiMounted, setAiMounted] = useState(false);
  const [memories, setMemories] = useState<AIMemoryItem[]>(() => loadAIMemories());
  const [quote, setQuote] = useState<QuoteItem>(() => randomQuote());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<Trade | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState<string | undefined>(undefined);
  const [viewingTrade, setViewingTrade] = useState<Trade | null>(null);
  const [tradeToDelete, setTradeToDelete] = useState<Trade | null>(null);
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [editingJournal, setEditingJournal] = useState<TradingJournal | null>(null);
  const [journalToDelete, setJournalToDelete] = useState<TradingJournal | null>(null);

  const activeJournals = useMemo(
    () => (state.journals || []).filter((j) => !j.isDeleted),
    [state.journals]
  );

  const activeJournal = useMemo(
    () =>
      activeJournals.find((j) => j.id === state.activeJournalId) ||
      activeJournals[0] ||
      null,
    [activeJournals, state.activeJournalId]
  );

  const journalSummaries = useMemo(
    () =>
      activeJournals.map((j) =>
        calculateJournalSummary(j, state.trades, state.settings)
      ),
    [activeJournals, state.trades, state.settings]
  );

  const journalSummaryMap = useMemo(
    () => new Map(journalSummaries.map((s) => [s.journal.id, s])),
    [journalSummaries]
  );

  const scopedTrades = useMemo(
    () =>
      activeJournal
        ? state.trades.filter((t) => t.journalId === activeJournal.id)
        : [],
    [state.trades, activeJournal]
  );

  const scopedAIState = useMemo(
    () => ({
      ...state,
      activeJournalId: activeJournal?.id ?? null,
      trades: scopedTrades,
    }),
    [state, activeJournal?.id, scopedTrades]
  );

  const existingTags = useMemo(
    () => getAllTradeTags(scopedTrades).map((t) => t.tag),
    [scopedTrades]
  );

  const {
    user,
    authReady,
    setCloudStatus,
    setCloudError,
    signInWithGoogle,
    signOutAccount,
  } = useFirebase();

  const [snoozedAlarmLabel, setSnoozedAlarmLabel] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastIsAlertRef = useRef<boolean>(false);
  const lastAlarmKeyRef = useRef<string>('');
  const splashStartRef = useRef<number>(Date.now());
  const cloudPersistTimerRef = useRef<number | null>(null);
  const stateRef = useRef<JournalState>(state);
  stateRef.current = state;
  const memoriesRef = useRef<AIMemoryItem[]>(memories);
  memoriesRef.current = memories;
  const userRef = useRef(user);
  userRef.current = user;
  const mergedForSessionRef = useRef<string | null>(null);
  const previousPageRef = useRef<PageId>('dashboard');

  const handleNavigate = useCallback((nextPage: PageId) => {
    setActivePage((current) => {
      if (nextPage === 'ai' && current !== 'ai') {
        previousPageRef.current = current;
      }
      return nextPage;
    });
  }, []);

  const showToast = useCallback((msg: string, isAlert = false) => {
    toastIsAlertRef.current = isAlert;
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastIsAlertRef.current = false;
      setToastMessage(null);
    }, 3200);
  }, []);

  const accountDisplayName = useMemo(
    () => (state.profile.name || user?.displayName || '').trim(),
    [state.profile.name, user?.displayName]
  );

  useEffect(() => {
    if (!hydrated) return;
    saveLockAccountName(accountDisplayName);
  }, [accountDisplayName, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const theme: GlassTheme =
      state.settings.glassTheme === 'frost-blue' || state.settings.glassTheme === 'obsidian-gold'
        ? state.settings.glassTheme
        : 'midnight-glass';
    document.documentElement.dataset.glassTheme = theme;
    try {
      localStorage.setItem('msl_v10_glass_theme', theme);
    } catch {
      // Ignore storage failures
    }
  }, [hydrated, state.settings.glassTheme]);

  // Hydrate full journal state from IndexedDB on boot
  useEffect(() => {
    let active = true;
    loadJournalState()
      .then((loaded) => {
        if (!active) return;
        const resolvedId = resolveActiveJournalId(
          loaded.journals || [],
          loaded.activeJournalId
        );
        const nextLoaded: JournalState = {
          ...loaded,
          activeJournalId: resolvedId,
        };
        setState(nextLoaded);
        syncNativeAlarms(nextLoaded.alarms);
        setHydrated(true);
      })
      .catch(() => {
        if (!active) return;
        setHydrated(true);
        showToast('Unable to access IndexedDB storage in this browser context.');
      });
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!hydrated) return;
    if (activePage === 'ai') setAiMounted(true);
  }, [activePage, hydrated]);

  // Gently warm AI endpoint only after splash & lock clear so startup stays 0-lag on mobile
  useEffect(() => {
    if (!hydrated || showSplash || isLocked) return;
    const timer = window.setTimeout(() => {
      void fetch('/api/health?warm=1', { keepalive: true }).catch(() => {});
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [hydrated, isLocked, showSplash]);

  // Attach real-time Cloud Firestore workspace & sync when authenticated + hydrated
  useEffect(() => {
    if (!hydrated || !authReady) return;
    if (!user) {
      mergedForSessionRef.current = null;
      setCloudStatus('local');
      setCloudError(null);
      void Promise.all([loadPlaybookChecks(null), loadActiveJournalId(null)]).then(
        ([localChecks, localActiveJournalId]) => {
          setState((prev) => ({
            ...prev,
            playbookChecks: localChecks,
            activeJournalId: resolveActiveJournalId(
              prev.journals || [],
              localActiveJournalId || prev.activeJournalId
            ),
          }));
        }
      );
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | null = null;
    let unsubMemories: (() => void) | null = null;
    let pushedLocalMemories = false;
    const preSyncSnapshot = stateRef.current;

    void loadPlaybookChecks(user.uid).then((userChecks) => {
      if (cancelled) return;
      setState((prev) => ({ ...prev, playbookChecks: userChecks }));
    });

    const initCloud = async () => {
      setCloudStatus('connecting');
      setCloudError(null);
      try {
        const { isNewWorkspace } = await ensureCloudWorkspace(
          user.uid,
          preSyncSnapshot,
          user.displayName
        );
        if (cancelled) return;

        if (isNewWorkspace) {
          try {
            localStorage.setItem(LAST_SYNCED_UID_KEY, user.uid);
          } catch {
            // Ignore
          }
          mergedForSessionRef.current = user.uid;
        }

        unsub = subscribeToCloudJournal(
          user.uid,
          async (cloudState) => {
            if (cancelled) return;

            if (mergedForSessionRef.current !== user.uid) {
              mergedForSessionRef.current = user.uid;
              let lastUid: string | null = null;
              try {
                lastUid = localStorage.getItem(LAST_SYNCED_UID_KEY);
              } catch {
                lastUid = null;
              }
              if (
                lastUid !== user.uid &&
                (preSyncSnapshot.trades.length > 0 ||
                  (preSyncSnapshot.journals || []).length > 0)
              ) {
                try {
                  const mergedCount = await mergeMissingLocalTradesToCloud(
                    user.uid,
                    preSyncSnapshot,
                    cloudState.trades,
                    cloudState.journals
                  );
                  if (mergedCount > 0 && !cancelled) {
                    showToast(`Merged ${mergedCount} local trade(s) into your cloud journal.`);
                  }
                } catch (mergeErr) {
                  if (!cancelled) {
                    showToast(formatCloudErrorMessage(mergeErr));
                  }
                }
              }
              try {
                localStorage.setItem(LAST_SYNCED_UID_KEY, user.uid);
              } catch {
                // Ignore
              }
            }

            const [scopedChecks, storedActiveJournalId] = await Promise.all([
              loadPlaybookChecks(user.uid),
              loadActiveJournalId(user.uid),
            ]);
            if (cancelled) return;
            const resolvedActiveId = resolveActiveJournalId(
              cloudState.journals || [],
              stateRef.current.activeJournalId || storedActiveJournalId
            );
            const mergedState: JournalState = {
              ...cloudState,
              activeJournalId: resolvedActiveId,
              playbookChecks: scopedChecks,
            };
            setState(mergedState);
            syncNativeAlarms(mergedState.alarms);
            setCloudStatus('synced');
            setCloudError(null);
            if (cloudPersistTimerRef.current !== null) {
              window.clearTimeout(cloudPersistTimerRef.current);
            }
            const uidForSave = user.uid;
            cloudPersistTimerRef.current = window.setTimeout(() => {
              cloudPersistTimerRef.current = null;
              void saveFullJournalState(mergedState, uidForSave).catch(() => {});
            }, 1200);
          },
          (err) => {
            if (cancelled) return;
            const msg = formatCloudErrorMessage(err);
            setCloudStatus('error');
            setCloudError(msg);
          }
        );

        unsubMemories = subscribeToCloudMemories(user.uid, (cloudMemories) => {
          if (cancelled) return;
          if (!pushedLocalMemories) {
            pushedLocalMemories = true;
            const cloudTexts = new Set(cloudMemories.map((m) => m.content.trim().toLowerCase()));
            const localOnly = memoriesRef.current.filter(
              (m) => !cloudTexts.has(m.content.trim().toLowerCase())
            );
            for (const item of localOnly) {
              void cloudSaveAIMemory(user.uid, item).catch(() => {});
            }
            if (localOnly.length > 0) {
              const merged = [...localOnly, ...cloudMemories];
              setMemories(merged);
              saveAIMemories(merged);
              return;
            }
          }
          setMemories(cloudMemories);
          saveAIMemories(cloudMemories);
        });
      } catch (err) {
        if (cancelled) return;
        const msg = formatCloudErrorMessage(err);
        setCloudStatus('error');
        setCloudError(msg);
        showToast(msg);
      }
    };

    void initCloud();

    return () => {
      cancelled = true;
      if (cloudPersistTimerRef.current !== null) {
        window.clearTimeout(cloudPersistTimerRef.current);
        cloudPersistTimerRef.current = null;
      }
      if (unsub) unsub();
      if (unsubMemories) unsubMemories();
    };
  }, [hydrated, authReady, user, setCloudStatus, setCloudError, showToast]);

  // Two-act 6-second Liquid-Glass Entry Choreography (0-3.0s Monogram Seal -> 3.0-6.0s Trajectory & Conviction)
  useEffect(() => {
    const t2 = window.setTimeout(() => {
      setSplashPhase(2);
    }, 3000);
    return () => {
      window.clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, 6000 - elapsed);
    const timer = window.setTimeout(() => {
      recordUserActivity(true);
      setShowSplash(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  // Live user inactivity & background tab auto-lock based on configured Auto-Lock timeout
  useEffect(() => {
    if (showSplash || isLocked) return;

    const onActivity = () => {
      recordUserActivity();
    };

    const checkInactivityLock = () => {
      if (!isAppLockEnabled() || !hasAppPin()) return;
      const timeoutMins = getAutoLockTimeoutMinutes();
      if (timeoutMins > 0 && getAutoLockRemainingMs() <= 0) {
        setIsLocked(true);
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        checkInactivityLock();
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'wheel',
      'scroll',
    ];
    for (const evt of activityEvents) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(checkInactivityLock, 1000);

    return () => {
      for (const evt of activityEvents) {
        window.removeEventListener(evt, onActivity);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [isLocked, showSplash]);

  // Global keyboard shortcuts: Cmd/Ctrl+K opens KAIROS AI; N opens Log Trade modal outside inputs
  useEffect(() => {
    if (showSplash || isLocked) return;
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      );

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAiMounted(true);
        handleNavigate('ai');
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('msl:focus-ai-input'));
        }, 50);
        return;
      }

      if (
        !inEditable &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'n' &&
        !tradeModalOpen &&
        !journalModalOpen &&
        !viewingTrade &&
        !tradeToDelete &&
        !journalToDelete
      ) {
        e.preventDefault();
        setEditingTrade(null);
        setDraftTemplate(null);
        setModalInitialDate(undefined);
        setTradeModalOpen(true);
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [
    handleNavigate,
    isLocked,
    journalModalOpen,
    journalToDelete,
    showSplash,
    tradeModalOpen,
    tradeToDelete,
    viewingTrade,
  ]);

  // Silence active alert notifications & toasts immediately while logging a trade
  useEffect(() => {
    if (tradeModalOpen) {
      void silenceActiveNotifications();
      if (toastIsAlertRef.current) {
        toastIsAlertRef.current = false;
        setToastMessage(null);
        if (toastTimerRef.current) {
          window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
      }
    } else {
      setSnoozedAlarmLabel(null);
    }
  }, [tradeModalOpen]);

  // Background session alarms & quote reminder ticker (starts after entry splash to keep startup fast)
  useEffect(() => {
    if (!hydrated || showSplash) return;

    const runCheck = async () => {
      const res = await evaluateAlarmsAndQuotes(
        state.alarms,
        state.settings,
        lastAlarmKeyRef.current,
        { isLoggingTrade: tradeModalOpen }
      );
      if (res.triggeredKey) {
        lastAlarmKeyRef.current = res.triggeredKey;
      }
      if (res.snoozedAlarmName) {
        setSnoozedAlarmLabel(res.snoozedAlarmName);
      }
      if (res.toastMessage) {
        showToast(res.toastMessage, true);
      }
      if (res.quote) {
        setQuote(res.quote);
      }
    };

    void runCheck();
    const interval = window.setInterval(() => {
      void runCheck();
    }, 15000);
    const onFocusOrVisible = () => {
      if (!document.hidden) void runCheck();
    };

    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [hydrated, showSplash, state.alarms, state.settings, showToast, tradeModalOpen]);

  const handleSelectJournal = useCallback((journalId: string) => {
    const exists = (stateRef.current.journals || []).some(
      (j) => !j.isDeleted && j.id === journalId
    );
    if (!exists) return;
    stateRef.current = { ...stateRef.current, activeJournalId: journalId };
    setState((prev) => ({ ...prev, activeJournalId: journalId }));
    void saveActiveJournalId(journalId, userRef.current?.uid);
  }, []);

  const handleOpenCreateJournal = useCallback(() => {
    setEditingJournal(null);
    setJournalModalOpen(true);
  }, []);

  const handleOpenEditJournal = useCallback((journal: TradingJournal) => {
    setEditingJournal(journal);
    setJournalModalOpen(true);
  }, []);

  const handleSaveJournal = async (journal: TradingJournal) => {
    const isNew = !(stateRef.current.journals || []).some((j) => j.id === journal.id);
    await saveJournalRecord(journal);

    const existingIdx = (stateRef.current.journals || []).findIndex(
      (j) => j.id === journal.id
    );
    const nextJournals =
      existingIdx >= 0
        ? stateRef.current.journals.map((j) => (j.id === journal.id ? journal : j))
        : [...(stateRef.current.journals || []), journal];
    const nextActiveId = isNew
      ? journal.id
      : resolveActiveJournalId(
          nextJournals,
          stateRef.current.activeJournalId || journal.id
        );

    setState((prev) => {
      const idx = (prev.journals || []).findIndex((j) => j.id === journal.id);
      const updated =
        idx >= 0
          ? prev.journals.map((j) => (j.id === journal.id ? journal : j))
          : [...(prev.journals || []), journal];
      return {
        ...prev,
        journals: updated,
        activeJournalId: nextActiveId,
      };
    });

    if (isNew && nextActiveId) {
      await saveActiveJournalId(nextActiveId, user?.uid);
    }

    setJournalModalOpen(false);
    setEditingJournal(null);

    if (user) {
      try {
        await cloudSaveJournal(user.uid, journal);
        showToast(
          isNew
            ? `Journal "${journal.name}" created & synced.`
            : `Journal "${journal.name}" updated & synced.`
        );
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast(
        isNew
          ? `Journal "${journal.name}" created.`
          : `Journal "${journal.name}" updated.`
      );
    }
  };

  const handleConfirmDeleteJournal = async () => {
    if (!journalToDelete) return;
    const nowIso = new Date().toISOString();
    const softDeleted: TradingJournal = {
      ...journalToDelete,
      isDeleted: true,
      deletedAt: nowIso,
      updatedAt: nowIso,
    };
    await saveJournalRecord(softDeleted);

    const nextJournals = (stateRef.current.journals || []).map((j) =>
      j.id === softDeleted.id ? softDeleted : j
    );
    const nextActiveId =
      stateRef.current.activeJournalId === softDeleted.id
        ? resolveActiveJournalId(nextJournals, null)
        : resolveActiveJournalId(nextJournals, stateRef.current.activeJournalId);

    await saveActiveJournalId(nextActiveId, user?.uid);
    setState((prev) => ({
      ...prev,
      journals: prev.journals.map((j) => (j.id === softDeleted.id ? softDeleted : j)),
      activeJournalId: nextActiveId,
    }));
    setJournalToDelete(null);

    if (user) {
      try {
        await cloudSoftDeleteJournal(user.uid, softDeleted);
        showToast(`Journal "${softDeleted.name}" deleted.`);
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast(`Journal "${softDeleted.name}" deleted.`);
    }
  };

  const handleOpenNewTrade = useCallback(
    (dateIso?: string) => {
      const currentActiveId = resolveActiveJournalId(
        stateRef.current.journals || [],
        stateRef.current.activeJournalId
      );
      if (!currentActiveId) {
        setEditingJournal(null);
        setJournalModalOpen(true);
        showToast('Create a journal first to start logging trades.');
        return;
      }
      setEditingTrade(null);
      setDraftTemplate(null);
      setModalInitialDate(dateIso);
      setTradeModalOpen(true);
    },
    [showToast]
  );

  const handleEditTrade = (trade: Trade) => {
    setViewingTrade(null);
    setDraftTemplate(null);
    setEditingTrade(trade);
    setModalInitialDate(undefined);
    setTradeModalOpen(true);
  };

  const handleDuplicateTrade = (trade: Trade) => {
    setViewingTrade(null);
    setEditingTrade(null);
    setDraftTemplate(trade);
    setModalInitialDate(undefined);
    setTradeModalOpen(true);
  };

  const handleSaveTrade = async (trade: Trade) => {
    const resolvedId =
      trade.journalId ||
      resolveActiveJournalId(
        stateRef.current.journals || [],
        stateRef.current.activeJournalId
      );
    const tradeToSave: Trade = resolvedId ? { ...trade, journalId: resolvedId } : trade;

    await saveTradeRecord(tradeToSave);
    setState((prev) => ({
      ...prev,
      trades: [tradeToSave, ...prev.trades.filter((x) => x.id !== tradeToSave.id)],
    }));
    setTradeModalOpen(false);
    setEditingTrade(null);
    setDraftTemplate(null);

    if (user) {
      try {
        await cloudSaveTrade(user.uid, tradeToSave);
        showToast('Trade saved & synced to cloud.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Trade saved to device storage.');
    }
  };

  const handleConfirmDeleteTrade = async () => {
    if (!tradeToDelete) return;
    const id = tradeToDelete.id;
    await deleteTradeRecord(id);
    setState((prev) => ({
      ...prev,
      trades: prev.trades.filter((x) => x.id !== id),
    }));
    setTradeToDelete(null);
    setViewingTrade(null);

    if (user) {
      try {
        await cloudDeleteTrade(user.uid, id);
        showToast('Trade deleted from device & cloud.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Trade deleted.');
    }
  };

  const handleSaveModel = async (model: TradingModel) => {
    const nextModels = [model, ...state.models.filter((m) => m.id !== model.id)];
    await saveKV('models', nextModels);
    setState((prev) => ({ ...prev, models: nextModels }));

    if (user) {
      try {
        await cloudSaveModel(user.uid, model);
        showToast('Model saved & synced.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Model saved.');
    }
  };

  const handleDeleteModel = async (id: string) => {
    const nextModels = state.models.filter((m) => m.id !== id);
    await saveKV('models', nextModels);
    setState((prev) => ({ ...prev, models: nextModels }));

    if (user) {
      try {
        await cloudDeleteModel(user.uid, id);
        showToast('Model deleted.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Model deleted.');
    }
  };

  const handleSaveField = async (field: CustomField) => {
    const exists = state.fields.some((f) => f.id === field.id);
    const nextFields = exists
      ? state.fields.map((f) => (f.id === field.id ? field : f))
      : [...state.fields, field];
    await saveKV('fields', nextFields);
    setState((prev) => ({ ...prev, fields: nextFields }));

    if (user) {
      try {
        await cloudSaveField(user.uid, field);
        showToast('Custom property saved & synced.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Custom property saved.');
    }
  };

  const handleDeleteField = async (id: string) => {
    const nextFields = state.fields.filter((f) => f.id !== id);
    await saveKV('fields', nextFields);
    setState((prev) => ({ ...prev, fields: nextFields }));

    if (user) {
      try {
        await cloudDeleteField(user.uid, id);
        showToast('Property removed from form. Existing trade values preserved.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Property removed from form. Existing trade values preserved.');
    }
  };

  const handleSavePlaybook = async (playbook: Playbook) => {
    await saveKV('playbook', playbook);
    setState((prev) => ({ ...prev, playbook }));

    if (user) {
      try {
        await cloudSavePlaybook(user.uid, playbook);
        showToast('Playbook saved & synced.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Playbook saved.');
    }
  };

  const handleSavePlaybookChecks = useCallback((nextChecks: Record<string, boolean>) => {
    setState((prev) => ({
      ...prev,
      playbookChecks: nextChecks,
    }));
    void savePlaybookChecks(nextChecks, userRef.current?.uid);
  }, []);

  const handleSaveAlarmsAndSettings = async (
    alarms: SessionAlarm[],
    settings: JournalSettings
  ) => {
    await Promise.all([saveKV('alarms', alarms), saveKV('settings', settings)]);
    setState((prev) => ({ ...prev, alarms, settings }));
    syncNativeAlarms(alarms);

    if (user) {
      try {
        await cloudSaveAlarmsAndSettings(user.uid, alarms, settings);
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    }
  };

  const handleSaveProfile = async (profile: UserProfile) => {
    await saveKV('profile', profile);
    setState((prev) => ({ ...prev, profile }));

    if (user) {
      try {
        await cloudSaveProfile(user.uid, profile);
        showToast('Preferences saved & synced.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('Preferences saved.');
    }
  };

  const handleCycleQuote = useCallback(() => {
    setQuote((prev) => randomQuote(prev));
  }, []);

  // Execute KAIROS App Control Actions (syncs to state, IndexedDB, and Cloud Firestore)
  const handleExecuteAIActions = useCallback(
    async (actions: AIAppAction[]): Promise<AIAppActionResult[]> => {
      const results: AIAppActionResult[] = [];
      const activeUser = userRef.current;

      for (const action of actions) {
        try {
          if (action.name === 'navigate_app') {
            const target = String(action.args?.page || 'dashboard').toLowerCase() as PageId;
            if (VALID_PAGES.has(target)) {
              handleNavigate(target);
              results.push({
                name: action.name,
                label: `Opened ${target}`,
                ok: true,
              });
            } else {
              results.push({
                name: action.name,
                label: `Unknown screen "${target}"`,
                ok: false,
              });
            }
          } else if (action.name === 'open_log_trade_modal') {
            handleOpenNewTrade(action.args?.initialDate);
            results.push({
              name: action.name,
              label: 'Opened Log Trade modal',
              ok: true,
            });
          } else if (action.name === 'log_trade') {
            const curJournals = stateRef.current.journals || [];
            const curActiveId = resolveActiveJournalId(
              curJournals,
              stateRef.current.activeJournalId
            );
            const curActiveJournal =
              curJournals.find((j) => !j.isDeleted && j.id === curActiveId) || null;
            if (!curActiveJournal) {
              results.push({
                name: action.name,
                label: 'Create a journal first before logging trades',
                ok: false,
              });
              setEditingJournal(null);
              setJournalModalOpen(true);
              showToast('Create a journal first to log trades.');
              continue;
            }

            const nowIso = new Date().toISOString();
            const curSettings = stateRef.current.settings;
            const pnlUnit = normalizeMetricUnit(
              action.args.pnlUnit,
              curSettings.defaultPnlUnit || 'r'
            );
            const riskUnit = normalizeMetricUnit(
              action.args.riskUnit,
              curSettings.defaultRiskUnit || 'r'
            );
            const currency =
              typeof action.args.currency === 'string' && action.args.currency.trim()
                ? action.args.currency.trim().slice(0, 8)
                : curActiveJournal.currency || curSettings.currency || 'R';
            const newTrade: Trade = {
              id: generateId(),
              journalId: curActiveJournal.id,
              date:
                typeof action.args.date === 'string' && action.args.date.trim()
                  ? action.args.date.trim().slice(0, 16)
                  : localDateTime(new Date()),
              pair: String(action.args.pair || 'EURUSD').trim().toUpperCase(),
              direction: normalizeDirection(action.args.direction),
              setup: normalizeSetup(action.args.setup),
              session: normalizeSession(action.args.session),
              result: normalizeOutcome(action.args.result),
              r: Number.isFinite(Number(action.args.r)) ? Number(action.args.r) : 0,
              risk:
                Number.isFinite(Number(action.args.risk)) && Number(action.args.risk) >= 0
                  ? Number(action.args.risk)
                  : 1,
              pnlUnit,
              riskUnit,
              currency,
              model: String(action.args.model || '').trim(),
              tags: Array.isArray(action.args.tags)
                ? action.args.tags.map((t) => String(t).trim()).filter(Boolean)
                : [],
              notes: String(action.args.notes || '').trim(),
              custom: {},
              images: [],
              createdAt: nowIso,
              updatedAt: nowIso,
            };

            await saveTradeRecord(newTrade);
            setState((prev) => ({
              ...prev,
              trades: [newTrade, ...prev.trades],
            }));
            if (activeUser) {
              await cloudSaveTrade(activeUser.uid, newTrade).catch(() => {});
            }
            const label = `Logged ${newTrade.pair} ${newTrade.direction} (${newTrade.result} ${formatTradePnL(newTrade)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`KAIROS: ${label}`);
          } else if (action.name === 'update_trade') {
            const targetId = String(action.args.tradeId || '').trim();
            const existing = stateRef.current.trades.find((t) => t.id === targetId);
            if (!existing) {
              results.push({
                name: action.name,
                label: `Trade ${targetId} not found`,
                ok: false,
              });
              continue;
            }
            const updated: Trade = {
              ...existing,
              pair: action.args.pair ? String(action.args.pair).toUpperCase() : existing.pair,
              direction: action.args.direction
                ? normalizeDirection(action.args.direction)
                : existing.direction,
              setup: action.args.setup ? normalizeSetup(action.args.setup) : existing.setup,
              session: action.args.session
                ? normalizeSession(action.args.session)
                : existing.session,
              result: action.args.result
                ? normalizeOutcome(action.args.result)
                : existing.result,
              r:
                action.args.r !== undefined && Number.isFinite(Number(action.args.r))
                  ? Number(action.args.r)
                  : existing.r,
              risk:
                action.args.risk !== undefined && Number.isFinite(Number(action.args.risk))
                  ? Number(action.args.risk)
                  : existing.risk,
              pnlUnit: action.args.pnlUnit
                ? normalizeMetricUnit(action.args.pnlUnit, existing.pnlUnit || 'r')
                : existing.pnlUnit,
              riskUnit: action.args.riskUnit
                ? normalizeMetricUnit(action.args.riskUnit, existing.riskUnit || 'r')
                : existing.riskUnit,
              currency:
                typeof action.args.currency === 'string' && action.args.currency.trim()
                  ? action.args.currency.trim().slice(0, 8)
                  : existing.currency,
              model: action.args.model !== undefined ? String(action.args.model) : existing.model,
              tags: Array.isArray(action.args.tags)
                ? action.args.tags.map((t) => String(t).trim()).filter(Boolean)
                : existing.tags,
              notes: action.args.notes !== undefined ? String(action.args.notes) : existing.notes,
              updatedAt: new Date().toISOString(),
            };
            await saveTradeRecord(updated);
            setState((prev) => ({
              ...prev,
              trades: [updated, ...prev.trades.filter((x) => x.id !== updated.id)],
            }));
            if (activeUser) {
              await cloudSaveTrade(activeUser.uid, updated).catch(() => {});
            }
            const label = `Updated ${updated.pair} (${updated.result} ${formatTradePnL(updated)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`KAIROS: ${label}`);
          } else if (action.name === 'delete_trade') {
            const targetId = String(action.args.tradeId || '').trim();
            const existing = stateRef.current.trades.find((t) => t.id === targetId);
            if (!existing) {
              results.push({
                name: action.name,
                label: `Trade ${targetId} not found`,
                ok: false,
              });
              continue;
            }
            await deleteTradeRecord(targetId);
            setState((prev) => ({
              ...prev,
              trades: prev.trades.filter((x) => x.id !== targetId),
            }));
            if (activeUser) {
              await cloudDeleteTrade(activeUser.uid, targetId).catch(() => {});
            }
            const label = `Deleted ${existing.pair} (${formatTradePnL(existing)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`KAIROS: ${label}`);
          } else if (action.name === 'create_trading_model') {
            const newModel: TradingModel = {
              id: generateId(),
              name: String(action.args.name || 'AI Setup Model').trim(),
              type: normalizeModelType(action.args.type),
              entry: String(action.args.entry || '').trim(),
              risk: String(action.args.risk || '').trim(),
            };
            const nextModels = [newModel, ...stateRef.current.models];
            await saveKV('models', nextModels);
            setState((prev) => ({ ...prev, models: nextModels }));
            if (activeUser) {
              await cloudSaveModel(activeUser.uid, newModel).catch(() => {});
            }
            results.push({
              name: action.name,
              label: `Saved model "${newModel.name}"`,
              ok: true,
            });
            showToast(`KAIROS: Saved model "${newModel.name}"`);
          } else if (action.name === 'update_playbook') {
            const currentPb = stateRef.current.playbook;
            const nextPlaybook: Playbook = {
              core:
                action.args.core !== undefined ? String(action.args.core) : currentPb.core,
              rev: action.args.rev !== undefined ? String(action.args.rev) : currentPb.rev,
              cont:
                action.args.cont !== undefined ? String(action.args.cont) : currentPb.cont,
              entry:
                action.args.entry !== undefined ? String(action.args.entry) : currentPb.entry,
              risk:
                action.args.risk !== undefined ? String(action.args.risk) : currentPb.risk,
            };
            await saveKV('playbook', nextPlaybook);
            setState((prev) => ({ ...prev, playbook: nextPlaybook }));
            if (activeUser) {
              await cloudSavePlaybook(activeUser.uid, nextPlaybook).catch(() => {});
            }
            results.push({
              name: action.name,
              label: 'Updated Playbook',
              ok: true,
            });
            showToast('KAIROS: Playbook updated.');
          } else if (action.name === 'update_session_alarm') {
            const alarmName = String(action.args.name || '').trim();
            const currentAlarms = stateRef.current.alarms;
            const matchIdx = currentAlarms.findIndex(
              (a) => a.name.toLowerCase() === alarmName.toLowerCase()
            );
            let nextAlarms: SessionAlarm[];
            if (matchIdx >= 0) {
              nextAlarms = currentAlarms.map((a, idx) =>
                idx === matchIdx
                  ? {
                      ...a,
                      time: action.args.time ? String(action.args.time) : a.time,
                      enabled:
                        action.args.enabled !== undefined
                          ? Boolean(action.args.enabled)
                          : a.enabled,
                    }
                  : a
              );
            } else {
              nextAlarms = [
                ...currentAlarms,
                {
                  id: generateId(),
                  name: alarmName || 'Session Alarm',
                  time: action.args.time ? String(action.args.time) : '08:00',
                  enabled:
                    action.args.enabled !== undefined ? Boolean(action.args.enabled) : true,
                },
              ];
            }
            await saveKV('alarms', nextAlarms);
            setState((prev) => ({ ...prev, alarms: nextAlarms }));
            syncNativeAlarms(nextAlarms);
            if (activeUser) {
              await cloudSaveAlarmsAndSettings(
                activeUser.uid,
                nextAlarms,
                stateRef.current.settings
              ).catch(() => {});
            }
            results.push({
              name: action.name,
              label: `Alarm "${alarmName}" updated`,
              ok: true,
            });
            showToast(`KAIROS: Alarm "${alarmName}" updated.`);
          } else if (action.name === 'cycle_motivational_quote') {
            handleCycleQuote();
            results.push({
              name: action.name,
              label: 'Refreshed discipline quote',
              ok: true,
            });
          } else if (action.name === 'save_memory') {
            const res = upsertAIMemory(
              memoriesRef.current,
              String(action.args?.content || ''),
              action.args?.category
            );
            if (res) {
              memoriesRef.current = res.nextList;
              setMemories(res.nextList);
              if (activeUser) {
                await cloudSaveAIMemory(activeUser.uid, res.item).catch(() => {});
              }
              results.push({
                name: action.name,
                label: `Remembered: ${res.item.content.slice(0, 56)}${res.item.content.length > 56 ? '…' : ''}`,
                ok: true,
              });
            }
          } else if (action.name === 'forget_memory') {
            const res = removeAIMemory(memoriesRef.current, {
              memoryId: action.args?.memoryId,
              query: action.args?.query,
            });
            if (res.removed.length > 0) {
              memoriesRef.current = res.nextList;
              setMemories(res.nextList);
              if (activeUser) {
                for (const item of res.removed) {
                  await cloudDeleteAIMemory(activeUser.uid, item.id).catch(() => {});
                }
              }
              results.push({
                name: action.name,
                label: `Forgot ${res.removed.length} memory item${res.removed.length > 1 ? 's' : ''}`,
                ok: true,
              });
            }
          } else if (action.name === 'update_playbook_checks') {
            const mode = action.args?.action === 'reset' || action.args?.action === 'uncheck'
              ? action.args.action
              : 'check';
            const query = String(action.args?.query || '').trim().toLowerCase();
            const stripChecklistLine = (line: string) =>
              line
                .replace(/^\s*[-*•]+\s*/, '')
                .replace(/^\s*\[[ xX]?\]\s*/, '')
                .replace(/^\s*\d+[.)]\s+/, '')
                .trim();
            const makeId = (scope: string, itemText: string, index: number) => {
              const slug = itemText
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 64);
              return `${scope}::${slug || 'item'}::${index}`;
            };

            const currentState = stateRef.current;
            const prevChecks = { ...(currentState.playbookChecks || {}) };
            let touched = 0;

            if (mode === 'reset' && !query) {
              touched = Object.keys(prevChecks).length;
              setState((prev) => ({ ...prev, playbookChecks: {} }));
              void savePlaybookChecks({}, activeUser?.uid);
              results.push({
                name: action.name,
                label: 'Reset all playbook checks',
                ok: true,
              });
              showToast('KAIROS: Playbook checklist reset.');
            } else {
              const sectionPairs: Array<{ scope: string; label: string; raw: string }> = [
                { scope: 'pb-core', label: 'core narrative', raw: currentState.playbook.core },
                { scope: 'pb-rev', label: 'reversal', raw: currentState.playbook.rev },
                { scope: 'pb-cont', label: 'continuation', raw: currentState.playbook.cont },
                { scope: 'pb-entry', label: 'entry criteria', raw: currentState.playbook.entry },
                { scope: 'pb-risk', label: 'risk rules', raw: currentState.playbook.risk },
                ...currentState.models.flatMap((m) => [
                  { scope: `model-${m.id}-entry`, label: `${m.name} entry`, raw: m.entry },
                  { scope: `model-${m.id}-risk`, label: `${m.name} risk`, raw: m.risk },
                ]),
              ];

              for (const sec of sectionPairs) {
                const lines = (sec.raw || '')
                  .split(/\r?\n/)
                  .map(stripChecklistLine)
                  .filter(Boolean);
                lines.forEach((itemText, idx) => {
                  const id = makeId(sec.scope, itemText, idx);
                  const matches =
                    !query ||
                    itemText.toLowerCase().includes(query) ||
                    sec.label.toLowerCase().includes(query) ||
                    sec.scope.toLowerCase().includes(query);
                  if (!matches) return;
                  if (mode === 'check') {
                    if (!prevChecks[id]) {
                      prevChecks[id] = true;
                      touched += 1;
                    }
                  } else {
                    if (prevChecks[id]) {
                      delete prevChecks[id];
                      touched += 1;
                    }
                  }
                });
              }

              setState((prev) => ({ ...prev, playbookChecks: prevChecks }));
              void savePlaybookChecks(prevChecks, activeUser?.uid);
              const label =
                mode === 'check'
                  ? `Checked off ${touched} playbook criterion${touched === 1 ? '' : 'a'}`
                  : `Unchecked ${touched} playbook criterion${touched === 1 ? '' : 'a'}`;
              results.push({ name: action.name, label, ok: true });
              showToast(`KAIROS: ${label}.`);
            }
          } else if (action.name === 'set_journal_units') {
            const cur = stateRef.current.settings;
            const nextSettings: JournalSettings = {
              ...cur,
              defaultPnlUnit: action.args?.defaultPnlUnit
                ? normalizeMetricUnit(action.args.defaultPnlUnit, cur.defaultPnlUnit || 'r')
                : cur.defaultPnlUnit,
              defaultRiskUnit: action.args?.defaultRiskUnit
                ? normalizeMetricUnit(action.args.defaultRiskUnit, cur.defaultRiskUnit || 'r')
                : cur.defaultRiskUnit,
              currency:
                typeof action.args?.currency === 'string' && action.args.currency.trim()
                  ? action.args.currency.trim().slice(0, 8)
                  : cur.currency,
            };
            await saveKV('settings', nextSettings);
            setState((prev) => ({ ...prev, settings: nextSettings }));
            if (activeUser) {
              await cloudSaveAlarmsAndSettings(
                activeUser.uid,
                stateRef.current.alarms,
                nextSettings
              ).catch(() => {});
            }
            const unitSummary = `P&L: ${getUnitShortLabel(nextSettings.defaultPnlUnit, nextSettings.currency)} · Risk: ${getUnitShortLabel(nextSettings.defaultRiskUnit, nextSettings.currency)}`;
            results.push({
              name: action.name,
              label: `Updated units (${unitSummary})`,
              ok: true,
            });
            showToast(`KAIROS: Units set (${unitSummary}).`);
          }
        } catch {
          results.push({
            name: action.name,
            label: `Failed ${action.name}`,
            ok: false,
          });
        }
      }

      return results;
    },
    [handleCycleQuote, handleNavigate, handleOpenNewTrade, showToast]
  );

  const handleAddMemoryManual = useCallback(
    async (content: string, category: AIMemoryCategory) => {
      const res = upsertAIMemory(memoriesRef.current, content, category);
      if (!res) return;
      memoriesRef.current = res.nextList;
      setMemories(res.nextList);
      if (userRef.current) {
        await cloudSaveAIMemory(userRef.current.uid, res.item).catch(() => {});
      }
      showToast('Memory saved.');
    },
    [showToast]
  );

  const handleDeleteMemoryManual = useCallback(async (id: string) => {
    const res = removeAIMemory(memoriesRef.current, { memoryId: id });
    if (res.removed.length === 0) return;
    memoriesRef.current = res.nextList;
    setMemories(res.nextList);
    if (userRef.current) {
      await cloudDeleteAIMemory(userRef.current.uid, id).catch(() => {});
    }
  }, []);

  const handleDownloadBackup = () => {
    const payload = buildBackupPayload(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MSL-Journal-v11-backup-${isoDate(new Date())}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Full backup downloaded.');
  };

  const handleExportCSV = (filteredTrades: Trade[]) => {
    const headers = [
      'Date',
      'Symbol',
      'Side',
      'Setup',
      'Session',
      'Outcome',
      'Profit / Loss',
      'P&L Unit',
      'Risk',
      'Risk Unit',
      'Model',
      'Tags',
      'Notes',
    ];
    const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = filteredTrades.map((t) =>
      [
        t.date,
        t.pair,
        t.direction,
        t.setup,
        t.session,
        t.result,
        formatTradePnL(t, state.settings.defaultPnlUnit, state.settings.currency),
        getUnitShortLabel(t.pnlUnit || state.settings.defaultPnlUnit || 'r', t.currency || state.settings.currency),
        formatTradeRisk(t, state.settings.defaultRiskUnit, state.settings.currency),
        getUnitShortLabel(t.riskUnit || state.settings.defaultRiskUnit || 'r', t.currency || state.settings.currency),
        t.model || '',
        Array.isArray(t.tags) ? t.tags.join('; ') : '',
        t.notes || '',
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MSL-Journal-Trades-${isoDate(new Date())}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${filteredTrades.length} trades to CSV.`);
  };

  const handleRestoreBackup = async (restored: JournalState) => {
    await saveFullJournalState(restored, user?.uid);
    setState(restored);
    syncNativeAlarms(restored.alarms);

    if (user) {
      try {
        await cloudReplaceFullJournal(user.uid, restored);
        showToast(`Backup restored & synced (${restored.trades.length} trades).`);
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast(`Backup restored (${restored.trades.length} trades).`);
    }
  };

  const handleClearAllData = async () => {
    const fresh = await clearAllJournalData(user?.uid);
    setState(fresh);
    syncNativeAlarms(fresh.alarms);

    if (user) {
      try {
        await cloudReplaceFullJournal(user.uid, fresh);
        showToast('All local and cloud journal data cleared.');
      } catch (err) {
        showToast(formatCloudErrorMessage(err));
      }
    } else {
      showToast('All local journal data cleared.');
    }
  };

  const handleSignIn = async () => {
    try {
      const signedInUser = await signInWithGoogle();
      if (signedInUser) {
        showToast(`Signed in as ${signedInUser.displayName || signedInUser.email}.`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleSignOut = async () => {
    await signOutAccount();
    showToast('Signed out. Local device journal remains intact.');
  };

  const handleForceSyncToCloud = async () => {
    if (!user) return;
    try {
      await cloudReplaceFullJournal(user.uid, stateRef.current);
      showToast('Full journal pushed to Cloud Firestore.');
    } catch (err) {
      showToast(formatCloudErrorMessage(err));
    }
  };

  const handleCopyQuote = async () => {
    try {
      await navigator.clipboard.writeText(`“${quote.text}” — ${quote.source}`);
      showToast('Quote copied to clipboard.');
    } catch {
      showToast('Clipboard copy unavailable in this browser.');
    }
  };

  return (
    <>
      {/* Minimal 6-Second Entry Animation */}
      <AnimatePresence>
        {showSplash && (
          <EntrySplash
            phase={splashPhase}
            durationMs={6000}
          />
        )}
      </AnimatePresence>

      {/* 4-Digit PIN Lock Gate Shown Right After Entry Animation */}
      <AnimatePresence>
        {!showSplash && isLocked && (
          <AppLockScreen
            accountName={accountDisplayName}
            accountLoaded={hydrated}
            onUnlock={() => {
              recordUserActivity(true);
              setIsLocked(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Only mount main workspace & charts once splash and lock screen clear (prevents mobile GPU OOM) */}
      {!showSplash && !isLocked && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <Layout
          activePage={activePage}
          onNavigate={handleNavigate}
          onOpenTradeModal={() => handleOpenNewTrade()}
          onCycleQuote={handleCycleQuote}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          displayName={state.profile.name}
          journals={activeJournals}
          activeJournal={activeJournal}
          journalSummaries={journalSummaryMap}
          onSelectJournal={handleSelectJournal}
          onCreateJournal={handleOpenCreateJournal}
        >
          {!hydrated ? (
            <div className="space-y-5 animate-pulse">
              <div className="h-44 rounded-2xl glass-card" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="h-28 rounded-2xl glass-card" />
                <div className="h-28 rounded-2xl glass-card" />
                <div className="h-28 rounded-2xl glass-card" />
                <div className="h-28 rounded-2xl glass-card" />
              </div>
            </div>
          ) : (
            <Suspense fallback={<ScreenSkeleton />}>
              {aiMounted && (
                <div className={activePage === 'ai' ? 'block' : 'hidden'}>
                  <AIScreen
                    journalState={scopedAIState}
                    memories={memories}
                    isActive={activePage === 'ai'}
                    onBack={() => setActivePage(previousPageRef.current || 'dashboard')}
                    onAddMemory={handleAddMemoryManual}
                    onDeleteMemory={handleDeleteMemoryManual}
                    onExecuteAIActions={handleExecuteAIActions}
                  />
                </div>
              )}

              {activePage !== 'ai' && (
                <motion.div
                  key={activePage}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.08, ease: 'easeOut' }}
                >
                  {activePage === 'dashboard' && (
                    <OverviewScreen
                      journals={activeJournals}
                      activeJournal={activeJournal}
                      journalSummaries={journalSummaries}
                      trades={scopedTrades}
                      alarms={state.alarms}
                      settings={state.settings}
                      quote={quote}
                      onNextQuote={handleCycleQuote}
                      onCopyQuote={handleCopyQuote}
                      onOpenLogTrade={() => handleOpenNewTrade()}
                      onSelectJournal={handleSelectJournal}
                      onCreateJournal={handleOpenCreateJournal}
                      onEditJournal={handleOpenEditJournal}
                      onDeleteJournal={(j) => setJournalToDelete(j)}
                      onNavigate={handleNavigate}
                      onSelectTrade={(t) => setViewingTrade(t)}
                      entranceReady={!showSplash && !isLocked}
                    />
                  )}

                  {activePage === 'journals' && (
                    <JournalsScreen
                      journals={activeJournals}
                      activeJournal={activeJournal}
                      journalSummaries={journalSummaries}
                      onSelectJournal={handleSelectJournal}
                      onCreateJournal={handleOpenCreateJournal}
                      onEditJournal={handleOpenEditJournal}
                      onDeleteJournal={(j) => setJournalToDelete(j)}
                      onLogTradeInJournal={(journalId) => {
                        handleSelectJournal(journalId);
                        handleOpenNewTrade();
                      }}
                      entranceReady={!showSplash && !isLocked}
                    />
                  )}

                  {activePage === 'journal' && (
                    <JournalScreen
                      trades={scopedTrades}
                      settings={state.settings}
                      activeJournalName={activeJournal?.name}
                      onOpenNewTrade={() => handleOpenNewTrade()}
                      onSelectTrade={(t) => setViewingTrade(t)}
                      onExportBackup={handleDownloadBackup}
                      onExportCSV={handleExportCSV}
                    />
                  )}

                  {activePage === 'calendar' && (
                    <CalendarScreen
                      trades={scopedTrades}
                      settings={state.settings}
                      activeJournalName={activeJournal?.name}
                      onLogTradeForDate={(dateIso) => handleOpenNewTrade(dateIso)}
                      onSelectTrade={(t) => setViewingTrade(t)}
                    />
                  )}

                  {activePage === 'models' && (
                    <ModelsScreen
                      models={state.models}
                      fields={state.fields}
                      onSaveModel={handleSaveModel}
                      onDeleteModel={handleDeleteModel}
                      onSaveField={handleSaveField}
                      onDeleteField={handleDeleteField}
                    />
                  )}

                  {activePage === 'analytics' && (
                    <AnalyticsScreen
                      trades={scopedTrades}
                      settings={state.settings}
                      activeJournalName={activeJournal?.name}
                      onSelectTrade={(t) => setViewingTrade(t)}
                    />
                  )}

                  {activePage === 'playbook' && (
                    <PlaybookScreen
                      playbook={state.playbook}
                      checks={state.playbookChecks || {}}
                      models={state.models}
                      onSavePlaybook={handleSavePlaybook}
                      onSaveChecks={handleSavePlaybookChecks}
                      onSaveModel={handleSaveModel}
                      onDeleteModel={handleDeleteModel}
                      onNavigate={setActivePage}
                    />
                  )}

                  {activePage === 'settings' && (
                    <SettingsScreen
                      alarms={state.alarms}
                      settings={state.settings}
                      profile={state.profile}
                      onSaveAlarmsAndSettings={handleSaveAlarmsAndSettings}
                      onSaveProfile={handleSaveProfile}
                      onDownloadBackup={handleDownloadBackup}
                      onRestoreBackup={handleRestoreBackup}
                      onClearAllData={handleClearAllData}
                      onSignIn={handleSignIn}
                      onSignOut={handleSignOut}
                      onForceSyncToCloud={handleForceSyncToCloud}
                      onLockApp={() => setIsLocked(true)}
                      onToast={showToast}
                    />
                  )}
                </motion.div>
              )}
            </Suspense>
          )}
        </Layout>
      </motion.div>
      )}

      {/* Create / Edit Journal Modal */}
      <JournalModal
        open={journalModalOpen}
        journal={editingJournal}
        defaultCurrency={state.settings.currency}
        onClose={() => {
          setJournalModalOpen(false);
          setEditingJournal(null);
        }}
        onSave={handleSaveJournal}
      />

      {/* Log / Edit Trade Modal */}
      <TradeModal
        open={tradeModalOpen}
        trade={editingTrade}
        draftTemplate={draftTemplate}
        initialDate={modalInitialDate}
        defaultMarket={state.profile.market}
        activeJournal={activeJournal}
        settings={state.settings}
        models={state.models}
        fields={state.fields}
        existingTags={existingTags}
        hasActiveAlarms={state.alarms.some((a) => a.enabled)}
        snoozedAlarmName={snoozedAlarmLabel}
        onClose={() => {
          setTradeModalOpen(false);
          setEditingTrade(null);
          setDraftTemplate(null);
        }}
        onSave={handleSaveTrade}
        onNotifyError={showToast}
      />

      {/* Tap-to-View Trade Detail Modal */}
      <TradeDetailModal
        trade={viewingTrade}
        fields={state.fields}
        settings={state.settings}
        onClose={() => setViewingTrade(null)}
        onEdit={handleEditTrade}
        onDuplicate={handleDuplicateTrade}
        onDelete={(t) => setTradeToDelete(t)}
      />

      {/* Delete Trade Confirmation Modal */}
      <ConfirmModal
        open={Boolean(tradeToDelete)}
        danger
        title="Delete trade permanently?"
        description={
          tradeToDelete
            ? `Remove ${tradeToDelete.pair} (${formatTradePnL(tradeToDelete, state.settings.defaultPnlUnit, state.settings.currency)}) and its attached screenshots from this device?`
            : ''
        }
        confirmLabel="Delete trade"
        onConfirm={handleConfirmDeleteTrade}
        onCancel={() => setTradeToDelete(null)}
      />

      {/* Soft-Delete Journal Confirmation Modal */}
      <ConfirmModal
        open={Boolean(journalToDelete)}
        danger
        title="Delete trading journal?"
        description={
          journalToDelete
            ? `Remove "${journalToDelete.name}" from your active journals and switchers? Its trades will stay archived safely unless you clear all data.`
            : ''
        }
        confirmLabel="Delete journal"
        onConfirm={handleConfirmDeleteJournal}
        onCancel={() => setJournalToDelete(null)}
      />

      {/* Offline Status Notice */}
      <OfflineBanner />

      {/* Liquid Glass Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-16 sm:top-5 right-4 z-[70] max-w-xs sm:max-w-sm rounded-xl glass-modal border-[#47dca0]/40 px-4 py-2.5 text-xs sm:text-sm font-medium text-[#eef3fb]"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
