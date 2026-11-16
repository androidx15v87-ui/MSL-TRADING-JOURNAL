import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';

interface IncomingMessage {
  role: 'user' | 'model';
  text: string;
  images?: { mimeType: string; data: string }[];
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  journalContext?: string;
}

function createAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSystemInstruction(journalContext?: string): string {
  return [
    'You are MSL AI, a sharp, thoughtful, and highly intelligent conversational trading assistant embedded inside MSL Trading Journal V10 Premium.',
    'You combine the clarity and depth of an institutional trading coach, quantitative performance analyst, and versatile AI assistant (capable of deep journal audits, risk math, market structure reasoning, trading psychology, and general productivity or analytical help).',
    '',
    'Guidelines:',
    '- Be concise, structured, and genuinely helpful. Use clean Markdown (headings, bullet lists, bold key metrics, tables when comparing setups or sessions).',
    '- When the user asks about their performance, trades, models, or playbook, ground your analysis strictly in the Live Journal Snapshot provided below. Never invent or hallucinate trades, numbers, or dates that are not in their data.',
    '- If the user has few or zero trades logged yet, acknowledge it honestly and offer practical ways to structure their first entries, models, or playbook.',
    '- When reviewing chart screenshots attached by the user, evaluate structure, liquidity sweeps, displacement, market structure shifts, invalidation placement, and risk-to-reward objectively.',
    '- Respect risk management and discipline above hype. Never give financial advice or guaranteed market predictions; focus on process, probabilities, expectancy, and execution quality.',
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

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, model: MODEL_NAME });
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

    const contents = messages.map((msg) => {
      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];

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
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const stream = await ai.models.generateContentStream({
        model: MODEL_NAME,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(body?.journalContext),
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });

      for await (const chunk of stream) {
        if (res.writableEnded) break;
        const text = chunk.text;
        if (text) {
          sendEvent({ type: 'delta', text });
        }
      }

      if (!res.writableEnded) {
        sendEvent({ type: 'done' });
        res.end();
      }
    } catch (err) {
      const parsed = formatGeminiError(err);
      if (!res.writableEnded) {
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

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
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
      });
      res.json({ text: (response.text || '').trim() });
    } catch (err) {
      const parsed = formatGeminiError(err);
      res.status(parsed.status).json({ error: parsed.message });
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
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MSL Journal server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
