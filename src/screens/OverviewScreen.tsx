import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookMarked,
  Bot,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { QuoteItem } from '../data/quotes';
import {
  calculateMonthlyPnL,
  calculateStats,
  formatDate,
  formatMetric,
  formatTradePnL,
  getUnitLongLabel,
  getUnitShortLabel,
  isRJournal,
  type JournalSummary,
  type MonthlyPnLPoint,
} from '../lib/calculations';
import type {
  JournalSettings,
  MetricUnit,
  PageId,
  SessionAlarm,
  Trade,
  TradingJournal,
} from '../types/journal';

interface OverviewScreenProps {
  journals: TradingJournal[];
  activeJournal: TradingJournal | null;
  journalSummaries: JournalSummary[];
  trades: Trade[];
  alarms: SessionAlarm[];
  settings?: JournalSettings;
  quote: QuoteItem;
  onNextQuote: () => void;
  onCopyQuote: () => void;
  onOpenLogTrade: () => void;
  onSelectJournal: (journalId: string) => void;
  onCreateJournal: () => void;
  onEditJournal: (journal: TradingJournal) => void;
  onDeleteJournal: (journal: TradingJournal) => void;
  onNavigate: (page: PageId) => void;
  onSelectTrade: (trade: Trade) => void;
  entranceReady?: boolean;
}

const STAT_CONTAINER_VARIANTS: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

const STAT_CARD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.34,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

