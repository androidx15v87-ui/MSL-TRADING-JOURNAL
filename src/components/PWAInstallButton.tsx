import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full';
  onInstalled?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  onInstalled,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleInstall = async () => {
    const accepted = await install();
    if (accepted) {
      onInstalled?.();
    }
  };

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        className={
          variant === 'full'
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#47dca0]/15 border border-[#47dca0]/40 px-4 py-2.5 text-sm font-semibold text-[#8df0c0] hover:bg-[#47dca0]/25 active:scale-[0.99] transition whitespace-nowrap'
            : 'min-h-[40px] flex items-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-3 py-1.5 text-xs font-semibold text-[#8df0c0] hover:border-[#47dca0]/50 transition whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'full'
              ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#111c2d] border border-[#23344f] px-4 py-2.5 text-sm font-semibold text-[#eef3fb] hover:border-[#47dca0]/40 transition whitespace-nowrap'
              : 'min-h-[40px] flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3 py-1.5 text-xs font-medium text-[#eef3fb] hover:border-[#47dca0]/40 transition whitespace-nowrap shrink-0'
          }
        >
          <Share className="w-3.5 h-3.5 shrink-0 text-[#8df0c0]" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl glass-modal p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold tracking-wider text-[#8df0c0] uppercase">
                    Home Screen App
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-[#eef3fb]">Install on iPhone or iPad</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install guide"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#202c40] text-[#8b9ab0] hover:text-[#eef3fb]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-[#c4d0e3]">
                <li>1. Tap the Share button in Safari’s toolbar.</li>
                <li>2. Scroll down and tap Add to Home Screen.</li>
                <li>3. Launch MSL Journal directly with full offline access.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#47dca0] text-[#051411] font-semibold text-sm hover:bg-[#5ce5ae] transition"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
