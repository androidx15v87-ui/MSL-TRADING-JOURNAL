import {
  calculateMonthlyPnL,
  calculateStats,
  formatMetric,
  formatTradePnL,
  formatTradeRisk,
  getUnitShortLabel,
  groupPerformance,
  groupPerformanceByTag,
  isRJournal,
  normalizeMetricUnit,
} from './calculations';
import type {
  AIAppAction,
  AIAppActionResult,
  AIChatMessage,
  AIConversation,
  AIMemoryItem,
  AISourceCitation,
  JournalState,
  Trade,
} from '../types/journal';

const AI_CONVERSATIONS_KEY = 'msl_v10_ai_conversations';
const AI_VOICE_ENABLED_KEY = 'msl_ai_voice_enabled';
const AI_VOICE_RATE_KEY = 'msl_ai_voice_rate_v1';
const DEFAULT_UK_VOICE = 'Zephyr';
export const DEFAULT_VOICE_RATE = 1.18;

let saveDebounceTimer: number | null = null;

export class StreamInterruptedError extends Error {
  partialText: string;

  constructor(message: string, partialText: string) {
    super(message);
    this.name = 'StreamInterruptedError';
    this.partialText = partialText;
  }
}

export function loadAIVoiceEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AI_VOICE_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function saveAIVoiceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AI_VOICE_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}

export function loadVoiceRate(): number {
  try {
    const raw = localStorage.getItem(AI_VOICE_RATE_KEY);
    const parsed = raw ? Number(raw) : DEFAULT_VOICE_RATE;
    return Number.isFinite(parsed) && parsed >= 0.9 && parsed <= 1.6 ? parsed : DEFAULT_VOICE_RATE;
  } catch {
    return DEFAULT_VOICE_RATE;
  }
}

export function saveVoiceRate(rate: number): void {
  try {
    localStorage.setItem(AI_VOICE_RATE_KEY, String(rate));
  } catch {
    // Ignore storage errors
  }
}

