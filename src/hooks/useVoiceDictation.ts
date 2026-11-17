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

export interface UseVoiceDictationOptions {
  onFinalText: (fieldKey: string, text: string) => void;
  onError: (message: string) => void;
}

export function useVoiceDictation({ onFinalText, onError }: UseVoiceDictationOptions) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [interimText, setInterimText] = useState('');
  const [mode, setMode] = useState<'idle' | 'listening' | 'transcribing'>('idle');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recognitionEndPromiseRef = useRef<Promise<void> | null>(null);
  const speechFallbackStickyRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeFieldRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const gotSpeechResultRef = useRef(false);

  const onFinalTextRef = useRef(onFinalText);
  const onErrorRef = useRef(onError);
  onFinalTextRef.current = onFinalText;
  onErrorRef.current = onError;

  const cleanupMedia = useCallback(() => {
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
  }, []);

  const stopSpeechRecognition = useCallback((cancel: boolean): Promise<void> => {
    const rec = recognitionRef.current;
    if (!rec) {
      return recognitionEndPromiseRef.current || Promise.resolve();
    }

    recognitionRef.current = null;
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

      const safetyTimer = window.setTimeout(finish, 400);
      const prevOnEnd = rec.onend;
      rec.onend = () => {
        window.clearTimeout(safetyTimer);
        if (cancel && prevOnEnd) {
          // Ignore UI reset from stale handler
        }
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
  }, []);

  const stop = useCallback(
    (cancel = false) => {
      cancelledRef.current = cancel;

      if (recognitionRef.current) {
        void stopSpeechRecognition(cancel);
        setActiveField(null);
        activeFieldRef.current = null;
        setInterimText('');
        setMode('idle');
        return;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          cleanupMedia();
          setActiveField(null);
          activeFieldRef.current = null;
          setInterimText('');
          setMode('idle');
        }
        return;
      }

      cleanupMedia();
      setActiveField(null);
      activeFieldRef.current = null;
      setInterimText('');
      setMode('idle');
    },
    [cleanupMedia, stopSpeechRecognition]
  );

  useEffect(() => {
    return () => {
      stop(true);
    };
  }, [stop]);

  const startMediaFallback = useCallback(
    async (fieldKey: string) => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      ) {
        onErrorRef.current('Voice dictation is not supported in this browser.');
        return;
      }

      // Guarantee any prior media stream or recorder is fully released before requesting a new one
      cleanupMedia();
      if (recognitionEndPromiseRef.current) {
        await recognitionEndPromiseRef.current;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        audioChunksRef.current = [];

        const mimeType = pickSupportedAudioMime();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        mediaRecorderRef.current = recorder;
        cancelledRef.current = false;
        activeFieldRef.current = fieldKey;
        setActiveField(fieldKey);
        setInterimText('Recording voice note… tap mic again to transcribe');
        setMode('listening');

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const targetField = activeFieldRef.current;
          const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(audioChunksRef.current, { type: recordedMime });
          cleanupMedia();

          if (cancelledRef.current || !targetField || blob.size === 0) {
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            setMode('idle');
            return;
          }

          setMode('transcribing');
          setInterimText('Transcribing voice note…');

          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const res = String(reader.result || '');
                const commaIdx = res.indexOf(',');
                resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
              };
              reader.onerror = () => reject(new Error('Could not read recorded audio.'));
              reader.readAsDataURL(blob);
            });

            const res = await fetch('/api/ai/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: recordedMime,
              }),
            });

            const data = (await res.json().catch(() => ({}))) as {
              text?: string;
              error?: string;
            };
            if (!res.ok) {
              throw new Error(data.error || 'Voice transcription failed.');
            }
            if (data.text) {
              onFinalTextRef.current(targetField, data.text);
            }
          } catch (err) {
            onErrorRef.current(
              err instanceof Error ? err.message : 'Unable to transcribe audio.'
            );
          } finally {
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            setMode('idle');
          }
        };

        recorder.start(250);
      } catch (err) {
        cleanupMedia();
        setActiveField(null);
        activeFieldRef.current = null;
        setInterimText('');
        setMode('idle');

        const errName = err instanceof Error ? err.name : '';
        let msg = 'Unable to access microphone. Check browser permissions and try again.';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          msg = 'Microphone permission blocked. Allow mic access in your browser site settings and try again.';
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          msg = 'No microphone detected on this device.';
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          msg = 'Microphone is currently busy. Wait a moment and tap mic again.';
        }
        onErrorRef.current(msg);
      }
    },
    [cleanupMedia]
  );

  const toggleField = useCallback(
    async (fieldKey: string) => {
      if (mode === 'transcribing') return;

      if (activeFieldRef.current === fieldKey) {
        stop(false);
        return;
      }

      if (activeFieldRef.current) {
        stop(true);
      }

      // Wait for any previous SpeechRecognition teardown to finish releasing audio hardware
      if (recognitionEndPromiseRef.current) {
        await recognitionEndPromiseRef.current;
      }

      const SpeechRec = !speechFallbackStickyRef.current ? getSpeechRecognitionCtor() : null;
      if (SpeechRec) {
        try {
          const recognition = new SpeechRec();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = navigator.language || 'en-US';

          cancelledRef.current = false;
          gotSpeechResultRef.current = false;
          recognitionRef.current = recognition;
          activeFieldRef.current = fieldKey;
          setActiveField(fieldKey);
          setInterimText('');
          setMode('listening');

          recognition.onresult = (event) => {
            if (cancelledRef.current) return;
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
            setInterimText(interimChunk.trim());
            if (finalChunk.trim() && activeFieldRef.current) {
              onFinalTextRef.current(activeFieldRef.current, finalChunk.trim());
            }
          };

          recognition.onerror = (event) => {
            const code = event.error;
            if (code === 'aborted' || code === 'no-speech') return;

            // Many browsers/iframes reject SpeechRecognition on reuse with `not-allowed` or `audio-capture`
            // even when `getUserMedia` mic recording works cleanly. Automatically switch to MediaRecorder fallback.
            recognitionRef.current = null;
            recognitionEndPromiseRef.current = null;
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            setMode('idle');

            if (code === 'not-allowed' || code === 'service-not-allowed') {
              speechFallbackStickyRef.current = true;
            }
            void startMediaFallback(fieldKey);
          };

          recognition.onend = () => {
            if (recognitionRef.current === recognition) {
              recognitionRef.current = null;
              setActiveField(null);
              activeFieldRef.current = null;
              setInterimText('');
              setMode('idle');
            }
          };

          recognition.start();
          return;
        } catch {
          recognitionRef.current = null;
          activeFieldRef.current = null;
        }
      }

      await startMediaFallback(fieldKey);
    },
    [mode, startMediaFallback, stop]
  );

  return {
    activeField,
    interimText,
    mode,
    isListening: mode === 'listening',
    isTranscribing: mode === 'transcribing',
    toggleField,
    stop,
  };
}
