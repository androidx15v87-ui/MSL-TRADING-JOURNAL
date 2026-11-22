import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  calculateStats,
  formatDate,
  formatMetric,
  formatTime,
  formatTradePnL,
  getMostProfitableWeekday,
  groupPerformanceByWeekday,
  isoDate,
} from '../lib/calculations';
import type { JournalSettings, Trade } from '../types/journal';

interface CalendarScreenProps {
  trades: Trade[];
  settings?: JournalSettings;
  onLogTradeForDate: (dateIso: string) => void;
  onSelectTrade: (trade: Trade) => void;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const CalendarScreen: React.FC<CalendarScreenProps> = React.memo(({
  trades,
  settings,
  onLogTradeForDate,
  onSelectTrade,
}) => {
  const todayIso = isoDate(new Date());
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [weekdayScope, setWeekdayScope] = useState<'month' | 'all'>('month');

  const tradesByDate = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of trades) {
      const key = t.date.slice(0, 10);
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [trades]);

  const calendarCells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);

    return Array.from({ length: 42 }, (_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      const key = isoDate(d);
      const dayTrades = tradesByDate.get(key) || [];
      const dayStats = calculateStats(dayTrades, {
        defaultUnit: settings?.defaultPnlUnit,
        defaultCurrency: settings?.currency,
      });
      return {
        key,
        dayNum: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: key === todayIso,
        trades: dayTrades,
        executedCount: dayStats.totalTrades,
        missedCount: dayStats.missed.length,
        netR: dayStats.netR,
        primaryUnit: dayStats.primaryUnit,
        primaryCurrency: dayStats.primaryCurrency,
      };
    });
  }, [viewMonth, tradesByDate, todayIso, settings?.defaultPnlUnit, settings?.currency]);

  const selectedDayTrades = useMemo(() => {
    return [...(tradesByDate.get(selectedDate) || [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [tradesByDate, selectedDate]);

  const selectedDayStats = useMemo(
    () =>
      calculateStats(selectedDayTrades, {
        defaultUnit: settings?.defaultPnlUnit,
        defaultCurrency: settings?.currency,
      }),
    [selectedDayTrades, settings?.defaultPnlUnit, settings?.currency]
  );

  const monthTitle = viewMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const jumpToToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(isoDate(now));
  };

  const viewMonthPrefix = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`;

  const weekdayAnalytics = useMemo(() => {
    const scopedTrades =
      weekdayScope === 'month'
        ? trades.filter((t) => (t.date || '').slice(0, 7) === viewMonthPrefix)
        : trades;

    const scopedStats = calculateStats(scopedTrades, {
      defaultUnit: settings?.defaultPnlUnit,
      defaultCurrency: settings?.currency,
    });
    const unitFilter = scopedStats.isMixedUnits ? scopedStats.primaryUnit : undefined;
    const days = groupPerformanceByWeekday(scopedTrades, unitFilter);
    const bestDay = getMostProfitableWeekday(days);

    return {
      days,
      bestDay,
      totalWins: scopedStats.wins.length,
      totalLosses: scopedStats.losses.length,
      totalExecuted: scopedStats.totalTrades,
      primaryUnit: scopedStats.primaryUnit,
      primaryCurrency: scopedStats.primaryCurrency,
    };
  }, [trades, weekdayScope, viewMonthPrefix, settings?.defaultPnlUnit, settings?.currency]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#8df0c0]">
            Consistency tracker
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Trading calendar
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            Tap any date to review its executions or missed setups.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLogTradeForDate(selectedDate)}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-4 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add trade</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Calendar Grid Card */}
        <article className="lg:col-span-7 xl:col-span-8 rounded-2xl glass-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 pb-4">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subcard text-[#eef3fb] hover:border-[#47dca0]/40 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center">
              <h3 className="font-display text-base sm:text-lg font-bold text-[#eef3fb]">
                {monthTitle}
              </h3>
              <button
                type="button"
                onClick={jumpToToday}
                className="mt-0.5 text-xs font-semibold text-[#8df0c0] hover:underline"
              >
                Jump to today
              </button>
            </div>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subcard text-[#eef3fb] hover:border-[#47dca0]/40 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center pb-2">
            {WEEKDAYS.map((wd) => (
              <span
                key={wd}
                className="text-[10px] font-semibold tracking-wider text-[#6c7d96]"
              >
                {wd}
              </span>
            ))}
          </div>

          {/* 42 Day Cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell) => {
              const isSelected = cell.key === selectedDate;
              const hasExecuted = cell.executedCount > 0;
              const hasOnlyMissed = !hasExecuted && cell.missedCount > 0;
              const isPositive = hasExecuted && cell.netR > 0;
              const isNegative = hasExecuted && cell.netR < 0;

              let bgStyle = 'bg-white/[0.03] border-white/[0.07] text-[#c7d3e5]';
              if (!cell.inMonth) {
                bgStyle = 'bg-black/20 border-white/[0.03] text-[#4c5b73]';
              } else if (isPositive) {
                bgStyle = 'bg-[#47dca0]/12 border-[#47dca0]/40 text-[#eef3fb]';
              } else if (isNegative) {
                bgStyle = 'bg-[#ff7d91]/12 border-[#ff7d91]/40 text-[#eef3fb]';
              } else if (hasExecuted) {
                bgStyle = 'bg-[#8ebeff]/12 border-[#8ebeff]/40 text-[#eef3fb]';
              } else if (hasOnlyMissed) {
                bgStyle = 'bg-[#f5cc79]/12 border-[#f5cc79]/40 text-[#eef3fb]';
              }

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDate(cell.key)}
                  className={`min-h-[54px] sm:min-h-[66px] rounded-xl border p-1.5 flex flex-col justify-between text-left transition ${bgStyle} ${
                    isSelected ? 'ring-2 ring-[#47dca0] ring-offset-1 ring-offset-[#0d1423]' : ''
                  } ${cell.isToday && !isSelected ? 'border-[#8ebeff]' : ''}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`font-mono text-xs font-bold tabular-nums ${
                        cell.isToday ? 'text-[#8df0c0]' : ''
                      }`}
                    >
                      {cell.dayNum}
                    </span>
                    {(hasExecuted || hasOnlyMissed) && (
                      <span
                        className={`text-[9px] font-mono font-bold tabular-nums ${
                          isPositive
                            ? 'text-[#47dca0]'
                            : isNegative
                            ? 'text-[#ff7d91]'
                            : hasExecuted
                            ? 'text-[#8ebeff]'
                            : 'text-[#f5cc79]'
                        }`}
                      >
                        {cell.trades.length}
                      </span>
                    )}
                  </div>

                  {hasExecuted ? (
                    <span
                      className={`font-mono text-[10px] font-semibold tabular-nums truncate ${
                        isPositive
                          ? 'text-[#8df0c0]'
                          : isNegative
                          ? 'text-[#ff9aa9]'
                          : 'text-[#8ebeff]'
                      }`}
                    >
                      {formatMetric(cell.netR, cell.primaryUnit, cell.primaryCurrency, {
                        decimals: cell.primaryUnit === 'money' ? 0 : 2,
                      })}
                    </span>
                  ) : hasOnlyMissed ? (
                    <span className="text-[10px] font-semibold text-[#f5cc79] truncate">
                      {cell.missedCount} missed
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Semantic Legend */}
          <div className="mt-4 pt-3 border-t border-white/[0.08] flex flex-wrap items-center gap-4 text-xs text-[#8b9ab0]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#47dca0]" />
              Profitable day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#ff7d91]" />
              Losing day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#8ebeff]" />
              Breakeven
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#f5cc79]" />
              Missed setup
            </span>
          </div>
        </article>

        {/* Selected Day Review Panel */}
        <article className="lg:col-span-5 xl:col-span-4 rounded-2xl glass-card p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">
              Day review
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-[#eef3fb]">
              {formatDate(selectedDate, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </h3>
            <p className="mt-1 text-xs text-[#8b9ab0] tabular-nums">
              {selectedDayTrades.length === 0 ? (
                'No trades recorded for this date.'
              ) : (
                <>
                  {selectedDayStats.totalTrades > 0 && (
                    <>
                      {selectedDayStats.totalTrades}{' '}
                      {selectedDayStats.totalTrades === 1 ? 'executed' : 'executed'} · Net{' '}
                      {formatMetric(
                        selectedDayStats.netR,
                        selectedDayStats.primaryUnit,
                        selectedDayStats.primaryCurrency
                      )}
                    </>
                  )}
                  {selectedDayStats.missed.length > 0 && (
                    <span className="text-[#f5cc79] font-semibold">
                      {selectedDayStats.totalTrades > 0 ? ' · ' : ''}
                      {selectedDayStats.missed.length} missed
                    </span>
                  )}
                </>
              )}
            </p>

            <div className="mt-4 space-y-2.5">
              {selectedDayTrades.length === 0 ? (
                <div className="rounded-xl glass-subcard p-5 text-center text-xs text-[#7c8ca6]">
                  Nothing logged yet. Use this day to review setups or add an entry.
                </div>
              ) : (
                selectedDayTrades.map((t) => {
                  const color =
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
                      className="w-full rounded-xl glass-subcard p-3.5 text-left hover:border-[#304466] transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-[#eef3fb]">
                          {t.pair} · {t.direction}
                        </span>
                        <span className={`font-mono text-sm font-bold tabular-nums ${color}`}>
                          {formatTradePnL(t, settings?.defaultPnlUnit, settings?.currency)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#7f8fa8]">
                        {formatTime(t.date)} · {t.setup} · {t.session} ·{' '}
                        <span className={t.result === 'Missed' ? 'text-[#f5cc79] font-semibold' : ''}>
                          {t.result}
                        </span>
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onLogTradeForDate(selectedDate)}
            className="mt-5 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl glass-subcard px-4 py-2.5 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
          >
            <Plus className="w-4 h-4 text-[#8df0c0]" />
            <span>Log trade for this day</span>
          </button>
        </article>
      </div>

      {/* Day-of-Week Wins & Losses Breakdown (Monday to Sunday) */}
      <section className="rounded-2xl glass-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">
              Monday – Sunday breakdown
            </p>
            <h3 className="text-base font-bold text-[#eef3fb]">
              Wins &amp; losses by day of the week
            </h3>
            <p className="mt-0.5 text-xs text-[#8b9ab0] tabular-nums">
              {weekdayScope === 'month' ? monthTitle : 'All recorded trades'} ·{' '}
              <span className="text-[#47dca0] font-semibold font-mono">
                {weekdayAnalytics.totalWins}W
              </span>{' '}
              /{' '}
              <span className="text-[#ff7d91] font-semibold font-mono">
                {weekdayAnalytics.totalLosses}L
              </span>{' '}
              across {weekdayAnalytics.totalExecuted} executed
              {weekdayAnalytics.bestDay && weekdayAnalytics.bestDay.netR > 0 && (
                <>
                  {' · '}Most profitable:{' '}
                  <strong className="text-[#8df0c0]">{weekdayAnalytics.bestDay.fullLabel}</strong>
                </>
              )}
            </p>
          </div>

          <div
            role="group"
            aria-label="Weekday summary scope"
            className="inline-flex items-center rounded-xl glass-subcard p-1 self-start sm:self-auto shrink-0"
          >
            <button
              type="button"
              onClick={() => setWeekdayScope('month')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                weekdayScope === 'month'
                  ? 'bg-[#47dca0]/20 text-[#8df0c0]'
                  : 'text-[#8b9ab0] hover:text-[#eef3fb]'
              }`}
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => setWeekdayScope('all')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                weekdayScope === 'all'
                  ? 'bg-[#47dca0]/20 text-[#8df0c0]'
                  : 'text-[#8b9ab0] hover:text-[#eef3fb]'
              }`}
            >
              All time
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {weekdayAnalytics.days.map((day) => {
            const isTop =
              Boolean(weekdayAnalytics.bestDay) &&
              weekdayAnalytics.bestDay!.dayIndex === day.dayIndex &&
              day.netR > 0;
            const winShare =
              day.wins + day.losses > 0 ? (day.wins / (day.wins + day.losses)) * 100 : 0;
            const hasWL = day.wins + day.losses > 0;

            return (
              <div
                key={day.dayIndex}
                className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 transition ${
                  isTop
                    ? 'bg-[#47dca0]/[0.08] border-[#47dca0]/45'
                    : 'bg-white/[0.025] border-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-[#eef3fb]">{day.shortLabel}</span>
                  {isTop ? (
                    <span className="text-[10px] font-semibold text-[#8df0c0]">Top</span>
                  ) : (
                    <span className="font-mono text-[10px] tabular-nums text-[#70819b]">
                      {day.executedCount > 0 ? `${Math.round(day.winRate)}% WR` : '—'}
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                    <span className="text-sm font-bold text-[#47dca0]">{day.wins}W</span>
                    <span className="text-sm font-bold text-[#ff7d91]">{day.losses}L</span>
                  </div>
                  {(day.breakevens > 0 || day.missed > 0) && (
                    <p className="font-mono text-[10px] tabular-nums text-[#7c8ca6]">
                      {day.breakevens > 0 ? `${day.breakevens} BE` : ''}
                      {day.breakevens > 0 && day.missed > 0 ? ' · ' : ''}
                      {day.missed > 0 ? `${day.missed} missed` : ''}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden flex">
                    {hasWL ? (
                      <>
                        <div
                          className="h-full bg-[#47dca0]"
                          style={{ width: `${winShare}%` }}
                        />
                        <div
                          className="h-full bg-[#ff7d91]"
                          style={{ width: `${100 - winShare}%` }}
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                    <span className="text-[#7c8ca6]">Net</span>
                    <span
                      className={`font-bold ${
                        day.unitMatchedCount === 0
                          ? 'text-[#6c7d96]'
                          : day.netR > 0
                          ? 'text-[#47dca0]'
                          : day.netR < 0
                          ? 'text-[#ff7d91]'
                          : 'text-[#8ebeff]'
                      }`}
                    >
                      {day.unitMatchedCount > 0
                        ? formatMetric(
                            day.netR,
                            weekdayAnalytics.primaryUnit,
                            weekdayAnalytics.primaryCurrency,
                            { decimals: weekdayAnalytics.primaryUnit === 'money' ? 0 : 2 }
                          )
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
});

CalendarScreen.displayName = 'CalendarScreen';
