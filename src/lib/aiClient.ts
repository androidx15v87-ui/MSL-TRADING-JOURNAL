import {
  calculateMonthlyPnL,
  calculateStats,
  formatR,
  groupPerformance,
  groupPerformanceByTag,
} from './calculations';
import type {
  AIAppAction,
  AIChatMessage,
  AIConversation,
  AIMemoryItem,
  JournalState,
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
let lastCtxValue = '';

export function buildJournalContext(
  state: JournalState,
  memories?: AIMemoryItem[]
): string {
  if (lastCtxStateRef === state && lastCtxMemoriesRef === memories && lastCtxValue) {
    return lastCtxValue;
  }

  const stats = calculateStats(state.trades);
  const bySetup = groupPerformance(state.trades, 'setup');
  const bySession = groupPerformance(state.trades, 'session');
  const byTag = groupPerformanceByTag(state.trades);
  const monthly = calculateMonthlyPnL(state.trades, 6);

  const recentTrades = [...state.trades]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 18)
    .map((t) => {
      const tagsStr = t.tags && t.tags.length > 0 ? t.tags.join(',') : '';
      return `- ${t.id} | ${t.date} | ${t.pair} ${t.direction} | ${t.setup}/${t.session} | ${t.result} ${formatR(t.r)} (risk ${t.risk}R)${t.model ? ` | model:${t.model}` : ''}${tagsStr ? ` | tags:[${tagsStr}]` : ''}${t.notes ? ` | "${t.notes.slice(0, 120)}"` : ''}`;
    });

  const modelsSummary = state.models.map(
    (m) => `- ${m.name} (${m.type}): Entry="${m.entry || '—'}", Risk="${m.risk || '—'}"`
  );

  const alarmsSummary = state.alarms.map(
    (a) => `- ${a.name}: ${a.time} (${a.enabled ? 'on' : 'off'})`
  );

  const playbookLines = [
    state.playbook.core ? `Core: ${state.playbook.core}` : '',
    state.playbook.rev ? `Reversal: ${state.playbook.rev}` : '',
    state.playbook.cont ? `Continuation: ${state.playbook.cont}` : '',
    state.playbook.entry ? `Entry: ${state.playbook.entry}` : '',
    state.playbook.risk ? `Risk/Targets: ${state.playbook.risk}` : '',
  ].filter(Boolean);

  const memoryLines = (memories || [])
    .slice(0, 40)
    .map((m) => `- [${m.id}] (${m.category}) ${m.content}`);

  const result = [
    memoryLines.length
      ? `Saved User Memories (${memoryLines.length} — persistent across all conversations):\n${memoryLines.join('\n')}`
      : '',
    `Trader: ${state.profile.name || 'Trader'} | Market: ${state.profile.market || 'Unspecified'}`,
    `Total PnL & Stats: Net PnL ${formatR(stats.netR)} | Total Profits +${stats.grossWin.toFixed(2)}R | Total Losses -${stats.grossLoss.toFixed(2)}R | ${stats.totalTrades} trades | WR ${stats.winRate.toFixed(1)}% (${stats.wins.length}W/${stats.losses.length}L/${stats.breakevens.length}BE) | Exp ${formatR(stats.expectancy)} | PF ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} | AvgW ${formatR(stats.avgWinner)} | AvgL ${formatR(stats.avgLoser)} | MaxDD -${stats.maxDrawdownR.toFixed(2)}R | Best Session ${stats.bestSession ? `${stats.bestSession.name} (${formatR(stats.bestSession.netR)})` : 'None'}`,
    `6M Monthly Net R: ${monthly.map((m) => `${m.label}:${formatR(m.netR)}(${m.tradesCount})`).join(' | ')}`,
    bySetup.length
      ? `Setups: ${bySetup.map((s) => `${s.label}:${formatR(s.netR)}(${s.count},${Math.round(s.winRate)}%)`).join(' | ')}`
      : '',
    bySession.length
      ? `Sessions: ${bySession.map((s) => `${s.label}:${formatR(s.netR)}(${s.count},${Math.round(s.winRate)}%)`).join(' | ')}`
      : '',
    byTag.length
      ? `Tags: ${byTag.map((tg) => `#${tg.label}:${formatR(tg.netR)}(${tg.count},${Math.round(tg.winRate)}%)`).join(' | ')}`
      : '',
    modelsSummary.length ? `Models:\n${modelsSummary.join('\n')}` : '',
    alarmsSummary.length ? `Alarms: ${alarmsSummary.join(' | ')}` : '',
    playbookLines.length ? `Playbook:\n${playbookLines.join('\n')}` : '',
    recentTrades.length ? `Recent Trades (${recentTrades.length}):\n${recentTrades.join('\n')}` : 'Recent Trades: None',
  ]
    .filter(Boolean)
    .join('\n');

  lastCtxStateRef = state;
  lastCtxMemoriesRef = memories;
  lastCtxValue = result;
  return result;
}

