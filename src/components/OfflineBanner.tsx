import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 left-4 z-40 flex items-center gap-2 rounded-xl glass-modal border-[#f5cc79]/35 px-3.5 py-2 text-xs font-medium text-[#f5cc79]"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline mode — all data saved locally on device</span>
    </div>
  );
};
