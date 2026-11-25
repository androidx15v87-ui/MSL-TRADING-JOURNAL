import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  calculateStats,
  formatDate,
  formatMetric,
  formatTradePnL,
  getMostProfitableWeekday,
  getUnitLongLabel,
  getUnitShortLabel,
  groupPerformance,
  groupPerformanceByTag,
  groupPerformanceByWeekday,
  normalizeMetricUnit,
} from '../lib/calculations';
import type { JournalSettings, MetricUnit, Trade } from '../types/journal';

interface AnalyticsScreenProps {
  trades: Trade[];
  settings?: JournalSettings;
  activeJournalName?: string;
  onSelectTrade: (trade: Trade) => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = React.memo(({
  trades,
  settings,
  activeJournalName,
  onSelectTrade,
}) => {
  const [selectedUnit, setSelectedUnit] = useState<MetricUnit | undefined>(undefined);

  const stats = useMemo(
    () =>
      calculateStats(trades, {
        unit: selectedUnit,
        defaultUnit: settings?.defaultPnlUnit,
        defaultCurrency: settings?.currency,
      }),
    [trades, selectedUnit, settings?.defaultPnlUnit, settings?.currency]
  );

  const activeUnit = stats.primaryUnit;
  const activeCurrency = stats.primaryCurrency;
  const unitShort = getUnitShortLabel(activeUnit, activeCurrency);
  const unitFilter = stats.isMixedUnits ? activeUnit : undefined;

  const bySetup = useMemo(
    () => groupPerformance(trades, 'setup', unitFilter),
    [trades, unitFilter]
  );
  const bySession = useMemo(
    () => groupPerformance(trades, 'session', unitFilter),
    [trades, unitFilter]
  );
  const byTag = useMemo(
    () => groupPerformanceByTag(trades, unitFilter),
    [trades, unitFilter]
  );
  const byWeekday = useMemo(
    () => groupPerformanceByWeekday(trades, unitFilter),
    [trades, unitFilter]
  );
  const mostProfitableWeekday = useMemo(
    () => getMostProfitableWeekday(byWeekday),
    [byWeekday]
  );

  const recentTrades = useMemo(() => {
    const unitMatched = unitFilter
      ? trades.filter((t) => normalizeMetricUnit(t.pnlUnit, 'r') === unitFilter)
      : trades;
    return [...unitMatched]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 14)
      .reverse();
  }, [trades, unitFilter]);

  const equityPoints = useMemo(() => {
    const executed = trades.filter((t) => {
      if (t.result === 'Missed') return false;
      if (unitFilter && normalizeMetricUnit(t.pnlUnit, 'r') !== unitFilter) return false;
      return true;
    });
    const ordered = [...executed].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return ordered.map((t, index) => {
      running = Math.round((running + Number(t.r || 0)) * 100) / 100;
      return {
        index: index + 1,
        label: `#${index + 1}`,
        equityR: running,
        tradeR: Number(t.r || 0),
        pair: t.pair,
        date: t.date,
        result: t.result,
      };
    });
  }, [trades, unitFilter]);

  const maxSetupAbs = Math.max(0.1, ...bySetup.map((x) => Math.abs(x.netR)));
  const maxSessionAbs = Math.max(0.1, ...bySession.map((x) => Math.abs(x.netR)));
  const maxTagAbs = Math.max(0.1, ...byTag.map((x) => Math.abs(x.netR)));
  const maxWeekdayAbs = Math.max(0.1, ...byWeekday.map((x) => Math.abs(x.netR)));
  const maxRecentAbs = Math.max(1, ...recentTrades.map((t) => Math.abs(Number(t.r || 0))));

  const finalEquityR =
    equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].equityR : 0;

  const streakLabel =
    stats.currentStreak.type === 'Win'
      ? `${stats.currentStreak.count}W`
      : stats.currentStreak.type === 'Loss'
      ? `${stats.currentStreak.count}L`
      : '—';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#8df0c0]">Evidence &amp; edge</p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Performance analytics
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            {activeJournalName
              ? `Computed from executed trades inside ${activeJournalName}.`
              : 'Computed directly from executed trades.'}
          </p>
        </div>

