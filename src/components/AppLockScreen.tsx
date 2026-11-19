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

const RING_RADIUS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function pulseHaptic(ms = 8): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore haptic errors
    }
  }
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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

  const greetingPrefix = useMemo(() => getTimeOfDayGreeting(), []);

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
  const [cooldownTotalSec, setCooldownTotalSec] = useState<number>(0);
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
    if (cooldownTotalSec < cooldownSec) {
      setCooldownTotalSec(cooldownSec);
    }
    const timer = window.setInterval(() => {
      const lock = getPinLockoutState();
      const remaining =
        lock.lockedUntilMs > Date.now()
          ? Math.ceil((lock.lockedUntilMs - Date.now()) / 1000)
          : 0;
      setCooldownSec(remaining);
      if (remaining === 0) {
        setCooldownTotalSec(0);
        setErrorMsg(null);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [cooldownSec, cooldownTotalSec]);

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
    setCooldownTotalSec(0);
    setErrorMsg(null);
    setInfoMsg(null);
    unlockTimerRef.current = window.setTimeout(() => {
      onUnlock();
    }, 110);
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
          `Enter PIN to link ${modality === 'faceId' ? 'Face ID' : 'Fingerprint'}`
        );
        return;
      }

      if (!current.hasAny) {
        setPendingEnrollAfterPin('fingerprint');
        setInfoMsg('Enter PIN first to activate biometrics');
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

  // Instant 0ms biometric prompt activation right upon AppLockScreen mount
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
        triggerShake(`Security hold · ${cooldownSec}s remaining`);
        return;
      }
      setBusy(true);
      try {
        if (!pinConfigured) {
          if (setupFirstPin === null) {
            setSetupFirstPin(entered);
            setDigits('');
            setErrorMsg(null);
            setInfoMsg('Re-enter the 4 digits to confirm');
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
            setCooldownTotalSec(0);
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
              setCooldownTotalSec(secs);
              setCooldownSec(secs);
              triggerShake(`Security cooldown · try again in ${secs}s`);
            } else {
              const triesUntilHold = 5 - (lockout.failedAttempts % 5);
              triggerShake(
                lockout.failedAttempts >= 2 && triesUntilHold > 0
                  ? `Incorrect PIN · ${triesUntilHold} attempt${triesUntilHold === 1 ? '' : 's'} before hold`
                  : 'Incorrect PIN'
              );
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
    setCooldownTotalSec(0);
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

  const statusCue = unlockedSuccess
    ? 'Vault unlocked'
    : bioBusyModality === 'faceId'
    ? 'Scanning Face ID…'
    : bioBusyModality === 'fingerprint'
    ? 'Verifying Fingerprint…'
    : bioBusyModality === 'any'
    ? 'Verifying biometrics…'
    : postPinEnrollStep
    ? 'Enable one-tap biometric unlock'
    : !pinConfigured
    ? setupFirstPin === null
      ? 'Create your 4-digit security PIN'
      : 'Confirm your 4-digit PIN'
    : cooldownSec > 0
    ? `Temporary security hold · ${cooldownSec}s`
    : enrolled.hasAny
    ? 'Use Fingerprint / Face ID or enter PIN'
    : 'Enter 4-digit PIN';

  const progressFraction = unlockedSuccess ? 1 : digits.length / 4;
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progressFraction);
  const ringStroke = errorMsg || cooldownSec > 0
    ? '#ff7d91'
    : unlockedSuccess || digits.length > 0 || bioBusyModality
    ? '#47dca0'
    : 'rgba(142, 190, 255, 0.32)';

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

  const cooldownBarPct =
    cooldownTotalSec > 0 && cooldownSec > 0
      ? Math.max(0, Math.min(100, (cooldownSec / cooldownTotalSec) * 100))
      : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[95] w-screen h-dvh flex flex-col justify-between bg-[#040812]/86 backdrop-blur-3xl saturate-150 px-6 py-7 pt-safe pb-safe overflow-y-auto select-none"
    >
      {/* Full-Screen Immersive Glassmorphism Light & Specular Refraction Field */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className={`absolute -top-48 left-1/2 -translate-x-1/2 h-[620px] w-[920px] rounded-full blur-3xl transition-opacity duration-300 ${
            unlockedSuccess
              ? 'bg-[radial-gradient(circle,rgba(71,220,160,0.34)_0%,rgba(141,240,192,0.14)_45%,transparent_72%)]'
              : errorMsg || cooldownSec > 0
              ? 'bg-[radial-gradient(circle,rgba(255,125,145,0.24)_0%,rgba(71,220,160,0.06)_50%,transparent_74%)]'
              : 'bg-[radial-gradient(circle,rgba(71,220,160,0.19)_0%,rgba(142,190,255,0.11)_46%,transparent_74%)]'
          }`}
        />
        <div className="absolute -bottom-52 left-1/2 -translate-x-1/2 h-[500px] w-[760px] rounded-full bg-[radial-gradient(circle,rgba(142,190,255,0.14)_0%,rgba(71,220,160,0.05)_48%,transparent_72%)] blur-3xl" />
        {/* Concentric hairline refraction halos */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[540px] w-[540px] sm:h-[660px] sm:w-[660px] rounded-full border border-white/[0.045]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[740px] w-[740px] sm:h-[920px] sm:w-[920px] rounded-full border border-[#8ebeff]/[0.035]" />
        {/* Top specular glass sheen */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      </div>

      <div className="h-2 shrink-0" aria-hidden="true" />

      {/* Center Interactive Liquid-Glass Security Stage */}
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md mx-auto my-auto flex flex-col items-center text-center gap-6"
      >
        {/* Orbital Progress Ring Crest + Dynamically Centered Saved Account Name */}
        <div className="w-full flex flex-col items-center text-center space-y-3.5">
          <div className="relative mx-auto h-[72px] w-[72px] flex items-center justify-center">
            <svg
              viewBox="0 0 68 68"
              className="absolute inset-0 h-[72px] w-[72px] -rotate-90 overflow-visible"
              aria-hidden="true"
            >
              <circle
                cx="34"
                cy="34"
                r={RING_RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.09)"
                strokeWidth="2"
              />
              <circle
                cx="34"
                cy="34"
                r={RING_RADIUS}
                fill="none"
                stroke={ringStroke}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-150 ease-out"
              />
            </svg>

            <div
              className={`h-13 w-13 rounded-full backdrop-blur-xl border flex items-center justify-center transition-all duration-150 ${
                unlockedSuccess
                  ? 'bg-[#47dca0]/24 border-[#47dca0] text-[#47dca0] scale-105 shadow-[0_0_28px_rgba(71,220,160,0.45)]'
                  : errorMsg || cooldownSec > 0
                  ? 'bg-[#ff7d91]/14 border-[#ff7d91]/55 text-[#ff7d91]'
                  : bioBusyModality
                  ? 'bg-[#47dca0]/14 border-[#47dca0]/55 text-[#8df0c0] shadow-[0_0_24px_rgba(71,220,160,0.28)]'
                  : 'bg-white/[0.08] border-white/[0.18] text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
              }`}
            >
              {unlockedSuccess ? (
                <Unlock className="w-5 h-5" />
              ) : bioBusyModality === 'faceId' ? (
                <ScanFace className="w-5 h-5 text-[#8df0c0]" />
              ) : bioBusyModality ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#47dca0]" />
              ) : pinConfigured ? (
                <Lock className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
          </div>

          <div className="w-full flex flex-col items-center text-center space-y-1.5 px-2">
            <p className="text-xs font-medium tracking-wide text-[#95a6bf]">
              {greetingPrefix}
            </p>
            <AnimatePresence mode="wait">
              <motion.h1
                key={resolvedAccountName || 'private-vault'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-sm mx-auto text-center font-display text-2xl sm:text-3xl font-extrabold tracking-tight [text-wrap:balance] bg-gradient-to-b from-[#ffffff] via-[#eef3fb] to-[#8df0c0] bg-clip-text text-transparent truncate"
              >
                {resolvedAccountName || 'Private Vault'}
              </motion.h1>
            </AnimatePresence>
            <p
              className={`text-xs font-medium tabular-nums transition-colors ${
                unlockedSuccess
                  ? 'text-[#47dca0]'
                  : cooldownSec > 0
                  ? 'text-[#ff7d91]'
                  : bioBusyModality
                  ? 'text-[#8df0c0]'
                  : 'text-[#8b9ab0]'
              }`}
            >
              {statusCue}
            </p>
          </div>
        </div>

        {postPinEnrollStep ? (
          <div className="w-full max-w-[300px] space-y-6">
            <div className="flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => void handleEnrollModality('fingerprint')}
                disabled={Boolean(bioBusyModality)}
                className="flex flex-col items-center gap-2 group"
              >
                <span
                  className={`h-16 w-16 rounded-full backdrop-blur-xl border flex items-center justify-center transition ${
                    enrolled.fingerprint
                      ? 'bg-[#47dca0]/20 border-[#47dca0]/60 text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'bg-white/[0.07] border-white/[0.16] text-[#c9d4e7] group-hover:border-[#47dca0]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                  }`}
                >
                  {bioBusyModality === 'fingerprint' ? (
                    <Loader2 className="w-6 h-6 animate-spin text-[#47dca0]" />
                  ) : enrolled.fingerprint ? (
                    <CheckCircle2 className="w-6 h-6 text-[#47dca0]" />
                  ) : (
                    <Fingerprint className="w-6 h-6 text-[#8df0c0]" />
                  )}
                </span>
                <span className="text-xs font-medium text-[#b8c6db]">Fingerprint</span>
              </button>

              <button
                type="button"
                onClick={() => void handleEnrollModality('faceId')}
                disabled={Boolean(bioBusyModality)}
                className="flex flex-col items-center gap-2 group"
              >
                <span
                  className={`h-16 w-16 rounded-full backdrop-blur-xl border flex items-center justify-center transition ${
                    enrolled.faceId
                      ? 'bg-[#8ebeff]/20 border-[#8ebeff]/60 text-[#eef3fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'bg-white/[0.07] border-white/[0.16] text-[#c9d4e7] group-hover:border-[#8ebeff]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                  }`}
                >
                  {bioBusyModality === 'faceId' ? (
                    <Loader2 className="w-6 h-6 animate-spin text-[#8ebeff]" />
                  ) : enrolled.faceId ? (
                    <CheckCircle2 className="w-6 h-6 text-[#8ebeff]" />
                  ) : (
                    <ScanFace className="w-6 h-6 text-[#8ebeff]" />
                  )}
                </span>
                <span className="text-xs font-medium text-[#b8c6db]">Face ID</span>
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
              className="w-full min-h-[46px] rounded-full bg-[#47dca0] text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition"
            >
              {enrolled.hasAny ? 'Enter workspace' : 'Skip for now'}
            </button>
          </div>
        ) : (
          <>
            {/* Instant 4-Dot PIN Indicator + Cooldown Progress Bar */}
            <motion.div
              animate={shaking ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
              transition={{ duration: 0.24 }}
              className="w-full max-w-[260px] space-y-2.5"
            >
              <div
                className="flex items-center justify-center gap-5"
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
                          ? 'border-[#ff7d91] bg-[#ff7d91]/35'
                          : filled
                          ? 'border-[#47dca0] bg-[#47dca0] scale-115 shadow-[0_0_16px_rgba(71,220,160,0.8)]'
                          : 'border-white/30 bg-white/[0.06] backdrop-blur-md'
                      }`}
                    />
                  );
                })}
              </div>

              {cooldownSec > 0 && (
                <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-[#ff7d91] transition-all duration-200"
                    style={{ width: `${cooldownBarPct}%` }}
                  />
                </div>
              )}

              <div className="min-h-[18px]">
                {errorMsg ? (
                  <p className="text-xs font-medium text-[#ff7d91] tabular-nums" role="alert">
                    {errorMsg}
                  </p>
                ) : infoMsg ? (
                  <p className="text-xs font-medium text-[#8df0c0]" role="status">
                    {infoMsg}
                  </p>
                ) : failedCount > 0 && pinConfigured ? (
                  <p className="text-[11px] text-[#7f8fa8] tabular-nums">
                    Vault protection active
                  </p>
                ) : null}
              </div>
            </motion.div>

            {/* Instant-Response Frosted Liquid-Glass Keypad */}
            <div className="grid grid-cols-3 gap-x-5 gap-y-3.5 justify-items-center">
              {KEYPAD_ROWS.flat().map((num) => (
                <button
                  key={num}
                  type="button"
                  {...bindDigitHandlers(num)}
                  disabled={busy || Boolean(bioBusyModality) || cooldownSec > 0}
                  className="h-[70px] w-[70px] rounded-full bg-white/[0.065] backdrop-blur-xl border border-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_28px_-14px_rgba(0,0,0,0.65)] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.12] hover:border-[#47dca0]/50 active:scale-90 active:bg-[#47dca0]/22 transition-all duration-75 touch-manipulation"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleClearOrRestartSetup}
                disabled={busy || (!digits && setupFirstPin === null && !pendingEnrollAfterPin)}
                className="h-[70px] w-[70px] rounded-full text-xs font-medium text-[#8b9ab0] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                {!pinConfigured && setupFirstPin !== null ? 'Reset' : 'Clear'}
              </button>

              <button
                type="button"
                {...bindDigitHandlers('0')}
                disabled={busy || Boolean(bioBusyModality) || cooldownSec > 0}
                className="h-[70px] w-[70px] rounded-full bg-white/[0.065] backdrop-blur-xl border border-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_28px_-14px_rgba(0,0,0,0.65)] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.12] hover:border-[#47dca0]/50 active:scale-90 active:bg-[#47dca0]/22 transition-all duration-75 touch-manipulation"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                disabled={busy || digits.length === 0}
                aria-label="Delete last digit"
                className="h-[70px] w-[70px] rounded-full flex items-center justify-center text-[#9aa8be] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>

            {/* Biometric Quick Unlock & Setup Triggers */}
            {pinConfigured && (
              <div className="flex items-center justify-center gap-8 pt-1">
                <button
                  type="button"
                  onClick={() => void handleBiometricUnlock('fingerprint')}
                  disabled={busy || Boolean(bioBusyModality)}
                  aria-label={enrolled.fingerprint ? 'Unlock with Fingerprint' : 'Enroll Fingerprint'}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span
                    className={`h-13 w-13 rounded-full backdrop-blur-xl border flex items-center justify-center transition active:scale-90 ${
                      enrolled.fingerprint
                        ? 'bg-[#47dca0]/18 border-[#47dca0]/60 text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_24px_-6px_rgba(71,220,160,0.5)]'
                        : 'bg-white/[0.06] border-white/[0.14] text-[#9aa8be] group-hover:text-[#8df0c0] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                    }`}
                  >
                    {bioBusyModality === 'fingerprint' || bioBusyModality === 'any' ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#47dca0]" />
                    ) : (
                      <Fingerprint className="w-5 h-5" />
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-[#9aa8be]">
                    {enrolled.fingerprint ? 'Fingerprint' : 'Add Touch'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleBiometricUnlock('faceId')}
                  disabled={busy || Boolean(bioBusyModality)}
                  aria-label={enrolled.faceId ? 'Unlock with Face ID' : 'Enroll Face ID'}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span
                    className={`h-13 w-13 rounded-full backdrop-blur-xl border flex items-center justify-center transition active:scale-90 ${
                      enrolled.faceId
                        ? 'bg-[#8ebeff]/18 border-[#8ebeff]/60 text-[#eef3fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_24px_-6px_rgba(142,190,255,0.5)]'
                        : 'bg-white/[0.06] border-white/[0.14] text-[#9aa8be] group-hover:text-[#8ebeff] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                    }`}
                  >
                    {bioBusyModality === 'faceId' ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#8ebeff]" />
                    ) : (
                      <ScanFace className="w-5 h-5" />
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-[#9aa8be]">
                    {enrolled.faceId ? 'Face ID' : 'Add Face'}
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </motion.main>

      {/* Quiet Bottom Footer */}
      <footer className="relative max-w-xs w-full mx-auto text-center space-y-2.5 pt-2">
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
          <div className="rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/[0.14] p-3 space-y-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
            <p className="text-xs text-[#c9d4e7]">Reset 4-digit PIN &amp; biometrics?</p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="min-h-[34px] rounded-full px-3.5 text-xs font-medium text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPin}
                className="min-h-[34px] inline-flex items-center gap-1 rounded-full bg-[#47dca0] px-3.5 text-xs font-bold text-[#051612] hover:bg-[#62e4b0] transition"
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
