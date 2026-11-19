import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  Cloud,
  CloudOff,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFirebase } from '../context/FirebaseContext';
import { prewarmAIConnection } from '../lib/aiClient';
import type { PageId } from '../types/journal';
import { PWAInstallButton } from './PWAInstallButton';

interface LayoutProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onOpenTradeModal: () => void;
  onCycleQuote: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  displayName?: string;
  children: React.ReactNode;
}

const PAGE_META: Record<PageId, { label: string; headline: string }> = {
  dashboard: {
    label: 'Overview',
    headline: 'Good trading starts with a clear plan.',
  },
  journal: {
    label: 'Trade journal',
    headline: 'Every execution tells a story.',
  },
  calendar: {
    label: 'Calendar',
    headline: 'Build consistency, one day at a time.',
  },
  models: {
    label: 'Models & fields',
    headline: 'Define your framework. Customize your data.',
  },
  analytics: {
    label: 'Analytics',
    headline: 'Review the evidence behind your edge.',
  },
  playbook: {
    label: 'Playbook',
    headline: 'Your rules before the market moves.',
  },
  ai: {
    label: 'KAIROS',
    headline: 'Think clearly. Audit your edge.',
  },
  settings: {
    label: 'Settings',
    headline: 'Make this workspace work for you.',
  },
};

