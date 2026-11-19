const PIN_HASH_KEY = 'msl_app_pin_hash_v1';
const PIN_LOCK_ENABLED_KEY = 'msl_app_pin_enabled_v1';
const BIOMETRIC_CREDS_KEY = 'msl_app_biometrics_v1';
const BIOMETRIC_AUTO_PROMPT_KEY = 'msl_app_biometrics_autoprompt_v1';
const LOCK_ACCOUNT_NAME_KEY = 'msl_app_lock_account_name_v1';
const LOCK_ATTEMPT_STATE_KEY = 'msl_app_lock_attempts_v1';
const LOCK_TIMEOUT_MIN_KEY = 'msl_app_lock_timeout_min_v1';
const PIN_SALT = 'msl-journal-android-vault-v1';

export type BiometricModality = 'fingerprint' | 'faceId';

interface StoredBiometricEntry {
  credentialId: string;
  enrolledAt: string;
}

interface StoredBiometricsMap {
  fingerprint?: StoredBiometricEntry;
  faceId?: StoredBiometricEntry;
}

export interface BiometricSupportStatus {
  available: boolean;
  inIframe: boolean;
  reason?: string;
}

export interface EnrolledBiometricsState {
  fingerprint: boolean;
  faceId: boolean;
  fingerprintEnrolledAt?: string;
  faceIdEnrolledAt?: string;
  autoPrompt: boolean;
  hasAny: boolean;
}

export interface PinLockoutState {
  failedAttempts: number;
  lockedUntilMs: number;
}

// Module-level caches for 0ms App Lock mount latency
let cachedBioSupport: BiometricSupportStatus | null = null;
let bioSupportPromise: Promise<BiometricSupportStatus> | null = null;

function hashPinSyncFallback(payload: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h1 ^= payload.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `fnv-${(h1 >>> 0).toString(16)}`;
}

async function hashPin(pin: string): Promise<string> {
  const payload = `${PIN_SALT}:${pin}`;
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoded = new TextEncoder().encode(payload);
      const digest = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below if subtle crypto is unavailable in context
    }
  }
  return hashPinSyncFallback(payload);
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function isAppLockEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PIN_LOCK_ENABLED_KEY);
    // Enabled by default so App Lock appears cleanly after the entry animation
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setAppLockEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PIN_LOCK_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}

export function getAutoLockTimeoutMinutes(): number {
  try {
    const raw = localStorage.getItem(LOCK_TIMEOUT_MIN_KEY);
    if (raw === null) return 5;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
  } catch {
    return 5;
  }
}

let lastActivityAtMs = Date.now();

export function recordUserActivity(force = false): void {
  const now = Date.now();
  if (!force && now - lastActivityAtMs < 500) return;
  lastActivityAtMs = now;
}

export function getLastUserActivityAt(): number {
  return lastActivityAtMs;
}

export function getAutoLockRemainingMs(): number {
  const mins = getAutoLockTimeoutMinutes();
  if (mins <= 0) return 0;
  const elapsed = Math.max(0, Date.now() - lastActivityAtMs);
  return Math.max(0, mins * 60_000 - elapsed);
}

export function setAutoLockTimeoutMinutes(minutes: number): void {
  try {
    localStorage.setItem(LOCK_TIMEOUT_MIN_KEY, String(Math.max(0, Math.round(minutes))));
    recordUserActivity(true);
  } catch {
    // Ignore storage errors
  }
}

export function hasAppPin(): boolean {
  try {
    return Boolean(localStorage.getItem(PIN_HASH_KEY));
  } catch {
    return false;
  }
}