export function loadAIConversations(): AIConversation[] {
  try {
    const raw = localStorage.getItem(AI_CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAIConversations(conversations: AIConversation[]): void {
  try {
    const compact: AIConversation[] = conversations.slice(0, 25).map((conv) => ({
      ...conv,
      messages: conv.messages.slice(-50).map((msg) => ({
        ...msg,
        attachments: msg.attachments?.map((att) => ({
          ...att,
          dataUrl: att.dataUrl && att.dataUrl.length <= 24000 ? att.dataUrl : '',
        })),
      })),
    }));
    localStorage.setItem(AI_CONVERSATIONS_KEY, JSON.stringify(compact));
  } catch {
    // Ignore storage quota errors for chat history
  }
}

export function scheduleSaveAIConversations(conversations: AIConversation[], delayMs = 350): void {
  if (saveDebounceTimer !== null) {
    window.clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = window.setTimeout(() => {
    saveDebounceTimer = null;
    saveAIConversations(conversations);
  }, delayMs);
}

let lastCtxStateRef: JournalState | null = null;
let lastCtxMemoriesRef: AIMemoryItem[] | undefined = undefined;
let lastLeanCtxValue = '';
let lastFullCtxValue = '';
let lastSortedTradesCache: Trade[] = [];
let lastDefaultUnitCache: Trade['pnlUnit'] = 'r';
let lastDefaultCurrCache = 'R';
let lastDefaultRiskUnitCache: Trade['riskUnit'] = 'r';

function promptNeedsFullSnapshot(prompt?: string): boolean {
  if (!prompt) return true;
  return /\b(playbook|model|models|template|alarm|alarms|alert|month|monthly|6m|tag|tags|breakdown|audit|review|detailed|deep|every|all trades|history|log|update|delete|edit|session|setup|compare|pair|tilt|weekday|day of week|long|short)\b/i.test(
    prompt
  );
}

function summarizeGroupQuant(
  trades: Trade[],
  keyFn: (t: Trade) => string,
  unitFilter: Trade['pnlUnit'] | undefined
): Array<{ label: string; count: number; wins: number; winRate: number; netR: number }> {
  const map = new Map<string, { count: number; wins: number; netR: number }>();
  for (const t of trades) {
    if (t.result === 'Missed') continue;
    if (unitFilter && normalizeMetricUnit(t.pnlUnit, 'r') !== unitFilter) continue;
    const key = keyFn(t).trim();
    if (!key) continue;
    const entry = map.get(key) || { count: 0, wins: 0, netR: 0 };
    entry.count += 1;
    if (t.result === 'Win') entry.wins += 1;
    entry.netR += Number(t.r || 0);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([label, d]) => ({
      label,
      count: d.count,
      wins: d.wins,
      winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
      netR: d.netR,
    }))
    .sort((a, b) => b.count - a.count || b.netR - a.netR);
}

function findMatchingTrades(
  sortedTrades: Trade[],
  prompt: string | undefined,
  alreadyShownCount: number,
  defaultUnit: NonNullable<Trade['pnlUnit']>,
  defaultRiskUnit: NonNullable<Trade['riskUnit']>,
  defaultCurr: string
): string {
  if (!prompt || sortedTrades.length <= alreadyShownCount) return '';
  const cleanPrompt = prompt.trim().toLowerCase();
  if (cleanPrompt.length < 3) return '';

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'how', 'why',
    'are', 'was', 'were', 'have', 'has', 'had', 'from', 'into', 'about', 'can', 'you', 'my',
    'your', 'show', 'give', 'tell', 'trade', 'trades', 'audit', 'review', 'best', 'worst',
    'all', 'last', 'recent', 'today', 'week', 'month', 'pnl', 'risk', 'rate', 'win',
  ]);
  const tokens = cleanPrompt
    .split(/[^a-z0-9$%+-]+/i)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length >= 2 && !stopWords.has(tok));

  if (tokens.length === 0) return '';

  const shownIds = new Set(sortedTrades.slice(0, alreadyShownCount).map((t) => t.id));
  const matches: Trade[] = [];
  for (const t of sortedTrades) {
    if (shownIds.has(t.id)) continue;
    const haystack = `${t.id} ${t.pair} ${t.direction} ${t.setup} ${t.session} ${t.result} ${t.model || ''} ${(t.tags || []).join(' ')} ${t.notes || ''} ${t.date}`.toLowerCase();
    if (tokens.some((tok) => haystack.includes(tok))) {
      matches.push(t);
      if (matches.length >= 8) break;
    }
  }

  if (matches.length === 0) return '';
  const rows = matches.map((t) => {
    const tagsStr = t.tags && t.tags.length > 0 ? t.tags.join(',') : '';
    return `- ${t.id} | ${t.date} | ${t.pair} ${t.direction} | ${t.setup}/${t.session} | ${t.result} ${formatTradePnL(t, defaultUnit, defaultCurr)} (risk ${formatTradeRisk(t, defaultRiskUnit, defaultCurr)})${t.model ? ` | model:${t.model}` : ''}${tagsStr ? ` | tags:[${tagsStr}]` : ''}${t.notes ? ` | "${t.notes.slice(0, 50)}"` : ''}`;
  });
  return `Query-Matched Historical Trades (${matches.length}):\n${rows.join('\n')}`;
}

export function buildJournalContext(
  state: JournalState,
  memories?: AIMemoryItem[],
  options?: { mode?: 'fast' | 'deep'; prompt?: string }
): string {
  const useFull = options?.mode === 'deep' || promptNeedsFullSnapshot(options?.prompt);

  if (lastCtxStateRef === state && lastCtxMemoriesRef === memories) {
    const base = useFull ? lastFullCtxValue : lastLeanCtxValue;
    if (base) {
      const matched = findMatchingTrades(
        lastSortedTradesCache,
        options?.prompt,
        useFull ? 8 : 4,
        lastDefaultUnitCache || 'r',
        lastDefaultRiskUnitCache || 'r',
        lastDefaultCurrCache
      );
      return matched ? `${base}\n${matched}` : base;
    }
  }

  const defaultUnit = state.settings.defaultPnlUnit || 'r';
  const defaultRiskUnit = state.settings.defaultRiskUnit || 'r';
  const defaultCurr = state.settings.currency || 'R';

  const stats = calculateStats(state.trades, {
    defaultUnit,
    defaultCurrency: defaultCurr,
  });
  const activeUnit = stats.primaryUnit;
  const activeCurr = stats.primaryCurrency;
  const fmt = (val: number) => formatMetric(val, activeUnit, activeCurr, { signed: true });
  const fmtAbs = (val: number) => formatMetric(val, activeUnit, activeCurr, { signed: false });
  const unitFilter = stats.isMixedUnits ? activeUnit : undefined;

  const sortedTrades = [...state.trades].sort((a, b) => b.date.localeCompare(a.date));
  const formatTradeRow = (t: Trade) => {
    const tagsStr = t.tags && t.tags.length > 0 ? t.tags.join(',') : '';
    return `- ${t.id} | ${t.date} | ${t.pair} ${t.direction} | ${t.setup}/${t.session} | ${t.result} ${formatTradePnL(t, defaultUnit, defaultCurr)} (risk ${formatTradeRisk(t, defaultRiskUnit, defaultCurr)})${t.model ? ` | model:${t.model}` : ''}${tagsStr ? ` | tags:[${tagsStr}]` : ''}${t.notes ? ` | "${t.notes.slice(0, 50)}"` : ''}`;
  };

  const memoryLines = (memories || [])
    .slice(0, 24)
    .map((m) => `- [${m.id}] (${m.category}) ${m.content.slice(0, 140)}`);

  const unitBreakdownLine = stats.isMixedUnits
    ? `Unit Breakdown: ${stats.unitBreakdown
        .map(
          (b) =>
            `${getUnitShortLabel(b.unit, b.currency)}: ${formatMetric(b.net, b.unit, b.currency)} (${b.count} trades)`
        )
        .join(' | ')}`
    : '';

  const activeJournal =
    (state.journals || []).find((j) => !j.isDeleted && j.id === state.activeJournalId) ||
    (state.journals || []).find((j) => !j.isDeleted);
  const journalScopeInfo = activeJournal
    ? (() => {
        const parts: string[] = [];
        if (isRJournal(activeJournal)) {
          parts.push('R-Mode, No Starting Balance');
        } else {
          parts.push(
            `Start ${formatMetric(activeJournal.startingBalance, 'money', activeJournal.currency || 'R', {
              signed: false,
              decimals: activeJournal.startingBalance % 1 === 0 ? 0 : 2,
            })}`
          );
        }
        if ((activeJournal.target || 0) > 0) {
          parts.push(
            `Target ${
              isRJournal(activeJournal)
                ? formatMetric(activeJournal.target, 'r', 'R', { signed: true })
                : formatMetric(activeJournal.target, 'money', activeJournal.currency || 'R', {
                    signed: true,
                    decimals: (activeJournal.target || 0) % 1 === 0 ? 0 : 2,
                  })
            }`
          );
        }
        if (activeJournal.propFirm) {
          parts.push(activeJournal.propFirm);
        }
        return ` | Active Journal: ${activeJournal.name} (${parts.join(', ')})`;
      })()
    : ' | Active Journal: None';
  const traderLine = `Trader: ${state.profile.name || 'Trader'}${journalScopeInfo} | Market: ${state.profile.market || 'Unspecified'} | Default Units: P&L=${getUnitShortLabel(defaultUnit, defaultCurr)}, Risk=${getUnitShortLabel(defaultRiskUnit, defaultCurr)}`;
  const statsLine = `Total PnL & Stats (${getUnitShortLabel(activeUnit, activeCurr)}): Net PnL ${fmt(stats.netR)} | Total Profits +${fmtAbs(stats.grossWin)} | Total Losses -${fmtAbs(stats.grossLoss)} | ${stats.totalTrades} executed (${stats.missed.length} missed) | WR ${stats.winRate.toFixed(1)}% (${stats.wins.length}W/${stats.losses.length}L/${stats.breakevens.length}BE/${stats.missed.length}Missed) | Exp ${fmt(stats.expectancy)} | PF ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} | AvgW ${fmt(stats.avgWinner)} | AvgL ${fmt(stats.avgLoser)} | MaxDD -${fmtAbs(stats.maxDrawdownR)} | Best Session ${stats.bestSession ? `${stats.bestSession.name} (${fmt(stats.bestSession.netR)})` : 'None'}`;
  const memoryBlock = memoryLines.length
    ? `Saved User Memories (${memoryLines.length}):\n${memoryLines.join('\n')}`
    : '';

  const leanTrades = sortedTrades.slice(0, 4).map(formatTradeRow);
  const leanValue = [
    memoryBlock,
    traderLine,
    statsLine,
    unitBreakdownLine,
    leanTrades.length ? `Recent Trades (${leanTrades.length}):\n${leanTrades.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const bySetup = groupPerformance(state.trades, 'setup', unitFilter);
  const bySession = groupPerformance(state.trades, 'session', unitFilter);
  const byTag = groupPerformanceByTag(state.trades, unitFilter);
  const monthly = calculateMonthlyPnL(state.trades, 6, new Date(), unitFilter);
  const fullTrades = sortedTrades.slice(0, 8).map(formatTradeRow);

  // Quantitative edges: Pair, Direction, Model, Post-Loss Tilt, Weekday bias, Missed opportunity
  const byPair = summarizeGroupQuant(state.trades, (t) => t.pair.toUpperCase(), unitFilter).slice(0, 6);
  const byDirection = summarizeGroupQuant(state.trades, (t) => t.direction, unitFilter);
  const byModel = summarizeGroupQuant(state.trades, (t) => t.model || '', unitFilter).slice(0, 6);

  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byWeekday = summarizeGroupQuant(
    state.trades,
    (t) => {
      const d = new Date(t.date.length >= 10 ? `${t.date.slice(0, 10)}T12:00:00` : t.date);
      return Number.isNaN(d.getTime()) ? '' : weekdayNames[d.getDay()];
    },
    unitFilter
  ).sort((a, b) => b.netR - a.netR);

  // Chronological Post-Loss Tilt vs Post-Win momentum
  const chronoExecuted = [...sortedTrades].reverse().filter((t) => t.result !== 'Missed');
  let afterLossCount = 0;
  let afterLossWins = 0;
  let afterLossNet = 0;
  let afterWinCount = 0;
  let afterWinWins = 0;
  let afterWinNet = 0;
  for (let i = 1; i < chronoExecuted.length; i++) {
    const prev = chronoExecuted[i - 1];
    const curr = chronoExecuted[i];
    if (unitFilter && normalizeMetricUnit(curr.pnlUnit, 'r') !== unitFilter) continue;
    const pnl = Number(curr.r || 0);
    if (prev.result === 'Loss') {
      afterLossCount += 1;
      if (curr.result === 'Win') afterLossWins += 1;
      afterLossNet += pnl;
    } else if (prev.result === 'Win') {
      afterWinCount += 1;
      if (curr.result === 'Win') afterWinWins += 1;
      afterWinNet += pnl;
    }
  }
  const tiltLine =
    afterLossCount >= 2
      ? `Post-Loss Tilt: After Loss ${fmt(afterLossNet)} (${afterLossCount} trades, ${Math.round((afterLossWins / afterLossCount) * 100)}% WR)${
          afterWinCount >= 2
            ? ` vs After Win ${fmt(afterWinNet)} (${afterWinCount} trades, ${Math.round((afterWinWins / afterWinCount) * 100)}% WR)`
            : ''
        }`
      : '';

  const missedPrimarySum = stats.missed
    .filter((t) => !unitFilter || normalizeMetricUnit(t.pnlUnit, 'r') === unitFilter)
    .reduce((acc, t) => acc + Number(t.r || 0), 0);
  const missedLine =
    stats.missed.length > 0
      ? `Missed Opportunity: ${stats.missed.length} missed setups totaling ${fmt(missedPrimarySum)} (excluded from realized PnL)`
      : '';

  const modelsSummary = state.models
    .slice(0, 12)
    .map(
      (m) =>
        `- ${m.name} (${m.type}): Entry="${(m.entry || '—').slice(0, 120)}", Risk="${(m.risk || '—').slice(0, 120)}"`
    );

  const alarmsSummary = state.alarms.map(
    (a) => `- ${a.name}: ${a.time} (${a.enabled ? 'on' : 'off'})`
  );

  const playbookLines = [
    state.playbook.core ? `Core: ${state.playbook.core.slice(0, 160)}` : '',
    state.playbook.rev ? `Reversal: ${state.playbook.rev.slice(0, 160)}` : '',
    state.playbook.cont ? `Continuation: ${state.playbook.cont.slice(0, 160)}` : '',
    state.playbook.entry ? `Entry: ${state.playbook.entry.slice(0, 160)}` : '',
    state.playbook.risk ? `Risk/Targets: ${state.playbook.risk.slice(0, 160)}` : '',
  ].filter(Boolean);

  const fullValue = [
    memoryBlock,
    traderLine,
    statsLine,
    unitBreakdownLine,
    missedLine,
    tiltLine,
    byDirection.length
      ? `Directions: ${byDirection.map((d) => `${d.label}:${fmt(d.netR)}(${d.count},${Math.round(d.winRate)}%)`).join(' | ')}`
      : '',
    byPair.length
      ? `Top Pairs: ${byPair.map((p) => `${p.label}:${fmt(p.netR)}(${p.count},${Math.round(p.winRate)}%)`).join(' | ')}`
      : '',
    byModel.length
      ? `Models Edge: ${byModel.map((m) => `${m.label}:${fmt(m.netR)}(${m.count},${Math.round(m.winRate)}%)`).join(' | ')}`
      : '',
    byWeekday.length >= 2
      ? `Weekdays: Best ${byWeekday[0].label} ${fmt(byWeekday[0].netR)} (${byWeekday[0].count}) | Worst ${byWeekday[byWeekday.length - 1].label} ${fmt(byWeekday[byWeekday.length - 1].netR)} (${byWeekday[byWeekday.length - 1].count})`
      : '',
    `6M Monthly Net (${getUnitShortLabel(activeUnit, activeCurr)}): ${monthly.map((m) => `${m.label}:${fmt(m.netR)}(${m.tradesCount})`).join(' | ')}`,
    bySetup.length
      ? `Setups: ${bySetup.map((s) => `${s.label}:${fmt(s.netR)}(${s.count},${Math.round(s.winRate)}%)`).join(' | ')}`
      : '',
    bySession.length
      ? `Sessions: ${bySession.map((s) => `${s.label}:${fmt(s.netR)}(${s.count},${Math.round(s.winRate)}%)`).join(' | ')}`
      : '',
    byTag.length
      ? `Tags: ${byTag.map((tg) => `#${tg.label}:${fmt(tg.netR)}(${tg.count},${Math.round(tg.winRate)}%)`).join(' | ')}`
      : '',
    modelsSummary.length ? `Models:\n${modelsSummary.join('\n')}` : '',
    alarmsSummary.length ? `Alarms: ${alarmsSummary.join(' | ')}` : '',
    playbookLines.length ? `Playbook:\n${playbookLines.join('\n')}` : '',
    fullTrades.length ? `Recent Trades (${fullTrades.length}):\n${fullTrades.join('\n')}` : 'Recent Trades: None',
  ]
    .filter(Boolean)
    .join('\n');

  lastCtxStateRef = state;
  lastCtxMemoriesRef = memories;
  lastLeanCtxValue = leanValue;
  lastFullCtxValue = fullValue;
  lastSortedTradesCache = sortedTrades;
  lastDefaultUnitCache = defaultUnit;
  lastDefaultRiskUnitCache = defaultRiskUnit;
  lastDefaultCurrCache = defaultCurr;

  const baseResult = useFull ? fullValue : leanValue;
  const matched = findMatchingTrades(
    sortedTrades,
    options?.prompt,
    useFull ? 8 : 4,
    defaultUnit,
    defaultRiskUnit,
    defaultCurr
  );
  return matched ? `${baseResult}\n${matched}` : baseResult;
}

export function generateFollowUpChips(
  userText: string,
  modelText: string,
  actions?: AIAppActionResult[],
  hasSources?: boolean
): string[] {
  const u = userText.toLowerCase();
  const m = modelText.toLowerCase();
  const chips: string[] = [];

  if (actions && actions.some((a) => a.name === 'log_trade')) {
    chips.push('Review my updated edge stats', 'Check off matching playbook rules');
  } else if (/\b(tilt|loss|drawdown|leak|mistake|revenge)\b/.test(u + ' ' + m)) {
    chips.push(
      'Show my post-loss tilt stats',
      'Save a rule to stop after 2 losses',
      'Audit my worst pair & session'
    );
  } else if (hasSources || /\b(fed|fomc|cpi|nfp|dxy|yield|macro|gold|xauusd|news)\b/.test(u + ' ' + m)) {
    chips.push(
      'How does this impact my top pair today?',
      'Build a London/NY session risk checklist'
    );
  } else if (/\b(chart|poi|liquidity|sweep|fvg|invalidation|entry|r:r)\b/.test(u + ' ' + m)) {
    chips.push(
      'Log this setup to my journal',
      'Stress-test invalidation & position risk'
    );
  } else {
    chips.push(
      'Where is my biggest edge right now?',
      'Compare my Long vs Short performance'
    );
  }

  if (chips.length < 3) {
    chips.push('Give me one rule to raise expectancy');
  }
  return Array.from(new Set(chips)).slice(0, 3);
}

let lastPrewarmAt = 0;
export function prewarmAIConnection(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastPrewarmAt < 30000) return;
  lastPrewarmAt = now;
  void fetch('/api/health?warm=1', { method: 'GET', keepalive: true }).catch(() => {
    lastPrewarmAt = 0;
  });
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function isTransientStreamError(err: unknown, statusCode?: number): boolean {
  const errStatus = (err as { status?: number } | null)?.status;
  const code = statusCode ?? errStatus;
  if (code && (code === 429 || code === 502 || code === 503 || code === 504)) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    msg.includes('timed out') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429') ||
    msg.includes('busy') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('temporarily')
  );
}

export interface SyncClauseMeta {
  clauseId: number;
  rawText: string;
  spokenText: string;
}

export async function streamAIChat(options: {
  messages: AIChatMessage[];
  journalContext?: string;
  mode?: 'fast' | 'deep';
  webSearch?: boolean;
  speakSync?: boolean;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onDelta: (chunk: string) => void;
  onSyncClauseMeta?: (meta: SyncClauseMeta) => void;
  onSyncAudioPcm?: (chunk: { clauseId: number; base64Pcm: string }) => void;
  onSyncClauseEnd?: (info: { clauseId: number; textOnly?: boolean }) => void;
  onActions?: (actions: AIAppAction[]) => void;
  onSources?: (sources: AISourceCitation[]) => void;
}): Promise<string> {
  const mode = options.mode || 'fast';
  const webSearch = Boolean(options.webSearch);
  const speakSync = Boolean(options.speakSync);
  const maxClientMsgs = mode === 'fast' ? 6 : 10;
  const keepImagesLastN = mode === 'deep' ? 2 : 1;
  const maxOlderTextChars = mode === 'deep' ? 1800 : 900;

  const sourceMessages =
    options.messages.length > maxClientMsgs
      ? options.messages.slice(-maxClientMsgs)
      : options.messages;
  const imgCutoffIdx = Math.max(0, sourceMessages.length - keepImagesLastN);
  const olderTextCutoffIdx = Math.max(0, sourceMessages.length - 2);

  const formattedMessages = sourceMessages.map((m, idx) => ({
    role: m.role,
    text:
      idx < olderTextCutoffIdx && m.text.length > maxOlderTextChars
        ? `${m.text.slice(0, maxOlderTextChars)}…`
        : m.text,
    images:
      idx >= imgCutoffIdx
        ? (m.attachments || [])
            .map((att) => splitDataUrl(att.dataUrl))
            .filter((x): x is { mimeType: string; data: string } => x !== null)
        : [],
  }));

  const payloadBody = JSON.stringify({
    messages: formattedMessages,
    journalContext: options.journalContext,
    mode,
    webSearch,
    speakSync,
  });

  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let fullText = '';
    let receivedActions = false;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: payloadBody,
      });

      if (!response.ok) {
        let errMsg = `Request failed (${response.status})`;
        try {
          const json = await response.json();
          if (json?.error) errMsg = String(json.error);
        } catch {
          // Ignore parse failure
        }
        if (attempt < maxAttempts - 1 && !options.signal?.aborted && isTransientStreamError(null, response.status)) {
          options.onStatus?.(attempt === 0 ? 'Switching to fastest lane…' : 'Connecting…');
          await new Promise((r) => window.setTimeout(r, attempt === 0 ? 120 : 400));
          continue;
        }
        throw new Error(errMsg);
      }

      if (!response.body) {
        throw new Error('Streaming response body unavailable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      const processLines = (lines: string[]) => {
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          let event: {
            type?: string;
            status?: string | number;
            text?: string;
            clauseId?: number;
            rawText?: string;
            spokenText?: string;
            data?: string;
            textOnly?: boolean;
            error?: string;
            actions?: AIAppAction[];
            sources?: AISourceCitation[];
          };
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (event.type === 'status' && typeof event.status === 'string') {
            options.onStatus?.(event.status);
          } else if (event.type === 'delta' && typeof event.text === 'string') {
            fullText += event.text;
            options.onDelta(event.text);
          } else if (
            event.type === 'sync_clause_meta' &&
            typeof event.clauseId === 'number' &&
            typeof event.rawText === 'string'
          ) {
            options.onSyncClauseMeta?.({
              clauseId: event.clauseId,
              rawText: event.rawText,
              spokenText: typeof event.spokenText === 'string' ? event.spokenText : '',
            });
          } else if (
            event.type === 'audio_pcm' &&
            typeof event.clauseId === 'number' &&
            typeof event.data === 'string'
          ) {
            options.onSyncAudioPcm?.({
              clauseId: event.clauseId,
              base64Pcm: event.data,
            });
          } else if (event.type === 'sync_clause_end' && typeof event.clauseId === 'number') {
            options.onSyncClauseEnd?.({
              clauseId: event.clauseId,
              textOnly: Boolean(event.textOnly),
            });
          } else if (event.type === 'actions' && Array.isArray(event.actions)) {
            if (event.actions.length > 0) receivedActions = true;
            options.onActions?.(event.actions);
          } else if (event.type === 'sources' && Array.isArray(event.sources)) {
            options.onSources?.(event.sources);
          } else if (event.type === 'done') {
            sawDone = true;
          } else if (event.type === 'error') {
            const streamErr = new Error(event.error || 'AI generation failed.') as Error & { status?: number };
            if (typeof event.status === 'number') {
              streamErr.status = event.status;
            }
            throw streamErr;
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            processLines(buffer.split('\n'));
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        processLines(lines);
      }

      if (!fullText.trim() && !receivedActions) {
        if (attempt === 0 && !options.signal?.aborted) {
          options.onStatus?.('Reconnecting…');
          await new Promise((r) => window.setTimeout(r, 80));
          continue;
        }
        throw new Error('KAIROS returned an empty response. Tap Retry to try again.');
      }

      if (!sawDone && fullText.trim() && !options.signal?.aborted) {
        // Stream terminated early without explicit done frame -> surface partial text gracefully
        throw new StreamInterruptedError(
          'Network connection interrupted mid-response. Tap Retry to regenerate.',
          fullText
        );
      }

      return fullText;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || options.signal?.aborted) {
        throw err;
      }

      if (err instanceof StreamInterruptedError) {
        throw err;
      }

      if (fullText.trim()) {
        const msg = err instanceof Error ? err.message : 'Network interruption while streaming.';
        throw new StreamInterruptedError(msg, fullText);
      }

      if (attempt < maxAttempts - 1 && isTransientStreamError(err)) {
        options.onStatus?.(attempt === 0 ? 'Reconnecting to fastest lane…' : 'Retrying…');
        await new Promise((r) => window.setTimeout(r, attempt === 0 ? 120 : 400));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Unable to reach KAIROS. Please check your connection and tap Retry.');
}

export function cleanTextForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[-*_]{3,}/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts natural speakable clauses as SSE text streams in:
 * - Fast launch on the opening clause (so UK voice starts talking right away)
 * - Smooth full-sentence batching afterward (so prosody remains seamless & reduces TTS round-trips)
 */
export function extractSpeakableClauses(
  buffer: string,
  isFirstClause: boolean,
  flushAll: boolean
): { clauses: string[]; remainder: string } {
  const clauses: string[] = [];
  let work = buffer;
  let first = isFirstClause;

  while (work.length > 0) {
    const minSentenceLen = first ? 10 : 62;
    const minPauseLen = first ? 22 : 120;
    const maxClauseLen = first ? 54 : 200;

    let splitAt = -1;

    // 1. Prefer crisp sentence endings (. ! ? or paragraph breaks)
    const sentenceMatch = work.match(/[.!?](?:\s|$)|\n{2,}/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      const endPos = sentenceMatch.index + sentenceMatch[0].length;
      if (endPos >= minSentenceLen) {
        splitAt = endPos;
      }
    }

    // 2. Clean clause punctuation split if sentence is long
    if (splitAt === -1) {
      const pauseMatch = work.match(/[,;:]\s|—\s?|\n/);
      if (pauseMatch && pauseMatch.index !== undefined) {
        const endPos = pauseMatch.index + pauseMatch[0].length;
        if (endPos >= minPauseLen) {
          splitAt = endPos;
        }
      }
    }

    // 3. Hard ceiling at word boundary
    if (splitAt === -1 && work.length >= maxClauseLen) {
      const spaceIdx = work.lastIndexOf(' ', maxClauseLen);
      splitAt = spaceIdx >= 12 ? spaceIdx + 1 : maxClauseLen;
    }

    if (splitAt === -1) break;

    const rawClause = work.slice(0, splitAt);
    work = work.slice(splitAt);
    const cleaned = cleanTextForSpeech(rawClause);
    if (cleaned.length >= 2) {
      clauses.push(cleaned);
      first = false;
    }
  }

  if (flushAll && work.trim()) {
    const cleaned = cleanTextForSpeech(work);
    if (cleaned.length >= 2) {
      clauses.push(cleaned);
    }
    work = '';
  }

  return { clauses, remainder: work };
}

export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal
): Promise<{ audioBase64: string; mimeType: string }> {
  const response = await fetch('/api/ai/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ text, voiceName: DEFAULT_UK_VOICE }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    audioBase64?: string;
    mimeType?: string;
    error?: string;
  };

  if (!response.ok || !data.audioBase64) {
    throw new Error(data.error || 'Could not synthesize AI voice.');
  }

  return {
    audioBase64: data.audioBase64,
    mimeType: data.mimeType || 'audio/wav',
  };
}

let cachedUkVoiceURI: string | null = null;
let activeGlobalEngine: StreamingVoiceEngine | null = null;

function pickBestUkBrowserVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  if (cachedUkVoiceURI) {
    const cached = voices.find((v) => v.voiceURI === cachedUkVoiceURI);
    if (cached) return cached;
  }

  const ukVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en-gb'));
  const preferredOrder = [
    /google uk english/i,
    /libby|sonia|ryan|oliver|george|arthur|serena|daniel|kate/i,
    /natural|neural|premium/i,
  ];
  let chosen: SpeechSynthesisVoice | undefined;
  for (const regex of preferredOrder) {
    chosen = ukVoices.find((v) => regex.test(v.name));
    if (chosen) break;
  }
  const resolved = chosen || ukVoices[0] || voices.find((v) => v.lang.toLowerCase().startsWith('en')) || null;
  if (resolved) cachedUkVoiceURI = resolved.voiceURI;
  return resolved;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface SyncClauseTiming {
  clauseId: number;
  rawText: string;
  spokenText: string;
  firstStartAt: number | null;
  totalDurationSec: number;
  textOnly: boolean;
  audioEnded: boolean;
  revealedChars: number;
}

/**
 * Single-Voice Audible Web Audio Streaming Engine locked to unified UK English voice (Zephyr).
 * Supports both post-generation TTS playback and real-time AudioContext-clock synchronized
 * talk-and-print streaming where words appear in exact lockstep with UK voice playback.
 */
export class StreamingVoiceEngine {
  private ctx: AudioContext | null = null;
  private outputNode: AudioNode | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private abortController: AbortController | null = null;
  private playChain: Promise<void> = Promise.resolve();
  private sessionToken = 0;
  private pendingTasks = 0;
  private idleResolvers = new Set<() => void>();
  private speechRate = loadVoiceRate();
  private onStateChange?: (state: { loading: boolean; speaking: boolean }) => void;

  // Real-time Audio-Clock Text Sync State
  private syncClauses = new Map<number, SyncClauseTiming>();
  private orderedClauseIds: number[] = [];
  private syncCarryByte = new Map<number, number>();
  private syncSessionId = 0;
  private syncRafId: number | null = null;
  private lastEmittedSyncText = '';
  private onSyncDisplayUpdate?: (revealedText: string) => void;

  constructor(onStateChange?: (state: { loading: boolean; speaking: boolean }) => void) {
    this.onStateChange = onStateChange;
  }

  setSpeechRate(rate: number): void {
    const clamped = Math.min(1.6, Math.max(0.9, rate));
    this.speechRate = clamped;
    saveVoiceRate(clamped);
    for (const src of this.activeSources) {
      try {
        src.playbackRate.setValueAtTime(clamped, this.ctx?.currentTime || 0);
      } catch {
        // Ignore rate adjustment error on finished source
      }
    }
  }

  getSpeechRate(): number {
    return this.speechRate;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      const ctx = new AudioCtx({ sampleRate: 24000 });
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-16, ctx.currentTime);
      compressor.knee.setValueAtTime(18, ctx.currentTime);
      compressor.ratio.setValueAtTime(3.2, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.18, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1.34, ctx.currentTime);

      compressor.connect(gain);
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.outputNode = compressor;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private resolveIdleWaiters(): void {
    for (const resolve of this.idleResolvers) {
      resolve();
    }
    this.idleResolvers.clear();
  }

  private async waitForScheduledAudioDrain(session: number): Promise<void> {
    if (!this.ctx || session !== this.sessionToken) return;
    const remainingSec = this.nextStartTime - this.ctx.currentTime;
    if (remainingSec > 0.015) {
      await new Promise<void>((r) => window.setTimeout(r, Math.ceil(remainingSec * 1000) + 15));
    }
  }

  async waitUntilIdle(session: number): Promise<void> {
    if (session !== this.sessionToken) return;
    if (this.pendingTasks > 0 || this.activeSources.size > 0) {
      await new Promise<void>((resolve) => {
        this.idleResolvers.add(resolve);
      });
    }
    await this.waitForScheduledAudioDrain(session);
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const buf = ctx.createBuffer(1, 1, 24000);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.outputNode || ctx.destination);
      src.start(0);
    } catch {
      // Ignore silent unlock error
    }
  }

  beginSession(): number {
    if (activeGlobalEngine && activeGlobalEngine !== this) {
      activeGlobalEngine.stop();
    }
    activeGlobalEngine = this;
    this.stop();
    this.sessionToken += 1;
    this.abortController = new AbortController();
    this.unlock();
    return this.sessionToken;
  }

  private clearSyncState(): void {
    if (this.syncRafId !== null) {
      window.cancelAnimationFrame(this.syncRafId);
      this.syncRafId = null;
    }
    this.syncClauses.clear();
    this.orderedClauseIds = [];
    this.syncCarryByte.clear();
    this.syncSessionId = 0;
    this.lastEmittedSyncText = '';
    this.onSyncDisplayUpdate = undefined;
  }

  beginSyncTurn(session: number, onDisplayUpdate: (revealedText: string) => void): void {
    if (session !== this.sessionToken) return;
    this.clearSyncState();
    this.syncSessionId = session;
    this.onSyncDisplayUpdate = onDisplayUpdate;
    this.pendingTasks = 1;
    this.emitState(true, false);
  }

  registerSyncClauseMeta(meta: SyncClauseMeta, session: number): void {
    if (session !== this.sessionToken || session !== this.syncSessionId) return;
    if (this.syncClauses.has(meta.clauseId)) return;
    this.orderedClauseIds.push(meta.clauseId);
    this.orderedClauseIds.sort((a, b) => a - b);
    this.syncClauses.set(meta.clauseId, {
      clauseId: meta.clauseId,
      rawText: meta.rawText,
      spokenText: meta.spokenText,
      firstStartAt: null,
      totalDurationSec: 0,
      textOnly: !meta.spokenText || meta.spokenText.length < 2,
      audioEnded: false,
      revealedChars: 0,
    });
    this.ensureSyncPacerLoop(session);
  }

  pushSyncAudioPcm(clauseId: number, base64Pcm: string, session: number): void {
    if (session !== this.sessionToken || session !== this.syncSessionId || !base64Pcm) return;
    let bytes = decodeBase64ToBytes(base64Pcm);
    if (
      bytes.byteLength > 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      bytes = bytes.subarray(44);
    }

    const prevCarry = this.syncCarryByte.get(clauseId);
    let merged: Uint8Array;
    if (prevCarry !== undefined) {
      merged = new Uint8Array(1 + bytes.byteLength);
      merged[0] = prevCarry;
      merged.set(bytes, 1);
      this.syncCarryByte.delete(clauseId);
    } else {
      merged = bytes;
    }

    if (merged.byteLength % 2 === 1) {
      this.syncCarryByte.set(clauseId, merged[merged.byteLength - 1]);
      merged = merged.subarray(0, merged.byteLength - 1);
    }
    if (merged.byteLength < 2) return;

    const timing = this.schedulePcmBytes(merged, session);
    const clause = this.syncClauses.get(clauseId);
    if (clause && timing) {
      if (clause.firstStartAt === null) {
        clause.firstStartAt = timing.startAt;
      }
      clause.totalDurationSec += timing.durationSec;
      this.ensureSyncPacerLoop(session);
    }
  }

  finishSyncClause(clauseId: number, textOnly: boolean, session: number): void {
    if (session !== this.sessionToken || session !== this.syncSessionId) return;
    this.syncCarryByte.delete(clauseId);
    const clause = this.syncClauses.get(clauseId);
    if (clause) {
      clause.audioEnded = true;
      if (textOnly && clause.totalDurationSec === 0) {
        clause.textOnly = true;
      }
      this.ensureSyncPacerLoop(session);
    }
  }

  completeSyncTurnStream(session: number): void {
    if (session !== this.sessionToken) return;
    this.pendingTasks = Math.max(0, this.pendingTasks - 1);
    for (const id of this.orderedClauseIds) {
      const c = this.syncClauses.get(id);
      if (c && c.firstStartAt === null && !c.textOnly) {
        c.textOnly = true;
      }
    }
    this.flushSyncRevealStep(session);
    if (this.pendingTasks === 0 && this.activeSources.size === 0) {
      this.emitState(false, false);
      this.resolveIdleWaiters();
    }
  }

  private ensureSyncPacerLoop(session: number): void {
    if (this.syncRafId !== null || session !== this.syncSessionId || session !== this.sessionToken) {
      return;
    }
    const tick = () => {
      this.syncRafId = null;
      if (session !== this.sessionToken || session !== this.syncSessionId) return;
      const moreNeeded = this.flushSyncRevealStep(session);
      if (moreNeeded) {
        this.syncRafId = window.requestAnimationFrame(tick);
      }
    };
    this.syncRafId = window.requestAnimationFrame(tick);
  }

  private flushSyncRevealStep(session: number): boolean {
    if (session !== this.syncSessionId || !this.onSyncDisplayUpdate) return false;
    const now = this.ctx?.currentTime || 0;
    let combined = '';
    let hasPending = false;
    let blockedByPriorClause = false;

    for (const id of this.orderedClauseIds) {
      const clause = this.syncClauses.get(id);
      if (!clause) continue;

      if (blockedByPriorClause) {
        hasPending = true;
        continue;
      }

      if (clause.textOnly) {
        clause.revealedChars = clause.rawText.length;
        combined += clause.rawText;
        continue;
      }

      if (clause.firstStartAt === null) {
        // Wait for audio buffer scheduling; reveal once started
        hasPending = true;
        blockedByPriorClause = true;
        continue;
      }

      const elapsed = now - clause.firstStartAt;
      if (elapsed < -0.02) {
        hasPending = true;
        blockedByPriorClause = true;
        continue;
      }

      const effectiveDur = Math.max(0.18, clause.totalDurationSec * 0.92);
      const frac = Math.min(1, Math.max(0, elapsed / effectiveDur));
      let targetChars =
        frac >= 0.99
          ? clause.rawText.length
          : Math.max(1, Math.ceil(clause.rawText.length * frac));

      // Snap mid-clause progress cleanly to nearest word boundary so text never flickers mid-word
      if (targetChars < clause.rawText.length) {
        const nextSpace = clause.rawText.indexOf(' ', targetChars);
        if (nextSpace > 0 && nextSpace - targetChars <= 6) {
          targetChars = nextSpace + 1;
        }
      }

      if (targetChars > clause.revealedChars) {
        clause.revealedChars = targetChars;
      }
      combined += clause.rawText.slice(0, clause.revealedChars);

      if (clause.revealedChars < clause.rawText.length) {
        hasPending = true;
        blockedByPriorClause = true;
      }
    }

    if (combined !== this.lastEmittedSyncText) {
      this.lastEmittedSyncText = combined;
      this.onSyncDisplayUpdate(combined);
    }

    return hasPending || this.activeSources.size > 0;
  }

  stop(): void {
    this.sessionToken += 1;
    this.pendingTasks = 0;
    this.clearSyncState();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const src of this.activeSources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore stop error
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.playChain = Promise.resolve();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    this.emitState(false, false);
    this.resolveIdleWaiters();
  }

  dispose(): void {
    this.stop();
    if (activeGlobalEngine === this) {
      activeGlobalEngine = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.outputNode = null;
    }
  }

  private emitState(loading: boolean, speaking: boolean): void {
    this.onStateChange?.({ loading, speaking });
  }

  private schedulePcmBytes(
    bytes: Uint8Array,
    session: number
  ): { startAt: number; durationSec: number } | null {
    if (session !== this.sessionToken || bytes.byteLength < 2) return null;
    const ctx = this.ensureContext();
    if (!ctx) return null;

    // Guarantee browser speechSynthesis never speaks at the same time as Web Audio voice
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }

    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (sampleCount <= 0) return null;

    const float32 = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const rate = this.speechRate;
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.playbackRate.value = rate;
    src.connect(this.outputNode || ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.004, this.nextStartTime);
    const durationSec = audioBuffer.duration / rate;
    this.nextStartTime = startAt + durationSec;
    this.activeSources.add(src);
    this.emitState(false, true);

    src.onended = () => {
      this.activeSources.delete(src);
      if (session === this.sessionToken && this.activeSources.size === 0 && this.pendingTasks === 0) {
        this.emitState(false, false);
        this.resolveIdleWaiters();
      }
    };

    src.start(startAt);
    return { startAt, durationSec };
  }

  private async scheduleDecodedAudioBytes(
    bytes: Uint8Array,
    mimeType: string,
    session: number
  ): Promise<void> {
    if (session !== this.sessionToken || bytes.byteLength === 0) return;

    const isRiff =
      bytes.byteLength > 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46;

    if (mimeType.includes('pcm') || mimeType.includes('L16')) {
      const evenLen = bytes.byteLength - (bytes.byteLength % 2);
      this.schedulePcmBytes(bytes.subarray(0, evenLen), session);
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const decoded = await ctx.decodeAudioData(arrayBuf);
      if (session !== this.sessionToken) return;

      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore
        }
      }

      const rate = this.speechRate;
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.playbackRate.value = rate;
      src.connect(this.outputNode || ctx.destination);

      const startAt = Math.max(ctx.currentTime + 0.004, this.nextStartTime);
      this.nextStartTime = startAt + decoded.duration / rate;
      this.activeSources.add(src);
      this.emitState(false, true);

      src.onended = () => {
        this.activeSources.delete(src);
        if (session === this.sessionToken && this.activeSources.size === 0 && this.pendingTasks === 0) {
          this.emitState(false, false);
          this.resolveIdleWaiters();
        }
      };

      src.start(startAt);
    } catch {
      if (isRiff) {
        const pcm = bytes.subarray(44);
        const evenLen = pcm.byteLength - (pcm.byteLength % 2);
        this.schedulePcmBytes(pcm.subarray(0, evenLen), session);
      }
    }
  }

  private async speakFallbackUk(text: string, session: number): Promise<void> {
    await this.waitForScheduledAudioDrain(session);

    return new Promise((resolve) => {
      if (
        session !== this.sessionToken ||
        typeof window === 'undefined' ||
        !('speechSynthesis' in window)
      ) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        const ukVoice = pickBestUkBrowserVoice();
        if (ukVoice) utt.voice = ukVoice;
        utt.lang = 'en-GB';
        utt.rate = this.speechRate;
        utt.volume = 1.0;
        this.emitState(false, true);
        utt.onend = () => {
          if (session === this.sessionToken && this.activeSources.size === 0 && this.pendingTasks <= 1) {
            this.emitState(false, false);
          }
          resolve();
        };
        utt.onerror = () => resolve();
        window.speechSynthesis.speak(utt);
      } catch {
        resolve();
      }
    });
  }

  enqueueClause(rawClause: string, session: number): void {
    if (session !== this.sessionToken) return;
    const text = cleanTextForSpeech(rawClause);
    if (!text) return;

    const signal = this.abortController?.signal;
    this.pendingTasks += 1;
    if (this.activeSources.size === 0) {
      this.emitState(true, false);
    }

    // Prefetch & buffer PCM chunks immediately in background while preserving strict sequential scheduling order
    const bufferedChunks: Uint8Array[] = [];
    let streamDone = false;
    let streamError: unknown = null;
    let notifyWaiter: (() => void) | null = null;

    const wake = () => {
      if (notifyWaiter) {
        const fn = notifyWaiter;
        notifyWaiter = null;
        fn();
      }
    };

    void (async () => {
      try {
        const res = await fetch('/api/ai/speak-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ text, voiceName: DEFAULT_UK_VOICE }),
        });

        if (session !== this.sessionToken || signal?.aborted) {
          streamDone = true;
          wake();
          return;
        }

        if (!res.ok || !res.body) {
          throw new Error(`Stream TTS unavailable (${res.status})`);
        }

        const reader = res.body.getReader();
        let carryByte: number | null = null;
        let isFirstChunk = true;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (session !== this.sessionToken || signal?.aborted) {
            void reader.cancel().catch(() => {});
            break;
          }
          if (!value || value.byteLength === 0) continue;

          let chunk = value;
          if (
            isFirstChunk &&
            chunk.byteLength > 44 &&
            chunk[0] === 0x52 &&
            chunk[1] === 0x49 &&
            chunk[2] === 0x46 &&
            chunk[3] === 0x46
          ) {
            chunk = chunk.subarray(44);
          }
          isFirstChunk = false;

          let merged: Uint8Array;
          if (carryByte !== null) {
            merged = new Uint8Array(1 + chunk.byteLength);
            merged[0] = carryByte;
            merged.set(chunk, 1);
            carryByte = null;
          } else {
            merged = chunk;
          }

          if (merged.byteLength % 2 === 1) {
            carryByte = merged[merged.byteLength - 1];
            merged = merged.subarray(0, merged.byteLength - 1);
          }

          if (merged.byteLength >= 2) {
            bufferedChunks.push(merged);
            wake();
          }
        }
      } catch (err) {
        streamError = err;
      } finally {
        streamDone = true;
        wake();
      }
    })();

    this.playChain = this.playChain.then(async () => {
      if (session !== this.sessionToken || signal?.aborted) return;

      let scheduledAnyBytes = false;
      let readIdx = 0;

      try {
        while (true) {
          if (session !== this.sessionToken || signal?.aborted) return;

          while (readIdx < bufferedChunks.length) {
            const bytes = bufferedChunks[readIdx++];
            scheduledAnyBytes = true;
            this.schedulePcmBytes(bytes, session);
          }

          if (streamDone) {
            if (streamError && !scheduledAnyBytes) {
              throw streamError;
            }
            break;
          }

          await new Promise<void>((resolve) => {
            notifyWaiter = resolve;
          });
        }
      } catch (err) {
        if (session !== this.sessionToken || signal?.aborted || (err as Error)?.name === 'AbortError') {
          return;
        }
        if (!scheduledAnyBytes) {
          try {
            const synth = await synthesizeSpeech(text, signal);
            if (session !== this.sessionToken || signal?.aborted) return;
            const bytes = decodeBase64ToBytes(synth.audioBase64);
            await this.scheduleDecodedAudioBytes(bytes, synth.mimeType, session);
            return;
          } catch (retryErr) {
            if (
              session !== this.sessionToken ||
              signal?.aborted ||
              (retryErr as Error)?.name === 'AbortError'
            ) {
              return;
            }
          }
          await this.speakFallbackUk(text, session);
        }
      } finally {
        if (session === this.sessionToken) {
          this.pendingTasks = Math.max(0, this.pendingTasks - 1);
          if (this.pendingTasks === 0 && this.activeSources.size === 0) {
            this.emitState(false, false);
            this.resolveIdleWaiters();
          }
        }
      }
    });
  }
}
