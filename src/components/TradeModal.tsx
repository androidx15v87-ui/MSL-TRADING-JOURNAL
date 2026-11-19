import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronDown, ImagePlus, Loader2, Mic, Plus, Square, Tag, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { localDateTime } from '../lib/calculations';
import { compressImageFile } from '../lib/db';
import type {
  CustomField,
  CustomFieldValue,
  Direction,
  SessionType,
  SetupType,
  Trade,
  TradeOutcome,
  TradeScreenshot,
  TradingModel,
} from '../types/journal';

interface TradeModalProps {
  open: boolean;
  trade: Trade | null;
  draftTemplate?: Trade | null;
  initialDate?: string;
  defaultMarket?: string;
  models: TradingModel[];
  fields: CustomField[];
  existingTags?: string[];
  hasActiveAlarms?: boolean;
  snoozedAlarmName?: string | null;
  onClose: () => void;
  onSave: (trade: Trade) => Promise<void> | void;
  onNotifyError: (msg: string) => void;
}

const PRESET_TAGS = [
  'Patient',
  'High-Conviction',
  'A+ Setup',
  'Clean Execution',
  'FOMO',
  'Early Exit',
  'Revenge',
  'News Volatility',
];

function appendSpokenText(existing: string, spoken: string): string {
  const clean = spoken.trim();
  if (!clean) return existing;
  if (!existing.trim()) return clean;
  const needsSpace = !/\s$/.test(existing);
  return `${existing}${needsSpace ? ' ' : ''}${clean}`;
}

