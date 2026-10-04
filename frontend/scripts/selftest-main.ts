import {
  approveDgd,
  createDgdDraft,
  loadRestrictedLedger,
  previewDetermination,
  rejectDgd,
  releaseDgd,
  restrictedCountForFlight,
  submitDgd,
} from '/workspace/frontend/src/api/local-service'
import { allRows } from '/workspace/frontend/src/data/local-store'
import { determineDangerousGoods, factsFromRow, checkQualification } from '/workspace/frontend/src/data/dangerous-goods'

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass += 1; console.log('  ✓', label) }
  else { fail += 1; console.error('  ✗', label) }
}

// ---------- 1. 规则引擎 ----------
console.log('[规则引擎]')
const rules = allRows()['dgrule']

const liOk = determineDangerousGoods(
  factsFromRow({ 品名: '充电宝（含锂离子电池）', 件数: 10, 额定能量Wh: 160, 申报包装等级: 'II' }),
  rules,
)
assert(liOk.matched && liOk.dangerous && liOk.thresholdPassed && liOk.canSubmit, '锂电池 160Wh 命中 DG-001 且阈值通过可提交')
assert(liOk.packingGroup === 'II', '等级一致收为 II 档')

const liLow = determineDangerousGoods(
  factsFromRow({ 品名: '充电宝', 件数: 10, 额定能量Wh: 48, 申报包装等级: 'II' }),
  rules,
)
assert(!liLow.thresholdPassed && !liLow.canSubmit, '48Wh 未达 100Wh 阈值，判普货，不能提交危险品审核')
assert(liLow.gateErrors.some((m) => m.includes('普货通道')), '拦截信息写明应走普货通道')

const groupMismatch = determineDangerousGoods(
  factsFromRow({ 品名: '手机锂电池', 件数: 1, 额定能量Wh: 140, 申报包装等级: 'III' }),
  rules,
)
assert(groupMismatch.packingMismatch && groupMismatch.packingGroup === 'II', '申报 III、标准 II，就高收为 II 档')

const groupHigher = determineDangerousGoods(
  factsFromRow({ 品名: '手机锂电池', 件数: 1, 额定能量Wh: 140, 申报包装等级: 'I' }),
  rules,
)
assert(groupHigher.packingGroup === 'I', '申报 I 比标准 II 严，就高保持 I 档')

const freeText = determineDangerousGoods(
  factsFromRow({ 品名: '手机锂电池', 件数: 1, 额定能量Wh: 140, 申报包装等级: '' }),
  rules,
)
assert(!freeText.canSubmit && freeText.gateErrors.some((m) => m.includes('I/II/III')), '包装等级非 I/II/III（空/自由文本）时拦截')

const unknown = determineDangerousGoods(
  factsFromRow({ 品名: '未知化工原料XYZ', 件数: 5, 额定能量Wh: 0, 申报包装等级: 'II' }),
  rules,
)
assert(!unknown.matched && !unknown.canSubmit, '品名未在规则库登记，不能提交')

const disabled = determineDangerousGoods(
  factsFromRow({ 品名: '烟花爆竹', 件数: 5, 额定能量Wh: 0, 申报包装等级: 'II' }),
  rules,
)
assert(!disabled.matched, '停用规则（DG-005 烟花）不参与判定')

// ---------- 2. 托运人资质 ----------
console.log('[托运人资质]')
const shippers = allRows()['shipper']
const valid = checkQualification(shippers.find((r) => String(r['托运人']) === '华北锂电科技'), '2026-10-04')
const expired = checkQualification(shippers.find((r) => String(r['托运人']) === '恒通电子贸易'), '2026-10-04')
const expired2 = checkQualification(shippers.find((r) => String(r['托运人']) === '京杭货运代理'), '2026-10-04')
assert(valid.ok && valid.state === '有效', '华北锂电 2027 到期，有效')
assert(!expired.ok && expired.state === '已过期', '恒通 2026-06-30 到期，已过期')
assert(!expired2.ok && expired2.state === '已过期', '京杭 2026-08-31 到期，已过期')

