import React, { useEffect, useState } from 'react';
import { BookMarked, Building2, Check, Loader2, Target, Wallet, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { generateId, isRCurrency } from '../lib/calculations';
import { VALIDATION_LIMITS } from '../lib/validationConstants';
import type { TradingJournal } from '../types/journal';

interface JournalModalProps {
  open: boolean;
  journal: TradingJournal | null;
  defaultCurrency?: string;
  onClose: () => void;
  onSave: (journal: TradingJournal) => Promise<void> | void;
}

const BALANCE_PRESETS = [50, 500, 5000, 10000, 50000, 100000, 200000];
const R_TARGET_PRESETS = [10, 20, 30, 50];
const MONEY_TARGET_PCT_PRESETS = [5, 8, 10, 15, 20];
const CURRENCIES = ['R', '$', '€', '£', '¥', '₦'];
const PROP_FIRM_SUGGESTIONS = ['Personal', 'FTMO', 'Apex', 'FundedNext', 'Topstep'];

export const JournalModal: React.FC<JournalModalProps> = ({
  open,
  journal,
  defaultCurrency = 'R',
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [balanceInput, setBalanceInput] = useState('0');
  const [targetInput, setTargetInput] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency || 'R');
  const [propFirm, setPropFirm] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    startingBalance?: string;
    target?: string;
    propFirm?: string;
    description?: string;
  }>({});
  const [saving, setSaving] = useState(false);

  const isR = isRCurrency(currency);

  useEffect(() => {
    if (!open) return;
    if (journal) {
      const nextCurr = journal.currency || defaultCurrency || 'R';
      setName(journal.name);
      setCurrency(nextCurr);
      setBalanceInput(
        isRCurrency(nextCurr)
          ? '0'
          : String(journal.startingBalance > 0 ? journal.startingBalance : 10000)
      );
      setTargetInput(journal.target && journal.target > 0 ? String(journal.target) : '');
      setPropFirm(journal.propFirm || '');
      setDescription(journal.description || '');
    } else {
      const nextCurr = defaultCurrency || 'R';
      setName('');
      setCurrency(nextCurr);
      setBalanceInput(isRCurrency(nextCurr) ? '0' : '10000');
      setTargetInput('');
      setPropFirm('');
      setDescription('');
    }
    setErrors({});
  }, [open, journal, defaultCurrency]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const handleSelectCurrency = (sym: string) => {
    setCurrency(sym);
    if (isRCurrency(sym)) {
      setBalanceInput('0');
      setErrors((prev) => ({ ...prev, startingBalance: undefined, target: undefined }));
    } else {
      const curBal = Number(balanceInput);
      if (!balanceInput.trim() || !Number.isFinite(curBal) || curBal < VALIDATION_LIMITS.journalMonetaryBalanceMin) {
        setBalanceInput('10000');
      }
      setErrors((prev) => ({ ...prev, startingBalance: undefined, target: undefined }));
    }
  };

  const validate = () => {
    const nextErrors: typeof errors = {};
    const cleanName = name.trim();
    if (!cleanName) {
      nextErrors.name = 'Give your journal a clear name or label.';
    } else if (cleanName.length > VALIDATION_LIMITS.journalNameMaxLength) {
      nextErrors.name = `Name must be ${VALIDATION_LIMITS.journalNameMaxLength} characters or fewer.`;
    }

    if (!isR) {
      const numericBalance = Number(balanceInput);
      if (!balanceInput.trim() || !Number.isFinite(numericBalance)) {
        nextErrors.startingBalance = 'Enter a valid starting balance or challenge size.';
      } else if (numericBalance < VALIDATION_LIMITS.journalMonetaryBalanceMin) {
        nextErrors.startingBalance = `Minimum starting balance is ${currency}${VALIDATION_LIMITS.journalMonetaryBalanceMin}.`;
      } else if (numericBalance > VALIDATION_LIMITS.journalBalanceMax) {
        nextErrors.startingBalance = `Balance cannot exceed ${currency}${VALIDATION_LIMITS.journalBalanceMax.toLocaleString()}.`;
      }
    }

    if (targetInput.trim()) {
      const numericTarget = Number(targetInput);
      if (!Number.isFinite(numericTarget) || numericTarget < 0) {
        nextErrors.target = 'Enter a valid non-negative target.';
      } else if (numericTarget > VALIDATION_LIMITS.journalTargetMax) {
        nextErrors.target = `Target cannot exceed ${VALIDATION_LIMITS.journalTargetMax.toLocaleString()}.`;
      }
    }

    if (propFirm.trim().length > VALIDATION_LIMITS.journalPropFirmMaxLength) {
      nextErrors.propFirm = `Prop firm must be ${VALIDATION_LIMITS.journalPropFirmMaxLength} characters or fewer.`;
    }

    if (description.trim().length > VALIDATION_LIMITS.journalDescriptionMaxLength) {
      nextErrors.description = `Description must be ${VALIDATION_LIMITS.journalDescriptionMaxLength} characters or fewer.`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || saving) return;

    const now = new Date().toISOString();
    const cleanCurr = (currency || 'R').trim().slice(0, VALIDATION_LIMITS.currencyMaxLength) || 'R';
    const cleanBalance = isRCurrency(cleanCurr)
      ? 0
      : Math.round(Number(balanceInput) * 100) / 100;
    const cleanTarget = targetInput.trim()
      ? Math.max(0, Math.round(Number(targetInput) * 100) / 100)
      : 0;

    const payload: TradingJournal = {
      id: journal?.id || generateId(),
      name: name.trim().slice(0, VALIDATION_LIMITS.journalNameMaxLength),
      startingBalance: cleanBalance,
      target: cleanTarget,
      currency: cleanCurr,
      propFirm: propFirm.trim().slice(0, VALIDATION_LIMITS.journalPropFirmMaxLength),
      description: description.trim().slice(0, VALIDATION_LIMITS.journalDescriptionMaxLength),
      isDeleted: false,
      createdAt: journal?.createdAt || now,
      updatedAt: now,
    };

    setSaving(true);
    try {
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const numericStart = Number(balanceInput);
  const numericTarget = Number(targetInput);
  const targetPctPreview =
    !isR &&
    Number.isFinite(numericStart) &&
    numericStart > 0 &&
    targetInput.trim() &&
    Number.isFinite(numericTarget) &&
    numericTarget > 0
      ? ((numericTarget / numericStart) * 100).toFixed(1)
      : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-md sm:p-4"
          onClick={() => {
            if (!saving) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-modal-title"
            initial={{ opacity: 0, y: 22, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl glass-modal p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#47dca0]/15 border border-[#47dca0]/35 flex items-center justify-center text-[#8df0c0] shrink-0">
                  <BookMarked className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="journal-modal-title"
                    className="font-display text-lg font-extrabold text-[#eef3fb]"
                  >
                    {journal ? 'Edit trading journal' : 'Create trading journal'}
                  </h2>
                  <p className="text-xs text-[#8b9ab0]">
                    Separate R-multiple logs, prop firm challenges, and funded accounts cleanly.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                aria-label="Close journal modal"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:bg-white/[0.08] hover:text-[#eef3fb] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
              {/* Name / Label */}
              <div className="space-y-1.5">
                <label
                  htmlFor="journal-name-input"
                  className="flex items-center justify-between text-xs font-semibold text-[#c5d1e4]"
                >
                  <span>Journal name / label *</span>
                  <span className="font-mono text-[11px] font-normal text-[#7f8fa8] tabular-nums">
                    {name.trim().length}/{VALIDATION_LIMITS.journalNameMaxLength}
                  </span>
                </label>
                <input
                  id="journal-name-input"
                  type="text"
                  autoFocus
                  maxLength={VALIDATION_LIMITS.journalNameMaxLength}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  placeholder="e.g. Main Trading Journal, FTMO $100k Challenge, Personal $50"
                  className={`w-full min-h-[44px] rounded-xl glass-input px-3.5 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#66768f] focus:outline-none ${
                    errors.name ? 'border-[#ff7d91]/70' : ''
                  }`}
                />
                {errors.name && (
                  <p className="text-xs font-medium text-[#ff7d91]">{errors.name}</p>
                )}
              </div>

              {/* Currency / Mode Selection (Default = R) */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#c5d1e4]">
                    Currency / measurement *
                  </span>
                  <span className="text-[11px] text-[#7c8ca6]">
                    {isR ? 'Default: R (Risk/Reward)' : `Account currency: ${currency}`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Currency">
                  {CURRENCIES.map((sym) => {
                    const selected = currency.toUpperCase() === sym.toUpperCase();
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => handleSelectCurrency(sym)}
                        className={`min-h-[34px] rounded-lg px-3 text-xs font-mono font-bold border transition ${
                          selected
                            ? 'bg-[#47dca0]/20 border-[#47dca0]/55 text-[#8df0c0]'
                            : 'bg-white/[0.04] border-white/[0.09] text-[#8b9ab0] hover:text-[#eef3fb]'
                        }`}
                      >
                        {sym === 'R' ? 'Default (R)' : sym}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Starting Balance (Only for non-R monetary currencies) */}
              {isR ? (
                <div className="rounded-xl glass-subcard border border-[#47dca0]/25 px-3.5 py-3 space-y-1">
                  <p className="text-xs font-semibold text-[#8df0c0]">
                    No starting balance required (R-multiple mode)
                  </p>
                  <p className="text-[11px] text-[#8b9ab0] leading-relaxed">
                    Performance is measured cleanly in Risk/Reward (R) multiples with no account balance needed. Switch currency above if this is a funded or monetary account.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label
                    htmlFor="journal-balance-input"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#c5d1e4]"
                  >
                    <Wallet className="w-3.5 h-3.5 text-[#8df0c0]" />
                    <span>Starting balance / challenge size *</span>
                  </label>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-[#8df0c0]">
                      {currency}
                    </span>
                    <input
                      id="journal-balance-input"
                      type="number"
                      inputMode="decimal"
                      min={VALIDATION_LIMITS.journalMonetaryBalanceMin}
                      max={VALIDATION_LIMITS.journalBalanceMax}
                      step="any"
                      value={balanceInput}
                      onChange={(e) => {
                        setBalanceInput(e.target.value);
                        if (errors.startingBalance) {
                          setErrors((prev) => ({ ...prev, startingBalance: undefined }));
                        }
                      }}
                      placeholder="10000"
                      className={`w-full min-h-[46px] rounded-xl glass-input pl-9 pr-4 py-2.5 font-mono text-base font-bold tabular-nums text-[#eef3fb] placeholder:text-[#66768f] focus:outline-none ${
                        errors.startingBalance ? 'border-[#ff7d91]/70' : ''
                      }`}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {BALANCE_PRESETS.map((preset) => {
                      const active = Number(balanceInput) === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setBalanceInput(String(preset));
                            if (errors.startingBalance) {
                              setErrors((prev) => ({ ...prev, startingBalance: undefined }));
                            }
                          }}
                          className={`min-h-[32px] rounded-lg px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border transition ${
                            active
                              ? 'bg-[#47dca0]/18 border-[#47dca0]/50 text-[#8df0c0]'
                              : 'bg-white/[0.04] border-white/[0.09] text-[#9aa8be] hover:text-[#eef3fb] hover:border-white/20'
                          }`}
                        >
                          {currency}
                          {preset >= 1000 ? `${preset / 1000}k` : preset}
                        </button>
                      );
                    })}
                  </div>

                  {errors.startingBalance ? (
                    <p className="text-xs font-medium text-[#ff7d91]">{errors.startingBalance}</p>
                  ) : (
                    <p className="text-[11px] text-[#7c8ca6]">
                      Supports small accounts from {currency}10 up to {currency}1B challenge allocations.
                    </p>
                  )}
                </div>
              )}

              {/* Profit Target */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="journal-target-input"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#c5d1e4]"
                  >
                    <Target className="w-3.5 h-3.5 text-[#8ebeff]" />
                    <span>
                      {isR
                        ? 'R profit target (optional)'
                        : 'Profit target (optional)'}
                    </span>
                  </label>
                  {targetPctPreview && (
                    <span className="font-mono text-[11px] font-semibold text-[#8df0c0] tabular-nums">
                      Target equity: {currency}
                      {(numericStart + numericTarget).toLocaleString()} (+{targetPctPreview}%)
                    </span>
                  )}
                </div>

                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-[#8ebeff]">
                    {isR ? '+R' : currency}
                  </span>
                  <input
                    id="journal-target-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={VALIDATION_LIMITS.journalTargetMax}
                    step="any"
                    value={targetInput}
                    onChange={(e) => {
                      setTargetInput(e.target.value);
                      if (errors.target) setErrors((prev) => ({ ...prev, target: undefined }));
                    }}
                    placeholder={isR ? 'e.g. 20 (for +20R target)' : 'e.g. 10000 profit target'}
                    className={`w-full min-h-[44px] rounded-xl glass-input pl-10 pr-4 py-2 font-mono text-sm font-bold tabular-nums text-[#eef3fb] placeholder:font-sans placeholder:font-normal placeholder:text-[#66768f] focus:outline-none ${
                      errors.target ? 'border-[#ff7d91]/70' : ''
                    }`}
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {isR ? (
                    R_TARGET_PRESETS.map((rVal) => {
                      const active = Number(targetInput) === rVal;
                      return (
                        <button
                          key={rVal}
                          type="button"
                          onClick={() => setTargetInput(String(rVal))}
                          className={`min-h-[30px] rounded-lg px-2.5 py-0.5 font-mono text-xs font-semibold border transition ${
                            active
                              ? 'bg-[#8ebeff]/18 border-[#8ebeff]/50 text-[#c7dfff]'
                              : 'bg-white/[0.04] border-white/[0.09] text-[#9aa8be] hover:text-[#eef3fb]'
                          }`}
                        >
                          +{rVal}R
                        </button>
                      );
                    })
                  ) : (
                    MONEY_TARGET_PCT_PRESETS.map((pct) => {
                      const validBal = Number.isFinite(numericStart) && numericStart > 0 ? numericStart : 10000;
                      const computed = Math.round(((validBal * pct) / 100) * 100) / 100;
                      const active = Number(targetInput) === computed && Boolean(targetInput.trim());
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setTargetInput(String(computed))}
                          className={`min-h-[30px] rounded-lg px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums border transition ${
                            active
                              ? 'bg-[#8ebeff]/18 border-[#8ebeff]/50 text-[#c7dfff]'
                              : 'bg-white/[0.04] border-white/[0.09] text-[#9aa8be] hover:text-[#eef3fb]'
                          }`}
                        >
                          +{pct}% ({currency}
                          {computed >= 1000 ? `${(computed / 1000).toFixed(computed % 1000 === 0 ? 0 : 1)}k` : computed})
                        </button>
                      );
                    })
                  )}
                  {targetInput.trim() && (
                    <button
                      type="button"
                      onClick={() => setTargetInput('')}
                      className="min-h-[30px] rounded-lg px-2.5 py-0.5 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-[#8b9ab0] hover:text-[#eef3fb] transition"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {errors.target && (
                  <p className="text-xs font-medium text-[#ff7d91]">{errors.target}</p>
                )}
              </div>

              {/* Prop Firm / Broker (Optional) */}
              <div className="space-y-1.5">
                <label
                  htmlFor="journal-propfirm-input"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#c5d1e4]"
                >
                  <Building2 className="w-3.5 h-3.5 text-[#8ebeff]" />
                  <span>Prop firm / account provider (optional)</span>
                </label>
                <input
                  id="journal-propfirm-input"
                  type="text"
                  maxLength={VALIDATION_LIMITS.journalPropFirmMaxLength}
                  value={propFirm}
                  onChange={(e) => {
                    setPropFirm(e.target.value);
                    if (errors.propFirm) setErrors((prev) => ({ ...prev, propFirm: undefined }));
                  }}
                  placeholder="e.g. FTMO, Apex Trader Funding, Personal Broker"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3.5 py-2 text-sm text-[#eef3fb] placeholder:text-[#66768f] focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PROP_FIRM_SUGGESTIONS.map((firm) => (
                    <button
                      key={firm}
                      type="button"
                      onClick={() => setPropFirm(firm === 'Personal' ? '' : firm)}
                      className={`min-h-[28px] rounded-lg px-2.5 py-0.5 text-[11px] font-medium border transition ${
                        (firm === 'Personal' && !propFirm.trim()) ||
                        propFirm.trim().toLowerCase() === firm.toLowerCase()
                          ? 'bg-[#8ebeff]/15 border-[#8ebeff]/45 text-[#c7dfff]'
                          : 'bg-white/[0.04] border-white/[0.08] text-[#8b9ab0] hover:text-[#eef3fb]'
                      }`}
                    >
                      {firm}
                    </button>
                  ))}
                </div>
                {errors.propFirm && (
                  <p className="text-xs font-medium text-[#ff7d91]">{errors.propFirm}</p>
                )}
              </div>

              {/* Description (Optional) */}
              <div className="space-y-1.5">
                <label
                  htmlFor="journal-description-input"
                  className="flex items-center justify-between text-xs font-semibold text-[#c5d1e4]"
                >
                  <span>Description or rules note (optional)</span>
                  <span className="font-mono text-[11px] font-normal text-[#7f8fa8] tabular-nums">
                    {description.trim().length}/{VALIDATION_LIMITS.journalDescriptionMaxLength}
                  </span>
                </label>
                <textarea
                  id="journal-description-input"
                  rows={3}
                  maxLength={VALIDATION_LIMITS.journalDescriptionMaxLength}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (errors.description) {
                      setErrors((prev) => ({ ...prev, description: undefined }));
                    }
                  }}
                  placeholder="Optional goal, drawdown rule, or session focus for this account..."
                  className="w-full rounded-xl glass-input px-3.5 py-2.5 text-sm text-[#eef3fb] placeholder:text-[#66768f] focus:outline-none resize-none"
                />
                {errors.description && (
                  <p className="text-xs font-medium text-[#ff7d91]">{errors.description}</p>
                )}
              </div>

              <div className="pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="min-h-[44px] rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-semibold text-[#eef3fb] hover:bg-white/[0.1] disabled:opacity-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] disabled:opacity-50 transition"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span>{journal ? 'Save changes' : 'Create journal'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
