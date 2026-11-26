import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Layers,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Quote,
  RefreshCw,
  ScrollText,
  Settings,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFirebase } from '../context/FirebaseContext';
import { prewarmAIConnection } from '../lib/aiClient';
import { formatMetric, isRCurrency, type JournalSummary } from '../lib/calculations';
import type { PageId, TradingJournal } from '../types/journal';
import { PWAInstallButton } from './PWAInstallButton';

interface LayoutProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onOpenTradeModal: () => void;
  onCycleQuote: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  displayName?: string;
  journals: TradingJournal[];
  activeJournal: TradingJournal | null;
  journalSummaries?: Map<string, JournalSummary>;
  onSelectJournal: (journalId: string) => void;
  onCreateJournal: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: {
  id: PageId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { id: 'journals', label: 'Accounts', shortLabel: 'Accounts', icon: Wallet },
  { id: 'journal', label: 'Journal', shortLabel: 'Journal', icon: ScrollText },
  { id: 'calendar', label: 'Calendar', shortLabel: 'Calendar', icon: CalendarDays },
  { id: 'models', label: 'Models & fields', shortLabel: 'Models', icon: Layers },
  { id: 'analytics', label: 'Analytics', shortLabel: 'Analytics', icon: BarChart3 },
  { id: 'playbook', label: 'Playbook', shortLabel: 'Playbook', icon: BookOpen },
  { id: 'ai', label: 'KAIROS', shortLabel: 'KAIROS', icon: Bot },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const MOBILE_PRIMARY_TABS: PageId[] = ['dashboard', 'journals', 'journal', 'ai'];
const MOBILE_DRAWER_TABS: PageId[] = ['calendar', 'analytics', 'playbook', 'models', 'settings'];

export const Layout: React.FC<LayoutProps> = ({
  activePage,
  onNavigate,
  onOpenTradeModal,
  onCycleQuote,
  onSignIn,
  onSignOut,
  displayName,
  journals,
  activeJournal,
  journalSummaries,
  onSelectJournal,
  onCreateJournal,
  children,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [journalMenuOpen, setJournalMenuOpen] = useState(false);
  const journalMenuRef = useRef<HTMLDivElement | null>(null);
  const { user, authBusy, cloudStatus, isSyncing } = useFirebase();
  const syncActive = isSyncing || cloudStatus === 'connecting';
  const isMoreActive = MOBILE_DRAWER_TABS.includes(activePage);

  useEffect(() => {
    if (!journalMenuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (journalMenuRef.current && !journalMenuRef.current.contains(e.target as Node)) {
        setJournalMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setJournalMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [journalMenuOpen]);

  const handleSelectPage = (page: PageId) => {
    onNavigate(page);
    setMoreOpen(false);
    setJournalMenuOpen(false);
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  return (
    <div className="min-h-dvh flex flex-col text-[#eef3fb]">
      {/* Sticky Top Navigation Header */}
      <header className="sticky top-0 z-30 pt-safe glass-bar border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Left: Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => handleSelectPage('dashboard')}
              className="flex items-center gap-2.5 text-left min-w-0 group"
            >
              <span className="h-9 w-9 shrink-0 rounded-xl border border-white/20 bg-gradient-to-br from-[#235458]/95 to-[#0a1829]/95 flex items-center justify-center font-display text-xs font-extrabold tracking-tight text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
                MSL
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm sm:text-base font-extrabold tracking-tight text-[#eef3fb] whitespace-nowrap">
                  MSL Journal
                </span>
                <span className="block text-[10px] sm:text-[11px] font-medium text-[#7f8fa8] truncate tabular-nums">
                  {displayName ? `${displayName} · Version 11.0.0` : 'Version 11.0.0'}
                </span>
              </span>
            </button>
          </div>

          {/* Center: Desktop Primary Navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden xl:flex items-center gap-1 rounded-2xl bg-white/[0.035] border border-white/[0.08] p-1"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectPage(item.id)}
                  onMouseEnter={item.id === 'ai' ? prewarmAIConnection : undefined}
                  onFocus={item.id === 'ai' ? prewarmAIConnection : undefined}
                  className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                    active
                      ? 'bg-[#47dca0]/18 text-[#8df0c0] border border-[#47dca0]/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                      : 'text-[#9aa8be] hover:text-[#eef3fb] hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: Quick Switch Journal, Sync, PWA, Quote, Log Trade */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Switch Journal Dropdown */}
            <div ref={journalMenuRef} className="relative">
              {journals.length === 0 ? (
                <button
                  type="button"
                  onClick={onCreateJournal}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#47dca0]/40 px-3 py-1.5 text-xs font-semibold text-[#8df0c0] hover:bg-[#47dca0]/15 transition whitespace-nowrap"
                >
                  <BookMarked className="w-3.5 h-3.5 shrink-0" />
                  <span>Create journal</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setJournalMenuOpen((v) => !v)}
                    aria-expanded={journalMenuOpen}
                    aria-haspopup="listbox"
                    aria-label="Switch active journal"
                    className={`min-h-[40px] max-w-[148px] sm:max-w-[210px] inline-flex items-center gap-2 rounded-xl border px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition ${
                      journalMenuOpen
                        ? 'bg-[#17263f] border-[#47dca0]/50 text-[#eef3fb]'
                        : 'bg-[#111c2d] border-[#23344f] text-[#dce5f4] hover:border-[#47dca0]/45'
                    }`}
                  >
                    <BookMarked className="w-3.5 h-3.5 text-[#47dca0] shrink-0" />
                    <span className="truncate">{activeJournal?.name || 'Switch journal'}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#8b9ab0] shrink-0 transition-transform duration-150 ${
                        journalMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <AnimatePresence>
                    {journalMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        role="listbox"
                        aria-label="Trading journals"
                        className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl glass-modal p-2 z-50"
                      >
                        <div className="px-2.5 py-2 flex items-center justify-between border-b border-white/[0.08]">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b9ab0]">
                            Switch journal ({journals.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setJournalMenuOpen(false);
                              onCreateJournal();
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:underline"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>New</span>
                          </button>
                        </div>

                        <div className="mt-1.5 max-h-64 overflow-y-auto space-y-1">
                          {journals.map((j) => {
                            const isActive = j.id === activeJournal?.id;
                            const summary = journalSummaries?.get(j.id);
                            const curr = j.currency || 'R';
                            const isRMode = summary
                              ? summary.isRMode
                              : isRCurrency(curr) && j.startingBalance <= 0;
                            const equityVal = summary ? summary.currentEquity : j.startingBalance;
                            return (
                              <button
                                key={j.id}
                                type="button"
                                role="option"
                                aria-selected={isActive}
                                onClick={() => {
                                  onSelectJournal(j.id);
                                  setJournalMenuOpen(false);
                                }}
                                className={`w-full min-h-[46px] flex items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left transition ${
                                  isActive
                                    ? 'bg-[#47dca0]/15 border border-[#47dca0]/40 text-[#eef3fb]'
                                    : 'border border-transparent hover:bg-white/[0.06] text-[#cbd5e1]'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold truncate">{j.name}</span>
                                    {j.propFirm && (
                                      <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-[#9fb2ca] truncate shrink-0">
                                        {j.propFirm}
                                      </span>
                                    )}
                                    {summary && summary.target > 0 && (
                                      <span
                                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold shrink-0 tabular-nums ${
                                          summary.targetHit
                                            ? 'bg-[#47dca0]/20 text-[#8df0c0]'
                                            : 'bg-[#8ebeff]/15 text-[#b9d6ff]'
                                        }`}
                                      >
                                        {summary.targetHit
                                          ? 'Target hit'
                                          : `${Math.round(summary.targetProgressPct ?? 0)}%`}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 font-mono text-[11px] text-[#8b9ab0] tabular-nums truncate">
                                    {isRMode
                                      ? `R-Mode · Net ${formatMetric(summary?.nativeNetPnL ?? 0, 'r', 'R')}`
                                      : formatMetric(equityVal, 'money', curr, {
                                          signed: false,
                                          decimals: equityVal % 1 === 0 ? 0 : 2,
                                        })}
                                    {summary ? ` · ${summary.tradesCount} trades` : ''}
                                  </p>
                                </div>
                                {isActive && (
                                  <Check className="w-4 h-4 text-[#47dca0] shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-1.5 pt-1.5 border-t border-white/[0.08] grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setJournalMenuOpen(false);
                              onCreateJournal();
                            }}
                            className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1.5 text-xs font-semibold text-[#8df0c0] transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>New journal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectPage('journals')}
                            className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1.5 text-xs font-semibold text-[#b9d6ff] transition"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            <span>All accounts</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>

            {/* Desktop Cloud Sync & Auth */}
            <div className="hidden md:flex items-center gap-1.5">
              <PWAInstallButton variant="compact" />

              <button
                type="button"
                onClick={onCycleQuote}
                title="Next trading discipline quote"
                aria-label="Next trading discipline quote"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-[#111c2d] border border-[#23344f] text-[#8b9ab0] hover:text-[#8df0c0] hover:border-[#47dca0]/45 transition"
              >
                <Quote className="w-4 h-4" />
              </button>

              {user ? (
                <button
                  type="button"
                  onClick={() => handleSelectPage('settings')}
                  aria-busy={syncActive}
                  title={
                    syncActive
                      ? 'Cloud Sync in progress…'
                      : cloudStatus === 'error'
                      ? 'Cloud Sync issue'
                      : `Cloud Sync · Synced (${user.email || 'Google Account'})`
                  }
                  className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold text-[#eef3fb] transition ${
                    syncActive
                      ? 'bg-[#47dca0]/10 border-[#47dca0]/45 shadow-[0_0_16px_-6px_rgba(71,220,160,0.45)]'
                      : 'bg-[#111c2d] border-[#23344f] hover:border-[#47dca0]/45'
                  }`}
                >
                  {syncActive ? (
                    <span className="inline-flex items-center gap-1">
                      <Cloud className="w-3.5 h-3.5 text-[#47dca0]" />
                      <Loader2
                        className="w-3 h-3 text-[#8df0c0] animate-spin motion-reduce:animate-none"
                        style={{ animationDuration: '1.2s' }}
                        aria-hidden="true"
                      />
                    </span>
                  ) : cloudStatus === 'error' ? (
                    <CloudOff className="w-3.5 h-3.5 text-[#ff7d91]" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-[#47dca0]" />
                  )}
                  <span className="hidden lg:inline">
                    {syncActive
                      ? 'Syncing…'
                      : cloudStatus === 'error'
                      ? 'Offline'
                      : 'Cloud Sync'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={authBusy}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3 py-1.5 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 disabled:opacity-50 transition whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#47dca0]" />
                  <span>{authBusy ? 'Signing in…' : 'Sign in'}</span>
                </button>
              )}
            </div>

            {/* Primary Log Trade Action */}
            <button
              type="button"
              onClick={onOpenTradeModal}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Log trade</span>
              <span className="sm:hidden">Log</span>
            </button>
          </div>
        </div>

        {/* Tablet Secondary Row Navigation (md–lg where full xl row doesn't fit) */}
        <div className="hidden md:flex xl:hidden border-t border-white/[0.06] px-4 sm:px-6 py-1.5 overflow-x-auto gap-1.5 max-w-7xl mx-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectPage(item.id)}
                onMouseEnter={item.id === 'ai' ? prewarmAIConnection : undefined}
                className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#47dca0]/18 text-[#8df0c0] border border-[#47dca0]/35'
                    : 'text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.05] border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 pt-5 sm:pt-7 pb-nav-safe md:pb-12">
        {children}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 glass-bar border-t border-white/[0.08] pb-safe"
      >
        <div className="grid grid-cols-5 h-16 max-w-lg mx-auto px-1">
          {MOBILE_PRIMARY_TABS.map((tabId) => {
            const item = NAV_ITEMS.find((x) => x.id === tabId)!;
            const Icon = item.icon;
            const active = activePage === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => handleSelectPage(tabId)}
                onTouchStart={tabId === 'ai' ? prewarmAIConnection : undefined}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition ${
                  active ? 'text-[#8df0c0]' : 'text-[#7f8fa8] hover:text-[#eef3fb]'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition ${
              isMoreActive || moreOpen ? 'text-[#8df0c0]' : 'text-[#7f8fa8] hover:text-[#eef3fb]'
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile More Drawer */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="md:hidden fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="More workspace tools"
              initial={{ y: 36, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 28, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-h-[85dvh] overflow-y-auto rounded-t-3xl glass-modal px-5 pt-3 pb-safe"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div>
                  <p className="font-display text-sm font-bold text-[#eef3fb]">Workspace menu</p>
                  <p className="text-xs text-[#8b9ab0]">Calendar, analytics, playbook, models &amp; settings</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Close menu"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="py-3 space-y-1.5">
                {MOBILE_DRAWER_TABS.map((tabId) => {
                  const item = NAV_ITEMS.find((x) => x.id === tabId)!;
                  const Icon = item.icon;
                  const active = activePage === tabId;
                  return (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => handleSelectPage(tabId)}
                      className={`w-full min-h-[48px] flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                        active
                          ? 'bg-[#47dca0]/15 border border-[#47dca0]/40 text-[#8df0c0]'
                          : 'bg-white/[0.03] border border-white/[0.08] text-[#dce5f4] hover:bg-white/[0.06]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="py-3 border-t border-white/[0.08] space-y-2.5">
                <PWAInstallButton variant="full" onInstalled={() => setMoreOpen(false)} />

                {user ? (
                  <div className="rounded-xl glass-subcard p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#eef3fb] truncate">
                        {user.displayName || user.email || 'Google Account'}
                      </p>
                      <p className="text-[11px] text-[#8b9ab0]">
                        {syncActive
                          ? 'Syncing Cloud Firestore…'
                          : cloudStatus === 'error'
                          ? 'Cloud sync issue'
                          : 'Cloud Firestore synced'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        onSignOut();
                      }}
                      disabled={authBusy}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#ff7d91]/35 bg-[#ff7d91]/10 px-3 py-1.5 text-xs font-semibold text-[#ff7d91]"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onSignIn();
                    }}
                    disabled={authBusy}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-[#eef3fb]"
                  >
                    <LogIn className="w-4 h-4 text-[#47dca0]" />
                    <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
