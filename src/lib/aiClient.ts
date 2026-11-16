import {
  calculateMonthlyPnL,
  calculateStats,
  formatR,
  groupPerformance,
  groupPerformanceByTag,
} from './calculations';
import type { AIChatMessage, AIConversation, JournalState } from '../types/journal';

const AI_CONVERSATIONS_KEY = 'msl_v10_ai_conversations';

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
    localStorage.setItem(AI_CONVERSATIONS_KEY, JSON.stringify(conversations.slice(0, 25)));
  } catch {
    // Ignore storage quota errors for chat history
  }
}

export function buildJournalContext(state: JournalState): string {
  const stats = calculateStats(state.trades);
  const bySetup = groupPerformance(state.trades, 'setup');
  const bySession = groupPerformance(state.trades, 'session');
  const byTag = groupPerformanceByTag(state.trades);
  const monthly = calculateMonthlyPnL(state.trades, 6);

  const recentTrades = [...state.trades]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 25)
    .map((t) => {
      const customParts = Object.entries(t.custom || {})
        .map(([k, v]) => {
          const val =
            typeof v === 'object' && v !== null
              ? [v.text, v.number].filter(Boolean).join(' ')
              : String(v || '');
          return val ? `${k}:${val}` : '';
        })
        .filter(Boolean)
        .join(', ');
      const tagsStr = t.tags && t.tags.length > 0 ? t.tags.join(', ') : '';
      return `- ${t.date} | ${t.pair} | ${t.direction} | ${t.setup} | ${t.session} | ${t.result} (${formatR(t.r)}, risk ${t.risk}R) | model: ${t.model || 'none'}${tagsStr ? ` | tags: [${tagsStr}]` : ''}${customParts ? ` | props: [${customParts}]` : ''}${t.notes ? ` | notes: "${t.notes.slice(0, 180)}"` : ''}`;
    });

  const modelsSummary = state.models.map(
    (m) => `- ${m.name} (${m.type}): Entry="${m.entry || '—'}", Risk/Targets="${m.risk || '—'}"`
  );

  const playbookLines = [
    state.playbook.core ? `Core model: ${state.playbook.core}` : '',
    state.playbook.rev ? `Reversal rules: ${state.playbook.rev}` : '',
    state.playbook.cont ? `Continuation rules: ${state.playbook.cont}` : '',
    state.playbook.entry ? `Entry filters: ${state.playbook.entry}` : '',
    state.playbook.risk ? `Invalidation & targets: ${state.playbook.risk}` : '',
  ].filter(Boolean);

  return [
    `Trader: ${state.profile.name || 'Trader'} | Default market: ${state.profile.market || 'Unspecified'}`,
    `Overall Stats: ${stats.totalTrades} trades | Net R: ${formatR(stats.netR)} | Win rate: ${stats.winRate.toFixed(1)}% (${stats.wins.length}W / ${stats.losses.length}L / ${stats.breakevens.length}BE) | Expectancy: ${formatR(stats.expectancy)} | Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} | Avg Winner: ${formatR(stats.avgWinner)} | Avg Loser: ${formatR(stats.avgLoser)} | Max Drawdown: -${stats.maxDrawdownR.toFixed(2)}R | Best Session: ${stats.bestSession ? `${stats.bestSession.name} (${formatR(stats.bestSession.netR)})` : 'None'}`,
    `6-Month Monthly Net R: ${monthly.map((m) => `${m.label}: ${formatR(m.netR)} (${m.tradesCount} trades)`).join(' | ')}`,
    bySetup.length
      ? `By Setup: ${bySetup.map((s) => `${s.label}: ${formatR(s.netR)} (${s.count} trades, ${Math.round(s.winRate)}% WR)`).join(' | ')}`
      : '',
    bySession.length
      ? `By Session: ${bySession.map((s) => `${s.label}: ${formatR(s.netR)} (${s.count} trades, ${Math.round(s.winRate)}% WR)`).join(' | ')}`
      : '',
    byTag.length
      ? `By Tag: ${byTag.map((tg) => `${tg.label}: ${formatR(tg.netR)} (${tg.count} trades, ${Math.round(tg.winRate)}% WR)`).join(' | ')}`
      : '',
    modelsSummary.length ? `Saved Models:\n${modelsSummary.join('\n')}` : 'Saved Models: None yet',
    playbookLines.length ? `Playbook:\n${playbookLines.join('\n')}` : 'Playbook: Empty',
    recentTrades.length ? `Recent Trades (newest first, up to 25):\n${recentTrades.join('\n')}` : 'Recent Trades: None logged yet',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export async function streamAIChat(options: {
  messages: AIChatMessage[];
  journalContext?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const formattedMessages = options.messages.map((m) => ({
    role: m.role,
    text: m.text,
    images: (m.attachments || [])
      .map((att) => splitDataUrl(att.dataUrl))
      .filter((x): x is { mimeType: string; data: string } => x !== null),
  }));

  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      messages: formattedMessages,
      journalContext: options.journalContext,
    }),
  });

  if (!response.ok) {
    let errMsg = `Request failed (${response.status})`;
    try {
      const json = await response.json();
      if (json?.error) errMsg = String(json.error);
    } catch {
      // Ignore parse failure
    }
    throw new Error(errMsg);
  }

  if (!response.body) {
    throw new Error('Streaming response body unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;

      let event: { type?: string; text?: string; error?: string };
      try {
        event = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      if (event.type === 'delta' && typeof event.text === 'string') {
        fullText += event.text;
        options.onDelta(event.text);
      } else if (event.type === 'error') {
        throw new Error(event.error || 'AI generation failed.');
      }
    }
  }

  return fullText;
}
