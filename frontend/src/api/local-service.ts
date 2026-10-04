import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  DG_MODULE_KEY,
  RULE_MODULE_KEY,
  SHIPPER_MODULE_KEY,
  DGD_FLOW,
  checkQualification,
  determineDangerousGoods,
  factsFromRow,
} from '@/data/dangerous-goods'
import type { PackingGroup } from '@/data/dangerous-goods'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '注销', '退回']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 下拉选项等场景读全量（不过滤、不分页）。 */
export function listAllRows(key: string): EntryRow[] {
  return listRows(key)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---------------------------------------------------------------------------
// 危险品申报单：判定、状态机、资质、去重、待办台账
// ---------------------------------------------------------------------------

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function findShipper(name: string): EntryRow | undefined {
  return listRows(SHIPPER_MODULE_KEY).find(
    (row) => String(row['托运人'] ?? '') === name && String(row.status) !== '已注销',
  )
}

/** 新单登记入口：规则库、托运人等普通模块复用，默认落在模块首个状态。 */
export function createEntry(key: string, values: Record<string, string | number>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const status = meta.statuses[0]
  const row: EntryRow = {
    id: nextId(rows),
    status,
    pending: status !== meta.statuses[meta.statuses.length - 1],
    abnormal: false,
    ...values,
  }
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}已登记，当前状态「${status}」`, id: row.id }
}

/** 不保存，只按当前录入内容做一次判定预览，给登记表单实时反馈。 */
export function previewDetermination(values: {
  品名: string
  件数: number | null
  额定能量Wh: number | null
  申报包装等级: PackingGroup | ''
}) {
  return determineDangerousGoods(values, listRows(RULE_MODULE_KEY))
}

export type DgdDraftInput = {
  托运批次号: string
  航班号: string
  航班日期: string
  品名: string
  件数: number
  额定能量Wh: number
  申报包装等级: string
  托运人: string
}

const REQUIRED_DGD_FIELDS: { field: keyof DgdDraftInput; label: string }[] = [
  { field: '托运批次号', label: '托运批次号' },
  { field: '航班号', label: '航班号' },
  { field: '航班日期', label: '航班日期' },
  { field: '品名', label: '品名' },
  { field: '托运人', label: '托运人' },
]

/** 登记申报单：先落草稿，判定结果与收档等级在落单时就按规则库固定下来。 */
export function createDgdDraft(input: DgdDraftInput): ActionResult {
  const rows = listRows(DG_MODULE_KEY)
  for (const { field, label } of REQUIRED_DGD_FIELDS) {
    if (String(input[field] ?? '').trim() === '') {
      return { ok: false, message: `${label}未填写，不能登记申报单` }
    }
  }
  const determination = determineDangerousGoods(
    factsFromRow(input),
    listRows(RULE_MODULE_KEY),
  )
  const shipper = findShipper(input.托运人)
  const id = nextId(rows)
  const row: EntryRow = {
    id,
    status: '草稿',
    pending: true,
    abnormal: false,
    申报单号: `DGD-${String(id).padStart(4, '0')}`,
    托运批次号: input.托运批次号,
    航班号: input.航班号,
    航班日期: input.航班日期,
    品名: input.品名,
    件数: Number(input.件数) || 0,
    额定能量Wh: Number(input.额定能量Wh) || 0,
    申报包装等级: input.申报包装等级,
    托运人: input.托运人,
    资质证书编号: shipper ? String(shipper['资质证书编号'] ?? '') : '',
    资质有效期: shipper ? String(shipper['资质有效期'] ?? '') : '',
    判定结果: !determination.matched
      ? '规则库未登记'
      : determination.dangerous && determination.thresholdPassed
        ? '危险品'
        : '普货',
    UN编号: determination.UN编号,
    规则编号: determination.规则编号,
    应收包装等级: determination.packingGroup,
    判定说明: determination.notes.join('；'),
    退回原因: '',
    来源: '手工登记',
  }
  saveRows(DG_MODULE_KEY, [...rows, row])
  return {
    ok: true,
    id,
    message: determination.canSubmit
      ? `申报单 ${row.申报单号} 已保存为草稿，判定通过可提交审核`
      : `申报单 ${row.申报单号} 已保存为草稿，但判定未通过：${determination.gateErrors.join('；')}`,
  }
}

function locateDgd(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | { error: string } {
  const rows = listRows(DG_MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { error: `没有找到编号为 ${id} 的危险品申报单` }
  }
  return { rows, index, row: rows[index] }
}

function persistDgd(rows: EntryRow[], index: number, row: EntryRow): void {
  const next = [...rows]
  next[index] = row
  saveRows(DG_MODULE_KEY, next)
}

function flowStep(status: string): number {
  return DGD_FLOW.indexOf(status as (typeof DGD_FLOW)[number])
}

/**
 * 提交审核（草稿 → 提交）。三道闸门按序拦截：
 * 1. 状态机：只有草稿能提交，跳级/回退指明卡在哪一环；
 * 2. 幂等：同一次托运（托运批次号）已有生效中的单据，重复提交只生效一次；
 * 3. 资质过期/注销：整单退回草稿；
 * 4. 规则判定：未登记品名、阈值未达、包装等级不合规，一律不能提交。
 */
export function submitDgd(id: number): ActionResult {
  const located = locateDgd(id)
  if ('error' in located) {
    return { ok: false, message: located.error }
  }
  const { rows, index, row } = located
  const current = String(row.status)
  if (current === '提交') {
    return { ok: false, message: '该批次已提交，重复提交不生效；当前环节：提交（等待审核）' }
  }
  if (current === '审核' || current === '放行') {
    return {
      ok: false,
      message: `单据当前是「${current}」，已越过提交环节，不能重复提交；卡在：提交（该批次已在更后环节，跳级/重复操作挡回）`,
    }
  }
  if (current !== '草稿') {
    return { ok: false, message: `单据当前是「${current}」，必须先回到「草稿」才能提交` }
  }

  // 同一次托运只生效一次：批次号相同且已有提交以后的单据，挡回。
  const duplicate = rows.find(
    (item) =>
      Number(item.id) !== id &&
      String(item['托运批次号'] ?? '') === String(row['托运批次号'] ?? '') &&
      flowStep(String(item.status)) >= flowStep('提交'),
  )
  if (duplicate) {
    return {
      ok: false,
      message: `托运批次 ${row['托运批次号']} 已有生效中的申报单 ${duplicate['申报单号']}（状态「${duplicate.status}」），同一次托运重复提交只生效一次，本单挡回`,
    }
  }

  // 资质：过期/注销整单退回（回到草稿并标异常）。
  const qualification = checkQualification(findShipper(String(row['托运人'] ?? '')))
  if (!qualification.ok) {
    const returned: EntryRow = {
      ...row,
      status: '草稿',
      pending: true,
      abnormal: true,
      资质证书编号: qualification.证书编号,
      资质有效期: qualification.有效期,
      退回原因: qualification.message,
    }
    persistDgd(rows, index, returned)
    return { ok: false, message: `整单退回：${qualification.message}；单据保持「草稿」，请更换有资质的托运人后再提交` }
  }

  // 规则判定：以规则库现状重跑，判定结果决定能不能提交审核。
  const determination = determineDangerousGoods(factsFromRow(row), listRows(RULE_MODULE_KEY))
  if (!determination.canSubmit) {
    return {
      ok: false,
      message: `判定不通过，不能提交审核：${determination.gateErrors.join('；')}`,
    }
  }

  const submitted: EntryRow = {
    ...row,
    status: '提交',
    pending: true,
    abnormal: false,
    资质证书编号: qualification.证书编号,
    资质有效期: qualification.有效期,
    判定结果: determination.dangerous ? '危险品' : '普货',
    UN编号: determination.UN编号,
    规则编号: determination.规则编号,
    应收包装等级: determination.packingGroup,
    判定说明: determination.notes.join('；'),
    退回原因: '',
  }
  persistDgd(rows, index, submitted)
  return {
    ok: true,
    message: `判定通过（${determination.channel}，应收包装等级 ${determination.packingGroup} 档），申报单已提交审核，当前环节：提交`,
  }
}

/** 审核（提交 → 审核）。只有「提交」环节的单据能审核，跳级直接挡回。 */
export function approveDgd(id: number): ActionResult {
  const located = locateDgd(id)
  if ('error' in located) {
    return { ok: false, message: located.error }
  }
  const { rows, index, row } = located
  const current = String(row.status)
  if (current === '审核') {
    return { ok: false, message: '单据已审核，当前环节：审核（等待放行），无需重复操作' }
  }
  if (current === '放行') {
    return { ok: false, message: '单据已放行，不能再回到审核环节，操作挡回' }
  }
  if (current !== '提交') {
    const need = current === '草稿' ? '先提交审核' : `当前环节「${current}」`
    return {
      ok: false,
      message: `跳级操作挡回：审核要求单据处于「提交」环节，本单${need}；卡在：审核`,
    }
  }
  persistDgd(rows, index, { ...row, status: '审核', pending: true, abnormal: false, 退回原因: '' })
  return { ok: true, message: '审核通过，当前环节：审核（等待放行）；已计入航班限制件待办台账' }
}

/** 审核退回（提交 → 草稿）：补正后可重新提交。 */
export function rejectDgd(id: number, reason: string): ActionResult {
  const located = locateDgd(id)
  if ('error' in located) {
    return { ok: false, message: located.error }
  }
  const { rows, index, row } = located
  const current = String(row.status)
  if (current !== '提交') {
    return {
      ok: false,
      message: `只有「提交」环节的单据能审核退回，本单当前是「${current}」；卡在：审核退回`,
    }
  }
  const note = reason.trim() || '审核退回：申报内容需要补正'
  persistDgd(rows, index, {
    ...row,
    status: '草稿',
    pending: true,
    abnormal: true,
    退回原因: note,
  })
  return { ok: false, message: `审核退回，单据回到「草稿」：${note}` }
}

/** 放行（审核 → 放行）。只有审核环节能放行；放行是终态，之后任何回退都挡回。 */
export function releaseDgd(id: number): ActionResult {
  const located = locateDgd(id)
  if ('error' in located) {
    return { ok: false, message: located.error }
  }
  const { rows, index, row } = located
  const current = String(row.status)
  if (current === '放行') {
    return { ok: false, message: '单据已经放行，终态不可重复操作' }
  }
  if (current !== '审核') {
    return {
      ok: false,
      message: `跳级操作挡回：放行要求单据处于「审核」环节，本单当前是「${current}」；卡在：放行`,
    }
  }
  persistDgd(rows, index, { ...row, status: '放行', pending: false, abnormal: false })
  return { ok: true, message: '已放行，流程终结；放行后不可再回到审核' }
}

export type RestrictedLedgerRow = {
  航班号: string
  航班日期: string
  待审核票数: number
  待放行票数: number
  已放行票数: number
  限制件票数: number
  限制件总件数: number
  items: EntryRow[]
}

function flightDateOf(row: EntryRow): string {
  return String(row['航班日期'] ?? '').trim()
}

function flightKey(no: string, date: string): string {
  return `${no}|${date}`
}

/**
 * 航班限制件待办台账：由审核结论驱动，直接从申报单实时聚合，不另存第二份数字。
 * 航班保障页与地服台账页都调本函数，读到的必然是同一份。
 * 计入范围：判定为危险品、阈值通过，且已经过审核的票（审核/放行）。
 */
export function loadRestrictedLedger(): RestrictedLedgerRow[] {
  const rows = listRows(DG_MODULE_KEY)
  const groups = new Map<string, RestrictedLedgerRow>()
  const ensureGroup = (no: string, date: string): RestrictedLedgerRow => {
    const key = flightKey(no, date)
    const existing = groups.get(key)
    if (existing) {
      return existing
    }
    const created: RestrictedLedgerRow = {
      航班号: no,
      航班日期: date,
      待审核票数: 0,
      待放行票数: 0,
      已放行票数: 0,
      限制件票数: 0,
      限制件总件数: 0,
      items: [],
    }
    groups.set(key, created)
    return created
  }
  for (const row of rows) {
    const dangerous = String(row['判定结果']) === '危险品'
    const status = String(row.status)
    if (!dangerous) {
      continue
    }
    const group = ensureGroup(String(row['航班号'] ?? ''), flightDateOf(row))
    if (status === '提交') {
      // 已提交等审核结论：提示地服关注，但还没确认为限制件，不计入票数。
      group.待审核票数 += 1
    } else if (status === '审核' || status === '放行') {
      // 只有审核结论确认后的票才计入限制件，两边页面读到的就是这一份聚合。
      group.items.push(row)
      group.限制件票数 += 1
      group.限制件总件数 += Number(row['件数']) || 0
      if (status === '审核') {
        group.待放行票数 += 1
      } else {
        group.已放行票数 += 1
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.航班日期.localeCompare(a.航班日期))
}

/** 航班保障页取本航班限制件数：与地服台账同一数据源，按航班号 + 航班日期精确对应。 */
export function restrictedCountForFlight(no: string, plannedArrival: string): {
  限制件票数: number
  限制件总件数: number
  待放行票数: number
} {
  const date = String(plannedArrival ?? '').slice(0, 10)
  const row = loadRestrictedLedger().find(
    (item) => item.航班号 === no && item.航班日期 === date,
  )
  if (!row) {
    return { 限制件票数: 0, 限制件总件数: 0, 待放行票数: 0 }
  }
  return {
    限制件票数: row.限制件票数,
    限制件总件数: row.限制件总件数,
    待放行票数: row.待放行票数,
  }
}


export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
