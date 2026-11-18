import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatDate, formatR, formatTime, isoDate } from '../lib/calculations';
import type { Trade } from '../types/journal';

interface CalendarScreenProps {
  trades: Trade[];
  onLogTradeForDate: (dateIso: string) => void;
  onSelectTrade: (trade: Trade) => void;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const CalendarScreen: React.FC<CalendarScreenProps> = React.memo(({
  trades,
  onLogTradeForDate,
  onSelectTrade,
}) => {
  const todayIso = isoDate(new Date());
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

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
      const netR = dayTrades.reduce((sum, t) => sum + Number(t.r || 0), 0);
      return {
        key,
        dayNum: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: key === todayIso,
        trades: dayTrades,
        netR,
      };
    });
  }, [viewMonth, tradesByDate, todayIso]);

  const selectedDayTrades = useMemo(() => {
    return [...(tradesByDate.get(selectedDate) || [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [tradesByDate, selectedDate]);

  const selectedDayNet = useMemo(
    () => selectedDayTrades.reduce((sum, t) => sum + Number(t.r || 0), 0),
    [selectedDayTrades]
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
            Tap any date to review its trades or add a new execution.
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
              const hasTrades = cell.trades.length > 0;
              const isPositive = hasTrades && cell.netR > 0;
              const isNegative = hasTrades && cell.netR < 0;

              let bgStyle = 'bg-white/[0.03] border-white/[0.07] text-[#c7d3e5]';
              if (!cell.inMonth) {
                bgStyle = 'bg-black/20 border-white/[0.03] text-[#4c5b73]';
              } else if (isPositive) {
                bgStyle = 'bg-[#47dca0]/12 border-[#47dca0]/40 text-[#eef3fb]';
              } else if (isNegative) {
                bgStyle = 'bg-[#ff7d91]/12 border-[#ff7d91]/40 text-[#eef3fb]';
              } else if (hasTrades) {
                bgStyle = 'bg-[#8ebeff]/12 border-[#8ebeff]/40 text-[#eef3fb]';
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
                    {hasTrades && (
                      <span
                        className={`text-[9px] font-mono font-bold tabular-nums ${
                          isPositive
                            ? 'text-[#47dca0]'
                            : isNegative
                            ? 'text-[#ff7d91]'
                            : 'text-[#8ebeff]'
                        }`}
                      >
                        {cell.trades.length}
                      </span>
                    )}
                  </div>

                  {hasTrades && (
                    <span
                      className={`font-mono text-[10px] font-semibold tabular-nums truncate ${
                        isPositive
                          ? 'text-[#8df0c0]'
                          : isNegative
                          ? 'text-[#ff9aa9]'
                          : 'text-[#8ebeff]'
                      }`}
                    >
                      {formatR(cell.netR)}
                    </span>
                  )}
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
              Trade logged / BE
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
              {selectedDayTrades.length > 0
                ? `${selectedDayTrades.length} ${
                    selectedDayTrades.length === 1 ? 'trade' : 'trades'
                  } · Net ${formatR(selectedDayNet)}`
                : 'No trades recorded for this date.'}
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
                          {formatR(t.r)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#7f8fa8]">
                        {formatTime(t.date)} · {t.setup} · {t.session} · {t.result}
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
    </div>
  );
});

CalendarScreen.displayName = 'CalendarScreen';
