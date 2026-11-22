import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Bot,
  CalendarDays,
  Copy,
  Plus,
  RefreshCw,
} from 'lucide-react';
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
  groupPerformance,
  groupPerformanceByTag,
  isoDate,
  normalizeMetricUnit,
  type MonthlyPnLPoint,
} from '../lib/calculations';
import type {
  JournalSettings,
  MetricUnit,
  PageId,
  SessionAlarm,
  Trade,
} from '../types/journal';

interface OverviewScreenProps {
  trades: Trade[];
  alarms: SessionAlarm[];
  settings?: JournalSettings;
  quote: QuoteItem;
  onNextQuote: () => void;
  onCopyQuote: () => void;
  onOpenLogTrade: () => void;
  onNavigate: (page: PageId) => void;
  onSelectTrade: (trade: Trade) => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = React.memo(({
  trades,
  alarms,
  settings,
  quote,
  onNextQuote,
  onCopyQuote,
  onOpenLogTrade,
  onNavigate,
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

  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [trades]
  );

  const upcomingAlarms = useMemo(() => {
    const now = new Date();
    return alarms
      .filter((a) => a.enabled)
      .map((a) => {
        const [hh, mm] = a.time.split(':').map(Number);
        const target = new Date();
        target.setHours(hh || 0, mm || 0, 0, 0);
        const isToday = target > now;
        if (!isToday) target.setDate(target.getDate() + 1);
        return { ...a, target, isToday };
      })
      .sort((a, b) => a.target.getTime() - b.target.getTime())
      .slice(0, 3);
  }, [alarms]);

  const monthSummary = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthTrades = trades.filter((t) => {
      const d = new Date(`${t.date.slice(0, 10)}T12:00:00`);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    const executedMonth = monthTrades.filter((t) => t.result !== 'Missed');

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      const key = isoDate(d);
      const dayTrades = monthTrades.filter((t) => t.date.slice(0, 10) === key);
      const dayExecuted = dayTrades.filter((t) => t.result !== 'Missed');
      const dayMissed = dayTrades.filter((t) => t.result === 'Missed');
      const unitTrades =
        unitFilter
          ? dayExecuted.filter((t) => normalizeMetricUnit(t.pnlUnit, 'r') === unitFilter)
          : dayExecuted;
      const net = unitTrades.reduce((acc, t) => acc + Number(t.r || 0), 0);
      const dayUnit =
        unitTrades[0]?.pnlUnit || dayExecuted[0]?.pnlUnit || activeUnit;
      const dayCurrency =
        unitTrades[0]?.currency || dayExecuted[0]?.currency || activeCurrency;
      return {
        key,
        day: i + 1,
        count: dayExecuted.length,
        missedCount: dayMissed.length,
        net,
        dayUnit,
        dayCurrency,
      };
    });

    return {
      monthLabel: now.toLocaleDateString(undefined, { month: 'long' }),
      totalCount: executedMonth.length,
      missedCount: monthTrades.length - executedMonth.length,
      days,
    };
  }, [trades, unitFilter, activeUnit, activeCurrency]);

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

  const topSetups = useMemo(
    () => groupPerformance(trades, 'setup', unitFilter).slice(0, 5),
    [trades, unitFilter]
  );

  const maxTopSetupAbs = useMemo(
    () => Math.max(0.1, ...topSetups.map((item) => Math.abs(item.netR))),
    [topSetups]
  );

  const sessionWinRates = useMemo(() => {
    return groupPerformance(trades, 'session', unitFilter).sort(
      (a, b) => b.winRate - a.winRate || b.netR - a.netR || b.count - a.count
    );
  }, [trades, unitFilter]);

  const topTagEdge = useMemo(() => {
    const grouped = groupPerformanceByTag(trades, unitFilter);
    return grouped.length > 0 ? grouped[0] : null;
  }, [trades, unitFilter]);

