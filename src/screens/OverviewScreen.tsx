import React, { useMemo } from 'react';
import { ArrowUpRight, Bell, Bot, CalendarDays, Copy, Plus, RefreshCw } from 'lucide-react';
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
  formatR,
  groupPerformanceByTag,
  isoDate,
  type MonthlyPnLPoint,
} from '../lib/calculations';
import type { PageId, SessionAlarm, Trade } from '../types/journal';

interface OverviewScreenProps {
  trades: Trade[];
  alarms: SessionAlarm[];
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
  quote,
  onNextQuote,
  onCopyQuote,
  onOpenLogTrade,
  onNavigate,
  onSelectTrade,
}) => {
  const stats = useMemo(() => calculateStats(trades), [trades]);

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

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      const key = isoDate(d);
      const dayTrades = monthTrades.filter((t) => t.date.slice(0, 10) === key);
      const net = dayTrades.reduce((acc, t) => acc + Number(t.r || 0), 0);
      return {
        key,
        day: i + 1,
        count: dayTrades.length,
        net,
      };
    });

    return {
      monthLabel: now.toLocaleDateString(undefined, { month: 'long' }),
      totalCount: monthTrades.length,
      days,
    };
  }, [trades]);

  const monthlyPnL = useMemo(() => calculateMonthlyPnL(trades, 6), [trades]);

  const sixMonthSummary = useMemo(() => {
    const totalR = monthlyPnL.reduce((sum, m) => sum + m.netR, 0);
    const totalTrades = monthlyPnL.reduce((sum, m) => sum + m.tradesCount, 0);
    const best = monthlyPnL.reduce<MonthlyPnLPoint | null>(
      (acc, m) => (m.tradesCount > 0 && (!acc || m.netR > acc.netR) ? m : acc),
      null
    );
    return { totalR, totalTrades, best };
  }, [monthlyPnL]);

  const topTagEdge = useMemo(() => {
    const grouped = groupPerformanceByTag(trades);
    return grouped.length > 0 ? grouped[0] : null;
  }, [trades]);

  const profitFactorLabel =
    stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);

  return (
    <div className="space-y-6">
      {/* Hero / Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl glass-card p-5 sm:p-7">
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
                <span>Ask MSL AI</span>
              </button>
            </div>
          </div>

          {/* Geometric Candlestick & Equity Trajectory Artwork */}
          <div className="hidden lg:flex lg:col-span-5 justify-end">
            <div className="relative w-full max-w-[300px] h-44 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#8b9ab0]">
                <span className="font-medium">Execution rhythm</span>
                <span className="font-mono font-semibold text-[#47dca0] tabular-nums">{formatR(stats.netR)}</span>
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
                <span>{stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Core KPI Stat Cards */}
      <section aria-label="Performance metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Net performance</p>
          <p
            className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${
              stats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
            }`}
          >
            {formatR(stats.netR)}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1] tabular-nums">
            {stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'} · DD -{stats.maxDrawdownR.toFixed(1)}R
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
            {formatR(stats.expectancy)}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1]">Avg R per trade (BE incl.)</p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Profit factor</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-[#eef3fb]">
            {profitFactorLabel}
          </p>
          <p className="mt-1.5 text-xs text-[#7989a1] tabular-nums">
            +{stats.grossWin.toFixed(1)}R ÷ {stats.grossLoss.toFixed(1)}R
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
            <h3 className="text-base font-bold text-[#eef3fb]">Monthly PnL summary (Net R)</h3>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-[#8b9ab0] tabular-nums">
              6M Net:{' '}
              <strong
                className={`font-mono ${
                  sixMonthSummary.totalR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                }`}
              >
                {formatR(sixMonthSummary.totalR)}
              </strong>
            </span>
            {sixMonthSummary.best && (
              <span className="text-[#8b9ab0] tabular-nums">
                Best month:{' '}
                <strong className="font-mono text-[#8df0c0]">
                  {sixMonthSummary.best.label} ({formatR(sixMonthSummary.best.netR)})
                </strong>
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyPnL} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
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
                tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}R`}
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
                          {formatR(point.netR)}
                        </span>
                      </p>
                      <p className="text-[#9aa8be] tabular-nums">
                        6M Cumulative:{' '}
                        <span className="font-mono font-semibold text-[#8ebeff]">
                          {formatR(point.cumulativeR)}
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
              <Bar dataKey="netR" radius={[6, 6, 0, 0]} maxBarSize={42}>
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
              Monthly net R
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 bg-[#8ebeff]" />
              Cumulative 6M growth
            </span>
          </div>
          <span>
            {sixMonthSummary.totalTrades === 0
              ? 'Log trades to plot your 6-month net R trajectory'
              : `${sixMonthSummary.totalTrades} trades in the last 6 months`}
          </span>
        </div>
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
                  Log your first execution to track R performance and statistics.
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
                        {formatR(t.r)}
                      </p>
                      <p className="text-[11px] text-[#7c8ca6]">{t.result}</p>
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
                    ({formatR(topTagEdge.netR)})
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

          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-[#eef3fb]">
              {monthSummary.totalCount}
            </span>
            <span className="text-xs text-[#8b9ab0]">
              {monthSummary.totalCount === 1 ? 'trade' : 'trades'} this month
            </span>
          </div>

          <div className="mt-4 grid grid-cols-7 sm:grid-cols-10 gap-1.5">
            {monthSummary.days.map((d) => {
              let tone = 'bg-white/[0.04] border-white/[0.08]';
              if (d.count > 0) {
                if (d.net > 0) tone = 'bg-[#47dca0]/30 border-[#47dca0]/60';
                else if (d.net < 0) tone = 'bg-[#ff7d91]/30 border-[#ff7d91]/60';
                else tone = 'bg-[#8ebeff]/30 border-[#8ebeff]/60';
              }
              return (
                <div
                  key={d.key}
                  title={`${d.key}: ${d.count} trade${d.count === 1 ? '' : 's'}${d.count ? ` (${formatR(d.net)})` : ''}`}
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
