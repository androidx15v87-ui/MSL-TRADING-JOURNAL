import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Part,
} from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = '10.6.9';
const FAST_MODEL_NAME = 'gemini-3.1-flash-lite';
const HYDROGEN_MODEL_NAME = 'gemini-4-hydrogen';
const TTS_MODEL_NAME = 'gemini-3.8-flash-lite-tts';
const LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';
const UNIFIED_UK_VOICE = 'Zephyr';
const UK_VOICE_STYLE =
  'Speak at a brisk, lively, natural modern London UK English conversational pace—clear, sharp, energetic, with crisp diction and no slow pauses.';
let cachedTtsAttemptLabel: string | null = null;
let cachedTtsStreamLabel: string | null = null;
let cachedApiKey: string | null = null;
let cachedDefaultAiClient: GoogleGenAI | null = null;
let cachedAlphaAiClient: GoogleGenAI | null = null;

interface IncomingMessage {
  role: 'user' | 'model';
  text: string;
  images?: { mimeType: string; data: string }[];
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  journalContext?: string;
  mode?: 'fast' | 'deep';
  webSearch?: boolean;
  voiceTurn?: boolean;
  speakSync?: boolean;
}

const APP_CONTROL_TOOLS: FunctionDeclaration[] = [
  {
    name: 'navigate_app',
    description: 'Navigate to screen: dashboard, journals, journal, calendar, models, analytics, playbook, ai, or settings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        page: { type: Type.STRING, description: 'Target screen ID.' },
      },
      required: ['page'],
    },
  },
  {
    name: 'open_log_trade_modal',
    description: 'Open the Log Trade modal, optionally pre-filling YYYY-MM-DD.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        initialDate: { type: Type.STRING, description: 'Optional YYYY-MM-DD date.' },
      },
    },
  },
  {
    name: 'log_trade',
    description: 'Save a new trade to the journal when requested.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pair: { type: Type.STRING, description: 'Symbol (e.g. EURUSD, XAUUSD, NQ).' },
        direction: { type: Type.STRING, description: 'Long or Short.' },
        setup: { type: Type.STRING, description: 'Reversal, Continuation, Breakout, or Other.' },
        session: { type: Type.STRING, description: 'London, New York, Asia, Overlap, or Other.' },
        result: { type: Type.STRING, description: 'Win, Loss, BE, or Missed.' },
        r: { type: Type.NUMBER, description: 'P&L amount (or missed opportunity) in pnlUnit.' },
        risk: { type: Type.NUMBER, description: 'Risk size in riskUnit (default 1).' },
        pnlUnit: {
          type: Type.STRING,
          description: 'Unit for P&L: r (R-multiple), percent (%), money ($), or value.',
        },
        riskUnit: {
          type: Type.STRING,
          description: 'Unit for risk: r, percent, money, or value.',
        },
        currency: {
          type: Type.STRING,
          description: 'Currency symbol such as $, €, £ when using money unit.',
        },
        model: { type: Type.STRING, description: 'Model name.' },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Execution tags.' },
        notes: { type: Type.STRING, description: 'Trade notes.' },
        date: { type: Type.STRING, description: 'Optional YYYY-MM-DDTHH:mm.' },
      },
      required: ['pair', 'direction', 'result', 'r'],
    },
  },
  {
    name: 'update_trade',
    description: 'Update an existing trade by tradeId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tradeId: { type: Type.STRING, description: 'Trade id from snapshot.' },
        pair: { type: Type.STRING },
        direction: { type: Type.STRING },
        setup: { type: Type.STRING },
        session: { type: Type.STRING },
        result: { type: Type.STRING, description: 'Win, Loss, BE, or Missed.' },
        r: { type: Type.NUMBER },
        risk: { type: Type.NUMBER },
        pnlUnit: { type: Type.STRING, description: 'r, percent, money, or value.' },
        riskUnit: { type: Type.STRING, description: 'r, percent, money, or value.' },
        currency: { type: Type.STRING },
        model: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        notes: { type: Type.STRING },
      },
      required: ['tradeId'],
    },
  },
  {
    name: 'delete_trade',
    description: 'Delete a trade by tradeId when explicitly requested.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tradeId: { type: Type.STRING, description: 'Trade id from snapshot.' },
      },
      required: ['tradeId'],
    },
  },
  {
    name: 'create_trading_model',
    description: 'Create and save a trading model template.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Model name.' },
        type: { type: Type.STRING, description: 'Reversal, Continuation, or Both.' },
        entry: { type: Type.STRING, description: 'Entry criteria.' },
        risk: { type: Type.STRING, description: 'Invalidation & target rules.' },
      },
      required: ['name', 'type', 'entry', 'risk'],
    },
  },
  {
    name: 'update_playbook',
    description: 'Update playbook sections: core, rev, cont, entry, risk.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        core: { type: Type.STRING },
        rev: { type: Type.STRING },
        cont: { type: Type.STRING },
        entry: { type: Type.STRING },
        risk: { type: Type.STRING },
      },
    },
  },
  {
    name: 'update_session_alarm',
    description: 'Create or update a session alarm in Settings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Alarm name.' },
        time: { type: Type.STRING, description: '24h HH:mm.' },
        enabled: { type: Type.BOOLEAN },
      },
      required: ['name'],
    },
  },
  {
    name: 'cycle_motivational_quote',
    description: 'Cycle the dashboard discipline quote.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'save_memory',
    description: 'Save a durable cross-conversation memory (preference, rule, goal, context).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING, description: 'Concise memory statement (max 600 chars).' },
        category: { type: Type.STRING, description: 'preference, rule, goal, or context.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'forget_memory',
    description: 'Remove a saved memory by memoryId or matching query.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memoryId: { type: Type.STRING },
        query: { type: Type.STRING },
      },
    },
  },
  {
    name: 'update_playbook_checks',
    description: 'Check off, uncheck, or reset interactive checklist items on the Trading Playbook.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'check, uncheck, or reset.' },
        query: {
          type: Type.STRING,
          description: 'Optional keyword or scope (core, rev, cont, entry, risk, or model name) to match criteria.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'set_journal_units',
    description: 'Update default P&L unit, Risk unit, or Currency symbol in Journal Settings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        defaultPnlUnit: { type: Type.STRING, description: 'r, percent, money, or value.' },
        defaultRiskUnit: { type: Type.STRING, description: 'r, percent, money, or value.' },
        currency: { type: Type.STRING, description: 'Currency symbol such as $, €, £.' },
      },
    },
  },
];

