import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  Edit3,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { generateId } from '../lib/calculations';
import type { ModelType, PageId, Playbook, TradingModel } from '../types/journal';

interface PlaybookScreenProps {
  playbook: Playbook;
  checks: Record<string, boolean>;
  models: TradingModel[];
  onSavePlaybook: (playbook: Playbook) => Promise<void> | void;
  onSaveChecks: (nextChecks: Record<string, boolean>) => void;
  onSaveModel: (model: TradingModel) => Promise<void> | void;
  onDeleteModel: (id: string) => Promise<void> | void;
  onNavigate?: (page: PageId) => void;
}

type PlaybookSectionKey = keyof Playbook;

interface SectionMeta {
  key: PlaybookSectionKey;
  title: string;
  shortLabel: string;
  subtitle: string;
  placeholder: string;
  starterLines: string[];
}

const MODEL_SECTIONS: Record<'rev' | 'cont' | 'core', SectionMeta> = {
  rev: {
    key: 'rev',
    title: 'Reversal model',
    shortLabel: 'Reversal',
    subtitle: 'Model 1 · Liquidity sweep + displacement counter-trend framework',
    placeholder: 'e.g. Clean sweep of key swing high/low followed by MSS',
    starterLines: [
      'Higher-timeframe liquidity draw identified (PDH/PDL, BSL/SSL)',
      'Clean sweep of key swing high or swing low',
      'Strong displacement candle with Market Structure Shift (MSS)',
      'Retracement into unmitigated FVG or Order Block',
    ],
  },
  cont: {
    key: 'cont',
    title: 'Continuation model',
    shortLabel: 'Continuation',
    subtitle: 'Model 2 · Trend alignment, pullback POI & continuation trigger',
    placeholder: 'e.g. Higher-timeframe trend aligned with clean FVG/OB pullback',
    starterLines: [
      'Higher-timeframe directional bias clearly aligned',
      'Break of structure confirming institutional order flow',
      'Pullback into premium/discount POI (FVG or Breaker)',
      'Lower-timeframe confirmation shift before entry',
    ],
  },
  core: {
    key: 'core',
    title: 'Core narrative',
    shortLabel: 'Core rules',
    subtitle: 'Foundational market sequence applied across every session',
    placeholder: 'e.g. Identify higher-timeframe liquidity draw before session open',
    starterLines: [
      'Map higher-timeframe liquidity & previous session highs/lows',
      'Wait for active session killzone expansion before acting',
      'Trade only documented A+ setups with clear invalidation',
    ],
  },
};

const ENTRY_SECTION: SectionMeta = {
  key: 'entry',
  title: 'Entry & execution criteria',
  shortLabel: 'Entry',
  subtitle: 'Pre-execution filters verified before clicking buy or sell',
  placeholder: 'e.g. Inside active killzone window with >= 2R target',
  starterLines: [
    'Inside active London or New York killzone window',
    'Clear target liquidity with >= 2R reward-to-risk',
    'No high-impact red-folder news within 15 minutes',
    'Calm emotional state — no chasing or revenge sizing',
  ],
};

const RISK_SECTION: SectionMeta = {
  key: 'risk',
  title: 'Invalidation & risk rules',
  shortLabel: 'Risk',
  subtitle: 'Stop placement, position sizing & capital preservation limits',
  placeholder: 'e.g. Hard stop beyond structural invalidation, max 1% risk',
  starterLines: [
    'Fixed risk <= 1% of account capital per setup',
    'Hard stop loss placed beyond structural swing invalidation',
    'Move stop to breakeven only at planned structural milestone',
    'Respect daily max drawdown limit without exception',
  ],
};

function stripLineFormatting(line: string): string {
  return line
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/^\s*\[[ xX]?\]\s*/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
}

function parseChecklistLines(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(/\r?\n/).map(stripLineFormatting).filter(Boolean);
}

function makeCheckId(scope: string, itemText: string, index: number): string {
  const slug = itemText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${scope}::${slug || 'item'}::${index}`;
}

function remapScopeChecks(
  prev: Record<string, boolean>,
  scope: string,
  oldLines: string[],
  nextLines: string[],
  indexMapping: (oldIdx: number) => number | null
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (!k.startsWith(`${scope}::`)) {
      next[k] = v;
    }
  }
  oldLines.forEach((oldText, oldIdx) => {
    if (!prev[makeCheckId(scope, oldText, oldIdx)]) return;
    const mappedIdx = indexMapping(oldIdx);
    if (mappedIdx !== null && nextLines[mappedIdx]) {
      next[makeCheckId(scope, nextLines[mappedIdx], mappedIdx)] = true;
    }
  });
  return next;
}

interface ChecklistRowProps {
  label: string;
  index: number;
  total: number;
  checked: boolean;
  manageMode: boolean;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (val: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

const ChecklistRow: React.FC<ChecklistRowProps> = ({
  label,
  index,
  total,
  checked,
  manageMode,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  onToggle,
}) => {
  if (isEditing) {
    return (
      <div className="min-h-[44px] flex items-center gap-1.5 rounded-xl border border-[#47dca0]/45 bg-[#47dca0]/[0.06] px-2.5 py-1.5">
        <input
          type="text"
          autoFocus
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSaveEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          aria-label="Edit rule"
          className="flex-1 min-h-[34px] bg-transparent px-1.5 text-sm text-[#eef3fb] placeholder:text-[#5c6d87] focus:outline-none"
        />
        <button
          type="button"
          onClick={onSaveEdit}
          aria-label="Save rule"
          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-[#47dca0] text-[#051612] hover:bg-[#62e4b0] transition shrink-0"
        >
          <Check className="w-4 h-4 stroke-[2.5]" />
        </button>
        <button
          type="button"
          onClick={onCancelEdit}
          aria-label="Cancel edit"
          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#9fb0c7] hover:text-[#eef3fb] hover:bg-white/[0.08] transition shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group min-h-[44px] flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors duration-150 ${
        checked ? 'bg-[#47dca0]/[0.09]' : 'hover:bg-white/[0.04]'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex-1 min-h-[32px] flex items-start gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-all duration-150 ${
            checked
              ? 'bg-[#47dca0] border-[#47dca0] text-[#051612]'
              : 'border-white/25 bg-black/25 text-transparent group-hover:border-[#47dca0]/55'
          }`}
        >
          <Check className="w-3.5 h-3.5 stroke-[3]" />
        </span>
        <span
          className={`flex-1 text-sm leading-relaxed transition-colors duration-150 ${
            checked ? 'text-[#7c8ca6] line-through decoration-white/25' : 'text-[#e8effa]'
          }`}
        >
          {label}
        </span>
      </button>

      {manageMode && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            title="Move rule up"
            aria-label={`Move rule up: ${label}`}
            className="min-h-[34px] min-w-[30px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.08] disabled:opacity-25 transition"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={onMoveDown}
            title="Move rule down"
            aria-label={`Move rule down: ${label}`}
            className="min-h-[34px] min-w-[30px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.08] disabled:opacity-25 transition"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onStartEdit}
            title="Edit rule"
            aria-label={`Edit rule: ${label}`}
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.08] transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete rule"
            aria-label={`Delete rule: ${label}`}
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#ff7f97] hover:bg-[#ff7f97]/10 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

