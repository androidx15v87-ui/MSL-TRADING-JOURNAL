import { createDefaultState, DEFAULT_ALARMS, DEFAULT_FIELDS, DEFAULT_PLAYBOOK } from '../data/quotes';
import type {
  BackupPayload,
  CustomField,
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

const DB_NAME = 'msl_trading_journal_v10_db';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_TRADES = 'trades';
const STORE_IMAGES = 'images';

const LEGACY_KEY_V10 = 'msl_v10_state';
const LEGACY_KEY_V91 = 'msl_v91_state';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_TRADES)) {
        const tradeStore = db.createObjectStore(STORE_TRADES, { keyPath: 'id' });
        tradeStore.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const imgStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        imgStore.createIndex('tradeId', 'tradeId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
  });

  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
  });
}

interface StoredImageRecord extends TradeScreenshot {
  tradeId: string;
}

function normalizeTrade(raw: Partial<Trade> & { id?: string }): Trade {
  const images: TradeScreenshot[] = Array.isArray(raw.images)
    ? raw.images
        .filter((img) => img && typeof img.dataUrl === 'string' && img.dataUrl.length > 0)
        .map((img) => ({
          id: img.id || generateId(),
          name: img.name || 'chart.jpg',
          dataUrl: img.dataUrl,
          createdAt: img.createdAt || raw.createdAt || new Date().toISOString(),
        }))
    : [];

  // Backward-compatibility with single-image V10/V9 backups
  if (images.length === 0 && typeof raw.imageData === 'string' && raw.imageData.startsWith('data:image')) {
    images.push({
      id: generateId(),
      name: 'screenshot.jpg',
      dataUrl: raw.imageData,
      createdAt: raw.createdAt || new Date().toISOString(),
    });
  }

  return {
    id: raw.id || generateId(),
    date: raw.date || new Date().toISOString().slice(0, 16),
    pair: String(raw.pair || '').trim().toUpperCase(),
    direction: raw.direction === 'Short' ? 'Short' : 'Long',
    setup: (['Reversal', 'Continuation', 'Breakout', 'Other'].includes(String(raw.setup))
      ? raw.setup
      : 'Other') as Trade['setup'],
    session: (['London', 'New York', 'Asia', 'Overlap', 'Other'].includes(String(raw.session))
      ? raw.session
      : 'Other') as Trade['session'],
    result: (['Win', 'Loss', 'BE'].includes(String(raw.result)) ? raw.result : 'BE') as Trade['result'],
    r: Number(raw.r || 0),
    risk: Number(raw.risk ?? 1),
    model: String(raw.model || ''),
    tags: Array.isArray(raw.tags)
      ? Array.from(
          new Set(
            raw.tags
              .map((tag) => String(tag || '').trim())
              .filter(Boolean)
          )
        )
      : [],
    notes: String(raw.notes || ''),
    custom: raw.custom && typeof raw.custom === 'object' ? raw.custom : {},
    images,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt,
  };
}

function normalizeState(raw: Partial<JournalState> | null | undefined): JournalState {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  return {
    trades: Array.isArray(raw.trades) ? raw.trades.map((t) => normalizeTrade(t)) : [],
    models: Array.isArray(raw.models) ? raw.models : [],
    fields: Array.isArray(raw.fields)
      ? raw.fields
      : DEFAULT_FIELDS.map((f) => ({ ...f, options: [...f.options] })),
    playbook: {
      ...DEFAULT_PLAYBOOK,
      ...(raw.playbook || {}),
    },
    alarms: Array.isArray(raw.alarms) && raw.alarms.length > 0
      ? raw.alarms.map((a, idx) => ({
          id: a.id || `alarm-${idx}`,
          name: a.name || `Session ${idx + 1}`,
          time: a.time || '08:00',
          enabled: Boolean(a.enabled),
        }))
      : DEFAULT_ALARMS.map((a) => ({ ...a })),
    profile: {
      name: raw.profile?.name || '',
      market: raw.profile?.market || '',
    },
    settings: {
      quoteFrequency:
        typeof raw.settings?.quoteFrequency === 'number' ? raw.settings.quoteFrequency : 60,
      quoteNotifications: Boolean(raw.settings?.quoteNotifications),
    },
  };
}