const GEMINI_TOOLS = [{ functionDeclarations: APP_CONTROL_TOOLS }];
const TOOLS_BY_NAME = new Map<string, FunctionDeclaration>(
  APP_CONTROL_TOOLS.map((tool) => [tool.name!, tool])
);

let lastUpstreamWarmAt = 0;
async function warmUpstreamGemini(): Promise<void> {
  const now = Date.now();
  if (now - lastUpstreamWarmAt < 35000) return;
  lastUpstreamWarmAt = now;
  try {
    await fetch('https://generativelanguage.googleapis.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(1800),
    });
  } catch {
    // Non-blocking TLS/socket pool warm-up only
  }
}

function selectToolsForMessages(
  messages: IncomingMessage[],
): Array<{ functionDeclarations: FunctionDeclaration[] }> | undefined {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
  const text = lastUser.trim().toLowerCase();
  if (!text) return undefined;

  const picked = new Set<string>();

  if (
    /\b(open|go to|switch|navigate|take me|show me|view|jump to)\b/.test(text) &&
    /\b(dashboard|overview|accounts|journals|journal|calendar|models|analytics|playbook|ai|settings|log trade|modal|screen|tab|page)\b/.test(
      text
    )
  ) {
    picked.add('navigate_app');
    picked.add('open_log_trade_modal');
  } else if (/\bopen log\b|\blog trade modal\b/.test(text)) {
    picked.add('open_log_trade_modal');
  }

  if (
    /\b(log|record|enter|add|save|edit|update|modify|fix|change|delete|remove)\b/.test(text) &&
    /\b(trade|trades|position|entry|win|loss|be|missed|eurusd|xauusd|gbpusd|usdjpy|nas|nq|es|btc|eth|pair|r\b|\$|%)\b/.test(
      text
    )
  ) {
    picked.add('log_trade');
    picked.add('update_trade');
    picked.add('delete_trade');
    picked.add('open_log_trade_modal');
  }

  if (
    /\b(model|template|playbook|alarm|alert|reminder|quote|motivation)\b/.test(text) &&
    /\b(create|add|save|update|edit|change|set|enable|disable|turn|cycle|next|refresh|new)\b/.test(
      text
    )
  ) {
    picked.add('create_trading_model');
    picked.add('update_playbook');
    picked.add('update_session_alarm');
    picked.add('cycle_motivational_quote');
  }

  if (
    /\b(remember|memorize|don't forget|never forget|save.*memory|keep in mind|note that|my preference|always respond|always call|from now on|forget|remove memory|delete memory)\b/.test(
      text
    )
  ) {
    picked.add('save_memory');
    picked.add('forget_memory');
  }

  if (/\b(check off|tick off|uncheck|reset checklist|checklist|criteria)\b/.test(text)) {
    picked.add('update_playbook_checks');
  }

  if (
    /\b(unit|units|currency|dollar|dollars|euro|pound|percent|percentage|r-multiple|r multiple|switch to \$|switch to %)\b/.test(
      text
    )
  ) {
    picked.add('set_journal_units');
  }

  // Handle brief multi-turn action confirmations like "yes", "do it", "apply that"
  if (
    picked.size === 0 &&
    messages.length >= 2 &&
    text.length <= 40 &&
    /\b(yes|yeah|yep|sure|ok|okay|do it|go ahead|apply|confirm|save it|log it)\b/.test(text)
  ) {
    return GEMINI_TOOLS;
  }

  if (picked.size === 0) return undefined;
  const declarations = Array.from(picked)
    .map((name) => TOOLS_BY_NAME.get(name))
    .filter((d): d is FunctionDeclaration => Boolean(d));
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;
}

function shouldUseWebSearch(messages: IncomingMessage[], explicitWebSearch?: boolean): boolean {
  if (explicitWebSearch) return true;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
  const text = lastUser.trim().toLowerCase();
  if (!text) return false;
  const asksRealtimeWeb =
    /\b(today|latest|current|now|this week|news|headline|cpi|nfp|fomc|fed|ecb|boe|boj|rate decision|yield|dxy|spot price|live price|search|look up|online|web|forecast|economic calendar|tomorrow)\b/.test(
      text
    );
  if (!asksRealtimeWeb) return false;
  const purePersonalJournalQuery =
    /\b(my trades|my journal|my win rate|my pnl|log a trade|log this trade|open analytics|open journal)\b/.test(
      text
    ) && !/\b(news|cpi|nfp|fomc|fed|ecb|boe|boj|headline|calendar|search|web|online|spot price|live price)\b/.test(text);
  return !purePersonalJournalQuery;
}

function getAiClient(apiVersion?: 'v1alpha'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    cachedDefaultAiClient = null;
    cachedAlphaAiClient = null;
  }
  if (apiVersion === 'v1alpha') {
    if (!cachedAlphaAiClient) {
      cachedAlphaAiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          apiVersion: 'v1alpha',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
    }
    return cachedAlphaAiClient;
  }
  if (!cachedDefaultAiClient) {
    cachedDefaultAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });
  }
  return cachedDefaultAiClient;
}

