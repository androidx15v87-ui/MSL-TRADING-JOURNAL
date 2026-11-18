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
import { Layout } from './components/Layout';
import { OfflineBanner } from './components/OfflineBanner';
import { TradeDetailModal } from './components/TradeDetailModal';
import { TradeModal } from './components/TradeModal';
import { useFirebase } from './context/FirebaseContext';
import { isAppLockEnabled, saveLockAccountName } from './lib/appLock';
import { createDefaultState, QUOTES, type QuoteItem } from './data/quotes';
import {
  formatR,
  generateId,
  getAllTradeTags,
  isoDate,
  localDateTime,
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
  cloudSaveModel,
  cloudSavePlaybook,
  cloudSaveProfile,
  cloudSaveTrade,
  ensureCloudWorkspace,
  mergeMissingLocalTradesToCloud,
  subscribeToCloudJournal,
  subscribeToCloudMemories,
} from './lib/cloudSync';
import {
  buildBackupPayload,
  clearAllJournalData,
  deleteTradeRecord,
  loadJournalState,
  saveFullJournalState,
  saveKV,
  saveTradeRecord,
} from './lib/db';
import { formatCloudErrorMessage } from './lib/firebase';
import { evaluateAlarmsAndQuotes, syncNativeAlarms } from './lib/notifications';
import { OverviewScreen } from './screens/OverviewScreen';
import type {
  AIAppAction,
  AIAppActionResult,
  AIMemoryCategory,
  AIMemoryItem,
  CustomField,
  Direction,
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
  TradingModel,
  UserProfile,
} from './types/journal';