// ---------- 3. 申报单全流程 ----------
console.log('[申报单状态机]')
// 3a. 正常草稿 → 提交
const d1 = createDgdDraft({
  托运批次号: 'TEST-FLOW-001', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '锂金属纽扣电池', 件数: 5, 额定能量Wh: 0, 申报包装等级: 'II', 托运人: '华北锂电科技',
})
assert(d1.ok && d1.id, '合法锂金属电池草稿落单')
// 跳级：草稿直接审核/放行挡回
assert(!approveDgd(d1.id!).ok, '草稿直接审核 → 跳级挡回')
assert(!releaseDgd(d1.id!).ok, '草稿直接放行 → 跳级挡回，指明卡在放行')
const s1 = submitDgd(d1.id!)
assert(s1.ok, '草稿提交审核成功')
assert(!submitDgd(d1.id!).ok, '已提交再提交 → 重复提交不生效')
assert(!releaseDgd(d1.id!).ok, '提交环节直接放行 → 跳级挡回，卡在放行')
const a1 = approveDgd(d1.id!)
assert(a1.ok, '提交 → 审核通过')
assert(!submitDgd(d1.id!).ok, '审核后不能再回到提交')
const r1 = releaseDgd(d1.id!)
assert(r1.ok, '审核 → 放行成功')
assert(!approveDgd(d1.id!).ok && !releaseDgd(d1.id!).ok, '放行后不能再回审核/重复放行')

// 3b. 阈值不达标不能提交
const d2 = createDgdDraft({
  托运批次号: 'TEST-FLOW-002', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '小容量充电宝', 件数: 1, 额定能量Wh: 20, 申报包装等级: 'II', 托运人: '华北锂电科技',
})
assert(d2.ok, '阈值不达标的也能先存草稿')
assert(!submitDgd(d2.id!).ok, '提交时阈值不达标被拦截')

// 3c. 资质过期整单退回
const d3 = createDgdDraft({
  托运批次号: 'TEST-FLOW-003', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '含锂金属电池设备', 件数: 3, 额定能量Wh: 0, 申报包装等级: 'II', 托运人: '恒通电子贸易',
})
const s3 = submitDgd(d3.id!)
assert(!s3.ok && s3.message.includes('整单退回'), '资质过期提交 → 整单退回')
const d3row = allRows()['dgd'].find((r) => Number(r.id) === d3.id)!
assert(String(d3row.status) === '草稿' && d3row.abnormal && String(d3row['退回原因']).includes('过期'), '退回后停留草稿、标异常并记录退回原因')

// 3d. 未登记品名不能提交
const d4 = createDgdDraft({
  托运批次号: 'TEST-FLOW-004', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '某种新奇粉末', 件数: 1, 额定能量Wh: 0, 申报包装等级: 'II', 托运人: '华北锂电科技',
})
assert(!submitDgd(d4.id!).ok, '规则库未登记的品名不能提交')

// 3e. 同一批次重复提交只生效一次
const d5 = createDgdDraft({
  托运批次号: 'TEST-DUP-005', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '移动电源锂电池', 件数: 4, 额定能量Wh: 120, 申报包装等级: 'II', 托运人: '华北锂电科技',
})
submitDgd(d5.id!)
const d5b = createDgdDraft({
  托运批次号: 'TEST-DUP-005', 航班号: 'CA1202', 航班日期: '2026-10-04',
  品名: '移动电源锂电池', 件数: 4, 额定能量Wh: 120, 申报包装等级: 'II', 托运人: '华北锂电科技',
})
assert(d5b.ok, '同批次第二张允许保存为草稿')
assert(!submitDgd(d5b.id!).ok, '同批次第二张提交被幂等挡回，只生效一次')

