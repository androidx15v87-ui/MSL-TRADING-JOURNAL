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

export interface UseVoiceDictationOptions {
  onFinalText: (fieldKey: string, text: string) => void;
  onError: (message: string) => void;
}

export function useVoiceDictation({ onFinalText, onError }: UseVoiceDictationOptions) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [interimText, setInterimText] = useState('');
  const [mode, setMode] = useState<'idle' | 'listening' | 'transcribing'>('idle');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeFieldRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const onFinalTextRef = useRef(onFinalText);
  const onErrorRef = useRef(onError);
  onFinalTextRef.current = onFinalText;
  onErrorRef.current = onError;

  const cleanupMedia = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const stop = useCallback((cancel = false) => {
    cancelledRef.current = cancel;

    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        if (cancel) {
          rec.abort();
        } else {
          rec.stop();
        }
      } catch {
        // Ignore already-stopped errors
      }
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
  }, [cleanupMedia]);

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

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        audioChunksRef.current = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        mediaRecorderRef.current = recorder;
        cancelledRef.current = false;
        activeFieldRef.current = fieldKey;
        setActiveField(fieldKey);
        setInterimText('Recording audio… tap mic again to transcribe');
        setMode('listening');

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const targetField = activeFieldRef.current;
          const recordedMime = recorder.mimeType || 'audio/webm';
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
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone permission denied. Allow mic access to dictate notes.'
            : 'Unable to access microphone.';
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

      const SpeechRec = getSpeechRecognitionCtor();
      if (SpeechRec) {
        try {
          const recognition = new SpeechRec();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = navigator.language || 'en-US';

          cancelledRef.current = false;
          recognitionRef.current = recognition;
          activeFieldRef.current = fieldKey;
          setActiveField(fieldKey);
          setInterimText('');
          setMode('listening');

          recognition.onresult = (event) => {
            if (cancelledRef.current) return;
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

            recognitionRef.current = null;
            setActiveField(null);
            activeFieldRef.current = null;
            setInterimText('');
            setMode('idle');

            if (code === 'not-allowed' || code === 'service-not-allowed') {
              onErrorRef.current(
                'Microphone permission blocked. Allow mic access to use voice-to-text.'
              );
            } else if (code === 'network' || code === 'audio-capture') {
              // Fall back seamlessly to MediaRecorder + server transcription
              void startMediaFallback(fieldKey);
            } else {
              onErrorRef.current(`Voice input stopped (${code}).`);
            }
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
