import { generateId } from './calculations';
import { VALIDATION_LIMITS } from './validationConstants';
import type { AIMemoryCategory, AIMemoryItem } from '../types/journal';

const AI_MEMORIES_KEY = 'msl_ai_memories_v1';
const MAX_MEMORIES = 60;

export function normalizeMemoryCategory(raw?: unknown): AIMemoryCategory {
  const s = String(raw || '').toLowerCase();
  if (s.includes('pref')) return 'preference';
  if (s.includes('rule')) return 'rule';
  if (s.includes('goal')) return 'goal';
  return 'context';
}

export function loadAIMemories(): AIMemoryItem[] {
  try {
    const raw = localStorage.getItem(AI_MEMORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is AIMemoryItem => Boolean(item && typeof item.content === 'string' && item.content.trim()))
      .map((item) => ({
        id: String(item.id || generateId()),
        content: String(item.content).trim().slice(0, VALIDATION_LIMITS.memoryContentMaxLength),
        category: normalizeMemoryCategory(item.category),
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
      }))
      .slice(0, MAX_MEMORIES);
  } catch {
    return [];
  }
}

export function saveAIMemories(memories: AIMemoryItem[]): void {
  try {
    localStorage.setItem(AI_MEMORIES_KEY, JSON.stringify(memories.slice(0, MAX_MEMORIES)));
  } catch {
    // Ignore storage quota errors
  }
}

export function upsertAIMemory(
  existing: AIMemoryItem[],
  content: string,
  category?: AIMemoryCategory
): { item: AIMemoryItem; nextList: AIMemoryItem[] } | null {
  const clean = content.trim().slice(0, VALIDATION_LIMITS.memoryContentMaxLength);
  if (!clean) return null;

  const now = new Date().toISOString();
  const normalizedCategory = normalizeMemoryCategory(category);
  const lowerClean = clean.toLowerCase();

  const match = existing.find((m) => m.content.trim().toLowerCase() === lowerClean);
  if (match) {
    const updated: AIMemoryItem = {
      ...match,
      content: clean,
      category: category ? normalizedCategory : match.category,
      updatedAt: now,
    };
    const nextList = [updated, ...existing.filter((m) => m.id !== match.id)].slice(0, MAX_MEMORIES);
    saveAIMemories(nextList);
    return { item: updated, nextList };
  }

  const created: AIMemoryItem = {
    id: generateId(),
    content: clean,
    category: normalizedCategory,
    createdAt: now,
    updatedAt: now,
  };
  const nextList = [created, ...existing].slice(0, MAX_MEMORIES);
  saveAIMemories(nextList);
  return { item: created, nextList };
}

export function removeAIMemory(
  existing: AIMemoryItem[],
  opts: { memoryId?: string; query?: string }
): { removed: AIMemoryItem[]; nextList: AIMemoryItem[] } {
  const idTarget = String(opts.memoryId || '').trim();
  const queryTarget = String(opts.query || '').trim().toLowerCase();

  const removed: AIMemoryItem[] = [];
  const kept: AIMemoryItem[] = [];

  for (const item of existing) {
    const idMatch = Boolean(idTarget && item.id === idTarget);
    const queryMatch = Boolean(
      queryTarget &&
        (item.content.toLowerCase().includes(queryTarget) ||
          queryTarget.includes(item.content.toLowerCase()))
    );
    if (idMatch || queryMatch) {
      removed.push(item);
    } else {
      kept.push(item);
    }
  }

  if (removed.length > 0) {
    saveAIMemories(kept);
  }
  return { removed, nextList: kept };
}