function buildSystemInstruction(
  journalContext?: string,
  options?: { isDeep?: boolean; hasTools?: boolean; hasWebSearch?: boolean }
): string {
  const isDeep = Boolean(options?.isDeep);
  const hasTools = Boolean(options?.hasTools);
  const hasWebSearch = Boolean(options?.hasWebSearch);
  return [
    `You are KAIROS — flagship quantitative trading analyst & multi-domain intelligence for MSL Journal.`,
    isDeep
      ? '- Lead immediately with the highest-leverage verdict in sentence 1 (zero preamble), then deliver crisp, institutional-grade quantitative breakdowns, tables, edge/leak diagnostics, or clean code.'
      : '- Lead immediately with the direct answer in the very first words—zero filler, zero throat-clearing. Keep replies ultra-crisp (1–4 tight sentences or compact bullets) unless detail/code/audit is requested.',
    '- Ground all trade IDs, PnL, units (R, %, money, value), missed trades, win rate, Pair/Model/Direction edge, Post-Loss Tilt, Weekday bias, and Matched Trades strictly in the Snapshot (Missed trades are excluded from realized PnL).',
    '- On charts: deliver Market Structure & Bias, Key Liquidity / POI Levels, Invalidation, and Asymmetric R:R Verdict concisely.',
    hasWebSearch
      ? '- Live web grounding is active: use fresh verified data for macro catalysts, rates, headlines, and market structure without inventing numbers.'
      : '',
    hasTools
      ? '- Call app tools only when requested, and include your brief confirmation text in the same turn.'
      : '',
    journalContext
      ? `--- SNAPSHOT ---\n${journalContext}\n--- END ---`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const modelCooldownUntil = new Map<string, number>();

function isRateLimitError(err: unknown): boolean {
  const raw = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    raw.includes('resource_exhausted') ||
    raw.includes('429') ||
    raw.includes('quota') ||
    raw.includes('rate limit') ||
    raw.includes('too many requests')
  );
}

function parseRetryDelayMs(err: unknown): number | null {
  const raw = err instanceof Error ? err.message : String(err || '');
  const match = raw.match(/retry(?:\s+in|\s+after)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (!match) return null;
  const val = Number(match[1]);
  if (!Number.isFinite(val)) return null;
  const ms = match[2].toLowerCase() === 'ms' ? val : val * 1000;
  return Math.min(3500, Math.max(500, Math.round(ms)));
}

function markModelCooldown(modelName: string, err: unknown): void {
  const rateLimited = isRateLimitError(err);
  const parsed = parseRetryDelayMs(err);
  const durationMs = rateLimited ? Math.max(18000, (parsed || 2000) * 6) : 7000;
  modelCooldownUntil.set(modelName, Date.now() + durationMs);
}

function isModelHealthy(modelName: string): boolean {
  const until = modelCooldownUntil.get(modelName) || 0;
  return Date.now() >= until;
}

function orderByHealth<T extends { model: string }>(items: T[]): T[] {
  const healthy: T[] = [];
  const cooling: T[] = [];
  for (const item of items) {
    if (isModelHealthy(item.model)) {
      healthy.push(item);
    } else {
      cooling.push(item);
    }
  }
  return [...healthy, ...cooling];
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || 'AI request failed.');
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('api key')) {
    return {
      status: 401,
      message: 'Gemini API key is missing or invalid. Check your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'KAIROS is temporarily busy across model lanes. Tap Retry in a couple seconds.',
    };
  }
  if (
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('timed out')
  ) {
    return {
      status: 503,
      message: 'KAIROS is experiencing temporary server demand. Please tap Retry.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: 'Requested Gemini model is unavailable. Verify model configuration.',
    };
  }
  return {
    status: 500,
    message: raw || 'Failed to generate AI response.',
  };
}

function isRetryableModelError(err: unknown): boolean {
  const raw = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    raw.includes('503') ||
    raw.includes('unavailable') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('timed out') ||
    raw.includes('429') ||
    raw.includes('resource_exhausted') ||
    raw.includes('quota') ||
    raw.includes('rate limit') ||
    raw.includes('404') ||
    raw.includes('not_found')
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatToolMetric(val: unknown, unit: unknown, currency: unknown): string {
  const num = Number(val || 0);
  const abs = Math.abs(num);
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const u = String(unit || 'r');
  const curr = String(currency || 'R').trim() || 'R';
  if (u === 'percent') return `${sign}${abs}%`;
  if (u === 'money') return curr.toUpperCase() === 'R' ? `${sign}${abs}R` : `${sign}${curr}${abs}`;
  if (u === 'value') return `${sign}${abs}`;
  return `${sign}${abs}R`;
}

function summarizeActionFallback(calls: FunctionCall[]): string {
  const summary = calls
    .map((c) => {
      const args = (c.args || {}) as Record<string, unknown>;
      switch (c.name) {
        case 'log_trade':
          return `Logged **${String(args.pair || 'Trade').toUpperCase()}** ${String(args.direction || '')} (${String(args.result || '')} ${formatToolMetric(args.r, args.pnlUnit, args.currency)})`;
        case 'update_trade':
          return `Updated trade \`${String(args.tradeId || '')}\``;
        case 'delete_trade':
          return `Deleted trade \`${String(args.tradeId || '')}\``;
        case 'navigate_app':
          return `Switched view to **${String(args.page || 'dashboard')}**`;
        case 'open_log_trade_modal':
          return 'Opened the Log Trade modal';
        case 'create_trading_model':
          return `Saved trading model **${String(args.name || '')}**`;
        case 'update_playbook':
          return 'Updated your trading playbook';
        case 'update_session_alarm':
          return `Updated session alarm **${String(args.name || '')}**`;
        case 'cycle_motivational_quote':
          return 'Refreshed dashboard discipline quote';
        case 'save_memory':
          return `Saved memory: "${String(args.content || '').slice(0, 80)}"`;
        case 'forget_memory':
          return 'Removed memory item';
        case 'update_playbook_checks':
          return args.action === 'reset'
            ? 'Reset playbook checklist items'
            : `${args.action === 'uncheck' ? 'Unchecked' : 'Checked off'} playbook checklist items`;
        case 'set_journal_units':
          return 'Updated journal metric units';
        default:
          return `Executed ${c.name}`;
      }
    })
    .join('; ');
  return `Done — ${summary}.`;
}

function sanitizeTextForSpeech(markdown: string): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[-*_]{3,}/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= 1500) return cleaned;
  const slice = cleaned.slice(0, 1500);
  const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  return lastPeriod > 400 ? slice.slice(0, lastPeriod + 1) : `${slice.trim()}…`;
}

interface SyncClauseItem {
  rawText: string;
  spokenText: string;
}

/**
 * Splits streamed response text into paired { rawText, spokenText } segments
 * so server TTS starts immediately on the opening ~4-7 words while keeping
 * exact Markdown fidelity and low TTS round-trip overhead afterward.
 */
