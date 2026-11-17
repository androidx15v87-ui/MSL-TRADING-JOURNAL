import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  History,
  ImagePlus,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Mic,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import {
  StreamInterruptedError,
  StreamingVoiceEngine,
  buildJournalContext,
  extractSpeakableClauses,
  loadAIConversations,
  loadAIVoiceEnabled,
  saveAIConversations,
  saveAIVoiceEnabled,
  scheduleSaveAIConversations,
  streamAIChat,
} from '../lib/aiClient';
import { generateId } from '../lib/calculations';
import { compressImageFile } from '../lib/db';
import type {
  AIAppAction,
  AIAppActionResult,
  AIChatAttachment,
  AIChatMessage,
  AIConversation,
  JournalState,
} from '../types/journal';

interface AIScreenProps {
  journalState: JournalState;
  onExecuteAIActions?: (actions: AIAppAction[]) => Promise<AIAppActionResult[]> | AIAppActionResult[];
}

interface LiveStreamState {
  convId: string;
  msgId: string;
  text: string;
  actions: AIAppActionResult[];
}

const STARTER_PROMPTS = [
  {
    title: 'Audit my trading edge',
    prompt: 'Analyze my recent trades, win rate, and expectancy. Where is my biggest leak right now?',
  },
  {
    title: 'Log a trade via AI',
    prompt: 'Log a +2.5R Long Win on XAUUSD during London session using Reversal setup with tag A+ Setup.',
  },
  {
    title: 'Setup & session breakdown',
    prompt: 'Compare my performance across setups and trading sessions. Which combination should I focus on?',
  },
  {
    title: 'App & playbook control',
    prompt: 'Open Analytics for me, and suggest one improvement to my Playbook entry filters.',
  },
];

