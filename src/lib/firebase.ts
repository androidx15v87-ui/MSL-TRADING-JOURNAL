import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatCloudErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const raw = err instanceof Error ? err.message : String(err || 'Cloud sync failed.');
  const combined = `${code} ${raw}`;

  if (code === 'auth/unauthorized-domain' || combined.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Google Sign-In is blocked for "${host}". Add "${host}" under Firebase Console → Authentication → Settings → Authorized domains, or sign in on the Development URL.`;
  }
  if (code === 'auth/popup-blocked' || combined.includes('auth/popup-blocked')) {
    return 'Google Sign-In pop-up was blocked. Allow pop-ups for this site or open the app in a normal Chrome/Safari tab to sign in.';
  }
  if (code === 'auth/operation-not-allowed' || combined.includes('auth/operation-not-allowed')) {
    return 'Google Sign-In is disabled in Firebase Authentication. Enable the Google provider in Firebase Console → Authentication → Sign-in method.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment' || combined.includes('operation-not-supported-in-this-environment')) {
    return 'Sign-in pop-up is unsupported in this embedded/web view. Open the app directly in Chrome or Safari to sign in.';
  }
  if (code === 'auth/web-storage-unsupported' || combined.includes('web-storage-unsupported')) {
    return 'Browser cookies/storage blocked sign-in. Enable cookies for this site or open in Chrome/Safari.';
  }
  if (code === 'auth/network-request-failed' || combined.includes('auth/network-request-failed')) {
    return 'Network error reaching Google authentication. Check your internet connection and retry.';
  }
  if (code.startsWith('auth/')) {
    return `Google Sign-In failed (${code.replace('auth/', '')}). Try opening in a standard browser tab.`;
  }

  if (raw.includes("Free daily read units per project")) {
    return `Firestore daily read quota reached. Upgrade or inspect usage at https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;
  }
  if (raw.includes('Quota exceeded')) {
    return 'Firestore daily quota exceeded. Local IndexedDB storage remains active and quota resets tomorrow.';
  }
  if (raw.includes('Missing or insufficient permissions')) {
    return 'Cloud permission denied. Ensure you are signed in with a verified Google account.';
  }
  return 'Unable to reach cloud database. Your changes remain safely saved locally.';
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
