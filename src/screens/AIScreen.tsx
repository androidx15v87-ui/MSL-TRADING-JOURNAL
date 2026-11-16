import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  History,
  ImagePlus,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Send,
  Square,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  buildJournalContext,
  loadAIConversations,
  saveAIConversations,
  streamAIChat,
} from '../lib/aiClient';
import { generateId } from '../lib/calculations';
import { compressImageFile } from '../lib/db';
import type {
  AIChatAttachment,
  AIChatMessage,
  AIConversation,
  JournalState,
} from '../types/journal';

interface AIScreenProps {
  journalState: JournalState;
}

const STARTER_PROMPTS = [
  {
    title: 'Audit my trading edge',
    prompt: 'Analyze my recent trades, win rate, and expectancy. Where is my biggest leak right now?',
  },
  {
    title: 'Setup & session breakdown',
    prompt: 'Compare my performance across setups and trading sessions. Which combination should I focus on?',
  },
  {
    title: 'Playbook alignment check',
    prompt: 'Review my saved playbook and models against my actual trade history and notes.',
  },
  {
    title: 'Pre-session discipline plan',
    prompt: 'Build a concise pre-session execution checklist tailored to my strategy and risk rules.',
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

export const AIScreen: React.FC<AIScreenProps> = ({ journalState }) => {
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
  const [syncContext, setSyncContext] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeId) || conversations[0];
  }, [conversations, activeId]);

  useEffect(() => {
    if (!activeId && conversations[0]) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  useEffect(() => {
    saveAIConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConversation?.messages.length, isStreaming]);

  useEffect(() => {
    if (!isFullScreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullScreen]);

  const journalSnapshot = useMemo(
    () => (syncContext ? buildJournalContext(journalState) : undefined),
    [syncContext, journalState]
  );

  const handleNewChat = () => {
    if (isStreaming) return;
    const empty = createEmptyConversation();
    setConversations((prev) => [empty, ...prev]);
    setActiveId(empty.id);
    setHistoryOpen(false);
    setAttachments([]);
    setInput('');
  };

  const handleDeleteChat = (id: string) => {
    if (isStreaming && id === activeConversation?.id) {
      abortRef.current?.abort();
      setIsStreaming(false);
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

  const handleAttachImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    e.target.value = '';
    if (!fileList || fileList.length === 0) return;
    setAttachError(null);

    try {
      const files = Array.from(fileList).slice(0, 4);
      const processed = await Promise.all(files.map((f) => compressImageFile(f)));
      const mapped: AIChatAttachment[] = processed.map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: 'image/jpeg',
        dataUrl: item.dataUrl,
      }));
      setAttachments((prev) => [...prev, ...mapped].slice(0, 4));
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach image.');
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? input).trim();
    if ((!textToSend && attachments.length === 0) || isStreaming || !activeConversation) {
      return;
    }

    if (!isOnline) {
      setAttachError('MSL AI requires an internet connection. Your local journal works offline.');
      return;
    }

    setAttachError(null);
    const convId = activeConversation.id;

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
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAIChat({
        messages: updatedHistory,
        journalContext: journalSnapshot,
        signal: controller.signal,
        onDelta: (delta) => {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, text: m.text + delta } : m
                ),
                updatedAt: new Date().toISOString(),
              };
            })
          );
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Unable to reach MSL AI.';
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, text: m.text || msg, error: true }
                  : m
              ),
            };
          })
        );
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleCopy = async (msg: AIChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedId(msg.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const messages = activeConversation?.messages || [];

  return (
    <div
      className={
        isFullScreen
          ? 'fixed inset-0 z-50 flex flex-col gap-3 sm:gap-4 bg-[#080d18]/98 backdrop-blur-2xl p-3 sm:p-6 pt-safe pb-safe'
          : 'flex flex-col min-h-[460px] h-[calc(100dvh-10rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100dvh-8.25rem)] gap-4'
      }
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shrink-0">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
            Conversational intelligence
          </p>
          <h2 className="mt-0.5 font-display text-xl sm:text-2xl font-extrabold text-[#eef3fb]">
            MSL AI
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSyncContext((v) => !v)}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
              syncContext
                ? 'bg-[#47dca0]/15 border-[#47dca0]/45 text-[#8df0c0]'
                : 'glass-subcard text-[#9aa8be]'
            }`}
            title="Include your live trades, models, and playbook in AI context"
          >
            <span className="sm:hidden">
              {syncContext ? `Synced (${journalState.trades.length})` : 'Sync off'}
            </span>
            <span className="hidden sm:inline">
              {syncContext
                ? `Journal synced (${journalState.trades.length})`
                : 'Journal sync off'}
            </span>
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
                <span>Full screen</span>
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

      {/* Main Chat Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Desktop Thread Sidebar */}
        <aside className="hidden lg:flex lg:col-span-3 flex-col rounded-2xl glass-card p-3 overflow-hidden">
          <div className="px-2 pb-2.5 text-[11px] font-semibold tracking-wider text-[#7f8fa8] uppercase border-b border-white/[0.08]">
            Conversations
          </div>
          <div className="mt-2 flex-1 overflow-y-auto space-y-1">
            {conversations.map((conv) => {
              const active = conv.id === activeConversation?.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 transition ${
                    active
                      ? 'bg-white/[0.1] border border-white/[0.14]'
                      : 'hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => !isStreaming && setActiveId(conv.id)}
                    className="flex-1 min-w-0 text-left text-xs font-medium text-[#e1e9f5] truncate"
                  >
                    {conv.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(conv.id)}
                    aria-label="Delete conversation"
                    className="opacity-60 group-hover:opacity-100 h-7 w-7 flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#ff7d91]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat Stream & Composer */}
        <section className="lg:col-span-9 flex flex-col min-h-0 rounded-2xl glass-card overflow-hidden">
          {/* Offline Notice inside AI panel */}
          {!isOnline && (
            <div className="px-4 py-2.5 bg-[#f5cc79]/10 border-b border-[#f5cc79]/25 flex items-center gap-2 text-xs text-[#f5cc79]">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>You are offline. Reconnect to send new prompts to MSL AI.</span>
            </div>
          )}

          {/* Messages Viewport */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-4 space-y-6">
                <div className="space-y-2">
                  <div className="mx-auto h-12 w-12 rounded-2xl border border-white/15 bg-gradient-to-br from-[#1d3e42]/80 to-[#0d1d2d]/80 flex items-center justify-center text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                    <Bot className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-lg sm:text-xl font-bold text-[#eef3fb]">
                    Your intelligent trading partner
                  </h3>
                  <p className="text-xs sm:text-sm text-[#8b9ab0] leading-relaxed">
                    Ask anything about your journal performance, setup expectancy, chart screenshots, risk sizing, or trading psychology.
                  </p>
                </div>

                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="rounded-xl glass-subcard p-3.5 hover:border-[#47dca0]/40 hover:bg-white/[0.06] transition"
                    >
                      <p className="text-xs font-bold text-[#8df0c0]">{item.title}</p>
                      <p className="mt-1 text-xs text-[#a9b7cc] line-clamp-2">{item.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 ${
                        isUser
                          ? 'bg-[#47dca0]/14 border border-[#47dca0]/30 text-[#eef3fb]'
                          : msg.error
                          ? 'bg-[#ff7d91]/12 border border-[#ff7d91]/35 text-[#ffb4bf]'
                          : 'glass-subcard text-[#e1e9f5]'
                      }`}
                    >
                      {!isUser && (
                        <div className="flex items-center justify-between gap-4 pb-1.5 mb-1 border-b border-white/[0.07]">
                          <span className="text-[11px] font-bold tracking-wide text-[#8df0c0] uppercase">
                            MSL AI
                          </span>
                          {msg.text && !isStreaming && (
                            <button
                              type="button"
                              onClick={() => handleCopy(msg)}
                              className="inline-flex items-center gap-1 text-[11px] text-[#8b9ab0] hover:text-[#eef3fb]"
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
                      )}

                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mb-2.5 flex flex-wrap gap-2">
                          {msg.attachments.map((att) => (
                            <img
                              key={att.id}
                              src={att.dataUrl}
                              alt={att.name}
                              referrerPolicy="no-referrer"
                              className="h-24 w-36 rounded-xl object-cover border border-white/[0.15]"
                            />
                          ))}
                        </div>
                      )}

                      {isUser ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      ) : msg.text ? (
                        <MarkdownRenderer content={msg.text} />
                      ) : (
                        <span className="inline-block text-xs text-[#8b9ab0]">
                          Analyzing your journal and thinking…
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={scrollEndRef} />
          </div>

          {/* Composer Area */}
          <div className="border-t border-white/[0.08] p-3 sm:p-4 space-y-2.5 bg-[#090f1d]/60">
            {attachError && (
              <p className="text-xs text-[#ff7d91] px-1">{attachError}</p>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative h-14 w-20 rounded-xl overflow-hidden border border-white/[0.15]"
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== att.id))
                      }
                      aria-label={`Remove ${att.name}`}
                      className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-md bg-black/75 text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <label
                title="Attach chart screenshot"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subcard text-[#9aa8be] hover:text-[#8df0c0] cursor-pointer transition shrink-0"
              >
                <ImagePlus className="w-5 h-5" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAttachImages}
                  className="sr-only"
                />
              </label>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask MSL AI about your trades, strategy, chart, or risk…"
                className="flex-1 min-h-[44px] max-h-36 rounded-xl bg-[#080d18]/80 border border-white/[0.12] px-3.5 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#667790] focus:border-[#47dca0] focus:outline-none resize-none"
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
                  onClick={() => handleSend()}
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
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#8b9ab0]"
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
