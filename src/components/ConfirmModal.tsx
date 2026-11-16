import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md p-4"
          onClick={onCancel}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-2xl glass-modal p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {danger && (
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ff7d91]/15 border border-[#ff7d91]/25 text-[#ff7d91]">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                )}
                <div>
                  <h3 id="confirm-modal-title" className="text-base font-bold text-[#eef3fb]">
                    {title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#a8b6cc]">{description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:bg-white/[0.08] hover:text-[#eef3fb]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[44px] rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:bg-white/[0.1] transition"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={
                  danger
                    ? 'min-h-[44px] rounded-xl bg-[#ff667e] px-4 py-2 text-sm font-semibold text-[#18070b] hover:bg-[#ff7d91] transition'
                    : 'min-h-[44px] rounded-xl bg-[#47dca0] px-4 py-2 text-sm font-semibold text-[#061813] hover:bg-[#62e4b0] transition'
                }
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