function tryMigrateFromLocalStorage(): JournalState | null {
  try {
    const rawV10 = localStorage.getItem(LEGACY_KEY_V10);
    if (rawV10) {
      const parsed = JSON.parse(rawV10);
      return normalizeState(parsed);
    }
    const rawV91 = localStorage.getItem(LEGACY_KEY_V91);
    if (rawV91) {
      const old = JSON.parse(rawV91);
      const migratedTrades = Array.isArray(old.trades)
        ? old.trades.map((t: Record<string, unknown>) => ({
            ...t,
            notes: [t.seen, t.review, t.mistake].filter(Boolean).join('\n'),
          }))
        : [];
      return normalizeState({
        ...old,
        trades: migratedTrades,
      });
    }
  } catch {
    // Ignore malformed legacy storage
  }
  return null;
}

export async function loadJournalState(): Promise<JournalState> {
  const db = await openDB();
  const tx = db.transaction([STORE_KV, STORE_TRADES, STORE_IMAGES], 'readonly');

  const kvAll = await idbReq<{ key: string; value: unknown }[]>(tx.objectStore(STORE_KV).getAll());
  const rawTrades = await idbReq<Omit<Trade, 'images'>[]>(tx.objectStore(STORE_TRADES).getAll());
  const rawImages = await idbReq<StoredImageRecord[]>(tx.objectStore(STORE_IMAGES).getAll());
  await txDone(tx);

  const kvMap = new Map<string, unknown>(kvAll.map((item) => [item.key, item.value]));

  // First-run check: if IndexedDB is empty, check legacy localStorage
  if (kvMap.size === 0 && rawTrades.length === 0) {
    const legacy = tryMigrateFromLocalStorage();
    if (legacy) {
      await saveFullJournalState(legacy);
      return legacy;
    }
    const defaults = createDefaultState();
    await saveFullJournalState(defaults);
    return defaults;
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

  const trades: Trade[] = rawTrades.map((t) =>
    normalizeTrade({
      ...t,
      images: imagesByTrade.get(t.id) || [],
    })
  );

  return normalizeState({
    trades,
    models: (kvMap.get('models') as TradingModel[]) || [],
    fields: (kvMap.get('fields') as CustomField[]) || DEFAULT_FIELDS,
    playbook: (kvMap.get('playbook') as Playbook) || DEFAULT_PLAYBOOK,
    alarms: (kvMap.get('alarms') as SessionAlarm[]) || DEFAULT_ALARMS,
    profile: (kvMap.get('profile') as UserProfile) || { name: '', market: '' },
    settings: (kvMap.get('settings') as JournalSettings) || {
      quoteFrequency: 60,
      quoteNotifications: false,
    },
  });
}

export async function saveKV<K extends keyof Omit<JournalState, 'trades'>>(
  key: K,
  value: JournalState[K]
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_KV, 'readwrite');
  tx.objectStore(STORE_KV).put({ key, value });
  await txDone(tx);
}

export async function saveTradeRecord(trade: Trade): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_TRADES, STORE_IMAGES], 'readwrite');
  const tradeStore = tx.objectStore(STORE_TRADES);
  const imageStore = tx.objectStore(STORE_IMAGES);

  // Strip inline images from the trade metadata object so images live cleanly in STORE_IMAGES
  const { images, imageData: _legacy, ...tradeMeta } = trade;
  tradeStore.put(tradeMeta);

  // Replace associated images in STORE_IMAGES
  const idx = imageStore.index('tradeId');
  const existingKeys = await idbReq<IDBValidKey[]>(idx.getAllKeys(trade.id));
  for (const key of existingKeys) {
    imageStore.delete(key);
  }
  for (const img of images) {
    const rec: StoredImageRecord = {
      id: img.id,
      tradeId: trade.id,
      name: img.name,
      dataUrl: img.dataUrl,
      createdAt: img.createdAt,
    };
    imageStore.put(rec);
  }

  await txDone(tx);
}

