import React, { useMemo, useState } from 'react';
import {
  BookMarked,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import {
  formatMetric,
  type JournalAccountStatus,
  type JournalSummary,
} from '../lib/calculations';
import type { TradingJournal } from '../types/journal';

interface JournalsScreenProps {
  journals: TradingJournal[];
  activeJournal: TradingJournal | null;
  journalSummaries: JournalSummary[];
  onSelectJournal: (journalId: string) => void;
  onCreateJournal: () => void;
  onEditJournal: (journal: TradingJournal) => void;
  onDeleteJournal: (journal: TradingJournal) => void;
  onLogTradeInJournal: (journalId: string) => void;
  entranceReady?: boolean;
}

const PORTFOLIO_STAT_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

const PORTFOLIO_STAT_ITEM: Variants = {
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

type AccountFilter =
  | 'all'
  | 'r-mode'
  | 'funded'
  | 'target-hit'
  | 'in-profit'
  | 'drawdown';

function getStatusBadgeStyle(status: JournalAccountStatus): string {
  switch (status) {
    case 'Target Reached':
      return 'bg-[#47dca0]/20 border-[#47dca0]/55 text-[#8df0c0]';
    case 'In Profit':
      return 'bg-[#47dca0]/14 border-[#47dca0]/35 text-[#8df0c0]';
    case 'In Drawdown':
      return 'bg-[#ff7d91]/16 border-[#ff7d91]/40 text-[#ffb4bf]';
    case 'Breakeven':
      return 'bg-[#8ebeff]/15 border-[#8ebeff]/35 text-[#b7d6ff]';
    case 'Active':
    default:
      return 'bg-white/[0.06] border-white/[0.12] text-[#9aa8be]';
  }
}

export const JournalsScreen: React.FC<JournalsScreenProps> = React.memo(
  ({
    journals,
    activeJournal,
    journalSummaries,
    onSelectJournal,
    onCreateJournal,
    onEditJournal,
    onDeleteJournal,
    onLogTradeInJournal,
    entranceReady = true,
  }) => {
    const [filter, setFilter] = useState<AccountFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const shouldReduceMotion = useReducedMotion();

    const portfolio = useMemo(() => {
      const rSummaries = journalSummaries.filter((s) => s.isRMode);
      const fundedSummaries = journalSummaries.filter((s) => s.hasStartingBalance);
      const withTargets = journalSummaries.filter((s) => s.target > 0);
      const targetsReached = withTargets.filter((s) => s.targetHit).length;

      const totalRModeNet =
        Math.round(rSummaries.reduce((sum, s) => sum + s.nativeNetPnL, 0) * 100) / 100;
      const totalRModeTrades = rSummaries.reduce((sum, s) => sum + s.executedCount, 0);

      const primaryFundedCurrency = fundedSummaries[0]?.currency || '$';
      const sameCurrencyFunded = fundedSummaries.filter(
        (s) => s.currency === primaryFundedCurrency
      );
      const totalStartCapital = sameCurrencyFunded.reduce(
        (sum, s) => sum + s.journal.startingBalance,
        0
      );
      const totalCurrentEquity = sameCurrencyFunded.reduce(
        (sum, s) => sum + s.currentEquity,
        0
      );
      const totalMoneyDelta = Math.round((totalCurrentEquity - totalStartCapital) * 100) / 100;
      const totalFundedReturnPct =
        totalStartCapital > 0 ? (totalMoneyDelta / totalStartCapital) * 100 : 0;

      return {
        totalCount: journalSummaries.length,
        rCount: rSummaries.length,
        fundedCount: fundedSummaries.length,
        withTargetsCount: withTargets.length,
        targetsReached,
        totalRModeNet,
        totalRModeTrades,
        primaryFundedCurrency,
        totalStartCapital,
        totalCurrentEquity,
        totalMoneyDelta,
        totalFundedReturnPct,
        hasMixedFundedCurrencies: sameCurrencyFunded.length !== fundedSummaries.length,
      };
    }, [journalSummaries]);

    const filterCounts = useMemo(
      () => ({
        all: journalSummaries.length,
        'r-mode': journalSummaries.filter((s) => s.isRMode).length,
        funded: journalSummaries.filter((s) => s.hasStartingBalance).length,
        'target-hit': journalSummaries.filter((s) => s.targetHit).length,
        'in-profit': journalSummaries.filter((s) => s.performanceTone === 'positive').length,
        drawdown: journalSummaries.filter((s) => s.performanceTone === 'negative').length,
      }),
      [journalSummaries]
    );

    const visibleSummaries = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      return journalSummaries.filter((s) => {
        if (filter === 'r-mode' && !s.isRMode) return false;
        if (filter === 'funded' && !s.hasStartingBalance) return false;
        if (filter === 'target-hit' && !s.targetHit) return false;
        if (filter === 'in-profit' && s.performanceTone !== 'positive') return false;
        if (filter === 'drawdown' && s.performanceTone !== 'negative') return false;

        if (!q) return true;
        const haystack = [
          s.journal.name,
          s.journal.propFirm || '',
          s.journal.description || '',
          s.currency,
          s.statusLabel,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }, [journalSummaries, filter, searchQuery]);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#8df0c0]">Multi-journal accounts</p>
            <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
              Journal Accounts
            </h2>
            <p className="mt-1 text-sm text-[#8b9ab0]">
              Create R-multiple journals or funded challenges with profit targets, and check live account status.
            </p>
          </div>

          <button
            type="button"
            onClick={onCreateJournal}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-4 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition shrink-0 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Create journal</span>
          </button>
        </div>

        {/* Portfolio Summary Cards */}
        {journals.length > 0 && (
          <motion.section
            aria-label="Accounts portfolio status"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
            variants={PORTFOLIO_STAT_CONTAINER}
            initial={shouldReduceMotion ? false : 'hidden'}
            animate={shouldReduceMotion || entranceReady ? 'visible' : 'hidden'}
          >
            <motion.article
              variants={PORTFOLIO_STAT_ITEM}
              whileHover={
                shouldReduceMotion
                  ? undefined
                  : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
              }
              className="rounded-2xl glass-stat-card glass-stat-neutral p-5 flex flex-col justify-between gap-3"
            >
              <p className="text-xs font-medium text-[#9aa8be]">Active journals</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-[#eef3fb]">
                {portfolio.totalCount}
              </p>
              <div className="space-y-2">
                <div className="glass-hairline" aria-hidden="true" />
                <p className="text-xs text-[#8b9ab0] tabular-nums">
                  {portfolio.rCount} R-mode · {portfolio.fundedCount} funded
                </p>
              </div>
            </motion.article>

            <motion.article
              variants={PORTFOLIO_STAT_ITEM}
              whileHover={
                shouldReduceMotion
                  ? undefined
                  : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
              }
              className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-3 ${
                portfolio.targetsReached > 0 ? 'glass-stat-positive' : 'glass-stat-neutral'
              }`}
            >
              <p className="text-xs font-medium text-[#9aa8be]">Targets reached</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-[#8df0c0]">
                {portfolio.withTargetsCount > 0
                  ? `${portfolio.targetsReached}/${portfolio.withTargetsCount}`
                  : '—'}
              </p>
              <div className="space-y-2">
                <div className="glass-hairline" aria-hidden="true" />
                <p className="text-xs text-[#8b9ab0]">
                  {portfolio.withTargetsCount > 0
                    ? 'Goals achieved across accounts'
                    : 'Set targets on funded challenges'}
                </p>
              </div>
            </motion.article>

            <motion.article
              variants={PORTFOLIO_STAT_ITEM}
              whileHover={
                shouldReduceMotion
                  ? undefined
                  : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
              }
              className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-3 ${
                portfolio.rCount > 0 && portfolio.totalRModeNet > 0
                  ? 'glass-stat-positive'
                  : portfolio.rCount > 0 && portfolio.totalRModeNet < 0
                  ? 'glass-stat-negative'
                  : 'glass-stat-neutral'
              }`}
            >
              <p className="text-xs font-medium text-[#9aa8be]">R-journals net</p>
              <p
                className={`font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${
                  portfolio.totalRModeNet < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                }`}
              >
                {portfolio.rCount > 0
                  ? formatMetric(portfolio.totalRModeNet, 'r', 'R')
                  : '—'}
              </p>
              <div className="space-y-2">
                <div className="glass-hairline" aria-hidden="true" />
                <p className="text-xs text-[#8b9ab0] tabular-nums">
                  {portfolio.rCount > 0
                    ? `${portfolio.totalRModeTrades} executed trades`
                    : 'No R-only journals yet'}
                </p>
              </div>
            </motion.article>

            <motion.article
              variants={PORTFOLIO_STAT_ITEM}
              whileHover={
                shouldReduceMotion
                  ? undefined
                  : { y: -2, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }
              }
              className={`rounded-2xl glass-stat-card p-5 flex flex-col justify-between gap-3 ${
                portfolio.fundedCount > 0 && portfolio.totalMoneyDelta > 0
                  ? 'glass-stat-positive'
                  : portfolio.fundedCount > 0 && portfolio.totalMoneyDelta < 0
                  ? 'glass-stat-negative'
                  : 'glass-stat-neutral'
              }`}
            >
              <p className="text-xs font-medium text-[#9aa8be]">
                {portfolio.hasMixedFundedCurrencies
                  ? `Funded (${portfolio.primaryFundedCurrency})`
                  : 'Funded equity'}
              </p>
              <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-[#eef3fb]">
                {portfolio.fundedCount > 0
                  ? formatMetric(
                      portfolio.totalCurrentEquity,
                      'money',
                      portfolio.primaryFundedCurrency,
                      {
                        signed: false,
                        decimals: portfolio.totalCurrentEquity % 1 === 0 ? 0 : 2,
                      }
                    )
                  : '—'}
              </p>
              <div className="space-y-2">
                <div className="glass-hairline" aria-hidden="true" />
                <p
                  className={`text-xs font-mono tabular-nums ${
                    portfolio.fundedCount === 0
                      ? 'text-[#8b9ab0] font-sans'
                      : portfolio.totalMoneyDelta < 0
                      ? 'text-[#ff7d91]'
                      : 'text-[#47dca0]'
                  }`}
                >
                  {portfolio.fundedCount > 0
                    ? `${formatMetric(
                        portfolio.totalMoneyDelta,
                        'money',
                        portfolio.primaryFundedCurrency,
                        {
                          signed: true,
                          decimals: portfolio.totalMoneyDelta % 1 === 0 ? 0 : 2,
                        }
                      )} (${portfolio.totalFundedReturnPct >= 0 ? '+' : ''}${portfolio.totalFundedReturnPct.toFixed(1)}%)`
                    : 'Add a funded or challenge account'}
                </p>
              </div>
            </motion.article>
          </motion.section>
        )}

        {/* Empty State or Filter + Account Status Grid */}
        {journals.length === 0 ? (
          <section
            aria-label="No journal accounts"
            className="rounded-3xl liquid-glass px-6 py-16 text-center flex flex-col items-center justify-center space-y-5"
          >
            <div className="h-14 w-14 rounded-2xl bg-[#47dca0]/15 border border-[#47dca0]/35 flex items-center justify-center text-[#8df0c0]">
              <BookMarked className="w-7 h-7" />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="font-display text-xl sm:text-2xl font-extrabold text-[#eef3fb]">
                Create your first trading journal
              </h3>
              <p className="text-sm text-[#9aa8be] leading-relaxed">
                Start with a balance-free R-multiple journal for your main log, or add funded challenges with starting balances and profit targets.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateJournal}
              className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#47dca0] px-6 py-2.5 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create your first journal</span>
            </button>
          </section>
        ) : (
          <>
            {/* Filter Tabs & Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl glass-card p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'r-mode', label: 'R-Mode' },
                    { id: 'funded', label: 'Funded' },
                    { id: 'target-hit', label: 'Target Reached' },
                    { id: 'in-profit', label: 'In Profit' },
                    { id: 'drawdown', label: 'Drawdown' },
                  ] as const
                ).map((tab) => {
                  const active = filter === tab.id;
                  const count = filterCounts[tab.id];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`min-h-[34px] rounded-xl px-3 py-1.5 text-xs font-semibold border transition tabular-nums ${
                        active
                          ? 'bg-[#47dca0]/18 border-[#47dca0]/45 text-[#8df0c0]'
                          : 'bg-white/[0.03] border-white/[0.08] text-[#8b9ab0] hover:text-[#eef3fb]'
                      }`}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full md:w-64 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7c8ca6]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search accounts or prop firm..."
                  aria-label="Search journal accounts"
                  className="w-full min-h-[38px] rounded-xl glass-input pl-9 pr-3 py-1.5 text-xs text-[#eef3fb] placeholder:text-[#66768f] focus:outline-none"
                />
              </div>
            </div>

            {/* Accounts Grid */}
            {visibleSummaries.length === 0 ? (
              <div className="rounded-2xl glass-card p-10 text-center space-y-3">
                <p className="text-sm font-bold text-[#eef3fb]">No matching journal accounts</p>
                <p className="text-xs text-[#8b9ab0]">
                  Try clearing your search or switching status filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearchQuery('');
                  }}
                  className="min-h-[38px] rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-1.5 text-xs font-semibold text-[#8df0c0] hover:border-[#47dca0]/45 transition"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleSummaries.map((item) => {
                  const { journal } = item;
                  const isSelected = journal.id === activeJournal?.id;
                  const profitFactorLabel =
                    item.stats.totalTrades === 0
                      ? '—'
                      : item.stats.profitFactor === Infinity
                      ? '∞'
                      : item.stats.profitFactor.toFixed(2);

                  const startDec = journal.startingBalance % 1 === 0 ? 0 : 2;
                  const eqDec = item.currentEquity % 1 === 0 ? 0 : 2;

                  const toneSurface = item.targetHit
                    ? 'bg-gradient-to-br from-[#47dca0]/[0.14] via-transparent to-transparent'
                    : item.performanceTone === 'positive'
                    ? 'bg-gradient-to-br from-[#47dca0]/[0.09] via-transparent to-transparent'
                    : item.performanceTone === 'negative'
                    ? 'bg-gradient-to-br from-[#ff7d91]/[0.09] via-transparent to-transparent'
                    : '';

                  const toneBorder = isSelected
                    ? 'border-[#47dca0]/65 ring-1 ring-[#47dca0]/35'
                    : item.performanceTone === 'positive'
                    ? 'border-[#47dca0]/30 hover:border-[#47dca0]/55'
                    : item.performanceTone === 'negative'
                    ? 'border-[#ff7d91]/30 hover:border-[#ff7d91]/55'
                    : 'border-white/[0.12] hover:border-[#8ebeff]/45';

                  const pnlColor =
                    item.performanceTone === 'positive'
                      ? 'text-[#47dca0]'
                      : item.performanceTone === 'negative'
                      ? 'text-[#ff7d91]'
                      : 'text-[#9aa8be]';

                  return (
                    <article
                      key={journal.id}
                      className={`rounded-2xl glass-card p-5 flex flex-col justify-between gap-4 transition ${toneSurface} ${toneBorder}`}
                    >
                      {/* Top Header & Actions */}
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h3 className="font-display text-base font-extrabold text-[#eef3fb] truncate">
                                {journal.name}
                              </h3>
                              {isSelected && (
                                <span className="rounded-md bg-[#47dca0]/20 border border-[#47dca0]/45 px-1.5 py-0.5 text-[10px] font-bold text-[#8df0c0] uppercase tracking-wider">
                                  Active
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${getStatusBadgeStyle(
                                  item.statusLabel
                                )}`}
                              >
                                {item.targetHit ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : item.performanceTone === 'positive' ? (
                                  <TrendingUp className="w-3 h-3" />
                                ) : item.performanceTone === 'negative' ? (
                                  <TrendingDown className="w-3 h-3" />
                                ) : null}
                                <span>{item.statusLabel}</span>
                              </span>

                              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] border border-white/[0.09] px-2 py-0.5 text-[10px] font-semibold text-[#c5d1e4]">
                                <Wallet className="w-2.5 h-2.5 text-[#8ebeff]" />
                                {item.isRMode
                                  ? 'R (No balance)'
                                  : `${item.currency} Account`}
                              </span>

                              {journal.propFirm && (
                                <span className="rounded-md bg-[#8ebeff]/15 border border-[#8ebeff]/25 px-2 py-0.5 text-[10px] font-semibold text-[#b9d6ff]">
                                  {journal.propFirm}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => onEditJournal(journal)}
                              aria-label={`Edit ${journal.name}`}
                              title="Edit journal"
                              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-[#202c40] bg-[#0b1322]/70 text-[#9aa8be] hover:text-[#eef3fb] hover:border-[#47dca0]/45 transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteJournal(journal)}
                              aria-label={`Delete ${journal.name}`}
                              title="Delete journal"
                              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-[#202c40] bg-[#0b1322]/70 text-[#9aa8be] hover:text-[#ff7d91] hover:border-[#ff7d91]/45 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {journal.description && (
                          <p className="text-xs text-[#8b9ab0] line-clamp-2">
                            {journal.description}
                          </p>
                        )}
                      </div>

                      {/* Primary Balance / Performance Display */}
                      {item.isRMode ? (
                        <div className="rounded-xl glass-subcard p-3.5 space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] font-medium text-[#7f8fa8]">
                              Net performance (R)
                            </span>
                            <span className="text-[11px] text-[#8df0c0] font-medium">
                              Risk / Reward mode
                            </span>
                          </div>
                          <p className={`font-mono text-2xl font-bold tabular-nums ${pnlColor}`}>
                            {formatMetric(item.nativeNetPnL, 'r', 'R')}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-xl glass-subcard p-3.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#7f8fa8]">
                            <span>Current equity</span>
                            <span className="font-mono tabular-nums">
                              Start{' '}
                              {formatMetric(journal.startingBalance, 'money', item.currency, {
                                signed: false,
                                decimals: startDec,
                              })}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
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
                                ? `Net ${formatMetric(item.nativeNetPnL, item.nativeUnit, item.currency)}`
                                : '0.0%'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Target Progress Bar */}
                      {item.target > 0 ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="inline-flex items-center gap-1 text-[#a9b7cc] font-medium">
                              <Target className="w-3.5 h-3.5 text-[#8ebeff]" />
                              <span>
                                Target:{' '}
                                <strong className="font-mono text-[#eef3fb] tabular-nums">
                                  {item.isRMode
                                    ? formatMetric(item.target, 'r', 'R', { signed: true })
                                    : formatMetric(item.target, 'money', item.currency, {
                                        signed: true,
                                        decimals: item.target % 1 === 0 ? 0 : 2,
                                      })}
                                </strong>
                              </span>
                            </span>
                            <span
                              className={`font-mono text-xs font-bold tabular-nums ${
                                item.targetHit
                                  ? 'text-[#47dca0]'
                                  : item.currentTargetValue < 0
                                  ? 'text-[#ff7d91]'
                                  : 'text-[#8ebeff]'
                              }`}
                            >
                              {item.targetHit
                                ? '100% · Hit!'
                                : `${(item.targetProgressPct ?? 0).toFixed(1)}%`}
                            </span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-white/[0.08] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.targetHit
                                  ? 'bg-[#47dca0]'
                                  : item.currentTargetValue < 0
                                  ? 'bg-[#ff7d91]'
                                  : 'bg-gradient-to-r from-[#8ebeff] to-[#47dca0]'
                              }`}
                              style={{ width: `${Math.max(2, item.targetProgressPct ?? 0)}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#7f8fa8] tabular-nums">
                            <span>
                              {item.targetHit
                                ? 'Profit target achieved'
                                : `${
                                    item.isRMode
                                      ? formatMetric(item.remainingToTarget ?? 0, 'r', 'R', {
                                          signed: false,
                                        })
                                      : formatMetric(
                                          item.remainingToTarget ?? 0,
                                          'money',
                                          item.currency,
                                          {
                                            signed: false,
                                            decimals:
                                              (item.remainingToTarget ?? 0) % 1 === 0 ? 0 : 2,
                                          }
                                        )
                                  } remaining`}
                            </span>
                            {item.targetEquity !== null && (
                              <span className="font-mono">
                                Goal{' '}
                                {formatMetric(item.targetEquity, 'money', item.currency, {
                                  signed: false,
                                  decimals: item.targetEquity % 1 === 0 ? 0 : 2,
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : !item.isRMode ? (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-white/[0.1] px-3 py-2 text-[11px] text-[#7f8fa8]">
                          <span>No profit target set</span>
                          <button
                            type="button"
                            onClick={() => onEditJournal(journal)}
                            className="font-semibold text-[#8ebeff] hover:underline"
                          >
                            + Set target
                          </button>
                        </div>
                      ) : null}

                      {/* Execution Metrics Grid */}
                      <div className="grid grid-cols-4 gap-2 rounded-xl glass-subcard p-2.5 text-center text-xs tabular-nums">
                        <div className="min-w-0">
                          <p className="text-[10px] text-[#7f8fa8]">Trades</p>
                          <p className="mt-0.5 font-mono font-bold text-[#eef3fb]">
                            {item.tradesCount}
                          </p>
                        </div>
                        <div className="min-w-0">
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
                        <div className="min-w-0">
                          <p className="text-[10px] text-[#7f8fa8]">PF</p>
                          <p className="mt-0.5 font-mono font-bold text-[#eef3fb]">
                            {profitFactorLabel}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-[#7f8fa8]">Max DD</p>
                          <p className="mt-0.5 font-mono font-bold text-[#ff7d91] truncate">
                            {item.executedCount > 0
                              ? formatMetric(
                                  -item.stats.maxDrawdownR,
                                  item.nativeUnit,
                                  item.currency,
                                  { decimals: item.nativeUnit === 'money' ? 0 : 1 }
                                )
                              : '—'}
                          </p>
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onSelectJournal(journal.id)}
                          className={`flex-1 min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${
                            isSelected
                              ? 'bg-[#47dca0]/15 border-[#47dca0]/45 text-[#8df0c0]'
                              : 'bg-[#111c2d] border-[#23344f] text-[#dce5f4] hover:border-[#47dca0]/45'
                          }`}
                        >
                          {isSelected ? 'Active workspace' : 'Switch to account'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onLogTradeInJournal(journal.id)}
                          className="min-h-[38px] inline-flex items-center gap-1 rounded-xl bg-[#47dca0] px-3 py-1.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Log</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  }
);

JournalsScreen.displayName = 'JournalsScreen';
