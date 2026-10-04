<template>
  <section class="page" data-module="dgd">
    <header class="page-head">
      <div>
        <h2>危险品申报管理</h2>
        <p class="page-desc">
          品名、包装等级、托运人资质登记后按规则库固定阈值判定，判定结果决定能否提交审核；
          草稿 → 提交 → 审核 → 放行依次流转，审核结论驱动航班限制件待办台账。
        </p>
      </div>
      <div class="page-actions">
        <button v-if="tab === 'declarations'" class="btn primary" type="button" @click="openCreate">登记危险品申报单</button>
        <button class="btn" type="button" @click="exportRows">导出申报清单</button>
      </div>
    </header>

    <div class="tab-bar">
      <button class="tab" :class="{ active: tab === 'declarations' }" type="button" @click="switchTab('declarations')">
        申报单台账
      </button>
      <button class="tab" :class="{ active: tab === 'ledger' }" type="button" @click="switchTab('ledger')">
        航班限制件待办（地服）
      </button>
    </div>

    <template v-if="tab === 'declarations'">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">申报单总量</span>
          <strong class="stat-value">{{ rows.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待审核（提交环节）</span>
          <strong class="stat-value">{{ countByStatus('提交') }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已放行限制件（票）</span>
          <strong class="stat-value">{{ releasedRestricted }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">退回/异常草稿</span>
          <strong class="stat-value">{{ rows.filter((r) => r.abnormal).length }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>航班号</span>
          <input v-model="filters['航班号']" placeholder="按航班号检索" />
        </label>
        <label class="filter-item">
          <span>品名</span>
          <input v-model="filters['品名']" placeholder="按品名检索" />
        </label>
        <label class="filter-item">
          <span>托运批次号</span>
          <input v-model="filters['托运批次号']" placeholder="按托运批次号检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>
              <span class="status-tag" :class="statusClass(String(row.status))">{{ row.status }}</span>
              <div v-if="String(row['退回原因']) && String(row.status) === '草稿'" class="cell-note">
                {{ row['退回原因'] }}
              </div>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="doAction('submit', row)">提交审核</button>
              <button class="link" type="button" @click="doAction('approve', row)">审核通过</button>
              <button class="link danger" type="button" @click="doAction('reject', row)">审核退回</button>
              <button class="link" type="button" @click="doAction('release', row)">放行</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无申报单，可先登记危险品申报单</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ rows.length }} 张危险品申报单；流程只能草稿 → 提交 → 审核 → 放行，跳级与回退都会被挡回</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <p class="page-desc" style="margin: 8px 0 12px">
        本台账由危险品申报单的审核结论实时聚合，不另存数字；航班保障页看到的限制件数与本页同源。
        仅判定为危险品且已经过审核（审核/放行）的票计入限制件，提交待审核的票单独提示。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>航班号</th>
            <th>航班日期</th>
            <th>提交待审核（票）</th>
            <th>审核待放行（票）</th>
            <th>已放行（票）</th>
            <th>限制件票数</th>
            <th>限制件总件数</th>
            <th>限制件明细（申报单号 / 品名 / 应收包装等级 / 状态）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in ledger" :key="`${group.航班号}-${group.航班日期}`">
            <td>{{ group.航班号 }}</td>
            <td>{{ group.航班日期 }}</td>
            <td>{{ group.待审核票数 }}</td>
            <td>{{ group.待放行票数 }}</td>
            <td>{{ group.已放行票数 }}</td>
            <td><strong>{{ group.限制件票数 }}</strong></td>
            <td><strong>{{ group.限制件总件数 }}</strong></td>
            <td>
              <div v-for="item in group.items" :key="String(item.id)" class="cell-note">
                {{ item['申报单号'] }} · {{ item['品名'] }} · {{ item['应收包装等级'] }} 档 · {{ item.status }}
              </div>
              <span v-if="!group.items.length" class="cell-note">暂无审核结论确认的限制件</span>
            </td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="8" class="empty-state">暂无危险品待办</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>数字与「航班保障」页限制件列同一份：{{ ledgerStamp }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记危险品申报单</h3>
        <p class="page-desc">保存即为「草稿」；也可直接判定并提交审核，判定不通过会当场拦截。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>托运批次号 *</span>
            <input v-model="form.托运批次号" placeholder="如 BAT-20261004-CA1202-09" />
          </label>
          <label class="form-item">
            <span>航班号 *</span>
            <input v-model="form.航班号" placeholder="如 CA1202" />
          </label>
          <label class="form-item">
            <span>航班日期 *</span>
            <input v-model="form.航班日期" type="date" />
          </label>
          <label class="form-item">
            <span>品名 *</span>
            <input v-model="form.品名" placeholder="必须命中判定规则库品名" />
          </label>
          <label class="form-item">
            <span>件数</span>
            <input v-model.number="form.件数" type="number" min="0" />
          </label>
          <label class="form-item">
            <span>额定能量(Wh)</span>
            <input v-model.number="form.额定能量Wh" type="number" min="0" />
          </label>
          <label class="form-item">
            <span>包装等级 *（固定三档，非自由文本）</span>
            <select v-model="form.申报包装等级">
              <option value="" disabled>请选择 I / II / III</option>
              <option value="I">I（最严）</option>
              <option value="II">II</option>
              <option value="III">III（最宽）</option>
            </select>
          </label>
          <label class="form-item">
            <span>托运人 *（按资质台账核对有效期）</span>
            <select v-model="form.托运人">
              <option value="" disabled>请选择托运人</option>
              <option v-for="shipper in shippers" :key="String(shipper.id)" :value="String(shipper['托运人'])">
                {{ shipper['托运人'] }}（{{ shipper['资质证书编号'] }}，有效期至 {{ shipper['资质有效期'] }}）
              </option>
            </select>
          </label>
        </div>

        <div class="preview-box" :class="preview?.canSubmit ? 'ok' : 'warn'">
          <template v-if="!hasFacts">
            <span class="preview-title">填写品名、件数/能量、包装等级后实时显示规则库判定结果</span>
          </template>
          <template v-else-if="preview">
            <div class="preview-title">
              规则判定：
              <template v-if="!preview.matched">未命中任何规则品名，不能提交</template>
              <template v-else-if="preview.dangerous && preview.thresholdPassed">
                危险品 · {{ preview.channel }}通道 · {{ preview.UN编号 }} · 应收包装等级 {{ preview.packingGroup }}
              </template>
              <template v-else>阈值未达危险品标准，应走普货通道</template>
              <span v-if="qualificationHint" :class="qualificationOk ? 'ok-text' : 'error-text'">
                ｜{{ qualificationHint }}
              </span>
            </div>
            <ul class="preview-list">
              <li v-for="(line, i) in preview.notes" :key="i">{{ line }}</li>
            </ul>
            <ul v-if="preview.gateErrors.length" class="preview-list error-text">
              <li v-for="(line, i) in preview.gateErrors" :key="`e-${i}`">拦截：{{ line }}</li>
            </ul>
          </template>
        </div>

        <footer class="modal-foot">
          <span v-if="formError" class="error-text">{{ formError }}</span>
          <div>
            <button class="btn" type="button" @click="saveDraft">保存草稿</button>
            <button class="btn primary" type="button" @click="saveAndSubmit">判定并提交审核</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  approveDgd,
  createDgdDraft,
  downloadEntries,
  listEntries,
  listAllRows,
  loadRestrictedLedger,
  moduleMeta,
  previewDetermination,
  rejectDgd,
  releaseDgd,
  submitDgd,
} from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'
import { checkQualification } from '@/data/dangerous-goods'
import type { PackingGroup } from '@/data/dangerous-goods'

const meta = moduleMeta('dgd')
const columns = [
  '申报单号', '托运批次号', '航班号', '航班日期', '品名', '件数', '额定能量Wh',
  '申报包装等级', '应收包装等级', '判定结果', 'UN编号', '托运人', '资质有效期', '来源',
]
const statuses = ['草稿', '提交', '审核', '放行']

type TabKey = 'declarations' | 'ledger'
const tab = ref<TabKey>('declarations')
const rows = ref<EntryRow[]>([])
const ledger = ref<ReturnType<typeof loadRestrictedLedger>>([])
const ledgerStamp = ref('')
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const creating = ref(false)
const formError = ref('')
const shippers = ref<EntryRow[]>([])

const emptyForm = () => ({
  托运批次号: '',
  航班号: '',
  航班日期: '2026-10-04',
  品名: '',
  件数: 0,
  额定能量Wh: 0,
  申报包装等级: '',
  托运人: '',
})
const form = reactive(emptyForm())

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const releasedRestricted = computed(
  () => rows.value.filter((row) => String(row.status) === '放行' && String(row['判定结果']) === '危险品').length,
)

const hasFacts = computed(() => form.品名.trim() !== '' || form.件数 !== 0 || form.额定能量Wh !== 0)
const preview = computed(() =>
  previewDetermination({
    品名: form.品名,
    件数: form.件数 === 0 ? null : Number(form.件数),
    额定能量Wh: form.额定能量Wh === 0 ? null : Number(form.额定能量Wh),
    申报包装等级: form.申报包装等级 as PackingGroup | '',
  }),
)
const qualification = computed(() =>
  form.托运人
    ? checkQualification(shippers.value.find((item) => String(item['托运人']) === form.托运人))
    : null,
)
const qualificationOk = computed(() => qualification.value?.ok ?? false)
const qualificationHint = computed(() => (qualification.value ? qualification.value.message : ''))

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function statusClass(status: string): string {
  if (status === '放行') return 'st-done'
  if (status === '审核') return 'st-review'
  if (status === '提交') return 'st-submit'
  return 'st-draft'
}

function switchTab(next: TabKey) {
  tab.value = next
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  formError.value = ''
  Object.assign(form, emptyForm())
  shippers.value = listAllRows('shipper').filter((item) => String(item.status) !== '已注销')
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function afterWrite(result: ActionResult): boolean {
  formError.value = result.ok ? '' : result.message
  if (!result.ok) {
    return false
  }
  creating.value = false
  errorMessage.value = result.message
  reload()
  return true
}

function saveDraft() {
  afterWrite(createDgdDraft({ ...form }))
}

function saveAndSubmit() {
  const created = createDgdDraft({ ...form })
  if (!created.id) {
    formError.value = created.message
    return
  }
  const submitted = submitDgd(created.id)
  if (!submitted.ok) {
    // 草稿已落单：关窗刷新列表，拦截原因显示在台账页脚，退回类的也能在草稿里看到。
    creating.value = false
    errorMessage.value = submitted.message
    reload()
    return
  }
  afterWrite(submitted)
}

function doAction(kind: 'submit' | 'approve' | 'reject' | 'release', row: EntryRow) {
  errorMessage.value = ''
  let result: ActionResult
  if (kind === 'submit') {
    result = submitDgd(Number(row.id))
  } else if (kind === 'approve') {
    result = approveDgd(Number(row.id))
  } else if (kind === 'release') {
    result = releaseDgd(Number(row.id))
  } else {
    const reason = window.prompt(`审核退回原因（申报单 ${row['申报单号']}）`, '包装等级与品类不符，请补正后重新提交')
    if (reason === null) {
      return
    }
    result = rejectDgd(Number(row.id), reason)
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  ledger.value = loadRestrictedLedger()
  ledgerStamp.value = `${ledger.value.reduce((sum, item) => sum + item.限制件票数, 0)} 票 / ${ledger.value.reduce((sum, item) => sum + item.限制件总件数, 0)} 件`
}

onMounted(reload)
</script>
