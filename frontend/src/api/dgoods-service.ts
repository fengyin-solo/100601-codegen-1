import { matchRule } from '@/data/dgoods-rules'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 危险品申报单的专用服务：判定、幂等、顺序流转、资质校验、限制件台账都收在这里，
// 不走通用 runAction，避免跳级流转绕过规则。
const KEY = 'dgoods'

// 申报单只能按 草稿→已提交→已审核→已放行 依次往下走。
const FLOW = ['草稿', '已提交', '已审核', '已放行']
const ACTION_FLOW: Record<string, { from: string; to: string }> = {
  提交审核: { from: '草稿', to: '已提交' },
  登记审核: { from: '已提交', to: '已审核' },
  确认放行: { from: '已审核', to: '已放行' },
}
// 每个状态对应的下一步动作，用于跳级挡回时说明卡在哪一环。
const NEXT_ACTION: Record<string, string> = {
  草稿: '提交审核',
  已提交: '登记审核',
  已审核: '确认放行',
}

export type DeclarationInput = {
  航班号: string
  航班日期: string
  品名: string
  包装等级: string
  托运人: string
  资质有效期: string
}

export type JudgeResult = {
  hit: boolean
  可提交: boolean
  判定结果: string
  收运包装等级: string
  规则编号: string
}

export type LedgerEntry = {
  航班号: string
  航班日期: string
  限制件票数: number
  申报单号: string[]
}

type HistoryEntry = { 时间: string; 事件: string }

function rows(): EntryRow[] {
  return listRows(KEY)
}