const ALL_NAV_ITEMS: { id: PageId; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { id: 'journal', label: 'Trade journal', shortLabel: 'Journal', icon: ScrollText },
  { id: 'calendar', label: 'Calendar', shortLabel: 'Calendar', icon: CalendarDays },
  { id: 'ai', label: 'KAIROS', shortLabel: 'KAIROS', icon: Bot },
  { id: 'analytics', label: 'Analytics', shortLabel: 'Analytics', icon: BarChart3 },
  { id: 'models', label: 'Models & fields', shortLabel: 'Models', icon: Layers },
  { id: 'playbook', label: 'Playbook', shortLabel: 'Playbook', icon: BookOpen },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const MOBILE_PRIMARY_TABS: PageId[] = ['dashboard', 'journal', 'calendar', 'ai'];
const MOBILE_DRAWER_TABS: PageId[] = ['analytics', 'models', 'playbook', 'settings'];

export const Layout: React.FC<LayoutProps> = ({
  activePage,
  onNavigate,
  onOpenTradeModal,
  onCycleQuote,
  onSignIn,
  onSignOut,
  displayName,
  children,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, authBusy, cloudStatus } = useFirebase();
  const meta = PAGE_META[activePage];
  const isMoreActive = MOBILE_DRAWER_TABS.includes(activePage);

  const handleSelectPage = (page: PageId) => {
    onNavigate(page);
    setDrawerOpen(false);
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  return (
    <div className="min-h-dvh text-[#eef3fb]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col glass-bar border-r border-white/[0.08] px-4 py-6 z-30">
        <button
          type="button"
          onClick={() => handleSelectPage('dashboard')}
          className="flex items-center gap-3 px-2 pb-7 text-left group"
        >
          <span className="h-10 w-10 shrink-0 rounded-xl border border-white/15 bg-gradient-to-br from-[#1d3e42]/80 to-[#0d1d2d]/80 backdrop-blur-md flex items-center justify-center font-display text-xs font-extrabold tracking-tight text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
            MSL
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-extrabold tracking-tight text-[#eef3fb] whitespace-nowrap">
              MSL Journal
            </span>
            <span className="block text-[11px] text-[#8b9ab0] truncate tabular-nums">
              {displayName ? `${displayName} · Version 10.5.4` : 'Version 10.5.4'}
            </span>
          </span>
        </button>

        <div className="px-2.5 pb-2 text-xs font-medium text-[#7c8ca6]">
          Workspace
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Primary navigation">
          {ALL_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectPage(item.id)}
                onMouseEnter={item.id === 'ai' ? prewarmAIConnection : undefined}
                onFocus={item.id === 'ai' ? prewarmAIConnection : undefined}
                className={`w-full min-h-[44px] flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
                  active
                    ? 'bg-white/[0.09] text-[#8df0c0] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                    : 'text-[#9aa8be] hover:bg-white/[0.05] hover:text-[#eef3fb] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#47dca0]' : 'text-[#6c7d96]'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-4 pt-4 border-t border-white/[0.08] space-y-3">
          <PWAInstallButton variant="full" />
          {user ? (
            <div className="pt-3 border-t border-white/[0.08] flex items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Trader avatar'}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-lg object-cover border border-white/15 shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-[#47dca0]/20 border border-[#47dca0]/35 flex items-center justify-center text-xs font-bold text-[#8df0c0] shrink-0">
                  {(user.displayName || user.email || 'T').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#eef3fb] truncate">
                  {user.displayName || 'Google Account'}
                </p>
                <p className="flex items-center gap-1 text-[11px] text-[#8df0c0] truncate">
                  {cloudStatus === 'connecting' ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                      <span>Syncing…</span>
                    </>
                  ) : cloudStatus === 'error' ? (
                    <>
                      <CloudOff className="w-3 h-3 text-[#ff7d91] shrink-0" />
                      <span className="text-[#ff7d91]">Sync paused</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="w-3 h-3 shrink-0" />
                      <span>Cloud synced</span>
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                disabled={authBusy}
                title="Sign out"
                aria-label="Sign out"
                className="h-9 w-9 flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#ff7d91] hover:bg-white/[0.06] transition shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="pt-3 border-t border-white/[0.08] space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#c9d4e7]">
                <CloudOff className="w-4 h-4 text-[#8ebeff] shrink-0" />
                <span>Local device mode</span>
              </div>
              <p className="text-xs leading-relaxed text-[#7e8ea6]">
                Sign in with Google to sync trades and screenshots privately across devices.
              </p>
              <button
                type="button"
                onClick={onSignIn}
                disabled={authBusy}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#47dca0]/15 border border-[#47dca0]/35 px-3 py-2 text-xs font-semibold text-[#8df0c0] hover:bg-[#47dca0]/25 disabled:opacity-50 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{authBusy ? 'Connecting…' : 'Sign in with Google'}</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="lg:pl-64 flex flex-col min-h-dvh">
        {/* Compact Sticky Top Header (Mobile <= 52px + safe area; Desktop clean 3-zone) */}
        <header className="sticky top-0 z-20 pt-safe glass-bar border-b border-white/[0.08]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-13 sm:h-16 flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleSelectPage('dashboard')}
                className="lg:hidden h-8 w-8 shrink-0 rounded-lg border border-white/15 bg-gradient-to-br from-[#1d3e42]/80 to-[#0d1d2d]/80 flex items-center justify-center font-display text-[10px] font-extrabold text-[#8df0c0]"
                aria-label="Go to Overview"
              >
                MSL
              </button>
              <div className="min-w-0">
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#7f8fa8]">
                  <span>MSL Journal</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-[#c5d1e4] font-medium">{meta.label}</span>
                </div>
                <h1 className="text-sm sm:text-lg font-bold tracking-tight text-[#eef3fb] truncate">
                  <span className="sm:hidden">{meta.label}</span>
                  <span className="hidden sm:inline">{meta.headline}</span>
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:block">
                <PWAInstallButton variant="compact" />
              </div>
              <button
                type="button"
                onClick={() => handleSelectPage('settings')}
                title={
                  user
                    ? `Signed in as ${user.displayName || user.email || 'Trader'}`
                    : 'Sign in for cloud sync'
                }
                aria-label={user ? 'Cloud sync status' : 'Sign in for cloud sync'}
                className="min-h-[40px] flex items-center gap-1.5 rounded-xl glass-subcard px-2.5 py-1.5 text-xs font-semibold text-[#c9d4e7] hover:border-[#47dca0]/45 transition shrink-0"
              >
                {user ? (
                  <>
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'Trader'}
                        referrerPolicy="no-referrer"
                        className="h-5 w-5 rounded-md object-cover border border-white/15"
                      />
                    ) : (
                      <Cloud className="w-4 h-4 text-[#47dca0]" />
                    )}
                    <span className="hidden md:inline text-[#8df0c0]">
                      {cloudStatus === 'connecting' ? 'Syncing…' : 'Synced'}
                    </span>
                  </>
                ) : (
                  <>
                    <CloudOff className="w-4 h-4 text-[#8ebeff]" />
                    <span className="hidden md:inline">Local</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onCycleQuote}
                title="Another motivational quote"
                aria-label="Cycle motivational quote"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl glass-subcard text-[#8df0c0] hover:border-[#47dca0]/45 hover:bg-white/[0.08] transition"
              >
                <Sparkles className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onOpenTradeModal}
                className="min-h-[40px] flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Log trade</span>
              </button>
            </div>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-nav-safe lg:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (Natural Thumb Zone) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass-bar border-t border-white/[0.1] pb-safe"
      >
        <div className="grid grid-cols-5 h-14 max-w-lg mx-auto px-1">
          {MOBILE_PRIMARY_TABS.map((tabId) => {
            const item = ALL_NAV_ITEMS.find((x) => x.id === tabId)!;
            const Icon = item.icon;
            const active = activePage === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => handleSelectPage(tabId)}
                onTouchStart={tabId === 'ai' ? prewarmAIConnection : undefined}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#8df0c0]' : 'text-[#7f8fa8] hover:text-[#eef3fb]'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-[#47dca0]' : ''}`} />
                <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isMoreActive || drawerOpen ? 'text-[#8df0c0]' : 'text-[#7f8fa8] hover:text-[#eef3fb]'
            }`}
          >
            <Menu className={`w-5 h-5 ${isMoreActive || drawerOpen ? 'text-[#47dca0]' : ''}`} />
            <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" Bottom Sheet Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-md"
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Workspace menu"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 32, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full rounded-t-3xl glass-modal px-5 pt-3 pb-safe"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div>
                  <p className="font-display text-sm font-bold text-[#eef3fb]">MSL Workspace</p>
                  <p className="text-xs text-[#8b9ab0]">Read the market. Respect the plan.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="py-3 space-y-1.5">
                {MOBILE_DRAWER_TABS.map((tabId) => {
                  const item = ALL_NAV_ITEMS.find((x) => x.id === tabId)!;
                  const Icon = item.icon;
                  const active = activePage === tabId;
                  return (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => handleSelectPage(tabId)}
                      className={`w-full min-h-[48px] flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                        active
                          ? 'bg-white/[0.1] text-[#8df0c0] border border-white/[0.14]'
                          : 'glass-subcard text-[#d5dfef] hover:bg-white/[0.07]'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? 'text-[#47dca0]' : 'text-[#8b9ab0]'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 pb-5 space-y-3">
                {user ? (
                  <div className="rounded-xl glass-subcard p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#eef3fb] truncate">
                        {user.displayName || user.email || 'Google Account'}
                      </p>
                      <p className="text-[11px] text-[#8df0c0]">
                        {cloudStatus === 'connecting' ? 'Syncing cloud vault…' : 'Cloud Firestore synced'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen(false);
                        onSignOut();
                      }}
                      disabled={authBusy}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.14] px-3 py-1.5 text-xs font-semibold text-[#c9d4e7]"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onSignIn();
                    }}
                    disabled={authBusy}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0]/15 border border-[#47dca0]/35 px-4 py-2.5 text-sm font-semibold text-[#8df0c0]"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{authBusy ? 'Connecting…' : 'Sign in with Google for Cloud Sync'}</span>
                  </button>
                )}
                <PWAInstallButton variant="full" onInstalled={() => setDrawerOpen(false)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
