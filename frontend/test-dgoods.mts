import {
  createDeclaration,
  judgeDeclaration,
  migrateDgoodsHistory,
  qualificationExpired,
  restrictedLedger,
  runDgoodsAction,
} from '@/api/dgoods-service'
import { listRows } from '@/data/local-store'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

// 1. 存量迁移回填
const mig = migrateDgoodsHistory()
check('迁移回填4条存量单', mig.migrated === 4, mig)
const again = migrateDgoodsHistory()
check('迁移幂等，第二次0条', again.migrated === 0, again)
const dg1 = listRows('dgoods').find((r) => r['申报单号'] === 'DG-0001')!
const hist1 = JSON.parse(String(dg1['历史记录']))
check('DG-0001回填5段历史且按航班日期', hist1.length === 5 && hist1.every((h: {时间: string}) => h.时间 === '2026-09-01'), hist1)

// 2. 判定规则
const j1 = judgeDeclaration('锂电池', 'III')
check('锂电池命中且等级不符按II档收', j1.hit && j1.可提交 && j1.收运包装等级 === 'II' && j1.判定结果.includes('不符'), j1)
const j2 = judgeDeclaration('普通服装', 'I')
check('普货不能提交审核', !j2.hit && !j2.可提交, j2)
const j3 = judgeDeclaration('工业油漆', 'II')
check('油漆命中等级一致', j3.hit && j3.可提交 && j3.收运包装等级 === 'II', j3)

// 3. 同一次托运重复提交只生效一次
const dup = createDeclaration({ 航班号: 'CA1501', 航班日期: '2026-09-01', 品名: '锂离子电池（充电宝）', 包装等级: 'II', 托运人: '华腾物流', 资质有效期: '2027-06-30' })
check('重复登记被挡回', !dup.ok && dup.message.includes('只生效一次'), dup)

// 4. 资质过期整单退回
const ret = runDgoodsAction(3, '提交审核')
check('资质过期整单退回', !ret.ok && ret.message.includes('整单退回'), ret)
const dg3 = listRows('dgoods').find((r) => r['申报单号'] === 'DG-0003')!
check('退回单标异常且停留草稿', dg3.abnormal === true && dg3.status === '草稿', dg3)

// 5. 顺序流转：跳级挡回、终态不可回退
const skip = runDgoodsAction(4, '确认放行')
check('已提交直接放行被挡回并说明环节', !skip.ok && skip.message.includes('登记审核') && skip.message.includes('草稿→提交→审核→放行'), skip)
const term = runDgoodsAction(1, '登记审核')
check('已放行不能再回审核', !term.ok && term.message.includes('已放行'), term)
const ok1 = runDgoodsAction(4, '登记审核')
check('已提交可登记审核', ok1.ok, ok1)
const dg4a = listRows('dgoods').find((r) => r['申报单号'] === 'DG-0004')!
check('审核结论写入', String(dg4a['审核结论']).startsWith('同意收运'), dg4a['审核结论'])
const ok2 = runDgoodsAction(4, '确认放行')
check('已审核可放行', ok2.ok, ok2)

// 6. 台账：两边同源
const ledger = restrictedLedger()
const ca1501 = ledger.find((e) => e.航班号 === 'CA1501')
const ca1502 = ledger.find((e) => e.航班号 === 'CA1502')
const ca1503 = ledger.find((e) => e.航班号 === 'CA1503')
check('CA1501限制件1票', ca1501?.限制件票数 === 1, ledger)
check('CA1502限制件1票', ca1502?.限制件票数 === 1, ledger)
check('CA1503审核放行后1票', ca1503?.限制件票数 === 1, ledger)

// 7. 新建→提交→普货判定拦截
const bad = createDeclaration({ 航班号: 'CA1509', 航班日期: '2026-10-05', 品名: '普通服装', 包装等级: 'I', 托运人: '测试物流', 资质有效期: '2027-01-01' })
check('普货草稿可登记', bad.ok, bad)
const badSubmit = runDgoodsAction(bad.id!, '提交审核')
check('普货判定不能提交审核', !badSubmit.ok && badSubmit.message.includes('判定结果不允许提交'), badSubmit)

const good = createDeclaration({ 航班号: 'CA1510', 航班日期: '2026-10-06', 品名: '锂电池', 包装等级: 'III', 托运人: '测试物流', 资质有效期: '2027-01-01' })
check('危险品草稿可登记', good.ok, good)
const goodSubmit = runDgoodsAction(good.id!, '提交审核')
check('判定通过可提交审核', goodSubmit.ok, goodSubmit)
const dup2 = createDeclaration({ 航班号: 'CA1510', 航班日期: '2026-10-06', 品名: '锂电池', 包装等级: 'II', 托运人: '测试物流', 资质有效期: '2027-01-01' })
check('同一次托运二次登记被挡', !dup2.ok, dup2)

// 8. 资质有效期判断
check('资质过期判断', qualificationExpired('2026-05-20', '2026-09-01') && !qualificationExpired('2027-06-30', '2026-09-01'))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
