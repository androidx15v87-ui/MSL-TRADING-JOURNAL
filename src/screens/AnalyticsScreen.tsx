import React, { useMemo } from 'react';
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
  formatR,
  groupPerformance,
  groupPerformanceByTag,
} from '../lib/calculations';
import type { Trade } from '../types/journal';

interface AnalyticsScreenProps {
  trades: Trade[];
  onSelectTrade: (trade: Trade) => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = React.memo(({
  trades,
  onSelectTrade,
}) => {
  const stats = useMemo(() => calculateStats(trades), [trades]);
  const bySetup = useMemo(() => groupPerformance(trades, 'setup'), [trades]);
  const bySession = useMemo(() => groupPerformance(trades, 'session'), [trades]);
  const byTag = useMemo(() => groupPerformanceByTag(trades), [trades]);

  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16).reverse(),
    [trades]
  );

  const equityPoints = useMemo(() => {
    const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));
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
  }, [trades]);

  const maxSetupAbs = Math.max(0.1, ...bySetup.map((x) => Math.abs(x.netR)));
  const maxSessionAbs = Math.max(0.1, ...bySession.map((x) => Math.abs(x.netR)));
  const maxTagAbs = Math.max(0.1, ...byTag.map((x) => Math.abs(x.netR)));
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
      <div>
        <p className="text-xs font-medium text-[#8df0c0]">
          Measure the edge
        </p>
        <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
          Performance analytics
        </h2>
        <p className="mt-1 text-sm text-[#8b9ab0]">
          Computed directly from your logged trades. Audit expectancy, drawdown, sessions, and behavioral tags.
        </p>
      </div>

      {/* Featured Total PnL Liquid-Glass Breakdown */}
      <section aria-label="Total PnL Summary" className="rounded-2xl liquid-glass p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 items-center">
          <div>
            <p className="text-xs font-medium text-[#8b9ab0]">Total Net PnL</p>
            <p
              className={`mt-1.5 font-mono text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${
                stats.netR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
              }`}
            >
              {formatR(stats.netR)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#8b9ab0]">Total Profits</p>
            <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold tabular-nums text-[#47dca0]">
              +{stats.grossWin.toFixed(2)}R
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#8b9ab0]">Total Losses</p>
            <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold tabular-nums text-[#ff7d91]">
              -{stats.grossLoss.toFixed(2)}R
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#8b9ab0]">Profit Factor</p>
            <p className="mt-1.5 font-mono text-xl sm:text-2xl font-bold tabular-nums text-[#eef3fb]">
              {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            </p>
          </div>
        </div>
      </section>

      {/* Top 4 Core Analytics Stat Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Trades logged</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#eef3fb]">
            {stats.totalTrades}
          </p>
          <p className="mt-1 text-xs text-[#7989a1]">Total sample size</p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Average winner</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#47dca0]">
            {formatR(stats.avgWinner)}
          </p>
          <p className="mt-1 text-xs text-[#7989a1]">Winning trades only</p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Average loser</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[#ff7d91]">
            {formatR(stats.avgLoser)}
          </p>
          <p className="mt-1 text-xs text-[#7989a1]">Losses only</p>
        </article>

        <article className="rounded-2xl glass-card p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8b9ab0]">Best session</p>
          <p className="mt-2 font-display text-xl sm:text-2xl font-extrabold text-[#8df0c0] truncate">
            {stats.bestSession ? stats.bestSession.name : '—'}
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-[#7989a1]">
            {stats.bestSession ? `${formatR(stats.bestSession.netR)} net R` : 'By net R'}
          </p>
        </article>
      </section>

      {/* Secondary Risk & Streak Telemetry Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <article className="rounded-2xl glass-subcard p-4">
          <p className="text-[11px] font-medium text-[#8b9ab0]">Max drawdown</p>
          <p className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#ff7d91]">
            -{stats.maxDrawdownR.toFixed(2)}R
          </p>
          <p className="mt-0.5 text-[11px] text-[#70819b]">Peak-to-trough R</p>
        </article>

        <article className="rounded-2xl glass-subcard p-4">
          <p className="text-[11px] font-medium text-[#8b9ab0]">Current streak</p>
          <p
            className={`mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums ${
              stats.currentStreak.type === 'Win'
                ? 'text-[#47dca0]'
                : stats.currentStreak.type === 'Loss'
                ? 'text-[#ff7d91]'
                : 'text-[#eef3fb]'
            }`}
          >
            {streakLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-[#70819b] tabular-nums">
            Best win streak: {stats.bestWinStreak}W
          </p>
        </article>

        <article className="rounded-2xl glass-subcard p-4">
          <p className="text-[11px] font-medium text-[#8b9ab0]">Best single trade</p>
          <p className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#47dca0]">
            {stats.totalTrades > 0 ? formatR(stats.bestTradeR) : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-[#70819b]">Peak R capture</p>
        </article>

        <article className="rounded-2xl glass-subcard p-4">
          <p className="text-[11px] font-medium text-[#8b9ab0]">Worst single trade</p>
          <p className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#ff7d91]">
            {stats.totalTrades > 0 ? formatR(stats.worstTradeR) : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-[#70819b]">Max single loss</p>
        </article>
      </section>

      {/* Interactive Recharts Cumulative R Curve */}
      {equityPoints.length >= 2 && (
        <article className="rounded-2xl glass-card p-5">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                Equity progression
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Cumulative R curve</h3>
            </div>
            <span
              className={`font-mono text-sm font-bold tabular-nums ${
                finalEquityR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
              }`}
            >
              {formatR(finalEquityR)}
            </span>
          </div>

          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityPoints} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
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
                <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
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
                  tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}R`}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0].payload as (typeof equityPoints)[number];
                    return (
                      <div className="rounded-xl glass-modal px-3.5 py-2.5 text-xs space-y-1">
                        <p className="font-bold text-[#eef3fb]">
                          Trade #{pt.index} · {pt.pair}
                        </p>
                        <p className="text-[#9aa8be]">{formatDate(pt.date)}</p>
                        <p className="text-[#9aa8be] tabular-nums">
                          Trade:{' '}
                          <span
                            className={`font-mono font-bold ${
                              pt.tradeR < 0 ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                            }`}
                          >
                            {formatR(pt.tradeR)}
                          </span>
                        </p>
                        <p className="text-[#9aa8be] tabular-nums">
                          Cumulative:{' '}
                          <span className="font-mono font-bold text-[#8ebeff]">
                            {formatR(pt.equityR)}
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
                  strokeWidth={2.5}
                  fill="url(#analyticsEqFill)"
                  animationDuration={240}
                  dot={{ r: 3, fill: finalEquityR < 0 ? '#ff7d91' : '#8df0c0', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#eef3fb' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
      )}

      {/* Net R by Setup, Session & Behavioral Tags */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <article className="rounded-2xl glass-card p-5">
          <h3 className="text-base font-bold text-[#eef3fb] pb-3 border-b border-white/[0.08]">
            Net R by setup
          </h3>
          <div className="mt-4 space-y-3.5">
            {bySetup.length === 0 ? (
              <p className="text-sm text-[#7f8fa8]">Not enough data yet.</p>
            ) : (
              bySetup.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxSetupAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#d5dfef]">
                        {item.label}
                        <span className="ml-2 text-[#7888a1] font-normal tabular-nums">
                          {item.count} · {Math.round(item.winRate)}% WR
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatR(item.netR)}
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

        <article className="rounded-2xl glass-card p-5">
          <h3 className="text-base font-bold text-[#eef3fb] pb-3 border-b border-white/[0.08]">
            Net R by session
          </h3>
          <div className="mt-4 space-y-3.5">
            {bySession.length === 0 ? (
              <p className="text-sm text-[#7f8fa8]">Not enough data yet.</p>
            ) : (
              bySession.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxSessionAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#d5dfef]">
                        {item.label}
                        <span className="ml-2 text-[#7888a1] font-normal tabular-nums">
                          {item.count} · {Math.round(item.winRate)}% WR
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatR(item.netR)}
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

        <article className="rounded-2xl glass-card p-5">
          <h3 className="text-base font-bold text-[#eef3fb] pb-3 border-b border-white/[0.08]">
            Behavior & edge by tag
          </h3>
          <div className="mt-4 space-y-3.5">
            {byTag.length === 0 ? (
              <p className="text-sm text-[#7f8fa8]">
                Add labels like Patient, FOMO, or High-Conviction when logging trades to uncover behavioral leaks and strengths.
              </p>
            ) : (
              byTag.map((item) => {
                const pct = Math.min(100, (Math.abs(item.netR) / maxTagAbs) * 100);
                const negative = item.netR < 0;
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-[#d5dfef] truncate">
                        #{item.label}
                        <span className="ml-2 text-[#7888a1] font-normal tabular-nums">
                          {item.count} · {Math.round(item.winRate)}% WR
                        </span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums shrink-0 ${
                          negative ? 'text-[#ff7d91]' : 'text-[#47dca0]'
                        }`}
                      >
                        {formatR(item.netR)}
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
      </section>

      {/* Recent Trade Outcomes Bar Chart */}
      <article className="rounded-2xl glass-card p-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <h3 className="text-base font-bold text-[#eef3fb]">Recent trade outcomes</h3>
          <span className="text-xs text-[#7f8fa8]">Tap any bar to inspect</span>
        </div>

        {recentTrades.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#7f8fa8]">
            Trade outcomes will appear here once trades are logged.
          </p>
        ) : (
          <div className="mt-5 flex items-end gap-2 sm:gap-3 overflow-x-auto pb-2 min-h-[148px]">
            {recentTrades.map((t) => {
              const rVal = Number(t.r || 0);
              const heightPx = Math.max(10, Math.round((Math.abs(rVal) / maxRecentAbs) * 86));
              const isWin = t.result === 'Win' || rVal > 0;
              const isLoss = t.result === 'Loss' || rVal < 0;
              const barColor = isLoss
                ? 'bg-[#ff7d91]'
                : isWin
                ? 'bg-[#47dca0]'
                : 'bg-[#8ebeff]';

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrade(t)}
                  title={`${t.pair} · ${formatR(rVal)}`}
                  className="flex-1 min-w-[42px] flex flex-col items-center gap-1.5 group"
                >
                  <span
                    className={`font-mono text-[10px] font-bold tabular-nums ${
                      isLoss ? 'text-[#ff7d91]' : isWin ? 'text-[#8df0c0]' : 'text-[#8ebeff]'
                    }`}
                  >
                    {formatR(rVal)}
                  </span>
                  <div className="h-[92px] flex items-end">
                    <div
                      className={`w-6 sm:w-7 rounded-t-lg transition-opacity group-hover:opacity-80 ${barColor}`}
                      style={{ height: `${heightPx}px` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-[#cfd9ea] truncate max-w-[54px]">
                    {t.pair}
                  </span>
                  <span className="font-mono text-[9px] text-[#6d7f99] tabular-nums">
                    {formatDate(t.date, { day: 'numeric', month: 'short' })}
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
