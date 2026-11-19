import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceDictationStatus = 'idle' | 'connecting' | 'listening' | 'processing';

interface UseVoiceDictationOptions {
  onFinalText: (field: string, text: string) => void;
  onError?: (message: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
}

interface SpeechRecognitionResultLike {
  isFinal?: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results?: {
    length: number;
    [index: number]: SpeechRecognitionResultLike | undefined;
  };
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const TARGET_SAMPLE_RATE = 16000;
const BAND_COUNT = 16;
const EMPTY_BANDS: number[] = Array.from({ length: BAND_COUNT }, () => 0.08);
const MAX_PENDING_PCM_FRAMES = 48; // ~4.8s pre-connect ring buffer at ~100ms chunks
const MAX_WAV_SAMPLES = TARGET_SAMPLE_RATE * 90; // Cap direct WAV buffer at 90s (~2.8MB)

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function isEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function downsampleTo16kInt16(input: Float32Array, sourceRate: number): Int16Array {
  if (!input.length) return new Int16Array(0);
  if (sourceRate <= TARGET_SAMPLE_RATE) {
    const direct = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      direct[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return direct;
  }

  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Int16Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accum += input[i];
      count += 1;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function mergeInt16Chunks(chunks: Int16Array[]): Int16Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeWavBlobFromInt16(samples: Int16Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const byteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, byteLength, true);

  const bytes = new Uint8Array(buffer);
  const pcmBytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  bytes.set(pcmBytes, 44);

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Audio read failed'));
    reader.readAsDataURL(blob);
  });
}

function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function computeNormalizedRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.min(1, Math.max(0, rms * 5.2));
}

