import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { subscribeCloudSyncActivity } from '../lib/cloudSync';
import { auth, formatCloudErrorMessage, googleProvider } from '../lib/firebase';

export type CloudSyncStatus = 'local' | 'connecting' | 'synced' | 'error';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  authBusy: boolean;
  cloudStatus: CloudSyncStatus;
  isSyncing: boolean;
  cloudError: string | null;
  setCloudStatus: (status: CloudSyncStatus) => void;
  setCloudError: (msg: string | null) => void;
  signInWithGoogle: () => Promise<User | null>;
  signOutAccount: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>('local');
  const [cloudWriteActive, setCloudWriteActive] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => subscribeCloudSyncActivity(setCloudWriteActive), []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCloudStatus('local');
        setCloudError(null);
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setAuthBusy(true);
    setCloudError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      return cred.user;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return null;
      }
      const message = formatCloudErrorMessage(err);
      setCloudError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutAccount = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
      setCloudStatus('local');
      setCloudError(null);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        authBusy,
        cloudStatus,
        isSyncing: cloudStatus === 'connecting' || cloudWriteActive,
        cloudError,
        setCloudStatus,
        setCloudError,
        signInWithGoogle,
        signOutAccount,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider.');
  }
  return ctx;
}
