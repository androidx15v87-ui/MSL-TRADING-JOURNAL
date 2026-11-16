import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ConfirmModal } from './components/ConfirmModal';
import { Layout } from './components/Layout';
import { OfflineBanner } from './components/OfflineBanner';
import { TradeDetailModal } from './components/TradeDetailModal';
import { TradeModal } from './components/TradeModal';
import { useFirebase } from './context/FirebaseContext';
import { createDefaultState, QUOTES, type QuoteItem } from './data/quotes';
import { formatR, getAllTradeTags, isoDate } from './lib/calculations';
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
import { AIScreen } from './screens/AIScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { JournalScreen } from './screens/JournalScreen';
import { ModelsScreen } from './screens/ModelsScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PlaybookScreen } from './screens/PlaybookScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import type {
  CustomField,
  JournalSettings,
  JournalState,
  PageId,
  Playbook,
  SessionAlarm,
  Trade,
  TradingModel,
  UserProfile,
} from './types/journal';

const LAST_SYNCED_UID_KEY = 'msl_v10_last_uid';

function randomQuote(exclude?: QuoteItem): QuoteItem {
  if (QUOTES.length <= 1) return QUOTES[0];
  let pick = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  if (exclude && pick.text === exclude.text) {
    pick = QUOTES[(QUOTES.indexOf(pick) + 1) % QUOTES.length];
  }
  return pick;
}

export default function App() {
  const [state, setState] = useState<JournalState>(() => createDefaultState());
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
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

  // App opening splash timer (3-second liquid-glass entrance animation)
  useEffect(() => {
    if (!hydrated) return;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, 3000 - elapsed);
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

  const handleOpenNewTrade = (dateIso?: string) => {
    setEditingTrade(null);
    setDraftTemplate(null);
    setModalInitialDate(dateIso);
    setTradeModalOpen(true);
  };

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

  const handleDownloadBackup = () => {
    const payload = buildBackupPayload(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MSL-Journal-V10-backup-${isoDate(new Date())}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Full backup downloaded.');
  };

  const handleExportCSV = (filteredTrades: Trade[]) => {
    const headers = ['Date', 'Symbol', 'Side', 'Setup', 'Session', 'Outcome', 'R Multiple', 'Risk (R)', 'Model', 'Tags', 'Notes'];
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

  const handleCycleQuote = () => {
    setQuote((prev) => randomQuote(prev));
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
      {/* Liquid Glass App Entry Splash (3 seconds) */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#080d18]/94 backdrop-blur-2xl px-6 select-none"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card rounded-3xl px-8 py-8 flex flex-col items-center text-center max-w-xs w-full"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.65, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="h-16 w-16 rounded-2xl border border-white/20 bg-gradient-to-br from-[#1d3e42]/80 to-[#0d1d2d]/80 flex items-center justify-center font-display text-lg font-extrabold tracking-tight text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
              >
                MSL
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="mt-4 font-display text-xl font-extrabold tracking-tight text-[#eef3fb]"
              >
                MSL Journal <span className="text-[#47dca0]">✦</span>
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.55, delay: 0.55 }}
                className="mt-1 text-[11px] font-semibold tracking-[0.18em] text-[#8b9ab0] uppercase"
              >
                V10 Premium
              </motion.p>
              <div className="mt-5 h-1.5 w-40 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-[#47dca0] via-[#8df0c0] to-[#8ebeff] animate-splash-bar" />
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.8 }}
                className="mt-3.5 text-xs text-[#8b9ab0]"
              >
                Read the market. Respect the plan.
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
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
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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

                {activePage === 'ai' && <AIScreen journalState={state} />}

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
            </AnimatePresence>
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
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-16 sm:top-5 right-4 z-[70] max-w-xs sm:max-w-sm rounded-xl glass-modal border-[#47dca0]/40 px-4 py-2.5 text-xs sm:text-sm font-medium text-[#eef3fb]"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
