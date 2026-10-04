/**
 * 存量申报迁移：新危险品申报单上线前，货站把锂电池当普货收进来的历史记录，
 * 按航班日期回填成危险品申报单，重新过一遍判定规则库，补上判定结论与收档等级。
 *
 * 迁移幂等：每条历史记录带唯一托运批次号，已迁移过的不再重复回填；
 * 整个迁移用一次性标记位兜底，localStorage 已存在用户数据时也只补这一轮。
 */
import type { EntryRow } from './types'
import { determineDangerousGoods, factsFromRow } from './dangerous-goods'

export const MIGRATION_FLAG = 'airport-ground-ops:dgd-migrated-v1'

/** 存量普货记录（来自旧申报单/货运系统导出的历史数据，这里用样例模拟）。 */
export const LEGACY_ENTRIES = [
  {
    托运批次号: 'LEGACY-20260918-CA1202-07',
    航班号: 'CA1202',
    航班日期: '2026-09-18',
    品名: '移动电源（内置锂电池）',
    件数: 24,
    额定能量Wh: 160,
    申报包装等级: 'III',
    托运人: '华北锂电科技',
    原始货运单号: 'OLD-CGO-20260918-0031',
  },
  {
    托运批次号: 'LEGACY-20260926-CZ3101-12',
    航班号: 'CZ3101',
    航班日期: '2026-09-26',
    品名: '含锂金属纽扣电池设备',
    件数: 8,
    额定能量Wh: 0,
    申报包装等级: 'II',
    托运人: '恒通电子贸易',
    原始货运单号: 'OLD-CGO-20260926-0117',
  },
  {
    托运批次号: 'LEGACY-20260930-HU7805-03',
    航班号: 'HU7805',
    航班日期: '2026-09-30',
    品名: '普通服装纸箱',
    件数: 40,
    额定能量Wh: 0,
    申报包装等级: '',
    托运人: '京杭货运代理',
    原始货运单号: 'OLD-CGO-20260930-0208',
  },
] as const

/** 历史记录回填为申报单：判定不过规则库的也如实留痕，供事后复盘，不再卡提交。 */
export function buildMigratedRows(
  ruleRows: EntryRow[],
  existingBatches: Set<string>,
  nextId: () => number,
): EntryRow[] {
  const rows: EntryRow[] = []
  for (const legacy of LEGACY_ENTRIES) {
    if (existingBatches.has(legacy.托运批次号)) {
      continue
    }
    const determination = determineDangerousGoods(
      factsFromRow(legacy),
      ruleRows,
    )
    rows.push({
      id: nextId(),
      status: '放行',
      // 历史已承运，不算在待办里
      pending: false,
      abnormal: false,
      申报单号: `DGD-HIS-${String(rows.length + 1).padStart(4, '0')}`,
      托运批次号: legacy.托运批次号,
      航班号: legacy.航班号,
      航班日期: legacy.航班日期,
      品名: legacy.品名,
      件数: legacy.件数,
      额定能量Wh: legacy.额定能量Wh,
      申报包装等级: legacy.申报包装等级,
      托运人: legacy.托运人,
      资质证书编号: '',
      资质有效期: '',
      判定结果: determination.dangerous && determination.thresholdPassed ? '危险品' : '普货',
      UN编号: determination.UN编号,
      规则编号: determination.规则编号,
      应收包装等级: determination.packingGroup,
      判定说明: determination.notes.join('；') || '规则库无匹配品名',
      退回原因: '',
      原始货运单号: legacy.原始货运单号,
      来源: '历史迁移',
    })
  }
  return rows
}
