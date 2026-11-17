import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = '10.2.1';
const FAST_MODEL_NAME = 'gemini-3.1-flash-lite';
const HYDROGEN_MODEL_NAME = 'gemini-4-hydrogen';
const TTS_MODEL_NAME = 'gemini-3.8-flash-lite-tts';
let cachedTtsAttemptLabel: string | null = null;

interface IncomingMessage {
  role: 'user' | 'model';
  text: string;
  images?: { mimeType: string; data: string }[];
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  journalContext?: string;
  mode?: 'fast' | 'deep';
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
];

function createAiClient(apiVersion?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSystemInstruction(journalContext?: string): string {
  return [
    `You are MSL AI — an elite, ultra-responsive AI intelligence embedded inside MSL Trading Journal Version ${APP_VERSION}.`,
    'You combine the deep multi-modal reasoning of Gemini with crisp, structured, executive-grade analytical clarity: institutional trading coach, quantitative risk & expectancy analyst, chart reader, and direct app operator.',
    '',
    'Core Intelligence & Response Style:',
    '- Be direct, high-signal, and immediately actionable. Lead with the answer, insight, or executed result first—no filler preamble.',
    '- Use crisp Markdown (short bold headers, tight bullet points, Markdown tables when comparing setups/sessions/R-multiples, exact numbers and percentages).',
    '- Ground all journal metrics, trade IDs, dates, setups, and notes strictly in the Live Journal Snapshot below. Never fabricate trades or statistics.',
    '- When chart screenshots are attached, perform a structured visual breakdown: (1) Market Structure & Bias, (2) Liquidity / POI / Displacement, (3) Entry & Invalidation Placement, (4) Risk-to-Reward & Execution Verdict.',
    '- You also handle broader analytical math, psychology coaching, position sizing, scenario planning, and strategy refinement with high rigor.',
    '',
    'App Control Capabilities (Function Tools):',
    '- You have direct control over MSL Trading Journal via function calls (`navigate_app`, `open_log_trade_modal`, `log_trade`, `update_trade`, `delete_trade`, `create_trading_model`, `update_playbook`, `update_session_alarm`, `cycle_motivational_quote`).',
    '- ONLY call tools when the user clearly intends for you to perform an action in the app (e.g., "log a 2.5R win on EURUSD", "open analytics", "save this as a model", "set London alarm to 07:45", "update my playbook entry rules", "delete that last trade").',
    '- Never call mutation tools for purely analytical questions like "how did I do on EURUSD?" or "review this chart".',
    '- After calling any tool, keep confirmation crisp (1-3 tight sentences): state what changed and add 1 high-value observation only when relevant.',
    '',
    journalContext
      ? `--- LIVE JOURNAL SNAPSHOT ---\n${journalContext}\n--- END SNAPSHOT ---`
      : 'No live journal snapshot was attached to this request.',
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
        default:
          return `Executed ${c.name}`;
      }
    })
    .join('; ');
  return `Done — ${summary}.`;
}

