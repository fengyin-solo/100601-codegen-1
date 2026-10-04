/**
 * 危险品判定规则引擎（纯函数）。
 *
 * 规则库（dgrule 模块的登记行）是唯一事实来源：哪些品名算危险品、走哪个 UN 编号、
 * 阈值是多少、标准包装等级是哪一档、申报等级与品类对不上时按哪一档收，全部查规则库。
 * 引擎不碰页面、不碰存储，输入申报事实 + 启用中的规则，输出判定结果与提交拦截项；
 * 申报单能不能提交审核，只认这里的 canSubmit。
 */
import type { EntryRow } from './types'

export const DG_MODULE_KEY = 'dgd'
export const RULE_MODULE_KEY = 'dgrule'
export const SHIPPER_MODULE_KEY = 'shipper'

// 申报单状态机：只能依次往下走，不允许跳级、不允许回退。
export const DGD_FLOW = ['草稿', '提交', '审核', '放行'] as const
export type DgdStatus = (typeof DGD_FLOW)[number]

// 包装等级固定三档，不再允许自由文本。I 最严，III 最宽。
export const PACKING_GROUPS = ['I', 'II', 'III'] as const
export type PackingGroup = (typeof PACKING_GROUPS)[number]
const GROUP_RANK: Record<PackingGroup, number> = { I: 3, II: 2, III: 1 }

export type ThresholdField = '件数' | '额定能量Wh'
export type CompareOp = '>=' | '>'
// 等级与品类对不上时怎么收档：就高=从严，就低=从宽，按规则=强制回到品类标准档。
export type MismatchPolicy = '就高' | '就低' | '按规则'
export const MISMATCH_POLICIES: MismatchPolicy[] = ['就高', '就低', '按规则']
export type Channel = '危险品' | '普货'

export interface DgRule {
  规则编号: string
  标准品名: string
  品名别名: string
  UN编号: string
  危险性类别: string
  阈值字段: ThresholdField | ''
  比较符: CompareOp
  阈值: number | null
  必须危险品: boolean
  标准包装等级: PackingGroup
  等级不符处理: MismatchPolicy
  enabled: boolean
}

export interface DgdFacts {
  品名: string
  件数: number | null
  额定能量Wh: number | null
  申报包装等级: PackingGroup | ''
}