function normalizeTagLabel(raw: string): string {
  return raw.replace(/^#+/, '').trim().replace(/\s+/g, ' ');
}

export const TradeModal: React.FC<TradeModalProps> = ({
  open,
  trade,
  draftTemplate,
  initialDate,
  defaultMarket,
  models,
  fields,
  existingTags = [],
  hasActiveAlarms = false,
  snoozedAlarmName = null,
  onClose,
  onSave,
  onNotifyError,
}) => {
  const [date, setDate] = useState('');
  const [pair, setPair] = useState('');
  const [direction, setDirection] = useState<Direction>('Long');
  const [setup, setSetup] = useState<SetupType>('Reversal');
  const [session, setSession] = useState<SessionType>('London');
  const [result, setResult] = useState<TradeOutcome>('BE');
  const [r, setR] = useState('0');
  const [risk, setRisk] = useState('1');
  const [model, setModel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [custom, setCustom] = useState<Record<string, CustomFieldValue>>({});
  const [images, setImages] = useState<TradeScreenshot[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const [saving, setSaving] = useState(false);

  // Collapsible Position Size & Risk Calculator
  const [sizerOpen, setSizerOpen] = useState(false);
  const [accountBalance, setAccountBalance] = useState('10000');
  const [riskPct, setRiskPct] = useState('1');
  const [stopDistance, setStopDistance] = useState('20');
  const [valuePerUnit, setValuePerUnit] = useState('10');

  const addTagsFromString = useCallback((raw: string) => {
    const parts = raw
      .split(/[,;\n]+/)
      .map(normalizeTagLabel)
      .filter(Boolean);
    if (parts.length === 0) return;

    setTags((prev) => {
      const existingLower = new Set(prev.map((t) => t.toLowerCase()));
      const additions: string[] = [];
      for (const part of parts) {
        if (!existingLower.has(part.toLowerCase())) {
          existingLower.add(part.toLowerCase());
          additions.push(part);
        }
      }
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  const handleVoiceText = useCallback(
    (fieldKey: string, transcript: string) => {
      if (fieldKey === 'notes') {
        setNotes((prev) => appendSpokenText(prev, transcript));
        return;
      }

      if (fieldKey === 'model') {
        setModel((prev) => appendSpokenText(prev, transcript));
        return;
      }

      if (fieldKey === 'tags') {
        addTagsFromString(transcript);
      }
    },
    [addTagsFromString]
  );

  const {
    activeField,
    interimText,
    isListening,
    isTranscribing,
    elapsedSeconds,
    audioBands,
    toggleField,
    stop: stopDictation,
    cancel: cancelDictation,
  } = useVoiceDictation({
    onFinalText: handleVoiceText,
    onError: onNotifyError,
  });

  useEffect(() => {
    if (!open) {
      stopDictation(true);
      return;
    }
    const source = trade || draftTemplate;
    if (trade) {
      setDate(trade.date.slice(0, 16));
      setPair(trade.pair);
      setDirection(trade.direction);
      setSetup(trade.setup);
      setSession(trade.session);
      setResult(trade.result);
      setR(String(trade.r ?? 0));
      setRisk(String(trade.risk ?? 1));
      setModel(trade.model || '');
      setTags(Array.isArray(trade.tags) ? [...trade.tags] : []);
      setTagInput('');
      setNotes(trade.notes || '');
      setCustom(trade.custom ? { ...trade.custom } : {});
      setImages(trade.images ? [...trade.images] : []);
    } else if (source) {
      const now = new Date();
      setDate(localDateTime(now));
      setPair(source.pair);
      setDirection(source.direction);
      setSetup(source.setup);
      setSession(source.session);
      setResult(source.result);
      setR(String(source.r ?? 2));
      setRisk(String(source.risk ?? 1));
      setModel(source.model || '');
      setTags(Array.isArray(source.tags) ? [...source.tags] : []);
      setTagInput('');
      setNotes(source.notes || '');
      setCustom(source.custom ? { ...source.custom } : {});
      setImages([]);
    } else {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setDate(initialDate ? `${initialDate}T${hh}:${mm}` : localDateTime(now));
      setPair('');
      setDirection('Long');
      setSetup('Reversal');
      setSession('London');
      setResult('Win');
      setR('2');
      setRisk('1');
      setModel('');
      setTags([]);
      setTagInput('');
      setNotes('');
      setCustom({});
      setImages([]);
    }
  }, [open, trade, draftTemplate, initialDate, stopDictation]);

  const suggestedTags = useMemo(() => {
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const label of [...existingTags, ...PRESET_TAGS]) {
      const clean = normalizeTagLabel(label);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(clean);
      }
    }
    return combined;
  }, [existingTags]);

  const sizerCalculations = useMemo(() => {
    const bal = Math.max(0, Number(accountBalance || 0));
    const pct = Math.max(0, Number(riskPct || 0));
    const stop = Math.max(0, Number(stopDistance || 0));
    const unitVal = Math.max(0, Number(valuePerUnit || 0));
    const dollarRisk = (bal * pct) / 100;
    const positionSize = stop > 0 && unitVal > 0 ? dollarRisk / (stop * unitVal) : 0;
    return {
      dollarRisk,
      positionSize,
    };
  }, [accountBalance, riskPct, stopDistance, valuePerUnit]);

  if (!open) return null;

  const toggleTag = (label: string) => {
    const clean = normalizeTagLabel(label);
    if (!clean) return;
    setTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === clean.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== clean.toLowerCase());
      }
      return [...prev, clean];
    });
  };

  const handleAddTagInput = () => {
    if (!tagInput.trim()) return;
    addTagsFromString(tagInput);
    setTagInput('');
  };

  const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setProcessingImages(true);
    try {
      const files = Array.from(fileList);
      const compressed = await Promise.all(files.map((file) => compressImageFile(file)));
      setImages((prev) => [...prev, ...compressed]);
    } catch (err) {
      onNotifyError(err instanceof Error ? err.message : 'Failed to attach image.');
    } finally {
      setProcessingImages(false);
      e.target.value = '';
    }
  };

  const handleOutcomeChange = (next: TradeOutcome) => {
    setResult(next);
    const currentR = Number(r);
    if (next === 'BE') {
      setR('0');
    } else if (next === 'Loss' && currentR > 0) {
      setR(String(-Math.abs(currentR)));
    } else if (next === 'Win' && currentR < 0) {
      setR(String(Math.abs(currentR)));
    }
  };

  const updateCustomText = (fieldId: string, val: string) => {
    setCustom((prev) => ({ ...prev, [fieldId]: val }));
  };

  const updateCustomBoth = (fieldId: string, part: 'text' | 'number', val: string) => {
    setCustom((prev) => {
      const existing = prev[fieldId];
      const obj =
        typeof existing === 'object' && existing !== null
          ? { ...existing }
          : { text: typeof existing === 'string' ? existing : '', number: '' };
      obj[part] = val;
      return { ...prev, [fieldId]: obj };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    stopDictation(false);
    const cleanedPair = pair.trim().toUpperCase();
    if (!cleanedPair) {
      onNotifyError('Please enter a symbol or pair.');
      return;
    }

    const pendingTypedTags = tagInput
      .split(/[,;\n]+/)
      .map(normalizeTagLabel)
      .filter(Boolean);
    const finalTags = Array.from(
      new Set([...tags, ...pendingTypedTags].map(normalizeTagLabel).filter(Boolean))
    );

    setSaving(true);
    try {
      const payload: Trade = {
        id: trade?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        date: date || localDateTime(),
        pair: cleanedPair,
        direction,
        setup,
        session,
        result,
        r: Number(r || 0),
        risk: Number(risk || 0),
        model: model.trim(),
        tags: finalTags,
        notes: notes.trim(),
        custom,
        images,
        createdAt: trade?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const renderMicButton = (fieldKey: string, label: string, compact = false) => {
    const isThisField = activeField === fieldKey;
    const busyOther = isTranscribing && !isThisField;
    return (
      <button
        type="button"
        onClick={() => void toggleField(fieldKey)}
        disabled={busyOther}
        aria-label={isThisField && isListening ? `Stop voice input for ${label}` : `Speak ${label}`}
        title={isThisField && isListening ? 'Stop dictation' : `Speak ${label}`}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border transition shrink-0 whitespace-nowrap ${
          compact ? 'min-h-[44px] min-w-[44px]' : 'min-h-[36px] px-3 py-1.5 text-xs font-semibold'
        } ${
          isThisField && isTranscribing
            ? 'bg-[#8ebeff]/15 border-[#8ebeff]/45 text-[#8ebeff]'
            : isThisField && isListening
            ? 'bg-[#ff7d91]/18 border-[#ff7d91]/50 text-[#ff7d91]'
            : 'glass-subcard text-[#8df0c0] hover:border-[#47dca0]/55 hover:bg-white/[0.08]'
        } disabled:opacity-45`}
      >
        {isThisField && isTranscribing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {!compact && <span>Transcribing…</span>}
          </>
        ) : isThisField && isListening ? (
          <>
            <Square className="w-3.5 h-3.5 fill-current" />
            {!compact && <span>Stop voice</span>}
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" />
            {!compact && <span>Voice to text</span>}
          </>
        )}
      </button>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-md sm:p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-modal-heading"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-2xl glass-modal overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] shrink-0">
          <div>
            <p className="text-xs font-semibold text-[#8df0c0]">
              Execution record
            </p>
            <h2 id="trade-modal-heading" className="text-lg font-bold text-[#eef3fb]">
              {trade ? 'Edit trade' : 'Log a trade'}
            </h2>
            {(snoozedAlarmName || hasActiveAlarms) && (
              <p className="mt-0.5 text-[11px] text-[#8b9ab0]">
                {snoozedAlarmName
                  ? `${snoozedAlarmName} auto-snoozed (+5m) · focus protected`
                  : 'Session alerts silenced while logging'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trade form"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:bg-white/[0.08] hover:text-[#eef3fb] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {activeField && (
            <div className="rounded-xl bg-[#47dca0]/10 border border-[#47dca0]/35 px-3.5 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div aria-hidden="true" className="flex items-center gap-[2px] h-5 shrink-0">
                  {audioBands.slice(0, 10).map((level, idx) => (
                    <span
                      key={idx}
                      className="w-[2.5px] h-5 rounded-full bg-[#47dca0] origin-center transition-transform duration-75"
                      style={{ transform: `scaleY(${Math.max(0.18, level)})` }}
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#8df0c0] tabular-nums">
                    {isTranscribing
                      ? 'Transcribing speech…'
                      : isListening
                      ? `Recording ${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
                      : 'Preparing microphone…'}
                  </p>
                  <p className="mt-0.5 text-xs text-[#dce6f5] truncate">
                    {interimText || 'Speak clearly into your microphone…'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => cancelDictation()}
                  className="min-h-[36px] rounded-lg px-2.5 text-xs font-medium text-[#9fb0c7] hover:text-[#eef3fb] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => stopDictation(false)}
                  className="min-h-[36px] rounded-lg bg-[#47dca0] px-3 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Date & time</span>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] font-mono tabular-nums"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Symbol / pair</span>
              <input
                type="text"
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                placeholder={defaultMarket ? `e.g. ${defaultMarket}` : 'EURUSD, XAUUSD, BTCUSDT'}
                required
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] uppercase placeholder:normal-case placeholder:text-[#5b6b84]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Direction</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
              >
                <option value="Long">Long</option>
                <option value="Short">Short</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Setup type</span>
              <select
                value={setup}
                onChange={(e) => setSetup(e.target.value as SetupType)}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
              >
                <option value="Reversal">Reversal</option>
                <option value="Continuation">Continuation</option>
                <option value="Breakout">Breakout</option>
                <option value="Other">Other</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Session</span>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value as SessionType)}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
              >
                <option value="London">London</option>
                <option value="New York">New York</option>
                <option value="Asia">Asia</option>
                <option value="Overlap">Overlap</option>
                <option value="Other">Other</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Outcome</span>
              <select
                value={result}
                onChange={(e) => handleOutcomeChange(e.target.value as TradeOutcome)}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
              >
                <option value="Win">Win</option>
                <option value="Loss">Loss</option>
                <option value="BE">BE</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">R multiple</span>
              <input
                type="number"
                step="0.01"
                value={r}
                onChange={(e) => setR(e.target.value)}
                required
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] font-mono tabular-nums"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#a9b7cc]">Risk (R)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] font-mono tabular-nums"
              />
            </label>
          </div>

          {/* Collapsible Position Size & Risk Calculator */}
          <div className="rounded-xl glass-subcard overflow-hidden">
            <button
              type="button"
              onClick={() => setSizerOpen((v) => !v)}
              aria-expanded={sizerOpen}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition"
            >
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#c9d4e7]">
                <Calculator className="w-4 h-4 text-[#8ebeff]" />
                <span>Position size & risk calculator</span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[#8b9ab0] transition-transform ${
                  sizerOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {sizerOpen && (
              <div className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.07] space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[#8b9ab0]">Balance ($)</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={accountBalance}
                      onChange={(e) => setAccountBalance(e.target.value)}
                      className="w-full min-h-[38px] rounded-lg glass-input px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef3fb]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[#8b9ab0]">Risk (%)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={riskPct}
                      onChange={(e) => setRiskPct(e.target.value)}
                      className="w-full min-h-[38px] rounded-lg glass-input px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef3fb]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[#8b9ab0]">Stop (pips/pts)</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={stopDistance}
                      onChange={(e) => setStopDistance(e.target.value)}
                      className="w-full min-h-[38px] rounded-lg glass-input px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef3fb]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[#8b9ab0]">$/unit per pip</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={valuePerUnit}
                      onChange={(e) => setValuePerUnit(e.target.value)}
                      className="w-full min-h-[38px] rounded-lg glass-input px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef3fb]"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9aa8be]">
                  <span className="tabular-nums">
                    Dollar risk:{' '}
                    <strong className="font-mono text-[#eef3fb]">
                      ${sizerCalculations.dollarRisk.toFixed(2)}
                    </strong>
                  </span>
                  <span className="tabular-nums">
                    Suggested size:{' '}
                    <strong className="font-mono text-[#47dca0]">
                      {sizerCalculations.positionSize.toFixed(2)} lots / units
                    </strong>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Setup / Model Description with Voice-to-Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="trade-model-input" className="text-xs font-medium text-[#a9b7cc]">
                Setup / model description
              </label>
              {renderMicButton('model', 'setup description')}
            </div>
            <input
              id="trade-model-input"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. London liquidity sweep reversal"
              className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] placeholder:text-[#5b6b84]"
            />
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.name)}
                    className={`min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                      model === m.name
                        ? 'bg-[#47dca0]/15 border-[#47dca0]/50 text-[#8df0c0]'
                        : 'glass-subcard text-[#9aa8be] hover:text-[#eef3fb]'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Execution & Psychology Tags */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="trade-tag-input" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#a9b7cc]">
                <Tag className="w-3.5 h-3.5 text-[#8df0c0]" />
                <span>Labels & psychology tags</span>
              </label>
              {renderMicButton('tags', 'trade tags')}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="trade-tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    handleAddTagInput();
                  }
                }}
                placeholder="Add label (e.g. FOMO, Patient, High-Conviction)…"
                className="flex-1 min-w-0 min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] placeholder:text-[#5b6b84]"
              />
              <button
                type="button"
                onClick={handleAddTagInput}
                disabled={!tagInput.trim()}
                className="min-h-[44px] inline-flex items-center gap-1 rounded-xl glass-subcard px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/50 disabled:opacity-40 transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-[#47dca0]" />
                <span>Add</span>
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tg) => (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => toggleTag(tg)}
                    aria-label={`Remove tag ${tg}`}
                    className="min-h-[32px] inline-flex items-center gap-1.5 rounded-lg bg-[#47dca0]/15 border border-[#47dca0]/45 px-2.5 py-1 text-xs font-semibold text-[#8df0c0] hover:bg-[#ff7d91]/15 hover:border-[#ff7d91]/45 hover:text-[#ffb4bf] transition"
                  >
                    <span>#{tg}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {suggestedTags.map((preset) => {
                const selected = tags.some((t) => t.toLowerCase() === preset.toLowerCase());
                if (selected) return null;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => toggleTag(preset)}
                    className="min-h-[30px] rounded-lg glass-subcard px-2.5 py-1 text-[11px] font-medium text-[#9aa8be] hover:text-[#eef3fb] hover:border-white/20 transition"
                  >
                    + {preset}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic Custom Properties */}
          {fields.length > 0 && (
            <div className="pt-2 border-t border-white/[0.08] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {fields.map((f) => {
                  const val = custom[f.id];
                  const strVal = typeof val === 'string' ? val : '';
                  const objVal =
                    typeof val === 'object' && val !== null
                      ? val
                      : { text: strVal, number: '' };

                  return (
                    <div key={f.id} className={f.type === 'both' ? 'sm:col-span-2' : ''}>
                      <div className="space-y-1.5">
                        <span className="block text-xs font-medium text-[#a9b7cc]">
                          {f.name}
                          {f.required ? ' *' : ''}
                        </span>

                        {f.options.length > 0 ? (
                          <select
                            value={strVal}
                            onChange={(e) => updateCustomText(f.id, e.target.value)}
                            required={f.required}
                            className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb]"
                          >
                            <option value="">Choose…</option>
                            {f.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                            {strVal && !f.options.includes(strVal) && (
                              <option value={strVal}>{strVal}</option>
                            )}
                          </select>
                        ) : f.type === 'both' ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              value={objVal.text || ''}
                              onChange={(e) => updateCustomBoth(f.id, 'text', e.target.value)}
                              placeholder={f.hint || 'Text value'}
                              required={f.required}
                              className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] placeholder:text-[#5b6b84]"
                            />
                            <input
                              type="number"
                              step="any"
                              value={objVal.number || ''}
                              onChange={(e) => updateCustomBoth(f.id, 'number', e.target.value)}
                              placeholder="Numeric value"
                              className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] font-mono tabular-nums placeholder:text-[#5b6b84]"
                            />
                          </div>
                        ) : (
                          <input
                            type={f.type === 'number' ? 'number' : 'text'}
                            step={f.type === 'number' ? 'any' : undefined}
                            value={strVal}
                            onChange={(e) => updateCustomText(f.id, e.target.value)}
                            placeholder={f.hint || 'Enter value'}
                            required={f.required}
                            className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] placeholder:text-[#5b6b84]"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Multiple Gallery Screenshots (no capture attr so camera is not forced open) */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-xs font-medium text-[#a9b7cc]">
                  Trade screenshots ({images.length})
                </span>
                <span className="block text-[11px] text-[#7586a0]">
                  Select one or multiple chart images from your gallery. Camera is never forced open.
                </span>
              </div>
              <label className="min-h-[40px] inline-flex items-center gap-2 rounded-xl glass-subcard px-3.5 py-2 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/50 cursor-pointer transition shrink-0">
                <ImagePlus className="w-4 h-4 text-[#47dca0]" />
                <span>{processingImages ? 'Adding…' : 'Add images'}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleGallerySelect}
                  className="sr-only"
                />
              </label>
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative group rounded-xl overflow-hidden border border-white/[0.12] bg-[#070c17] aspect-video"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name || 'Trade chart screenshot'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                      aria-label={`Remove ${img.name}`}
                      className="absolute top-1.5 right-1.5 h-8 w-8 flex items-center justify-center rounded-lg bg-[#080d18]/85 border border-white/20 text-[#ff7d91] hover:bg-[#192338] transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Execution Notes with Voice-to-Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="trade-notes-input" className="text-xs font-medium text-[#a9b7cc]">
                Execution notes
              </label>
              {renderMicButton('notes', 'execution notes')}
            </div>
            <textarea
              id="trade-notes-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Speak or type: Why this setup? What confirmed it? What did you learn?"
              className="w-full rounded-xl glass-input px-3 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#5b6b84] resize-y"
            />
          </div>

          <div className="pt-2 pb-safe flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-white/[0.12] bg-white/[0.06] px-5 py-2 text-sm font-semibold text-[#eef3fb] hover:bg-white/[0.1] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || processingImages}
              className="min-h-[44px] rounded-xl bg-[#47dca0] px-6 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-60 transition"
            >
              {saving ? 'Saving…' : 'Save trade'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};