// 3f. 审核退回
const d6 = createDgdDraft({
  托运批次号: 'TEST-REJ-006', 航班号: 'CZ3101', 航班日期: '2026-10-05',
  品名: '车用汽油', 件数: 30, 额定能量Wh: 0, 申报包装等级: 'I', 托运人: '沪联化工物流',
})
submitDgd(d6.id!)
const rej = rejectDgd(d6.id!, '单证不全')
assert(!rej.ok, '审核退回结果按 ActionResult 返回 ok=false（信息性提示）')
assert(String(allRows()['dgd'].find((r) => Number(r.id) === d6.id)!.status) === '草稿', '退回后回到草稿')
const resubmit = submitDgd(d6.id!)
assert(resubmit.ok, '补正后可重新提交（退回不是终态）')

// ---------- 4. 台账与航班页同源 ----------
console.log('[待办台账 / 数字同源]')
// DGD-0002 种子处于「提交」环节：审核前先看到待审核提示，审核通过后转为待放行，数字始终同源。
const czBefore = loadRestrictedLedger().find((g) => g.航班号 === 'CZ3101' && g.航班日期 === '2026-10-04')!
assert(czBefore.限制件票数 === 0 && czBefore.待审核票数 === 1, 'CZ3101 10-04 审核前：0 票确认限制件、1 票提交待审核')
approveDgd(2)
const ledger = loadRestrictedLedger()
const cz = ledger.find((g) => g.航班号 === 'CZ3101' && g.航班日期 === '2026-10-04')!
assert(cz && cz.限制件票数 === 1 && cz.待放行票数 === 1 && cz.限制件总件数 === 30, 'CZ3101 10-04：审核通过后 1 票待放行、30 件（DGD-0002）')
const flightSide = restrictedCountForFlight('CZ3101', '2026-10-04 10:15')
assert(flightSide.限制件票数 === cz.限制件票数 && flightSide.限制件总件数 === cz.限制件总件数, '航班保障页读到的数字与地服台账完全一致')
const d1group = ledger.find((g) => g.航班号 === 'CA1202' && g.航班日期 === '2026-10-04')
// TEST-FLOW-001 已放行（锂金属 5 件），DGD-0001 普货不计
assert(d1group && d1group.限制件票数 === 1 && d1group.已放行票数 === 1 && d1group.限制件总件数 === 5, 'CA1202 10-04：新增放行票计入，普货票 DGD-0001 不计')
assert(restrictedCountForFlight('CA1202', '2026-10-04 08:30').限制件票数 === 1, '航班页按 航班号+日期 精确对应')

// ---------- 5. 历史迁移 ----------
console.log('[存量迁移回填]')
const migrated = allRows()['dgd'].filter((r) => String(r['来源']) === '历史迁移')
assert(migrated.length === 3, `3 条存量记录全部回填（实际 ${migrated.length}）`)
const m1 = migrated.find((r) => String(r['托运批次号']) === 'LEGACY-20260918-CA1202-07')!
assert(String(m1['判定结果']) === '危险品' && String(m1['UN编号']) === 'UN3481', '历史锂电池 160Wh 重新判定为危险品 UN3481')
assert(String(m1['应收包装等级']) === 'II', '历史申报 III 与标准 II 不符，回填为 II 档')
assert(String(m1.status) === '放行' && m1.pending === false, '历史已承运单据回填为放行、不占待办')
const m3 = migrated.find((r) => String(r['托运批次号']) === 'LEGACY-20260930-HU7805-03')!
assert(String(m3['判定结果']) === '普货', '历史普货服装如实判普货（复盘留痕）')
// 迁移幂等：清缓存重读不再新增（同一 storage 已打 flag，这里直接验证 flag 与数量）
assert(window.localStorage.getItem('airport-ground-ops:dgd-migrated-v1') === 'done', '迁移一次性标记位已写入')
assert(allRows()['dgd'].filter((r) => String(r['来源']) === '历史迁移').length === 3, '再次读取不重复迁移')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
