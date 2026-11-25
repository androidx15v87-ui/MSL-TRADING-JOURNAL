import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Delete,
  Fingerprint,
  Loader2,
  Lock,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type BiometricModality,
  type BiometricSupportStatus,
  checkBiometricSupport,
  clearAllBiometrics,
  clearAppPin,
  enrollBiometric,
  getCachedBiometricSupport,
  getEnrolledBiometrics,
  getPinLockoutState,
  hasAppPin,
  loadLockAccountName,
  recordFailedPinAttempt,
  saveAppPin,
  verifyAppPin,
  verifyBiometric,
} from '../lib/appLock';

interface AppLockScreenProps {
  onUnlock: () => void;
  accountName?: string;
  accountLoaded?: boolean;
}

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const;

function pulseHaptic(ms = 8): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore haptic errors
    }
  }
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  onUnlock,
  accountName,
  accountLoaded = false,
}) => {
  const resolvedAccountName = useMemo(() => {
    const candidate = accountLoaded
      ? accountName || loadLockAccountName()
      : accountName || loadLockAccountName();
    return candidate.trim();
  }, [accountLoaded, accountName]);

  const [pinConfigured, setPinConfigured] = useState<boolean>(() => hasAppPin());
  const [setupFirstPin, setSetupFirstPin] = useState<string | null>(null);
  const [digits, setDigits] = useState('');
  const [unlockedSuccess, setUnlockedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [failedCount, setFailedCount] = useState<number>(() => getPinLockoutState().failedAttempts);
  const [cooldownSec, setCooldownSec] = useState<number>(() => {
    const lock = getPinLockoutState();
    return lock.lockedUntilMs > Date.now()
      ? Math.ceil((lock.lockedUntilMs - Date.now()) / 1000)
      : 0;
  });

  const [enrolled, setEnrolled] = useState(() => getEnrolledBiometrics());
  const [bioSupport, setBioSupport] = useState<BiometricSupportStatus | null>(() =>
    getCachedBiometricSupport()
  );
  const [bioBusyModality, setBioBusyModality] = useState<BiometricModality | 'any' | null>(null);
  const [postPinEnrollStep, setPostPinEnrollStep] = useState(false);
  const [pendingEnrollAfterPin, setPendingEnrollAfterPin] = useState<BiometricModality | null>(null);

  const autoPromptRanRef = useRef(false);
  const pointerHandledRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  const refreshEnrolled = useCallback(() => {
    setEnrolled(getEnrolledBiometrics());
  }, []);

  useEffect(() => {
    if (bioSupport) return;
    let active = true;
    void checkBiometricSupport().then((res) => {
      if (active) setBioSupport(res);
    });
    return () => {
      active = false;
    };
  }, [bioSupport]);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      const lock = getPinLockoutState();
      const remaining =
        lock.lockedUntilMs > Date.now()
          ? Math.ceil((lock.lockedUntilMs - Date.now()) / 1000)
          : 0;
      setCooldownSec(remaining);
      if (remaining === 0) {
        setErrorMsg(null);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    };
  }, []);

  const completeUnlockInstant = useCallback(() => {
    pulseHaptic(16);
    setUnlockedSuccess(true);
    setFailedCount(0);
    setCooldownSec(0);
    setErrorMsg(null);
    setInfoMsg(null);
    unlockTimerRef.current = window.setTimeout(() => {
      onUnlock();
    }, 200);
  }, [onUnlock]);

  const triggerShake = useCallback((message: string) => {
    pulseHaptic(24);
    setInfoMsg(null);
    setErrorMsg(message);
    setShaking(true);
    setDigits('');
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setShaking(false), 260);
  }, []);

  const handleBiometricUnlock = useCallback(
    async (modality?: BiometricModality, silentAuto = false) => {
      if (busy || bioBusyModality || unlockedSuccess) return;

      const current = getEnrolledBiometrics();
      if (modality && !current[modality]) {
        setPendingEnrollAfterPin(modality);
        setErrorMsg(null);
        setInfoMsg(
          `Enter PIN once to enable ${modality === 'faceId' ? 'Face ID' : 'Fingerprint'}`
        );
        return;
      }

      if (!current.hasAny) {
        setPendingEnrollAfterPin('fingerprint');
        setInfoMsg('Enter PIN once to enable biometric unlock');
        return;
      }

      setErrorMsg(null);
      setInfoMsg(null);
      setBioBusyModality(modality || (current.faceId && !current.fingerprint ? 'faceId' : 'any'));
      try {
        const res = await verifyBiometric(modality);
        if (res.ok) {
          completeUnlockInstant();
          return;
        }
        if (res.message && !silentAuto) {
          setErrorMsg(res.message);
        }
      } finally {
        setBioBusyModality(null);
      }
    },
    [bioBusyModality, busy, completeUnlockInstant, unlockedSuccess]
  );

  // Instant biometric prompt activation right upon AppLockScreen mount
  useEffect(() => {
    if (autoPromptRanRef.current) return;
    if (!pinConfigured || postPinEnrollStep) return;
    if (!enrolled.hasAny || !enrolled.autoPrompt) return;
    if (bioSupport && !bioSupport.available) return;

    autoPromptRanRef.current = true;
    const preferredAuto =
      enrolled.faceId && !enrolled.fingerprint
        ? 'faceId'
        : enrolled.fingerprint && !enrolled.faceId
        ? 'fingerprint'
        : undefined;
    void handleBiometricUnlock(preferredAuto, true);
  }, [
    bioSupport,
    enrolled.autoPrompt,
    enrolled.faceId,
    enrolled.fingerprint,
    enrolled.hasAny,
    handleBiometricUnlock,
    pinConfigured,
    postPinEnrollStep,
  ]);

  const handleEnrollModality = useCallback(
    async (modality: BiometricModality) => {
      if (bioBusyModality) return;
      setErrorMsg(null);
      setInfoMsg(null);
      setBioBusyModality(modality);
      try {
        const res = await enrollBiometric(modality, resolvedAccountName);
        refreshEnrolled();
        if (res.ok) {
          pulseHaptic(14);
          setInfoMsg(res.message);
        } else {
          setErrorMsg(res.message);
        }
      } finally {
        setBioBusyModality(null);
      }
    },
    [bioBusyModality, refreshEnrolled, resolvedAccountName]
  );

  const submitPin = useCallback(
    async (entered: string) => {
      if (busy || unlockedSuccess || entered.length !== 4) return;
      if (cooldownSec > 0) {
        triggerShake(`Too many attempts · wait ${cooldownSec}s`);
        return;
      }
      setBusy(true);
      try {
        if (!pinConfigured) {
          if (setupFirstPin === null) {
            setSetupFirstPin(entered);
            setDigits('');
            setErrorMsg(null);
            setInfoMsg('Re-enter your 4-digit PIN to confirm');
          } else if (entered !== setupFirstPin) {
            setSetupFirstPin(null);
            triggerShake('PINs did not match — try again');
          } else {
            await saveAppPin(entered);
            setPinConfigured(true);
            setSetupFirstPin(null);
            setDigits('');
            setErrorMsg(null);
            if (bioSupport?.available) {
              setPostPinEnrollStep(true);
              setInfoMsg(null);
            } else {
              completeUnlockInstant();
            }
          }
        } else {
          const ok = await verifyAppPin(entered);
          if (ok) {
            setFailedCount(0);
            setCooldownSec(0);
            if (pendingEnrollAfterPin) {
              const target = pendingEnrollAfterPin;
              setPendingEnrollAfterPin(null);
              setDigits('');
              setPostPinEnrollStep(true);
              setBusy(false);
              await handleEnrollModality(target);
              return;
            }
            completeUnlockInstant();
          } else {
            const lockout = recordFailedPinAttempt();
            setFailedCount(lockout.failedAttempts);
            if (lockout.lockedUntilMs > Date.now()) {
              const secs = Math.ceil((lockout.lockedUntilMs - Date.now()) / 1000);
              setCooldownSec(secs);
              triggerShake(`Too many attempts · try again in ${secs}s`);
            } else {
              triggerShake('Incorrect PIN');
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      bioSupport?.available,
      busy,
      completeUnlockInstant,
      cooldownSec,
      handleEnrollModality,
      pendingEnrollAfterPin,
      pinConfigured,
      setupFirstPin,
      triggerShake,
      unlockedSuccess,
    ]
  );

  const handlePressDigit = useCallback(
    (d: string) => {
      if (busy || bioBusyModality || postPinEnrollStep || unlockedSuccess || digits.length >= 4) {
        return;
      }
      if (cooldownSec > 0) {
        setErrorMsg(`Wait ${cooldownSec}s before trying again`);
        return;
      }
      pulseHaptic(6);
      setShaking(false);
      setErrorMsg(null);
      const next = `${digits}${d}`;
      setDigits(next);
      if (next.length === 4) {
        void submitPin(next);
      }
    },
    [bioBusyModality, busy, cooldownSec, digits, postPinEnrollStep, submitPin, unlockedSuccess]
  );

  const handleBackspace = useCallback(() => {
    if (busy || bioBusyModality || postPinEnrollStep || unlockedSuccess) return;
    pulseHaptic(4);
    setErrorMsg(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [bioBusyModality, busy, postPinEnrollStep, unlockedSuccess]);

  const handleClearOrRestartSetup = useCallback(() => {
    if (busy || bioBusyModality || unlockedSuccess) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingEnrollAfterPin(null);
    setDigits('');
    if (!pinConfigured && setupFirstPin !== null) {
      setSetupFirstPin(null);
    }
  }, [bioBusyModality, busy, pinConfigured, setupFirstPin, unlockedSuccess]);

  const handleResetPin = () => {
    clearAppPin();
    clearAllBiometrics();
    refreshEnrolled();
    setPinConfigured(false);
    setPostPinEnrollStep(false);
    setPendingEnrollAfterPin(null);
    setSetupFirstPin(null);
    setFailedCount(0);
    setCooldownSec(0);
    setDigits('');
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmReset(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmReset || postPinEnrollStep || unlockedSuccess) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handlePressDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClearOrRestartSetup();
      } else if (e.key === 'Enter' && pinConfigured && enrolled.hasAny && digits.length === 0) {
        e.preventDefault();
        void handleBiometricUnlock();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmReset,
    digits.length,
    enrolled.hasAny,
    handleBackspace,
    handleBiometricUnlock,
    handleClearOrRestartSetup,
    handlePressDigit,
    pinConfigured,
    postPinEnrollStep,
    unlockedSuccess,
  ]);

  const subtitle = unlockedSuccess
    ? 'Unlocked'
    : bioBusyModality === 'faceId'
    ? 'Scanning Face ID…'
    : bioBusyModality === 'fingerprint'
    ? 'Scanning Fingerprint…'
    : bioBusyModality === 'any'
    ? 'Verifying biometrics…'
    : postPinEnrollStep
    ? 'Enable quick biometric unlock'
    : !pinConfigured
    ? setupFirstPin === null
      ? 'Create a 4-digit PIN'
      : 'Confirm your 4-digit PIN'
    : cooldownSec > 0
    ? `Locked for ${cooldownSec}s`
    : 'Enter 4-digit PIN';

  const bindDigitHandlers = (digit: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      pointerHandledRef.current = true;
      handlePressDigit(digit);
    },
    onClick: () => {
      if (pointerHandledRef.current) {
        pointerHandledRef.current = false;
        return;
      }
      handlePressDigit(digit);
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[95] w-screen h-dvh flex flex-col justify-between bg-[#060a14]/92 backdrop-blur-2xl px-6 py-6 pt-safe pb-safe overflow-y-auto select-none"
    >
      {/* Subtle Ambient Glow */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className={`absolute -top-40 left-1/2 -translate-x-1/2 h-[520px] w-[760px] rounded-full blur-3xl transition-colors duration-300 ${
            unlockedSuccess
              ? 'bg-[radial-gradient(circle,rgba(71,220,160,0.28)_0%,transparent_70%)]'
              : errorMsg || cooldownSec > 0
              ? 'bg-[radial-gradient(circle,rgba(255,125,145,0.2)_0%,transparent_70%)]'
              : 'bg-[radial-gradient(circle,rgba(71,220,160,0.14)_0%,rgba(142,190,255,0.08)_48%,transparent_72%)]'
          }`}
        />
      </div>

      <div className="h-2 shrink-0" aria-hidden="true" />

      <main className="relative w-full max-w-[332px] mx-auto my-auto flex flex-col items-center text-center gap-6">
        {/* Lock Crest & Account Name */}
        <div className="flex flex-col items-center gap-3">
          <div
            className={`h-14 w-14 rounded-2xl border flex items-center justify-center transition-colors duration-150 ${
              unlockedSuccess
                ? 'bg-[#47dca0]/20 border-[#47dca0] text-[#47dca0] shadow-[0_0_24px_rgba(71,220,160,0.4)]'
                : errorMsg || cooldownSec > 0
                ? 'bg-[#ff7d91]/15 border-[#ff7d91]/50 text-[#ff7d91]'
                : bioBusyModality
                ? 'bg-[#47dca0]/15 border-[#47dca0]/50 text-[#8df0c0]'
                : 'bg-white/[0.06] border-white/[0.12] text-[#8df0c0]'
            }`}
          >
            {unlockedSuccess ? (
              <Unlock className="w-6 h-6" />
            ) : bioBusyModality === 'faceId' ? (
              <ScanFace className="w-6 h-6 text-[#8df0c0]" />
            ) : bioBusyModality ? (
              <Loader2 className="w-6 h-6 animate-spin text-[#47dca0]" />
            ) : pinConfigured ? (
              <Lock className="w-6 h-6" />
            ) : (
              <ShieldCheck className="w-6 h-6" />
            )}
          </div>

          <div className="space-y-1">
            <AnimatePresence mode="wait">
              <motion.h1
                key={resolvedAccountName || 'private-vault'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="font-display text-xl font-bold tracking-tight text-[#eef3fb] truncate max-w-[280px]"
              >
                {resolvedAccountName || 'Private Vault'}
              </motion.h1>
            </AnimatePresence>
            <p
              className={`text-xs font-medium tabular-nums ${
                unlockedSuccess
                  ? 'text-[#47dca0]'
                  : cooldownSec > 0
                  ? 'text-[#ff7d91]'
                  : bioBusyModality
                  ? 'text-[#8df0c0]'
                  : 'text-[#8b9ab0]'
              }`}
            >
              {subtitle}
            </p>
          </div>
        </div>

        {postPinEnrollStep ? (
          <div className="w-full space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleEnrollModality('fingerprint')}
                disabled={Boolean(bioBusyModality)}
                className={`rounded-2xl border p-4 flex flex-col items-center gap-2.5 transition ${
                  enrolled.fingerprint
                    ? 'border-[#47dca0]/50 bg-[#47dca0]/10'
                    : 'border-white/[0.12] bg-white/[0.04] hover:border-[#47dca0]/40'
                }`}
              >
                <span
                  className={`h-11 w-11 rounded-full border flex items-center justify-center transition ${
                    enrolled.fingerprint
                      ? 'bg-[#47dca0]/20 border-[#47dca0]/60 text-[#8df0c0]'
                      : 'bg-white/[0.06] border-white/[0.12] text-[#8df0c0]'
                  }`}
                >
                  {bioBusyModality === 'fingerprint' ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[#47dca0]" />
                  ) : enrolled.fingerprint ? (
                    <CheckCircle2 className="w-5 h-5 text-[#47dca0]" />
                  ) : (
                    <Fingerprint className="w-5 h-5" />
                  )}
                </span>
                <span className="text-xs font-semibold text-[#eef3fb]">
                  {enrolled.fingerprint ? 'Fingerprint linked' : 'Fingerprint'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleEnrollModality('faceId')}
                disabled={Boolean(bioBusyModality)}
                className={`rounded-2xl border p-4 flex flex-col items-center gap-2.5 transition ${
                  enrolled.faceId
                    ? 'border-[#8ebeff]/50 bg-[#8ebeff]/10'
                    : 'border-white/[0.12] bg-white/[0.04] hover:border-[#8ebeff]/40'
                }`}
              >
                <span
                  className={`h-11 w-11 rounded-full border flex items-center justify-center transition ${
                    enrolled.faceId
                      ? 'bg-[#8ebeff]/20 border-[#8ebeff]/60 text-[#eef3fb]'
                      : 'bg-white/[0.06] border-white/[0.12] text-[#8ebeff]'
                  }`}
                >
                  {bioBusyModality === 'faceId' ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[#8ebeff]" />
                  ) : enrolled.faceId ? (
                    <CheckCircle2 className="w-5 h-5 text-[#8ebeff]" />
                  ) : (
                    <ScanFace className="w-5 h-5" />
                  )}
                </span>
                <span className="text-xs font-semibold text-[#eef3fb]">
                  {enrolled.faceId ? 'Face ID linked' : 'Face ID'}
                </span>
              </button>
            </div>

            {(errorMsg || infoMsg) && (
              <p
                className={`text-xs ${errorMsg ? 'text-[#ff7d91]' : 'text-[#8df0c0]'}`}
                role={errorMsg ? 'alert' : 'status'}
              >
                {errorMsg || infoMsg}
              </p>
            )}

            <button
              type="button"
              onClick={completeUnlockInstant}
              className="w-full min-h-[44px] rounded-xl bg-[#47dca0] text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition"
            >
              {enrolled.hasAny ? 'Continue' : 'Skip for now'}
            </button>
          </div>
        ) : (
          <>
            {/* 4-Dot PIN Indicator */}
            <motion.div
              animate={shaking ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
              transition={{ duration: 0.24 }}
              className="w-full space-y-2.5"
            >
              <div
                className="flex items-center justify-center gap-4"
                role="status"
                aria-label={`${digits.length} of 4 digits entered`}
              >
                {[0, 1, 2, 3].map((slot) => {
                  const filled = unlockedSuccess || slot < digits.length;
                  return (
                    <div
                      key={slot}
                      className={`h-3.5 w-3.5 rounded-full border transition-all duration-100 ${
                        errorMsg
                          ? 'border-[#ff7d91] bg-[#ff7d91]/30'
                          : filled
                          ? 'border-[#47dca0] bg-[#47dca0] scale-110 shadow-[0_0_12px_rgba(71,220,160,0.65)]'
                          : 'border-white/25 bg-white/[0.06]'
                      }`}
                    />
                  );
                })}
              </div>

              <div className="min-h-[18px] px-2">
                {errorMsg ? (
                  <p className="text-xs font-medium text-[#ff7d91] tabular-nums" role="alert">
                    {errorMsg}
                  </p>
                ) : infoMsg ? (
                  <p className="text-xs font-medium text-[#8df0c0] leading-snug" role="status">
                    {infoMsg}
                  </p>
                ) : failedCount > 0 ? (
                  <p className="text-[11px] text-[#7f8fa8] tabular-nums">
                    {failedCount} failed attempt{failedCount === 1 ? '' : 's'}
                  </p>
                ) : null}
              </div>
            </motion.div>

            {/* Circular Numeric Keypad */}
            <div className="grid grid-cols-3 gap-x-5 gap-y-3.5 justify-items-center">
              {KEYPAD_ROWS.flat().map((num) => (
                <button
                  key={num}
                  type="button"
                  {...bindDigitHandlers(num)}
                  disabled={busy || Boolean(bioBusyModality) || cooldownSec > 0}
                  className="h-[64px] w-[64px] sm:h-[68px] sm:w-[68px] rounded-full bg-white/[0.06] border border-white/[0.12] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.11] hover:border-white/[0.22] active:scale-92 active:bg-[#47dca0]/20 active:border-[#47dca0]/50 transition-all duration-75 touch-manipulation"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleClearOrRestartSetup}
                disabled={busy || (!digits && setupFirstPin === null && !pendingEnrollAfterPin)}
                className="h-[64px] w-[64px] sm:h-[68px] sm:w-[68px] rounded-full text-xs font-medium text-[#8b9ab0] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                {!pinConfigured && setupFirstPin !== null ? 'Reset' : 'Clear'}
              </button>

              <button
                type="button"
                {...bindDigitHandlers('0')}
                disabled={busy || Boolean(bioBusyModality) || cooldownSec > 0}
                className="h-[64px] w-[64px] sm:h-[68px] sm:w-[68px] rounded-full bg-white/[0.06] border border-white/[0.12] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.11] hover:border-white/[0.22] active:scale-92 active:bg-[#47dca0]/20 active:border-[#47dca0]/50 transition-all duration-75 touch-manipulation"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                disabled={busy || digits.length === 0}
                aria-label="Delete last digit"
                className="h-[64px] w-[64px] sm:h-[68px] sm:w-[68px] rounded-full flex items-center justify-center text-[#9aa8be] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>

            {/* Biometric Triggers */}
            {pinConfigured && (
              <div className="flex items-center justify-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => void handleBiometricUnlock('fingerprint')}
                  disabled={busy || Boolean(bioBusyModality)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                    enrolled.fingerprint
                      ? 'border-[#47dca0]/35 bg-[#47dca0]/10 text-[#8df0c0] hover:border-[#47dca0]/60'
                      : 'border-white/[0.1] bg-white/[0.04] text-[#8b9ab0] hover:text-[#eef3fb]'
                  }`}
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>Fingerprint</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleBiometricUnlock('faceId')}
                  disabled={busy || Boolean(bioBusyModality)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                    enrolled.faceId
                      ? 'border-[#8ebeff]/35 bg-[#8ebeff]/10 text-[#8ebeff] hover:border-[#8ebeff]/60'
                      : 'border-white/[0.1] bg-white/[0.04] text-[#8b9ab0] hover:text-[#eef3fb]'
                  }`}
                >
                  <ScanFace className="w-4 h-4" />
                  <span>Face ID</span>
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom Footer */}
      <footer className="relative max-w-xs w-full mx-auto text-center space-y-2.5 pt-3">
        {pinConfigured && !confirmReset && !postPinEnrollStep && (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="text-xs font-medium text-[#7c8ca6] hover:text-[#8df0c0] transition"
          >
            Forgot PIN?
          </button>
        )}

        {confirmReset && (
          <div className="rounded-2xl border border-white/[0.12] bg-white/[0.05] p-3 space-y-2 text-center">
            <p className="text-xs text-[#c9d4e7]">Reset 4-digit PIN &amp; biometrics?</p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="min-h-[34px] rounded-xl px-3.5 text-xs font-medium text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPin}
                className="min-h-[34px] inline-flex items-center gap-1 rounded-xl bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#6d7d96]">
          Encrypted local vault · Developed by ANDROID
        </p>
      </footer>
    </motion.div>
  );
};
