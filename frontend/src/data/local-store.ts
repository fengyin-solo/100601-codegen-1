import { SEED_ROWS } from './seed'
import { DG_MODULE_KEY, RULE_MODULE_KEY } from './dangerous-goods'
import { MIGRATION_FLAG, buildMigratedRows } from './migration'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function migrateLegacyDeclarations(
  rows: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return rows
  }
  if (window.localStorage.getItem(MIGRATION_FLAG)) {
    return rows
  }
  const dgdRows = [...(rows[DG_MODULE_KEY] ?? [])]
  const existingBatches = new Set(
    dgdRows.map((row) => String(row['托运批次号'] ?? '')).filter(Boolean),
  )
  let maxId = dgdRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const nextId = () => ++maxId
  const migrated = buildMigratedRows(
    rows[RULE_MODULE_KEY] ?? [],
    existingBatches,
    nextId,
  )
  window.localStorage.setItem(MIGRATION_FLAG, 'done')
  if (migrated.length === 0) {
    return rows
  }
  return { ...rows, [DG_MODULE_KEY]: [...dgdRows, ...migrated] }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrateLegacyDeclarations(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 模块种子可能新增（如规则库、托运人、危险品申报单），先补齐再跑历史迁移。
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    const migrated = migrateLegacyDeclarations(merged)
    if (migrated !== merged) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    const seeded = migrateLegacyDeclarations(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