function sanitizeTextForSpeech(markdown: string): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, ' Code snippet omitted. ')
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

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: APP_VERSION,
      fastModel: FAST_MODEL_NAME,
      deepModel: HYDROGEN_MODEL_NAME,
      ttsModel: TTS_MODEL_NAME,
    });
  });

  app.post('/api/ai/chat', async (req, res) => {
    const ai = createAiClient();
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
    const systemInstruction = buildSystemInstruction(body?.journalContext);

    const contents: Content[] = messages.map((msg) => {
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

    sendEvent({
      type: 'status',
      status: isDeep ? 'Analyzing edge & journal context…' : 'Connecting to stream…',
    });

    const candidatesToTry: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = isDeep
      ? [
          { model: FAST_MODEL_NAME, level: ThinkingLevel.HIGH, timeoutMs: 12000 },
          { model: HYDROGEN_MODEL_NAME, level: ThinkingLevel.MEDIUM, timeoutMs: 12000 },
        ]
      : [
          { model: FAST_MODEL_NAME, level: ThinkingLevel.MINIMAL, timeoutMs: 9000 },
          { model: HYDROGEN_MODEL_NAME, level: ThinkingLevel.LOW, timeoutMs: 11000 },
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
              sendEvent({ type: 'delta', text });
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
            sendEvent({ type: 'delta', text: summarizeActionFallback(collectedCalls) });
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
                  sendEvent({ type: 'delta', text });
                }
              }

              if (!turn2Text.trim() && !res.writableEnded && !clientClosed) {
                sendEvent({ type: 'delta', text: summarizeActionFallback(collectedCalls) });
              }
            } catch {
              if (!res.writableEnded && !clientClosed) {
                sendEvent({ type: 'delta', text: summarizeActionFallback(collectedCalls) });
              }
            }
          }
        }
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
    const ai = createAiClient();
    if (!ai) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      });
      return;
    }

    const body = req.body as { audioBase64?: string; mimeType?: string } | undefined;
    const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64.trim() : '';
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType.trim()
      ? body.mimeType.trim().split(';')[0]
      : 'audio/webm';

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
                  text: 'Transcribe this spoken trading journal entry accurately into plain text. Return only the spoken words without extra commentary.',
                },
              ],
            },
          }),
          10000,
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
    const ai = createAiClient();
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

    const allowedVoices = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
    const voiceName =
      typeof body?.voiceName === 'string' && allowedVoices.has(body.voiceName)
        ? body.voiceName
        : 'Zephyr';

    const ukStyle =
      'Refined, natural British UK English accent (modern London / Received Pronunciation), warm, clear, calm and articulate trading coach';

    const ttsAttempts: Array<{
      label: string;
      client: GoogleGenAI;
      model: string;
      run: (client: GoogleGenAI, model: string) => ReturnType<GoogleGenAI['models']['generateContent']>;
    }> = [
      {
        label: 'v1alpha-lite-tts-uk',
        client: createAiClient('v1alpha') || ai,
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
        label: 'default-full-uk',
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
        label: 'default-speechConfig-only',
        client: ai,
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
        label: 'default-audio-modality-only',
        client: ai,
        model: TTS_MODEL_NAME,
        run: (client, model) =>
          client.models.generateContent({
            model,
            contents: spokenText,
            config: {
              responseModalities: ['AUDIO'],
            },
          }),
      },
      {
        label: 'v1alpha-flash-tts-uk',
        client: createAiClient('v1alpha') || ai,
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
          10000,
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
    const ai = createAiClient();
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

    const allowedVoices = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
    const voiceName =
      typeof body?.voiceName === 'string' && allowedVoices.has(body.voiceName)
        ? body.voiceName
        : 'Zephyr';

    const ukStyle =
      'Refined, natural British UK English accent (modern London / Received Pronunciation), warm, clear, calm and articulate trading coach';

    const streamAttempts: Array<{
      label: string;
      run: () => ReturnType<GoogleGenAI['models']['generateContentStream']>;
    }> = [
      {
        label: 'v1alpha-lite-stream',
        run: () =>
          (createAiClient('v1alpha') || ai).models.generateContentStream({
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
        label: 'default-lite-stream-audio-only',
        run: () =>
          ai.models.generateContentStream({
            model: TTS_MODEL_NAME,
            contents: spokenText,
            config: {
              responseModalities: ['AUDIO'],
            },
          }),
      },
      {
        label: 'default-flash-stream-audio-only',
        run: () =>
          ai.models.generateContentStream({
            model: 'gemini-3.8-flash-tts',
            contents: spokenText,
            config: {
              responseModalities: ['AUDIO'],
            },
          }),
      },
    ];

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableFinished) clientClosed = true;
    });

    let lastErr: unknown = null;
    for (const attempt of streamAttempts) {
      if (clientClosed) return;
      let wroteAnyBytes = false;
      try {
        const stream = await withTimeout(attempt.run(), 8000, attempt.label);
        for await (const chunk of stream) {
          if (clientClosed) break;
          const inlineData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          const b64 = inlineData?.data;
          if (!b64) continue;
          if (!wroteAnyBytes) {
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MSL Journal server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