export function useVoiceDictation({ onFinalText, onError }: UseVoiceDictationOptions) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceDictationStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioBands, setAudioBands] = useState<number[]>(EMPTY_BANDS);

  const onFinalTextRef = useRef(onFinalText);
  const onErrorRef = useRef(onError);
  onFinalTextRef.current = onFinalText;
  onErrorRef.current = onError;

  const activeFieldRef = useRef<string | null>(null);
  const sessionTokenRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);

  const chunksRef = useRef<Blob[]>([]);
  const pcmArchiveRef = useRef<Int16Array[]>([]);
  const pcmSampleTotalRef = useRef(0);
  const pendingPcmQueueRef = useRef<string[]>([]);
  const interimTextRef = useRef('');
  const srFinalizedTextRef = useRef('');
  const wsFinalTextRef = useRef('');
  const srHasResultRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const usingLiveWsRef = useRef(false);

  const updateInterim = useCallback((value: string) => {
    interimTextRef.current = value;
    setInterimText(value);
  }, []);

  const reportError = useCallback((message: string) => {
    setError(message);
    onErrorRef.current?.(message);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const stopMeterLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setAudioLevel(0);
    setAudioBands(EMPTY_BANDS);
  }, []);

  const releaseAudioResources = useCallback(() => {
    stopTimer();
    stopMeterLoop();

    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      processorRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      analyserRef.current = null;
    }

    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void ctx.close().catch(() => {});
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // Ignore socket close error
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    pendingPcmQueueRef.current = [];
    usingLiveWsRef.current = false;
  }, [stopMeterLoop, stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsedSeconds(0);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }, [stopTimer]);

  const startMeterLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    let lastUiUpdate = 0;
    const freqBuffer = new Uint8Array(32);

    const tick = (now: number) => {
      const analyser = analyserRef.current;
      if (!analyser) return;

      if (now - lastUiUpdate >= 42) {
        lastUiUpdate = now;
        analyser.getByteFrequencyData(freqBuffer);

        let sum = 0;
        const nextBands: number[] = [];
        for (let i = 0; i < BAND_COUNT; i += 1) {
          const binIndex = Math.min(freqBuffer.length - 1, Math.floor((i / BAND_COUNT) * 18) + 1);
          const raw = freqBuffer[binIndex] / 255;
          // Symmetrical center weighting + gentle floor for lively organic waveform
          const normalized = Math.min(1, Math.max(0.08, Math.pow(raw, 0.78) * 1.18));
          nextBands.push(normalized);
          sum += raw;
        }
        const avg = Math.min(1, (sum / BAND_COUNT) * 1.65);
        if (avg > 0.14) {
          speechDetectedRef.current = true;
        }
        setAudioLevel(avg);
        setAudioBands(nextBands);
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const connectLiveWs = useCallback((token: number, field: string) => {
    if (typeof window === 'undefined') return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ai/transcribe-ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      usingLiveWsRef.current = true;

      ws.onopen = () => {
        if (sessionTokenRef.current !== token || cancelRequestedRef.current) {
          try {
            ws.close();
          } catch {
            // Ignore close
          }
          return;
        }

        // Flush every buffered PCM frame recorded while WebSocket was handshaking
        const queued = pendingPcmQueueRef.current;
        pendingPcmQueueRef.current = [];
        for (const base64Audio of queued) {
          try {
            ws.send(JSON.stringify({ audio: base64Audio }));
          } catch {
            break;
          }
        }
      };

      ws.onmessage = (event) => {
        if (sessionTokenRef.current !== token || cancelRequestedRef.current) return;
        try {
          const msg = JSON.parse(String(event.data || '{}')) as {
            ready?: boolean;
            interimTranscript?: string;
            transcript?: string;
            error?: string;
            closed?: boolean;
          };
          if (msg.ready) {
            setStatus('listening');
          }
          if (typeof msg.interimTranscript === 'string') {
            updateInterim(msg.interimTranscript);
          }
          if (typeof msg.transcript === 'string') {
            const clean = msg.transcript.trim();
            if (clean) {
              wsFinalTextRef.current = wsFinalTextRef.current
                ? `${wsFinalTextRef.current} ${clean}`
                : clean;
              updateInterim('');
              onFinalTextRef.current(field, clean);
            }
          }
          if (msg.error) {
            // Live WS couldn't initialize; WAV/MediaRecorder HTTP fallback on stop will transcribe seamlessly.
            usingLiveWsRef.current = false;
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        usingLiveWsRef.current = false;
      };
    } catch {
      usingLiveWsRef.current = false;
    }
  }, [updateInterim]);

  const transcribeViaHttpFallback = useCallback(
    async (field: string, token: number) => {
      if (sessionTokenRef.current !== token || cancelRequestedRef.current) {
        setIsProcessing(false);
        setStatus('idle');
        return;
      }

      try {
        let blob: Blob | null = null;
        let mimeType = 'audio/wav';

        // Prefer lossless 16kHz mono PCM WAV built straight from captured PCM buffer (zero mux overhead)
        if (pcmArchiveRef.current.length > 0 && pcmSampleTotalRef.current >= TARGET_SAMPLE_RATE * 0.2) {
          const merged = mergeInt16Chunks(pcmArchiveRef.current);
          blob = encodeWavBlobFromInt16(merged, TARGET_SAMPLE_RATE);
          mimeType = 'audio/wav';
        } else if (chunksRef.current.length > 0) {
          const recordedType = recorderRef.current?.mimeType || 'audio/webm';
          const rawBlob = new Blob(chunksRef.current, { type: recordedType });
          if (rawBlob.size >= 400) {
            blob = rawBlob;
            mimeType = recordedType;
          }
        }

        if (!blob) {
          reportError('No speech audio was captured. Try speaking closer to the mic.');
          return;
        }

        const audioBase64 = await blobToBase64(blob);
        const res = await fetch('/api/ai/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64, mimeType }),
        });
        const data = (await res.json()) as { text?: string; error?: string };

        if (!res.ok) {
          throw new Error(data.error || `Transcription failed (${res.status})`);
        }

        const transcript = (data.text || '').trim();
        if (transcript && !cancelRequestedRef.current && sessionTokenRef.current === token) {
          onFinalTextRef.current(field, transcript);
        } else if (!wsFinalTextRef.current && !srFinalizedTextRef.current) {
          reportError('No clear speech detected. Tap the mic and speak steadily.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice note transcription failed.';
        reportError(msg);
      } finally {
        chunksRef.current = [];
        pcmArchiveRef.current = [];
        pcmSampleTotalRef.current = 0;
        if (sessionTokenRef.current === token) {
          setIsProcessing(false);
          setStatus('idle');
        }
      }
    },
    [reportError],
  );

  const finalizeAndStopCapture = useCallback(
    async (field: string, token: number) => {
      stopTimer();

      // If Web Speech was active, flush any trailing interim phrase immediately so zero words vanish
      if (recognitionRef.current) {
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        try {
          rec.stop();
        } catch {
          // Ignore stop race
        }
      }

      const trailingInterim = interimTextRef.current.trim();
      const hasWsLiveText = Boolean(wsFinalTextRef.current.trim());
      const hasSrFinalText = Boolean(srFinalizedTextRef.current.trim());

      // Signal Live WS end-of-audio gently if open
      const activeWs = wsRef.current;
      const wsOpen = Boolean(activeWs && activeWs.readyState === WebSocket.OPEN);
      if (wsOpen && activeWs) {
        setStatus('processing');
        setIsProcessing(true);
        try {
          const silenceTail = new Int16Array(TARGET_SAMPLE_RATE * 0.2);
          activeWs.send(JSON.stringify({ audio: int16ToBase64(silenceTail) }));
          activeWs.send(JSON.stringify({ stop: true }));
        } catch {
          // Ignore tail send errors
        }
        // Brief flush window so Gemini Live WS can emit its final turn text before falling back to HTTP WAV
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }

      if (sessionTokenRef.current !== token || cancelRequestedRef.current) {
        releaseAudioResources();
        setIsProcessing(false);
        setStatus('idle');
        return;
      }

      // Stop MediaRecorder cleanly if running
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec && rec.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          const fallbackResolve = window.setTimeout(resolve, 250);
          rec.onstop = () => {
            window.clearTimeout(fallbackResolve);
            resolve();
          };
          try {
            rec.stop();
          } catch {
            window.clearTimeout(fallbackResolve);
            resolve();
          }
        });
      }

      const gotWsFinal = Boolean(wsFinalTextRef.current.trim());
      const gotSrAny = hasSrFinalText || srHasResultRef.current;

      // Flush remaining interim text if Live WS or SpeechRecognition produced unfinalized trailing words
      if (!gotWsFinal && trailingInterim) {
        onFinalTextRef.current(field, trailingInterim);
        updateInterim('');
        releaseAudioResources();
        setIsProcessing(false);
        setStatus('idle');
        return;
      }

      if (gotWsFinal || (gotSrAny && hasSrFinalText)) {
        updateInterim('');
        releaseAudioResources();
        setIsProcessing(false);
        setStatus('idle');
        return;
      }

      // Neither Live WS nor Web Speech finalized text — run instant 16kHz WAV HTTP fallback
      const hasCapturedAudio =
        pcmArchiveRef.current.length > 0 || chunksRef.current.length > 0;
      releaseAudioResources();

      if (hasCapturedAudio && !hasWsLiveText) {
        setStatus('processing');
        setIsProcessing(true);
        await transcribeViaHttpFallback(field, token);
      } else {
        setIsProcessing(false);
        setStatus('idle');
      }
    },
    [releaseAudioResources, stopTimer, transcribeViaHttpFallback, updateInterim],
  );

  const stop = useCallback(
    (cancelled = false) => {
      cancelRequestedRef.current = cancelled;
      const currentField = activeFieldRef.current;
      const token = sessionTokenRef.current;

      activeFieldRef.current = null;
      setActiveField(null);

      if (cancelled || !currentField) {
        sessionTokenRef.current += 1;
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {
            // Ignore
          }
          recognitionRef.current = null;
        }
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          try {
            recorderRef.current.stop();
          } catch {
            // Ignore
          }
        }
        recorderRef.current = null;
        chunksRef.current = [];
        pcmArchiveRef.current = [];
        pcmSampleTotalRef.current = 0;
        updateInterim('');
        releaseAudioResources();
        setIsProcessing(false);
        setStatus('idle');
        return;
      }

      void finalizeAndStopCapture(currentField, token);
    },
    [finalizeAndStopCapture, releaseAudioResources, updateInterim],
  );

  const cancel = useCallback(() => {
    stop(true);
  }, [stop]);

  const startVoiceNote = useCallback(
    async (field: string) => {
      if (activeFieldRef.current === field) {
        stop(false);
        return;
      }

      if (activeFieldRef.current) {
        stop(true);
      }

      const token = sessionTokenRef.current + 1;
      sessionTokenRef.current = token;
      cancelRequestedRef.current = false;
      srHasResultRef.current = false;
      speechDetectedRef.current = false;
      srFinalizedTextRef.current = '';
      wsFinalTextRef.current = '';
      chunksRef.current = [];
      pcmArchiveRef.current = [];
      pcmSampleTotalRef.current = 0;
      pendingPcmQueueRef.current = [];
      usingLiveWsRef.current = false;

      setError(null);
      updateInterim('');
      activeFieldRef.current = field;
      setActiveField(field);
      setStatus('connecting');
      setIsProcessing(false);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        activeFieldRef.current = null;
        setActiveField(null);
        setStatus('idle');
        reportError('Microphone capture is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (sessionTokenRef.current !== token || cancelRequestedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Build clean speech-optimized Web Audio chain:
        // Mic -> 85Hz High-Pass (cuts rumble/wind) -> Gentle Compressor -> Analyser (60fps meter) + 16kHz PCM Tap
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(stream);
        const highPass = ctx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 85;
        highPass.Q.value = 0.7;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 18;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.14;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.52;
        analyserRef.current = analyser;

        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        // Keep Web Audio graph silent on output (no speaker feedback)
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;

        source.connect(highPass);
        highPass.connect(compressor);
        compressor.connect(analyser);
        analyser.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);

        // Start secondary MediaRecorder backup if supported
        if (typeof MediaRecorder !== 'undefined') {
          try {
            const mime = pickSupportedRecorderMime();
            const recorder = mime
              ? new MediaRecorder(stream, { mimeType: mime })
              : new MediaRecorder(stream);
            recorderRef.current = recorder;
            recorder.ondataavailable = (evt) => {
              if (evt.data && evt.data.size > 0) {
                chunksRef.current.push(evt.data);
              }
            };
            recorder.start(250);
          } catch {
            recorderRef.current = null;
          }
        }

        const preferLiveWsFirst = isEmbeddedIframe() || !getSpeechRecognitionCtor();

        processor.onaudioprocess = (evt) => {
          if (sessionTokenRef.current !== token || cancelRequestedRef.current) return;
          const channelData = evt.inputBuffer.getChannelData(0);
          const rms = computeNormalizedRms(channelData);
          if (rms > 0.12) {
            speechDetectedRef.current = true;
          }

          const pcm16 = downsampleTo16kInt16(channelData, ctx.sampleRate);
          if (!pcm16.length) return;

          // Archive 16kHz PCM for instant WAV fallback (no WebM mux lag)
          if (pcmSampleTotalRef.current < MAX_WAV_SAMPLES) {
            pcmArchiveRef.current.push(pcm16);
            pcmSampleTotalRef.current += pcm16.length;
          }

          const base64Audio = int16ToBase64(pcm16);
          const ws = wsRef.current;

          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ audio: base64Audio }));
            } catch {
              // Ignore transient send error
            }
          } else {
            // Ring buffer early frames while WS is connecting OR in case Web Speech stalls
            const queue = pendingPcmQueueRef.current;
            queue.push(base64Audio);
            if (queue.length > MAX_PENDING_PCM_FRAMES) {
              queue.shift();
            }
          }
        };

        startMeterLoop();
        startTimer();
        setStatus('listening');

        if (preferLiveWsFirst) {
          // Inside embedded iframes or browsers without SpeechRecognition:
          // Start Gemini Live WebSocket directly while pendingPcmQueue buffers opening syllables.
          connectLiveWs(token, field);
          return;
        }

        // Outside iframe with native Web Speech available:
        // Run Web Speech for ultra-fast ~80ms interim words, guarded by a 1.6s live-voice watchdog
        // that hot-swaps to Gemini Live WS (flushing buffered PCM from t=0) if Web Speech hangs silently.
        const SpeechRecognitionCtor = getSpeechRecognitionCtor();
        if (!SpeechRecognitionCtor) {
          connectLiveWs(token, field);
          return;
        }

        try {
          const rec = new SpeechRecognitionCtor();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.maxAlternatives = 1;
          recognitionRef.current = rec;

          rec.onstart = () => {
            if (sessionTokenRef.current !== token) return;
            setStatus('listening');
          };

          rec.onresult = (event) => {
            if (sessionTokenRef.current !== token || cancelRequestedRef.current) return;
            srHasResultRef.current = true;
            const results = event.results;
            if (!results) return;

            let latestInterim = '';
            const finalizedPieces: string[] = [];
            const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;

            for (let i = startIndex; i < results.length; i += 1) {
              const item = results[i];
              const transcript = item?.[0]?.transcript?.trim() ?? '';
              if (!transcript) continue;
              if (item?.isFinal) {
                finalizedPieces.push(transcript);
              } else {
                latestInterim = latestInterim ? `${latestInterim} ${transcript}` : transcript;
              }
            }

            if (finalizedPieces.length > 0) {
              const joined = finalizedPieces.join(' ').trim();
              if (joined) {
                srFinalizedTextRef.current = srFinalizedTextRef.current
                  ? `${srFinalizedTextRef.current} ${joined}`
                  : joined;
                onFinalTextRef.current(field, joined);
              }
            }
            updateInterim(latestInterim);
          };

          rec.onerror = (evt) => {
            if (sessionTokenRef.current !== token || cancelRequestedRef.current) return;
            const code = evt?.error || '';
            if (code === 'aborted') return;

            if (code === 'not-allowed' || code === 'service-not-allowed') {
              reportError('Microphone permission denied. Please allow mic access.');
              stop(true);
              return;
            }

            // On network/no-speech/audio-capture failure in Web Speech, hot-swap straight to Gemini Live WS
            recognitionRef.current = null;
            connectLiveWs(token, field);
          };

          rec.onend = () => {
            if (
              sessionTokenRef.current === token &&
              activeFieldRef.current === field &&
              !cancelRequestedRef.current &&
              recognitionRef.current === rec
            ) {
              // Keep continuous dictation alive or upgrade to Live WS if Web Speech ended early
              try {
                rec.start();
              } catch {
                recognitionRef.current = null;
                connectLiveWs(token, field);
              }
            }
          };

          rec.start();

          // Silent-hang watchdog: if mic sees real voice activity but Web Speech produces zero events
          // within 1.6s, promote Gemini Live WS immediately and flush the pre-buffered audio from t=0.
          watchdogRef.current = window.setTimeout(() => {
            if (
              sessionTokenRef.current === token &&
              activeFieldRef.current === field &&
              !srHasResultRef.current &&
              !usingLiveWsRef.current &&
              speechDetectedRef.current
            ) {
              try {
                recognitionRef.current?.abort();
              } catch {
                // Ignore abort
              }
              recognitionRef.current = null;
              connectLiveWs(token, field);
            }
          }, 1600);
        } catch {
          recognitionRef.current = null;
          connectLiveWs(token, field);
        }
      } catch (err) {
        if (sessionTokenRef.current !== token) return;
        activeFieldRef.current = null;
        setActiveField(null);
        setStatus('idle');
        releaseAudioResources();
        const message =
          err instanceof Error && /permission|notallowed/i.test(err.message)
            ? 'Microphone permission denied. Allow mic access in browser settings.'
            : 'Unable to access microphone. Check your audio input device.';
        reportError(message);
      }
    },
    [
      connectLiveWs,
      releaseAudioResources,
      reportError,
      startMeterLoop,
      startTimer,
      stop,
      updateInterim,
    ],
  );

  const toggleField = useCallback(
    (field: string) => {
      if (activeFieldRef.current === field) {
        stop(false);
        return;
      }
      void startVoiceNote(field);
    },
    [startVoiceNote, stop],
  );

  useEffect(() => {
    return () => {
      sessionTokenRef.current += 1;
      cancelRequestedRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }
      releaseAudioResources();
    };
  }, [releaseAudioResources]);

  return {
    activeField,
    status,
    interimText,
    isListening: status === 'listening' || status === 'connecting',
    isTranscribing: isProcessing,
    isProcessing,
    elapsedSeconds,
    error,
    audioLevel,
    audioBands,
    toggleField,
    stop,
    cancel,
  };
}
