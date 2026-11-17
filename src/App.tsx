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
import { ConfirmModal } from './components/ConfirmModal';
import { Layout } from './components/Layout';
import { OfflineBanner } from './components/OfflineBanner';
import { TradeDetailModal } from './components/TradeDetailModal';
import { TradeModal } from './components/TradeModal';
import { useFirebase } from './context/FirebaseContext';
import { createDefaultState, QUOTES, type QuoteItem } from './data/quotes';
import {
  formatR,
  generateId,
  getAllTradeTags,
  isoDate,
  localDateTime,
} from './lib/calculations';
import {
  cloudDeleteField,
  cloudDeleteModel,
  cloudDeleteTrade,
  cloudReplaceFullJournal,
  cloudSaveAlarmsAndSettings,
  cloudSaveField,
  cloudSaveModel,
  cloudSavePlaybook,
  cloudSaveProfile,
  cloudSaveTrade,
  ensureCloudWorkspace,
  mergeMissingLocalTradesToCloud,
  subscribeToCloudJournal,
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
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [aiMounted, setAiMounted] = useState(false);
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
    const timer = window.setTimeout(() => {
      void import('./screens/JournalScreen');
      void import('./screens/CalendarScreen');
      void import('./screens/ModelsScreen');
      void import('./screens/AnalyticsScreen');
      void import('./screens/PlaybookScreen');
      void import('./screens/AIScreen');
      void import('./screens/SettingsScreen');
    }, 120);
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
    };
  }, [hydrated, authReady, user, setCloudStatus, setCloudError, showToast]);

  // App opening double animation (5 seconds total: 0-2.4s Orbital Crest -> 2.4-5.0s Edge Readiness)
  useEffect(() => {
    const phaseTimer = window.setTimeout(() => {
      setSplashPhase(2);
    }, 2400);
    return () => window.clearTimeout(phaseTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, 5000 - elapsed);
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

  const handleDownloadBackup = () => {
    const payload = buildBackupPayload(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MSL-Journal-v10.2.1-backup-${isoDate(new Date())}.json`;
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
      {/* 5-Second Liquid-Glass Double Opening Animation */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#080d18]/96 backdrop-blur-2xl px-6 select-none overflow-hidden"
          >
            {/* Ambient radial glow */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-72 w-72 rounded-full bg-[#47dca0]/12 blur-3xl" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="relative glass-card rounded-3xl px-8 py-8 flex flex-col items-center text-center max-w-xs w-full overflow-hidden"
            >
              <AnimatePresence mode="wait">
                {splashPhase === 1 ? (
                  <motion.div
                    key="splash-phase-1"
                    initial={{ opacity: 0, y: 12, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -14, scale: 0.94 }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center"
                  >
                    {/* Orbital double-ring crest */}
                    <div className="relative h-20 w-20 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border border-[#47dca0]/35 border-t-[#8df0c0] animate-orbit-slow" />
                      <div className="absolute inset-1.5 rounded-full border border-[#8ebeff]/25 border-b-[#8ebeff] animate-orbit-reverse" />
                      <div className="h-14 w-14 rounded-2xl border border-white/25 bg-gradient-to-br from-[#1d3e42]/90 to-[#0d1d2d]/90 flex items-center justify-center font-display text-lg font-extrabold tracking-tight text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
                        MSL
                      </div>
                    </div>

                    <p className="mt-4 font-display text-xl font-extrabold tracking-tight text-[#eef3fb]">
                      MSL Journal <span className="text-[#47dca0]">✦</span>
                    </p>
                    <p className="mt-1 text-[11px] font-semibold tracking-[0.2em] text-[#8b9ab0] uppercase">
                      Version 10.2.1
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="splash-phase-2"
                    initial={{ opacity: 0, y: 14, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.03 }}
                    transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center"
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#47dca0]/15 border border-[#47dca0]/40 px-3 py-1 text-[11px] font-bold tracking-wider text-[#8df0c0] uppercase">
                      Edge &amp; Execution Ready
                    </span>

                    <p className="mt-4 font-display text-lg font-extrabold tracking-tight text-[#eef3fb]">
                      Read the market.
                      <br />
                      <span className="text-[#47dca0]">Respect the plan.</span>
                    </p>

                    <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-[#9aa8be]">
                      <span className="rounded-lg bg-white/[0.06] border border-white/[0.08] px-2.5 py-1">
                        {state.trades.length} Trades
                      </span>
                      <span className="rounded-lg bg-white/[0.06] border border-white/[0.08] px-2.5 py-1">
                        {user ? 'Cloud Sync' : 'Local Vault'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Unified 5-second liquid-glass progress bar */}
              <div className="mt-6 h-1.5 w-44 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-[#47dca0] via-[#8df0c0] to-[#8ebeff] animate-splash-bar" />
              </div>
              <p className="mt-2.5 text-[11px] font-medium text-[#7c8ca3]">
                {splashPhase === 1 ? 'Initializing workspace…' : 'Syncing your trading edge…'}
              </p>
            </motion.div>
          </motion.div>
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