function extractServerSyncClauses(
  buffer: string,
  isFirstClause: boolean,
  flushAll: boolean
): { items: SyncClauseItem[]; remainder: string } {
  const items: SyncClauseItem[] = [];
  let work = buffer;
  let first = isFirstClause;

  while (work.length > 0) {
    // Wait before splitting inside an unclosed fenced code block unless flushing
    const fenceCount = (work.match(/```/g) || []).length;
    if (!flushAll && fenceCount % 2 === 1) {
      break;
    }

    const minSentenceLen = first ? 8 : 42;
    const minPauseLen = first ? 18 : 88;
    const maxClauseLen = first ? 46 : 160;

    let splitAt = -1;

    const sentenceMatch = work.match(/[.!?](?:\s|$)|\n{2,}/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      const endPos = sentenceMatch.index + sentenceMatch[0].length;
      if (endPos >= minSentenceLen) {
        splitAt = endPos;
      }
    }

    if (splitAt === -1) {
      const pauseMatch = work.match(/[,;:]\s|—\s?|\n/);
      if (pauseMatch && pauseMatch.index !== undefined) {
        const endPos = pauseMatch.index + pauseMatch[0].length;
        if (endPos >= minPauseLen) {
          splitAt = endPos;
        }
      }
    }

    if (splitAt === -1 && work.length >= maxClauseLen) {
      const spaceIdx = work.lastIndexOf(' ', maxClauseLen);
      splitAt = spaceIdx >= 10 ? spaceIdx + 1 : maxClauseLen;
    }

    if (splitAt === -1) break;

    const rawText = work.slice(0, splitAt);
    work = work.slice(splitAt);
    const spokenText = sanitizeTextForSpeech(rawText);
    items.push({ rawText, spokenText });
    if (spokenText) {
      first = false;
    }
  }

  if (flushAll && work.length > 0) {
    items.push({
      rawText: work,
      spokenText: sanitizeTextForSpeech(work),
    });
    work = '';
  }

  return { items, remainder: work };
}

async function openGeminiTtsStream(
  defaultAi: GoogleGenAI,
  spokenText: string
): Promise<{
  stream: AsyncIterable<{ candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> }>;
  label: string;
}> {
  const voiceName = UNIFIED_UK_VOICE;
  const ukStyle = UK_VOICE_STYLE;
  const alphaAi = getAiClient('v1alpha') || defaultAi;

  const streamAttempts: Array<{
    label: string;
    run: () => ReturnType<GoogleGenAI['models']['generateContentStream']>;
  }> = [
    {
      label: 'v1alpha-lite-stream',
      run: () =>
        alphaAi.models.generateContentStream({
          model: TTS_MODEL_NAME,
          contents: [
            {
              role: 'user',
              parts: [{ text: spokenText, speechMetadata: { style: ukStyle } }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
    },
    {
      label: 'default-lite-stream-uk',
      run: () =>
        defaultAi.models.generateContentStream({
          model: TTS_MODEL_NAME,
          contents: [
            {
              role: 'user',
              parts: [{ text: spokenText, speechMetadata: { style: ukStyle } }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
    },
    {
      label: 'v1alpha-speechConfig-only-stream',
      run: () =>
        alphaAi.models.generateContentStream({
          model: TTS_MODEL_NAME,
          contents: [{ role: 'user', parts: [{ text: spokenText }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
    },
  ];

  const ordered =
    cachedTtsStreamLabel && streamAttempts.some((a) => a.label === cachedTtsStreamLabel)
      ? [
          ...streamAttempts.filter((a) => a.label === cachedTtsStreamLabel),
          ...streamAttempts.filter((a) => a.label !== cachedTtsStreamLabel),
        ]
      : streamAttempts;

  let lastErr: unknown = null;
  for (const attempt of ordered) {
    try {
      const stream = await withTimeout(attempt.run(), 7500, attempt.label);
      cachedTtsStreamLabel = attempt.label;
      return { stream, label: attempt.label };
    } catch (err) {
      lastErr = err;
      const rawErr = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
      const canContinue =
        rawErr.includes('invalid_argument') ||
        rawErr.includes('unknown name') ||
        rawErr.includes('cannot find field') ||
        isRetryableModelError(err);
      if (!canContinue) break;
    }
  }
  throw lastErr || new Error('TTS stream unavailable');
}

function handleLiveTranscribeConnection(clientWs: WebSocket): void {
  const ai = getAiClient('v1alpha') || getAiClient();
  if (!ai) {
    clientWs.send(JSON.stringify({ error: 'GEMINI_API_KEY is not configured.' }));
    clientWs.close();
    return;
  }

  let closed = false;
  let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
  const pendingFrames: string[] = [];

  void ai.live
    .connect({
      model: LIVE_TRANSCRIBE_MODEL,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          languageCodes: [],
        },
      },
      callbacks: {
        onopen: () => {
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ ready: true }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed || clientWs.readyState !== clientWs.OPEN) return;
          const content = message.serverContent;
          if (content?.interimInputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ interimTranscript: content.interimInputTranscription.text })
            );
          }
          if (content?.inputTranscription?.text) {
            clientWs.send(JSON.stringify({ transcript: content.inputTranscription.text }));
          }
        },
        onerror: (err: unknown) => {
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            const msg = err instanceof Error ? err.message : 'Live transcription connection error.';
            clientWs.send(JSON.stringify({ error: msg }));
          }
        },
        onclose: () => {
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ closed: true }));
            clientWs.close();
          }
        },
      },
    })
    .then((liveSession) => {
      if (closed) {
        try {
          liveSession.close();
        } catch {
          // Ignore
        }
        return;
      }
      session = liveSession;
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ ready: true }));
      }
      while (pendingFrames.length > 0) {
        const b64 = pendingFrames.shift();
        if (b64) {
          session.sendRealtimeInput({
            audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
          });
        }
      }
    })
    .catch((err) => {
      if (!closed && clientWs.readyState === clientWs.OPEN) {
        const parsed = formatGeminiError(err);
        clientWs.send(JSON.stringify({ error: parsed.message }));
        clientWs.close();
      }
    });

  clientWs.on('message', (raw, isBinary) => {
    if (closed) return;
    if (isBinary) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (buf.byteLength < 2) return;
      const b64 = buf.toString('base64');
      if (session) {
        session.sendRealtimeInput({
          audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (pendingFrames.length < 40) {
        pendingFrames.push(b64);
      }
      return;
    }

    try {
      const msg = JSON.parse(raw.toString()) as { audio?: string; stop?: boolean };
      if (msg.stop) {
        session?.sendRealtimeInput({ audioStreamEnd: true });
        return;
      }
      if (msg.audio) {
        if (session) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (pendingFrames.length < 40) {
          pendingFrames.push(msg.audio);
        }
      }
    } catch {
      // Ignore malformed JSON control frames
    }
  });

  clientWs.on('close', () => {
    closed = true;
    if (session) {
      try {
        session.close();
      } catch {
        // Ignore
      }
      session = null;
    }
  });
}

async function startServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    next();
  });
  const httpServer = http.createServer(app);
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;

  const transcribeWss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const reqUrl = req.url || '';
    if (reqUrl.startsWith('/api/ai/transcribe-ws')) {
      transcribeWss.handleUpgrade(req, socket, head, (ws) => {
        handleLiveTranscribeConnection(ws);
      });
    }
  });

  app.use('/api/ai/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }));
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (req, res) => {
    if (req.query.warm === '1') {
      void warmUpstreamGemini();
    }
    res.json({
      ok: true,
      version: APP_VERSION,
      fastModel: FAST_MODEL_NAME,
      deepModel: HYDROGEN_MODEL_NAME,
      ttsModel: TTS_MODEL_NAME,
      liveTranscribeModel: LIVE_TRANSCRIBE_MODEL,
    });
  });

  app.post('/api/ai/chat', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      });
      return;
    }

    const body = req.body as ChatRequestBody | undefined;
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      res.status(400).json({ error: 'At least one message is required.' });
      return;
    }

    const isDeep = body?.mode === 'deep';
    const speakSync = Boolean(body?.speakSync);
    const activeTools = selectToolsForMessages(messages);
    const hasTools = Boolean(activeTools);
    const useWebSearch = shouldUseWebSearch(messages, body?.webSearch);
    const combinedTools: Array<{ googleSearch?: Record<string, never>; functionDeclarations?: FunctionDeclaration[] }> | undefined =
      useWebSearch || activeTools
        ? [
            ...(useWebSearch ? [{ googleSearch: {} }] : []),
            ...(activeTools || []),
          ]
        : undefined;
    const useHybridToolConfig = Boolean(useWebSearch && activeTools);
    const systemInstruction = buildSystemInstruction(body?.journalContext, {
      isDeep,
      hasTools,
      hasWebSearch: useWebSearch,
    });
    const compactSystemInstruction = buildSystemInstruction(
      body?.journalContext ? body.journalContext.slice(0, 1100) : undefined,
      { isDeep: false, hasTools, hasWebSearch: useWebSearch }
    );

    const buildContents = (
      msgList: IncomingMessage[],
      maxMsgs: number,
      keepImagesLastN: number,
      maxOlderTextChars: number
    ): Content[] => {
      const sliced = msgList.length > maxMsgs ? msgList.slice(-maxMsgs) : msgList;
      const imgCutoffIdx = Math.max(0, sliced.length - keepImagesLastN);
      const olderTextCutoffIdx = Math.max(0, sliced.length - 2);
      return sliced.map((msg, idx) => {
        const parts: Part[] = [];
        if (idx >= imgCutoffIdx && Array.isArray(msg.images)) {
          for (const img of msg.images) {
            if (img?.data && img?.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.data,
                },
              });
            }
          }
        }
        if (msg.text && msg.text.trim().length > 0) {
          const textVal =
            idx < olderTextCutoffIdx && msg.text.length > maxOlderTextChars
              ? `${msg.text.slice(0, maxOlderTextChars)}…`
              : msg.text;
          parts.push({ text: textVal });
        } else if (parts.length === 0) {
          parts.push({ text: ' ' });
        }
        return {
          role: msg.role === 'model' ? 'model' : 'user',
          parts,
        };
      });
    };

    const contents: Content[] = buildContents(
      messages,
      isDeep ? 10 : 6,
      isDeep ? 2 : 1,
      isDeep ? 1800 : 900
    );
    const compactContents: Content[] = buildContents(messages, 4, 1, 600);
    const hasRecentImages = contents.some((c) =>
      c.parts?.some((p) => Boolean((p as { inlineData?: unknown }).inlineData))
    );

    res.socket?.setNoDelay(true);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        clientClosed = true;
      }
    });

    const sendEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded && !clientClosed) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    // Concurrent ordered Voice+Text pipeline when speakSync is active
    let syncClauseCounter = 0;
    let syncBuffer = '';
    let isFirstSyncClause = true;
    let syncEmitChain: Promise<void> = Promise.resolve();

    const enqueueSyncItem = (item: SyncClauseItem) => {
      const clauseId = syncClauseCounter++;
      // Immediately announce the clause's raw markdown & speech mapping
      sendEvent({
        type: 'sync_clause_meta',
        clauseId,
        rawText: item.rawText,
        spokenText: item.spokenText,
      });

      if (!item.spokenText || item.spokenText.length < 2) {
        syncEmitChain = syncEmitChain.then(() => {
          sendEvent({ type: 'sync_clause_end', clauseId, textOnly: true });
        });
        return;
      }

      // Kick off TTS synthesis immediately in background, buffer chunks if an earlier clause is still emitting
      const bufferedChunks: string[] = [];
      let workerDone = false;
      let workerFailed = false;
      let notify: (() => void) | null = null;
      const wake = () => {
        if (notify) {
          const fn = notify;
          notify = null;
          fn();
        }
      };

      void (async () => {
        try {
          const { stream } = await openGeminiTtsStream(ai, item.spokenText);
          for await (const chunk of stream) {
            if (clientClosed || res.writableEnded) break;
            const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (b64) {
              bufferedChunks.push(b64);
              wake();
            }
          }
          if (bufferedChunks.length === 0) {
            workerFailed = true;
          }
        } catch {
          workerFailed = true;
        } finally {
          workerDone = true;
          wake();
        }
      })();

      syncEmitChain = syncEmitChain.then(async () => {
        if (clientClosed || res.writableEnded) return;
        let idx = 0;
        let emittedAny = false;
        while (true) {
          if (clientClosed || res.writableEnded) return;
          while (idx < bufferedChunks.length) {
            emittedAny = true;
            sendEvent({ type: 'audio_pcm', clauseId, data: bufferedChunks[idx++] });
          }
          if (workerDone) break;
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
        sendEvent({
          type: 'sync_clause_end',
          clauseId,
          textOnly: workerFailed || !emittedAny,
        });
      });
    };

    const pushDelta = (text: string) => {
      if (!speakSync) {
        sendEvent({ type: 'delta', text });
        return;
      }
      sendEvent({ type: 'delta', text });
      syncBuffer += text;
      const { items, remainder } = extractServerSyncClauses(syncBuffer, isFirstSyncClause, false);
      syncBuffer = remainder;
      for (const item of items) {
        enqueueSyncItem(item);
        if (item.spokenText) isFirstSyncClause = false;
      }
    };

    const flushSyncBuffer = () => {
      if (!speakSync || !syncBuffer) return;
      const { items, remainder } = extractServerSyncClauses(syncBuffer, isFirstSyncClause, true);
      syncBuffer = remainder;
      for (const item of items) {
        enqueueSyncItem(item);
        if (item.spokenText) isFirstSyncClause = false;
      }
    };

    const baseCandidates: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = isDeep
      ? [
          {
            model: HYDROGEN_MODEL_NAME,
            level: ThinkingLevel.MEDIUM,
            timeoutMs: hasRecentImages ? 8500 : 5200,
          },
          {
            model: FAST_MODEL_NAME,
            level: ThinkingLevel.LOW,
            timeoutMs: hasRecentImages ? 7500 : 4200,
          },
        ]
      : [
          {
            model: FAST_MODEL_NAME,
            level: ThinkingLevel.MINIMAL,
            timeoutMs: hasRecentImages ? 5500 : 2600,
          },
          {
            model: HYDROGEN_MODEL_NAME,
            level: ThinkingLevel.LOW,
            timeoutMs: hasRecentImages ? 7000 : 4500,
          },
        ];

    const retryBackoffs = [0, 60, 180];

    try {
      let activeModel = baseCandidates[0].model;
      let streamedText = '';
      const collectedCalls: FunctionCall[] = [];
      const collectedSources = new Map<string, { title: string; uri: string }>();
      const modelTurnParts: Part[] = [];
      let emittedActionsImmediately = false;
      let succeeded = false;
      let lastErr: unknown = null;

      for (let pass = 0; pass < retryBackoffs.length; pass++) {
        if (res.writableEnded || clientClosed || succeeded) break;

        if (pass > 0) {
          const parsedDelay = parseRetryDelayMs(lastErr);
          const waitMs = Math.min(2000, (parsedDelay || retryBackoffs[pass]) + Math.floor(Math.random() * 90));
          sendEvent({
            type: 'status',
            status: pass === 1 ? 'Switching to fastest lane…' : 'Connecting…',
          });
          await sleepMs(waitMs);
          if (res.writableEnded || clientClosed) break;
        }

        const orderedCandidates = orderByHealth(baseCandidates);
        const passContents = pass === 0 ? contents : compactContents;
        const passInstruction = pass <= 1 ? systemInstruction : compactSystemInstruction;

        for (const candidate of orderedCandidates) {
          if (res.writableEnded || clientClosed) break;

          let candidateStreamed = '';
          const candidateCalls: FunctionCall[] = [];
          const candidateParts: Part[] = [];

          try {
            const stream1 = await withTimeout(
              ai.models.generateContentStream({
                model: candidate.model,
                contents: passContents,
                config: {
                  systemInstruction: passInstruction,
                  thinkingConfig: {
                    thinkingLevel: pass >= 2 ? ThinkingLevel.LOW : candidate.level,
                  },
                  ...(combinedTools ? { tools: combinedTools } : {}),
                  ...(useHybridToolConfig
                    ? { toolConfig: { includeServerSideToolInvocations: true } }
                    : {}),
                },
              }),
              candidate.timeoutMs,
              candidate.model
            );

            const iterator = stream1[Symbol.asyncIterator]();
            while (true) {
              if (res.writableEnded || clientClosed) break;
              const nextResult = await withTimeout(
                iterator.next(),
                candidateStreamed || candidateCalls.length > 0 ? 12000 : candidate.timeoutMs,
                `${candidate.model} chunk`
              );
              if (nextResult.done) break;

              const chunk = nextResult.value;
              const text = chunk.text;
              if (text) {
                candidateStreamed += text;
                streamedText += text;
                pushDelta(text);
              }

              const gChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              if (Array.isArray(gChunks)) {
                for (const gChunk of gChunks) {
                  const uri = gChunk?.web?.uri;
                  if (typeof uri === 'string' && uri && !collectedSources.has(uri)) {
                    collectedSources.set(uri, {
                      uri,
                      title:
                        typeof gChunk?.web?.title === 'string' && gChunk.web.title.trim()
                          ? gChunk.web.title.trim()
                          : uri.replace(/^https?:\/\/(?:www\.)?/, '').split('/')[0] || 'Source',
                    });
                  }
                }
              }

              const parts = chunk.candidates?.[0]?.content?.parts;
              if (Array.isArray(parts)) {
                for (const part of parts) {
                  candidateParts.push(part);
                }
              }

              if (Array.isArray(chunk.functionCalls) && chunk.functionCalls.length > 0) {
                const freshCalls: FunctionCall[] = [];
                for (const fc of chunk.functionCalls) {
                  if (fc?.name) {
                    candidateCalls.push(fc);
                    freshCalls.push(fc);
                  }
                }
                if (freshCalls.length > 0 && !res.writableEnded && !clientClosed) {
                  emittedActionsImmediately = true;
                  sendEvent({
                    type: 'actions',
                    actions: freshCalls.map((fc) => ({
                      name: fc.name,
                      args: fc.args || {},
                    })),
                  });
                }
              }
            }

            modelCooldownUntil.delete(candidate.model);
            collectedCalls.push(...candidateCalls);
            modelTurnParts.push(...candidateParts);
            activeModel = candidate.model;
            succeeded = true;
            break;
          } catch (err) {
            lastErr = err;
            if (!candidateStreamed && candidateCalls.length === 0 && isRetryableModelError(err)) {
              markModelCooldown(candidate.model, err);
              continue;
            }
            if (candidateStreamed || candidateCalls.length > 0) {
              collectedCalls.push(...candidateCalls);
              modelTurnParts.push(...candidateParts);
              activeModel = candidate.model;
              succeeded = true;
              break;
            }
            throw err;
          }
        }

        if (!succeeded && lastErr && !isRetryableModelError(lastErr)) {
          break;
        }
      }

      if (!succeeded && lastErr) {
        throw lastErr;
      }

      if (collectedCalls.length > 0 && !res.writableEnded && !clientClosed) {
        if (!emittedActionsImmediately) {
          sendEvent({
            type: 'actions',
            actions: collectedCalls.map((fc) => ({
              name: fc.name,
              args: fc.args || {},
            })),
          });
        }

        if (!streamedText.trim()) {
          const instantConfirmActions = new Set([
            'navigate_app',
            'open_log_trade_modal',
            'cycle_motivational_quote',
            'save_memory',
            'forget_memory',
            'log_trade',
            'update_trade',
            'delete_trade',
            'create_trading_model',
            'update_playbook',
            'update_session_alarm',
            'update_playbook_checks',
            'set_journal_units',
          ]);
          const lastUserText = (messages[messages.length - 1]?.text || '').trim().toLowerCase();
          const hasAnalyticalAsk =
            lastUserText.includes('?') ||
            /\b(explain|why|how|suggest|analyze|audit|review|compare|improve|advice|feedback|recommend)\b/.test(
              lastUserText
            );
          const isInstantActionOnly =
            collectedCalls.every((fc) => instantConfirmActions.has(fc.name || '')) &&
            !hasAnalyticalAsk;

          if (isInstantActionOnly) {
            pushDelta(summarizeActionFallback(collectedCalls));
          } else {
            try {
              const responseParts: Part[] = collectedCalls.map((fc) => ({
                functionResponse: {
                  id: fc.id,
                  name: fc.name || 'app_action',
                  response: { status: 'executed', appliedToJournal: true },
                },
              }));

              const turn2Contents: Content[] = [
                ...contents.slice(-2),
                {
                  role: 'model',
                  parts:
                    modelTurnParts.length > 0
                      ? modelTurnParts
                      : collectedCalls.map((fc) => ({ functionCall: fc })),
                },
                {
                  role: 'user',
                  parts: responseParts,
                },
              ];

              const turn2Level =
                activeModel === HYDROGEN_MODEL_NAME ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;

              const stream2 = await withTimeout(
                ai.models.generateContentStream({
                  model: activeModel,
                  contents: turn2Contents,
                  config: {
                    systemInstruction: compactSystemInstruction,
                    thinkingConfig: {
                      thinkingLevel: turn2Level,
                    },
                  },
                }),
                4200,
                `${activeModel} turn2`
              );

              let turn2Text = '';
              for await (const chunk of stream2) {
                if (res.writableEnded || clientClosed) break;
                const text = chunk.text;
                if (text) {
                  turn2Text += text;
                  pushDelta(text);
                }
              }

              if (!turn2Text.trim() && !res.writableEnded && !clientClosed) {
                pushDelta(summarizeActionFallback(collectedCalls));
              }
            } catch {
              if (!res.writableEnded && !clientClosed) {
                pushDelta(summarizeActionFallback(collectedCalls));
              }
            }
          }
        }
      }

      if (speakSync && !res.writableEnded && !clientClosed) {
        flushSyncBuffer();
        await syncEmitChain;
      }

      if (collectedSources.size > 0 && !res.writableEnded && !clientClosed) {
        sendEvent({
          type: 'sources',
          sources: Array.from(collectedSources.values()).slice(0, 6),
        });
      }

      if (!res.writableEnded && !clientClosed) {
        sendEvent({ type: 'done' });
        res.end();
      }
    } catch (err) {
      const parsed = formatGeminiError(err);
      if (!res.writableEnded && !clientClosed) {
        sendEvent({ type: 'error', error: parsed.message, status: parsed.status });
        res.end();
      }
    }
  });

  app.post('/api/ai/transcribe', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      });
      return;
    }

    let audioBase64 = '';
    let mimeType = 'audio/webm';

    if (Buffer.isBuffer(req.body) && req.body.byteLength > 0) {
      audioBase64 = req.body.toString('base64');
      const headerMime = req.headers['content-type'];
      if (typeof headerMime === 'string' && headerMime.trim()) {
        mimeType = headerMime.trim().split(';')[0];
      }
    } else {
      const body = req.body as { audioBase64?: string; mimeType?: string } | undefined;
      audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64.trim() : '';
      if (typeof body?.mimeType === 'string' && body.mimeType.trim()) {
        mimeType = body.mimeType.trim().split(';')[0];
      }
    }

    if (!audioBase64) {
      res.status(400).json({ error: 'Audio payload is required.' });
      return;
    }

    const transcribeCandidates = orderByHealth([
      { model: 'gemini-3.5-transcribe' },
      { model: FAST_MODEL_NAME },
      { model: HYDROGEN_MODEL_NAME },
    ]);
    let lastTranscribeErr: unknown = null;

    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) {
        await sleepMs(300);
      }
      for (const { model: modelName } of transcribeCandidates) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: modelName,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                  {
                    text: 'Transcribe the spoken words accurately in plain text with clean punctuation. Return only the spoken words—no commentary.',
                  },
                ],
              },
              config:
                modelName === FAST_MODEL_NAME
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
                  : modelName === HYDROGEN_MODEL_NAME
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : undefined,
            }),
            5000,
            modelName
          );
          modelCooldownUntil.delete(modelName);
          res.json({ text: (response.text || '').trim() });
          return;
        } catch (err) {
          lastTranscribeErr = err;
          if (isRetryableModelError(err)) {
            markModelCooldown(modelName, err);
            continue;
          }
          break;
        }
      }
      if (lastTranscribeErr && !isRetryableModelError(lastTranscribeErr)) {
        break;
      }
    }

    const parsed = formatGeminiError(lastTranscribeErr);
    res.status(parsed.status).json({ error: parsed.message });
  });

  app.post('/api/ai/speak', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      });
      return;
    }

    const body = req.body as { text?: string; voiceName?: string } | undefined;
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    const spokenText = sanitizeTextForSpeech(rawText);
    if (!spokenText) {
      res.status(400).json({ error: 'Text content is required for voice synthesis.' });
      return;
    }

    // Lock strictly to one single unified UK English voice so two voices never conflict
    const voiceName = UNIFIED_UK_VOICE;
    const ukStyle = UK_VOICE_STYLE;
    const alphaAi = getAiClient('v1alpha') || ai;

    const ttsAttempts: Array<{
      label: string;
      client: GoogleGenAI;
      model: string;
      run: (client: GoogleGenAI, model: string) => ReturnType<GoogleGenAI['models']['generateContent']>;
    }> = [
      {
        label: 'v1alpha-lite-tts-uk',
        client: alphaAi,
        model: TTS_MODEL_NAME,
        run: (client, model) =>
          client.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: spokenText,
                    speechMetadata: { style: ukStyle },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
      },
      {
        label: 'default-lite-tts-uk',
        client: ai,
        model: TTS_MODEL_NAME,
        run: (client, model) =>
          client.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: spokenText,
                    speechMetadata: { style: ukStyle },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
      },
      {
        label: 'v1alpha-speechConfig-uk',
        client: alphaAi,
        model: TTS_MODEL_NAME,
        run: (client, model) =>
          client.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: spokenText }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
      },
      {
        label: 'v1alpha-flash-tts-uk',
        client: alphaAi,
        model: 'gemini-3.8-flash-tts',
        run: (client, model) =>
          client.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: spokenText,
                    speechMetadata: { style: ukStyle },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
      },
    ];

    let lastSpeakErr: unknown = null;
    const baseOrderedAttempts =
      cachedTtsAttemptLabel && ttsAttempts.some((a) => a.label === cachedTtsAttemptLabel)
        ? [
            ...ttsAttempts.filter((a) => a.label === cachedTtsAttemptLabel),
            ...ttsAttempts.filter((a) => a.label !== cachedTtsAttemptLabel),
          ]
        : ttsAttempts;
    const orderedAttempts = orderByHealth(baseOrderedAttempts);

    for (const attempt of orderedAttempts) {
      try {
        const response = await withTimeout(
          attempt.run(attempt.client, attempt.model),
          11000,
          `${attempt.model}:${attempt.label}`
        );
        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const audioBase64 = inlineData?.data;
        if (audioBase64) {
          modelCooldownUntil.delete(attempt.model);
          cachedTtsAttemptLabel = attempt.label;
          res.json({
            audioBase64,
            mimeType: inlineData?.mimeType || 'audio/wav',
            strategy: attempt.label,
          });
          return;
        }
      } catch (err) {
        lastSpeakErr = err;
        if (isRetryableModelError(err)) {
          markModelCooldown(attempt.model, err);
        }
        const rawErr = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
        const canContinue =
          rawErr.includes('invalid_argument') ||
          rawErr.includes('unknown name') ||
          rawErr.includes('cannot find field') ||
          isRetryableModelError(err);
        if (!canContinue) {
          break;
        }
      }
    }

    const parsed = formatGeminiError(lastSpeakErr);
    res.status(parsed.status).json({ error: parsed.message });
  });

  // Low-latency streaming PCM TTS endpoint (raw 24kHz mono 16-bit LE PCM chunks)
  app.post('/api/ai/speak-stream', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const body = req.body as { text?: string; voiceName?: string } | undefined;
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    const spokenText = sanitizeTextForSpeech(rawText);
    if (!spokenText) {
      res.status(400).json({ error: 'Text content is required.' });
      return;
    }

    // Lock strictly to one single unified UK English voice across every response
    const voiceName = UNIFIED_UK_VOICE;
    const ukStyle = UK_VOICE_STYLE;
    const alphaAi = getAiClient('v1alpha') || ai;

    const streamAttempts: Array<{
      label: string;
      model: string;
      run: () => ReturnType<GoogleGenAI['models']['generateContentStream']>;
    }> = [
      {
        label: 'v1alpha-lite-stream',
        model: TTS_MODEL_NAME,
        run: () =>
          alphaAi.models.generateContentStream({
            model: TTS_MODEL_NAME,
            contents: [
              {
                role: 'user',
                parts: [{ text: spokenText, speechMetadata: { style: ukStyle } }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          }),
      },
      {
        label: 'default-lite-stream-uk',
        model: TTS_MODEL_NAME,
        run: () =>
          ai.models.generateContentStream({
            model: TTS_MODEL_NAME,
            contents: [
              {
                role: 'user',
                parts: [{ text: spokenText, speechMetadata: { style: ukStyle } }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          }),
      },
      {
        label: 'v1alpha-speechConfig-only-stream',
        model: TTS_MODEL_NAME,
        run: () =>
          alphaAi.models.generateContentStream({
            model: TTS_MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: spokenText }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          }),
      },
      {
        label: 'v1alpha-flash-tts-stream',
        model: 'gemini-3.8-flash-tts',
        run: () =>
          alphaAi.models.generateContentStream({
            model: 'gemini-3.8-flash-tts',
            contents: [
              {
                role: 'user',
                parts: [{ text: spokenText, speechMetadata: { style: ukStyle } }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          }),
      },
    ];

    const baseStreamAttempts =
      cachedTtsStreamLabel && streamAttempts.some((a) => a.label === cachedTtsStreamLabel)
        ? [
            ...streamAttempts.filter((a) => a.label === cachedTtsStreamLabel),
            ...streamAttempts.filter((a) => a.label !== cachedTtsStreamLabel),
          ]
        : streamAttempts;
    const orderedStreamAttempts = orderByHealth(baseStreamAttempts);

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableFinished) clientClosed = true;
    });

    let lastErr: unknown = null;
    for (const attempt of orderedStreamAttempts) {
      if (clientClosed) return;
      let wroteAnyBytes = false;
      try {
        const stream = await withTimeout(attempt.run(), 9500, attempt.label);
        for await (const chunk of stream) {
          if (clientClosed) break;
          const inlineData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          const b64 = inlineData?.data;
          if (!b64) continue;
          if (!wroteAnyBytes) {
            modelCooldownUntil.delete(attempt.model);
            cachedTtsStreamLabel = attempt.label;
            res.socket?.setNoDelay(true);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Audio-Sample-Rate', '24000');
            res.setHeader('X-Audio-Strategy', attempt.label);
            res.flushHeaders?.();
          }
          wroteAnyBytes = true;
          res.write(Buffer.from(b64, 'base64'));
        }
        if (wroteAnyBytes) {
          if (!res.writableEnded) res.end();
          return;
        }
      } catch (err) {
        lastErr = err;
        if (isRetryableModelError(err)) {
          markModelCooldown(attempt.model, err);
        }
        if (wroteAnyBytes) {
          if (!res.writableEnded) res.end();
          return;
        }
        const rawErr = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
        const canContinue =
          rawErr.includes('invalid_argument') ||
          rawErr.includes('unknown name') ||
          rawErr.includes('cannot find field') ||
          isRetryableModelError(err);
        if (!canContinue) break;
      }
    }

    if (!res.headersSent) {
      const parsed = formatGeminiError(lastErr);
      res.status(parsed.status).json({ error: parsed.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  const distPath = path.resolve(__dirname, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const isCloudHost = Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT);
  const useProdStatic =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' && isCloudHost && fs.existsSync(distIndex));

  if (!useProdStatic) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      if (fs.existsSync(distIndex)) {
        res.sendFile(distIndex);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  getAiClient();
  getAiClient('v1alpha');

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MSL Journal server listening on http://0.0.0.0:${PORT}`);
    void warmUpstreamGemini();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
