import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { DEFAULT_ALARMS, DEFAULT_FIELDS, DEFAULT_PLAYBOOK } from '../data/quotes';
import type {
  AIMemoryItem,
  CustomField,
  CustomFieldValue,
  JournalSettings,
  JournalState,
  Playbook,
  SessionAlarm,
  Trade,
  TradeScreenshot,
  TradingModel,
  UserProfile,
} from '../types/journal';
import { generateId } from './calculations';
import { db, handleFirestoreError, OperationType } from './firebase';
import { VALIDATION_LIMITS, VALIDATION_PATTERNS } from './validationConstants';

function sanitizeId(raw: string | undefined): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, VALIDATION_LIMITS.idMaxLength);
  if (cleaned.length > 0 && VALIDATION_PATTERNS.id.test(cleaned)) {
    return cleaned;
  }
  return generateId();
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeTradeDate(raw: string | undefined): string {
  const s = String(raw || '').trim();
  if (VALIDATION_PATTERNS.tradeDate.test(s)) {
    return s.slice(0, VALIDATION_LIMITS.tradePairMaxLength);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T12:00`;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function sanitizeCustomMap(
  custom: Record<string, CustomFieldValue> | undefined
): Record<string, CustomFieldValue> {
  if (!custom || typeof custom !== 'object') return {};
  const result: Record<string, CustomFieldValue> = {};
  const entries = Object.entries(custom).slice(0, VALIDATION_LIMITS.tradeMaxCustomKeys);
  for (const [rawKey, rawVal] of entries) {
    const key = String(rawKey || '').trim().slice(0, 64);
    if (!key) continue;
    if (typeof rawVal === 'string') {
      result[key] = rawVal.slice(0, VALIDATION_LIMITS.customValueMaxLength);
    } else if (rawVal && typeof rawVal === 'object') {
      const cleaned: { text?: string; number?: string } = {};
      if (typeof rawVal.text === 'string' && rawVal.text.trim()) {
        cleaned.text = rawVal.text.slice(0, VALIDATION_LIMITS.customValueMaxLength);
      }
      if (typeof rawVal.number === 'string' && rawVal.number.trim()) {
        cleaned.number = rawVal.number.slice(0, 64);
      }
      if (cleaned.text !== undefined || cleaned.number !== undefined) {
        result[key] = cleaned;
      }
    }
  }
  return result;
}

function sanitizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw || '').trim().slice(0, VALIDATION_LIMITS.tradeTagMaxLength);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= VALIDATION_LIMITS.tradeMaxTags) break;
  }
  return out;
}

function sanitizeTradePayload(uid: string, trade: Trade) {
  const id = sanitizeId(trade.id);
  const direction = trade.direction === 'Short' ? 'Short' : 'Long';
  const setup = (['Reversal', 'Continuation', 'Breakout', 'Other'].includes(trade.setup)
    ? trade.setup
    : 'Other') as Trade['setup'];
  const session = (['London', 'New York', 'Asia', 'Overlap', 'Other'].includes(trade.session)
    ? trade.session
    : 'Other') as Trade['session'];
  const result = (['Win', 'Loss', 'BE'].includes(trade.result)
    ? trade.result
    : 'BE') as Trade['result'];
  const pair = (String(trade.pair || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN').slice(
    0,
    VALIDATION_LIMITS.tradePairMaxLength
  );

  return {
    id,
    userId: uid,
    date: normalizeTradeDate(trade.date),
    pair,
    direction,
    setup,
    session,
    result,
    r: clampNumber(trade.r, VALIDATION_LIMITS.rMin, VALIDATION_LIMITS.rMax, 0),
    risk: clampNumber(trade.risk, VALIDATION_LIMITS.riskMin, VALIDATION_LIMITS.riskMax, 1),
    model: String(trade.model || '').slice(0, VALIDATION_LIMITS.tradeModelMaxLength),
    tags: sanitizeTags(trade.tags),
    notes: String(trade.notes || '').slice(0, VALIDATION_LIMITS.tradeNotesMaxLength),
    custom: sanitizeCustomMap(trade.custom),
  };
}

function sanitizeImagePayload(uid: string, tradeId: string, img: TradeScreenshot) {
  const dataUrl = String(img.dataUrl || '');
  if (
    !VALIDATION_PATTERNS.imageDataUrl.test(dataUrl) ||
    dataUrl.length < 10 ||
    dataUrl.length > VALIDATION_LIMITS.imageDataUrlMaxLength
  ) {
    return null;
  }
  return {
    id: sanitizeId(img.id),
    userId: uid,
    tradeId: sanitizeId(tradeId),
    name: (String(img.name || 'chart.jpg').trim() || 'chart.jpg').slice(
      0,
      VALIDATION_LIMITS.imageNameMaxLength
    ),
    dataUrl,
  };
}

function sanitizeModelPayload(uid: string, model: TradingModel) {
  const id = sanitizeId(model.id);
  const type = (['Reversal', 'Continuation', 'Both'].includes(model.type)
    ? model.type
    : 'Both') as TradingModel['type'];
  return {
    id,
    userId: uid,
    name: (String(model.name || 'Model').trim() || 'Model').slice(
      0,
      VALIDATION_LIMITS.modelNameMaxLength
    ),
    type,
    entry: String(model.entry || '').slice(0, VALIDATION_LIMITS.modelBodyMaxLength),
    risk: String(model.risk || '').slice(0, VALIDATION_LIMITS.modelBodyMaxLength),
  };
}

function sanitizeFieldPayload(uid: string, field: CustomField) {
  const id = sanitizeId(field.id);
  const type = (['text', 'number', 'both'].includes(field.type)
    ? field.type
    : 'text') as CustomField['type'];
  const options = Array.isArray(field.options)
    ? field.options
        .map((o) => String(o || '').trim().slice(0, VALIDATION_LIMITS.fieldOptionMaxLength))
        .filter(Boolean)
        .slice(0, VALIDATION_LIMITS.fieldMaxOptions)
    : [];

  return {
    id,
    userId: uid,
    name: (String(field.name || 'Property').trim() || 'Property').slice(
      0,
      VALIDATION_LIMITS.fieldNameMaxLength
    ),
    type,
    required: Boolean(field.required),
    hint: String(field.hint || '').slice(0, VALIDATION_LIMITS.fieldHintMaxLength),
    options,
  };
}

function sanitizeAlarmPayload(uid: string, alarm: SessionAlarm, index: number) {
  const id = sanitizeId(alarm.id);
  const time = VALIDATION_PATTERNS.alarmTime.test(String(alarm.time || ''))
    ? String(alarm.time)
    : '08:00';
  return {
    id,
    userId: uid,
    name: (String(alarm.name || `Session ${index + 1}`).trim() || `Session ${index + 1}`).slice(
      0,
      VALIDATION_LIMITS.alarmNameMaxLength
    ),
    time,
    enabled: Boolean(alarm.enabled),
    sortOrder: clampNumber(index, 0, 20, index),
  };
}

function sanitizeAIMemoryPayload(uid: string, memory: AIMemoryItem) {
  const id = sanitizeId(memory.id);
  const category = (['preference', 'rule', 'goal', 'context'].includes(memory.category)
    ? memory.category
    : 'context') as AIMemoryItem['category'];
  const content = (String(memory.content || '').trim() || 'Preference').slice(
    0,
    VALIDATION_LIMITS.memoryContentMaxLength
  );
  return {
    id,
    userId: uid,
    content,
    category,
  };
}

function sanitizeWorkspaceFields(
  uid: string,
  state: Pick<JournalState, 'profile' | 'playbook' | 'settings'>
) {
  const freq = VALIDATION_LIMITS.quoteFrequencies.includes(state.settings.quoteFrequency)
    ? state.settings.quoteFrequency
    : 60;
  return {
    uid,
    displayName: String(state.profile.name || '').slice(0, VALIDATION_LIMITS.displayNameMaxLength),
    defaultMarket: String(state.profile.market || '').slice(
      0,
      VALIDATION_LIMITS.defaultMarketMaxLength
    ),
    playbookCore: String(state.playbook.core || '').slice(
      0,
      VALIDATION_LIMITS.playbookSectionMaxLength
    ),
    playbookRev: String(state.playbook.rev || '').slice(
      0,
      VALIDATION_LIMITS.playbookSectionMaxLength
    ),
    playbookCont: String(state.playbook.cont || '').slice(
      0,
      VALIDATION_LIMITS.playbookSectionMaxLength
    ),
    playbookEntry: String(state.playbook.entry || '').slice(
      0,
      VALIDATION_LIMITS.playbookSectionMaxLength
    ),
    playbookRisk: String(state.playbook.risk || '').slice(
      0,
      VALIDATION_LIMITS.playbookSectionMaxLength
    ),
    quoteFrequency: freq,
    quoteNotifications: Boolean(state.settings.quoteNotifications),
  };
}

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

export async function ensureCloudWorkspace(
  uid: string,
  localState: JournalState,
  googleDisplayName?: string | null
): Promise<{ isNewWorkspace: boolean }> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (snap.exists()) {
    return { isNewWorkspace: false };
  }

  const seedState: JournalState = {
    ...localState,
    profile: {
      name: localState.profile.name || googleDisplayName || '',
      market: localState.profile.market || '',
    },
  };

  try {
    await setDoc(userRef, {
      ...sanitizeWorkspaceFields(uid, seedState),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }

  // Push local models, custom fields, alarms, trades & images into subcollections
  await writeSubcollectionsInBatches(uid, seedState);
  return { isNewWorkspace: true };
}

async function writeSubcollectionsInBatches(uid: string, state: JournalState): Promise<void> {
  type PendingWrite = { ref: ReturnType<typeof doc>; data: Record<string, unknown>; path: string };
  const writes: PendingWrite[] = [];

  for (const model of state.models) {
    const payload = sanitizeModelPayload(uid, model);
    writes.push({
      ref: doc(db, 'users', uid, 'models', payload.id),
      data: { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      path: `users/${uid}/models/${payload.id}`,
    });
  }

  for (const field of state.fields) {
    const payload = sanitizeFieldPayload(uid, field);
    writes.push({
      ref: doc(db, 'users', uid, 'customFields', payload.id),
      data: { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      path: `users/${uid}/customFields/${payload.id}`,
    });
  }

  state.alarms.forEach((alarm, index) => {
    const payload = sanitizeAlarmPayload(uid, alarm, index);
    writes.push({
      ref: doc(db, 'users', uid, 'alarms', payload.id),
      data: { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      path: `users/${uid}/alarms/${payload.id}`,
    });
  });

  // Ensure trades are queued before their images so existsAfter succeeds even if chunked
  for (const trade of state.trades) {
    const payload = sanitizeTradePayload(uid, trade);
    writes.push({
      ref: doc(db, 'users', uid, 'trades', payload.id),
      data: { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      path: `users/${uid}/trades/${payload.id}`,
    });
  }

  for (const trade of state.trades) {
    const tradeId = sanitizeId(trade.id);
    for (const img of trade.images || []) {
      const imgPayload = sanitizeImagePayload(uid, tradeId, img);
      if (!imgPayload) continue;
      writes.push({
        ref: doc(db, 'users', uid, 'tradeImages', imgPayload.id),
        data: { ...imgPayload, createdAt: serverTimestamp() },
        path: `users/${uid}/tradeImages/${imgPayload.id}`,
      });
    }
  }

  const CHUNK = 350;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const slice = writes.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of slice) {
      batch.set(item.ref, item.data);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, slice[0]?.path || `users/${uid}`);
    }
  }
}

export async function mergeMissingLocalTradesToCloud(
  uid: string,
  localState: JournalState,
  cloudTrades: Trade[]
): Promise<number> {
  const existingIds = new Set(cloudTrades.map((t) => t.id));
  const missing = localState.trades.filter((t) => !existingIds.has(t.id));
  if (missing.length === 0) return 0;

  for (const trade of missing) {
    await cloudSaveTrade(uid, trade);
  }
  return missing.length;
}

export async function cloudSaveTrade(uid: string, trade: Trade): Promise<void> {
  const payload = sanitizeTradePayload(uid, trade);
  const tradePath = `users/${uid}/trades/${payload.id}`;
  const tradeRef = doc(db, 'users', uid, 'trades', payload.id);

  let existsInCloud = false;
  try {
    const existingSnap = await getDoc(tradeRef);
    existsInCloud = existingSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, tradePath);
  }

  // Fetch existing user tradeImages and filter for this tradeId without composite index
  const imagesPath = `users/${uid}/tradeImages`;
  const existingTradeImages = new Map<string, ReturnType<typeof doc>>();
  try {
    const imgSnap = await getDocs(
      query(collection(db, 'users', uid, 'tradeImages'), where('userId', '==', uid))
    );
    for (const d of imgSnap.docs) {
      const data = d.data();
      if (data.tradeId === payload.id) {
        existingTradeImages.set(d.id, d.ref);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, imagesPath);
  }

  const nextImages = (trade.images || [])
    .map((img) => sanitizeImagePayload(uid, payload.id, img))
    .filter((x): x is NonNullable<ReturnType<typeof sanitizeImagePayload>> => x !== null);
  const nextImageIds = new Set(nextImages.map((img) => img.id));

  const batch = writeBatch(db);
  if (existsInCloud) {
    batch.update(tradeRef, {
      date: payload.date,
      pair: payload.pair,
      direction: payload.direction,
      setup: payload.setup,
      session: payload.session,
      result: payload.result,
      r: payload.r,
      risk: payload.risk,
      model: payload.model,
      tags: payload.tags,
      notes: payload.notes,
      custom: payload.custom,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(tradeRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const [existingImgId, ref] of existingTradeImages.entries()) {
    if (!nextImageIds.has(existingImgId)) {
      batch.delete(ref);
    }
  }

  for (const img of nextImages) {
    if (!existingTradeImages.has(img.id)) {
      batch.set(doc(db, 'users', uid, 'tradeImages', img.id), {
        ...img,
        createdAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      existsInCloud ? OperationType.UPDATE : OperationType.CREATE,
      tradePath
    );
  }
}

export async function cloudDeleteTrade(uid: string, tradeId: string): Promise<void> {
  const cleanId = sanitizeId(tradeId);
  const tradePath = `users/${uid}/trades/${cleanId}`;
  const tradeRef = doc(db, 'users', uid, 'trades', cleanId);

  const imageRefsToDelete: ReturnType<typeof doc>[] = [];
  try {
    const imgSnap = await getDocs(
      query(collection(db, 'users', uid, 'tradeImages'), where('userId', '==', uid))
    );
    for (const d of imgSnap.docs) {
      if (d.data().tradeId === cleanId) {
        imageRefsToDelete.push(d.ref);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/tradeImages`);
  }

  const batch = writeBatch(db);
  batch.delete(tradeRef);
  for (const ref of imageRefsToDelete) {
    batch.delete(ref);
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, tradePath);
  }
}