function createEmptyConversation(): AIConversation {
  return {
    id: generateId(),
    title: 'New conversation',
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

interface MessageBubbleProps {
  msg: AIChatMessage;
  displayText: string;
  displayActions?: AIAppActionResult[];
  isStreamingThis: boolean;
  streamStatus: string | null;
  aiMode: 'fast' | 'deep';
  copiedId: string | null;
  voiceState: 'idle' | 'loading' | 'speaking';
  activeSpeechMsgId: string | null;
  onCopy: (msgId: string, text: string) => void;
  onRetry: (msgId: string) => void;
  onSpeakToggle: (msgId: string, text: string) => void;
  onOpenImage: (att: { src: string; name: string }) => void;
}

const MessageBubble = memo<MessageBubbleProps>(
  ({
    msg,
    displayText,
    displayActions,
    isStreamingThis,
    streamStatus,
    aiMode,
    copiedId,
    voiceState,
    activeSpeechMsgId,
    onCopy,
    onRetry,
    onSpeakToggle,
    onOpenImage,
  }) => {
    const isUser = msg.role === 'user';
    const validAttachments = useMemo(
      () => (msg.attachments || []).filter((att) => Boolean(att.dataUrl)),
      [msg.attachments]
    );

    const isSpeechForThis = activeSpeechMsgId === msg.id && voiceState !== 'idle';
    const isLoadingSpeechForThis = activeSpeechMsgId === msg.id && voiceState === 'loading';
    const isSpeakingThis = activeSpeechMsgId === msg.id && voiceState === 'speaking';

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[94%] sm:max-w-[82%] rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-[#47dca0]/14 border border-[#47dca0]/30 text-[#eef3fb]'
              : msg.error
              ? 'bg-[#ff7d91]/10 border border-[#ff7d91]/35 text-[#ffb4bf]'
              : 'bg-white/[0.035] border border-white/[0.08] text-[#e1e9f5]'
          }`}
        >
          {!isUser && (
            <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-white/[0.07]">
              <span className="text-xs font-semibold text-[#8df0c0]">MSL AI</span>
              <div className="flex items-center gap-3">
                {!isStreamingThis && (
                  <button
                    type="button"
                    onClick={() => onRetry(msg.id)}
                    className={`inline-flex items-center gap-1 text-xs font-semibold transition ${
                      msg.error || msg.interrupted
                        ? 'text-[#eef3fb] hover:text-[#47dca0]'
                        : 'text-[#8b9ab0] hover:text-[#eef3fb]'
                    }`}
                    aria-label="Retry response"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}

                {displayText && !msg.error && !isStreamingThis && (
                  <button
                    type="button"
                    onClick={() => onSpeakToggle(msg.id, displayText)}
                    className={`inline-flex items-center gap-1 text-xs transition ${
                      isSpeechForThis
                        ? 'text-[#8df0c0] font-semibold'
                        : 'text-[#8b9ab0] hover:text-[#eef3fb]'
                    }`}
                    aria-label={isSpeechForThis ? 'Stop voice' : 'Speak response'}
                  >
                    {isLoadingSpeechForThis ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[#47dca0]" />
                        <span>Voice…</span>
                      </>
                    ) : isSpeakingThis ? (
                      <>
                        <Square className="w-3 h-3 fill-current text-[#8df0c0]" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3 h-3" />
                        <span>Speak</span>
                      </>
                    )}
                  </button>
                )}

                {displayText && !isStreamingThis && (
                  <button
                    type="button"
                    onClick={() => onCopy(msg.id, displayText)}
                    className="inline-flex items-center gap-1 text-xs text-[#8b9ab0] hover:text-[#eef3fb] transition"
                    aria-label="Copy response"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3 h-3 text-[#47dca0]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {validAttachments.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {validAttachments.map((att) => (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => onOpenImage({ src: att.dataUrl, name: att.name })}
                  className="group relative h-24 w-36 rounded-xl overflow-hidden border border-white/[0.15] hover:border-[#47dca0]/60 transition"
                  aria-label={`View ${att.name}`}
                >
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-150"
                  />
                </button>
              ))}
            </div>
          )}

          {!isUser && displayActions && displayActions.length > 0 && (
            <div className="mb-2.5 pb-2 border-b border-white/[0.07] space-y-1">
              {displayActions.map((act, idx) => (
                <div
                  key={`${act.name}-${idx}`}
                  className={`flex items-center gap-1.5 text-xs font-medium ${
                    act.ok ? 'text-[#8df0c0]' : 'text-[#ff7d91]'
                  }`}
                >
                  {act.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{act.label}</span>
                </div>
              ))}
            </div>
          )}

          {isUser ? (
            <div>
              {msg.viaVoice && (
                <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#8df0c0]/85">
                  <Mic className="w-3 h-3" />
                  <span>Voice note</span>
                </div>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
            </div>
          ) : displayText ? (
            <div>
              <MarkdownRenderer content={displayText} />
              {isStreamingThis && (
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#8df0c0]/85">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Streaming live…</span>
                </div>
              )}
              {!isStreamingThis && (msg.interrupted || msg.error) && (
                <div className="mt-2.5 pt-2 border-t border-[#ff7d91]/25 flex flex-wrap items-center justify-between gap-2 text-xs text-[#ffb4bf]">
                  <span>
                    {msg.interrupted
                      ? 'Connection interrupted mid-response.'
                      : 'Unable to complete response.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRetry(msg.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#ff7d91]/20 border border-[#ff7d91]/40 px-2.5 py-1 text-xs font-semibold text-[#eef3fb] hover:bg-[#ff7d91]/30 transition"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-[#9aa8be]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#47dca0]" />
              <span>
                {isStreamingThis
                  ? streamStatus ||
                    (aiMode === 'deep'
                      ? 'Analyzing edge & journal context…'
                      : 'Generating response…')
                  : 'Thinking…'}
              </span>
            </span>
          )}
        </div>
      </div>
    );
  }
);

MessageBubble.displayName = 'MessageBubble';

export const AIScreen: React.FC<AIScreenProps> = ({
  journalState,
  onExecuteAIActions,
}) => {
  const isOnline = useOnlineStatus();
  const [conversations, setConversations] = useState<AIConversation[]>(() => {
    const existing = loadAIConversations();
    return existing.length > 0 ? existing : [createEmptyConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const existing = loadAIConversations();
    return existing[0]?.id || '';
  });

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AIChatAttachment[]>([]);
  const [addingImage, setAddingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [syncContext, setSyncContext] = useState(true);
  const [aiVoiceEnabled, setAiVoiceEnabled] = useState<boolean>(() => loadAIVoiceEnabled());
  const [aiMode, setAiMode] = useState<'fast' | 'deep'>('fast');

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [liveStream, setLiveStream] = useState<LiveStreamState | null>(null);

  const [voiceState, setVoiceState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const [activeSpeechMsgId, setActiveSpeechMsgId] = useState<string | null>(null);

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const voiceEngineRef = useRef<StreamingVoiceEngine | null>(null);
  const aiVoiceEnabledRef = useRef(aiVoiceEnabled);
  aiVoiceEnabledRef.current = aiVoiceEnabled;
  const usedVoiceNoteRef = useRef(false);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const streamTextRef = useRef('');
  const streamActionsRef = useRef<AIAppActionResult[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const executeActionsRef = useRef(onExecuteAIActions);
  executeActionsRef.current = onExecuteAIActions;

  const handleVoiceFinalText = useCallback((_fieldKey: string, transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;
    usedVoiceNoteRef.current = true;
    setInput((prev) => {
      if (!prev.trim()) return clean;
      const needsSpace = !/\s$/.test(prev);
      return `${prev}${needsSpace ? ' ' : ''}${clean}`;
    });
  }, []);

  const handleVoiceError = useCallback((msg: string) => {
    setAttachError(msg);
  }, []);

  const {
    interimText,
    isListening,
    isTranscribing,
    toggleField,
    stop: stopVoice,
  } = useVoiceDictation({
    onFinalText: handleVoiceFinalText,
    onError: handleVoiceError,
  });

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeId) || conversations[0];
  }, [conversations, activeId]);

  const messages = activeConversation?.messages || [];

  useEffect(() => {
    if (!activeId && conversations[0]) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  // Debounced persistence so localStorage never blocks frames during chat updates
  useEffect(() => {
    scheduleSaveAIConversations(conversations, 350);
  }, [conversations]);

  useEffect(() => {
    const flush = () => saveAIConversations(conversationsRef.current);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  // Initialize gapless streaming UK voice engine once
  useEffect(() => {
    const engine = new StreamingVoiceEngine(({ loading, speaking }) => {
      if (speaking) {
        setVoiceState('speaking');
      } else if (loading) {
        setVoiceState('loading');
      } else {
        setVoiceState('idle');
        setActiveSpeechMsgId(null);
      }
    });
    voiceEngineRef.current = engine;
    return () => {
      engine.dispose();
      voiceEngineRef.current = null;
    };
  }, []);

  const stopVoicePlayback = useCallback(() => {
    voiceEngineRef.current?.stop();
    setVoiceState('idle');
    setActiveSpeechMsgId(null);
  }, []);

  const toggleAiVoice = useCallback(() => {
    setAiVoiceEnabled((prev) => {
      const next = !prev;
      aiVoiceEnabledRef.current = next;
      saveAIVoiceEnabled(next);
      if (!next) {
        stopVoicePlayback();
      } else {
        voiceEngineRef.current?.unlock();
      }
      return next;
    });
  }, [stopVoicePlayback]);

  // Smart auto-scroll: follow stream smoothly unless user scrolled up to read earlier messages
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 140 || !isStreaming) {
      scrollEndRef.current?.scrollIntoView({
        behavior: isStreaming ? 'auto' : 'smooth',
        block: 'end',
      });
    }
  }, [messages.length, liveStream?.text, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    if (!isFullScreen && !lightboxImage) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxImage) {
          setLightboxImage(null);
        } else if (isFullScreen) {
          setIsFullScreen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullScreen, lightboxImage]);

  const journalSnapshot = useMemo(
    () => (syncContext ? buildJournalContext(journalState) : undefined),
    [syncContext, journalState]
  );

  const processImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setAttachError(null);
    setAddingImage(true);

    try {
      const slice = files.slice(0, 4);
      const processed = await Promise.all(slice.map((f) => compressImageFile(f)));
      const mapped: AIChatAttachment[] = processed.map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: 'image/jpeg',
        dataUrl: item.dataUrl,
      }));
      setAttachments((prev) => [...prev, ...mapped].slice(0, 4));
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach image.');
    } finally {
      setAddingImage(false);
    }
  }, []);

  const handleAttachImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    const picked = fileList ? Array.from(fileList) : [];
    e.target.value = '';
    if (picked.length > 0) {
      await processImageFiles(picked);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);

    if (imageFiles.length > 0) {
      e.preventDefault();
      await processImageFiles(imageFiles);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingImage(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await processImageFiles(files);
    }
  };

  const handleNewChat = () => {
    if (isStreaming) return;
    stopVoicePlayback();
    usedVoiceNoteRef.current = false;
    const empty = createEmptyConversation();
    setConversations((prev) => [empty, ...prev]);
    setActiveId(empty.id);
    setHistoryOpen(false);
    setAttachments([]);
    setInput('');
    setAttachError(null);
  };

  const handleDeleteChat = (id: string) => {
    if (isStreaming && id === activeConversation?.id) {
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamStatus(null);
      setLiveStream(null);
    }
    if (id === activeConversation?.id) {
      stopVoicePlayback();
    }
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = createEmptyConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeConversation?.id) {
        setActiveId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleSpeakToggle = useCallback(
    (msgId: string, text: string) => {
      if (activeSpeechMsgId === msgId && voiceState !== 'idle') {
        stopVoicePlayback();
        return;
      }
      const engine = voiceEngineRef.current;
      if (!engine || !text.trim()) return;
      const session = engine.beginSession();
      setActiveSpeechMsgId(msgId);
      const { clauses } = extractSpeakableClauses(text, true, true);
      for (const clause of clauses) {
        engine.enqueueClause(clause, session);
      }
    },
    [activeSpeechMsgId, stopVoicePlayback, voiceState]
  );

  const commitFinalStreamMessage = useCallback(
    (
      convId: string,
      msgId: string,
      finalText: string,
      finalActions: AIAppActionResult[],
      flags?: { error?: boolean; interrupted?: boolean }
    ) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId
                ? {
                    ...m,
                    text: finalText,
                    actions: finalActions.length > 0 ? finalActions : m.actions,
                    error: flags?.error || false,
                    interrupted: flags?.interrupted || false,
                  }
                : m
            ),
            updatedAt: new Date().toISOString(),
          };
        })
      );
    },
    []
  );

  const runStreamForHistory = useCallback(
    async (
      convId: string,
      historyForRequest: AIChatMessage[],
      assistantMsgId: string,
      autoSpeak = false
    ) => {
      setIsStreaming(true);
      setStreamStatus('Connecting to stream…');
      streamTextRef.current = '';
      streamActionsRef.current = [];
      setLiveStream({ convId, msgId: assistantMsgId, text: '', actions: [] });

      const controller = new AbortController();
      abortRef.current = controller;

      // Start speech session immediately so first generated clause begins speaking in ~400ms
      let speechSession = 0;
      let speechClauseBuffer = '';
      let isFirstSpeechClause = true;
      if (autoSpeak && aiVoiceEnabledRef.current && voiceEngineRef.current) {
        speechSession = voiceEngineRef.current.beginSession();
        setActiveSpeechMsgId(assistantMsgId);
      }

      const scheduleRafFlush = () => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = window.requestAnimationFrame(() => {
          rafIdRef.current = null;
          setLiveStream({
            convId,
            msgId: assistantMsgId,
            text: streamTextRef.current,
            actions: [...streamActionsRef.current],
          });
        });
      };

      const cancelRaf = () => {
        if (rafIdRef.current !== null) {
          window.cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };

      try {
        const finalText = await streamAIChat({
          messages: historyForRequest,
          journalContext: journalSnapshot,
          mode: aiMode,
          signal: controller.signal,
          onStatus: (status) => {
            setStreamStatus(status);
          },
          onActions: async (actions) => {
            if (!executeActionsRef.current || actions.length === 0) return;
            const results = await executeActionsRef.current(actions);
            if (results.length > 0) {
              streamActionsRef.current = [...streamActionsRef.current, ...results];
              scheduleRafFlush();
            }
          },
          onDelta: (delta) => {
            streamTextRef.current += delta;
            setStreamStatus(null);
            scheduleRafFlush();

            if (
              autoSpeak &&
              speechSession > 0 &&
              aiVoiceEnabledRef.current &&
              voiceEngineRef.current
            ) {
              speechClauseBuffer += delta;
              const { clauses, remainder } = extractSpeakableClauses(
                speechClauseBuffer,
                isFirstSpeechClause,
                false
              );
              speechClauseBuffer = remainder;
              for (const clause of clauses) {
                voiceEngineRef.current.enqueueClause(clause, speechSession);
                isFirstSpeechClause = false;
              }
            }
          },
        });

        cancelRaf();
        const committedText = finalText || streamTextRef.current;

        // Flush any remaining trailing clause to the UK voice queue immediately
        if (
          autoSpeak &&
          speechSession > 0 &&
          aiVoiceEnabledRef.current &&
          voiceEngineRef.current &&
          speechClauseBuffer.trim()
        ) {
          const { clauses } = extractSpeakableClauses(
            speechClauseBuffer,
            isFirstSpeechClause,
            true
          );
          for (const clause of clauses) {
            voiceEngineRef.current.enqueueClause(clause, speechSession);
            isFirstSpeechClause = false;
          }
          speechClauseBuffer = '';
        }

        commitFinalStreamMessage(convId, assistantMsgId, committedText, streamActionsRef.current);
      } catch (err) {
        cancelRaf();
        const isAborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;

        if (isAborted) {
          const partial = streamTextRef.current.trim();
          commitFinalStreamMessage(
            convId,
            assistantMsgId,
            partial || 'Response stopped.',
            streamActionsRef.current,
            { interrupted: Boolean(partial) }
          );
        } else if (err instanceof StreamInterruptedError) {
          const partial = err.partialText || streamTextRef.current;
          commitFinalStreamMessage(convId, assistantMsgId, partial, streamActionsRef.current, {
            error: true,
            interrupted: true,
          });
          setAttachError(err.message);
        } else {
          const partial = streamTextRef.current.trim();
          const msg = err instanceof Error ? err.message : 'Unable to reach MSL AI.';
          commitFinalStreamMessage(
            convId,
            assistantMsgId,
            partial || msg,
            streamActionsRef.current,
            { error: true, interrupted: Boolean(partial) }
          );
        }
      } finally {
        cancelRaf();
        abortRef.current = null;
        setLiveStream(null);
        setIsStreaming(false);
        setStreamStatus(null);
      }
    },
    [aiMode, commitFinalStreamMessage, journalSnapshot]
  );

  const handleSend = async (overrideText?: string) => {
    if (isListening) {
      stopVoice(false);
    }

    const textToSend = (overrideText ?? input).trim();
    if ((!textToSend && attachments.length === 0) || isStreaming || !activeConversation) {
      return;
    }

    if (!isOnline) {
      setAttachError('MSL AI requires an internet connection. Your local journal works offline.');
      return;
    }

    const sentViaVoice = !overrideText && usedVoiceNoteRef.current;
    usedVoiceNoteRef.current = false;

    if (sentViaVoice && aiVoiceEnabledRef.current) {
      voiceEngineRef.current?.unlock();
    } else {
      stopVoicePlayback();
    }

    setAttachError(null);
    const convId = activeConversation.id;

    const userMsg: AIChatMessage = {
      id: generateId(),
      role: 'user',
      text: textToSend || 'Analyze the attached chart screenshot.',
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      createdAt: new Date().toISOString(),
      viaVoice: sentViaVoice || undefined,
    };

    const assistantMsgId = generateId();
    const assistantPlaceholder: AIChatMessage = {
      id: assistantMsgId,
      role: 'model',
      text: '',
      createdAt: new Date().toISOString(),
    };

    const updatedHistory = [...activeConversation.messages, userMsg];
    const nextTitle =
      activeConversation.messages.length === 0
        ? userMsg.text.slice(0, 44) + (userMsg.text.length > 44 ? '…' : '')
        : activeConversation.title;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              title: nextTitle,
              messages: [...updatedHistory, assistantPlaceholder],
              updatedAt: new Date().toISOString(),
            }
          : c
      )
    );

    if (!overrideText) setInput('');
    setAttachments([]);

    await runStreamForHistory(
      convId,
      updatedHistory,
      assistantMsgId,
      sentViaVoice && aiVoiceEnabledRef.current
    );
  };

  const handleRetryMessage = useCallback(
    async (targetMsgId: string) => {
      if (isStreaming) return;
      const conv = conversationsRef.current.find((c) => c.id === activeId) || conversationsRef.current[0];
      if (!conv) return;

      if (!isOnline) {
        setAttachError('MSL AI requires an internet connection. Reconnect and tap Retry.');
        return;
      }

      const idx = conv.messages.findIndex((m) => m.id === targetMsgId);
      if (idx <= 0) return;

      setAttachError(null);
      const historyBeforeTarget = conv.messages.slice(0, idx);
      const precedingUser = [...historyBeforeTarget].reverse().find((m) => m.role === 'user');
      const shouldAutoSpeak = Boolean(precedingUser?.viaVoice) && aiVoiceEnabledRef.current;
      if (shouldAutoSpeak) {
        voiceEngineRef.current?.unlock();
      } else {
        stopVoicePlayback();
      }

      const freshAssistantId = generateId();
      const freshPlaceholder: AIChatMessage = {
        id: freshAssistantId,
        role: 'model',
        text: '',
        createdAt: new Date().toISOString(),
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                messages: [...historyBeforeTarget, freshPlaceholder],
                updatedAt: new Date().toISOString(),
              }
            : c
        )
      );

      await runStreamForHistory(conv.id, historyBeforeTarget, freshAssistantId, shouldAutoSpeak);
    },
    [activeId, isOnline, isStreaming, runStreamForHistory, stopVoicePlayback]
  );

  const handleCopy = useCallback(async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msgId);
      window.setTimeout(() => setCopiedId((cur) => (cur === msgId ? null : cur)), 1800);
    } catch {
      // Ignore clipboard failures
    }
  }, []);

  const handleOpenLightbox = useCallback((att: { src: string; name: string }) => {
    setLightboxImage(att);
  }, []);

  const lastMessage = messages[messages.length - 1];
  const canQuickRetryLast =
    !isStreaming && Boolean(lastMessage && lastMessage.role === 'model');

  return (
    <div
      className={
        isFullScreen
          ? 'fixed inset-0 z-50 flex flex-col gap-3 sm:gap-4 bg-[#080d18]/98 backdrop-blur-2xl p-3 sm:p-6 pt-safe pb-safe'
          : 'flex flex-col min-h-[480px] h-[calc(100dvh-10rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100dvh-8.25rem)] gap-3.5'
      }
    >
      {/* Clean Single-Row Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#eef3fb]">
            MSL AI
          </h2>
          <p className="text-xs text-[#8b9ab0] tabular-nums truncate">
            {aiMode === 'fast' ? 'Fast response' : 'Deep audit'} ·{' '}
            {syncContext
              ? `${journalState.trades.length} trades synced`
              : 'Journal context off'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Speed / Depth Segmented Control */}
          <div
            role="group"
            aria-label="Response mode"
            className="inline-flex items-center rounded-xl glass-subcard p-0.5"
          >
            <button
              type="button"
              onClick={() => setAiMode('fast')}
              className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                aiMode === 'fast'
                  ? 'bg-[#47dca0] text-[#051612]'
                  : 'text-[#9aa8be] hover:text-[#eef3fb]'
              }`}
              title="Instant low-latency replies & app control"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Fast</span>
            </button>
            <button
              type="button"
              onClick={() => setAiMode('deep')}
              className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                aiMode === 'deep'
                  ? 'bg-[#8ebeff] text-[#051612]'
                  : 'text-[#9aa8be] hover:text-[#eef3fb]'
              }`}
              title="Deep multi-step quantitative audit & edge reasoning"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Deep</span>
            </button>
          </div>

          <button
            type="button"
            onClick={toggleAiVoice}
            aria-pressed={aiVoiceEnabled}
            className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
              aiVoiceEnabled
                ? 'bg-[#47dca0]/14 border-[#47dca0]/40 text-[#8df0c0]'
                : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
            }`}
            title={
              aiVoiceEnabled
                ? 'UK English AI voice active for voice notes (tap to turn off)'
                : 'AI voice replies muted (tap to turn on)'
            }
          >
            {aiVoiceEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{aiVoiceEnabled ? 'Voice on' : 'Voice off'}</span>
          </button>

          <button
            type="button"
            onClick={() => setSyncContext((v) => !v)}
            className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
              syncContext
                ? 'bg-[#47dca0]/14 border-[#47dca0]/40 text-[#8df0c0]'
                : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
            }`}
            title="Include your live trades, models, alarms, and playbook in AI context"
          >
            <span>{syncContext ? 'Context on' : 'Context off'}</span>
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl glass-subcard text-[#c9d4e7]"
            aria-label="Conversation history"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsFullScreen((v) => !v)}
            aria-label={isFullScreen ? 'Exit full screen' : 'Open MSL AI in full screen'}
            title={isFullScreen ? 'Exit full screen (Esc)' : 'Full screen'}
            className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
              isFullScreen
                ? 'bg-white/[0.12] border-white/25 text-[#eef3fb]'
                : 'glass-subcard text-[#c9d4e7] hover:text-[#eef3fb] hover:border-white/20'
            }`}
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="w-4 h-4 text-[#8df0c0]" />
                <span>Exit</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 text-[#8df0c0]" />
                <span className="hidden sm:inline">Expand</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleNewChat}
            disabled={isStreaming}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3.5 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span>New chat</span>
          </button>
        </div>
      </div>

      {/* Unified Single-Elevation Split-Pane Glass Workspace */}
      <div className="flex-1 min-h-0 rounded-2xl glass-card overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08]">
        {/* Desktop Thread Sidebar */}
        <aside className="hidden lg:flex lg:col-span-3 flex-col p-3 overflow-hidden bg-white/[0.015]">
          <div className="px-2 pb-2.5 text-xs font-semibold text-[#8b9ab0] border-b border-white/[0.08] flex items-center justify-between">
            <span>Threads</span>
            <span className="tabular-nums text-[11px] text-[#6d7d96]">{conversations.length}</span>
          </div>
          <div className="mt-2 flex-1 overflow-y-auto space-y-1">
            {conversations.map((conv) => {
              const active = conv.id === activeConversation?.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 transition ${
                    active
                      ? 'bg-white/[0.09] text-[#eef3fb]'
                      : 'hover:bg-white/[0.04] text-[#9aa8be]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => !isStreaming && setActiveId(conv.id)}
                    className="flex-1 min-w-0 text-left text-xs font-medium truncate"
                  >
                    {conv.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(conv.id)}
                    aria-label="Delete conversation"
                    className="opacity-50 group-hover:opacity-100 h-7 w-7 flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#ff7d91] transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat Stream & Composer */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingImage(true);
          }}
          onDragLeave={() => setIsDraggingImage(false)}
          onDrop={handleDrop}
          className={`lg:col-span-9 flex flex-col min-h-0 overflow-hidden transition ${
            isDraggingImage ? 'ring-2 ring-inset ring-[#47dca0]/70 bg-[#47dca0]/[0.03]' : ''
          }`}
        >
          {/* Offline Notice inside AI panel */}
          {!isOnline && (
            <div className="px-4 py-2.5 bg-[#f5cc79]/10 border-b border-[#f5cc79]/25 flex items-center justify-between gap-2 text-xs text-[#f5cc79]">
              <span className="inline-flex items-center gap-2">
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span>You are offline. Reconnect to send or retry MSL AI prompts.</span>
              </span>
              {canQuickRetryLast && lastMessage && (
                <button
                  type="button"
                  onClick={() => void handleRetryMessage(lastMessage.id)}
                  className="inline-flex items-center gap-1 font-semibold underline shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          {/* Messages Viewport */}
          <div
            ref={messagesViewportRef}
            className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-4 space-y-6">
                <div className="space-y-2.5">
                  <div className="mx-auto h-12 w-12 rounded-2xl border border-white/15 bg-gradient-to-br from-[#1d3e42]/80 to-[#0d1d2d]/80 flex items-center justify-center text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                    <Bot className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-lg sm:text-xl font-bold text-[#eef3fb] [text-wrap:balance]">
                    Trading intelligence & live app control
                  </h3>
                  <p className="text-xs sm:text-sm text-[#8b9ab0] leading-relaxed">
                    Attach chart screenshots, record a voice note for real-time UK voice replies, audit your expectancy, or command the app.
                  </p>
                </div>

                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => void handleSend(item.prompt)}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5 hover:border-[#47dca0]/45 hover:bg-white/[0.06] transition"
                    >
                      <p className="text-xs font-bold text-[#8df0c0]">{item.title}</p>
                      <p className="mt-1 text-xs text-[#a9b7cc] line-clamp-2 leading-relaxed">
                        {item.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isStreamingThis = Boolean(
                  isStreaming &&
                    liveStream &&
                    liveStream.convId === activeConversation?.id &&
                    liveStream.msgId === msg.id
                );
                const displayText = isStreamingThis ? liveStream!.text : msg.text;
                const displayActions = isStreamingThis
                  ? liveStream!.actions
                  : msg.actions;

                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    displayText={displayText}
                    displayActions={displayActions}
                    isStreamingThis={isStreamingThis}
                    streamStatus={isStreamingThis ? streamStatus : null}
                    aiMode={aiMode}
                    copiedId={copiedId}
                    voiceState={voiceState}
                    activeSpeechMsgId={activeSpeechMsgId}
                    onCopy={handleCopy}
                    onRetry={(id) => void handleRetryMessage(id)}
                    onSpeakToggle={handleSpeakToggle}
                    onOpenImage={handleOpenLightbox}
                  />
                );
              })
            )}
            <div ref={scrollEndRef} />
          </div>

          {/* Composer Area */}
          <div className="border-t border-white/[0.08] p-3 sm:p-4 space-y-2.5 bg-[#080e1b]/65">
            {attachError && (
              <div className="flex items-center justify-between gap-2 text-xs text-[#ff7d91] px-1">
                <span className="truncate">{attachError}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {canQuickRetryLast && lastMessage && (
                    <button
                      type="button"
                      onClick={() => void handleRetryMessage(lastMessage.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#ff7d91]/15 border border-[#ff7d91]/35 px-2 py-1 text-xs font-semibold text-[#eef3fb] hover:bg-[#ff7d91]/25 transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachError(null)}
                    aria-label="Dismiss error"
                    className="text-[#8b9ab0] hover:text-[#eef3fb]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {voiceState !== 'idle' && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#47dca0]/10 border border-[#47dca0]/30 px-3 py-2 text-xs text-[#8df0c0]">
                <span className="inline-flex items-center gap-2 truncate">
                  {voiceState === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {voiceState === 'loading'
                      ? 'Preparing UK AI voice…'
                      : 'Speaking UK AI voice…'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={stopVoicePlayback}
                  className="text-xs font-semibold text-[#eef3fb] hover:text-[#ff7d91] transition shrink-0"
                >
                  Stop voice
                </button>
              </div>
            )}

            {(isListening || isTranscribing || interimText) && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#47dca0]/10 border border-[#47dca0]/30 px-3 py-2 text-xs text-[#8df0c0]">
                <span className="truncate">
                  {isTranscribing
                    ? 'Transcribing voice note…'
                    : interimText ||
                      'Recording voice note — tap Done or the stop icon when finished'}
                </span>
                <button
                  type="button"
                  onClick={() => stopVoice(false)}
                  className="text-xs font-semibold underline shrink-0"
                >
                  Done
                </button>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative h-14 w-20 rounded-xl overflow-hidden border border-white/[0.15]"
                  >
                    <button
                      type="button"
                      onClick={() => setLightboxImage({ src: att.dataUrl, name: att.name })}
                      className="h-full w-full block"
                      aria-label={`Preview ${att.name}`}
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== att.id))
                      }
                      aria-label={`Remove ${att.name}`}
                      className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-md bg-black/80 text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleAttachImages}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={addingImage || isStreaming}
                title="Add chart screenshot (or paste / drop image)"
                aria-label="Add image"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subcard text-[#9aa8be] hover:text-[#8df0c0] disabled:opacity-50 transition shrink-0"
              >
                {addingImage ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#47dca0]" />
                ) : (
                  <ImagePlus className="w-5 h-5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void toggleField('ai-prompt')}
                disabled={isTranscribing || isStreaming}
                title={isListening ? 'Stop voice note' : 'Record voice note'}
                aria-label={isListening ? 'Stop voice note' : 'Record voice note'}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition shrink-0 ${
                  isListening
                    ? 'bg-[#ff7d91]/20 border-[#ff7d91]/55 text-[#ff7d91]'
                    : isTranscribing
                    ? 'bg-[#47dca0]/15 border-[#47dca0]/40 text-[#8df0c0]'
                    : 'glass-subcard text-[#9aa8be] hover:text-[#8df0c0]'
                }`}
              >
                {isTranscribing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isListening ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  const val = e.target.value;
                  setInput(val);
                  if (!val.trim()) {
                    usedVoiceNoteRef.current = false;
                  }
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Ask MSL AI, attach a chart, record voice note, or command the app…"
                className="flex-1 min-h-[44px] max-h-36 rounded-xl glass-input px-3.5 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#667790] focus:outline-none resize-none leading-snug"
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop response"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#ff7d91]/20 border border-[#ff7d91]/40 text-[#ff7d91] hover:bg-[#ff7d91]/30 transition shrink-0"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!input.trim() && attachments.length === 0}
                  aria-label="Send message"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#47dca0] text-[#051612] hover:bg-[#62e4b0] disabled:opacity-40 transition shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[85dvh] rounded-2xl glass-modal p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="Close image preview"
              className="absolute top-3 right-3 h-9 w-9 flex items-center justify-center rounded-xl bg-black/75 border border-white/20 text-white hover:bg-black transition"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.name}
              referrerPolicy="no-referrer"
              className="max-h-[80dvh] w-auto rounded-xl object-contain"
            />
          </div>
        </div>
      )}

      {/* Mobile History Sheet */}
      {historyOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-md"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="w-full max-h-[75dvh] flex flex-col rounded-t-3xl glass-modal p-5 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="font-display text-base font-bold text-[#eef3fb]">
                Past conversations
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto space-y-1.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${
                    conv.id === activeConversation?.id
                      ? 'bg-white/[0.1] border border-white/[0.14]'
                      : 'glass-subcard'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(conv.id);
                      setHistoryOpen(false);
                    }}
                    className="flex-1 min-w-0 text-left text-sm font-medium text-[#eef3fb] truncate"
                  >
                    {conv.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(conv.id)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-[#ff7d91]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
