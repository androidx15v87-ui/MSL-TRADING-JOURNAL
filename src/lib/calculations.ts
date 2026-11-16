import type { JournalStats, Trade } from '../types/journal';

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localDateTime(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${isoDate(date)}T${hh}:${mm}`;
}

export function formatDate(
  isoString: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
): string {
  if (!isoString) return '—';
  const normalized = isoString.length >= 10 ? `${isoString.slice(0, 10)}T12:00:00` : isoString;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, options);
}

export function formatTime(isoString: string): string {
  if (!isoString || isoString.length < 16) return '';
  return isoString.slice(11, 16);
}

export function formatR(value: number | undefined | null): string {
  const num = Number(value || 0);
  if (Object.is(num, -0)) return '0.00R';
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}R`;
}

export function calculateStats(trades: Trade[]): JournalStats {
  const wins = trades.filter((t) => t.result === 'Win');
  const losses = trades.filter((t) => t.result === 'Loss');
  const breakevens = trades.filter((t) => t.result === 'BE');

  const netR = trades.reduce((sum, t) => sum + Number(t.r || 0), 0);
  const totalTrades = trades.length;

  // Prompt specification:
  // - Win rate = wins / total trades
  // - Expectancy = average R per trade, breakeven included
  // - Profit factor = sum of winning R / absolute sum of losing R
  // - Average winner / loser = mean R of winners / losers only
  // - Best session = session with highest net R
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const expectancy = totalTrades > 0 ? netR / totalTrades : 0;

  const grossWin = wins.reduce((sum, t) => sum + Math.max(0, Number(t.r || 0)), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Math.min(0, Number(t.r || 0)), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const avgWinner =
    wins.length > 0 ? wins.reduce((sum, t) => sum + Number(t.r || 0), 0) / wins.length : 0;
  const avgLoser =
    losses.length > 0 ? losses.reduce((sum, t) => sum + Number(t.r || 0), 0) / losses.length : 0;

  const sessionMap = new Map<string, number>();
  for (const t of trades) {
    const key = t.session || 'Other';
    sessionMap.set(key, (sessionMap.get(key) || 0) + Number(t.r || 0));
  }

  let bestSession: { name: string; netR: number } | null = null;
  for (const [name, sessionR] of sessionMap.entries()) {
    if (!bestSession || sessionR > bestSession.netR) {
      bestSession = { name, netR: sessionR };
    }
  }

  // Chronological metrics: max drawdown (R), win/loss streaks, best/worst trade
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  let peak = 0;
  let equity = 0;
  let maxDrawdownR = 0;
  let bestTradeR = 0;
  let worstTradeR = 0;
  let bestWinStreak = 0;
  let runningWinStreak = 0;
  let currentType: 'Win' | 'Loss' | 'None' = 'None';
  let currentCount = 0;

  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i];
    const rVal = Number(t.r || 0);
    if (i === 0 || rVal > bestTradeR) bestTradeR = rVal;
    if (i === 0 || rVal < worstTradeR) worstTradeR = rVal;

    equity += rVal;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdownR) maxDrawdownR = dd;

    if (t.result === 'Win') {
      runningWinStreak += 1;
      if (runningWinStreak > bestWinStreak) bestWinStreak = runningWinStreak;
      currentType = currentType === 'Win' ? 'Win' : 'Win';
      currentCount = currentType === 'Win' && i > 0 && ordered[i - 1].result === 'Win'
        ? currentCount + 1
        : 1;
    } else if (t.result === 'Loss') {
      runningWinStreak = 0;
      currentCount = i > 0 && ordered[i - 1].result === 'Loss' ? currentCount + 1 : 1;
      currentType = 'Loss';
    } else {
      runningWinStreak = 0;
      currentType = 'None';
      currentCount = 0;
    }
  }

  return {
    totalTrades,
    wins,
    losses,
    breakevens,
    netR,
    winRate,
    expectancy,
    profitFactor,
    avgWinner,
    avgLoser,
    grossWin,
    grossLoss,
    bestSession,
    maxDrawdownR: Math.round(maxDrawdownR * 100) / 100,
    bestTradeR,
    worstTradeR,
    currentStreak: { type: currentType, count: currentCount },
    bestWinStreak,
  };
}

export interface GroupPerformance {
  label: string;
  netR: number;
  count: number;
  winRate: number;
}

export function groupPerformance(
  trades: Trade[],
  key: 'setup' | 'session' | 'direction'
): GroupPerformance[] {
  const map = new Map<string, { netR: number; count: number; wins: number }>();

  for (const t of trades) {
    const label = String(t[key] || 'Unspecified');
    const prev = map.get(label) || { netR: 0, count: 0, wins: 0 };
    map.set(label, {
      netR: prev.netR + Number(t.r || 0),
      count: prev.count + 1,
      wins: prev.wins + (t.result === 'Win' ? 1 : 0),
    });
  }

  return Array.from(map.entries())
    .map(([label, data]) => ({
      label,
      netR: data.netR,
      count: data.count,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
    }))
    .sort((a, b) => b.netR - a.netR);
}

export function groupPerformanceByTag(trades: Trade[]): GroupPerformance[] {
  const map = new Map<string, { netR: number; count: number; wins: number }>();

  for (const t of trades) {
    const tags = Array.isArray(t.tags) ? t.tags : [];
    for (const rawTag of tags) {
      const label = rawTag.trim();
      if (!label) continue;
      const prev = map.get(label) || { netR: 0, count: 0, wins: 0 };
      map.set(label, {
        netR: prev.netR + Number(t.r || 0),
        count: prev.count + 1,
        wins: prev.wins + (t.result === 'Win' ? 1 : 0),
      });
    }
  }

  return Array.from(map.entries())
    .map(([label, data]) => ({
      label,
      netR: data.netR,
      count: data.count,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
    }))
    .sort((a, b) => b.netR - a.netR);
}

