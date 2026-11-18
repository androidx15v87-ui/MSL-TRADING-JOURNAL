import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Delete,
  Fingerprint,
  Loader2,
  Lock,
  RotateCcw,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  type BiometricModality,
  type BiometricSupportStatus,
  checkBiometricSupport,
  clearAllBiometrics,
  clearAppPin,
  enrollBiometric,
  getEnrolledBiometrics,
  hasAppPin,
  loadLockAccountName,
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

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  onUnlock,
  accountName,
  accountLoaded = false,
}) => {
  const resolvedAccountName = (
    accountLoaded ? accountName || '' : accountName || loadLockAccountName()
  ).trim();
  const [pinConfigured, setPinConfigured] = useState<boolean>(() => hasAppPin());
  const [setupFirstPin, setSetupFirstPin] = useState<string | null>(null);
  const [digits, setDigits] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [enrolled, setEnrolled] = useState(() => getEnrolledBiometrics());
  const [bioSupport, setBioSupport] = useState<BiometricSupportStatus | null>(null);
  const [bioBusyModality, setBioBusyModality] = useState<BiometricModality | 'any' | null>(null);
  const [postPinEnrollStep, setPostPinEnrollStep] = useState(false);
  const [pendingEnrollAfterPin, setPendingEnrollAfterPin] = useState<BiometricModality | null>(null);

  const autoPromptRanRef = useRef(false);

  const refreshEnrolled = useCallback(() => {
    setEnrolled(getEnrolledBiometrics());
  }, []);

  useEffect(() => {
    let active = true;
    checkBiometricSupport().then((res) => {
      if (active) setBioSupport(res);
    });
    return () => {
      active = false;
    };
  }, []);

  const triggerShake = useCallback((message: string) => {
    setInfoMsg(null);
    setErrorMsg(message);
    setShaking(true);
    setDigits('');
    window.setTimeout(() => setShaking(false), 360);
  }, []);

  const handleBiometricUnlock = useCallback(
    async (modality?: BiometricModality) => {
      if (busy || bioBusyModality) return;

      const current = getEnrolledBiometrics();
      if (modality && !current[modality]) {
        setPendingEnrollAfterPin(modality);
        setErrorMsg(null);
        setInfoMsg(
          `Enter PIN to enroll ${modality === 'faceId' ? 'Face ID' : 'Fingerprint'}`
        );
        return;
      }

      if (!current.hasAny) {
        setPendingEnrollAfterPin('fingerprint');
        setInfoMsg('Enter PIN first to set up biometrics');
        return;
      }

      setErrorMsg(null);
      setInfoMsg(null);
      setBioBusyModality(modality || 'any');
      try {
        const res = await verifyBiometric(modality);
        if (res.ok) {
          onUnlock();
          return;
        }
        if (res.message) {
          setErrorMsg(res.message);
        }
      } finally {
        setBioBusyModality(null);
      }
    },
    [bioBusyModality, busy, onUnlock]
  );

  useEffect(() => {
    if (autoPromptRanRef.current) return;
    if (!pinConfigured || postPinEnrollStep) return;
    if (!enrolled.hasAny || !enrolled.autoPrompt) return;
    if (!bioSupport?.available) return;

    autoPromptRanRef.current = true;
    const timer = window.setTimeout(() => {
      void handleBiometricUnlock();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [bioSupport, enrolled.autoPrompt, enrolled.hasAny, handleBiometricUnlock, pinConfigured, postPinEnrollStep]);

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
      if (busy || entered.length !== 4) return;
      setBusy(true);
      try {
        if (!pinConfigured) {
          if (setupFirstPin === null) {
            setSetupFirstPin(entered);
            setDigits('');
            setErrorMsg(null);
            setInfoMsg(null);
          } else if (entered !== setupFirstPin) {
            setSetupFirstPin(null);
            triggerShake('PINs did not match');
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
              onUnlock();
            }
          }
        } else {
          const ok = await verifyAppPin(entered);
          if (ok) {
            if (pendingEnrollAfterPin) {
              const target = pendingEnrollAfterPin;
              setPendingEnrollAfterPin(null);
              setDigits('');
              setPostPinEnrollStep(true);
              setBusy(false);
              await handleEnrollModality(target);
              return;
            }
            onUnlock();
          } else {
            triggerShake('Incorrect PIN');
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      bioSupport?.available,
      busy,
      handleEnrollModality,
      onUnlock,
      pendingEnrollAfterPin,
      pinConfigured,
      setupFirstPin,
      triggerShake,
    ]
  );

  const handlePressDigit = useCallback(
    (d: string) => {
      if (busy || bioBusyModality || postPinEnrollStep || digits.length >= 4) return;
      setErrorMsg(null);
      const next = `${digits}${d}`;
      setDigits(next);
      if (next.length === 4) {
        void submitPin(next);
      }
    },
    [bioBusyModality, busy, digits, postPinEnrollStep, submitPin]
  );

  const handleBackspace = useCallback(() => {
    if (busy || bioBusyModality || postPinEnrollStep) return;
    setErrorMsg(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [bioBusyModality, busy, postPinEnrollStep]);

  const handleClearOrRestartSetup = useCallback(() => {
    if (busy || bioBusyModality) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingEnrollAfterPin(null);
    setDigits('');
    if (!pinConfigured && setupFirstPin !== null) {
      setSetupFirstPin(null);
    }
  }, [bioBusyModality, busy, pinConfigured, setupFirstPin]);

  const handleResetPin = () => {
    clearAppPin();
    clearAllBiometrics();
    refreshEnrolled();
    setPinConfigured(false);
    setPostPinEnrollStep(false);
    setPendingEnrollAfterPin(null);
    setSetupFirstPin(null);
    setDigits('');
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmReset(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmReset || postPinEnrollStep) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handlePressDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClearOrRestartSetup();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmReset,
    handleBackspace,
    handleClearOrRestartSetup,
    handlePressDigit,
    postPinEnrollStep,
  ]);

  const statusCue = postPinEnrollStep
    ? 'Add biometrics'
    : !pinConfigured
    ? setupFirstPin === null
      ? 'Set 4-digit PIN'
      : 'Confirm PIN'
    : 'Enter PIN';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[95] w-screen h-dvh flex flex-col justify-between bg-[#050912] px-6 py-8 pt-safe pb-safe overflow-y-auto select-none"
    >
      {/* Ultra-Immersive Full-Screen Edge-to-Edge Aurora Depth */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[540px] w-[760px] rounded-full bg-[radial-gradient(circle,rgba(71,220,160,0.14)_0%,rgba(142,190,255,0.06)_48%,transparent_72%)] blur-3xl" />
        <div className="absolute -bottom-44 left-1/2 -translate-x-1/2 h-[420px] w-[620px] rounded-full bg-[radial-gradient(circle,rgba(142,190,255,0.10)_0%,transparent_70%)] blur-3xl" />
      </div>

      <div className="h-2 shrink-0" aria-hidden="true" />

      {/* Center Minimal Immersive Vault */}
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm mx-auto my-auto flex flex-col items-center text-center gap-7"
      >
        {/* Minimal Lock Crest + Welcome back ANDROID */}
        <div className="space-y-3.5">
          <div className="mx-auto h-12 w-12 rounded-full bg-white/[0.05] border border-white/[0.12] flex items-center justify-center text-[#8df0c0]">
            {pinConfigured ? (
              <Lock className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eef3fb] [text-wrap:balance]">
              {resolvedAccountName ? (
                <>
                  Welcome back <span className="text-[#8df0c0]">{resolvedAccountName}</span>
                </>
              ) : (
                'Welcome back'
              )}
            </h1>
            <p className="text-xs font-medium text-[#7f8fa8]">{statusCue}</p>
          </div>
        </div>

        {postPinEnrollStep ? (
          <div className="w-full max-w-[280px] space-y-6">
            <div className="flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => void handleEnrollModality('fingerprint')}
                disabled={Boolean(bioBusyModality)}
                className="flex flex-col items-center gap-2 group"
              >
                <span
                  className={`h-16 w-16 rounded-full border flex items-center justify-center transition ${
                    enrolled.fingerprint
                      ? 'bg-[#47dca0]/18 border-[#47dca0]/60 text-[#8df0c0]'
                      : 'bg-white/[0.045] border-white/[0.1] text-[#c9d4e7] group-hover:border-[#47dca0]/50'
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
                <span className="text-xs font-medium text-[#a9b7cc]">Fingerprint</span>
              </button>

              <button
                type="button"
                onClick={() => void handleEnrollModality('faceId')}
                disabled={Boolean(bioBusyModality)}
                className="flex flex-col items-center gap-2 group"
              >
                <span
                  className={`h-16 w-16 rounded-full border flex items-center justify-center transition ${
                    enrolled.faceId
                      ? 'bg-[#8ebeff]/18 border-[#8ebeff]/60 text-[#eef3fb]'
                      : 'bg-white/[0.045] border-white/[0.1] text-[#c9d4e7] group-hover:border-[#8ebeff]/50'
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
                <span className="text-xs font-medium text-[#a9b7cc]">Face ID</span>
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
              onClick={onUnlock}
              className="w-full min-h-[46px] rounded-full bg-[#47dca0] text-sm font-bold text-[#051612] hover:bg-[#62e4b0] active:scale-[0.98] transition"
            >
              {enrolled.hasAny ? 'Continue' : 'Skip for now'}
            </button>
          </div>
        ) : (
          <>
            {/* Minimal 4-Dot PIN Feedback */}
            <motion.div
              animate={shaking ? { x: [0, -9, 9, -6, 6, 0] } : { x: 0 }}
              transition={{ duration: 0.32 }}
              className="space-y-2.5"
            >
              <div
                className="flex items-center justify-center gap-5"
                role="status"
                aria-label={`${digits.length} of 4 digits entered`}
              >
                {[0, 1, 2, 3].map((slot) => {
                  const filled = slot < digits.length;
                  return (
                    <div
                      key={slot}
                      className={`h-3.5 w-3.5 rounded-full border transition-all duration-150 ${
                        errorMsg
                          ? 'border-[#ff7d91] bg-[#ff7d91]/35'
                          : filled
                          ? 'border-[#47dca0] bg-[#47dca0] scale-115 shadow-[0_0_16px_rgba(71,220,160,0.75)]'
                          : 'border-white/25 bg-white/[0.04]'
                      }`}
                    />
                  );
                })}
              </div>

              <div className="min-h-[18px]">
                {errorMsg ? (
                  <p className="text-xs font-medium text-[#ff7d91]" role="alert">
                    {errorMsg}
                  </p>
                ) : infoMsg ? (
                  <p className="text-xs font-medium text-[#8df0c0]" role="status">
                    {infoMsg}
                  </p>
                ) : null}
              </div>
            </motion.div>

            {/* Sleek Circular Glass Keypad */}
            <div className="grid grid-cols-3 gap-x-5 gap-y-3.5 justify-items-center">
              {KEYPAD_ROWS.flat().map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePressDigit(num)}
                  disabled={busy || Boolean(bioBusyModality)}
                  className="h-[68px] w-[68px] rounded-full bg-white/[0.045] border border-white/[0.09] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.09] hover:border-[#47dca0]/45 active:scale-90 transition-all duration-100"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleClearOrRestartSetup}
                disabled={busy || (!digits && setupFirstPin === null && !pendingEnrollAfterPin)}
                className="h-[68px] w-[68px] rounded-full text-xs font-medium text-[#7f8fa8] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                {!pinConfigured && setupFirstPin !== null ? 'Reset' : 'Clear'}
              </button>

              <button
                type="button"
                onClick={() => handlePressDigit('0')}
                disabled={busy || Boolean(bioBusyModality)}
                className="h-[68px] w-[68px] rounded-full bg-white/[0.045] border border-white/[0.09] font-display text-2xl font-semibold tabular-nums text-[#eef3fb] hover:bg-white/[0.09] hover:border-[#47dca0]/45 active:scale-90 transition-all duration-100"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                disabled={busy || digits.length === 0}
                aria-label="Delete last digit"
                className="h-[68px] w-[68px] rounded-full flex items-center justify-center text-[#8b9ab0] hover:text-[#eef3fb] disabled:opacity-25 active:scale-90 transition"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>

            {/* Minimal Biometric Icon Triggers (Fingerprint + Face ID) */}
            {pinConfigured && (
              <div className="flex items-center justify-center gap-6 pt-1">
                <button
                  type="button"
                  onClick={() => void handleBiometricUnlock('fingerprint')}
                  disabled={busy || Boolean(bioBusyModality)}
                  aria-label={enrolled.fingerprint ? 'Unlock with Fingerprint' : 'Enroll Fingerprint'}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span
                    className={`h-12 w-12 rounded-full border flex items-center justify-center transition active:scale-90 ${
                      enrolled.fingerprint
                        ? 'bg-[#47dca0]/15 border-[#47dca0]/50 text-[#8df0c0]'
                        : 'bg-white/[0.04] border-white/[0.1] text-[#8b9ab0] group-hover:text-[#8df0c0]'
                    }`}
                  >
                    {bioBusyModality === 'fingerprint' || bioBusyModality === 'any' ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#47dca0]" />
                    ) : (
                      <Fingerprint className="w-5 h-5" />
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-[#7f8fa8]">
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
                    className={`h-12 w-12 rounded-full border flex items-center justify-center transition active:scale-90 ${
                      enrolled.faceId
                        ? 'bg-[#8ebeff]/15 border-[#8ebeff]/50 text-[#eef3fb]'
                        : 'bg-white/[0.04] border-white/[0.1] text-[#8b9ab0] group-hover:text-[#8ebeff]'
                    }`}
                  >
                    {bioBusyModality === 'faceId' ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#8ebeff]" />
                    ) : (
                      <ScanFace className="w-5 h-5" />
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-[#7f8fa8]">
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
            className="text-xs font-medium text-[#6d7d96] hover:text-[#8df0c0] transition"
          >
            Forgot PIN?
          </button>
        )}

        {confirmReset && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.1] p-3 space-y-2 text-center">
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

        <p className="text-[11px] text-[#5c6b82] tabular-nums">
          Version 10.5.4 · Developed by ANDROID
        </p>
      </footer>
    </motion.div>
  );
};