export async function cloudSaveModel(uid: string, model: TradingModel): Promise<void> {
  const payload = sanitizeModelPayload(uid, model);
  const path = `users/${uid}/models/${payload.id}`;
  const ref = doc(db, 'users', uid, 'models', payload.id);

  let exists = false;
  try {
    exists = (await getDoc(ref)).exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  try {
    if (exists) {
      await updateDoc(ref, {
        name: payload.name,
        type: payload.type,
        entry: payload.entry,
        risk: payload.risk,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function cloudDeleteModel(uid: string, modelId: string): Promise<void> {
  const cleanId = sanitizeId(modelId);
  const path = `users/${uid}/models/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'models', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudSaveField(uid: string, field: CustomField): Promise<void> {
  const payload = sanitizeFieldPayload(uid, field);
  const path = `users/${uid}/customFields/${payload.id}`;
  const ref = doc(db, 'users', uid, 'customFields', payload.id);

  let exists = false;
  try {
    exists = (await getDoc(ref)).exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  try {
    if (exists) {
      await updateDoc(ref, {
        name: payload.name,
        type: payload.type,
        required: payload.required,
        hint: payload.hint,
        options: payload.options,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function cloudDeleteField(uid: string, fieldId: string): Promise<void> {
  const cleanId = sanitizeId(fieldId);
  const path = `users/${uid}/customFields/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'customFields', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudSavePlaybook(uid: string, playbook: Playbook): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      playbookCore: String(playbook.core || '').slice(0, VALIDATION_LIMITS.playbookSectionMaxLength),
      playbookRev: String(playbook.rev || '').slice(0, VALIDATION_LIMITS.playbookSectionMaxLength),
      playbookCont: String(playbook.cont || '').slice(0, VALIDATION_LIMITS.playbookSectionMaxLength),
      playbookEntry: String(playbook.entry || '').slice(
        0,
        VALIDATION_LIMITS.playbookSectionMaxLength
      ),
      playbookRisk: String(playbook.risk || '').slice(0, VALIDATION_LIMITS.playbookSectionMaxLength),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudSaveProfile(uid: string, profile: UserProfile): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: String(profile.name || '').slice(0, VALIDATION_LIMITS.displayNameMaxLength),
      defaultMarket: String(profile.market || '').slice(
        0,
        VALIDATION_LIMITS.defaultMarketMaxLength
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudSaveAlarmsAndSettings(
  uid: string,
  alarms: SessionAlarm[],
  settings: JournalSettings
): Promise<void> {
  const userPath = `users/${uid}`;
  const freq = VALIDATION_LIMITS.quoteFrequencies.includes(settings.quoteFrequency)
    ? settings.quoteFrequency
    : 60;

  try {
    await updateDoc(doc(db, 'users', uid), {
      quoteFrequency: freq,
      quoteNotifications: Boolean(settings.quoteNotifications),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  let existingAlarmIds = new Set<string>();
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'alarms'), where('userId', '==', uid))
    );
    existingAlarmIds = new Set(snap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/alarms`);
  }

  const batch = writeBatch(db);
  const nextIds = new Set<string>();
  alarms.forEach((alarm, idx) => {
    const payload = sanitizeAlarmPayload(uid, alarm, idx);
    nextIds.add(payload.id);
    const ref = doc(db, 'users', uid, 'alarms', payload.id);
    if (existingAlarmIds.has(payload.id)) {
      batch.update(ref, {
        name: payload.name,
        time: payload.time,
        enabled: payload.enabled,
        sortOrder: payload.sortOrder,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  for (const oldId of existingAlarmIds) {
    if (!nextIds.has(oldId)) {
      batch.delete(doc(db, 'users', uid, 'alarms', oldId));
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}/alarms`);
  }
}

export async function cloudReplaceFullJournal(uid: string, nextState: JournalState): Promise<void> {
  const subcollections = ['tradeImages', 'trades', 'models', 'customFields', 'alarms'] as const;
  const refsToDelete: ReturnType<typeof doc>[] = [];

  for (const sub of subcollections) {
    const path = `users/${uid}/${sub}`;
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, sub), where('userId', '==', uid)));
      for (const d of snap.docs) {
        refsToDelete.push(d.ref);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  const CHUNK = 350;
  for (let i = 0; i < refsToDelete.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const ref of refsToDelete.slice(i, i + CHUNK)) {
      batch.delete(ref);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
    }
  }

  const wsFields = sanitizeWorkspaceFields(uid, nextState);
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      await updateDoc(userRef, {
        displayName: wsFields.displayName,
        defaultMarket: wsFields.defaultMarket,
        playbookCore: wsFields.playbookCore,
        playbookRev: wsFields.playbookRev,
        playbookCont: wsFields.playbookCont,
        playbookEntry: wsFields.playbookEntry,
        playbookRisk: wsFields.playbookRisk,
        quoteFrequency: wsFields.quoteFrequency,
        quoteNotifications: wsFields.quoteNotifications,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, {
        ...wsFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  await writeSubcollectionsInBatches(uid, nextState);
}

export function subscribeToCloudJournal(
  uid: string,
  onState: (state: JournalState) => void,
  onError: (err: unknown) => void
): Unsubscribe {
  let workspaceData: {
    profile: UserProfile;
    playbook: Playbook;
    settings: JournalSettings;
  } | null = null;
  let rawTrades: Omit<Trade, 'images'>[] = [];
  let rawImages: Array<TradeScreenshot & { tradeId: string }> = [];
  let models: TradingModel[] = [];
  let fields: CustomField[] = DEFAULT_FIELDS.map((f) => ({ ...f, options: [...f.options] }));
  let alarms: SessionAlarm[] = DEFAULT_ALARMS.map((a) => ({ ...a }));

  const ready = {
    workspace: false,
    trades: false,
    images: false,
    models: false,
    fields: false,
    alarms: false,
  };

  const emitIfReady = () => {
    if (
      !ready.workspace ||
      !ready.trades ||
      !ready.images ||
      !ready.models ||
      !ready.fields ||
      !ready.alarms ||
      !workspaceData
    ) {
      return;
    }

    const imagesByTrade = new Map<string, TradeScreenshot[]>();
    for (const img of rawImages) {
      const list = imagesByTrade.get(img.tradeId) || [];
      list.push({
        id: img.id,
        name: img.name,
        dataUrl: img.dataUrl,
        createdAt: img.createdAt,
      });
      imagesByTrade.set(img.tradeId, list);
    }

    const trades: Trade[] = rawTrades.map((t) => ({
      ...t,
      images: imagesByTrade.get(t.id) || [],
    }));

    onState({
      trades,
      models,
      fields,
      playbook: workspaceData.playbook,
      alarms: alarms.length > 0 ? alarms : DEFAULT_ALARMS.map((a) => ({ ...a })),
      profile: workspaceData.profile,
      settings: workspaceData.settings,
    });
  };

  const handleSnapErr = (path: string) => (err: unknown) => {
    try {
      handleFirestoreError(err, OperationType.GET, path);
    } catch (wrapped) {
      onError(wrapped);
    }
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        workspaceData = {
          profile: {
            name: typeof d.displayName === 'string' ? d.displayName : '',
            market: typeof d.defaultMarket === 'string' ? d.defaultMarket : '',
          },
          playbook: {
            core: typeof d.playbookCore === 'string' ? d.playbookCore : DEFAULT_PLAYBOOK.core,
            rev: typeof d.playbookRev === 'string' ? d.playbookRev : DEFAULT_PLAYBOOK.rev,
            cont: typeof d.playbookCont === 'string' ? d.playbookCont : DEFAULT_PLAYBOOK.cont,
            entry: typeof d.playbookEntry === 'string' ? d.playbookEntry : DEFAULT_PLAYBOOK.entry,
            risk: typeof d.playbookRisk === 'string' ? d.playbookRisk : DEFAULT_PLAYBOOK.risk,
          },
          settings: {
            quoteFrequency: typeof d.quoteFrequency === 'number' ? d.quoteFrequency : 60,
            quoteNotifications: Boolean(d.quoteNotifications),
          },
        };
        ready.workspace = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'trades'), where('userId', '==', uid)),
      (snap) => {
        rawTrades = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            date: String(d.date || ''),
            pair: String(d.pair || ''),
            direction: d.direction === 'Short' ? 'Short' : 'Long',
            setup: d.setup || 'Other',
            session: d.session || 'Other',
            result: d.result || 'BE',
            r: Number(d.r || 0),
            risk: Number(d.risk ?? 1),
            model: String(d.model || ''),
            tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
            notes: String(d.notes || ''),
            custom: d.custom && typeof d.custom === 'object' ? d.custom : {},
            createdAt: timestampToIso(d.createdAt),
            updatedAt: timestampToIso(d.updatedAt),
          };
        });
        ready.trades = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}/trades`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'tradeImages'), where('userId', '==', uid)),
      (snap) => {
        rawImages = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            tradeId: String(d.tradeId || ''),
            name: String(d.name || 'chart.jpg'),
            dataUrl: String(d.dataUrl || ''),
            createdAt: timestampToIso(d.createdAt),
          };
        });
        ready.images = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}/tradeImages`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'models'), where('userId', '==', uid)),
      (snap) => {
        models = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            name: String(d.name || ''),
            type: d.type || 'Both',
            entry: String(d.entry || ''),
            risk: String(d.risk || ''),
          };
        });
        ready.models = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}/models`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'customFields'), where('userId', '==', uid)),
      (snap) => {
        fields = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            name: String(d.name || ''),
            type: d.type || 'text',
            required: Boolean(d.required),
            hint: String(d.hint || ''),
            options: Array.isArray(d.options) ? d.options.map(String) : [],
          };
        });
        ready.fields = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}/customFields`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'alarms'), where('userId', '==', uid)),
      (snap) => {
        alarms = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: String(d.id || docSnap.id),
              name: String(d.name || ''),
              time: String(d.time || '08:00'),
              enabled: Boolean(d.enabled),
              sortOrder: Number(d.sortOrder ?? 99),
            };
          })
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ sortOrder: _order, ...alarm }) => alarm);
        ready.alarms = true;
        emitIfReady();
      },
      handleSnapErr(`users/${uid}/alarms`)
    )
  );

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

