// Node 自测引导：在业务模块加载前补上浏览器 localStorage 桩。
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).localStorage = new MemoryStorage()

import('./selftest-main.ts')
