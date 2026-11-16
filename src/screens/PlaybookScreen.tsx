import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { Playbook } from '../types/journal';

interface PlaybookScreenProps {
  playbook: Playbook;
  onSavePlaybook: (playbook: Playbook) => Promise<void> | void;
}

export const PlaybookScreen: React.FC<PlaybookScreenProps> = ({
  playbook,
  onSavePlaybook,
}) => {
  const [draft, setDraft] = useState<Playbook>(playbook);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(playbook);
  }, [playbook]);

  const isDirty =
    draft.core !== playbook.core ||
    draft.rev !== playbook.rev ||
    draft.cont !== playbook.cont ||
    draft.entry !== playbook.entry ||
    draft.risk !== playbook.risk;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSavePlaybook(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
            The rules you follow
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Trading playbook
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            Keep your decision framework clear and accessible before the market moves.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-60 transition whitespace-nowrap shrink-0"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving…' : isDirty ? 'Save playbook *' : 'Save playbook'}</span>
        </button>
      </div>

      <div className="rounded-2xl glass-card p-5 space-y-5">
        <label className="block space-y-2">
          <span className="text-sm font-bold text-[#eef3fb]">Core model</span>
          <textarea
            rows={4}
            value={draft.core}
            onChange={(e) => setDraft((prev) => ({ ...prev, core: e.target.value }))}
            placeholder="Liquidity sweep → displacement → MSS → retracement → execution → next meaningful liquidity."
            className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
          />
        </label>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-bold text-[#eef3fb]">Reversal rules</span>
            <textarea
              rows={5}
              value={draft.rev}
              onChange={(e) => setDraft((prev) => ({ ...prev, rev: e.target.value }))}
              placeholder="Conditions that must be true before taking a reversal entry."
              className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-bold text-[#eef3fb]">Continuation rules</span>
            <textarea
              rows={5}
              value={draft.cont}
              onChange={(e) => setDraft((prev) => ({ ...prev, cont: e.target.value }))}
              placeholder="Trend context, pullback zone, required sweep and confirmation."
              className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-bold text-[#eef3fb]">Entry filters</span>
            <textarea
              rows={5}
              value={draft.entry}
              onChange={(e) => setDraft((prev) => ({ ...prev, entry: e.target.value }))}
              placeholder="Premium/discount, OB/FVG, session timing, confluence…"
              className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-bold text-[#eef3fb]">Invalidation & targets</span>
            <textarea
              rows={5}
              value={draft.risk}
              onChange={(e) => setDraft((prev) => ({ ...prev, risk: e.target.value }))}
              placeholder="Invalidation level, max risk per trade, liquidity target and exit rules."
              className="w-full rounded-xl glass-input px-3.5 py-3 text-sm leading-relaxed text-[#eef3fb] placeholder:text-[#5c6d87] resize-y"
            />
          </label>
        </div>
      </div>
    </form>
  );
};