export async function cloudSaveAIMemory(uid: string, memory: AIMemoryItem): Promise<void> {
  const payload = sanitizeAIMemoryPayload(uid, memory);
  const path = `users/${uid}/aiMemories/${payload.id}`;
  const ref = doc(db, 'users', uid, 'aiMemories', payload.id);

  let exists = false;
  try {
    exists = (await getDoc(ref)).exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  try {
    if (exists) {
      await updateDoc(ref, {
        content: payload.content,
        category: payload.category,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function cloudDeleteAIMemory(uid: string, memoryId: string): Promise<void> {
  const cleanId = sanitizeId(memoryId);
  const path = `users/${uid}/aiMemories/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'aiMemories', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToCloudMemories(
  uid: string,
  onMemories: (memories: AIMemoryItem[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'users', uid, 'aiMemories'), where('userId', '==', uid)),
    (snap) => {
      const items: AIMemoryItem[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const cat = (['preference', 'rule', 'goal', 'context'].includes(String(d.category))
            ? String(d.category)
            : 'context') as AIMemoryItem['category'];
          return {
            id: String(d.id || docSnap.id),
            content: String(d.content || '').trim(),
            category: cat,
            createdAt: timestampToIso(d.createdAt),
            updatedAt: timestampToIso(d.updatedAt),
          };
        })
        .filter((m) => m.content.length > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onMemories(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, `users/${uid}/aiMemories`);
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );
}