export function getAllTradeTags(trades: Trade[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of trades) {
    for (const rawTag of t.tags || []) {
      const tag = rawTag.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Computes a fuzzy match score between a query and a target string.
 * Returns 0 if no match; higher positive scores represent stronger matches.
 */
function fuzzyFieldScore(query: string, target: string): number {
  if (!target) return 0;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return 1;

  // Exact full or substring match gets highest priority
  if (t === q) return 120;
  if (t.startsWith(q)) return 100;
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) return 85 - Math.min(25, subIdx * 0.5);

  // Word-by-word token match (handles multi-word queries like "eur rev")
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let tokenSum = 0;
    for (const tok of tokens) {
      const s = fuzzyFieldScore(tok, t);
      if (s === 0) return 0;
      tokenSum += s;
    }
    return tokenSum / tokens.length;
  }

  // Sequential fuzzy character subsequence match with gap penalty
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let firstMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatchIdx === -1) firstMatchIdx = ti;
      consecutive += 1;
      score += 8 + consecutive * 4;
      qi += 1;
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) {
    // Allow 1-char typo tolerance for queries >= 4 chars via bigram similarity
    if (q.length >= 4) {
      let matches = 0;
      const bigrams = new Set<string>();
      for (let i = 0; i < q.length - 1; i++) bigrams.add(q.slice(i, i + 2));
      for (const bg of bigrams) {
        if (t.includes(bg)) matches++;
      }
      const ratio = matches / Math.max(1, bigrams.size);
      if (ratio >= 0.6) return Math.round(ratio * 45);
    }
    return 0;
  }

  const lengthPenalty = (t.length - q.length) * 0.2;
  return Math.max(10, score - lengthPenalty - firstMatchIdx * 0.3);
}

/**
 * Real-time fuzzy search across symbol, setup, notes, model, session, and custom values.
 */
export function fuzzySearchTrades(trades: Trade[], query: string): Trade[] {
  const q = query.trim();
  if (!q) {
    return [...trades].sort((a, b) => b.date.localeCompare(a.date));
  }

  const scored: { trade: Trade; score: number }[] = [];

  for (const trade of trades) {
    const customText = Object.values(trade.custom || {})
      .map((v) => (typeof v === 'object' && v !== null ? `${v.text || ''} ${v.number || ''}` : String(v || '')))
      .join(' ');

    const tagsText = Array.isArray(trade.tags) ? trade.tags.join(' ') : '';
    const symbolScore = fuzzyFieldScore(q, trade.pair) * 1.4;
    const setupScore = fuzzyFieldScore(q, trade.setup) * 1.2;
    const notesScore = fuzzyFieldScore(q, trade.notes) * 1.05;
    const modelScore = fuzzyFieldScore(q, trade.model) * 1.1;
    const tagScore = fuzzyFieldScore(q, tagsText) * 1.15;
    const sessionScore = fuzzyFieldScore(q, trade.session) * 0.9;
    const customScore = fuzzyFieldScore(q, customText) * 0.85;

    const best = Math.max(
      symbolScore,
      setupScore,
      notesScore,
      modelScore,
      tagScore,
      sessionScore,
      customScore
    );

    if (best > 0) {
      scored.push({ trade, score: best });
    }
  }

  return scored
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 12) return b.score - a.score;
      return b.trade.date.localeCompare(a.trade.date);
    })
    .map((x) => x.trade);
}

export interface MonthlyPnLPoint {
  monthKey: string; // YYYY-MM
  label: string; // Short month e.g. Nov
  fullLabel: string; // e.g. November 2026
  netR: number;
  cumulativeR: number;
  tradesCount: number;
  winsCount: number;
  winRate: number;
}

export function calculateMonthlyPnL(
  trades: Trade[],
  monthsCount: number = 6,
  referenceDate: Date = new Date()
): MonthlyPnLPoint[] {
  const buckets: {
    monthKey: string;
    label: string;
    fullLabel: string;
    netR: number;
    tradesCount: number;
    winsCount: number;
  }[] = [];

  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    buckets.push({
      monthKey: `${yyyy}-${mm}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      netR: 0,
      tradesCount: 0,
      winsCount: 0,
    });
  }

  const bucketMap = new Map(buckets.map((b) => [b.monthKey, b]));

  for (const t of trades) {
    const key = (t.date || '').slice(0, 7);
    const bucket = bucketMap.get(key);
    if (!bucket) continue;
    bucket.netR += Number(t.r || 0);
    bucket.tradesCount += 1;
    if (t.result === 'Win') bucket.winsCount += 1;
  }

  let running = 0;
  return buckets.map((b) => {
    const roundedNet = Math.round(b.netR * 100) / 100;
    running = Math.round((running + roundedNet) * 100) / 100;
    return {
      monthKey: b.monthKey,
      label: b.label,
      fullLabel: b.fullLabel,
      netR: roundedNet,
      cumulativeR: running,
      tradesCount: b.tradesCount,
      winsCount: b.winsCount,
      winRate: b.tradesCount > 0 ? Math.round((b.winsCount / b.tradesCount) * 100) : 0,
    };
  });
}