  const profitFactorLabel =
    stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);

  return (
    <div className="space-y-6">
      {/* Hero / Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl liquid-glass p-5 sm:p-7">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-4">
            <p className="text-xs font-semibold text-[#8df0c0]">
              Your process · Your edge
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eef3fb] leading-tight max-w-xl [text-wrap:balance]">
              Good trading starts with a clear plan.
            </h2>
            <p className="text-sm sm:text-base text-[#99a8bf] max-w-lg leading-relaxed">
              Read the market. Respect the plan. Track every execution, review the evidence, and build discipline one setup at a time.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onOpenLogTrade}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#eef3fb] px-4 py-2.5 text-sm font-bold text-[#080d18] hover:bg-white active:scale-[0.98] transition"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Log trade</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('calendar')}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl glass-subcard px-4 py-2.5 text-sm font-semibold text-[#eef3fb] hover:border-white/20 transition"
              >
                <CalendarDays className="w-4 h-4 text-[#8df0c0]" />
                <span>Open calendar</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ai')}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#47dca0]/15 border border-[#47dca0]/35 px-4 py-2.5 text-sm font-semibold text-[#8df0c0] hover:bg-[#47dca0]/25 transition"
              >
                <Bot className="w-4 h-4" />
                <span>Ask KAIROS</span>
              </button>
            </div>
          </div>

          {/* Geometric Candlestick & Equity Trajectory Artwork */}
          <div className="hidden lg:flex lg:col-span-5 justify-end">
            <div className="relative w-full max-w-[300px] h-44 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 flex flex-col justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="flex items-center justify-between text-xs text-[#8b9ab0]">
                <span className="font-medium">Execution rhythm</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    stats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                  }`}
                >
                  {formatMetric(stats.netR, activeUnit, activeCurrency)}
                </span>
              </div>
              <svg viewBox="0 0 260 96" className="w-full h-24 overflow-visible" aria-hidden="true">
                <line x1="0" y1="74" x2="260" y2="74" stroke="#1b283e" strokeWidth="1" />
                <line x1="0" y1="42" x2="260" y2="42" stroke="#162235" strokeDasharray="3 3" strokeWidth="1" />
                {/* Subtle candlestick silhouettes */}
                {[
                  { x: 20, h: 28, y: 46, win: true },
                  { x: 46, h: 18, y: 54, win: false },
                  { x: 72, h: 36, y: 34, win: true },
                  { x: 98, h: 22, y: 40, win: true },
                  { x: 124, h: 16, y: 52, win: false },
                  { x: 150, h: 42, y: 26, win: true },
                  { x: 176, h: 30, y: 32, win: true },
                  { x: 202, h: 20, y: 44, win: false },
                  { x: 228, h: 48, y: 18, win: true },
                ].map((bar, idx) => (
                  <g key={idx}>
                    <line
                      x1={bar.x + 5}
                      y1={bar.y - 6}
                      x2={bar.x + 5}
                      y2={bar.y + bar.h + 6}
                      stroke={bar.win ? '#2b6f5c' : '#5e2b39'}
                      strokeWidth="1.5"
                    />
                    <rect
                      x={bar.x}
                      y={bar.y}
                      width="10"
                      height={bar.h}
                      rx="3"
                      fill={bar.win ? '#47dca0' : '#ff7d91'}
                      fillOpacity={bar.win ? 0.85 : 0.72}
                    />
                  </g>
                ))}
                <path
                  d="M 16 64 Q 72 52, 128 42 T 242 16"
                  fill="none"
                  stroke="#8ebeff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              </svg>
              <div className="flex items-center justify-between text-xs text-[#8b9ab0] tabular-nums">
                <span>{Math.round(stats.winRate)}% win rate</span>
                <span>
                  {stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'}
                  {stats.missed.length > 0 ? ` · ${stats.missed.length} missed` : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Unit Switcher Bar (shown when account contains multiple P&L units) */}
      {stats.unitBreakdown.length > 1 && (
        <div className="rounded-2xl glass-subcard px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#8b9ab0]">
            Viewing metrics in{' '}
            <strong className="text-[#eef3fb]">
              {getUnitLongLabel(activeUnit, activeCurrency)}
            </strong>{' '}
            to keep cross-unit math exact.
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {stats.unitBreakdown.map((item) => {
              const active = item.unit === activeUnit;
              return (
                <button
                  key={item.unit}
                  type="button"
                  onClick={() => setSelectedUnit(item.unit)}
                  className={`min-h-[34px] rounded-xl px-3 py-1 text-xs font-semibold border transition tabular-nums ${
                    active
                      ? 'bg-[#47dca0]/18 border-[#47dca0]/55 text-[#8df0c0]'
                      : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
                  }`}
                >
                  {getUnitShortLabel(item.unit, item.currency)} · {item.count}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4 Core KPI Stat Cards */}
      <section aria-label="Performance metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <article className="rounded-2xl liquid-glass p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Total PnL</p>
          <p
            className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${
              stats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
            }`}
          >
            {formatMetric(stats.netR, activeUnit, activeCurrency)}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1] tabular-nums">
            <span className="text-[#47dca0]">
              {formatMetric(stats.grossWin, activeUnit, activeCurrency, {
                decimals: activeUnit === 'money' ? 0 : 1,
              })}
            </span>{' '}
            profit ·{' '}
            <span className="text-[#ff7d91]">
              {formatMetric(-stats.grossLoss, activeUnit, activeCurrency, {
                decimals: activeUnit === 'money' ? 0 : 1,
              })}
            </span>{' '}
            loss
          </p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Win rate</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-[#eef3fb]">
            {Math.round(stats.winRate)}%
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#172236] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#47dca0] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, stats.winRate))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[#7989a1] tabular-nums">
            {stats.wins.length} wins · {stats.losses.length} losses
            {stats.breakevens.length > 0 ? ` · ${stats.breakevens.length} BE` : ''}
            {stats.missed.length > 0 && (
              <span className="text-[#f5cc79]"> · {stats.missed.length} missed</span>
            )}
          </p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Expectancy</p>
          <p
            className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${
              stats.expectancy < 0
                ? 'text-[#ff7d91]'
                : stats.expectancy > 0
                ? 'text-[#8df0c0]'
                : 'text-[#eef3fb]'
            }`}
          >
            {formatMetric(stats.expectancy, activeUnit, activeCurrency)}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1]">
            Avg {unitShort} per executed trade
          </p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Profit factor</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-[#eef3fb]">
            {profitFactorLabel}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1] tabular-nums">
            {formatMetric(stats.grossWin, activeUnit, activeCurrency, {
              decimals: activeUnit === 'money' ? 0 : 1,
            })}{' '}
            ÷{' '}
            {formatMetric(stats.grossLoss, activeUnit, activeCurrency, {
              signed: false,
              decimals: activeUnit === 'money' ? 0 : 1,
            })}
          </p>
        </article>
      </section>

      {/* Recharts 6-Month Monthly PnL Summary Chart */}
      <section className="rounded-2xl glass-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                6-month growth
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">
                Monthly PnL summary (Net {unitShort})
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-[#8b9ab0] tabular-nums">
                6M Net:{' '}
                <strong
                  className={`font-mono ${
                    sixMonthSummary.totalR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                  }`}
                >
                  {formatMetric(sixMonthSummary.totalR, activeUnit, activeCurrency)}
                </strong>
              </span>
              {sixMonthSummary.best && (
                <span className="text-[#8b9ab0] tabular-nums">
                  Best month:{' '}
                  <strong className="font-mono text-[#8df0c0]">
                    {sixMonthSummary.best.label} (
                    {formatMetric(sixMonthSummary.best.netR, activeUnit, activeCurrency)})
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyPnL} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#8b9ab0', fontSize: 12 }}
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
                          Monthly Net:{' '}
                          <span
                            className={`font-mono font-bold ${
                              point.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                            }`}
                          >
                            {formatMetric(point.netR, activeUnit, activeCurrency)}
                          </span>
                        </p>
                        <p className="text-[#9aa8be] tabular-nums">
                          6M Cumulative:{' '}
                          <span className="font-mono font-semibold text-[#8ebeff]">
                            {formatMetric(point.cumulativeR, activeUnit, activeCurrency)}
                          </span>
                        </p>
                        <p className="text-[#7f8fa8] tabular-nums">
                          {point.tradesCount} {point.tradesCount === 1 ? 'trade' : 'trades'}
                          {point.tradesCount > 0 ? ` · ${point.winRate}% WR` : ''}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="netR" radius={[6, 6, 0, 0]} maxBarSize={42} animationDuration={240}>
                  {monthlyPnL.map((entry) => (
                    <Cell
                      key={entry.monthKey}
                      fill={
                        entry.netR > 0
                          ? '#47dca0'
                          : entry.netR < 0
                          ? '#ff7d91'
                          : 'rgba(255,255,255,0.14)'
                      }
                      fillOpacity={entry.tradesCount === 0 ? 0.25 : 0.85}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="cumulativeR"
                  stroke="#8ebeff"
                  strokeWidth={2}
                  animationDuration={240}
                  dot={{ r: 3, fill: '#8ebeff', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#eef3fb' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#7f8fa8]">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#47dca0]" />
                Monthly net {unitShort}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 bg-[#8ebeff]" />
                Cumulative 6M growth
              </span>
            </div>
            <span>
              {sixMonthSummary.totalTrades === 0
                ? `Log executed trades to plot your 6-month ${unitShort} trajectory`
                : `${sixMonthSummary.totalTrades} executed trades in the last 6 months`}
            </span>
          </div>
      </section>

      {/* Top 5 Setup Performance & Session Win Rate */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <article className="rounded-2xl glass-card p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-xs font-medium text-[#8df0c0]">Setup edge</p>
                    <h3 className="text-base font-bold text-[#eef3fb]">Top 5 Setup Performance</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('analytics')}
                    className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#b4f7d8] transition whitespace-nowrap"
                  >
                    <span>Analytics</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {topSetups.length === 0 ? (
                  <div className="py-8 text-center space-y-2.5">
                    <p className="text-sm font-medium text-[#9aa8be]">
                      No executed setup data yet.
                    </p>
                    <p className="text-xs text-[#6e7e98]">
                      Log trades with your setup type to rank your top-performing strategies.
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={onOpenLogTrade}
                        className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3.5 py-1.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Log trade</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3.5">
                    {topSetups.map((item, idx) => {
                      const pct = Math.min(100, (Math.abs(item.netR) / maxTopSetupAbs) * 100);
                      const negative = item.netR < 0;
                      return (
                        <div key={item.label} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[11px] font-bold tabular-nums text-[#7989a1]">
                                #{idx + 1}
                              </span>
                              <span className="font-bold text-[#eef3fb] truncate">{item.label}</span>
                              <span className="text-[#7f8fa8] font-mono tabular-nums whitespace-nowrap">
                                {item.wins}W · {item.losses}L · {Math.round(item.winRate)}% WR
                              </span>
                            </div>
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
                              className={`h-full rounded-full transition-all duration-300 ${
                                negative ? 'bg-[#ff7d91]' : 'bg-[#47dca0]'
                              }`}
                              style={{ width: `${Math.max(5, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>

        <article className="rounded-2xl glass-card p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-xs font-medium text-[#8df0c0]">Timing accuracy</p>
                    <h3 className="text-base font-bold text-[#eef3fb]">Session Win Rate</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('analytics')}
                    className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#b4f7d8] transition whitespace-nowrap"
                  >
                    <span>Analytics</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {sessionWinRates.length === 0 ? (
                  <div className="py-8 text-center space-y-2.5">
                    <p className="text-sm font-medium text-[#9aa8be]">
                      No session statistics yet.
                    </p>
                    <p className="text-xs text-[#6e7e98]">
                      Track trades across London, New York, Asia, or Overlap to measure session win rates.
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={onOpenLogTrade}
                        className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3.5 py-1.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Log trade</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3.5">
                    {sessionWinRates.map((item, idx) => {
                      const wr = Math.round(item.winRate);
                      const isStrong = wr >= 50;
                      return (
                        <div key={item.label} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-bold text-[#eef3fb] truncate">
                                {item.label}
                              </span>
                              {idx === 0 && sessionWinRates.length > 1 && (
                                <span className="text-[11px] font-semibold text-[#8df0c0] whitespace-nowrap">
                                  · Highest WR
                                </span>
                              )}
                              <span className="text-[#7f8fa8] font-mono tabular-nums whitespace-nowrap">
                                {item.wins}W · {item.losses}L ({item.count})
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums">
                              <span
                                className={`text-[11px] font-semibold ${
                                  item.netR < 0 ? 'text-[#ff7d91]' : 'text-[#8ebeff]'
                                }`}
                              >
                                {formatMetric(item.netR, activeUnit, activeCurrency)}
                              </span>
                              <span
                                className={`font-bold ${
                                  isStrong ? 'text-[#47dca0]' : 'text-[#eef3fb]'
                                }`}
                              >
                                {wr}%
                              </span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isStrong ? 'bg-[#47dca0]' : 'bg-[#8ebeff]'
                              }`}
                              style={{ width: `${Math.max(4, Math.min(100, item.winRate))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
      </section>


      {/* Recent Executions + Daily Motivational Quote */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <article className="lg:col-span-7 rounded-2xl glass-card p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                Latest log
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Recent executions</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('journal')}
              className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#b4f7d8] transition whitespace-nowrap"
            >
              <span>View all</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3 flex-1 divide-y divide-white/[0.06]">
            {recentTrades.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm font-medium text-[#9aa8be]">Your trade history will appear here.</p>
                <p className="text-xs text-[#6e7e98]">
                  Log your first execution or missed setup to build your performance evidence.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={onOpenLogTrade}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-4 py-2 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Log first trade</span>
                  </button>
                </div>
              </div>
            ) : (
              recentTrades.map((t) => {
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
                    className="w-full min-h-[56px] py-3 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#eef3fb]">{t.pair}</span>
                        <span className="text-xs text-[#7989a1]">·</span>
                        <span className="text-xs text-[#9aa8be]">{t.direction}</span>
                        {tradeTags.length > 0 && (
                          <span className="hidden sm:inline text-[11px] font-medium text-[#8df0c0] truncate">
                            · #{tradeTags[0]}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[#7c8ca6] truncate">
                        {formatDate(t.date)} · {t.setup} · {t.session}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-sm font-bold tabular-nums ${outcomeColor}`}>
                        {formatTradePnL(t, settings?.defaultPnlUnit, settings?.currency)}
                      </p>
                      <p
                        className={`text-[11px] font-semibold ${
                          t.result === 'Missed' ? 'text-[#f5cc79]' : 'text-[#7c8ca6]'
                        }`}
                      >
                        {t.result}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="lg:col-span-5 rounded-2xl glass-card p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">
              Daily focus
            </p>
            <h3 className="mt-0.5 text-base font-bold text-[#eef3fb]">Discipline reminder</h3>

            <blockquote className="mt-5 text-base sm:text-lg font-medium leading-relaxed text-[#e6edf8]">
              “{quote.text}”
            </blockquote>
            <p className="mt-3 text-xs font-medium text-[#8b9ab0]">— {quote.source}</p>

            {topTagEdge && (
              <div className="mt-5 pt-3 border-t border-white/[0.08] flex items-center justify-between gap-2 text-xs">
                <span className="text-[#8b9ab0]">Top label edge</span>
                <span className="font-semibold text-[#eef3fb] tabular-nums">
                  #{topTagEdge.label}{' '}
                  <span className={topTagEdge.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'}>
                    ({formatMetric(topTagEdge.netR, activeUnit, activeCurrency)})
                  </span>
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center gap-2.5">
            <button
              type="button"
              onClick={onNextQuote}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl glass-subcard px-4 py-2 text-xs sm:text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#8df0c0]" />
              <span>Another quote</span>
            </button>
            <button
              type="button"
              onClick={onCopyQuote}
              title="Copy quote"
              aria-label="Copy quote"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subcard text-[#9aa8be] hover:text-[#eef3fb] transition"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </article>
      </section>

      {/* Session Reminders & Monthly Activity Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <article className="rounded-2xl glass-card p-5">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                Next up
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Session reminders</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#b4f7d8] transition"
            >
              <span>Configure</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-2 divide-y divide-white/[0.06]">
            {upcomingAlarms.length === 0 ? (
              <p className="py-6 text-sm text-[#7f8fa8]">
                No session alarms enabled. Configure local reminders in Settings.
              </p>
            ) : (
              upcomingAlarms.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-2.5">
                    <Bell className="w-4 h-4 text-[#47dca0] shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#eef3fb]">{a.name}</p>
                      <p className="text-xs text-[#7c8ca6]">
                        {a.isToday ? 'Today · Device local time' : 'Tomorrow · Device local time'}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-[#8df0c0]">
                    {a.time}
                  </span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl glass-card p-5">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                This month
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">
                {monthSummary.monthLabel} activity
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#b4f7d8] transition"
            >
              <span>Calendar</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-3xl font-bold tabular-nums text-[#eef3fb]">
              {monthSummary.totalCount}
            </span>
            <span className="text-xs text-[#8b9ab0]">
              {monthSummary.totalCount === 1 ? 'executed trade' : 'executed trades'} this month
              {monthSummary.missedCount > 0 && (
                <span className="text-[#f5cc79] font-semibold">
                  {' '}
                  · {monthSummary.missedCount} missed
                </span>
              )}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-7 sm:grid-cols-10 gap-1.5">
            {monthSummary.days.map((d) => {
              let tone = 'bg-white/[0.04] border-white/[0.08]';
              if (d.count > 0) {
                if (d.net > 0) tone = 'bg-[#47dca0]/30 border-[#47dca0]/60';
                else if (d.net < 0) tone = 'bg-[#ff7d91]/30 border-[#ff7d91]/60';
                else tone = 'bg-[#8ebeff]/30 border-[#8ebeff]/60';
              } else if (d.missedCount > 0) {
                tone = 'bg-[#f5cc79]/25 border-[#f5cc79]/55';
              }
              const tooltipParts: string[] = [];
              if (d.count > 0) {
                tooltipParts.push(
                  `${d.count} trade${d.count === 1 ? '' : 's'} (${formatMetric(
                    d.net,
                    d.dayUnit,
                    d.dayCurrency
                  )})`
                );
              }
              if (d.missedCount > 0) {
                tooltipParts.push(`${d.missedCount} missed`);
              }
              return (
                <div
                  key={d.key}
                  title={tooltipParts.length > 0 ? `${d.key}: ${tooltipParts.join(' · ')}` : d.key}
                  className={`h-6 rounded-md border flex items-center justify-center font-mono text-[10px] tabular-nums text-[#9aa8be] ${tone}`}
                >
                  {d.day}
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
});

OverviewScreen.displayName = 'OverviewScreen';