let prewarmed = false;
export function prewarmAIConnection(): void {
  if (prewarmed || typeof window === 'undefined') return;
  prewarmed = true;
  void fetch('/api/health', { method: 'GET', keepalive: true }).catch(() => {
    prewarmed = false;
  });
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function isTransientStreamError(err: unknown, statusCode?: number): boolean {
  if (statusCode && (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504)) {
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
  voiceTurn?: boolean;
  speakSync?: boolean;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onDelta: (chunk: string) => void;
  onSyncClauseMeta?: (meta: SyncClauseMeta) => void;
  onSyncAudioPcm?: (chunk: { clauseId: number; base64Pcm: string }) => void;
  onSyncClauseEnd?: (info: { clauseId: number; textOnly?: boolean }) => void;
  onActions?: (actions: AIAppAction[]) => void;
}): Promise<string> {
  const mode = options.mode || 'fast';
  const voiceTurn = Boolean(options.voiceTurn);
  const speakSync = Boolean(options.speakSync);
  const maxClientMsgs = voiceTurn ? 10 : 16;
  const sourceMessages =
    mode === 'fast' && options.messages.length > maxClientMsgs
      ? [options.messages[0], ...options.messages.slice(-(maxClientMsgs - 1))]
      : options.messages;

  const formattedMessages = sourceMessages.map((m) => ({
    role: m.role,
    text: m.text,
    images: (m.attachments || [])
      .map((att) => splitDataUrl(att.dataUrl))
      .filter((x): x is { mimeType: string; data: string } => x !== null),
  }));

  const payloadBody = JSON.stringify({
    messages: formattedMessages,
    journalContext: options.journalContext,
    mode,
    voiceTurn,
    speakSync,
  });

  const maxAttempts = 2;

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
        if (attempt === 0 && !options.signal?.aborted && isTransientStreamError(null, response.status)) {
          options.onStatus?.('Reconnecting to stream…');
          await new Promise((r) => window.setTimeout(r, 320));
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
            status?: string;
            text?: string;
            clauseId?: number;
            rawText?: string;
            spokenText?: string;
            data?: string;
            textOnly?: boolean;
            error?: string;
            actions?: AIAppAction[];
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
          } else if (event.type === 'done') {
            sawDone = true;
          } else if (event.type === 'error') {
            throw new Error(event.error || 'AI generation failed.');
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
          options.onStatus?.('Retrying stream connection…');
          await new Promise((r) => window.setTimeout(r, 300));
          continue;
        }
        throw new Error('MSL AI returned an empty response. Tap Retry to try again.');
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

      if (attempt === 0 && isTransientStreamError(err)) {
        options.onStatus?.('Network hiccup — reconnecting…');
        await new Promise((r) => window.setTimeout(r, 380));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Unable to reach MSL AI. Please check your connection and tap Retry.');
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
