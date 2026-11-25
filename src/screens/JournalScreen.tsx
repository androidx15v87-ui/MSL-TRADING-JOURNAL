import React, { useDeferredValue, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, ImageIcon, Plus, Search, X } from 'lucide-react';
import {
  calculateStats,
  formatDate,
  formatMetric,
  formatTime,
  formatTradePnL,
  fuzzySearchTrades,
  getAllTradeTags,
  getUnitShortLabel,
} from '../lib/calculations';
import type {
  JournalSettings,
  MetricUnit,
  SessionType,
  SetupType,
  Trade,
  TradeOutcome,
} from '../types/journal';

interface JournalScreenProps {
  trades: Trade[];
  settings?: JournalSettings;
  activeJournalName?: string;
  onOpenNewTrade: () => void;
  onSelectTrade: (trade: Trade) => void;
  onExportBackup: () => void;
  onExportCSV: (filteredTrades: Trade[]) => void;
}

const OUTCOME_TABS: Array<{ value: '' | TradeOutcome; label: string }> = [
  { value: '', label: 'All' },
  { value: 'Win', label: 'Wins' },
  { value: 'Loss', label: 'Losses' },
  { value: 'BE', label: 'BE' },
  { value: 'Missed', label: 'Missed' },
];

export const JournalScreen: React.FC<JournalScreenProps> = React.memo(({
  trades,
  settings,
  activeJournalName,
  onOpenNewTrade,
  onSelectTrade,
  onExportBackup,
  onExportCSV,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'' | TradeOutcome>('');
  const [setupFilter, setSetupFilter] = useState<'' | SetupType>('');
  const [sessionFilter, setSessionFilter] = useState<'' | SessionType>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<MetricUnit | undefined>(undefined);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const availableTags = useMemo(() => getAllTradeTags(trades), [trades]);

  const filteredTrades = useMemo(() => {
    const base = trades.filter((t) => {
      if (outcomeFilter && t.result !== outcomeFilter) return false;
      if (setupFilter && t.setup !== setupFilter) return false;
      if (sessionFilter && t.session !== sessionFilter) return false;
      if (selectedTags.length > 0) {
        const tradeTagSet = new Set((t.tags || []).map((tg) => tg.toLowerCase()));
        const matchesAll = selectedTags.every((sel) => tradeTagSet.has(sel.toLowerCase()));
        if (!matchesAll) return false;
      }
      return true;
    });
    return fuzzySearchTrades(base, deferredSearchQuery);
  }, [trades, deferredSearchQuery, outcomeFilter, setupFilter, sessionFilter, selectedTags]);

  const filteredStats = useMemo(
    () =>
      calculateStats(filteredTrades, {
        unit: selectedUnit,
        defaultUnit: settings?.defaultPnlUnit,
        defaultCurrency: settings?.currency,
      }),
    [filteredTrades, selectedUnit, settings?.defaultPnlUnit, settings?.currency]
  );

  const hasActiveFilters = Boolean(
    searchQuery.trim() || outcomeFilter || setupFilter || sessionFilter || selectedTags.length > 0
  );

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) => {
      const exists = prev.some((x) => x.toLowerCase() === tag.toLowerCase());
      if (exists) {
        return prev.filter((x) => x.toLowerCase() !== tag.toLowerCase());
      }
      return [...prev, tag];
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setOutcomeFilter('');
    setSetupFilter('');
    setSessionFilter('');
    setSelectedTags([]);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#8df0c0]">Trade ledger</p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Trade journal
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            {activeJournalName
              ? `All executions recorded inside ${activeJournalName}.`
              : 'Search, filter, and inspect every recorded execution.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onExportBackup}
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#8df0c0]" />
            <span>Export backup</span>
          </button>

          <button
            type="button"
            onClick={() => onExportCSV(filteredTrades)}
            title="Export filtered rows as CSV"
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#8ebeff]/50 transition whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#8ebeff]" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={onOpenNewTrade}
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-4 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Log trade</span>
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="rounded-2xl glass-card p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#7f8fa8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pair, setup, tag, or notes…"
              aria-label="Search trades"
              className="w-full min-h-[44px] rounded-xl glass-input pl-10 pr-10 py-2 text-sm text-[#eef3fb] placeholder:text-[#66768f]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter by outcome"
              className="inline-flex items-center gap-1 rounded-xl bg-[#090e1a] border border-white/[0.08] p-1"
            >
              {OUTCOME_TABS.map((tab) => {
                const active = outcomeFilter === tab.value;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setOutcomeFilter(tab.value)}
                    className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap ${
                      active
                        ? 'bg-[#47dca0]/20 text-[#8df0c0] border border-[#47dca0]/35'
                        : 'text-[#8b9ab0] hover:text-[#eef3fb] border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <select
              value={setupFilter}
              onChange={(e) => setSetupFilter(e.target.value as '' | SetupType)}
              aria-label="Filter by setup"
              className="min-h-[42px] rounded-xl glass-input px-3 py-2 text-xs font-semibold text-[#dce5f4]"
            >
              <option value="">All setups</option>
              <option value="Reversal">Reversal</option>
              <option value="Continuation">Continuation</option>
              <option value="Breakout">Breakout</option>
              <option value="Other">Other</option>
            </select>

            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value as '' | SessionType)}
              aria-label="Filter by session"
              className="min-h-[42px] rounded-xl glass-input px-3 py-2 text-xs font-semibold text-[#dce5f4]"
            >
              <option value="">All sessions</option>
              <option value="London">London</option>
              <option value="New York">New York</option>
              <option value="Asia">Asia</option>
              <option value="Overlap">Overlap</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        {/* Tag Pills */}
        {availableTags.length > 0 && (
          <div className="pt-2 border-t border-white/[0.08] flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[11px] font-semibold text-[#7f8fa8] shrink-0 pr-1">
              Labels:
            </span>
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className={`min-h-[30px] rounded-lg px-2.5 py-1 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                selectedTags.length === 0
                  ? 'bg-[#47dca0]/18 border-[#47dca0]/45 text-[#8df0c0]'
                  : 'bg-white/[0.04] border-white/[0.09] text-[#8b9ab0] hover:text-[#eef3fb]'
              }`}
            >
              All
            </button>
            {availableTags.map(({ tag, count }) => {
              const active = selectedTags.some((x) => x.toLowerCase() === tag.toLowerCase());
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTagFilter(tag)}
                  className={`min-h-[30px] rounded-lg px-2.5 py-1 text-xs font-semibold border transition whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-[#47dca0]/18 border-[#47dca0]/45 text-[#8df0c0]'
                      : 'bg-white/[0.04] border-white/[0.09] text-[#9aa8be] hover:text-[#eef3fb]'
                  }`}
                >
                  #{tag} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Filtered Stats Strip */}
        <div className="pt-2 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs text-[#8b9ab0]">
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[#dce5f4]">
              Showing <strong className="text-[#eef3fb]">{filteredTrades.length}</strong> of{' '}
              {trades.length}
            </span>
            {filteredStats.totalTrades > 0 && (
              <>
                <span className="rounded-lg bg-white/[0.05] px-2.5 py-1">
                  Net:{' '}
                  <strong
                    className={`font-mono ${
                      filteredStats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                    }`}
                  >
                    {formatMetric(
                      filteredStats.netR,
                      filteredStats.primaryUnit,
                      filteredStats.primaryCurrency
                    )}
                  </strong>
                </span>
                <span className="rounded-lg bg-white/[0.05] px-2.5 py-1">
                  Win rate:{' '}
                  <strong className="font-mono text-[#eef3fb]">
                    {Math.round(filteredStats.winRate)}%
                  </strong>
                </span>
                <span className="rounded-lg bg-white/[0.05] px-2.5 py-1">
                  Expectancy:{' '}
                  <strong className="font-mono text-[#8ebeff]">
                    {formatMetric(
                      filteredStats.expectancy,
                      filteredStats.primaryUnit,
                      filteredStats.primaryCurrency
                    )}
                  </strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {filteredStats.unitBreakdown.length > 1 && (
              <div className="flex items-center gap-1">
                {filteredStats.unitBreakdown.map((u) => (
                  <button
                    key={u.unit}
                    type="button"
                    onClick={() => setSelectedUnit(u.unit)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold border transition tabular-nums ${
                      u.unit === filteredStats.primaryUnit
                        ? 'bg-[#47dca0]/18 border-[#47dca0]/45 text-[#8df0c0]'
                        : 'bg-white/[0.04] border-white/[0.1] text-[#8b9ab0] hover:text-[#eef3fb]'
                    }`}
                  >
                    {getUnitShortLabel(u.unit, u.currency)}
                  </button>
                ))}
              </div>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="font-semibold text-[#8df0c0] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty State or Ledger */}
      {filteredTrades.length === 0 ? (
        <div className="rounded-2xl glass-card px-6 py-14 text-center space-y-3">
          <h3 className="font-display text-lg font-bold text-[#eef3fb]">No trades found</h3>
          <p className="text-sm text-[#8b9ab0] max-w-sm mx-auto">
            {hasActiveFilters
              ? 'No entries matched your current filters. Reset them to view all trades.'
              : 'Log your first trade to begin tracking performance in this journal.'}
          </p>
          <div className="pt-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-[42px] rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
              >
                Reset filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenNewTrade}
                className="min-h-[42px] rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition"
              >
                Log your first trade
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile Trade Cards */}
          <div className="md:hidden space-y-2.5">
            {filteredTrades.map((t) => {
              const outcomeColor =
                t.result === 'Win'
                  ? 'text-[#47dca0]'
                  : t.result === 'Loss'
                  ? 'text-[#ff7d91]'
                  : t.result === 'Missed'
                  ? 'text-[#f5cc79]'
                  : 'text-[#8ebeff]';
              const tradeTags = Array.isArray(t.tags) ? t.tags.filter(Boolean) : [];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrade(t)}
                  className="perf-row w-full rounded-2xl glass-card p-4 text-left transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display text-base font-extrabold text-[#eef3fb]">
                          {t.pair}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            t.direction === 'Long'
                              ? 'bg-[#47dca0]/15 text-[#8df0c0]'
                              : 'bg-[#ff7d91]/15 text-[#ff9aa9]'
                          }`}
                        >
                          {t.direction}
                        </span>
                        {t.images && t.images.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#8ebeff]">
                            <ImageIcon className="w-3 h-3" />
                            {t.images.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#8b9ab0]">
                        {formatDate(t.date)} {formatTime(t.date)} · {t.setup} · {t.session}
                      </p>
                      {tradeTags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {tradeTags.map((tg) => (
                            <span
                              key={tg}
                              className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-[#8df0c0]"
                            >
                              #{tg}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-base font-bold tabular-nums ${outcomeColor}`}>
                        {formatTradePnL(t, settings?.defaultPnlUnit, settings?.currency)}
                      </p>
                      <p className="text-xs font-semibold text-[#8b9ab0]">{t.result}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop Ledger Table */}
          <div className="hidden md:block rounded-2xl glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-xs font-semibold text-[#8b9ab0]">
                    <th className="py-3.5 px-4">Date &amp; time</th>
                    <th className="py-3.5 px-4">Pair / Asset</th>
                    <th className="py-3.5 px-4">Direction</th>
                    <th className="py-3.5 px-4">Setup</th>
                    <th className="py-3.5 px-4">Session</th>
                    <th className="py-3.5 px-4">Labels</th>
                    <th className="py-3.5 px-4">Outcome</th>
                    <th className="py-3.5 px-4 text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-sm">
                  {filteredTrades.map((t) => {
                    const outcomeColor =
                      t.result === 'Win'
                        ? 'text-[#47dca0]'
                        : t.result === 'Loss'
                        ? 'text-[#ff7d91]'
                        : t.result === 'Missed'
                        ? 'text-[#f5cc79]'
                        : 'text-[#8ebeff]';
                    const outcomeBg =
                      t.result === 'Win'
                        ? 'bg-[#47dca0]/15 border-[#47dca0]/35'
                        : t.result === 'Loss'
                        ? 'bg-[#ff7d91]/15 border-[#ff7d91]/35'
                        : t.result === 'Missed'
                        ? 'bg-[#f5cc79]/15 border-[#f5cc79]/35'
                        : 'bg-[#8ebeff]/15 border-[#8ebeff]/35';
                    const tradeTags = Array.isArray(t.tags) ? t.tags.filter(Boolean) : [];
                    return (
                      <tr
                        key={t.id}
                        onClick={() => onSelectTrade(t)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectTrade(t);
                          }
                        }}
                        className="perf-row cursor-pointer hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline-none transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono text-xs text-[#9aa8be] tabular-nums whitespace-nowrap">
                          {formatDate(t.date)} {formatTime(t.date)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span className="font-bold text-[#eef3fb]">{t.pair}</span>
                            {t.images && t.images.length > 0 && (
                              <ImageIcon className="w-3.5 h-3.5 text-[#8ebeff]" />
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                              t.direction === 'Long'
                                ? 'bg-[#47dca0]/15 text-[#8df0c0]'
                                : 'bg-[#ff7d91]/15 text-[#ff9aa9]'
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[#cbd5e1] whitespace-nowrap">{t.setup}</td>
                        <td className="py-3.5 px-4 text-[#9aa8be] whitespace-nowrap">{t.session}</td>
                        <td className="py-3.5 px-4 max-w-[190px]">
                          {tradeTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {tradeTags.slice(0, 2).map((tg) => (
                                <span
                                  key={tg}
                                  className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-[#8df0c0]"
                                >
                                  #{tg}
                                </span>
                              ))}
                              {tradeTags.length > 2 && (
                                <span className="text-[11px] text-[#7f8fa8]">
                                  +{tradeTags.length - 2}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#56647c]">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${outcomeColor} ${outcomeBg}`}
                          >
                            {t.result}
                          </span>
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${outcomeColor}`}
                        >
                          {formatTradePnL(t, settings?.defaultPnlUnit, settings?.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

JournalScreen.displayName = 'JournalScreen';