function persist(next: EntryRow[]): void {
  saveRows(KEY, next)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function readHistory(row: EntryRow): HistoryEntry[] {
  try {
    const parsed = JSON.parse(String(row['历史记录'] ?? '[]')) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function appendHistory(row: EntryRow, event: string): EntryRow {
  const history = [...readHistory(row), { 时间: today(), 事件: event }]
  return { ...row, 历史记录: JSON.stringify(history) }
}

// 同一次托运的唯一键：航班号+航班日期+托运人+品名，重复提交只生效一次。
function consignmentKey(input: Pick<DeclarationInput, '航班号' | '航班日期' | '托运人' | '品名'>): string {
  return [input.航班号, input.航班日期, input.托运人, input.品名].map((s) => s.trim()).join('|')
}

// 资质有效期早于航班日期即视为收运时已过期。
export function qualificationExpired(资质有效期: string, 航班日期: string): boolean {
  return Boolean(资质有效期) && Boolean(航班日期) && 资质有效期 < 航班日期
}

// 判定：命中规则即危险品，按规则表标准档收运；未命中判普货，不能提交审核。
export function judgeDeclaration(品名: string, 包装等级: string): JudgeResult {
  const rule = matchRule(品名)
  if (!rule) {
    return {
      hit: false,
      可提交: false,
      判定结果: '未命中危险品规则，判定为普货，不能按危险品申报单提交审核',
      收运包装等级: 包装等级,
      规则编号: '',
    }
  }
  if (rule.标准包装等级 === 包装等级) {
    return {
      hit: true,
      可提交: true,
      判定结果: `危险品｜${rule.危险品类目}｜按 ${rule.标准包装等级} 级包装收运`,
      收运包装等级: rule.标准包装等级,
      规则编号: rule.规则编号,
    }
  }
  return {
    hit: true,
    可提交: true,
    判定结果: `危险品｜${rule.危险品类目}｜申报包装等级 ${包装等级} 与品类不符，${rule.等级不符处理}`,
    收运包装等级: rule.标准包装等级,
    规则编号: rule.规则编号,
  }
}

// 登记申报单（草稿）：同一次托运重复登记直接挡回，判定结果随单保存。
export function createDeclaration(input: DeclarationInput): ActionResult & { id?: number } {
  const required: [keyof DeclarationInput, string][] = [
    ['航班号', '航班号'],
    ['航班日期', '航班日期'],
    ['品名', '品名'],
    ['包装等级', '包装等级'],
    ['托运人', '托运人'],
    ['资质有效期', '托运人资质有效期'],
  ]
  for (const [field, label] of required) {
    if (!String(input[field] ?? '').trim()) {
      return { ok: false, message: `请填写${label}` }
    }
  }
  const current = rows()
  const key = consignmentKey(input)
  const duplicated = current.find((row) => consignmentKey({
    航班号: String(row['航班号']),
    航班日期: String(row['航班日期']),
    托运人: String(row['托运人']),
    品名: String(row['品名']),
  }) === key)
  if (duplicated) {
    return {
      ok: false,
      message: `同一次托运已登记申报单 ${duplicated['申报单号']}（当前「${duplicated.status}」），重复提交只生效一次`,
    }
  }
  const judge = judgeDeclaration(input.品名, input.包装等级)
  const id = current.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '草稿',
    pending: true,
    abnormal: false,
    申报单号: `DG-${String(id).padStart(4, '0')}`,
    航班号: input.航班号.trim(),
    航班日期: input.航班日期,
    品名: input.品名.trim(),
    包装等级: input.包装等级,
    托运人: input.托运人.trim(),
    资质有效期: input.资质有效期,
    判定结果: judge.判定结果,
    判定可提交: judge.可提交 ? '是' : '否',
    收运包装等级: judge.收运包装等级,
    审核结论: '',
    历史记录: '',
  }
  const withHistory = appendHistory(row, `登记草稿，判定：${judge.判定结果}`)
  persist([...current, withHistory])
  return { ok: true, message: `申报单 ${withHistory['申报单号']} 已登记为草稿`, id }
}

// 顺序流转：跳级挡回并说明卡在哪一环；已放行是终态，不能再回到审核。
export function runDgoodsAction(id: number, action: string): ActionResult {
  const spec = ACTION_FLOW[action]
  if (!spec) {
    return { ok: false, message: `危险品申报单没有登记「${action}」这个动作` }
  }
  const current = rows()
  const index = current.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的危险品申报单` }
  }
  const row = current[index]
  const status = String(row.status)
  if (status === '已放行') {
    return { ok: false, message: '该单已放行，是终态，不能再回到审核或其他环节' }
  }
  if (status === spec.to) {
    return { ok: false, message: `该单已是「${spec.to}」，不用重复操作` }
  }
  if (status !== spec.from) {
    return {
      ok: false,
      message: `跳级被挡回：该单当前在「${status}」，需先完成「${NEXT_ACTION[status]}」才能${action}，流转顺序为 草稿→提交→审核→放行`,
    }
  }
  if (action === '提交审核') {
    if (String(row['判定可提交']) !== '是') {
      return { ok: false, message: `判定结果不允许提交：${row['判定结果']}` }
    }
    if (qualificationExpired(String(row['资质有效期']), String(row['航班日期']))) {
      const returned = appendHistory(
        { ...row, abnormal: true },
        `提交审核被退回：托运人资质 ${row['资质有效期']} 已过期`,
      )
      const next = [...current]
      next[index] = returned
      persist(next)
      return {
        ok: false,
        message: `托运人资质已于 ${row['资质有效期']} 过期（航班日期 ${row['航班日期']}），整单退回，需更新资质后重新登记`,
      }
    }
    const key = consignmentKey({
      航班号: String(row['航班号']),
      航班日期: String(row['航班日期']),
      托运人: String(row['托运人']),
      品名: String(row['品名']),
    })
    const active = current.find(
      (other) =>
        Number(other.id) !== id &&
        ['已提交', '已审核', '已放行'].includes(String(other.status)) &&
        consignmentKey({
          航班号: String(other['航班号']),
          航班日期: String(other['航班日期']),
          托运人: String(other['托运人']),
          品名: String(other['品名']),
        }) === key,
    )
    if (active) {
      return {
        ok: false,
        message: `同一次托运已有申报单 ${active['申报单号']} 进入「${active.status}」，重复提交只生效一次`,
      }
    }
  }
  let updated: EntryRow = {
    ...row,
    status: spec.to,
    pending: spec.to !== '已放行',
    abnormal: false,
  }
  if (action === '登记审核') {
    updated = { ...updated, 审核结论: `同意收运（按 ${row['收运包装等级']} 级包装）` }
  }
  updated = appendHistory(updated, `${action}：${spec.from}→${spec.to}`)
  const next = [...current]
  next[index] = updated
  persist(next)
  return { ok: true, message: `申报单 ${row['申报单号']} 已${action}，当前状态「${spec.to}」` }
}

// 限制件待办台账：审核结论为同意收运的申报单按航班汇总。
// 这是唯一数据源，危险品申报页和航班保障页（地服视角）都读这里，两边数字必然一致。
export function restrictedLedger(): LedgerEntry[] {
  const grouped = new Map<string, LedgerEntry>()
  for (const row of rows()) {
    if (!String(row['审核结论'] ?? '').startsWith('同意收运')) {
      continue
    }
    const key = `${row['航班号']}|${row['航班日期']}`
    const entry = grouped.get(key) ?? {
      航班号: String(row['航班号']),
      航班日期: String(row['航班日期']),
      限制件票数: 0,
      申报单号: [],
    }
    entry.限制件票数 += 1
    entry.申报单号.push(String(row['申报单号']))
    grouped.set(key, entry)
  }
  return [...grouped.values()].sort((a, b) => a.航班日期.localeCompare(b.航班日期))
}

export function declarationHistory(row: EntryRow): HistoryEntry[] {
  return readHistory(row)
}

// 存量迁移：按航班日期给没有历史记录的申报单回填流转历史，幂等，已回填的跳过。
export function migrateDgoodsHistory(): { migrated: number } {
  const current = rows()
  let migrated = 0
  const next = current.map((row) => {
    if (readHistory(row).length > 0) {
      return row
    }
    migrated += 1
    const date = String(row['航班日期'] || today())
    const reached = FLOW.slice(0, FLOW.indexOf(String(row.status)) + 1)
    const stages = ['登记草稿', '提交审核', '登记审核', '确认放行'].slice(0, reached.length)
    const history: HistoryEntry[] = stages.map((stage) => ({
      时间: date,
      事件: `存量迁移回填：${stage}（按航班日期 ${date} 补登）`,
    }))
    if (row['审核结论']) {
      history.push({ 时间: date, 事件: `存量迁移回填：审核结论=${row['审核结论']}` })
    }
    return { ...row, 历史记录: JSON.stringify(history) }
  })
  if (migrated > 0) {
    persist(next)
  }
  return { migrated }
}