export function loadLockAccountName(): string {
  try {
    return (localStorage.getItem(LOCK_ACCOUNT_NAME_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveLockAccountName(name: string): void {
  try {
    const clean = name.trim();
    if (clean) {
      localStorage.setItem(LOCK_ACCOUNT_NAME_KEY, clean);
    } else {
      localStorage.removeItem(LOCK_ACCOUNT_NAME_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getPinLockoutState(): PinLockoutState {
  try {
    const raw = localStorage.getItem(LOCK_ATTEMPT_STATE_KEY);
    if (!raw) return { failedAttempts: 0, lockedUntilMs: 0 };
    const parsed = JSON.parse(raw) as Partial<PinLockoutState>;
    const failedAttempts = Math.max(0, Number(parsed.failedAttempts || 0));
    const lockedUntilMs = Math.max(0, Number(parsed.lockedUntilMs || 0));
    return { failedAttempts, lockedUntilMs };
  } catch {
    return { failedAttempts: 0, lockedUntilMs: 0 };
  }
}

export function clearPinLockoutState(): void {
  try {
    localStorage.removeItem(LOCK_ATTEMPT_STATE_KEY);
  } catch {
    // Ignore
  }
}

export function recordFailedPinAttempt(): PinLockoutState {
  const cur = getPinLockoutState();
  const nextCount = cur.failedAttempts + 1;
  let cooldownMs = 0;
  if (nextCount >= 8) {
    cooldownMs = 30000;
  } else if (nextCount >= 5) {
    cooldownMs = 10000;
  }
  const next: PinLockoutState = {
    failedAttempts: nextCount,
    lockedUntilMs: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
  };
  try {
    localStorage.setItem(LOCK_ATTEMPT_STATE_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}

export async function saveAppPin(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  const hashed = await hashPin(pin);
  try {
    localStorage.setItem(PIN_HASH_KEY, hashed);
    localStorage.setItem(PIN_LOCK_ENABLED_KEY, 'true');
    clearPinLockoutState();
  } catch {
    throw new Error('Unable to save PIN on this device.');
  }
}

export async function verifyAppPin(pin: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  try {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) return false;
    const candidate = await hashPin(pin);
    const matched = candidate === stored;
    if (matched) {
      clearPinLockoutState();
    }
    return matched;
  } catch {
    return false;
  }
}

export function clearAppPin(): void {
  try {
    localStorage.removeItem(PIN_HASH_KEY);
    clearPinLockoutState();
  } catch {
    // Ignore storage errors
  }
}

function readBiometricsMap(): StoredBiometricsMap {
  try {
    const raw = localStorage.getItem(BIOMETRIC_CREDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredBiometricsMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeBiometricsMap(map: StoredBiometricsMap): void {
  try {
    localStorage.setItem(BIOMETRIC_CREDS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

export function getBiometricAutoPrompt(): boolean {
  try {
    const raw = localStorage.getItem(BIOMETRIC_AUTO_PROMPT_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setBiometricAutoPrompt(enabled: boolean): void {
  try {
    localStorage.setItem(BIOMETRIC_AUTO_PROMPT_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}

export function getEnrolledBiometrics(): EnrolledBiometricsState {
  const map = readBiometricsMap();
  const fingerprint = Boolean(map.fingerprint?.credentialId);
  const faceId = Boolean(map.faceId?.credentialId);
  return {
    fingerprint,
    faceId,
    fingerprintEnrolledAt: map.fingerprint?.enrolledAt,
    faceIdEnrolledAt: map.faceId?.enrolledAt,
    autoPrompt: getBiometricAutoPrompt(),
    hasAny: fingerprint || faceId,
  };
}

export function removeBiometric(modality: BiometricModality): void {
  const map = readBiometricsMap();
  if (modality === 'fingerprint') {
    delete map.fingerprint;
  } else {
    delete map.faceId;
  }
  writeBiometricsMap(map);
}

export function clearAllBiometrics(): void {
  try {
    localStorage.removeItem(BIOMETRIC_CREDS_KEY);
  } catch {
    // Ignore storage errors
  }
}

function randomArrayBuffer(length = 32): ArrayBuffer {
  const buf = new ArrayBuffer(length);
  const view = new Uint8Array(buf);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(view);
  } else {
    for (let i = 0; i < length; i++) {
      view[i] = Math.floor(Math.random() * 256);
    }
  }
  return buf;
}

function stringToArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buf;
}

function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getCachedBiometricSupport(): BiometricSupportStatus | null {
  return cachedBioSupport;
}

export async function checkBiometricSupport(): Promise<BiometricSupportStatus> {
  if (cachedBioSupport) return cachedBioSupport;
  if (bioSupportPromise) return bioSupportPromise;

  bioSupportPromise = (async () => {
    const inIframe = isRunningInIframe();
    if (typeof window === 'undefined' || !window.isSecureContext) {
      cachedBioSupport = {
        available: false,
        inIframe,
        reason: 'Biometrics require a secure HTTPS or installed PWA context.',
      };
      return cachedBioSupport;
    }
    if (typeof window.PublicKeyCredential === 'undefined' || !navigator.credentials) {
      cachedBioSupport = {
        available: false,
        inIframe,
        reason: 'This browser does not support WebAuthn platform biometrics.',
      };
      return cachedBioSupport;
    }

    try {
      const platformOk =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!platformOk) {
        cachedBioSupport = {
          available: false,
          inIframe,
          reason: 'No Fingerprint or Face ID authenticator detected on this device.',
        };
        return cachedBioSupport;
      }
      cachedBioSupport = {
        available: true,
        inIframe,
        reason: inIframe
          ? 'Embedded preview frames may restrict hardware biometric prompts. Open in a full browser tab or install as a PWA if prompted.'
          : undefined,
      };
      return cachedBioSupport;
    } catch {
      cachedBioSupport = {
        available: false,
        inIframe,
        reason: 'Could not query device biometric hardware.',
      };
      return cachedBioSupport;
    }
  })();

  return bioSupportPromise;
}

// Pre-warm hardware capability check immediately at module load (runs during startup animation)
if (typeof window !== 'undefined') {
  void checkBiometricSupport();
}

function describeWebAuthnError(err: unknown, modalityLabel: string, inIframe: boolean): string {
  const name = (err as { name?: string })?.name || '';
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();

  if (
    name === 'SecurityError' ||
    msg.includes('permissions policy') ||
    msg.includes('publickey-credentials')
  ) {
    return inIframe
      ? `${modalityLabel} prompt was blocked inside the embedded preview frame. Open in a browser tab or installed PWA for native biometrics.`
      : `${modalityLabel} security policy blocked access on this origin.`;
  }
  if (name === 'NotAllowedError') {
    if (inIframe && msg.includes('not allowed')) {
      return `${modalityLabel} cancelled or blocked by embedded frame policy. Open in a standalone tab or PWA for native sensors.`;
    }
    return `${modalityLabel} verification cancelled or timed out.`;
  }
  if (name === 'InvalidStateError') {
    return `${modalityLabel} credential is already registered on this device.`;
  }
  if (name === 'NotSupportedError') {
    return `${modalityLabel} is not supported by this browser or device lock screen.`;
  }
  return `Unable to use ${modalityLabel} on this device. Use your 4-digit PIN instead.`;
}

export async function enrollBiometric(
  modality: BiometricModality,
  accountName?: string
): Promise<{ ok: boolean; message: string }> {
  const label = modality === 'faceId' ? 'Face ID' : 'Fingerprint';
  const cleanAccount = (accountName || loadLockAccountName() || 'Trader').trim();
  const slug = cleanAccount.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'trader';
  const support = await checkBiometricSupport();
  if (!support.available) {
    return {
      ok: false,
      message: support.reason || `${label} is unavailable on this device.`,
    };
  }

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomArrayBuffer(32),
        rp: {
          name: 'MSL Trading Journal',
        },
        user: {
          id: stringToArrayBuffer(`msl-${slug}-${modality}`),
          name: `${slug}-${modality}@msljournal.app`,
          displayName: `${cleanAccount} (${label})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 45000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      return {
        ok: false,
        message: `${label} enrollment did not complete.`,
      };
    }

    const credentialId = arrayBufferToBase64Url(credential.rawId);
    const current = readBiometricsMap();
    const updated: StoredBiometricsMap = {
      ...current,
      [modality]: {
        credentialId,
        enrolledAt: new Date().toISOString(),
      },
    };
    writeBiometricsMap(updated);

    return {
      ok: true,
      message: `${label} enrolled and linked to your vault.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: describeWebAuthnError(err, label, support.inIframe),
    };
  }
}

export async function verifyBiometric(
  preferredModality?: BiometricModality
): Promise<{ ok: boolean; modality?: BiometricModality; message?: string }> {
  const map = readBiometricsMap();
  const candidates: Array<{ modality: BiometricModality; credentialId: string }> = [];

  if (preferredModality && map[preferredModality]?.credentialId) {
    candidates.push({
      modality: preferredModality,
      credentialId: map[preferredModality]!.credentialId,
    });
  } else {
    if (map.faceId?.credentialId) {
      candidates.push({ modality: 'faceId', credentialId: map.faceId.credentialId });
    }
    if (map.fingerprint?.credentialId) {
      candidates.push({
        modality: 'fingerprint',
        credentialId: map.fingerprint.credentialId,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      message: preferredModality
        ? `${preferredModality === 'faceId' ? 'Face ID' : 'Fingerprint'} is not enrolled yet.`
        : 'No biometrics enrolled yet.',
    };
  }

  const label =
    preferredModality === 'faceId'
      ? 'Face ID'
      : preferredModality === 'fingerprint'
      ? 'Fingerprint'
      : 'Biometric';

  const support = await checkBiometricSupport();
  if (!support.available) {
    return {
      ok: false,
      message: support.reason || `${label} unavailable on this device.`,
    };
  }

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomArrayBuffer(32),
        allowCredentials: candidates.map((c) => ({
          type: 'public-key' as const,
          id: base64UrlToArrayBuffer(c.credentialId),
          transports: ['internal' as AuthenticatorTransport],
        })),
        userVerification: 'required',
        timeout: 45000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return {
        ok: false,
        message: `${label} verification did not succeed.`,
      };
    }

    clearPinLockoutState();
    const returnedId = arrayBufferToBase64Url(assertion.rawId);
    const matched = candidates.find((c) => c.credentialId === returnedId) || candidates[0];
    return {
      ok: true,
      modality: matched.modality,
    };
  } catch (err) {
    return {
      ok: false,
      message: describeWebAuthnError(err, label, support.inIframe),
    };
  }
}