        {stats.unitBreakdown.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {stats.unitBreakdown.map((item) => (
              <button
                key={item.unit}
                type="button"
                onClick={() => setSelectedUnit(item.unit)}
                title={getUnitLongLabel(item.unit, item.currency)}
                className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold border transition tabular-nums ${
                  item.unit === activeUnit
                    ? 'bg-[#47dca0]/18 border-[#47dca0]/45 text-[#8df0c0]'
                    : 'bg-[#111c2d] border-[#23344f] text-[#8b9ab0] hover:text-[#eef3fb]'
                }`}
              >
                {getUnitShortLabel(item.unit, item.currency)} · {item.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <article className="rounded-2xl liquid-glass p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Total Net P&amp;L</p>
          <p
            className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums ${
              stats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
            }`}
          >
            {formatMetric(stats.netR, activeUnit, activeCurrency)}
          </p>
          <p className="mt-1.5 text-xs text-[#7f8fa8] tabular-nums">
            {formatMetric(stats.grossWin, activeUnit, activeCurrency, {
              decimals: activeUnit === 'money' ? 0 : 1,
            })}{' '}
            win /{' '}
            {formatMetric(-stats.grossLoss, activeUnit, activeCurrency, {
              decimals: activeUnit === 'money' ? 0 : 1,
            })}{' '}
            loss
          </p>
        </article>

        <article className="rounded-2xl glass-card p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Win rate</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#eef3fb]">
            {stats.totalTrades > 0 ? `${Math.round(stats.winRate)}%` : '—'}
          </p>
          <p className="mt-1.5 text-xs text-[#7f8fa8] tabular-nums">
            {stats.totalTrades} executed
            {stats.missed.length > 0 ? ` · ${stats.missed.length} missed` : ''}
          </p>
        </article>

        <article className="rounded-2xl glass-card p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Profit factor</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#eef3fb]">
            {stats.totalTrades > 0
              ? stats.profitFactor === Infinity
                ? '∞'
                : stats.profitFactor.toFixed(2)
              : '—'}
          </p>
          <p className="mt-1.5 text-xs text-[#7f8fa8] tabular-nums">
            Expectancy {formatMetric(stats.expectancy, activeUnit, activeCurrency)}
          </p>
        </article>

        <article className="rounded-2xl glass-card p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Max drawdown</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#ff7d91]">
            {stats.totalTrades > 0
              ? formatMetric(-stats.maxDrawdownR, activeUnit, activeCurrency)
              : '—'}
          </p>
          <p className="mt-1.5 text-xs text-[#7f8fa8] tabular-nums">
            Streak {streakLabel} · Best {stats.bestWinStreak}W
          </p>
        </article>
      </div>

      {/* Secondary Edge Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl glass-subcard px-4 py-3">
          <p className="text-[11px] text-[#7f8fa8]">Average winner</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#47dca0]">
            {formatMetric(stats.avgWinner, activeUnit, activeCurrency)}
          </p>
        </div>
        <div className="rounded-xl glass-subcard px-4 py-3">
          <p className="text-[11px] text-[#7f8fa8]">Average loser</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#ff7d91]">
            {formatMetric(stats.avgLoser, activeUnit, activeCurrency)}
          </p>
        </div>
        <div className="rounded-xl glass-subcard px-4 py-3">
          <p className="text-[11px] text-[#7f8fa8]">Best single trade</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#eef3fb]">
            {stats.totalTrades > 0
              ? formatMetric(stats.bestTradeR, activeUnit, activeCurrency)
              : '—'}
          </p>
        </div>
        <div className="rounded-xl glass-subcard px-4 py-3">
          <p className="text-[11px] text-[#7f8fa8]">Top session</p>
          <p className="mt-1 text-base font-bold text-[#8df0c0] truncate">
            {stats.bestSession ? stats.bestSession.name : '—'}
          </p>
        </div>
      </div>

      {/* Equity Curve */}
      {equityPoints.length >= 2 && (
        <article className="rounded-2xl glass-card p-5">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">Cumulative curve</p>
              <h3 className="text-base font-bold text-[#eef3fb]">Equity progression ({unitShort})</h3>
            </div>
            <span
              className={`font-mono text-sm font-bold tabular-nums ${
                finalEquityR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
              }`}
            >
              {formatMetric(finalEquityR, activeUnit, activeCurrency)}
            </span>
          </div>

          <div className="mt-4 h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityPoints} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="analyticsEqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={finalEquityR < 0 ? '#ff7d91' : '#47dca0'}
                      stopOpacity={0.32}
                    />
                    <stop
                      offset="100%"
                      stopColor={finalEquityR < 0 ? '#ff7d91' : '#47dca0'}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#8b9ab0', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#8b9ab0', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    formatMetric(v, activeUnit, activeCurrency, {
                      decimals: activeUnit === 'money' ? 0 : 1,
                    })
                  }
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.16)" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0].payload as (typeof equityPoints)[number];
                    return (
                      <div className="rounded-xl glass-modal px-3.5 py-2.5 text-xs space-y-1">
                        <p className="font-bold text-[#eef3fb]">
                          Trade #{pt.index} · {pt.pair}
                        </p>
                        <p className="text-[#8b9ab0]">{formatDate(pt.date)}</p>
                        <p className="text-[#9aa8be] tabular-nums">
                          Trade:{' '}
                          <span
                            className={`font-mono font-bold ${
                              pt.tradeR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                            }`}
                          >
                            {formatMetric(pt.tradeR, activeUnit, activeCurrency)}
                          </span>
                        </p>
                        <p className="text-[#9aa8be] tabular-nums">
                          Cumulative:{' '}
                          <span className="font-mono font-bold text-[#8ebeff]">
                            {formatMetric(pt.equityR, activeUnit, activeCurrency)}
                          </span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="equityR"
                  stroke={finalEquityR < 0 ? '#ff7d91' : '#47dca0'}
                  strokeWidth={2.2}
                  fill="url(#analyticsEqFill)"
                  animationDuration={260}
                  dot={{ r: 2.8, fill: finalEquityR < 0 ? '#ff7d91' : '#8df0c0', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#eef3fb' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
      )}

      {/* Breakdown by Setup, Session, and Label */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="pb-3 border-b border-white/[0.08]">
            <p className="text-xs font-medium text-[#8df0c0]">Strategy edge</p>
            <h3 className="text-base font-bold text-[#eef3fb]">By setup ({unitShort})</h3>
          </div>
          <div className="space-y-3.5">
            {bySetup.length === 0 ? (
              <p className="text-sm text-[#8b9ab0]">Log trades to see setup breakdown.</p>
            ) : (
              bySetup.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxSetupAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#eef3fb]">
                        {item.label}{' '}
                        <span className="text-[#7f8fa8] font-normal tabular-nums">
                          ({item.count} · {Math.round(item.winRate)}% WR)
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatMetric(item.netR, activeUnit, activeCurrency)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          negative ? 'bg-[#ff7d91]' : 'bg-[#47dca0]'
                        }`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="pb-3 border-b border-white/[0.08]">
            <p className="text-xs font-medium text-[#8ebeff]">Timing windows</p>
            <h3 className="text-base font-bold text-[#eef3fb]">By session ({unitShort})</h3>
          </div>
          <div className="space-y-3.5">
            {bySession.length === 0 ? (
              <p className="text-sm text-[#8b9ab0]">Log trades to see session breakdown.</p>
            ) : (
              bySession.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxSessionAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#eef3fb]">
                        {item.label}{' '}
                        <span className="text-[#7f8fa8] font-normal tabular-nums">
                          ({item.count} · {Math.round(item.winRate)}% WR)
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatMetric(item.netR, activeUnit, activeCurrency)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          negative ? 'bg-[#ff7d91]' : 'bg-[#47dca0]'
                        }`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="pb-3 border-b border-white/[0.08]">
            <p className="text-xs font-medium text-[#8df0c0]">Execution habits</p>
            <h3 className="text-base font-bold text-[#eef3fb]">By label</h3>
          </div>
          <div className="space-y-3.5">
            {byTag.length === 0 ? (
              <p className="text-xs leading-relaxed text-[#8b9ab0]">
                Add labels like Patient, A+ Setup, or FOMO when logging trades to reveal behavioral habits.
              </p>
            ) : (
              byTag.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxTagAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-[#eef3fb] truncate">
                        #{item.label}{' '}
                        <span className="text-[#7f8fa8] font-normal tabular-nums">
                          ({item.count} · {Math.round(item.winRate)}% WR)
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums shrink-0 ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatMetric(item.netR, activeUnit, activeCurrency)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          negative ? 'bg-[#ff7d91]' : 'bg-[#47dca0]'
                        }`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </div>

      {/* Day of Week (Monday to Sunday) & Most Profitable Day */}
      <article className="rounded-2xl glass-card p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">Weekly rhythm</p>
            <h3 className="text-base font-bold text-[#eef3fb]">
              Day-of-week performance (Monday – Sunday)
            </h3>
            <p className="mt-0.5 text-xs text-[#8b9ab0]">
              Wins, losses, win rate, and net {unitShort} profit across each weekday.
            </p>
          </div>

          <div className="rounded-xl glass-subcard px-4 py-2.5 flex items-center gap-4 shrink-0">
            <div>
              <p className="text-[11px] font-medium text-[#8b9ab0]">
                {mostProfitableWeekday && mostProfitableWeekday.netR <= 0
                  ? 'Strongest relative day'
                  : 'Most profitable day'}
              </p>
              <p className="font-display text-base font-extrabold text-[#eef3fb]">
                {mostProfitableWeekday ? mostProfitableWeekday.fullLabel : '—'}
              </p>
            </div>
            {mostProfitableWeekday && (
              <div className="pl-4 border-l border-white/[0.1] font-mono tabular-nums text-right">
                <p
                  className={`text-base font-bold ${
                    mostProfitableWeekday.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                  }`}
                >
                  {formatMetric(mostProfitableWeekday.netR, activeUnit, activeCurrency)}
                </p>
                <p className="text-[11px] text-[#8b9ab0]">
                  {mostProfitableWeekday.wins}W · {mostProfitableWeekday.losses}L ·{' '}
                  {Math.round(mostProfitableWeekday.winRate)}% WR
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {byWeekday.map((day) => {
            const pct = Math.min(100, (Math.abs(day.netR) / maxWeekdayAbs) * 100);
            const isTop =
              Boolean(mostProfitableWeekday) &&
              mostProfitableWeekday!.dayIndex === day.dayIndex &&
              day.netR > 0;
            const isNegative = day.netR < 0;
            const hasTrades = day.unitMatchedCount > 0;

            return (
              <div
                key={day.dayIndex}
                className={`rounded-xl glass-subcard p-3.5 space-y-2 ${
                  isTop ? 'border-[#47dca0]/45 bg-[#47dca0]/[0.06]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-[#eef3fb]">{day.fullLabel}</span>
                    {isTop && (
                      <span className="rounded-md bg-[#47dca0]/18 border border-[#47dca0]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#8df0c0]">
                        Most profitable
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-mono font-bold tabular-nums shrink-0 ${
                      !hasTrades
                        ? 'text-[#66768f]'
                        : isNegative
                        ? 'text-[#ff7d91]'
                        : day.netR > 0
                        ? 'text-[#47dca0]'
                        : 'text-[#8ebeff]'
                    }`}
                  >
                    {hasTrades ? formatMetric(day.netR, activeUnit, activeCurrency) : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#8b9ab0]">
                  <span>
                    <strong className="text-[#47dca0]">{day.wins}W</strong>
                    {' · '}
                    <strong className="text-[#ff7d91]">{day.losses}L</strong>
                    {day.breakevens > 0 ? ` · ${day.breakevens}BE` : ''}
                  </span>
                  <span>
                    {day.executedCount > 0 ? `${Math.round(day.winRate)}% win rate` : 'No trades'}
                  </span>
                </div>

                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  {hasTrades && day.netR !== 0 && (
                    <div
                      className={`h-full rounded-full ${
                        isNegative ? 'bg-[#ff7d91]' : 'bg-[#47dca0]'
                      }`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </article>

      {/* Recent Trade Outcomes Bar Chart */}
      <article className="rounded-2xl glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div>
            <p className="text-xs font-medium text-[#8ebeff]">Sequence</p>
            <h3 className="text-base font-bold text-[#eef3fb]">Recent trade outcomes</h3>
          </div>
          <span className="text-xs text-[#8b9ab0]">Click any bar to inspect</span>
        </div>

        {recentTrades.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#8b9ab0]">
            Trade outcomes will appear here once trades are logged.
          </p>
        ) : (
          <div className="flex items-end gap-2 sm:gap-3 overflow-x-auto pb-2 min-h-[144px]">
            {recentTrades.map((t) => {
              const rVal = Number(t.r || 0);
              const heightPx = Math.max(10, Math.round((Math.abs(rVal) / maxRecentAbs) * 84));
              const isMissed = t.result === 'Missed';
              const isWin = !isMissed && (t.result === 'Win' || rVal > 0);
              const isLoss = !isMissed && (t.result === 'Loss' || rVal < 0);
              const barColor = isMissed
                ? 'bg-[#f5cc79]/55 border border-dashed border-[#f5cc79]'
                : isLoss
                ? 'bg-[#ff7d91]'
                : isWin
                ? 'bg-[#47dca0]'
                : 'bg-[#8ebeff]';
              const textColor = isMissed
                ? 'text-[#f5cc79]'
                : isLoss
                ? 'text-[#ff7d91]'
                : isWin
                ? 'text-[#8df0c0]'
                : 'text-[#8ebeff]';
              const formattedVal = formatTradePnL(t, settings?.defaultPnlUnit, settings?.currency);

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrade(t)}
                  title={`${t.pair} · ${t.result} · ${formattedVal}`}
                  className="flex-1 min-w-[46px] flex flex-col items-center gap-1.5 group"
                >
                  <span className={`font-mono text-[10px] font-semibold tabular-nums ${textColor}`}>
                    {formattedVal}
                  </span>
                  <div className="h-[90px] flex items-end">
                    <div
                      className={`w-6 sm:w-7 rounded-t-md transition-opacity group-hover:opacity-80 ${barColor}`}
                      style={{ height: `${heightPx}px` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-[#dce5f4] truncate max-w-[56px]">
                    {t.pair}
                  </span>
                  <span className="font-mono text-[9px] text-[#7f8fa8] tabular-nums">
                    {isMissed ? 'Missed' : formatDate(t.date, { day: 'numeric', month: 'short' })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
});

AnalyticsScreen.displayName = 'AnalyticsScreen';
