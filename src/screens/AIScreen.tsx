import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Code,
  Copy,
  History,
  ImagePlus,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Mic,
  Minimize2,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
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
  loadVoiceRate,
  prewarmAIConnection,
  saveAIConversations,
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
  AIMemoryCategory,
  AIMemoryItem,
  JournalState,
} from '../types/journal';

interface AIScreenProps {
  journalState: JournalState;
  memories?: AIMemoryItem[];
  isActive?: boolean;
  onBack?: () => void;
  onAddMemory?: (content: string, category: AIMemoryCategory) => Promise<void> | void;
  onDeleteMemory?: (id: string) => Promise<void> | void;
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
    title: 'Total PnL & edge audit',
    prompt: 'Break down my Total PnL, Total Profits, Total Losses, win rate, and expectancy. Where is my biggest edge or leak?',
  },
  {
    title: 'Log a trade via AI',
    prompt: 'Log a +2.5R Long Win on XAUUSD during London session using Reversal setup with tag A+ Setup.',
  },
  {
    title: 'First-principles market brief',
    prompt: 'Explain how central bank liquidity, yield spreads, and dollar flows drive gold and major FX pairs from first principles.',
  },
  {
    title: 'App & playbook control',
    prompt: 'Open Analytics for me, and suggest one high-impact refinement to my Playbook entry filters.',
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
  isAnyStreaming: boolean;
  streamStatus: string | null;
  aiMode: 'fast' | 'deep';
  copiedId: string | null;
  voiceState: 'idle' | 'loading' | 'speaking';
  activeSpeechMsgId: string | null;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (val: string) => void;
  onStartEdit: (msgId: string, currentText: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (msgId: string) => void;
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
    isAnyStreaming,
    streamStatus,
    aiMode,
    copiedId,
    voiceState,
    activeSpeechMsgId,
    isEditing,
    editDraft,
    onEditDraftChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
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

    if (isUser) {
      return (
        <div className="perf-row flex flex-col items-end gap-1.5 group">
          <div className="max-w-[92%] sm:max-w-[78%] rounded-2xl liquid-glass px-4 py-3 text-[#eef3fb] w-auto">
            {validAttachments.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {validAttachments.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => onOpenImage({ src: att.dataUrl, name: att.name })}
                    className="group/img relative h-24 w-36 rounded-xl overflow-hidden border border-white/[0.15] hover:border-[#47dca0]/60 transition"
                    aria-label={`View ${att.name}`}
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover group-hover/img:scale-[1.03] transition-transform duration-150"
                    />
                  </button>
                ))}
              </div>
            )}

            {isEditing ? (
              <div className="space-y-2.5 min-w-[250px] sm:min-w-[360px]">
                <textarea
                  rows={4}
                  value={editDraft}
                  onChange={(e) => onEditDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? editDraft.length;
                      const end = el.selectionEnd ?? editDraft.length;
                      const selected = editDraft.slice(start, end) || 'code';
                      const multiline = selected.includes('\n');
                      const wrapped = multiline ? `\`\`\`\n${selected}\n\`\`\`` : `\`${selected}\``;
                      const pad = multiline ? 4 : 1;
                      const updated = `${editDraft.slice(0, start)}${wrapped}${editDraft.slice(end)}`;
                      onEditDraftChange(updated);
                      window.requestAnimationFrame(() => {
                        el.focus();
                        el.setSelectionRange(start + pad, start + pad + selected.length);
                      });
                    } else if (!e.shiftKey && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (editDraft.trim() && !isAnyStreaming) onSaveEdit(msg.id);
                    }
                  }}
                  autoFocus
                  placeholder="Edit your query… (Shift+Enter for new paragraph)"
                  className="w-full rounded-xl glass-input px-3 py-2.5 text-sm text-[#eef3fb] leading-relaxed resize-y focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#7f8fa8]">Shift+Enter · new paragraph</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onCancelEdit}
                      className="min-h-[34px] rounded-lg glass-subcard px-3 py-1 text-xs font-semibold text-[#9aa8be] hover:text-[#eef3fb] transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveEdit(msg.id)}
                      disabled={!editDraft.trim() || isAnyStreaming}
                      className="min-h-[34px] inline-flex items-center gap-1.5 rounded-lg bg-[#47dca0] px-3.5 py-1 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-45 transition"
                    >
                      <Send className="w-3 h-3" />
                      <span>Save &amp; Resend</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {msg.viaVoice && (
                  <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#8df0c0]/85">
                    <Mic className="w-3 h-3" />
                    <span>Voice</span>
                  </div>
                )}
                <MarkdownRenderer content={displayText} />
              </div>
            )}
          </div>

          {!isEditing && !isAnyStreaming && (
            <div className="flex items-center gap-1.5 pr-1 opacity-85 hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => onStartEdit(msg.id, displayText)}
                className="min-h-[30px] inline-flex items-center gap-1.5 rounded-lg glass-subcard px-2.5 py-1 text-[11px] font-semibold text-[#b8c6db] hover:text-[#8df0c0] hover:border-[#47dca0]/40 transition"
                aria-label="Edit and resend query"
              >
                <Pencil className="w-3 h-3 text-[#8df0c0]" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => onCopy(msg.id, displayText)}
                className="min-h-[30px] inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06] transition"
                aria-label="Copy message"
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
            </div>
          )}
        </div>
      );
    }

    // Grok-style open, airy editorial response directly on the canvas
    return (
      <div className="perf-row flex justify-start">
        <div
          className={`w-full rounded-2xl transition-colors ${
            msg.error
              ? 'bg-[#ff7d91]/10 border border-[#ff7d91]/35 px-4 py-3.5 text-[#ffb4bf]'
              : 'px-1 sm:px-2 py-1 text-[#e4ecf8]'
          }`}
        >
          <div className="flex items-center justify-between gap-4 pb-2 mb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-md bg-[#47dca0]/15 border border-[#47dca0]/35 flex items-center justify-center text-[#8df0c0]">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-[#eef3fb]">KAIROS</span>
              {isSpeechForThis && (
                <span className="text-[11px] font-medium text-[#8df0c0]">
                  · UK Voice
                </span>
              )}
            </div>

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

          {displayActions && displayActions.length > 0 && (
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

          {displayText ? (
            <div>
              <MarkdownRenderer content={displayText} />
              {isStreamingThis && (
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#8df0c0]/85">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Streaming response…</span>
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
                      ? 'Deep reasoning across markets & journal…'
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

interface ChatMessageListProps {
  messages: AIChatMessage[];
  activeConvId?: string;
  liveStream: LiveStreamState | null;
  isStreaming: boolean;
  streamStatus: string | null;
  aiMode: 'fast' | 'deep';
  copiedId: string | null;
  voiceState: 'idle' | 'loading' | 'speaking';
  activeSpeechMsgId: string | null;
  editingMsgId: string | null;
  editDraft: string;
  onEditDraftChange: (val: string) => void;
  onStartEdit: (msgId: string, currentText: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (msgId: string) => void;
  onCopy: (msgId: string, text: string) => void;
  onRetry: (msgId: string) => void;
  onSpeakToggle: (msgId: string, text: string) => void;
  onOpenImage: (att: { src: string; name: string }) => void;
}

const ChatMessageList = memo<ChatMessageListProps>(
  ({
    messages,
    activeConvId,
    liveStream,
    isStreaming,
    streamStatus,
    aiMode,
    copiedId,
    voiceState,
    activeSpeechMsgId,
    editingMsgId,
    editDraft,
    onEditDraftChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onCopy,
    onRetry,
    onSpeakToggle,
    onOpenImage,
  }) => (
    <>
      {messages.map((msg) => {
        const isStreamingThis = Boolean(
          isStreaming &&
            liveStream &&
            liveStream.convId === activeConvId &&
            liveStream.msgId === msg.id
        );
        const displayText = isStreamingThis ? liveStream!.text : msg.text;
        const displayActions = isStreamingThis ? liveStream!.actions : msg.actions;

        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            displayText={displayText}
            displayActions={displayActions}
            isStreamingThis={isStreamingThis}
            isAnyStreaming={isStreaming}
            streamStatus={isStreamingThis ? streamStatus : null}
            aiMode={aiMode}
            copiedId={copiedId}
            voiceState={voiceState}
            activeSpeechMsgId={activeSpeechMsgId}
            isEditing={editingMsgId === msg.id}
            editDraft={editingMsgId === msg.id ? editDraft : ''}
            onEditDraftChange={onEditDraftChange}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onCopy={onCopy}
            onRetry={onRetry}
            onSpeakToggle={onSpeakToggle}
            onOpenImage={onOpenImage}
          />
        );
      })}
    </>
  )
);

ChatMessageList.displayName = 'ChatMessageList';

export const AIScreen: React.FC<AIScreenProps> = memo(({
  journalState,
  memories = [],
  isActive = true,
  onBack,
  onAddMemory,
  onDeleteMemory,
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
  const [aiMode, setAiMode] = useState<'fast' | 'deep'>('fast');

  // Memory drawer state
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState<AIMemoryCategory>('preference');

  // Inline Edit User Message state
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [liveStream, setLiveStream] = useState<LiveStreamState | null>(null);

  const [voiceState, setVoiceState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const [activeSpeechMsgId, setActiveSpeechMsgId] = useState<string | null>(null);

  const [isFullScreen, setIsFullScreen] = useState(true);
  const [threadsDrawerOpen, setThreadsDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);

  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      setIsFullScreen(true);
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  const isTouchDevice = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const voiceEngineRef = useRef<StreamingVoiceEngine | null>(null);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const activeFieldRef = useRef<string | null>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const streamTextRef = useRef('');
  const streamActionsRef = useRef<AIAppActionResult[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const executeActionsRef = useRef(onExecuteAIActions);
  executeActionsRef.current = onExecuteAIActions;

  const handleVoiceFinalText = useCallback((_fieldKey: string, transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;
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
    activeField,
    interimText,
    isListening,
    isTranscribing,
    elapsedSeconds,
    audioBands,
    toggleField,
    stop: stopVoice,
    cancel: cancelVoice,
  } = useVoiceDictation({
    onFinalText: handleVoiceFinalText,
    onError: handleVoiceError,
  });
  activeFieldRef.current = activeField;

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeId) || conversations[0];
  }, [conversations, activeId]);
  const activeConversationRef = useRef(activeConversation);
  activeConversationRef.current = activeConversation;

  const messages = activeConversation?.messages || [];

  useEffect(() => {
    if (!activeId && conversations[0]) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

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
    engine.setSpeechRate(loadVoiceRate());
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

  useEffect(() => {
    prewarmAIConnection();
  }, []);

  // rAF-throttled direct scrollTop auto-scroll so token streaming never triggers smooth-scroll reflow lag
  useEffect(() => {
    if (!isActive || scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const viewport = messagesViewportRef.current;
      if (!viewport) return;
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom < 180 || !isStreaming) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [isActive, messages.length, liveStream?.text, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const immersiveActive = isActive && isFullScreen;

  useEffect(() => {
    if (!immersiveActive && !lightboxImage && !threadsDrawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    if (immersiveActive || lightboxImage) {
      document.body.style.overflow = 'hidden';
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxImage) {
          setLightboxImage(null);
        } else if (threadsDrawerOpen) {
          setThreadsDrawerOpen(false);
        } else if (immersiveActive) {
          setIsFullScreen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (immersiveActive || lightboxImage) {
        document.body.style.overflow = prevOverflow;
      }
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [immersiveActive, lightboxImage, threadsDrawerOpen]);

  const journalSnapshot = useMemo(
    () => (isActive && syncContext ? buildJournalContext(journalState, memories) : undefined),
    [isActive, syncContext, journalState, memories]
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

  const applyCodeFormat = useCallback(() => {
    const el = textareaRef.current;
    const start = el ? (el.selectionStart ?? input.length) : input.length;
    const end = el ? (el.selectionEnd ?? input.length) : input.length;
    const selected = input.slice(start, end);
    const inner = selected || 'code';
    const isMultiline = inner.includes('\n');
    const wrapped = isMultiline ? `\`\`\`\n${inner}\n\`\`\`` : `\`${inner}\``;
    const pad = isMultiline ? 4 : 1;

    const nextVal = `${input.slice(0, start)}${wrapped}${input.slice(end)}`;
    setInput(nextVal);
    if (el) {
      window.requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + pad, start + pad + inner.length);
      });
    }
  }, [input]);

  const handleNewChat = () => {
    if (isStreaming) return;
    stopVoice(true);
    stopVoicePlayback();
    setEditingMsgId(null);
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
      stopVoice(true);
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
      if (isListening) {
        stopVoice(true);
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
    [activeSpeechMsgId, isListening, stopVoice, stopVoicePlayback, voiceState]
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
    ) => {
      if (activeFieldRef.current) {
        stopVoice(true);
      }
      setIsStreaming(true);
      setStreamStatus('Thinking…');
      streamTextRef.current = '';
      streamActionsRef.current = [];
      setLiveStream({ convId, msgId: assistantMsgId, text: '', actions: [] });

      const controller = new AbortController();
      abortRef.current = controller;

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
          speakSync: false,
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
          },
        });

        const committedText = finalText || streamTextRef.current;
        cancelRaf();
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
          const msg = err instanceof Error ? err.message : 'Unable to reach KAIROS.';
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
    [aiMode, commitFinalStreamMessage, journalSnapshot, stopVoice]
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      if (isListening) {
        stopVoice(false);
      }

      const conv = activeConversationRef.current;
      const textToSend = (overrideText ?? input).trim();
      if ((!textToSend && attachments.length === 0) || isStreamingRef.current || !conv) {
        return;
      }

      if (!isOnline) {
        setAttachError('KAIROS requires an internet connection. Your local journal works offline.');
        return;
      }

      stopVoicePlayback();
      setAttachError(null);
      setEditingMsgId(null);
      const convId = conv.id;

      const userMsg: AIChatMessage = {
        id: generateId(),
        role: 'user',
        text: textToSend || 'Analyze the attached chart screenshot.',
        attachments: attachments.length > 0 ? [...attachments] : undefined,
        createdAt: new Date().toISOString(),
      };

      const assistantMsgId = generateId();
      const assistantPlaceholder: AIChatMessage = {
        id: assistantMsgId,
        role: 'model',
        text: '',
        createdAt: new Date().toISOString(),
      };

      const updatedHistory = [...conv.messages, userMsg];
      const nextTitle =
        conv.messages.length === 0
          ? userMsg.text.slice(0, 44) + (userMsg.text.length > 44 ? '…' : '')
          : conv.title;

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

      await runStreamForHistory(convId, updatedHistory, assistantMsgId);
    },
    [attachments, input, isListening, isOnline, runStreamForHistory, stopVoice, stopVoicePlayback]
  );

  const handleRetryMessage = useCallback(
    async (targetMsgId: string) => {
      if (isStreaming) return;
      const conv =
        conversationsRef.current.find((c) => c.id === activeId) || conversationsRef.current[0];
      if (!conv) return;

      if (!isOnline) {
        setAttachError('KAIROS requires an internet connection. Reconnect and tap Retry.');
        return;
      }

      setAttachError(null);
      const idx = conv.messages.findIndex((m) => m.id === targetMsgId);
      if (idx <= 0) return;

      const historyBeforeTarget = conv.messages.slice(0, idx);
      stopVoicePlayback();

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

      await runStreamForHistory(conv.id, historyBeforeTarget, freshAssistantId);
    },
    [activeId, isOnline, isStreaming, runStreamForHistory, stopVoicePlayback]
  );

  const handleStartEdit = useCallback((msgId: string, currentText: string) => {
    if (isStreamingRef.current) return;
    setEditingMsgId(msgId);
    setEditDraft(currentText);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMsgId(null);
    setEditDraft('');
  }, []);

  const handleSaveEdit = useCallback(
    async (targetUserMsgId: string) => {
      const trimmed = editDraft.trim();
      if (!trimmed || isStreamingRef.current) return;
      if (!isOnline) {
        setAttachError('KAIROS requires an internet connection. Reconnect and try again.');
        return;
      }

      const conv =
        conversationsRef.current.find((c) => c.id === activeId) || conversationsRef.current[0];
      if (!conv) return;

      const idx = conv.messages.findIndex((m) => m.id === targetUserMsgId);
      if (idx < 0) return;

      stopVoicePlayback();
      setAttachError(null);
      setEditingMsgId(null);
      setEditDraft('');

      const editedUserMsg: AIChatMessage = {
        ...conv.messages[idx],
        text: trimmed,
      };
      const updatedHistory = [...conv.messages.slice(0, idx), editedUserMsg];
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
                messages: [...updatedHistory, freshPlaceholder],
                updatedAt: new Date().toISOString(),
              }
            : c
        )
      );

      await runStreamForHistory(conv.id, updatedHistory, freshAssistantId);
    },
    [activeId, editDraft, isOnline, runStreamForHistory, stopVoicePlayback]
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
        immersiveActive
          ? 'fixed inset-0 z-50 w-screen h-dvh flex flex-col bg-[#040812]/94 backdrop-blur-3xl saturate-150 pt-safe pb-safe overflow-hidden'
          : 'flex flex-col min-h-[480px] h-[calc(100dvh-10rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100dvh-8.25rem)] gap-3.5'
      }
    >
      {/* Ultra-Immersive Full-Screen Ambient Glassmorphism Field */}
      {immersiveActive && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-48 left-1/2 -translate-x-1/2 h-[540px] w-[960px] rounded-full bg-[radial-gradient(circle,rgba(71,220,160,0.16)_0%,rgba(142,190,255,0.08)_46%,transparent_72%)] blur-3xl" />
          <div className="absolute -bottom-56 left-1/2 -translate-x-1/2 h-[480px] w-[840px] rounded-full bg-[radial-gradient(circle,rgba(142,190,255,0.12)_0%,rgba(71,220,160,0.04)_50%,transparent_74%)] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        </div>
      )}

      {/* Sleek Frosted Floating Top Header */}
      <header
        className={
          immersiveActive
            ? 'relative z-20 shrink-0 px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 border-b border-white/[0.08] bg-[#060b16]/65 backdrop-blur-2xl'
            : 'flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shrink-0'
        }
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {immersiveActive && onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to workspace"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-xs font-semibold text-[#dce6f5] hover:text-[#8df0c0] hover:border-[#47dca0]/45 transition shrink-0 whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {immersiveActive && (
            <button
              type="button"
              onClick={() => setThreadsDrawerOpen((v) => !v)}
              aria-label={threadsDrawerOpen ? 'Hide threads drawer' : 'Show threads drawer'}
              title="Threads"
              className={`hidden lg:inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition shrink-0 whitespace-nowrap ${
                threadsDrawerOpen
                  ? 'bg-white/[0.12] border-white/25 text-[#8df0c0]'
                  : 'bg-white/[0.05] border-white/[0.1] text-[#b8c6db] hover:text-[#eef3fb]'
              }`}
            >
              <PanelLeft className="w-4 h-4" />
              <span>Threads</span>
              <span className="tabular-nums text-[11px] text-[#7f8fa8]">{conversations.length}</span>
            </button>
          )}

          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className={`shrink-0 rounded-xl flex items-center justify-center border border-[#47dca0]/40 bg-gradient-to-br from-[#47dca0]/20 via-[#8ebeff]/12 to-transparent text-[#8df0c0] ${
                immersiveActive
                  ? 'h-9 w-9 sm:h-10 sm:w-10 shadow-[0_0_20px_rgba(71,220,160,0.18)]'
                  : 'h-8 w-8'
              }`}
            >
              <Bot className={immersiveActive ? 'w-5 h-5' : 'w-4 h-4'} />
            </div>
            <div className="min-w-0">
              <h2
                className={`font-display font-black tracking-[0.06em] uppercase whitespace-nowrap shrink-0 bg-gradient-to-r from-[#ffffff] via-[#eef3fb] to-[#8df0c0] bg-clip-text text-transparent ${
                  immersiveActive ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
                }`}
              >
                KAIROS
              </h2>
              <p className="text-[11px] sm:text-xs text-[#8b9ab0] tabular-nums truncate">
                {aiMode === 'fast' ? 'Fast thinking' : 'Deep thinking'} ·{' '}
                {syncContext ? `${journalState.trades.length} trades synced` : 'Context off'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSyncContext((v) => !v)}
            className={`hidden md:inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
              syncContext
                ? 'bg-[#47dca0]/14 border-[#47dca0]/40 text-[#8df0c0]'
                : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
            }`}
            title="Include your live trades, Total PnL, models, alarms, and playbook"
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
            aria-label={immersiveActive ? 'Dock to workspace view' : 'Open KAIROS in full screen'}
            title={immersiveActive ? 'Dock inside workspace' : 'Ultra-immersive full screen'}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl glass-subcard px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-[#c9d4e7] hover:text-[#eef3fb] hover:border-white/25 transition whitespace-nowrap shrink-0"
          >
            {immersiveActive ? (
              <>
                <Minimize2 className="w-4 h-4 text-[#8df0c0]" />
                <span className="hidden sm:inline">Dock</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 text-[#8df0c0]" />
                <span className="hidden sm:inline">Full screen</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleNewChat}
            disabled={isStreaming}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Stage (Edge-to-edge open glass canvas in full-screen; crisp card when docked) */}
      <div
        className={
          immersiveActive
            ? 'relative flex-1 min-h-0 flex overflow-hidden'
            : 'flex-1 min-h-0 rounded-2xl glass-card overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08]'
        }
      >
        {/* Collapsible Thread Rail (Slide-over frosted glass drawer in Full-Screen, pinned left column when Docked) */}
        {(immersiveActive ? threadsDrawerOpen : true) && (
          <aside
            className={
              immersiveActive
                ? 'hidden lg:flex w-72 shrink-0 flex-col p-3.5 border-r border-white/[0.08] bg-[#060c18]/80 backdrop-blur-2xl z-10 overflow-hidden'
                : 'hidden lg:flex lg:col-span-3 flex-col p-3 overflow-hidden bg-white/[0.015]'
            }
          >
            <div className="px-2 pb-2.5 text-xs font-semibold text-[#8b9ab0] border-b border-white/[0.08] flex items-center justify-between">
              <span>Threads</span>
              <span className="tabular-nums text-[11px] text-[#6d7d96]">{conversations.length}</span>
            </div>
            <div className="mt-2 flex-1 overflow-y-auto overscroll-contain space-y-1">
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
        )}

        {/* Centered Editorial Chat Stream & Floating Glass Composer */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingImage(true);
          }}
          onDragLeave={() => setIsDraggingImage(false)}
          onDrop={handleDrop}
          className={`${
            immersiveActive ? 'flex-1 w-full' : 'lg:col-span-9'
          } flex flex-col min-h-0 overflow-hidden transition ${
            isDraggingImage ? 'ring-2 ring-inset ring-[#47dca0]/70 bg-[#47dca0]/[0.03]' : ''
          }`}
        >
          {!isOnline && (
            <div className="px-4 py-2.5 bg-[#f5cc79]/10 border-b border-[#f5cc79]/25 flex items-center justify-between gap-2 text-xs text-[#f5cc79]">
              <span className="inline-flex items-center gap-2">
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span>You are offline. Reconnect to send or retry KAIROS prompts.</span>
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

          {/* Centered Editorial Messages Viewport */}
          <div ref={messagesViewportRef} className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 lg:px-10 py-6">
            <div className={`${immersiveActive ? 'max-w-4xl' : 'max-w-3xl'} mx-auto w-full space-y-5`}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center max-w-2xl mx-auto py-10 sm:py-16 space-y-6">
                  <div className="space-y-3">
                    <div className="mx-auto h-14 w-14 rounded-2xl liquid-glass border border-[#47dca0]/35 flex items-center justify-center text-[#8df0c0] shadow-[0_0_24px_rgba(71,220,160,0.14)]">
                      <Bot className="w-7 h-7" />
                    </div>
                    <p className="font-display text-xs sm:text-sm font-extrabold tracking-[0.18em] uppercase text-[#8df0c0]">
                      KAIROS
                    </p>
                    <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eef3fb] [text-wrap:balance]">
                      Ask anything. Trade with precision.
                    </h3>
                    <p className="text-xs sm:text-sm text-[#8b9ab0] leading-relaxed">
                      First-principles market intelligence, chart vision, Total PnL audits, fast voice notes, and direct journal control.
                    </p>
                  </div>

                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                    {STARTER_PROMPTS.map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => void handleSend(item.prompt)}
                        className="rounded-xl glass-subcard p-3.5 hover:border-[#47dca0]/45 transition text-left"
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
                <ChatMessageList
                  messages={messages}
                  activeConvId={activeConversation?.id}
                  liveStream={liveStream}
                  isStreaming={isStreaming}
                  streamStatus={streamStatus}
                  aiMode={aiMode}
                  copiedId={copiedId}
                  voiceState={voiceState}
                  activeSpeechMsgId={activeSpeechMsgId}
                  editingMsgId={editingMsgId}
                  editDraft={editDraft}
                  onEditDraftChange={setEditDraft}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={handleCancelEdit}
                  onSaveEdit={handleSaveEdit}
                  onCopy={handleCopy}
                  onRetry={handleRetryMessage}
                  onSpeakToggle={handleSpeakToggle}
                  onOpenImage={handleOpenLightbox}
                />
              )}
              <div ref={scrollEndRef} />
            </div>
          </div>

          {/* Floating Liquid-Glass Composer Capsule */}
          <div className="px-4 sm:px-6 lg:px-10 pb-3 sm:pb-5 pt-1 shrink-0">
            <div className={`${immersiveActive ? 'max-w-4xl' : 'max-w-3xl'} mx-auto w-full space-y-2`}>
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
                <div className="rounded-2xl bg-[#47dca0]/[0.08] border border-[#47dca0]/35 px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div aria-hidden="true" className="flex items-center gap-[2.5px] h-6 shrink-0">
                      {audioBands.map((level, idx) => (
                        <span
                          key={idx}
                          className="w-[2.5px] h-6 rounded-full bg-[#47dca0] origin-center transition-transform duration-75"
                          style={{ transform: `scaleY(${Math.max(0.16, level)})` }}
                        />
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#8df0c0] tabular-nums">
                        {isTranscribing
                          ? 'Transcribing voice note…'
                          : `Listening · ${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`}
                      </p>
                      <p className="mt-0.5 text-xs text-[#dce6f5] truncate">
                        {interimText || 'Speak naturally — tap Done to insert into prompt'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => cancelVoice()}
                      disabled={isTranscribing}
                      className="min-h-[36px] rounded-xl px-2.5 text-xs font-medium text-[#9fb0c7] hover:text-[#eef3fb] disabled:opacity-40 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => stopVoice(false)}
                      disabled={isTranscribing}
                      className="min-h-[36px] inline-flex items-center gap-1 rounded-xl bg-[#47dca0] px-3 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Done</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl liquid-glass p-3 sm:p-3.5 space-y-2 focus-within:border-[#47dca0]/45">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-1 pt-0.5">
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

                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                      e.preventDefault();
                      applyCodeFormat();
                      return;
                    }
                    // Shift+Enter creates a new paragraph break; Enter sends on desktop
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? input.length;
                      const end = el.selectionEnd ?? input.length;
                      const prefix = input.slice(0, start);
                      const br = prefix.endsWith('\n') ? '\n' : '\n\n';
                      const nextVal = `${prefix}${br}${input.slice(end)}`;
                      setInput(nextVal);
                      window.requestAnimationFrame(() => {
                        el.focus();
                        const caret = start + br.length;
                        el.setSelectionRange(caret, caret);
                      });
                      return;
                    }
                    if (!isTouchDevice && e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Ask KAIROS anything… (Shift+Enter new paragraph, Ctrl/Cmd+E code)"
                  className="w-full min-h-[54px] max-h-44 bg-transparent px-2 py-1 text-sm text-[#eef3fb] placeholder:text-[#6e7e98] focus:outline-none resize-none leading-relaxed"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.07]">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
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
                      title="Attach chart screenshot"
                      aria-label="Add image"
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl glass-subcard text-[#9aa8be] hover:text-[#8df0c0] disabled:opacity-50 transition shrink-0"
                    >
                      {addingImage ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#47dca0]" />
                      ) : (
                        <ImagePlus className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void toggleField('ai-prompt')}
                      disabled={isTranscribing || isStreaming}
                      title={isListening ? 'Stop voice note' : 'Dictate voice note'}
                      aria-label={isListening ? 'Stop voice note' : 'Record voice note'}
                      className={`min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border transition shrink-0 ${
                        isListening
                          ? 'bg-[#ff7d91]/20 border-[#ff7d91]/55 text-[#ff7d91]'
                          : isTranscribing
                          ? 'bg-[#47dca0]/15 border-[#47dca0]/40 text-[#8df0c0]'
                          : 'glass-subcard text-[#9aa8be] hover:text-[#8df0c0]'
                      }`}
                    >
                      {isTranscribing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isListening ? (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={applyCodeFormat}
                      disabled={isStreaming}
                      title="Format code snippet or block (Ctrl/Cmd+E)"
                      aria-label="Format code"
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl glass-subcard px-2.5 text-xs font-medium text-[#9aa8be] hover:text-[#8df0c0] hover:border-[#47dca0]/40 disabled:opacity-50 transition whitespace-nowrap shrink-0"
                    >
                      <Code className="w-3.5 h-3.5 text-[#8df0c0]" />
                      <span className="hidden sm:inline">Code</span>
                    </button>

                    <span aria-hidden="true" className="hidden sm:block h-5 w-px bg-white/[0.1] mx-0.5" />

                    {/* Fast | Deep Thinking Switcher directly inside chat interface */}
                    <div
                      role="group"
                      aria-label="Thinking mode"
                      className="inline-flex items-center rounded-xl glass-subcard p-0.5 shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => setAiMode('fast')}
                        className={`min-h-[34px] inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap ${
                          aiMode === 'fast'
                            ? 'bg-[#47dca0] text-[#051612]'
                            : 'text-[#9aa8be] hover:text-[#eef3fb]'
                        }`}
                        title="Fast thinking · Instant low-latency replies & app control"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Fast</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiMode('deep')}
                        className={`min-h-[34px] inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap ${
                          aiMode === 'deep'
                            ? 'bg-[#8ebeff] text-[#051612]'
                            : 'text-[#9aa8be] hover:text-[#eef3fb]'
                        }`}
                        title="Deep thinking · Quantitative audit & multi-step reasoning"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Deep</span>
                      </button>
                    </div>

                    {/* Memory Icon directly inside chat interface */}
                    <button
                      type="button"
                      onClick={() => setMemoryOpen(true)}
                      aria-label="Open KAIROS Memory"
                      title="Manage persistent KAIROS memory"
                      className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                        memories.length > 0
                          ? 'glass-subcard text-[#eef3fb] border-[#47dca0]/40 hover:border-[#47dca0]/65'
                          : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
                      }`}
                    >
                      <Brain className="w-4 h-4 text-[#8df0c0]" />
                      <span className="hidden md:inline">Memory</span>
                      {memories.length > 0 && (
                        <span className="tabular-nums text-[11px] font-bold text-[#8df0c0]">
                          {memories.length}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5 ml-auto shrink-0">
                    <span className="hidden xl:inline text-[11px] text-[#6d7d96] whitespace-nowrap">
                      Shift+Enter · paragraph
                    </span>
                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        aria-label="Stop response"
                        className="min-h-[38px] min-w-[38px] px-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#ff7d91]/20 border border-[#ff7d91]/40 text-xs font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/30 transition whitespace-nowrap shrink-0"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={!input.trim() && attachments.length === 0}
                        aria-label="Send message"
                        className="min-h-[38px] min-w-[40px] px-4 flex items-center justify-center gap-1.5 rounded-xl bg-[#47dca0] text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-40 transition whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Send</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
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

      {/* Persistent Cross-Conversation Memory Modal */}
      {memoryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={() => setMemoryOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[82dvh] flex flex-col rounded-2xl glass-modal p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-[#8df0c0]" />
                <h3 className="font-display text-base font-bold text-[#eef3fb]">
                  KAIROS Memory
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMemoryOpen(false)}
                aria-label="Close memory panel"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#8b9ab0] leading-relaxed">
              KAIROS remembers these facts, rules, and preferences automatically across all chats. Say &ldquo;Remember…&rdquo; in chat or add one below.
            </p>

            {onAddMemory && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = newMemoryText.trim();
                  if (!clean) return;
                  void onAddMemory(clean, newMemoryCategory);
                  setNewMemoryText('');
                }}
                className="flex flex-col sm:flex-row gap-2"
              >
                <select
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value as AIMemoryCategory)}
                  aria-label="Memory category"
                  className="rounded-xl glass-input px-3 py-2 text-xs text-[#eef3fb] focus:outline-none"
                >
                  <option value="preference">Preference</option>
                  <option value="rule">Rule</option>
                  <option value="goal">Goal</option>
                  <option value="context">Context</option>
                </select>
                <input
                  type="text"
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  placeholder="Add something for KAIROS to remember…"
                  className="flex-1 rounded-xl glass-input px-3 py-2 text-xs text-[#eef3fb] placeholder:text-[#6d7d96] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newMemoryText.trim()}
                  className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded-xl bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-40 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              </form>
            )}

            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
              {memories.length === 0 ? (
                <div className="rounded-xl glass-subcard p-5 text-center text-xs text-[#7f8fa8]">
                  No memories saved yet. Ask KAIROS to remember your rules or preferences anytime.
                </div>
              ) : (
                memories.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-xl glass-subcard px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <span className="text-[11px] font-semibold capitalize text-[#8df0c0]">
                        {item.category}
                      </span>
                      <p className="text-xs text-[#e4ecf8] leading-relaxed">{item.content}</p>
                    </div>
                    {onDeleteMemory && (
                      <button
                        type="button"
                        onClick={() => void onDeleteMemory(item.id)}
                        aria-label="Delete memory"
                        className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-[#7f8fa8] hover:text-[#ff7d91] transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

AIScreen.displayName = 'AIScreen';
