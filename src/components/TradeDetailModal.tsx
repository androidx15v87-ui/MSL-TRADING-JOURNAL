import React, { useState } from 'react';
import { Calendar, Copy, Edit3, Trash2, X, ZoomIn } from 'lucide-react';
import { motion } from 'motion/react';
import {
  formatDate,
  formatTime,
  formatTradePnL,
  formatTradeRisk,
  getUnitShortLabel,
} from '../lib/calculations';
import type { CustomField, JournalSettings, Trade } from '../types/journal';

interface TradeDetailModalProps {
  trade: Trade | null;
  fields: CustomField[];
  settings?: JournalSettings;
  onClose: () => void;
  onEdit: (trade: Trade) => void;
  onDuplicate: (trade: Trade) => void;
  onDelete: (trade: Trade) => void;
}

export const TradeDetailModal: React.FC<TradeDetailModalProps> = ({
  trade,
  fields,
  settings,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  if (!trade) return null;

  const outcomeColor =
    trade.result === 'Win'
      ? 'text-[#47dca0]'
      : trade.result === 'Loss'
      ? 'text-[#ff7d91]'
      : trade.result === 'Missed'
      ? 'text-[#f5cc79]'
      : 'text-[#8ebeff]';

  const customEntries = Object.entries(trade.custom || {}).filter(([, val]) => {
    if (typeof val === 'object' && val !== null) {
      return Boolean(val.text || val.number);
    }
    return Boolean(val);
  });

  const getFieldName = (id: string) => {
    return fields.find((f) => f.id === id)?.name || id;
  };

  const tradeTags = Array.isArray(trade.tags) ? trade.tags.filter(Boolean) : [];
  const pnlDisplay = formatTradePnL(trade, settings?.defaultPnlUnit, settings?.currency);
  const riskDisplay = formatTradeRisk(trade, settings?.defaultRiskUnit, settings?.currency);
  const riskLabel = getUnitShortLabel(
    trade.riskUnit || settings?.defaultRiskUnit || 'r',
    trade.currency || settings?.currency
  );

  return (
    <>
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
          aria-labelledby="trade-detail-title"
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full sm:max-w-xl max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-2xl glass-modal overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/[0.08]">
            <div>
              <div className="flex items-center gap-2 text-xs text-[#8b9ab0]">
                <Calendar className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">
                  {formatDate(trade.date)} {formatTime(trade.date)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <h2 id="trade-detail-title" className="text-xl font-extrabold text-[#eef3fb]">
                  {trade.pair}
                </h2>
                <span className={`font-mono text-lg font-bold tabular-nums ${outcomeColor}`}>
                  {pnlDisplay}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#9aa8be]">
                {trade.direction} · {trade.setup} · {trade.session} ·{' '}
                {trade.result === 'Missed' ? 'Missed setup' : trade.result}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close trade detail"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:bg-white/[0.08] hover:text-[#eef3fb]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div className="grid grid-cols-3 gap-3 rounded-xl glass-subcard p-3.5">
              <div>
                <p className="text-[11px] text-[#7f8fa8]">Outcome</p>
                <p className={`mt-0.5 text-sm font-bold ${outcomeColor}`}>{trade.result}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#7f8fa8]">Risk ({riskLabel})</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[#eef3fb]">
                  {riskDisplay}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#7f8fa8]">Model</p>
                <p className="mt-0.5 text-sm font-medium text-[#eef3fb] truncate">
                  {trade.model || '—'}
                </p>
              </div>
            </div>

            {tradeTags.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold tracking-wider text-[#8df0c0] uppercase">
                  Labels
                </h3>
                <p className="text-sm font-medium text-[#d5dfef] leading-relaxed">
                  {tradeTags.map((tg) => `#${tg}`).join(' · ')}
                </p>
              </div>
            )}

            {customEntries.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wider text-[#8df0c0] uppercase">
                  Custom properties
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {customEntries.map(([key, val]) => {
                    const display =
                      typeof val === 'object' && val !== null
                        ? [val.text, val.number].filter(Boolean).join(' · ')
                        : String(val);
                    return (
                      <div
                        key={key}
                        className="rounded-xl glass-subcard px-3.5 py-2.5"
                      >
                        <p className="text-[11px] text-[#7f8fa8]">{getFieldName(key)}</p>
                        <p className="mt-0.5 text-sm font-medium text-[#eef3fb]">{display}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold tracking-wider text-[#8df0c0] uppercase">
                Execution notes
              </h3>
              <p className="rounded-xl glass-subcard p-3.5 text-sm leading-relaxed text-[#cfd9ea] whitespace-pre-wrap">
                {trade.notes || 'No execution notes recorded.'}
              </p>
            </div>

            {trade.images && trade.images.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wider text-[#8df0c0] uppercase">
                  Chart screenshots ({trade.images.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {trade.images.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightboxImage(img.dataUrl)}
                      className="relative group rounded-xl overflow-hidden border border-white/[0.12] bg-[#070c17] aspect-video text-left"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name || 'Trade screenshot'}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                      />
                      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-medium text-[#eef3fb]">
                        <ZoomIn className="w-3 h-3" />
                        Inspect
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-white/[0.08] pb-safe flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => onDelete(trade)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#ff7d91]/30 bg-[#ff7d91]/10 px-4 py-2 text-sm font-semibold text-[#ff7d91] hover:bg-[#ff7d91]/20 transition"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDuplicate(trade)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl glass-subcard px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:border-white/25 transition"
              >
                <Copy className="w-4 h-4 text-[#8ebeff]" />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                onClick={() => onEdit(trade)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit trade</span>
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Close fullscreen preview"
            className="fixed top-4 right-4 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-modal text-[#eef3fb]"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage}
            alt="Expanded chart screenshot"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[88dvh] rounded-xl object-contain"
          />
        </div>
      )}
    </>
  );
};