// Lazy-load secondary screens for faster first paint & lighter memory footprint
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

  const existingTags = useMemo(
    () => getAllTradeTags(state.trades).map((t) => t.tag),
    [state.trades]
  );

  const {
    user,
    authReady,
    setCloudStatus,
    setCloudError,
    signInWithGoogle,
    signOutAccount,
  } = useFirebase();

  const toastTimerRef = useRef<number | null>(null);
  const lastAlarmKeyRef = useRef<string>('');
  const splashStartRef = useRef<number>(Date.now());
  const stateRef = useRef<JournalState>(state);
  stateRef.current = state;
  const memoriesRef = useRef<AIMemoryItem[]>(memories);
  memoriesRef.current = memories;
  const userRef = useRef(user);
  userRef.current = user;
  const mergedForSessionRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
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

  // Hydrate full journal state from IndexedDB on boot
  useEffect(() => {
    let active = true;
    loadJournalState()
      .then((loaded) => {
        if (!active) return;
        setState(loaded);
        syncNativeAlarms(loaded.alarms);
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

  // Warm up all lazy screen chunks immediately during splash so every tab switch is 0ms
  useEffect(() => {
    if (!hydrated) return;
    if (activePage === 'ai') setAiMounted(true);
  }, [activePage, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // Warm up /api/health connection & lazy screen chunks during splash so interactions hit warm connections
    void fetch('/api/health').catch(() => {});
    const timer = window.setTimeout(() => {
      void import('./screens/JournalScreen');
      void import('./screens/CalendarScreen');
      void import('./screens/ModelsScreen');
      void import('./screens/AnalyticsScreen');
      void import('./screens/PlaybookScreen');
      void import('./screens/AIScreen');
      void import('./screens/SettingsScreen');
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  // Attach real-time Cloud Firestore workspace & sync when authenticated + hydrated
  useEffect(() => {
    if (!hydrated || !authReady) return;
    if (!user) {
      mergedForSessionRef.current = null;
      setCloudStatus('local');
      setCloudError(null);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | null = null;
    let unsubMemories: (() => void) | null = null;
    let pushedLocalMemories = false;
    const preSyncSnapshot = stateRef.current;

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
              if (lastUid !== user.uid && preSyncSnapshot.trades.length > 0) {
                try {
                  const mergedCount = await mergeMissingLocalTradesToCloud(
                    user.uid,
                    preSyncSnapshot,
                    cloudState.trades
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

            setState(cloudState);
            syncNativeAlarms(cloudState.alarms);
            setCloudStatus('synced');
            setCloudError(null);
            void saveFullJournalState(cloudState).catch(() => {});
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
      if (unsub) unsub();
      if (unsubMemories) unsubMemories();
    };
  }, [hydrated, authReady, user, setCloudStatus, setCloudError, showToast]);

  // Two-part 6-second Liquid-Glass opening animation (0–3s Brand Reveal -> 3–6s Execution Mantra)
  useEffect(() => {
    const phaseTimer = window.setTimeout(() => {
      setSplashPhase(2);
    }, 3000);
    return () => window.clearTimeout(phaseTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, 6000 - elapsed);
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  // Background session alarms & quote reminder ticker
  useEffect(() => {
    if (!hydrated) return;

    const runCheck = async () => {
      const res = await evaluateAlarmsAndQuotes(
        state.alarms,
        state.settings,
        lastAlarmKeyRef.current
      );
      if (res.triggeredKey) {
        lastAlarmKeyRef.current = res.triggeredKey;
      }
      if (res.toastMessage) {
        showToast(res.toastMessage);
      }
      if (res.quote) {
        setQuote(res.quote);
      }
    };

    runCheck();
    const interval = window.setInterval(runCheck, 10000);
    const onFocusOrVisible = () => {
      if (!document.hidden) runCheck();
    };

    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [hydrated, state.alarms, state.settings, showToast]);

  const handleOpenNewTrade = useCallback((dateIso?: string) => {
    setEditingTrade(null);
    setDraftTemplate(null);
    setModalInitialDate(dateIso);
    setTradeModalOpen(true);
  }, []);

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
    await saveTradeRecord(trade);
    setState((prev) => ({
      ...prev,
      trades: [trade, ...prev.trades.filter((x) => x.id !== trade.id)],
    }));
    setTradeModalOpen(false);
    setEditingTrade(null);
    setDraftTemplate(null);

    if (user) {
      try {
        await cloudSaveTrade(user.uid, trade);
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

  // Execute MSL AI App Control Actions (syncs to state, IndexedDB, and Cloud Firestore)
  const handleExecuteAIActions = useCallback(
    async (actions: AIAppAction[]): Promise<AIAppActionResult[]> => {
      const results: AIAppActionResult[] = [];
      const activeUser = userRef.current;

      for (const action of actions) {
        try {
          if (action.name === 'navigate_app') {
            const target = String(action.args?.page || 'dashboard').toLowerCase() as PageId;
            if (VALID_PAGES.has(target)) {
              setActivePage(target);
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
            const nowIso = new Date().toISOString();
            const newTrade: Trade = {
              id: generateId(),
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
                Number.isFinite(Number(action.args.risk)) && Number(action.args.risk) > 0
                  ? Number(action.args.risk)
                  : 1,
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
            const label = `Logged ${newTrade.pair} ${newTrade.direction} (${formatR(newTrade.r)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`MSL AI: ${label}`);
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
            const label = `Updated ${updated.pair} (${formatR(updated.r)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`MSL AI: ${label}`);
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
            const label = `Deleted ${existing.pair} (${formatR(existing.r)})`;
            results.push({ name: action.name, label, ok: true });
            showToast(`MSL AI: ${label}`);
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
            showToast(`MSL AI: Saved model "${newModel.name}"`);
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
            showToast('MSL AI: Playbook updated.');
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
            showToast(`MSL AI: Alarm "${alarmName}" updated.`);
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
    [handleCycleQuote, handleOpenNewTrade, showToast]
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
    a.download = `MSL-Journal-v10.5.4-backup-${isoDate(new Date())}.json`;
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
      'R Multiple',
      'Risk (R)',
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
        formatR(t.r),
        String(t.risk ?? 1),
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
    await saveFullJournalState(restored);
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
    const fresh = await clearAllJournalData();
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
      {/* Refined 2-Part 6-Second Liquid-Glass Entry Animation (Auto-Completes at 6.0s) */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080d18]/98 backdrop-blur-2xl px-6 select-none overflow-hidden"
          >
            {/* Ambient Dual-Tone Radial Depth */}
            <motion.div
              initial={{ opacity: 0.25, scale: 0.9 }}
              animate={{ opacity: [0.25, 0.48, 0.3], scale: [0.9, 1.06, 1] }}
              transition={{ duration: 6, ease: 'easeInOut' }}
              className="pointer-events-none absolute h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(71,220,160,0.16)_0%,rgba(142,190,255,0.08)_50%,transparent_75%)] blur-2xl"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="relative liquid-glass rounded-3xl px-8 py-10 w-full max-w-[324px] text-center overflow-hidden"
            >
              {/* Soft Specular Sheen Sweep */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent splash-sheen" />

              <AnimatePresence mode="wait">
                {splashPhase === 1 ? (
                  <motion.div
                    key="splash-step-1"
                    initial={{ opacity: 0, y: 12, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -14, scale: 0.95 }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center gap-4"
                  >
                    <div className="relative flex items-center justify-center">
                      <motion.div
                        initial={{ rotate: -24, scale: 0.82, opacity: 0 }}
                        animate={{ rotate: 0, scale: 1, opacity: 1 }}
                        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute -inset-2 rounded-[22px] border border-[#47dca0]/25"
                      />
                      <motion.div
                        initial={{ scale: 0.86, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative h-16 w-16 rounded-2xl border border-white/25 bg-gradient-to-br from-[#234b50]/90 to-[#0c1b2c]/95 flex items-center justify-center font-display text-xl font-extrabold tracking-tight text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                      >
                        MSL
                      </motion.div>
                    </div>

                    <div className="w-full space-y-2">
                      <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="font-display text-2xl font-extrabold tracking-tight text-[#eef3fb]"
                      >
                        MSL Journal
                      </motion.p>
                      <motion.div
                        initial={{ scaleX: 0, opacity: 0 }}
                        animate={{ scaleX: 1, opacity: 1 }}
                        transition={{ duration: 0.65, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
                        className="mx-auto h-px w-24 bg-gradient-to-r from-transparent via-[#47dca0]/70 to-transparent origin-center"
                      />
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.55 }}
                        className="text-xs font-medium text-[#8b9ab0] tabular-nums"
                      >
                        Version 10.5.4
                      </motion.p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="splash-step-2"
                    initial={{ opacity: 0, y: 14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.03 }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="py-1.5 flex flex-col items-center gap-4"
                  >
                    <svg
                      viewBox="0 0 180 34"
                      className="w-44 h-8 overflow-visible"
                      aria-hidden="true"
                    >
                      <motion.path
                        d="M 4 26 Q 42 26, 66 18 T 118 14 T 176 4"
                        fill="none"
                        stroke="url(#splashCurveGrad)"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: 0.25 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                      />
                      <motion.circle
                        cx="176"
                        cy="4"
                        r="3.2"
                        fill="#8df0c0"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 1.35, 1], opacity: 1 }}
                        transition={{ duration: 0.45, delay: 0.95, ease: [0.16, 1, 0.3, 1] }}
                      />
                      <defs>
                        <linearGradient id="splashCurveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#8ebeff" stopOpacity="0.4" />
                          <stop offset="55%" stopColor="#47dca0" stopOpacity="0.95" />
                          <stop offset="100%" stopColor="#8df0c0" stopOpacity="1" />
                        </linearGradient>
                      </defs>
                    </svg>

                    <div className="space-y-1">
                      <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                        className="font-display text-xl font-extrabold tracking-tight text-[#eef3fb] leading-snug"
                      >
                        Read the market.
                      </motion.p>
                      <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.36, ease: [0.16, 1, 0.3, 1] }}
                        className="font-display text-xl font-extrabold tracking-tight text-[#47dca0] leading-snug"
                      >
                        Respect the plan.
                      </motion.p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Continuous 6.0s compositor hairline load progress */}
              <div className="mt-7 h-0.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-[#8ebeff] via-[#47dca0] to-[#8df0c0] splash-progress-fill" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4-Digit PIN Lock Gate Shown Right After Entry Animation */}
      <AnimatePresence>
        {!showSplash && isLocked && (
          <AppLockScreen
            accountName={accountDisplayName}
            accountLoaded={hydrated}
            onUnlock={() => setIsLocked(false)}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <Layout
          activePage={activePage}
          onNavigate={setActivePage}
          onOpenTradeModal={() => handleOpenNewTrade()}
          onCycleQuote={handleCycleQuote}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          displayName={state.profile.name}
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
                    journalState={state}
                    memories={memories}
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
                      trades={state.trades}
                      alarms={state.alarms}
                      quote={quote}
                      onNextQuote={handleCycleQuote}
                      onCopyQuote={handleCopyQuote}
                      onOpenLogTrade={() => handleOpenNewTrade()}
                      onNavigate={setActivePage}
                      onSelectTrade={(t) => setViewingTrade(t)}
                    />
                  )}

                  {activePage === 'journal' && (
                    <JournalScreen
                      trades={state.trades}
                      onOpenNewTrade={() => handleOpenNewTrade()}
                      onSelectTrade={(t) => setViewingTrade(t)}
                      onExportBackup={handleDownloadBackup}
                      onExportCSV={handleExportCSV}
                    />
                  )}

                  {activePage === 'calendar' && (
                    <CalendarScreen
                      trades={state.trades}
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
                      trades={state.trades}
                      onSelectTrade={(t) => setViewingTrade(t)}
                    />
                  )}

                  {activePage === 'playbook' && (
                    <PlaybookScreen
                      playbook={state.playbook}
                      onSavePlaybook={handleSavePlaybook}
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

      {/* Log / Edit Trade Modal */}
      <TradeModal
        open={tradeModalOpen}
        trade={editingTrade}
        draftTemplate={draftTemplate}
        initialDate={modalInitialDate}
        defaultMarket={state.profile.market}
        models={state.models}
        fields={state.fields}
        existingTags={existingTags}
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
            ? `Remove ${tradeToDelete.pair} (${formatR(tradeToDelete.r)}) and its attached screenshots from this device?`
            : ''
        }
        confirmLabel="Delete trade"
        onConfirm={handleConfirmDeleteTrade}
        onCancel={() => setTradeToDelete(null)}
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
