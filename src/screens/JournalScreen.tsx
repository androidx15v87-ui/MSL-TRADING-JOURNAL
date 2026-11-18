import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, ImageIcon, Plus, Search, Tag, X } from 'lucide-react';
import {
  calculateStats,
  formatDate,
  formatR,
  formatTime,
  fuzzySearchTrades,
  getAllTradeTags,
} from '../lib/calculations';
import type { SessionType, SetupType, Trade, TradeOutcome } from '../types/journal';

interface JournalScreenProps {
  trades: Trade[];
  onOpenNewTrade: () => void;
  onSelectTrade: (trade: Trade) => void;
  onExportBackup: () => void;
  onExportCSV: (filteredTrades: Trade[]) => void;
}

export const JournalScreen: React.FC<JournalScreenProps> = React.memo(({
  trades,
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
    return fuzzySearchTrades(base, searchQuery);
  }, [trades, searchQuery, outcomeFilter, setupFilter, sessionFilter, selectedTags]);

  const filteredStats = useMemo(() => calculateStats(filteredTrades), [filteredTrades]);

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
      {/* Header Intro */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#8df0c0]">
            Trade database
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Trade journal
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            Every execution is evidence. Fuzzy-search or filter by outcome, setup, session, and labels.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenNewTrade}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-4 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New trade</span>
        </button>
      </div>

      {/* Fuzzy Search & Filter Toolbar */}
      <div className="rounded-2xl glass-card p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#7f8fa8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Fuzzy search symbol, setup, label, or notes (e.g. eurusd, fomo, fvg)…"
              aria-label="Fuzzy search trades"
              className="w-full min-h-[44px] rounded-xl glass-input pl-10 pr-10 py-2 text-sm text-[#eef3fb] placeholder:text-[#63738c]"
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

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as '' | TradeOutcome)}
              aria-label="Filter by outcome"
              className="min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
            >
              <option value="">All outcomes</option>
              <option value="Win">Win</option>
              <option value="Loss">Loss</option>
              <option value="BE">BE</option>
            </select>

            <select
              value={setupFilter}
              onChange={(e) => setSetupFilter(e.target.value as '' | SetupType)}
              aria-label="Filter by setup"
              className="min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
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
              className="min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
            >
              <option value="">All sessions</option>
              <option value="London">London</option>
              <option value="New York">New York</option>
              <option value="Asia">Asia</option>
              <option value="Overlap">Overlap</option>
              <option value="Other">Other</option>
            </select>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExportBackup}
                className="flex-1 sm:flex-none min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl glass-subcard px-3.5 py-2 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition whitespace-nowrap"
              >
                <Download className="w-4 h-4 text-[#8df0c0]" />
                <span>Export</span>
              </button>

              <button
                type="button"
                onClick={() => onExportCSV(filteredTrades)}
                title="Export filtered rows as CSV"
                className="flex-1 sm:flex-none min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl glass-subcard px-3.5 py-2 text-sm font-semibold text-[#c6d3e6] hover:border-[#47dca0]/45 transition whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#8ebeff]" />
                <span>CSV</span>
              </button>
            </div>
          </div>
        </div>

        {/* Interactive Label / Tag Filter Bar */}
        {availableTags.length > 0 && (
          <div className="pt-2 border-t border-white/[0.07] flex items-center gap-2 overflow-x-auto pb-0.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#7f8fa8] shrink-0 pr-1">
              <Tag className="w-3.5 h-3.5 text-[#8df0c0]" />
              Tags
            </span>
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className={`min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                selectedTags.length === 0
                  ? 'bg-white/[0.12] border-white/25 text-[#eef3fb]'
                  : 'glass-subcard text-[#8b9ab0] hover:text-[#eef3fb]'
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
                  className={`min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-semibold border transition whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-[#47dca0]/18 border-[#47dca0]/55 text-[#8df0c0]'
                      : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb] hover:border-white/20'
                  }`}
                >
                  #{tag} · {count}
                </button>
              );
            })}
          </div>
        )}

        {/* Filtered Sample Telemetry + Reset */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[#7f8fa8]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              Showing <strong className="text-[#eef3fb]">{filteredTrades.length}</strong> of{' '}
              {trades.length} {trades.length === 1 ? 'trade' : 'trades'}
            </span>
            {filteredTrades.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Total PnL{' '}
                  <strong
                    className={`font-mono ${
                      filteredStats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                    }`}
                  >
                    {formatR(filteredStats.netR)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Profit{' '}
                  <strong className="font-mono text-[#47dca0]">
                    +{filteredStats.grossWin.toFixed(1)}R
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Loss{' '}
                  <strong className="font-mono text-[#ff7d91]">
                    -{filteredStats.grossLoss.toFixed(1)}R
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  WR <strong className="font-mono text-[#eef3fb]">{Math.round(filteredStats.winRate)}%</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Exp{' '}
                  <strong className="font-mono text-[#8ebeff]">
                    {formatR(filteredStats.expectancy)}
                  </strong>
                </span>
              </>
            )}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="font-semibold text-[#8df0c0] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Empty State or Trade List/Table */}
      {filteredTrades.length === 0 ? (
        <div className="rounded-2xl glass-card px-6 py-14 text-center space-y-3">
          <h3 className="text-lg font-bold text-[#eef3fb]">No trades found</h3>
          <p className="text-sm text-[#8b9ab0] max-w-sm mx-auto">
            {hasActiveFilters
              ? 'No entries matched your fuzzy search or active filters.'
              : 'Log your first trade to begin building your personal execution database.'}
          </p>
          <div className="pt-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-[44px] rounded-xl glass-subcard px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-white/25"
              >
                Clear search & filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenNewTrade}
                className="min-h-[44px] rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0]"
              >
                Log your first trade
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile Ergonomic List Rows (< md) */}
          <div className="md:hidden space-y-2.5">
            {filteredTrades.map((t) => {
              const outcomeColor =
                t.result === 'Win'
                  ? 'text-[#47dca0]'
                  : t.result === 'Loss'
                  ? 'text-[#ff7d91]'
                  : 'text-[#8ebeff]';
              const tradeTags = Array.isArray(t.tags) ? t.tags.filter(Boolean) : [];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrade(t)}
                  className="perf-row w-full rounded-2xl glass-card p-4 text-left hover:border-white/20 active:scale-[0.995] transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-base font-extrabold text-[#eef3fb]">
                          {t.pair}
                        </span>
                        <span className="text-xs text-[#7989a1]">·</span>
                        <span className="text-xs font-medium text-[#b3c0d4]">{t.direction}</span>
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
                        <p className="mt-1 text-[11px] font-medium text-[#8df0c0] truncate">
                          {tradeTags.map((tg) => `#${tg}`).join(' · ')}
                        </p>
                      )}
                      {t.notes && (
                        <p className="mt-1 text-xs text-[#7989a1] line-clamp-1">{t.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-base font-bold tabular-nums ${outcomeColor}`}>
                        {formatR(t.r)}
                      </p>
                      <p className={`text-xs font-semibold ${outcomeColor}`}>{t.result}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop High-Density Table (>= md) */}
          <div className="hidden md:block rounded-2xl glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-xs font-semibold text-[#7f8fa8]">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Symbol</th>
                    <th className="py-3.5 px-4">Side</th>
                    <th className="py-3.5 px-4">Setup</th>
                    <th className="py-3.5 px-4">Session</th>
                    <th className="py-3.5 px-4">Labels</th>
                    <th className="py-3.5 px-4">Outcome</th>
                    <th className="py-3.5 px-4 text-right">R multiple</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-sm">
                  {filteredTrades.map((t) => {
                    const outcomeColor =
                      t.result === 'Win'
                        ? 'text-[#47dca0]'
                        : t.result === 'Loss'
                        ? 'text-[#ff7d91]'
                        : 'text-[#8ebeff]';
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
                        className="cursor-pointer hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline-none transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono text-xs text-[#9aa8be] tabular-nums whitespace-nowrap">
                          {formatDate(t.date)}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-[#eef3fb] whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            {t.pair}
                            {t.images && t.images.length > 0 && (
                              <ImageIcon className="w-3.5 h-3.5 text-[#8ebeff]" />
                            )}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[#c2cde0] whitespace-nowrap">{t.direction}</td>
                        <td className="py-3.5 px-4 text-[#c2cde0] whitespace-nowrap">{t.setup}</td>
                        <td className="py-3.5 px-4 text-[#9aa8be] whitespace-nowrap">{t.session}</td>
                        <td className="py-3.5 px-4 text-xs text-[#8df0c0] max-w-[200px] truncate">
                          {tradeTags.length > 0 ? (
                            tradeTags.map((tg) => `#${tg}`).join(' · ')
                          ) : (
                            <span className="text-[#5b6b84]">—</span>
                          )}
                        </td>
                        <td className={`py-3.5 px-4 font-semibold whitespace-nowrap ${outcomeColor}`}>
                          {t.result}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${outcomeColor}`}
                        >
                          {formatR(t.r)}
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