interface EditingItemState {
  scope: string;
  index: number;
  value: string;
}

type ActiveModelTab = 'rev' | 'cont' | 'core' | 'all' | `custom:${string}`;

export const PlaybookScreen: React.FC<PlaybookScreenProps> = React.memo(
  ({ playbook, checks, models, onSavePlaybook, onSaveChecks, onSaveModel, onDeleteModel }) => {
    const [draft, setDraft] = useState<Playbook>(playbook);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<ActiveModelTab>('rev');

    // Clean per-area manage mode toggles (keeps Check mode uncluttered by default)
    const [manageModel, setManageModel] = useState(false);
    const [manageEntry, setManageEntry] = useState(false);
    const [manageRisk, setManageRisk] = useState(false);

    // Optional Bulk text edit toggles
    const [bulkSections, setBulkSections] = useState<Record<string, boolean>>({});
    const [newItemInputs, setNewItemInputs] = useState<Record<string, string>>({});
    const [customAddTarget, setCustomAddTarget] = useState<'entry' | 'risk'>('entry');
    const [editingItem, setEditingItem] = useState<EditingItemState | null>(null);

    // Custom Model Create/Edit Modal
    const [modelModalOpen, setModelModalOpen] = useState(false);
    const [modalModelId, setModalModelId] = useState<string | null>(null);
    const [modalModelName, setModalModelName] = useState('');
    const [modalModelType, setModalModelType] = useState<ModelType>('Reversal');
    const [modalModelEntry, setModalModelEntry] = useState('');
    const [modalModelRisk, setModalModelRisk] = useState('');
    const [confirmDeleteModel, setConfirmDeleteModel] = useState(false);

    useEffect(() => {
      setDraft(playbook);
    }, [playbook]);

    // Fallback to 'rev' if selected custom model was deleted
    const activeCustomModel = useMemo(() => {
      if (!activeTab.startsWith('custom:')) return null;
      const id = activeTab.slice('custom:'.length);
      return models.find((m) => m.id === id) || null;
    }, [activeTab, models]);

    useEffect(() => {
      if (activeTab.startsWith('custom:') && !activeCustomModel) {
        setActiveTab('rev');
      }
    }, [activeCustomModel, activeTab]);

    const handleToggleCheck = useCallback(
      (checkId: string) => {
        const next = { ...checks };
        if (next[checkId]) {
          delete next[checkId];
        } else {
          next[checkId] = true;
        }
        onSaveChecks(next);
      },
      [checks, onSaveChecks]
    );

    const handleResetScope = useCallback(
      (prefix: string) => {
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(checks)) {
          if (!k.startsWith(`${prefix}::`)) {
            next[k] = v;
          }
        }
        onSaveChecks(next);
      },
      [checks, onSaveChecks]
    );

    const handleResetActiveSetup = useCallback(() => {
      const prefixes = ['pb-entry::', 'pb-risk::'];
      if (activeTab === 'all') {
        prefixes.push('pb-rev::', 'pb-cont::', 'pb-core::');
        for (const m of models) {
          prefixes.push(`model-${m.id}-entry::`, `model-${m.id}-risk::`);
        }
      } else if (activeCustomModel) {
        prefixes.push(`model-${activeCustomModel.id}-entry::`, `model-${activeCustomModel.id}-risk::`);
      } else {
        prefixes.push(`pb-${activeTab}::`);
      }
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(checks)) {
        if (!prefixes.some((p) => k.startsWith(p))) {
          next[k] = v;
        }
      }
      onSaveChecks(next);
    }, [activeCustomModel, activeTab, checks, models, onSaveChecks]);

    const handleResetAll = useCallback(() => {
      onSaveChecks({});
    }, [onSaveChecks]);

    const persistPlaybookLines = useCallback(
      async (key: PlaybookSectionKey, nextLines: string[]) => {
        const nextDraft: Playbook = { ...draft, [key]: nextLines.join('\n') };
        setDraft(nextDraft);
        setSaving(true);
        try {
          await onSavePlaybook(nextDraft);
        } finally {
          setSaving(false);
        }
      },
      [draft, onSavePlaybook]
    );

    const handleAddBuiltInItem = useCallback(
      async (key: PlaybookSectionKey) => {
        const clean = stripLineFormatting(newItemInputs[key] || '');
        if (!clean) return;
        const lines = parseChecklistLines(draft[key]);
        setNewItemInputs((prev) => ({ ...prev, [key]: '' }));
        await persistPlaybookLines(key, [...lines, clean]);
      },
      [draft, newItemInputs, persistPlaybookLines]
    );

    const handleLoadStarterTemplate = useCallback(
      async (meta: SectionMeta) => {
        await persistPlaybookLines(meta.key, meta.starterLines);
      },
      [persistPlaybookLines]
    );

    const handleLoadAllStarterRules = useCallback(async () => {
      const nextDraft: Playbook = {
        rev: draft.rev.trim() ? draft.rev : MODEL_SECTIONS.rev.starterLines.join('\n'),
        cont: draft.cont.trim() ? draft.cont : MODEL_SECTIONS.cont.starterLines.join('\n'),
        core: draft.core.trim() ? draft.core : MODEL_SECTIONS.core.starterLines.join('\n'),
        entry: draft.entry.trim() ? draft.entry : ENTRY_SECTION.starterLines.join('\n'),
        risk: draft.risk.trim() ? draft.risk : RISK_SECTION.starterLines.join('\n'),
      };
      setDraft(nextDraft);
      setSaving(true);
      try {
        await onSavePlaybook(nextDraft);
      } finally {
        setSaving(false);
      }
    }, [draft, onSavePlaybook]);

    const handleSaveBuiltInItemEdit = useCallback(
      async (key: PlaybookSectionKey, index: number, rawVal: string) => {
        const clean = stripLineFormatting(rawVal);
        const scope = `pb-${key}`;
        const lines = parseChecklistLines(draft[key]);
        setEditingItem(null);
        if (!clean || index < 0 || index >= lines.length) return;
        const nextLines = lines.map((line, i) => (i === index ? clean : line));
        onSaveChecks(remapScopeChecks(checks, scope, lines, nextLines, (i) => i));
        await persistPlaybookLines(key, nextLines);
      },
      [checks, draft, onSaveChecks, persistPlaybookLines]
    );

    const handleMoveBuiltInItem = useCallback(
      async (key: PlaybookSectionKey, index: number, delta: -1 | 1) => {
        const scope = `pb-${key}`;
        const lines = parseChecklistLines(draft[key]);
        const target = index + delta;
        if (target < 0 || target >= lines.length) return;
        const nextLines = [...lines];
        [nextLines[index], nextLines[target]] = [nextLines[target], nextLines[index]];
        onSaveChecks(
          remapScopeChecks(checks, scope, lines, nextLines, (oldIdx) =>
            oldIdx === index ? target : oldIdx === target ? index : oldIdx
          )
        );
        await persistPlaybookLines(key, nextLines);
      },
      [checks, draft, onSaveChecks, persistPlaybookLines]
    );

    const handleDeleteBuiltInItem = useCallback(
      async (key: PlaybookSectionKey, index: number) => {
        const scope = `pb-${key}`;
        const lines = parseChecklistLines(draft[key]);
        if (index < 0 || index >= lines.length) return;
        const nextLines = lines.filter((_, i) => i !== index);
        if (editingItem?.scope === scope && editingItem.index === index) {
          setEditingItem(null);
        }
        onSaveChecks(
          remapScopeChecks(checks, scope, lines, nextLines, (oldIdx) =>
            oldIdx === index ? null : oldIdx > index ? oldIdx - 1 : oldIdx
          )
        );
        await persistPlaybookLines(key, nextLines);
      },
      [checks, draft, editingItem, onSaveChecks, persistPlaybookLines]
    );

    const persistCustomModelLines = useCallback(
      async (model: TradingModel, field: 'entry' | 'risk', nextLines: string[]) => {
        setSaving(true);
        try {
          await onSaveModel({ ...model, [field]: nextLines.join('\n') });
        } finally {
          setSaving(false);
        }
      },
      [onSaveModel]
    );

    const handleAddCustomModelItem = useCallback(
      async (model: TradingModel) => {
        const inputKey = `model-add-${model.id}`;
        const clean = stripLineFormatting(newItemInputs[inputKey] || '');
        if (!clean) return;
        const lines = parseChecklistLines(model[customAddTarget]);
        setNewItemInputs((prev) => ({ ...prev, [inputKey]: '' }));
        await persistCustomModelLines(model, customAddTarget, [...lines, clean]);
      },
      [customAddTarget, newItemInputs, persistCustomModelLines]
    );

    const handleSaveCustomModelItemEdit = useCallback(
      async (model: TradingModel, field: 'entry' | 'risk', index: number, rawVal: string) => {
        const clean = stripLineFormatting(rawVal);
        const scope = `model-${model.id}-${field}`;
        const lines = parseChecklistLines(model[field]);
        setEditingItem(null);
        if (!clean || index < 0 || index >= lines.length) return;
        const nextLines = lines.map((line, i) => (i === index ? clean : line));
        onSaveChecks(remapScopeChecks(checks, scope, lines, nextLines, (i) => i));
        await persistCustomModelLines(model, field, nextLines);
      },
      [checks, onSaveChecks, persistCustomModelLines]
    );

    const handleMoveCustomModelItem = useCallback(
      async (model: TradingModel, field: 'entry' | 'risk', index: number, delta: -1 | 1) => {
        const scope = `model-${model.id}-${field}`;
        const lines = parseChecklistLines(model[field]);
        const target = index + delta;
        if (target < 0 || target >= lines.length) return;
        const nextLines = [...lines];
        [nextLines[index], nextLines[target]] = [nextLines[target], nextLines[index]];
        onSaveChecks(
          remapScopeChecks(checks, scope, lines, nextLines, (oldIdx) =>
            oldIdx === index ? target : oldIdx === target ? index : oldIdx
          )
        );
        await persistCustomModelLines(model, field, nextLines);
      },
      [checks, onSaveChecks, persistCustomModelLines]
    );

    const handleDeleteCustomModelItem = useCallback(
      async (model: TradingModel, field: 'entry' | 'risk', index: number) => {
        const scope = `model-${model.id}-${field}`;
        const lines = parseChecklistLines(model[field]);
        if (index < 0 || index >= lines.length) return;
        const nextLines = lines.filter((_, i) => i !== index);
        if (editingItem?.scope === scope && editingItem.index === index) {
          setEditingItem(null);
        }
        onSaveChecks(
          remapScopeChecks(checks, scope, lines, nextLines, (oldIdx) =>
            oldIdx === index ? null : oldIdx > index ? oldIdx - 1 : oldIdx
          )
        );
        await persistCustomModelLines(model, field, nextLines);
      },
      [checks, editingItem, onSaveChecks, persistCustomModelLines]
    );

    const toggleBulkSection = useCallback(
      async (key: PlaybookSectionKey) => {
        const isOpen = Boolean(bulkSections[key]);
        if (isOpen && draft[key] !== playbook[key]) {
          setSaving(true);
          try {
            await onSavePlaybook(draft);
          } finally {
            setSaving(false);
          }
        }
        setBulkSections((prev) => ({ ...prev, [key]: !isOpen }));
      },
      [bulkSections, draft, onSavePlaybook, playbook]
    );

    const openModelModal = (model?: TradingModel) => {
      setConfirmDeleteModel(false);
      if (model) {
        setModalModelId(model.id);
        setModalModelName(model.name);
        setModalModelType(model.type);
        setModalModelEntry(model.entry);
        setModalModelRisk(model.risk);
      } else {
        setModalModelId(null);
        setModalModelName('');
        setModalModelType('Reversal');
        setModalModelEntry('');
        setModalModelRisk('');
      }
      setModelModalOpen(true);
    };

    const handleModelModalSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!modalModelName.trim()) return;
      const targetId = modalModelId || generateId();
      setSaving(true);
      try {
        await onSaveModel({
          id: targetId,
          name: modalModelName.trim(),
          type: modalModelType,
          entry: modalModelEntry.trim(),
          risk: modalModelRisk.trim(),
        });
        setModelModalOpen(false);
        setActiveTab(`custom:${targetId}`);
      } finally {
        setSaving(false);
      }
    };

    const handleConfirmDeleteModel = async () => {
      if (!modalModelId) return;
      setSaving(true);
      try {
        handleResetScope(`model-${modalModelId}-entry`);
        handleResetScope(`model-${modalModelId}-risk`);
        await onDeleteModel(modalModelId);
        setModelModalOpen(false);
        setConfirmDeleteModel(false);
        setActiveTab('rev');
      } finally {
        setSaving(false);
      }
    };

    // Scoped Pre-Trade Readiness = Currently Selected Model (or All) + Entry & Execution + Risk Rules
    const readiness = useMemo(() => {
      let total = 0;
      let checked = 0;

      const countScope = (scope: string, lines: string[]) => {
        lines.forEach((item, idx) => {
          total += 1;
          if (checks[makeCheckId(scope, item, idx)]) checked += 1;
        });
      };

      if (activeTab === 'all') {
        (['rev', 'cont', 'core'] as const).forEach((key) => {
          countScope(`pb-${key}`, parseChecklistLines(draft[key]));
        });
        models.forEach((m) => {
          countScope(`model-${m.id}-entry`, parseChecklistLines(m.entry));
          countScope(`model-${m.id}-risk`, parseChecklistLines(m.risk));
        });
      } else if (activeCustomModel) {
        countScope(`model-${activeCustomModel.id}-entry`, parseChecklistLines(activeCustomModel.entry));
        countScope(`model-${activeCustomModel.id}-risk`, parseChecklistLines(activeCustomModel.risk));
      } else {
        const key = activeTab as 'rev' | 'cont' | 'core';
        countScope(`pb-${key}`, parseChecklistLines(draft[key]));
      }

      countScope('pb-entry', parseChecklistLines(draft.entry));
      countScope('pb-risk', parseChecklistLines(draft.risk));

      const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
      const activeTitle =
        activeTab === 'all'
          ? 'All models & execution'
          : activeCustomModel
          ? activeCustomModel.name
          : MODEL_SECTIONS[activeTab as 'rev' | 'cont' | 'core'].title;

      return {
        total,
        checked,
        pct,
        ready: total > 0 && checked === total,
        activeTitle,
      };
    }, [activeCustomModel, activeTab, checks, draft, models]);

    const renderBuiltInChecklistBlock = (
      meta: SectionMeta,
      isManageOpen: boolean,
      onToggleManage: () => void,
      compactHeader = false
    ) => {
      const scope = `pb-${meta.key}`;
      const items = parseChecklistLines(draft[meta.key]);
      const checkedCount = items.reduce(
        (acc, item, idx) => acc + (checks[makeCheckId(scope, item, idx)] ? 1 : 0),
        0
      );
      const allDone = items.length > 0 && checkedCount === items.length;
      const isBulk = Boolean(bulkSections[meta.key]);

      return (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3
                  className={`font-display font-bold text-[#eef3fb] ${
                    compactHeader ? 'text-base' : 'text-lg'
                  }`}
                >
                  {meta.title}
                </h3>
                {allDone && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#47dca0]">
                    <Check className="w-3.5 h-3.5" />
                    Verified
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#8b9ab0]">{meta.subtitle}</p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {items.length > 0 && (
                <span
                  className={`font-mono text-xs font-semibold tabular-nums px-1.5 ${
                    allDone ? 'text-[#47dca0]' : 'text-[#9fb0c7]'
                  }`}
                >
                  {checkedCount}/{items.length}
                </span>
              )}
              {checkedCount > 0 && !isBulk && (
                <button
                  type="button"
                  onClick={() => handleResetScope(scope)}
                  title={`Reset ${meta.title} checks`}
                  aria-label={`Reset ${meta.title} checks`}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06] transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onToggleManage}
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap ${
                  isManageOpen
                    ? 'bg-[#47dca0]/15 text-[#8df0c0] border border-[#47dca0]/35'
                    : 'border border-white/[0.1] bg-white/[0.03] text-[#a9b7cc] hover:text-[#eef3fb] hover:bg-white/[0.07]'
                }`}
              >
                {isManageOpen ? (
                  <>
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {isBulk ? (
            <div className="space-y-2">
              <textarea
                rows={5}
                value={draft[meta.key]}
                onChange={(e) => setDraft((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                placeholder={`${meta.placeholder}\nAdd one rule per line...`}
                className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[#7f8fa8]">One rule per line</p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void toggleBulkSection(meta.key)}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving…' : 'Save rules'}</span>
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-[#8b9ab0]">
                No rules added yet. Start from scratch or load a clean template.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleLoadStarterTemplate(meta)}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-[#47dca0]/35 bg-[#47dca0]/10 px-3 text-xs font-semibold text-[#8df0c0] hover:bg-[#47dca0]/20 transition whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load starter</span>
                </button>
                {!isManageOpen && (
                  <button
                    type="button"
                    onClick={onToggleManage}
                    className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 text-xs font-semibold text-[#eef3fb] hover:bg-white/[0.08] transition whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add rule</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {items.map((item, idx) => {
                const checkId = makeCheckId(scope, item, idx);
                const isRowEditing = editingItem?.scope === scope && editingItem.index === idx;
                return (
                  <ChecklistRow
                    key={`${scope}-${idx}`}
                    label={item}
                    index={idx}
                    total={items.length}
                    checked={Boolean(checks[checkId])}
                    manageMode={isManageOpen}
                    isEditing={isRowEditing}
                    editValue={isRowEditing ? editingItem.value : ''}
                    onEditValueChange={(val) =>
                      setEditingItem((prev) => (prev ? { ...prev, value: val } : prev))
                    }
                    onStartEdit={() => setEditingItem({ scope, index: idx, value: item })}
                    onSaveEdit={() =>
                      void handleSaveBuiltInItemEdit(meta.key, idx, editingItem?.value || '')
                    }
                    onCancelEdit={() => setEditingItem(null)}
                    onMoveUp={() => void handleMoveBuiltInItem(meta.key, idx, -1)}
                    onMoveDown={() => void handleMoveBuiltInItem(meta.key, idx, 1)}
                    onDelete={() => void handleDeleteBuiltInItem(meta.key, idx)}
                    onToggle={() => handleToggleCheck(checkId)}
                  />
                );
              })}
            </div>
          )}

          {isManageOpen && !isBulk && (
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-2 border-t border-white/[0.06]">
              <input
                type="text"
                value={newItemInputs[meta.key] || ''}
                onChange={(e) =>
                  setNewItemInputs((prev) => ({ ...prev, [meta.key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddBuiltInItem(meta.key);
                  }
                }}
                placeholder={meta.placeholder}
                className="flex-1 min-w-[160px] min-h-[40px] rounded-xl glass-input px-3 text-xs sm:text-sm text-[#eef3fb] placeholder:text-[#5c6d87] focus:outline-none"
              />
              <button
                type="button"
                disabled={!(newItemInputs[meta.key] || '').trim() || saving}
                onClick={() => void handleAddBuiltInItem(meta.key)}
                className="min-h-[40px] inline-flex items-center gap-1 rounded-xl bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-40 transition shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add rule</span>
              </button>
              <button
                type="button"
                onClick={() => void toggleBulkSection(meta.key)}
                title="Switch to multi-line text editor"
                className="min-h-[40px] inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 text-xs font-medium text-[#c2cfdf] hover:bg-white/[0.08] transition shrink-0 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Bulk</span>
              </button>
            </div>
          )}
        </div>
      );
    };

    const renderCustomModelCardContent = (model: TradingModel, showDividerHeader = false) => {
      const entryItems = parseChecklistLines(model.entry);
      const riskItems = parseChecklistLines(model.risk);
      const entryScope = `model-${model.id}-entry`;
      const riskScope = `model-${model.id}-risk`;
      const totalModelItems = entryItems.length + riskItems.length;
      const checkedModelItems =
        entryItems.reduce(
          (acc, it, idx) => acc + (checks[makeCheckId(entryScope, it, idx)] ? 1 : 0),
          0
        ) +
        riskItems.reduce(
          (acc, it, idx) => acc + (checks[makeCheckId(riskScope, it, idx)] ? 1 : 0),
          0
        );
      const addInputKey = `model-add-${model.id}`;

      return (
        <div className={`space-y-4 ${showDividerHeader ? 'pt-5 border-t border-white/[0.08]' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold text-[#eef3fb] truncate">
                {model.name}
              </h3>
              <p className="mt-0.5 text-xs text-[#8b9ab0]">
                Custom model · {model.type}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {totalModelItems > 0 && (
                <span
                  className={`font-mono text-xs font-semibold tabular-nums px-1.5 ${
                    checkedModelItems === totalModelItems ? 'text-[#47dca0]' : 'text-[#9fb0c7]'
                  }`}
                >
                  {checkedModelItems}/{totalModelItems}
                </span>
              )}
              {checkedModelItems > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    handleResetScope(entryScope);
                    handleResetScope(riskScope);
                  }}
                  title={`Reset ${model.name} checks`}
                  aria-label={`Reset ${model.name} checks`}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06] transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setManageModel((v) => !v)}
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap ${
                  manageModel
                    ? 'bg-[#47dca0]/15 text-[#8df0c0] border border-[#47dca0]/35'
                    : 'border border-white/[0.1] bg-white/[0.03] text-[#a9b7cc] hover:text-[#eef3fb] hover:bg-white/[0.07]'
                }`}
              >
                {manageModel ? (
                  <>
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => openModelModal(model)}
                className="min-h-[36px] rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 text-xs font-semibold text-[#c2cfdf] hover:text-[#eef3fb] hover:bg-white/[0.07] transition whitespace-nowrap"
              >
                Details
              </button>
            </div>
          </div>

          {totalModelItems === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 flex items-center justify-between gap-3">
              <p className="text-xs text-[#8b9ab0]">
                No entry or risk rules saved for this model yet.
              </p>
              <button
                type="button"
                onClick={() => setManageModel(true)}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 text-xs font-semibold text-[#eef3fb] hover:bg-white/[0.08] transition whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add rule</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {entryItems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[#8df0c0] pb-1">Entry conditions</p>
                  <div className="divide-y divide-white/[0.05]">
                    {entryItems.map((item, idx) => {
                      const checkId = makeCheckId(entryScope, item, idx);
                      const isRowEditing =
                        editingItem?.scope === entryScope && editingItem.index === idx;
                      return (
                        <ChecklistRow
                          key={`${entryScope}-${idx}`}
                          label={item}
                          index={idx}
                          total={entryItems.length}
                          checked={Boolean(checks[checkId])}
                          manageMode={manageModel}
                          isEditing={isRowEditing}
                          editValue={isRowEditing ? editingItem.value : ''}
                          onEditValueChange={(val) =>
                            setEditingItem((prev) => (prev ? { ...prev, value: val } : prev))
                          }
                          onStartEdit={() =>
                            setEditingItem({ scope: entryScope, index: idx, value: item })
                          }
                          onSaveEdit={() =>
                            void handleSaveCustomModelItemEdit(
                              model,
                              'entry',
                              idx,
                              editingItem?.value || ''
                            )
                          }
                          onCancelEdit={() => setEditingItem(null)}
                          onMoveUp={() => void handleMoveCustomModelItem(model, 'entry', idx, -1)}
                          onMoveDown={() => void handleMoveCustomModelItem(model, 'entry', idx, 1)}
                          onDelete={() => void handleDeleteCustomModelItem(model, 'entry', idx)}
                          onToggle={() => handleToggleCheck(checkId)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {riskItems.length > 0 && (
                <div className="space-y-1 pt-3 border-t border-white/[0.06]">
                  <p className="text-xs font-semibold text-[#8ebeff] pb-1">Risk &amp; targets</p>
                  <div className="divide-y divide-white/[0.05]">
                    {riskItems.map((item, idx) => {
                      const checkId = makeCheckId(riskScope, item, idx);
                      const isRowEditing =
                        editingItem?.scope === riskScope && editingItem.index === idx;
                      return (
                        <ChecklistRow
                          key={`${riskScope}-${idx}`}
                          label={item}
                          index={idx}
                          total={riskItems.length}
                          checked={Boolean(checks[checkId])}
                          manageMode={manageModel}
                          isEditing={isRowEditing}
                          editValue={isRowEditing ? editingItem.value : ''}
                          onEditValueChange={(val) =>
                            setEditingItem((prev) => (prev ? { ...prev, value: val } : prev))
                          }
                          onStartEdit={() =>
                            setEditingItem({ scope: riskScope, index: idx, value: item })
                          }
                          onSaveEdit={() =>
                            void handleSaveCustomModelItemEdit(
                              model,
                              'risk',
                              idx,
                              editingItem?.value || ''
                            )
                          }
                          onCancelEdit={() => setEditingItem(null)}
                          onMoveUp={() => void handleMoveCustomModelItem(model, 'risk', idx, -1)}
                          onMoveDown={() => void handleMoveCustomModelItem(model, 'risk', idx, 1)}
                          onDelete={() => void handleDeleteCustomModelItem(model, 'risk', idx)}
                          onToggle={() => handleToggleCheck(checkId)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {manageModel && (
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-2 border-t border-white/[0.06]">
              <div className="inline-flex items-center rounded-xl border border-white/[0.1] bg-black/25 p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setCustomAddTarget('entry')}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition ${
                    customAddTarget === 'entry'
                      ? 'bg-[#47dca0]/20 text-[#8df0c0]'
                      : 'text-[#8b9ab0] hover:text-[#eef3fb]'
                  }`}
                >
                  Entry
                </button>
                <button
                  type="button"
                  onClick={() => setCustomAddTarget('risk')}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition ${
                    customAddTarget === 'risk'
                      ? 'bg-[#8ebeff]/20 text-[#8ebeff]'
                      : 'text-[#8b9ab0] hover:text-[#eef3fb]'
                  }`}
                >
                  Risk
                </button>
              </div>

              <input
                type="text"
                value={newItemInputs[addInputKey] || ''}
                onChange={(e) =>
                  setNewItemInputs((prev) => ({
                    ...prev,
                    [addInputKey]: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCustomModelItem(model);
                  }
                }}
                placeholder={
                  customAddTarget === 'entry'
                    ? 'Add entry criterion…'
                    : 'Add risk or target rule…'
                }
                className="flex-1 min-w-[140px] min-h-[40px] rounded-xl glass-input px-3 text-xs sm:text-sm text-[#eef3fb] placeholder:text-[#5c6d87] focus:outline-none"
              />

              <button
                type="button"
                disabled={!(newItemInputs[addInputKey] || '').trim() || saving}
                onClick={() => void handleAddCustomModelItem(model)}
                className="min-h-[40px] inline-flex items-center gap-1 rounded-xl bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-40 transition shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add rule</span>
              </button>
            </div>
          )}
        </div>
      );
    };

    const totalChecksCount = Object.keys(checks).length;

    return (
      <div className="space-y-5">
        {/* Clean Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#8df0c0]">Pre-trade execution</p>
            <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
              Trading playbook
            </h2>
            <p className="mt-1 text-sm text-[#8b9ab0]">
              Pick your setup model, tick off entry &amp; risk steps in real time, and edit any line anytime.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {totalChecksCount > 0 && (
              <button
                type="button"
                onClick={handleResetAll}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 text-xs font-semibold text-[#c2cfdf] hover:bg-white/[0.08] transition whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear all checks</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openModelModal()}
              className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#47dca0] px-4 text-xs sm:text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New model</span>
            </button>
          </div>
        </div>

        {/* Scoped Active Setup Readiness Bar */}
        <div className="rounded-2xl glass-card px-5 py-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-[#eef3fb]">{readiness.activeTitle}</span>
              <span aria-hidden="true" className="text-[#56647c]">·</span>
              <span className={readiness.ready ? 'font-semibold text-[#47dca0]' : 'text-[#8b9ab0]'}>
                {readiness.total === 0
                  ? 'Add rules or load starter checklist below'
                  : readiness.ready
                  ? 'All setup & risk criteria verified — ready to execute'
                  : 'Tick off each criterion as you evaluate the setup'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {readiness.total === 0 && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleLoadAllStarterRules()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#8df0c0] hover:text-[#aef7d4] transition whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load starter playbook</span>
                </button>
              )}
              {readiness.checked > 0 && (
                <button
                  type="button"
                  onClick={handleResetActiveSetup}
                  className="text-xs font-medium text-[#8b9ab0] hover:text-[#eef3fb] transition whitespace-nowrap"
                >
                  Reset setup
                </button>
              )}
              <span className="font-mono text-sm font-bold tabular-nums text-[#eef3fb]">
                {readiness.checked}/{readiness.total}
                <span className="ml-1.5 text-xs font-semibold text-[#8df0c0]">
                  ({readiness.pct}%)
                </span>
              </span>
            </div>
          </div>

          <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[#8ebeff] to-[#47dca0] transition-transform duration-300 ease-out"
              style={{ transform: `scaleX(${readiness.pct / 100})` }}
            />
          </div>
        </div>

        {/* Focused Two-Column Trading Cockpit: Left = Model Checklists | Right = Entry & Risk Gate */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Setup Model Selector & Checklist */}
          <article className="lg:col-span-6 rounded-2xl glass-card p-5 space-y-5">
            {/* Clean Model Tabs */}
            <div
              role="tablist"
              aria-label="Trading models"
              className="flex flex-wrap items-center gap-1.5 pb-3.5 border-b border-white/[0.08]"
            >
              {(['rev', 'cont', 'core'] as const).map((key) => {
                const meta = MODEL_SECTIONS[key];
                const items = parseChecklistLines(draft[key]);
                const doneCount = items.reduce(
                  (acc, item, idx) => acc + (checks[makeCheckId(`pb-${key}`, item, idx)] ? 1 : 0),
                  0
                );
                const selected = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      setActiveTab(key);
                      setEditingItem(null);
                    }}
                    className={`min-h-[38px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                      selected
                        ? 'bg-[#47dca0]/18 border border-[#47dca0]/45 text-[#eef3fb]'
                        : 'border border-transparent bg-white/[0.03] text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span>{meta.shortLabel}</span>
                    {items.length > 0 && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          doneCount === items.length ? 'text-[#47dca0]' : 'text-[#7c8ca6]'
                        }`}
                      >
                        {doneCount}/{items.length}
                      </span>
                    )}
                  </button>
                );
              })}

              {models.map((m) => {
                const tabKey: ActiveModelTab = `custom:${m.id}`;
                const selected = activeTab === tabKey;
                const eItems = parseChecklistLines(m.entry);
                const rItems = parseChecklistLines(m.risk);
                const totalM = eItems.length + rItems.length;
                const doneM =
                  eItems.reduce(
                    (acc, it, idx) =>
                      acc + (checks[makeCheckId(`model-${m.id}-entry`, it, idx)] ? 1 : 0),
                    0
                  ) +
                  rItems.reduce(
                    (acc, it, idx) =>
                      acc + (checks[makeCheckId(`model-${m.id}-risk`, it, idx)] ? 1 : 0),
                    0
                  );
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      setActiveTab(tabKey);
                      setEditingItem(null);
                    }}
                    className={`min-h-[38px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                      selected
                        ? 'bg-[#8ebeff]/18 border border-[#8ebeff]/45 text-[#eef3fb]'
                        : 'border border-transparent bg-white/[0.03] text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="truncate max-w-[130px]">{m.name}</span>
                    {totalM > 0 && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          doneM === totalM ? 'text-[#47dca0]' : 'text-[#7c8ca6]'
                        }`}
                      >
                        {doneM}/{totalM}
                      </span>
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'all'}
                onClick={() => {
                  setActiveTab('all');
                  setEditingItem(null);
                }}
                className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  activeTab === 'all'
                    ? 'bg-white/[0.14] border border-white/[0.25] text-[#eef3fb]'
                    : 'border border-transparent bg-white/[0.03] text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.06]'
                }`}
              >
                <span>All models</span>
              </button>
            </div>

            {activeTab === 'all' ? (
              <div className="space-y-6">
                {renderBuiltInChecklistBlock(
                  MODEL_SECTIONS.rev,
                  manageModel,
                  () => setManageModel((v) => !v),
                  true
                )}
                <div className="pt-5 border-t border-white/[0.08]">
                  {renderBuiltInChecklistBlock(
                    MODEL_SECTIONS.cont,
                    manageModel,
                    () => setManageModel((v) => !v),
                    true
                  )}
                </div>
                <div className="pt-5 border-t border-white/[0.08]">
                  {renderBuiltInChecklistBlock(
                    MODEL_SECTIONS.core,
                    manageModel,
                    () => setManageModel((v) => !v),
                    true
                  )}
                </div>
                {models.map((m) => (
                  <React.Fragment key={m.id}>
                    {renderCustomModelCardContent(m, true)}
                  </React.Fragment>
                ))}
              </div>
            ) : activeCustomModel ? (
              renderCustomModelCardContent(activeCustomModel, false)
            ) : (
              renderBuiltInChecklistBlock(
                MODEL_SECTIONS[activeTab as 'rev' | 'cont' | 'core'],
                manageModel,
                () => setManageModel((v) => !v)
              )
            )}
          </article>

          {/* Right Column: Entry & Execution Gate + Risk & Invalidation Rules */}
          <article className="lg:col-span-6 rounded-2xl glass-card p-5 space-y-6">
            {renderBuiltInChecklistBlock(
              ENTRY_SECTION,
              manageEntry,
              () => setManageEntry((v) => !v),
              true
            )}

            <div className="pt-5 border-t border-white/[0.08]">
              {renderBuiltInChecklistBlock(
                RISK_SECTION,
                manageRisk,
                () => setManageRisk((v) => !v),
                true
              )}
            </div>
          </article>
        </div>

        {/* Create / Edit Custom Model Modal */}
        {modelModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4"
            onClick={() => setModelModalOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl glass-modal p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
                <div>
                  <h3 className="font-display text-lg font-extrabold text-[#eef3fb]">
                    {modalModelId ? 'Edit trading model' : 'Create trading model'}
                  </h3>
                  <p className="mt-0.5 text-xs text-[#8b9ab0]">
                    Put each condition on its own line to build interactive checkboxes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModelModalOpen(false)}
                  aria-label="Close model editor"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb] hover:bg-white/[0.08] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => void handleModelModalSubmit(e)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#9fb0c7] mb-1.5">
                      Model name
                    </label>
                    <input
                      type="text"
                      required
                      value={modalModelName}
                      onChange={(e) => setModalModelName(e.target.value)}
                      placeholder="e.g. NY Open Sweep Model"
                      className="w-full min-h-[44px] rounded-xl glass-input px-3.5 text-sm text-[#eef3fb] placeholder:text-[#5c6d87] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9fb0c7] mb-1.5">
                      Model type
                    </label>
                    <select
                      value={modalModelType}
                      onChange={(e) => setModalModelType(e.target.value as ModelType)}
                      className="w-full min-h-[44px] rounded-xl glass-input px-3 text-sm text-[#eef3fb] focus:outline-none"
                    >
                      <option value="Reversal">Reversal</option>
                      <option value="Continuation">Continuation</option>
                      <option value="Both">Both</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#8df0c0] mb-1.5">
                    Entry conditions (one rule per line)
                  </label>
                  <textarea
                    rows={4}
                    value={modalModelEntry}
                    onChange={(e) => setModalModelEntry(e.target.value)}
                    placeholder="Liquidity sweep of Asia/London high&#10;15m or 5m displacement shift&#10;Clean FVG retest inside killzone"
                    className="w-full rounded-xl glass-input px-3.5 py-2.5 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#8ebeff] mb-1.5">
                    Risk &amp; targets (one rule per line)
                  </label>
                  <textarea
                    rows={3}
                    value={modalModelRisk}
                    onChange={(e) => setModalModelRisk(e.target.value)}
                    placeholder="Stop beyond structural swing extreme&#10;Move SL to BE after 1.5R&#10;Target opposing HTF liquidity pool"
                    className="w-full rounded-xl glass-input px-3.5 py-2.5 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                  {modalModelId ? (
                    confirmDeleteModel ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#ff7f97]">Delete this model?</span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleConfirmDeleteModel()}
                          className="min-h-[38px] rounded-lg bg-[#ff7f97]/20 border border-[#ff7f97]/40 px-3 text-xs font-semibold text-[#ff9db0] hover:bg-[#ff7f97]/30 transition"
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteModel(false)}
                          className="min-h-[38px] px-2 text-xs text-[#8b9ab0] hover:text-[#eef3fb]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteModel(true)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[#ff7f97] hover:bg-[#ff7f97]/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete model</span>
                      </button>
                    )
                  ) : (
                    <span />
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setModelModalOpen(false)}
                      className="min-h-[42px] rounded-xl border border-white/[0.12] px-4 text-xs font-semibold text-[#c2cfdf] hover:bg-white/[0.06] transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!modalModelName.trim() || saving}
                      className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#47dca0] px-5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{modalModelId ? 'Save changes' : 'Create model'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }
);

PlaybookScreen.displayName = 'PlaybookScreen';
