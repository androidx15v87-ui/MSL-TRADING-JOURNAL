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
const APP_VERSION = '10.5.4';
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
  voiceTurn?: boolean;
  speakSync?: boolean;
}

const APP_CONTROL_TOOLS: FunctionDeclaration[] = [
  {
    name: 'navigate_app',
    description:
      'Navigate the user to a specific screen in MSL Trading Journal (dashboard, journal, calendar, models, analytics, playbook, ai, settings).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        page: {
          type: Type.STRING,
          description:
            'Target screen ID: dashboard, journal, calendar, models, analytics, playbook, ai, or settings.',
        },
      },
      required: ['page'],
    },
  },
  {
    name: 'open_log_trade_modal',
    description:
      'Open the Log Trade modal so the user can fill in or attach screenshots to a trade entry.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        initialDate: {
          type: Type.STRING,
          description: 'Optional YYYY-MM-DD date to pre-fill in the trade modal.',
        },
      },
    },
  },
  {
    name: 'log_trade',
    description:
      'Log and immediately save a new trade into the journal (both local IndexedDB and Cloud Firestore when signed in). Use whenever the user asks to log, record, or add a trade.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pair: {
          type: Type.STRING,
          description: 'Trading symbol/pair such as EURUSD, XAUUSD, NQ, ES, BTCUSD.',
        },
        direction: {
          type: Type.STRING,
          description: 'Long or Short.',
        },
        setup: {
          type: Type.STRING,
          description: 'Setup category: Reversal, Continuation, Breakout, or Other.',
        },
        session: {
          type: Type.STRING,
          description: 'Trading session: London, New York, Asia, Overlap, or Other.',
        },
        result: {
          type: Type.STRING,
          description: 'Outcome: Win, Loss, or BE.',
        },
        r: {
          type: Type.NUMBER,
          description: 'Net R-multiple realized (e.g. 2.5 for Win, -1 for Loss, 0 for BE).',
        },
        risk: {
          type: Type.NUMBER,
          description: 'Planned risk in R units (defaults to 1).',
        },
        model: {
          type: Type.STRING,
          description: 'Optional setup/model name.',
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Optional execution tags such as Patient, A+ Setup, FOMO.',
        },
        notes: {
          type: Type.STRING,
          description: 'Optional execution notes or commentary.',
        },
        date: {
          type: Type.STRING,
          description: 'Optional local ISO datetime YYYY-MM-DDTHH:mm.',
        },
      },
      required: ['pair', 'direction', 'result', 'r'],
    },
  },
  {
    name: 'update_trade',
    description:
      'Update fields on an existing trade identified by its tradeId from the Live Journal Snapshot.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tradeId: {
          type: Type.STRING,
          description: 'Exact trade id from the Live Journal Snapshot.',
        },
        pair: { type: Type.STRING },
        direction: { type: Type.STRING },
        setup: { type: Type.STRING },
        session: { type: Type.STRING },
        result: { type: Type.STRING },
        r: { type: Type.NUMBER },
        risk: { type: Type.NUMBER },
        model: { type: Type.STRING },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        notes: { type: Type.STRING },
      },
      required: ['tradeId'],
    },
  },
  {
    name: 'delete_trade',
    description:
      'Delete an existing trade from the journal by its tradeId when explicitly requested by the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tradeId: {
          type: Type.STRING,
          description: 'Exact trade id from the Live Journal Snapshot.',
        },
      },
      required: ['tradeId'],
    },
  },
  {
    name: 'create_trading_model',
    description: 'Create and save a new trading model/setup template in the Models library.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Model name, e.g. London Sweep Reversal.' },
        type: { type: Type.STRING, description: 'Reversal, Continuation, or Both.' },
        entry: { type: Type.STRING, description: 'Entry confirmation criteria.' },
        risk: { type: Type.STRING, description: 'Invalidation and target management rules.' },
      },
      required: ['name', 'type', 'entry', 'risk'],
    },
  },
  {
    name: 'update_playbook',
    description:
      'Update one or more sections of the user’s trading Playbook (core, rev, cont, entry, risk).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        core: { type: Type.STRING, description: 'Core model philosophy / edge.' },
        rev: { type: Type.STRING, description: 'Reversal rules.' },
        cont: { type: Type.STRING, description: 'Continuation rules.' },
        entry: { type: Type.STRING, description: 'Entry filters & timing triggers.' },
        risk: { type: Type.STRING, description: 'Invalidation, scaling & targets.' },
      },
    },
  },
  {
    name: 'update_session_alarm',
    description:
      'Create or update a session alarm in Settings (e.g., London Open, New York Open, Asia Open, or custom session alarm).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Alarm name, e.g. London Open.' },
        time: { type: Type.STRING, description: '24h time in HH:mm format, e.g. 08:00.' },
        enabled: { type: Type.BOOLEAN, description: 'Whether the alarm is active.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'cycle_motivational_quote',
    description: 'Refresh or cycle the trading discipline quote shown on the dashboard.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'save_memory',
    description:
      'Save a durable long-term memory about the user across all future conversations (preferences, personal rules, risk limits, goals, communication style, or personal facts). Use automatically when the user asks you to remember something or shares an important lasting preference/rule/goal.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description:
            'Concise, clear statement of the fact, preference, rule, or goal to remember permanently (max 600 chars).',
        },
        category: {
          type: Type.STRING,
          description: 'Category: preference, rule, goal, or context.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'forget_memory',
    description:
      'Delete an existing saved memory by its memoryId from Saved User Memories or by a matching phrase/keyword query when the user asks you to forget or remove it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memoryId: {
          type: Type.STRING,
          description: 'Exact memory id from Saved User Memories when available.',
        },
        query: {
          type: Type.STRING,
          description: 'Keyword or phrase matching the memory to remove if id is unknown.',
        },
      },
    },
  },
];

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