export async function deleteTradeRecord(tradeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_TRADES, STORE_IMAGES], 'readwrite');
  tx.objectStore(STORE_TRADES).delete(tradeId);
  const imageStore = tx.objectStore(STORE_IMAGES);
  const idx = imageStore.index('tradeId');
  const keys = await idbReq<IDBValidKey[]>(idx.getAllKeys(tradeId));
  for (const key of keys) {
    imageStore.delete(key);
  }
  await txDone(tx);
}

export async function saveFullJournalState(state: JournalState): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_KV, STORE_TRADES, STORE_IMAGES], 'readwrite');

  const kvStore = tx.objectStore(STORE_KV);
  const tradeStore = tx.objectStore(STORE_TRADES);
  const imageStore = tx.objectStore(STORE_IMAGES);

  kvStore.clear();
  tradeStore.clear();
  imageStore.clear();

  kvStore.put({ key: 'models', value: state.models });
  kvStore.put({ key: 'fields', value: state.fields });
  kvStore.put({ key: 'playbook', value: state.playbook });
  kvStore.put({ key: 'alarms', value: state.alarms });
  kvStore.put({ key: 'profile', value: state.profile });
  kvStore.put({ key: 'settings', value: state.settings });

  for (const trade of state.trades) {
    const { images, imageData: _legacy, ...tradeMeta } = trade;
    tradeStore.put(tradeMeta);
    for (const img of images) {
      imageStore.put({
        id: img.id,
        tradeId: trade.id,
        name: img.name,
        dataUrl: img.dataUrl,
        createdAt: img.createdAt,
      } satisfies StoredImageRecord);
    }
  }

  await txDone(tx);
}

export async function clearAllJournalData(): Promise<JournalState> {
  const fresh = createDefaultState();
  await saveFullJournalState(fresh);
  try {
    localStorage.removeItem(LEGACY_KEY_V10);
    localStorage.removeItem(LEGACY_KEY_V91);
  } catch {
    // Ignore
  }
  return fresh;
}

export function buildBackupPayload(state: JournalState): BackupPayload {
  return {
    ...state,
    format: 'msl-v10-premium',
    version: 10,
    exportedAt: new Date().toISOString(),
  };
}

export function parseBackupFile(jsonText: string): JournalState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON file. Please select a valid MSL journal backup.');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as BackupPayload).trades)) {
    throw new Error('This file does not appear to be an MSL Trading Journal backup.');
  }

  return normalizeState(parsed as Partial<JournalState>);
}

/**
 * Compresses a user-selected image file from the device gallery without opening camera.
 * Keeps crisp chart detail (max 1400px edge, 0.80 JPEG/WebP quality) while staying lightweight in IndexedDB.
 */
export function compressImageFile(file: File): Promise<TradeScreenshot> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`"${file.name}" is not an image file.`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not decode "${file.name}".`));
      img.onload = () => {
        const tryEncode = (maxEdge: number, quality: number): string => {
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas context unavailable for image processing.');
          }
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL('image/jpeg', quality);
        };

        try {
          let dataUrl = tryEncode(1400, 0.8);
          if (dataUrl.length > 680000) dataUrl = tryEncode(1200, 0.68);
          if (dataUrl.length > 680000) dataUrl = tryEncode(960, 0.56);

          resolve({
            id: generateId(),
            name: (file.name || 'chart.jpg').slice(0, 160),
            dataUrl,
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to process image.'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function checkPersistentStorage(): Promise<{ supported: boolean; persisted: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false, persisted: false };
  }
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { supported: Boolean(navigator.storage.persist), persisted };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
