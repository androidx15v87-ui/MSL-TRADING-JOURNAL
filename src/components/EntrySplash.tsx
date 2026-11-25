import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface EntrySplashProps {
  phase: 1 | 2;
  durationMs?: number;
}

export const EntrySplash: React.FC<EntrySplashProps> = ({
  phase,
  durationMs = 6000,
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 1.015 }}
      transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050811] px-6 select-none overflow-hidden"
    >
      {/* Single Soft Atmospheric Bloom */}
      <motion.div
        aria-hidden="true"
        initial={shouldReduceMotion ? { opacity: 0.42 } : { opacity: 0.16, scale: 0.85 }}
        animate={
          shouldReduceMotion
            ? { opacity: 0.42 }
            : { opacity: [0.16, 0.46, 0.32], scale: [0.85, 1.08, 1] }
        }
        transition={{ duration: durationMs / 1000, ease: 'easeInOut' }}
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[440px] w-[440px] rounded-full bg-[radial-gradient(circle,rgba(71,220,160,0.20)_0%,rgba(142,190,255,0.08)_46%,transparent_72%)] blur-3xl"
      />

      {/* Minimalist Center Stage (No Card Box, No Grids) */}
      <div className="relative flex flex-col items-center justify-center text-center max-w-sm w-full">
        <div className="min-h-[120px] flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {phase === 1 ? (
              <motion.div
                key="splash-brand"
                initial={
                  shouldReduceMotion
                    ? { opacity: 1 }
                    : { opacity: 0, y: 8, filter: 'blur(4px)' }
                }
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -8, filter: 'blur(4px)' }
                }
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center gap-4"
              >
                {/* Clean Hairline Monogram */}
                <svg
                  viewBox="0 0 48 48"
                  className="h-12 w-12 overflow-visible"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="mslMinimalRing" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                      <stop offset="60%" stopColor="#47dca0" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#8ebeff" stopOpacity="0.7" />
                    </linearGradient>
                  </defs>
                  <motion.rect
                    x="2"
                    y="2"
                    width="44"
                    height="44"
                    rx="13"
                    fill="rgba(255, 255, 255, 0.03)"
                    stroke="url(#mslMinimalRing)"
                    strokeWidth="1.25"
                    initial={shouldReduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <motion.path
                    d="M 14 31 L 14 17 L 24 26 L 34 17 L 34 31"
                    fill="none"
                    stroke="#8df0c0"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={shouldReduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                </svg>

                <motion.h1
                  initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="font-display text-2xl sm:text-[28px] font-bold tracking-tight bg-gradient-to-b from-white via-[#eef3fb] to-white/70 bg-clip-text text-transparent"
                >
                  MSL Journal
                </motion.h1>
              </motion.div>
            ) : (
              <motion.div
                key="splash-mantra"
                initial={
                  shouldReduceMotion
                    ? { opacity: 1 }
                    : { opacity: 0, y: 10, filter: 'blur(4px)' }
                }
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center gap-2"
              >
                <p className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#eef3fb] leading-snug [text-wrap:balance]">
                  Read the market.
                  <br />
                  <span className="text-[#47dca0]">Respect the plan.</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Single Whisper-Thin 6-Second Light Filament */}
        <div className="mt-7 h-[1.5px] w-32 rounded-full bg-white/[0.08] overflow-hidden">
          <motion.div
            initial={{ scaleX: shouldReduceMotion ? 1 : 0 }}
            animate={{ scaleX: 1 }}
            transition={{
              duration: shouldReduceMotion ? 0 : durationMs / 1000,
              ease: 'linear',
            }}
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[#8ebeff]/70 via-[#47dca0] to-[#8df0c0]"
          />
        </div>
      </div>
    </motion.div>
  );
};
