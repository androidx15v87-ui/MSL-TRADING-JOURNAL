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
  JournalState,
} from '../types/journal';

const AI_CONVERSATIONS_KEY = 'msl_v10_ai_conversations';
const AI_VOICE_ENABLED_KEY = 'msl_ai_voice_enabled';
const DEFAULT_UK_VOICE = 'Zephyr';

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
      return `- id:${t.id} | ${t.date} | ${t.pair} | ${t.direction} | ${t.setup} | ${t.session} | ${t.result} (${formatR(t.r)}, risk ${t.risk}R) | model: ${t.model || 'none'}${tagsStr ? ` | tags: [${tagsStr}]` : ''}${customParts ? ` | props: [${customParts}]` : ''}${t.notes ? ` | notes: "${t.notes.slice(0, 180)}"` : ''}`;
    });

  const modelsSummary = state.models.map(
    (m) => `- ${m.name} (${m.type}): Entry="${m.entry || '—'}", Risk/Targets="${m.risk || '—'}"`
  );

  const alarmsSummary = state.alarms.map(
    (a) => `- ${a.name}: ${a.time} (${a.enabled ? 'enabled' : 'disabled'})`
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
    alarmsSummary.length ? `Session Alarms:\n${alarmsSummary.join('\n')}` : '',
    playbookLines.length ? `Playbook:\n${playbookLines.join('\n')}` : 'Playbook: Empty',
    recentTrades.length ? `Recent Trades (newest first, up to 25):\n${recentTrades.join('\n')}` : 'Recent Trades: None logged yet',
  ]
    .filter(Boolean)
    .join('\n\n');
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

export async function streamAIChat(options: {
  messages: AIChatMessage[];
  journalContext?: string;
  mode?: 'fast' | 'deep';
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onDelta: (chunk: string) => void;
  onActions?: (actions: AIAppAction[]) => void;
}): Promise<string> {
  const formattedMessages = options.messages.map((m) => ({
    role: m.role,
    text: m.text,
    images: (m.attachments || [])
      .map((att) => splitDataUrl(att.dataUrl))
      .filter((x): x is { mimeType: string; data: string } => x !== null),
  }));

  const payloadBody = JSON.stringify({
    messages: formattedMessages,
    journalContext: options.journalContext,
    mode: options.mode || 'fast',
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
          await new Promise((r) => window.setTimeout(r, 350));
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
 * Extracts speakable clauses immediately as SSE text streams in, so speech begins
 * within the first ~5–12 words without waiting for the entire paragraph.
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
    const minSentenceLen = first ? 16 : 36;
    const minPauseLen = first ? 34 : 95;
    const maxClauseLen = first ? 62 : 165;

    let splitAt = -1;

    // 1. Prefer crisp sentence endings (. ! ? or newline)
    const sentenceMatch = work.match(/[.!?](?:\s|$)|\n+/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      const endPos = sentenceMatch.index + sentenceMatch[0].length;
      if (endPos >= minSentenceLen) {
        splitAt = endPos;
      }
    }

    // 2. For fast first-word speaking or long sentences, split cleanly on clause punctuation
    if (splitAt === -1) {
      const pauseMatch = work.match(/[,;:]\s|—\s?/);
      if (pauseMatch && pauseMatch.index !== undefined) {
        const endPos = pauseMatch.index + pauseMatch[0].length;
        if (endPos >= minPauseLen) {
          splitAt = endPos;
        }
      }
    }

    // 3. Hard ceiling at word boundary so audio never waits on an ultra-long run-on line
    if (splitAt === -1 && work.length >= maxClauseLen) {
      const spaceIdx = work.lastIndexOf(' ', maxClauseLen);
      splitAt = spaceIdx >= 14 ? spaceIdx + 1 : maxClauseLen;
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

function pickBestUkBrowserVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const ukVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en-gb'));
  const preferredOrder = [
    /google uk english/i,
    /libby|sonia|ryan|oliver|george|arthur|serena|daniel|kate/i,
    /natural|neural|premium/i,
  ];
  for (const regex of preferredOrder) {
    const match = ukVoices.find((v) => regex.test(v.name));
    if (match) return match;
  }
  return ukVoices[0] || voices.find((v) => v.lang.toLowerCase().startsWith('en')) || null;
}

/**
 * Low-latency Web Audio streaming player that fetches /api/ai/speak-stream
 * in parallel for queued clauses and schedules 24kHz raw PCM chunks gaplessly.
 */
export class StreamingVoiceEngine {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private abortController: AbortController | null = null;
  private playChain: Promise<void> = Promise.resolve();
  private sessionToken = 0;
  private pendingTasks = 0;
  private onStateChange?: (state: { loading: boolean; speaking: boolean }) => void;

  constructor(onStateChange?: (state: { loading: boolean; speaking: boolean }) => void) {
    this.onStateChange = onStateChange;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const buf = ctx.createBuffer(1, 1, 24000);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // Ignore silent unlock error
    }
  }

  beginSession(): number {
    this.stop();
    this.sessionToken += 1;
    this.abortController = new AbortController();
    this.unlock();
    return this.sessionToken;
  }

  stop(): void {
    this.sessionToken += 1;
    this.pendingTasks = 0;
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
  }

  dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private emitState(loading: boolean, speaking: boolean): void {
    this.onStateChange?.({ loading, speaking });
  }

  private schedulePcmBytes(bytes: Uint8Array, session: number): void {
    if (session !== this.sessionToken || bytes.byteLength < 2) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (sampleCount <= 0) return;

    const float32 = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.012, this.nextStartTime);
    this.nextStartTime = startAt + audioBuffer.duration;
    this.activeSources.add(src);
    this.emitState(false, true);

    src.onended = () => {
      this.activeSources.delete(src);
      if (session === this.sessionToken && this.activeSources.size === 0 && this.pendingTasks === 0) {
        this.emitState(false, false);
      }
    };

    src.start(startAt);
  }

  private speakFallbackUk(text: string, session: number): Promise<void> {
    return new Promise((resolve) => {
      if (session !== this.sessionToken || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      try {
        const utt = new SpeechSynthesisUtterance(text);
        const ukVoice = pickBestUkBrowserVoice();
        if (ukVoice) utt.voice = ukVoice;
        utt.lang = 'en-GB';
        utt.rate = 1.01;
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

    // Start network stream fetch immediately in parallel, while keeping playback strictly ordered
    const responsePromise = fetch('/api/ai/speak-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ text, voiceName: DEFAULT_UK_VOICE }),
    });

    this.playChain = this.playChain.then(async () => {
      if (session !== this.sessionToken || signal?.aborted) return;

      try {
        const res = await responsePromise;
        if (session !== this.sessionToken || signal?.aborted) return;

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
            return;
          }
          if (!value || value.byteLength === 0) continue;

          let chunk = value;
          // Defensive strip if an upstream chunk ever carries a 44-byte RIFF WAV header
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
            this.schedulePcmBytes(merged, session);
          }
        }
      } catch (err) {
        if (session !== this.sessionToken || signal?.aborted || (err as Error)?.name === 'AbortError') {
          return;
        }
        await this.speakFallbackUk(text, session);
      } finally {
        if (session === this.sessionToken) {
          this.pendingTasks = Math.max(0, this.pendingTasks - 1);
          if (this.pendingTasks === 0 && this.activeSources.size === 0) {
            this.emitState(false, false);
          }
        }
      }
    });
  }
}