export const OverviewScreen: React.FC<OverviewScreenProps> = React.memo(
  ({
    journals,
    activeJournal,
    journalSummaries,
    trades,
    alarms,
    settings,
    quote,
    onNextQuote,
    onCopyQuote,
    onOpenLogTrade,
    onSelectJournal,
    onCreateJournal,
    onEditJournal,
    onDeleteJournal,
    onNavigate,
    onSelectTrade,
    entranceReady = true,
  }) => {
    const [selectedUnit, setSelectedUnit] = useState<MetricUnit | undefined>(undefined);
    const shouldReduceMotion = useReducedMotion();

    const activeIsRMode = isRJournal(activeJournal);

    const activeSummary = useMemo(
      () =>
        activeJournal
          ? journalSummaries.find((s) => s.journal.id === activeJournal.id) || null
          : null,
      [activeJournal, journalSummaries]
    );

    const stats = useMemo(
      () =>
        calculateStats(trades, {
          unit: selectedUnit,
          defaultUnit: activeIsRMode ? 'r' : settings?.defaultPnlUnit,
          defaultCurrency: activeJournal?.currency || settings?.currency || 'R',
        }),
      [
        trades,
        selectedUnit,
        activeIsRMode,
        activeJournal?.currency,
        settings?.defaultPnlUnit,
        settings?.currency,
      ]
    );

    const activeUnit = stats.primaryUnit;
    const activeCurrency = stats.primaryCurrency;
    const unitShort = getUnitShortLabel(activeUnit, activeCurrency);
    const unitFilter = stats.isMixedUnits ? activeUnit : undefined;

    const recentTrades = useMemo(
      () => [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      [trades]
    );

    const nextAlarm = useMemo(() => {
      const now = new Date();
      const sorted = alarms
        .filter((a) => a.enabled)
        .map((a) => {
          const [hh, mm] = a.time.split(':').map(Number);
          const target = new Date();
          target.setHours(hh || 0, mm || 0, 0, 0);
          const isToday = target > now;
          if (!isToday) target.setDate(target.getDate() + 1);
          return { ...a, target, isToday };
        })
        .sort((a, b) => a.target.getTime() - b.target.getTime());
      return sorted[0] || null;
    }, [alarms]);

    const monthlyPnL = useMemo(
      () => calculateMonthlyPnL(trades, 6, new Date(), unitFilter),
      [trades, unitFilter]
    );

    const sixMonthSummary = useMemo(() => {
      const totalR = monthlyPnL.reduce((sum, m) => sum + m.netR, 0);
      const totalTrades = monthlyPnL.reduce((sum, m) => sum + m.tradesCount, 0);
      const best = monthlyPnL.reduce<MonthlyPnLPoint | null>(
        (acc, m) => (m.tradesCount > 0 && (!acc || m.netR > acc.netR) ? m : acc),
        null
      );
      return { totalR, totalTrades, best };
    }, [monthlyPnL]);

    const profitFactorLabel =
      stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);

    const pnlStateText =
      stats.totalTrades === 0
        ? 'Awaiting executions'
        : stats.netR > 0
        ? 'Net profitable'
        : stats.netR < 0
        ? 'In drawdown'
        : 'Breakeven';

    const streakText =
      stats.currentStreak.type === 'None' || stats.currentStreak.count === 0
        ? 'No active streak'
        : `${stats.currentStreak.count} ${stats.currentStreak.type} streak`;

    return (
      <div className="space-y-7">
        {/* Empty State or Frosted Glass Command Overview */}
        {journals.length === 0 ? (
          <section
            aria-label="Create your first journal"
            className="rounded-3xl glass-hero px-6 py-16 sm:py-20 text-center flex flex-col items-center justify-center space-y-6"
          >
            <div className="h-14 w-14 rounded-2xl bg-[#47dca0]/15 border border-[#47dca0]/35 flex items-center justify-center text-[#8df0c0] shadow-[0_0_28px_-6px_rgba(71,220,160,0.45)]">
              <BookMarked className="w-7 h-7" />
            </div>
            <div className="max-w-lg space-y-2.5">
              <p className="text-xs font-medium text-[#8df0c0]">Multi-journal workspace</p>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#eef3fb] [text-wrap:balance]">
                Create your first trading journal
              </h2>
              <p className="text-sm text-[#9aa8be] leading-relaxed">
                Keep your main log in balance-free R-multiples, or set up funded challenges with starting balances, profit targets, and isolated analytics.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateJournal}
              className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#47dca0] px-6 py-2.5 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create your first journal</span>
            </button>
          </section>
        ) : (
          <>
            {/* Zone 1: Command Glass Hero (Focal Anchor) */}
            <section
              aria-label="Active workspace summary"
              className="rounded-3xl glass-hero p-5 sm:p-7"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
                {/* Left: Active Workspace Identity & Primary Actions */}
                <div className="lg:col-span-7 min-w-0 space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#9aa8be]">
                      <span className="font-semibold text-[#8df0c0]">Active workspace</span>
                      {activeJournal?.propFirm && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#c4dfff] font-medium">
                            {activeJournal.propFirm}
                          </span>
                        </>
                      )}
                      {activeSummary && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              activeSummary.statusLabel === 'Target Reached' ||
                              activeSummary.statusLabel === 'In Profit'
                                ? 'text-[#8df0c0] font-medium'
                                : activeSummary.statusLabel === 'In Drawdown'
                                ? 'text-[#ffb4bf] font-medium'
                                : 'text-[#9aa8be] font-medium'
                            }
                          >
                            {activeSummary.statusLabel}
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eef3fb] [text-wrap:balance] truncate">
                      {activeJournal ? activeJournal.name : 'Overview'}
                    </h2>

                    <p className="text-sm text-[#a8b6cb] leading-relaxed tabular-nums">
                      {activeJournal && (
                        <>
                          {activeIsRMode ? (
                            <span>R-multiple mode · No starting balance</span>
                          ) : (
                            <span>
                              Starting balance{' '}
                              <strong className="font-mono font-semibold text-[#eef3fb]">
                                {formatMetric(
                                  activeJournal.startingBalance,
                                  'money',
                                  activeJournal.currency || 'R',
                                  {
                                    signed: false,
                                    decimals:
                                      activeJournal.startingBalance % 1 === 0 ? 0 : 2,
                                  }
                                )}
                              </strong>
                            </span>
                          )}
                          <span aria-hidden="true"> · </span>
                          <span>
                            {stats.totalTrades} executed{' '}
                            {stats.totalTrades === 1 ? 'trade' : 'trades'}
                          </span>
                          {stats.missed.length > 0 && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{stats.missed.length} missed</span>
                            </>
                          )}
                          {activeJournal.description && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-[#8b9ab0]">{activeJournal.description}</span>
                            </>
                          )}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Primary Action + Frosted Secondary Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={onOpenLogTrade}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2.5 text-sm font-bold text-[#051612] shadow-[0_10px_28px_-10px_rgba(71,220,160,0.65)] hover:bg-[#62e4b0] active:scale-[0.98] transition whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                      <span>Log trade</span>
                    </button>

                    <button
                      type="button"
                      onClick={onCreateJournal}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.14] px-4 py-2 text-xs sm:text-sm font-semibold text-[#eef3fb] transition whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-4 h-4 text-[#8df0c0]" />
                      <span>New journal</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigate('journals')}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.1] px-4 py-2 text-xs sm:text-sm font-semibold text-[#c5d3e8] transition whitespace-nowrap shrink-0"
                    >
                      <span>All accounts ({journals.length})</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#8ebeff]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigate('ai')}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] hover:bg-[#47dca0]/12 border border-white/[0.1] hover:border-[#47dca0]/40 px-4 py-2 text-xs sm:text-sm font-semibold text-[#dce5f4] hover:text-[#8df0c0] transition whitespace-nowrap shrink-0"
                    >
                      <Bot className="w-4 h-4 text-[#8df0c0]" />
                      <span>Ask KAIROS</span>
                    </button>
                  </div>
                </div>

                {/* Right: Frosted Focal Readout (Hairline-Separated, Single Elevation) */}
                {activeJournal && activeSummary && (
                  <div className="lg:col-span-5 lg:border-l lg:border-white/[0.1] lg:pl-7 pt-4 lg:pt-0 border-t lg:border-t-0 border-white/[0.1] space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#8b9ab0]">
                          {activeIsRMode ? 'Cumulative return' : 'Account equity'}
                        </p>
                        {activeIsRMode ? (
                          <p
                            className={`mt-1 font-mono text-3xl sm:text-4xl font-bold tracking-tight tabular-nums ${
                              activeSummary.nativeNetPnL < 0
                                ? 'text-[#ff7d91]'
                                : activeSummary.nativeNetPnL > 0
                                ? 'text-[#47dca0]'
                                : 'text-[#eef3fb]'
                            }`}
                          >
                            {formatMetric(activeSummary.nativeNetPnL, 'r', 'R')}
                          </p>
                        ) : (
                          <div className="mt-1 space-y-0.5">
                            <p className="font-mono text-3xl sm:text-4xl font-bold tracking-tight tabular-nums text-[#eef3fb]">
                              {formatMetric(
                                activeSummary.currentEquity,
                                'money',
                                activeSummary.currency,
                                {
                                  signed: false,
                                  decimals: activeSummary.currentEquity % 1 === 0 ? 0 : 2,
                                }
                              )}
                            </p>
                            <p
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                activeSummary.performanceTone === 'negative'
                                  ? 'text-[#ff7d91]'
                                  : activeSummary.performanceTone === 'positive'
                                  ? 'text-[#47dca0]'
                                  : 'text-[#8b9ab0]'
                              }`}
                            >
                              {activeSummary.hasMonetaryDelta
                                ? `${formatMetric(
                                    activeSummary.netMoneyDelta,
                                    'money',
                                    activeSummary.currency,
                                    {
                                      signed: true,
                                      decimals: activeSummary.netMoneyDelta % 1 === 0 ? 0 : 2,
                                    }
                                  )} (${activeSummary.returnPct >= 0 ? '+' : ''}${activeSummary.returnPct.toFixed(1)}%)`
                                : activeSummary.executedCount > 0
                                ? `Net ${formatMetric(
                                    activeSummary.nativeNetPnL,
                                    activeSummary.nativeUnit,
                                    activeSummary.currency
                                  )}`
                                : 'No realized change'}
                            </p>
                          </div>
                        )}
                      </div>

                      {stats.unitBreakdown.length > 1 && (
                        <div
                          role="group"
                          aria-label="Select metrics unit"
                          className="inline-flex items-center gap-1 rounded-xl bg-black/25 border border-white/[0.1] p-1 shrink-0"
                        >
                          {stats.unitBreakdown.map((u) => (
                            <button
                              key={u.unit}
                              type="button"
                              onClick={() => setSelectedUnit(u.unit)}
                              title={getUnitLongLabel(u.unit, u.currency)}
                              className={`min-h-[30px] rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap tabular-nums ${
                                u.unit === activeUnit
                                  ? 'bg-[#47dca0]/22 text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                                  : 'text-[#8b9ab0] hover:text-[#eef3fb]'
                              }`}
                            >
                              {getUnitShortLabel(u.unit, u.currency)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Profit Target Glass Progress Meter (if set) */}
                    {activeSummary.target > 0 ? (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                          <span className="text-[#a8b6cb]">
                            Profit target{' '}
                            <strong className="font-mono text-[#eef3fb]">
                              {activeSummary.isRMode
                                ? formatMetric(activeSummary.target, 'r', 'R', { signed: true })
                                : formatMetric(
                                    activeSummary.target,
                                    'money',
                                    activeSummary.currency,
                                    {
                                      signed: true,
                                      decimals: activeSummary.target % 1 === 0 ? 0 : 2,
                                    }
                                  )}
                            </strong>
                          </span>
                          <span
                            className={`font-mono font-bold ${
                              activeSummary.targetHit
                                ? 'text-[#47dca0]'
                                : activeSummary.currentTargetValue < 0
                                ? 'text-[#ff7d91]'
                                : 'text-[#8ebeff]'
                            }`}
                          >
                            {activeSummary.targetHit
                              ? 'Target reached'
                              : `${(activeSummary.targetProgressPct ?? 0).toFixed(1)}%`}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/[0.08] overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              activeSummary.targetHit
                                ? 'bg-[#47dca0]'
                                : activeSummary.currentTargetValue < 0
                                ? 'bg-[#ff7d91]'
                                : 'bg-gradient-to-r from-[#8ebeff] via-[#5ad7b7] to-[#47dca0]'
                            }`}
                            style={{
                              width: `${Math.max(3, activeSummary.targetProgressPct ?? 0)}%`,
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#7f8fa8] tabular-nums">
                          <span>
                            {activeSummary.targetHit
                              ? 'Milestone completed'
                              : `${
                                  activeSummary.isRMode
                                    ? formatMetric(
                                        activeSummary.remainingToTarget ?? 0,
                                        'r',
                                        'R',
                                        { signed: false }
                                      )
                                    : formatMetric(
                                        activeSummary.remainingToTarget ?? 0,
                                        'money',
                                        activeSummary.currency,
                                        {
                                          signed: false,
                                          decimals:
                                            (activeSummary.remainingToTarget ?? 0) % 1 === 0
                                              ? 0
                                              : 2,
                                        }
                                      )
                                } to goal`}
                          </span>
                          {activeSummary.targetEquity !== null && (
                            <span className="font-mono">
                              Goal{' '}
                              {formatMetric(
                                activeSummary.targetEquity,
                                'money',
                                activeSummary.currency,
                                {
                                  signed: false,
                                  decimals: activeSummary.targetEquity % 1 === 0 ? 0 : 2,
                                }
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.08] text-xs text-[#8b9ab0] tabular-nums">
                        <span>{streakText}</span>
                        <span>
                          Best session:{' '}
                          <strong className="text-[#eef3fb] font-medium">
                            {stats.bestSession ? stats.bestSession.name : '—'}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Zone 2: 4 Core Stat Cards (Deep Fintech Glassmorphism) */}
            {activeJournal && (
              <motion.section
                aria-label="Key performance indicators"
                className="grid grid-cols-2 lg:grid-cols-4 gap-4"
                variants={STAT_CONTAINER_VARIANTS}
                initial={shouldReduceMotion ? false : 'hidden'}
                animate={shouldReduceMotion || entranceReady ? 'visible' : 'hidden'}
              >
                <motion.article
                  variants={STAT_CARD_VARIANTS}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
                  }
                  className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-4 ${
                    stats.netR > 0
                      ? 'glass-stat-positive'
                      : stats.netR < 0
                      ? 'glass-stat-negative'
                      : 'glass-stat-neutral'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-[#9aa8be]">Net P&amp;L</p>
                    <span
                      className={`text-[11px] font-medium ${
                        stats.netR > 0
                          ? 'text-[#8df0c0]'
                          : stats.netR < 0
                          ? 'text-[#ffb4bf]'
                          : 'text-[#8b9ab0]'
                      }`}
                    >
                      {pnlStateText}
                    </span>
                  </div>
                  <p
                    className={`font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums leading-none ${
                      stats.netR < 0
                        ? 'text-[#ff7d91]'
                        : stats.netR > 0
                        ? 'text-[#47dca0]'
                        : 'text-[#eef3fb]'
                    }`}
                  >
                    {formatMetric(stats.netR, activeUnit, activeCurrency)}
                  </p>
                  <div className="space-y-2.5">
                    <div className="glass-hairline" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2 text-xs text-[#8b9ab0] tabular-nums">
                      <span>Expectancy</span>
                      <span className="font-mono font-medium text-[#dce5f4]">
                        {formatMetric(stats.expectancy, activeUnit, activeCurrency)}
                      </span>
                    </div>
                  </div>
                </motion.article>

                <motion.article
                  variants={STAT_CARD_VARIANTS}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
                  }
                  className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-4 ${
                    stats.totalTrades > 0 && stats.winRate >= 50
                      ? 'glass-stat-positive'
                      : 'glass-stat-neutral'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-[#9aa8be]">Win rate</p>
                    <span className="text-[11px] text-[#8b9ab0] tabular-nums">
                      {stats.totalTrades} trades
                    </span>
                  </div>
                  <p
                    className={`font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums leading-none ${
                      stats.totalTrades > 0 && stats.winRate >= 50
                        ? 'text-[#8df0c0]'
                        : 'text-[#eef3fb]'
                    }`}
                  >
                    {stats.totalTrades > 0 ? `${Math.round(stats.winRate)}%` : '—'}
                  </p>
                  <div className="space-y-2.5">
                    <div className="glass-hairline" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2 text-xs text-[#8b9ab0] tabular-nums">
                      <span>Breakdown</span>
                      <span className="font-mono font-medium text-[#dce5f4]">
                        {stats.wins.length}W · {stats.losses.length}L
                        {stats.breakevens.length > 0 ? ` · ${stats.breakevens.length}BE` : ''}
                      </span>
                    </div>
                  </div>
                </motion.article>

                <motion.article
                  variants={STAT_CARD_VARIANTS}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
                  }
                  className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-4 ${
                    stats.totalTrades > 0 && stats.profitFactor >= 1.5
                      ? 'glass-stat-positive'
                      : stats.totalTrades > 0 && stats.profitFactor < 1
                      ? 'glass-stat-negative'
                      : 'glass-stat-neutral'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-[#9aa8be]">Profit factor</p>
                    <span className="text-[11px] text-[#8b9ab0]">Gross ratio</span>
                  </div>
                  <p
                    className={`font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums leading-none ${
                      stats.totalTrades > 0 && stats.profitFactor >= 1.5
                        ? 'text-[#8df0c0]'
                        : stats.totalTrades > 0 && stats.profitFactor < 1
                        ? 'text-[#ff7d91]'
                        : 'text-[#eef3fb]'
                    }`}
                  >
                    {stats.totalTrades > 0 ? profitFactorLabel : '—'}
                  </p>
                  <div className="space-y-2.5">
                    <div className="glass-hairline" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2 text-xs text-[#8b9ab0] tabular-nums">
                      <span>Gain / Loss</span>
                      <span className="font-mono font-medium text-[#dce5f4] truncate">
                        {formatMetric(stats.grossWin, activeUnit, activeCurrency, {
                          decimals: activeUnit === 'money' ? 0 : 1,
                        })}{' '}
                        /{' '}
                        {formatMetric(stats.grossLoss, activeUnit, activeCurrency, {
                          signed: false,
                          decimals: activeUnit === 'money' ? 0 : 1,
                        })}
                      </span>
                    </div>
                  </div>
                </motion.article>

                <motion.article
                  variants={STAT_CARD_VARIANTS}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
                  }
                  className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-4 ${
                    stats.maxDrawdownR > 0 ? 'glass-stat-negative' : 'glass-stat-neutral'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-[#9aa8be]">Max drawdown</p>
                    <span className="text-[11px] text-[#8b9ab0]">{unitShort}</span>
                  </div>
                  <p
                    className={`font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums leading-none ${
                      stats.maxDrawdownR > 0 ? 'text-[#ff7d91]' : 'text-[#eef3fb]'
                    }`}
                  >
                    {stats.totalTrades > 0
                      ? formatMetric(-stats.maxDrawdownR, activeUnit, activeCurrency)
                      : '—'}
                  </p>
                  <div className="space-y-2.5">
                    <div className="glass-hairline" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2 text-xs text-[#8b9ab0] tabular-nums">
                      <span>Best session</span>
                      <span className="font-medium text-[#dce5f4] truncate">
                        {stats.bestSession ? stats.bestSession.name : '—'}
                      </span>
                    </div>
                  </div>
                </motion.article>
              </motion.section>
            )}

            {/* Zone 3: 6-Month Trajectory + Recent Executions (Balanced Asymmetric Split) */}
            {activeJournal && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                <article className="lg:col-span-7 rounded-2xl glass-pane p-5 sm:p-6 flex flex-col justify-between">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
                    <div>
                      <p className="text-xs font-medium text-[#8df0c0]">6-month trajectory</p>
                      <h3 className="mt-0.5 font-display text-base font-bold text-[#eef3fb]">
                        Monthly growth ({unitShort})
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                      <span className="text-[#8b9ab0]">
                        6M Net{' '}
                        <strong
                          className={`font-mono ${
                            sixMonthSummary.totalR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                          }`}
                        >
                          {formatMetric(sixMonthSummary.totalR, activeUnit, activeCurrency)}
                        </strong>
                      </span>
                      {sixMonthSummary.best && (
                        <span className="text-[#8b9ab0]">
                          Best{' '}
                          <strong className="text-[#eef3fb] font-semibold">
                            {sixMonthSummary.best.label}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {trades.length === 0 ? (
                    <div className="flex-1 min-h-[256px] flex flex-col items-center justify-center text-center px-4 py-10 space-y-2.5">
                      <p className="text-sm font-semibold text-[#eef3fb]">
                        Your 6-month equity curve will appear here
                      </p>
                      <p className="text-xs text-[#8b9ab0] max-w-sm">
                        Once you log trades in {activeJournal.name}, monthly net bars and your cumulative growth line will populate automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={monthlyPnL}
                          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="overviewWinBar" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#62e4b0" stopOpacity={0.95} />
                              <stop offset="100%" stopColor="#47dca0" stopOpacity={0.48} />
                            </linearGradient>
                            <linearGradient id="overviewLossBar" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ff94a5" stopOpacity={0.95} />
                              <stop offset="100%" stopColor="#ff7d91" stopOpacity={0.48} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            stroke="rgba(255,255,255,0.06)"
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: '#8b9ab0', fontSize: 12 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{
                              fill: '#8b9ab0',
                              fontSize: 11,
                              fontFamily: 'JetBrains Mono',
                            }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v: number) =>
                              formatMetric(v, activeUnit, activeCurrency, {
                                decimals: activeUnit === 'money' ? 0 : 1,
                              })
                            }
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                          <Tooltip
                            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const point = payload[0].payload as MonthlyPnLPoint;
                              return (
                                <div className="rounded-xl glass-modal px-3.5 py-2.5 text-xs space-y-1">
                                  <p className="font-bold text-[#eef3fb]">{point.fullLabel}</p>
                                  <p className="text-[#9aa8be] tabular-nums">
                                    Net:{' '}
                                    <span
                                      className={`font-mono font-bold ${
                                        point.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                                      }`}
                                    >
                                      {formatMetric(point.netR, activeUnit, activeCurrency)}
                                    </span>
                                  </p>
                                  <p className="text-[#9aa8be] tabular-nums">
                                    Cumulative:{' '}
                                    <span className="font-mono font-bold text-[#8ebeff]">
                                      {formatMetric(
                                        point.cumulativeR,
                                        activeUnit,
                                        activeCurrency
                                      )}
                                    </span>
                                  </p>
                                  <p className="text-[#7f8fa8] tabular-nums">
                                    {point.tradesCount}{' '}
                                    {point.tradesCount === 1 ? 'trade' : 'trades'}
                                    {point.tradesCount > 0 ? ` · ${point.winRate}% WR` : ''}
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="netR"
                            radius={[6, 6, 0, 0]}
                            maxBarSize={38}
                            animationDuration={220}
                          >
                            {monthlyPnL.map((entry) => (
                              <Cell
                                key={entry.monthKey}
                                fill={
                                  entry.netR > 0
                                    ? 'url(#overviewWinBar)'
                                    : entry.netR < 0
                                    ? 'url(#overviewLossBar)'
                                    : 'rgba(255,255,255,0.14)'
                                }
                                fillOpacity={entry.tradesCount === 0 ? 0.22 : 1}
                              />
                            ))}
                          </Bar>
                          <Line
                            type="monotone"
                            dataKey="cumulativeR"
                            stroke="#8ebeff"
                            strokeWidth={2.4}
                            animationDuration={220}
                            dot={{ r: 3.5, fill: '#8ebeff', strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: '#eef3fb' }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </article>

                <article className="lg:col-span-5 rounded-2xl glass-pane p-5 sm:p-6 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
                    <div>
                      <p className="text-xs font-medium text-[#8df0c0]">Latest ledger</p>
                      <h3 className="mt-0.5 font-display text-base font-bold text-[#eef3fb]">
                        Recent executions
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('journal')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:underline whitespace-nowrap shrink-0"
                    >
                      <span>View all</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="mt-2 flex-1 flex flex-col justify-center">
                    {recentTrades.length === 0 ? (
                      <div className="py-10 text-center space-y-3">
                        <p className="text-sm font-semibold text-[#eef3fb]">No trades yet</p>
                        <p className="text-xs text-[#8b9ab0]">
                          Log your first execution in {activeJournal.name} to populate your ledger.
                        </p>
                        <button
                          type="button"
                          onClick={onOpenLogTrade}
                          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-4 py-2 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Log first trade</span>
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/[0.07]">
                        {recentTrades.map((t) => {
                          const outcomeColor =
                            t.result === 'Win'
                              ? 'text-[#47dca0]'
                              : t.result === 'Loss'
                              ? 'text-[#ff7d91]'
                              : t.result === 'Missed'
                              ? 'text-[#f5cc79]'
                              : 'text-[#8ebeff]';
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => onSelectTrade(t)}
                              className="w-full glass-row rounded-xl px-2.5 py-3 flex items-center justify-between gap-3 text-left"
                            >
                              <div className="min-w-0">
                                <p className="font-bold text-sm text-[#eef3fb] truncate">
                                  {t.pair}{' '}
                                  <span className="text-xs font-medium text-[#8b9ab0]">
                                    · {t.direction}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-xs text-[#7f8fa8] truncate tabular-nums">
                                  {formatDate(t.date)} · {t.setup} · {t.session}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p
                                  className={`font-mono text-sm font-bold tabular-nums ${outcomeColor}`}
                                >
                                  {formatTradePnL(
                                    t,
                                    settings?.defaultPnlUnit,
                                    activeJournal.currency || settings?.currency
                                  )}
                                </p>
                                <p className="text-[11px] text-[#7f8fa8]">{t.result}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              </div>
            )}

            {/* Zone 4: Multi-Journal Account Glass Switcher Grid */}
            <section aria-label="All trading journals" className="space-y-3.5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-[#eef3fb]">
                    Journal accounts ({journals.length})
                  </h3>
                  <p className="text-xs text-[#8b9ab0]">
                    Select a frosted account card to switch active scope across charts, ledger, and analytics.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => onNavigate('journals')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#8ebeff] hover:underline whitespace-nowrap shrink-0"
                  >
                    <span>Manage accounts</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onCreateJournal}
                    className="text-xs font-semibold text-[#8df0c0] hover:underline whitespace-nowrap shrink-0"
                  >
                    + Add journal
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {journalSummaries.map((item) => {
                  const { journal } = item;
                  const isSelected = journal.id === activeJournal?.id;
                  const startDec = journal.startingBalance % 1 === 0 ? 0 : 2;
                  const eqDec = item.currentEquity % 1 === 0 ? 0 : 2;

                  const toneAura = item.targetHit
                    ? 'bg-[radial-gradient(circle_220px_at_90%_8%,rgba(71,220,160,0.16),transparent_72%)]'
                    : item.performanceTone === 'positive'
                    ? 'bg-[radial-gradient(circle_220px_at_90%_8%,rgba(71,220,160,0.11),transparent_72%)]'
                    : item.performanceTone === 'negative'
                    ? 'bg-[radial-gradient(circle_220px_at_90%_8%,rgba(255,125,145,0.12),transparent_72%)]'
                    : 'bg-[radial-gradient(circle_220px_at_90%_8%,rgba(142,190,255,0.08),transparent_72%)]';

                  const toneBorder = isSelected
                    ? 'border-[#47dca0]/60 ring-1 ring-[#47dca0]/30'
                    : item.performanceTone === 'positive'
                    ? 'border-[#47dca0]/28'
                    : item.performanceTone === 'negative'
                    ? 'border-[#ff7d91]/28'
                    : 'border-white/[0.12]';

                  const pnlColor =
                    item.performanceTone === 'positive'
                      ? 'text-[#47dca0]'
                      : item.performanceTone === 'negative'
                      ? 'text-[#ff7d91]'
                      : 'text-[#9aa8be]';

                  return (
                    <article
                      key={journal.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => onSelectJournal(journal.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectJournal(journal.id);
                        }
                      }}
                      className={`cursor-pointer rounded-2xl glass-pane glass-pane-interactive p-5 flex flex-col justify-between gap-4 text-left ${toneAura} ${toneBorder}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                            <span
                              className={
                                isSelected ? 'text-[#8df0c0] font-semibold' : 'text-[#7f8fa8]'
                              }
                            >
                              {isSelected ? 'Active workspace' : item.statusLabel}
                            </span>
                            {journal.propFirm && (
                              <>
                                <span aria-hidden="true" className="text-[#5d6c84]">
                                  ·
                                </span>
                                <span className="text-[#b9d6ff]">{journal.propFirm}</span>
                              </>
                            )}
                          </div>

                          <h4 className="font-display text-base font-extrabold text-[#eef3fb] truncate">
                            {journal.name}
                          </h4>

                          {journal.description && (
                            <p className="text-xs text-[#8b9ab0] truncate">
                              {journal.description}
                            </p>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onEditJournal(journal)}
                            aria-label={`Edit ${journal.name}`}
                            title="Edit journal"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.1] text-[#9aa8be] hover:text-[#eef3fb] hover:border-[#47dca0]/45 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteJournal(journal)}
                            aria-label={`Delete ${journal.name}`}
                            title="Delete journal"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.1] text-[#9aa8be] hover:text-[#ff7d91] hover:border-[#ff7d91]/45 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {item.isRMode ? (
                        <div>
                          <p className="text-[11px] font-medium text-[#7f8fa8]">
                            Net performance (R)
                          </p>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2">
                            <p className={`font-mono text-2xl font-bold tabular-nums ${pnlColor}`}>
                              {formatMetric(item.nativeNetPnL, 'r', 'R')}
                            </p>
                            <span className="text-xs text-[#8b9ab0]">Risk / Reward</span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="text-[11px] font-medium text-[#7f8fa8]">
                            Current equity
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-2">
                            <p className="font-mono text-2xl font-bold tabular-nums text-[#eef3fb]">
                              {formatMetric(item.currentEquity, 'money', item.currency, {
                                signed: false,
                                decimals: eqDec,
                              })}
                            </p>
                            <p className={`font-mono text-xs font-bold tabular-nums ${pnlColor}`}>
                              {item.hasMonetaryDelta
                                ? `${formatMetric(item.netMoneyDelta, 'money', item.currency, {
                                    signed: true,
                                    decimals: item.netMoneyDelta % 1 === 0 ? 0 : 2,
                                  })} (${item.returnPct >= 0 ? '+' : ''}${item.returnPct.toFixed(1)}%)`
                                : item.executedCount > 0
                                ? `Net ${formatMetric(
                                    item.nativeNetPnL,
                                    item.nativeUnit,
                                    item.currency
                                  )}`
                                : '0.0%'}
                            </p>
                          </div>
                        </div>
                      )}

                      {item.target > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                            <span className="text-[#9fb0c7]">
                              Target{' '}
                              <strong className="font-mono text-[#eef3fb]">
                                {item.isRMode
                                  ? formatMetric(item.target, 'r', 'R', { signed: true })
                                  : formatMetric(item.target, 'money', item.currency, {
                                      signed: true,
                                      decimals: item.target % 1 === 0 ? 0 : 2,
                                    })}
                              </strong>
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                item.targetHit ? 'text-[#47dca0]' : 'text-[#8ebeff]'
                              }`}
                            >
                              {item.targetHit
                                ? 'Target reached'
                                : `${(item.targetProgressPct ?? 0).toFixed(0)}%`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.targetHit
                                  ? 'bg-[#47dca0]'
                                  : item.currentTargetValue < 0
                                  ? 'bg-[#ff7d91]'
                                  : 'bg-gradient-to-r from-[#8ebeff] to-[#47dca0]'
                              }`}
                              style={{ width: `${Math.max(3, item.targetProgressPct ?? 0)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="pt-3 border-t border-white/[0.08] grid grid-cols-3 gap-2 text-xs tabular-nums">
                        <div className="min-w-0">
                          <p className="text-[10px] text-[#7f8fa8]">
                            {item.isRMode ? 'Mode' : 'Start'}
                          </p>
                          <p className="mt-0.5 font-mono font-bold text-[#dce5f4] truncate">
                            {item.isRMode
                              ? 'R (No bal.)'
                              : formatMetric(journal.startingBalance, 'money', item.currency, {
                                  signed: false,
                                  decimals: startDec,
                                })}
                          </p>
                        </div>
                        <div className="min-w-0 text-center">
                          <p className="text-[10px] text-[#7f8fa8]">Trades</p>
                          <p className="mt-0.5 font-mono font-bold text-[#eef3fb]">
                            {item.tradesCount}
                          </p>
                        </div>
                        <div className="min-w-0 text-right">
                          <p className="text-[10px] text-[#7f8fa8]">Win rate</p>
                          <p
                            className={`mt-0.5 font-mono font-bold ${
                              item.winRate === null
                                ? 'text-[#7f8fa8]'
                                : item.winRate >= 50
                                ? 'text-[#47dca0]'
                                : 'text-[#eef3fb]'
                            }`}
                          >
                            {item.winRate === null ? '—' : `${Math.round(item.winRate)}%`}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* Zone 5: Discipline Reminder & Session / KAIROS Glass Duo */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <article className="lg:col-span-7 rounded-2xl glass-pane p-5 sm:p-6 flex flex-col justify-between gap-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#8df0c0]">Trading discipline reminder</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onNextQuote}
                  aria-label="Next quote"
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl bg-white/[0.05] border border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-[#cbd5e1] hover:border-[#47dca0]/45 hover:text-[#eef3fb] transition whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Next</span>
                </button>
                <button
                  type="button"
                  onClick={onCopyQuote}
                  aria-label="Copy quote"
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl bg-white/[0.05] border border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-[#cbd5e1] hover:border-[#47dca0]/45 hover:text-[#eef3fb] transition whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <blockquote className="space-y-2">
              <p className="font-display text-base sm:text-lg font-semibold leading-relaxed text-[#eef3fb] [text-wrap:balance]">
                “{quote.text}”
              </p>
              <footer className="text-xs text-[#7f8fa8]">— {quote.source}</footer>
            </blockquote>
          </article>

          <article className="lg:col-span-5 rounded-2xl glass-pane p-5 sm:p-6 flex flex-col justify-between gap-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#8ebeff]">Next session alarm</p>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="text-xs font-semibold text-[#8df0c0] hover:underline whitespace-nowrap shrink-0"
              >
                Manage alarms
              </button>
            </div>

            {nextAlarm ? (
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-extrabold text-[#eef3fb] truncate">
                    {nextAlarm.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[#8b9ab0]">
                    {nextAlarm.isToday ? 'Scheduled for later today' : 'Scheduled for tomorrow'}
                  </p>
                </div>
                <span className="font-mono text-2xl font-bold text-[#47dca0] tabular-nums shrink-0">
                  {nextAlarm.time}
                </span>
              </div>
            ) : (
              <p className="text-sm text-[#8b9ab0] leading-relaxed">
                No active session alarms enabled. Configure London or New York alerts in Settings.
              </p>
            )}

            <button
              type="button"
              onClick={() => onNavigate('ai')}
              className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.14] hover:border-[#47dca0]/45 px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#eef3fb] transition whitespace-nowrap"
            >
              <Bot className="w-4 h-4 text-[#47dca0]" />
              <span>Review performance with KAIROS</span>
            </button>
          </article>
        </div>
      </div>
    );
  }
);

OverviewScreen.displayName = 'OverviewScreen';