function buildSystemInstruction(journalContext?: string, voiceTurn = false): string {
  return [
    `You are MSL AI (Version ${APP_VERSION}) — a sharp, high-velocity, first-principles intelligence combining broad polymath mastery (macroeconomics, markets, probability, game theory, coding, science, technology, strategy, philosophy, behavioral psychology, and general world knowledge) with institutional trading coaching and direct app control.`,
    '',
    'Communication & Reasoning Standard:',
    '- Lead immediately with the sharpest, truest, most useful answer. Zero robotic disclaimers, zero fluff, zero throat-clearing.',
    '- Think from first principles with Grok-style witless clarity, precision, and intellectual honesty: cut straight to the signal, quantify trade-offs, and surface non-obvious second-order insights.',
    voiceTurn
      ? '- LIVE VOICE CONVERSATION MODE: Respond directly like an ultra-sharp UK English live voice partner in 1 to 3 concise spoken sentences (aim for 20-55 words unless the user asks for an extended explanation). Speak in natural conversational prose with zero Markdown tables, headers, code blocks, or bullet lists so audio starts and finishes rapidly.'
      : '- When formatting answers, use clean Markdown (tight bold section labels, scannable bullets, compact Markdown tables for numbers/comparisons). Keep voice-friendly flow natural and easy to hear.',
    '- Ground every trade ID, metric, Total PnL (Total Profits, Total Losses, Net PnL), win rate, setup, session, tag, and note strictly in the Live Journal Snapshot below—never invent trades or numbers.',
    '- On chart screenshots, deliver a clinical 4-part read: (1) Structure & Directional Bias, (2) Liquidity / POI / Displacement, (3) Entry & Invalidation Placement, (4) R:R & Execution Verdict.',
    '',
    'Persistent Memory & App Control Tools:',
    '- Tools: `save_memory`, `forget_memory`, `navigate_app`, `open_log_trade_modal`, `log_trade`, `update_trade`, `delete_trade`, `create_trading_model`, `update_playbook`, `update_session_alarm`, `cycle_motivational_quote`.',
    '- Cross-Conversation Memory: Respect every item in `Saved User Memories` above as enduring truth across all chats and live voice turns. Whenever the user says "remember...", shares lasting personal context, states a strict trading rule/risk limit, or reveals an ongoing goal/preference, call `save_memory` proactively (only for durable facts—never transient one-off questions). When asked to forget or correct a memory, call `forget_memory` (and `save_memory` if replacing it).',
    '- Call journal/navigation tools ONLY when the user explicitly requests an app action. Confirm executed actions crisply in 1-2 sentences.',
    '',
    journalContext
      ? `--- LIVE JOURNAL SNAPSHOT & MEMORIES ---\n${journalContext}\n--- END SNAPSHOT ---`
      : 'No live journal snapshot attached.',
  ].join('\n');
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
      message: 'Rate limit or quota reached. Please wait a moment and try again.',
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
      message: 'MSL AI is experiencing temporary server demand. Please tap send again.',
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

function summarizeActionFallback(calls: FunctionCall[]): string {
  const summary = calls
    .map((c) => {
      const args = (c.args || {}) as Record<string, unknown>;
      switch (c.name) {
        case 'log_trade':
          return `Logged **${String(args.pair || 'Trade').toUpperCase()}** ${String(args.direction || '')} (${String(args.result || '')} ${args.r ?? 0}R)`;
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

  app.get('/api/health', (_req, res) => {
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
    const isVoiceTurn = Boolean(body?.voiceTurn);
    const speakSync = Boolean(body?.speakSync);
    const systemInstruction = buildSystemInstruction(body?.journalContext, isVoiceTurn);
    const maxHistory = isVoiceTurn ? 10 : 14;
    const windowedMessages =
      !isDeep && messages.length > maxHistory
        ? [messages[0], ...messages.slice(-(maxHistory - 1))]
        : messages;

    const contents: Content[] = windowedMessages.map((msg) => {
      const parts: Part[] = [];

      if (Array.isArray(msg.images)) {
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
        parts.push({ text: msg.text });
      } else if (parts.length === 0) {
        parts.push({ text: ' ' });
      }

      return {
        role: msg.role === 'model' ? 'model' : 'user',
        parts,
      };
    });

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

    const candidatesToTry: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = isDeep
      ? [
          { model: FAST_MODEL_NAME, level: ThinkingLevel.HIGH, timeoutMs: 12000 },
          { model: HYDROGEN_MODEL_NAME, level: ThinkingLevel.MEDIUM, timeoutMs: 12000 },
        ]
      : [
          {
            model: FAST_MODEL_NAME,
            level: ThinkingLevel.MINIMAL,
            timeoutMs: isVoiceTurn ? 4600 : 7500,
          },
          { model: HYDROGEN_MODEL_NAME, level: ThinkingLevel.LOW, timeoutMs: 9500 },
        ];

    try {
      let activeModel = candidatesToTry[0].model;
      let streamedText = '';
      const collectedCalls: FunctionCall[] = [];
      const modelTurnParts: Part[] = [];
      let succeeded = false;
      let lastErr: unknown = null;

      for (const candidate of candidatesToTry) {
        if (res.writableEnded || clientClosed) break;

        let candidateStreamed = '';
        const candidateCalls: FunctionCall[] = [];
        const candidateParts: Part[] = [];

        try {
          const stream1 = await withTimeout(
            ai.models.generateContentStream({
              model: candidate.model,
              contents,
              config: {
                systemInstruction,
                thinkingConfig: {
                  thinkingLevel: candidate.level,
                },
                tools: [{ functionDeclarations: APP_CONTROL_TOOLS }],
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
              candidateStreamed || candidateCalls.length > 0 ? 15000 : candidate.timeoutMs,
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

            const parts = chunk.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                candidateParts.push(part);
              }
            }

            if (Array.isArray(chunk.functionCalls) && chunk.functionCalls.length > 0) {
              for (const fc of chunk.functionCalls) {
                if (fc?.name) {
                  candidateCalls.push(fc);
                }
              }
            }
          }

          collectedCalls.push(...candidateCalls);
          modelTurnParts.push(...candidateParts);
          activeModel = candidate.model;
          succeeded = true;
          break;
        } catch (err) {
          lastErr = err;
          if (!candidateStreamed && candidateCalls.length === 0 && isRetryableModelError(err)) {
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

      if (!succeeded && lastErr) {
        throw lastErr;
      }

      if (collectedCalls.length > 0 && !res.writableEnded && !clientClosed) {
        sendEvent({
          type: 'actions',
          actions: collectedCalls.map((fc) => ({
            name: fc.name,
            args: fc.args || {},
          })),
        });

        if (!streamedText.trim()) {
          const uiOnlyActions = new Set([
            'navigate_app',
            'open_log_trade_modal',
            'cycle_motivational_quote',
          ]);
          const lastUserText = (messages[messages.length - 1]?.text || '').trim().toLowerCase();
          const hasAnalyticalAsk =
            lastUserText.includes('?') ||
            /\b(and|also|explain|why|how|suggest|analyze|audit|review|compare|improve|help)\b/.test(
              lastUserText
            );
          const isPureQuickUiCommand =
            collectedCalls.every((fc) => uiOnlyActions.has(fc.name || '')) &&
            lastUserText.length <= 70 &&
            !hasAnalyticalAsk;

          if (isPureQuickUiCommand) {
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
                ...contents,
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
                    systemInstruction,
                    maxOutputTokens: 420,
                    thinkingConfig: {
                      thinkingLevel: turn2Level,
                    },
                  },
                }),
                6000,
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

    const transcribeModels = ['gemini-3.5-transcribe', FAST_MODEL_NAME];
    let lastTranscribeErr: unknown = null;

    for (const modelName of transcribeModels) {
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
                  text: 'Transcribe the spoken words verbatim in plain text.',
                },
              ],
            },
            config:
              modelName === FAST_MODEL_NAME
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
                : undefined,
          }),
          3600,
          modelName
        );
        res.json({ text: (response.text || '').trim() });
        return;
      } catch (err) {
        lastTranscribeErr = err;
        if (!isRetryableModelError(err)) {
          break;
        }
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
    const orderedAttempts =
      cachedTtsAttemptLabel && ttsAttempts.some((a) => a.label === cachedTtsAttemptLabel)
        ? [
            ...ttsAttempts.filter((a) => a.label === cachedTtsAttemptLabel),
            ...ttsAttempts.filter((a) => a.label !== cachedTtsAttemptLabel),
          ]
        : ttsAttempts;

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

    const orderedStreamAttempts =
      cachedTtsStreamLabel && streamAttempts.some((a) => a.label === cachedTtsStreamLabel)
        ? [
            ...streamAttempts.filter((a) => a.label === cachedTtsStreamLabel),
            ...streamAttempts.filter((a) => a.label !== cachedTtsStreamLabel),
          ]
        : streamAttempts;

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
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
