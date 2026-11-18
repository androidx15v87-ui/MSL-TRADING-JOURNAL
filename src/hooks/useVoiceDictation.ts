import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

let sharedMicAudioCtx: AudioContext | null = null;

function getSharedMicAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedMicAudioCtx || sharedMicAudioCtx.state === 'closed') {
    try {
      sharedMicAudioCtx = new AudioCtx({ sampleRate: 16000 });
    } catch {
      sharedMicAudioCtx = new AudioCtx();
    }
  }
  if (sharedMicAudioCtx.state === 'suspended') {
    void sharedMicAudioCtx.resume().catch(() => {});
  }
  return sharedMicAudioCtx;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

function downsampleTo16kInt16(input: Float32Array, inputSampleRate: number): ArrayBuffer {
  if (inputSampleRate === 16000) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out.buffer;
  }

  const ratio = inputSampleRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] || 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] || s0;
    const interpolated = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
    out[i] = interpolated < 0 ? interpolated * 0x8000 : interpolated * 0x7fff;
  }
  return out.buffer;
}

function joinSegments(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DictationTurnOutcome = 'speech' | 'empty' | 'error' | 'cancelled';

export interface UseVoiceDictationOptions {
  onFinalText: (fieldKey: string, text: string) => void;
  onTurnComplete?: (fieldKey: string, finalText: string, outcome: DictationTurnOutcome) => void;
  onBargeInDetected?: () => void;
  onError: (message: string) => void;
}

export interface ToggleDictationOptions {
  autoFinalize?: boolean;
  existingStream?: MediaStream | null;
  preRollPcm?: ArrayBuffer[];
}

export type MicPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

const PAUSE_COMMIT_MS = 300;

export function useVoiceDictation({
  onFinalText,
  onTurnComplete,
  onBargeInDetected,
  onError,
}: UseVoiceDictationOptions) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [interimText, setInterimText] = useState('');
  const [mode, setMode] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const [micPermission, setMicPermission] = useState<MicPermissionState>('unknown');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recognitionEndPromiseRef = useRef<Promise<void> | null>(null);
  const speechFallbackStickyRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const wsFinalTextRef = useRef('');
  const wsInterimTextRef = useRef('');
  const wsHadErrorRef = useRef(false);
  const wsFinalWaiterRef = useRef<(() => void) | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  // Passive echo-guarded barge-in monitor state
  const bargeInActiveRef = useRef(false);
  const bargeInStreamRef = useRef<MediaStream | null>(null);
  const bargeInSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bargeInProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const bargeInGainRef = useRef<GainNode | null>(null);
  const bargeInPreRollRef = useRef<ArrayBuffer[]>([]);

  // Monotonic turn guards prevent stale React batches or late callbacks from stalling turns
  const turnIdRef = useRef(0);
  const turnSettledRef = useRef(true);
  const speechAccumulatedRef = useRef('');
  const activeFieldRef = useRef<string | null>(null);
  const modeRef = useRef<'idle' | 'listening' | 'transcribing'>('idle');
  const cancelledRef = useRef(false);
  const gotSpeechResultRef = useRef(false);
  const latestInterimRef = useRef('');
  const silenceTimerRef = useRef<number | null>(null);
  const stopTriggeredRef = useRef(false);

  const updateMode = useCallback((nextMode: 'idle' | 'listening' | 'transcribing') => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const onFinalTextRef = useRef(onFinalText);
  const onTurnCompleteRef = useRef(onTurnComplete);
  const onBargeInDetectedRef = useRef(onBargeInDetected);
  const onErrorRef = useRef(onError);
  onFinalTextRef.current = onFinalText;
  onTurnCompleteRef.current = onTurnComplete;
  onBargeInDetectedRef.current = onBargeInDetected;
  onErrorRef.current = onError;

  // Passive permission observer (never prompts on mount)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let permStatus: PermissionStatus | null = null;
    let active = true;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (!active) return;
        permStatus = status;
        setMicPermission(status.state);
        status.onchange = () => {
          if (active) setMicPermission(status.state);
        };
      })
      .catch(() => {
        // Ignore on browsers without Permissions API microphone support
      });
    return () => {
      active = false;
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const settleTurn = useCallback(
    (
      turnId: number,
      fieldKey: string | null,
      finalText: string,
      outcome: DictationTurnOutcome
    ) => {
      if (turnId !== turnIdRef.current || turnSettledRef.current) return;
      turnSettledRef.current = true;
      if (fieldKey) {
        onTurnCompleteRef.current?.(fieldKey, finalText.trim(), outcome);
      }
    },
    []
  );

  const stopBargeInMonitor = useCallback((preserveStream = false) => {
    bargeInActiveRef.current = false;
    if (bargeInProcessorRef.current) {
      bargeInProcessorRef.current.onaudioprocess = null;
      try {
        bargeInProcessorRef.current.disconnect();
      } catch {
        // Ignore
      }
      bargeInProcessorRef.current = null;
    }
    if (bargeInSourceRef.current) {
      try {
        bargeInSourceRef.current.disconnect();
      } catch {
        // Ignore
      }
      bargeInSourceRef.current = null;
    }
    if (bargeInGainRef.current) {
      try {
        bargeInGainRef.current.disconnect();
      } catch {
        // Ignore
      }
      bargeInGainRef.current = null;
    }
    if (!preserveStream && bargeInStreamRef.current) {
      bargeInStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      bargeInStreamRef.current = null;
      bargeInPreRollRef.current = [];
    }
  }, []);

  const cleanupAudioGraphAndWs = useCallback((closeWs: boolean) => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // Ignore
      }
      silentGainRef.current = null;
    }
    if (closeWs && wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // Ignore
      }
    }
    if (wsFinalWaiterRef.current) {
      const fn = wsFinalWaiterRef.current;
      wsFinalWaiterRef.current = null;
      fn();
    }
  }, []);

  const cleanupMedia = useCallback(
    (closeWs = true) => {
      clearSilenceTimer();
      cleanupAudioGraphAndWs(closeWs);
      const rec = mediaRecorderRef.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
        mediaRecorderRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore track stop errors
          }
        });
        mediaStreamRef.current = null;
      }
      audioChunksRef.current = [];
    },
    [cleanupAudioGraphAndWs, clearSilenceTimer]
  );

  const stopSpeechRecognition = useCallback(
    (cancel: boolean): Promise<void> => {
      clearSilenceTimer();
      const rec = recognitionRef.current;
      if (!rec) {
        return recognitionEndPromiseRef.current || Promise.resolve();
      }

      const activeTurnId = turnIdRef.current;
      const targetField = activeFieldRef.current;
      const danglingInterim = latestInterimRef.current.trim();
      const consolidated = cancel
        ? ''
        : joinSegments(speechAccumulatedRef.current, danglingInterim);

      // Flush un-committed interim tail synchronously so zero words are dropped or stalled
      if (!cancel && danglingInterim && targetField) {
        onFinalTextRef.current(targetField, danglingInterim);
      }

      latestInterimRef.current = '';
      speechAccumulatedRef.current = '';
      recognitionRef.current = null;
      setActiveField(null);
      activeFieldRef.current = null;
      setInterimText('');
      updateMode('idle');

      if (cancel) {
        settleTurn(activeTurnId, targetField, '', 'cancelled');
      } else {
        settleTurn(
          activeTurnId,
          targetField,
          consolidated,
          consolidated ? 'speech' : 'empty'
        );
      }

      const teardownPromise = new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          recognitionEndPromiseRef.current = null;
          resolve();
        };

        const safetyTimer = window.setTimeout(finish, 110);
        rec.onend = () => {
          window.clearTimeout(safetyTimer);
          finish();
        };
        rec.onerror = () => {
          window.clearTimeout(safetyTimer);
          finish();
        };

        try {
          if (cancel) {
            rec.abort();
          } else {
            rec.stop();
          }
        } catch {
          window.clearTimeout(safetyTimer);
          finish();
        }
      });

      recognitionEndPromiseRef.current = teardownPromise;
      return teardownPromise;
    },
    [clearSilenceTimer, settleTurn]
  );

  const stop = useCallback(
    (cancel = false) => {
      cancelledRef.current = cancel;
      clearSilenceTimer();

      if (recognitionRef.current) {
        void stopSpeechRecognition(cancel);
        setActiveField(null);
        activeFieldRef.current = null;
        setInterimText('');
        updateMode('idle');
        return;
      }

      if (cancel) {
        const currentTurn = turnIdRef.current;
        const targetField = activeFieldRef.current;
        cleanupMedia(true);
        setActiveField(null);
        activeFieldRef.current = null;
        setInterimText('');
        updateMode('idle');
        settleTurn(currentTurn, targetField, '', 'cancelled');
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ stop: true }));
        } catch {
          // Ignore
        }
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          const currentTurn = turnIdRef.current;
          const targetField = activeFieldRef.current;
          cleanupMedia(true);
          setActiveField(null);
          activeFieldRef.current = null;
          setInterimText('');
          updateMode('idle');
          settleTurn(currentTurn, targetField, '', 'empty');
        }
        return;
      }

      const currentTurn = turnIdRef.current;
      const targetField = activeFieldRef.current;
      cleanupMedia(true);
      setActiveField(null);
      activeFieldRef.current = null;
      setInterimText('');
      updateMode('idle');
      settleTurn(currentTurn, targetField, '', 'empty');
    },
    [cleanupMedia, clearSilenceTimer, settleTurn, stopSpeechRecognition, updateMode]
  );

  useEffect(() => {
    return () => {
      stopBargeInMonitor(false);
      stop(true);
    };
  }, [stop, stopBargeInMonitor]);

  const startMediaFallback = useCallback(
    async (
      fieldKey: string,
      autoFinalize = false,
      turnIdOverride?: number,
      hotStream?: MediaStream | null,
      preRollPcm?: ArrayBuffer[]
    ) => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      ) {
        onErrorRef.current('Voice dictation is not supported in this browser.');
        return;
      }

      cleanupMedia(true);
      if (recognitionEndPromiseRef.current) {
        await recognitionEndPromiseRef.current;
      }

      const activeTurnId = turnIdOverride ?? ++turnIdRef.current;
      turnSettledRef.current = false;

      try {
        const stream =
          hotStream ||
          (await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          }));

        if (activeTurnId !== turnIdRef.current) {
          if (!hotStream) {
            stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                // Ignore
              }
            });
          }
          return;
        }

        setMicPermission('granted');
        mediaStreamRef.current = stream;
        audioChunksRef.current = [];
        stopTriggeredRef.current = false;

        wsFinalTextRef.current = '';
        wsInterimTextRef.current = '';
        wsHadErrorRef.current = false;

        // Open real-time Gemini Live WebSocket transcription channel (/api/ai/transcribe-ws)
        if (typeof WebSocket !== 'undefined') {
          try {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${proto}//${window.location.host}/api/ai/transcribe-ws`);
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onopen = () => {
              if (preRollPcm && preRollPcm.length > 0 && ws.readyState === WebSocket.OPEN) {
                for (const frame of preRollPcm) {
                  ws.send(frame);
                }
              }
            };

            ws.onmessage = (evt) => {
              if (cancelledRef.current || activeTurnId !== turnIdRef.current) return;
              try {
                const payload = JSON.parse(String(evt.data || '{}')) as {
                  transcript?: string;
                  interimTranscript?: string;
                  error?: string;
                };
                if (payload.error) {
                  wsHadErrorRef.current = true;
                  return;
                }
                if (typeof payload.transcript === 'string' && payload.transcript.trim()) {
                  const piece = payload.transcript.trim();
                  wsFinalTextRef.current = joinSegments(wsFinalTextRef.current, piece);
                  wsInterimTextRef.current = '';
                  setInterimText(wsFinalTextRef.current);
                  if (wsFinalWaiterRef.current) {
                    const fn = wsFinalWaiterRef.current;
                    wsFinalWaiterRef.current = null;
                    fn();
                  }
                } else if (typeof payload.interimTranscript === 'string') {
                  wsInterimTextRef.current = payload.interimTranscript.trim();
                  const combined = joinSegments(wsFinalTextRef.current, wsInterimTextRef.current);
                  if (combined) setInterimText(combined);
                }
              } catch {
                // Ignore malformed server frame
              }
            };

            ws.onerror = () => {
              wsHadErrorRef.current = true;
            };
          } catch {
            wsHadErrorRef.current = true;
          }
        }

        // Stream 16kHz PCM frames + adaptive ~300ms VAD inside shared AudioContext
        const audioCtx = getSharedMicAudioContext();
        if (audioCtx) {
          try {
            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(2048, 1, 1);
            const silentGain = audioCtx.createGain();
            silentGain.gain.value = 0;

            sourceNodeRef.current = source;
            processorNodeRef.current = processor;
            silentGainRef.current = silentGain;

            let heardSpeech = Boolean(preRollPcm && preRollPcm.length > 0);
            let noiseFloor = 0.008;
            let lastVoiceAt = Date.now();
            const startedAt = Date.now();

            processor.onaudioprocess = (e) => {
              if (
                cancelledRef.current ||
                stopTriggeredRef.current ||
                activeTurnId !== turnIdRef.current
              ) {
                return;
              }
              const samples = e.inputBuffer.getChannelData(0);

              let peak = 0;
              for (let i = 0; i < samples.length; i += 4) {
                const abs = samples[i] < 0 ? -samples[i] : samples[i];
                if (abs > peak) peak = abs;
              }

              if (!heardSpeech) {
                noiseFloor = Math.min(0.035, noiseFloor * 0.94 + peak * 0.06);
              }
              const speechThreshold = Math.max(0.022, noiseFloor * 2.5);

              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN && !wsHadErrorRef.current) {
                if (heardSpeech || peak >= Math.max(0.014, noiseFloor * 1.6)) {
                  ws.send(downsampleTo16kInt16(samples, audioCtx.sampleRate));
                }
              }

              if (autoFinalize) {
                const now = Date.now();
                if (peak >= speechThreshold) {
                  heardSpeech = true;
                  lastVoiceAt = now;
                } else if (heardSpeech && now - lastVoiceAt >= PAUSE_COMMIT_MS) {
                  stopTriggeredRef.current = true;
                  stop(false);
                } else if (!heardSpeech && now - startedAt >= 10000) {
                  stopTriggeredRef.current = true;
                  stop(false);
                }
              }
            };

            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(audioCtx.destination);
          } catch {
            // Fall through gracefully to MediaRecorder binary backup
          }
        }

        // Parallel ultra-compact binary MediaRecorder backup (16kbps voice bitrate -> zero FileReader)
        const mimeType = pickSupportedAudioMime();
        const recorderOptions: MediaRecorderOptions = mimeType
          ? { mimeType, audioBitsPerSecond: 16000 }
          : { audioBitsPerSecond: 16000 };
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, recorderOptions);
        } catch {
          recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        }

        mediaRecorderRef.current = recorder;
        cancelledRef.current = false;
        activeFieldRef.current = fieldKey;
        setActiveField(fieldKey);
        setInterimText(
          autoFinalize ? 'Listening… speak naturally' : 'Listening… tap mic when done'
        );
        updateMode('listening');

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const targetField = activeFieldRef.current;
          const recordedMime = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
          const blob = new Blob(audioChunksRef.current, { type: recordedMime });

          cleanupAudioGraphAndWs(false);
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch {
                // Ignore
              }
            });
            mediaStreamRef.current = null;
          }
          mediaRecorderRef.current = null;
          audioChunksRef.current = [];

          if (cancelledRef.current || !targetField || activeTurnId !== turnIdRef.current) {
            cleanupMedia(true);
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');
            settleTurn(activeTurnId, targetField, '', 'cancelled');
            return;
          }

          // Give live WS a tight 160ms window to deliver any final sentence commit
          if (
            !wsFinalTextRef.current &&
            wsRef.current &&
            wsRef.current.readyState === WebSocket.OPEN
          ) {
            await new Promise<void>((resolve) => {
              const t = window.setTimeout(resolve, 160);
              wsFinalWaiterRef.current = () => {
                window.clearTimeout(t);
                resolve();
              };
            });
          }

          const liveTranscript = joinSegments(wsFinalTextRef.current, wsInterimTextRef.current);
          cleanupMedia(true);

          if (liveTranscript) {
            if (!cancelledRef.current && activeTurnId === turnIdRef.current) {
              onFinalTextRef.current(targetField, liveTranscript);
            }
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');
            settleTurn(activeTurnId, targetField, liveTranscript, 'speech');
            return;
          }

          if (blob.size < 400) {
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');
            settleTurn(activeTurnId, targetField, '', 'empty');
            return;
          }

          updateMode('transcribing');
          setInterimText('Transcribing voice…');

          try {
            const res = await fetch('/api/ai/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': recordedMime || 'audio/webm' },
              body: blob,
            });

            const data = (await res.json().catch(() => ({}))) as {
              text?: string;
              error?: string;
            };
            if (!res.ok) {
              throw new Error(data.error || 'Voice transcription failed.');
            }
            const cleanText = (data.text || '').trim();
            if (cleanText && !cancelledRef.current && activeTurnId === turnIdRef.current) {
              onFinalTextRef.current(targetField, cleanText);
            }
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');
            settleTurn(
              activeTurnId,
              targetField,
              cleanText,
              cleanText ? 'speech' : 'empty'
            );
          } catch (err) {
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');
            if (!cancelledRef.current && activeTurnId === turnIdRef.current) {
              onErrorRef.current(
                err instanceof Error ? err.message : 'Unable to transcribe audio.'
              );
              settleTurn(activeTurnId, targetField, '', 'error');
            }
          }
        };

        recorder.start(100);
      } catch (err) {
        cleanupMedia(true);
        setActiveField(null);
        activeFieldRef.current = null;
        setInterimText('');
        updateMode('idle');

        const errName = err instanceof Error ? err.name : '';
        let msg = 'Unable to access microphone. Check browser permissions and try again.';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setMicPermission('denied');
          msg = 'Microphone permission blocked. Allow mic access in your browser site settings and try again.';
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          msg = 'No microphone detected on this device.';
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          msg = 'Microphone is busy. Wait a moment and tap mic again.';
        }
        onErrorRef.current(msg);
        settleTurn(activeTurnId, fieldKey, '', 'error');
      }
    },
    [cleanupAudioGraphAndWs, cleanupMedia, settleTurn, stop, updateMode]
  );

  const toggleField = useCallback(
    async (fieldKey: string, options?: ToggleDictationOptions) => {
      if (modeRef.current === 'transcribing') return;

      if (activeFieldRef.current === fieldKey && !options?.existingStream) {
        stop(false);
        return;
      }

      if (activeFieldRef.current) {
        stop(true);
      }

      // Stop any passive barge-in listener cleanly unless promoting its hot stream
      stopBargeInMonitor(Boolean(options?.existingStream));

      if (micPermission === 'denied') {
        onErrorRef.current(
          'Microphone permission is blocked in browser site settings. Enable microphone access and try again.'
        );
        return;
      }

      // Claim active field synchronously before async handoffs so barge-in monitor never double-opens
      activeFieldRef.current = fieldKey;
      setActiveField(fieldKey);

      if (recognitionEndPromiseRef.current) {
        await recognitionEndPromiseRef.current;
      }

      getSharedMicAudioContext();

      const autoFinalize = Boolean(options?.autoFinalize);
      const myTurnId = ++turnIdRef.current;
      turnSettledRef.current = false;
      speechAccumulatedRef.current = '';

      // When promoting a hot barge-in MediaStream, go straight into Live WS PCM capture (zero dropped words!)
      if (options?.existingStream) {
        await startMediaFallback(
          fieldKey,
          autoFinalize,
          myTurnId,
          options.existingStream,
          options.preRollPcm
        );
        return;
      }

      const SpeechRec = !speechFallbackStickyRef.current ? getSpeechRecognitionCtor() : null;
      if (SpeechRec) {
        try {
          const recognition = new SpeechRec();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = navigator.language || 'en-GB';

          cancelledRef.current = false;
          gotSpeechResultRef.current = false;
          latestInterimRef.current = '';
          recognitionRef.current = recognition;
          activeFieldRef.current = fieldKey;
          setActiveField(fieldKey);
          setInterimText('');
          updateMode('listening');

          const resetSpeechSilenceTimer = () => {
            if (!autoFinalize) return;
            if (silenceTimerRef.current !== null) {
              window.clearTimeout(silenceTimerRef.current);
            }
            silenceTimerRef.current = window.setTimeout(() => {
              if (
                recognitionRef.current === recognition &&
                gotSpeechResultRef.current &&
                myTurnId === turnIdRef.current
              ) {
                stop(false);
              }
            }, PAUSE_COMMIT_MS);
          };

          recognition.onresult = (event) => {
            if (cancelledRef.current || myTurnId !== turnIdRef.current) return;
            setMicPermission('granted');
            gotSpeechResultRef.current = true;
            let finalChunk = '';
            let interimChunk = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              const transcript = result[0]?.transcript || '';
              if (result.isFinal) {
                finalChunk += transcript;
              } else {
                interimChunk += transcript;
              }
            }
            const trimmedInterim = interimChunk.trim();
            latestInterimRef.current = trimmedInterim;
            setInterimText(trimmedInterim);

            const cleanFinal = finalChunk.trim();
            if (cleanFinal && activeFieldRef.current) {
              speechAccumulatedRef.current = joinSegments(
                speechAccumulatedRef.current,
                cleanFinal
              );
              latestInterimRef.current = '';
              onFinalTextRef.current(activeFieldRef.current, cleanFinal);
            }
            resetSpeechSilenceTimer();
          };

          recognition.onerror = (event) => {
            if (myTurnId !== turnIdRef.current) return;
            const code = event.error;
            if (code === 'aborted' || code === 'no-speech') return;

            clearSilenceTimer();
            recognitionRef.current = null;
            recognitionEndPromiseRef.current = null;
            latestInterimRef.current = '';
            speechAccumulatedRef.current = '';
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');

            if (code === 'service-not-allowed') {
              speechFallbackStickyRef.current = true;
            }
            void startMediaFallback(fieldKey, autoFinalize, myTurnId);
          };

          recognition.onend = () => {
            clearSilenceTimer();
            if (myTurnId !== turnIdRef.current) return;
            const capturedField = activeFieldRef.current || fieldKey;
            const danglingInterim = latestInterimRef.current.trim();
            const consolidated = cancelledRef.current
              ? ''
              : joinSegments(speechAccumulatedRef.current, danglingInterim);

            latestInterimRef.current = '';
            speechAccumulatedRef.current = '';

            if (!cancelledRef.current && danglingInterim) {
              onFinalTextRef.current(capturedField, danglingInterim);
            }

            if (recognitionRef.current === recognition) {
              recognitionRef.current = null;
            }
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            updateMode('idle');

            settleTurn(
              myTurnId,
              capturedField,
              consolidated,
              cancelledRef.current ? 'cancelled' : consolidated ? 'speech' : 'empty'
            );
          };

          recognition.start();
          return;
        } catch {
          recognitionRef.current = null;
          activeFieldRef.current = null;
        }
      }

      await startMediaFallback(fieldKey, autoFinalize, myTurnId);
    },
    [clearSilenceTimer, micPermission, settleTurn, startMediaFallback, stop, stopBargeInMonitor, updateMode]
  );

  // Passive echo-guarded Barge-In Monitor while AI is speaking or streaming in Voice Chat
  const setBargeInMonitoring = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        if (bargeInActiveRef.current || bargeInStreamRef.current) {
          stopBargeInMonitor(false);
        }
        return;
      }

      if (bargeInActiveRef.current || activeFieldRef.current !== null || micPermission === 'denied') {
        return;
      }
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        return;
      }

      bargeInActiveRef.current = true;
      bargeInPreRollRef.current = [];

      void navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        })
        .then((stream) => {
          if (!bargeInActiveRef.current || activeFieldRef.current !== null) {
            stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                // Ignore
              }
            });
            return;
          }

          const audioCtx = getSharedMicAudioContext();
          if (!audioCtx) {
            stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                // Ignore
              }
            });
            bargeInActiveRef.current = false;
            return;
          }

          bargeInStreamRef.current = stream;
          const source = audioCtx.createMediaStreamSource(stream);
          const processor = audioCtx.createScriptProcessor(2048, 1, 1);
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;

          bargeInSourceRef.current = source;
          bargeInProcessorRef.current = processor;
          bargeInGainRef.current = silentGain;

          const monitorStartedAt = Date.now();
          let noiseFloor = 0.012;
          let consecutiveVoiceFrames = 0;

          processor.onaudioprocess = (e) => {
            if (!bargeInActiveRef.current) return;
            const samples = e.inputBuffer.getChannelData(0);

            // Keep compact rolling pre-roll (~500ms) so barge-in never clips opening words
            const pcmFrame = downsampleTo16kInt16(samples, audioCtx.sampleRate);
            bargeInPreRollRef.current.push(pcmFrame);
            if (bargeInPreRollRef.current.length > 5) {
              bargeInPreRollRef.current.shift();
            }

            // 320ms initial acoustic settle guard after AI audio starts
            if (Date.now() - monitorStartedAt < 320) return;

            let peak = 0;
            for (let i = 0; i < samples.length; i += 4) {
              const abs = samples[i] < 0 ? -samples[i] : samples[i];
              if (abs > peak) peak = abs;
            }

            // Echo-safe threshold requires sustained voice above adaptive floor across 2 consecutive frames (~220ms)
            const bargeThreshold = Math.max(0.055, noiseFloor * 3.1);
            if (peak >= bargeThreshold) {
              consecutiveVoiceFrames += 1;
              if (consecutiveVoiceFrames >= 2) {
                const hotStream = bargeInStreamRef.current;
                const preRoll = [...bargeInPreRollRef.current];
                bargeInStreamRef.current = null;
                bargeInPreRollRef.current = [];
                stopBargeInMonitor(true);
                onBargeInDetectedRef.current?.();
                if (hotStream) {
                  void toggleField('ai-live-voice', {
                    autoFinalize: true,
                    existingStream: hotStream,
                    preRollPcm: preRoll,
                  });
                }
              }
            } else {
              consecutiveVoiceFrames = 0;
              noiseFloor = Math.min(0.038, noiseFloor * 0.94 + peak * 0.06);
            }
          };

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(audioCtx.destination);
        })
        .catch(() => {
          bargeInActiveRef.current = false;
        });
    },
    [micPermission, stopBargeInMonitor, toggleField]
  );

  return {
    activeField,
    interimText,
    mode,
    micPermission,
    isListening: mode === 'listening',
    isTranscribing: mode === 'transcribing',
    toggleField,
    setBargeInMonitoring,
    stop,
  };
}