export interface Determination {
  /** 是否命中规则库中的品名 */
  matched: boolean
  /** 命中的规则编号，未命中为空 */
  规则编号: string
  UN编号: string
  危险性类别: string
  标准品名: string
  /** 判定是否必须按危险品承运 */
  dangerous: boolean
  channel: Channel | ''
  /** 阈值是否通过（无阈值规则恒为 true；缺判定值/未达标为 false） */
  thresholdPassed: boolean
  /** 按规则（含不符处理策略）最终应收的包装等级 */
  packingGroup: PackingGroup | ''
  /** 申报等级与品类标准等级是否对不上 */
  packingMismatch: boolean
  /** 人读的判定经过，写进申报单留痕 */
  notes: string[]
  /** 提交审核时的拦截项；为空才允许提交 */
  gateErrors: string[]
  canSubmit: boolean
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/** 规则库存储行 → 引擎规则；登记行字段不齐时按「禁用、不参与判定」兜底。 */
export function ruleFromRow(row: EntryRow): DgRule {
  const group = String(row['标准包装等级'] ?? '')
  const field = String(row['阈值字段'] ?? '')
  const rawThreshold = row['阈值']
  const threshold = rawThreshold === '' || rawThreshold === undefined || rawThreshold === null
    ? null
    : Number(rawThreshold)
  return {
    规则编号: String(row['规则编号'] ?? ''),
    标准品名: String(row['标准品名'] ?? ''),
    品名别名: String(row['品名别名'] ?? ''),
    UN编号: String(row['UN编号'] ?? ''),
    危险性类别: String(row['危险性类别'] ?? ''),
    阈值字段: field === '件数' || field === '额定能量Wh' ? field : '',
    比较符: String(row['比较符'] ?? '>=') === '>' ? '>' : '>=',
    阈值: Number.isFinite(threshold) ? threshold : null,
    必须危险品: String(row['必须危险品'] ?? '是') !== '否',
    标准包装等级: group === 'I' || group === 'II' || group === 'III' ? group : 'II',
    等级不符处理:
      (['就高', '就低', '按规则'] as const).find((p) => p === String(row['等级不符处理'])) ??
      '就高',
    enabled: String(row.status ?? '启用') !== '停用',
  }
}

export function factsFromRow(row: Partial<Record<string, string | number | boolean>>): DgdFacts {
  const group = String(row['申报包装等级'] ?? '')
  const pieces = row['件数']
  const watts = row['额定能量Wh']
  return {
    品名: String(row['品名'] ?? '').trim(),
    件数: pieces === '' || pieces === undefined || pieces === null ? null : Number(pieces),
    额定能量Wh: watts === '' || watts === undefined || watts === null ? null : Number(watts),
    申报包装等级: group === 'I' || group === 'II' || group === 'III' ? group : '',
  }
}

function nameTokens(rule: DgRule): string[] {
  const tokens = rule.品名别名.split(/[;；,，、|\s/／]+/)
  return [rule.标准品名, ...tokens].map(normalizeName).filter(Boolean)
}

function matchRule(facts: DgdFacts, rule: DgRule): boolean {
  const declared = normalizeName(facts.品名)
  if (!declared) return false
  return nameTokens(rule).some((token) => declared.includes(token) || token.includes(declared))
}

function compare(value: number, op: CompareOp, threshold: number): boolean {
  return op === '>=' ? value >= threshold : value > threshold
}

/** 申报等级与品类标准档对不上时，按规则登记的策略收档。 */
function resolvePackingGroup(
  declared: PackingGroup | '',
  standard: PackingGroup,
  policy: MismatchPolicy,
): { group: PackingGroup; mismatch: boolean } {
  if (!declared) {
    return { group: standard, mismatch: true }
  }
  if (declared === standard) {
    return { group: standard, mismatch: false }
  }
  if (policy === '按规则') {
    return { group: standard, mismatch: true }
  }
  const takeHigher = GROUP_RANK[declared] > GROUP_RANK[standard]
  const picked = policy === '就高'
    ? takeHigher ? declared : standard
    : takeHigher
      ? standard
      : declared
  return { group: picked, mismatch: true }
}

/**
 * 判定入口：规则按登记顺序匹配，第一个命中的品名规则生效。
 * 只用启用中的规则。
 */
export function determineDangerousGoods(
  rawFacts: Partial<DgdFacts> & { 品名?: string },
  ruleRows: EntryRow[],
): Determination {
  const facts: DgdFacts = {
    品名: String(rawFacts.品名 ?? '').trim(),
    件数: rawFacts.件数 ?? null,
    额定能量Wh: rawFacts.额定能量Wh ?? null,
    申报包装等级: rawFacts.申报包装等级 ?? '',
  }
  const rules = ruleRows.map(ruleFromRow).filter((rule) => rule.enabled)
  const rule = rules.find((item) => matchRule(facts, item))

  const base: Determination = {
    matched: false,
    规则编号: '',
    UN编号: '',
    危险性类别: '',
    标准品名: '',
    dangerous: false,
    channel: '',
    thresholdPassed: false,
    packingGroup: '',
    packingMismatch: false,
    notes: [],
    gateErrors: [],
    canSubmit: false,
  }

  if (!facts.品名) {
    base.gateErrors.push('品名为空，无法按规则库判定，先填写品名')
    return base
  }
  if (!rule) {
    base.notes.push(`品名「${facts.品名}」未命中规则库任何危险品品名`)
    base.gateErrors.push(
      `品名「${facts.品名}」未在危险品判定规则库登记，无法确认是否危险品，不能提交危险品审核；如确属危险品，须先在规则库登记品名、阈值与包装等级规则`,
    )
    return base
  }

  const result: Determination = {
    ...base,
    matched: true,
    规则编号: rule.规则编号,
    UN编号: rule.UN编号,
    危险性类别: rule.危险性类别,
    标准品名: rule.标准品名,
    dangerous: rule.必须危险品,
    channel: rule.必须危险品 ? '危险品' : '普货',
  }
  result.notes.push(
    `品名命中规则 ${rule.规则编号}「${rule.标准品名}」（UN${rule.UN编号}，${rule.危险性类别}）`,
  )

  // 阈值：规则声明了阈值字段就必须按阈值判断走不走危险品通道。
  if (!rule.阈值字段 || rule.阈值 === null) {
    result.thresholdPassed = true
  } else {
    const value = rule.阈值字段 === '件数' ? facts.件数 : facts.额定能量Wh
    if (value === null || Number.isNaN(value)) {
      result.notes.push(`规则要求按「${rule.阈值字段}」判定阈值，申报未填写该值`)
      result.gateErrors.push(
        `规则 ${rule.规则编号} 要求按「${rule.阈值字段}」与阈值比较，但申报单未填写${rule.阈值字段}，无法判定`,
      )
    } else if (compare(value, rule.比较符, rule.阈值)) {
      result.thresholdPassed = true
      result.notes.push(
        `阈值通过：${rule.阈值字段} ${value} ${rule.比较符} ${rule.阈值}，必须走危险品通道`,
      )
    } else {
      result.thresholdPassed = false
      result.notes.push(
        `阈值未达：${rule.阈值字段} ${value} 未满足 ${rule.比较符} ${rule.阈值}，应走普货通道`,
      )
      result.gateErrors.push(
        `按规则 ${rule.规则编号}「${rule.标准品名}」的阈值（${rule.阈值字段} ${rule.比较符} ${rule.阈值}），本次申报 ${value} 未达到危险品标准，应走普货通道，不得以危险品申报单提交审核`,
      )
    }
  }

  // 包装等级：自由文本一律不认，只认 I/II/III；与品类对不上时按策略收档。
  if (!facts.申报包装等级) {
    result.gateErrors.push('包装等级必须从 I/II/III 三档中选择，不允许填写自由文本')
    result.packingGroup = rule.标准包装等级
    result.packingMismatch = true
    result.notes.push('未选择包装等级，暂按品类标准档登记，提交前必须补选')
  } else {
    const resolved = resolvePackingGroup(
      facts.申报包装等级,
      rule.标准包装等级,
      rule.等级不符处理,
    )
    result.packingGroup = resolved.group
    result.packingMismatch = resolved.mismatch
    if (resolved.mismatch) {
      result.notes.push(
        `申报包装等级 ${facts.申报包装等级} 与品类标准等级 ${rule.标准包装等级} 不符，按「${rule.等级不符处理}」收为 ${resolved.group} 档`,
      )
    } else {
      result.notes.push(`包装等级核对一致：${resolved.group} 档`)
    }
  }

  result.canSubmit = result.gateErrors.length === 0
  return result
}

export type QualificationState = '有效' | '已过期' | '已注销' | '未登记'

export interface Qualification {
  state: QualificationState
  ok: boolean
  证书编号: string
  有效期: string
  message: string
}

export function todayLocal(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** 托运人资质核对：注销、过期都不能承运危险品；有效期按当天日期判断。 */
export function checkQualification(
  shipper: EntryRow | undefined,
  today: string = todayLocal(),
): Qualification {
  if (!shipper) {
    return {
      state: '未登记',
      ok: false,
      证书编号: '',
      有效期: '',
      message: '托运人未在资质台账登记，不能受理危险品申报',
    }
  }
  const cert = String(shipper['资质证书编号'] ?? '')
  const expiry = String(shipper['资质有效期'] ?? '')
  if (String(shipper.status) === '已注销') {
    return {
      state: '已注销',
      ok: false,
      证书编号: cert,
      有效期: expiry,
      message: `托运人资质已注销（证书 ${cert}），整单退回`,
    }
  }
  if (expiry && expiry < today) {
    return {
      state: '已过期',
      ok: false,
      证书编号: cert,
      有效期: expiry,
      message: `托运人资质已于 ${expiry} 过期（判定日期 ${today}），整单退回`,
    }
  }
  return {
    state: '有效',
    ok: true,
    证书编号: cert,
    有效期: expiry,
    message: expiry ? `资质有效，有效期至 ${expiry}` : '资质有效',
  }
}
