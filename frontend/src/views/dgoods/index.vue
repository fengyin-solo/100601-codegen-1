<template>
  <section class="page" data-module="dgoods">
    <header class="page-head">
      <div>
        <h2>危险品申报管理</h2>
        <p class="page-desc">维护危险品申报单，围绕申报单号、航班号、品名、包装等级做登记、判定、审核与放行，判定规则固定可查。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? '收起登记表单' : '登记危险品申报单' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出申报清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待审核申报</span>
        <strong class="stat-value">{{ submittedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已放行申报</span>
        <strong class="stat-value">{{ releasedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">涉限航班数</span>
        <strong class="stat-value">{{ ledger.length }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="migrateMessage" class="migrate-note">{{ migrateMessage }}</p>

    <section class="panel">
      <h3 class="panel-title">危险品判定规则（固定规则，判定结果直接决定能否提交审核）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>规则编号</th>
            <th>品名关键词</th>
            <th>危险品类目</th>
            <th>标准包装等级</th>
            <th>阈值</th>
            <th>必须危险品通道</th>
            <th>等级不符处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.规则编号">
            <td>{{ rule.规则编号 }}</td>
            <td>{{ rule.品名关键词.join('、') }}</td>
            <td>{{ rule.危险品类目 }}</td>
            <td>{{ rule.标准包装等级 }}</td>
            <td>{{ rule.阈值 }}</td>
            <td>{{ rule.必须危险品通道 ? '是' : '否' }}</td>
            <td>{{ rule.等级不符处理 }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="showCreate" class="panel">
      <h3 class="panel-title">登记危险品申报单</h3>
      <form class="filter-bar" @submit.prevent="submitCreate">
        <label class="filter-item">
          <span>航班号</span>
          <input v-model="form.航班号" placeholder="如 CA1501" />
        </label>
        <label class="filter-item">
          <span>航班日期</span>
          <input v-model="form.航班日期" type="date" />
        </label>
        <label class="filter-item">
          <span>品名</span>
          <input v-model="form.品名" placeholder="托运人申报的品名" />
        </label>
        <label class="filter-item">
          <span>包装等级</span>
          <select v-model="form.包装等级">
            <option v-for="group in packingGroups" :key="group" :value="group">{{ group }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>托运人</span>
          <input v-model="form.托运人" placeholder="托运人名称" />
        </label>
        <label class="filter-item">
          <span>资质有效期</span>
          <input v-model="form.资质有效期" type="date" />
        </label>
        <button class="btn primary" type="submit">保存草稿</button>
      </form>
      <p class="judge-preview" :class="{ bad: !judgePreview.可提交 }">
        判定预览：{{ judgePreview.判定结果 }}
        <template v-if="qualificationWarning">｜⚠ {{ qualificationWarning }}</template>
      </p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>审核结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr :class="{ 'row-abnormal': row.abnormal }">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row['审核结论'] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="toggleHistory(row)">历史</button>
            </td>
          </tr>
          <tr v-if="expanded.has(Number(row.id))" class="history-row">
            <td :colspan="columns.length + 3">
              <ol class="history-list">
                <li v-for="(entry, index) in historyOf(row)" :key="index">
                  {{ entry.时间 }}　{{ entry.事件 }}
                </li>
              </ol>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无危险品申报数据，可先登记危险品申报单</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3 class="panel-title">航班限制件待办台账（与航班保障页同源，地服可直接核对）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>航班号</th>
            <th>航班日期</th>
            <th>限制件票数</th>
            <th>申报单号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="`${entry.航班号}-${entry.航班日期}`">
            <td>{{ entry.航班号 }}</td>
            <td>{{ entry.航班日期 }}</td>
            <td>{{ entry.限制件票数 }}</td>
            <td>{{ entry.申报单号.join('、') }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="4" class="empty-state">暂无审核通过的限制件</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条危险品申报记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createDeclaration,
  declarationHistory,
  judgeDeclaration,
  migrateDgoodsHistory,
  qualificationExpired,
  restrictedLedger,
  runDgoodsAction,
  type LedgerEntry,
} from '@/api/dgoods-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { DG_RULES, PACKING_GROUPS } from '@/data/dgoods-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dgoods')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
const rules = DG_RULES
const packingGroups = PACKING_GROUPS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const migrateMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const expanded = ref<Set<number>>(new Set())
const ledger = ref<LedgerEntry[]>([])

const form = reactive({
  航班号: '',
  航班日期: '',
  品名: '',
  包装等级: 'II',
  托运人: '',
  资质有效期: '',
})

const judgePreview = computed(() => judgeDeclaration(form.品名, form.包装等级))
const qualificationWarning = computed(() =>
  qualificationExpired(form.资质有效期, form.航班日期)
    ? `托运人资质将于航班日期前过期（${form.资质有效期}），提交审核会被整单退回`
    : '',
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const submittedCount = computed(
  () => rows.value.filter((row) => String(row.status) === '已提交').length,
)
const releasedCount = computed(
  () => rows.value.filter((row) => String(row.status) === '已放行').length,
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitCreate() {
  errorMessage.value = ''
  okMessage.value = ''
  const result = createDeclaration({ ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  showCreate.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  okMessage.value = ''
  const result = runDgoodsAction(Number(row.id), action)
  // 失败也可能改了数据（如资质过期整单退回会标异常），所以先刷新再提示
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
}

function toggleHistory(row: EntryRow) {
  const id = Number(row.id)
  const next = new Set(expanded.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expanded.value = next
}

function historyOf(row: EntryRow) {
  return declarationHistory(row)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledger.value = restrictedLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '危险品申报列表读取失败'
  }
}

onMounted(() => {
  const { migrated } = migrateDgoodsHistory()
  if (migrated > 0) {
    migrateMessage.value = `已按航班日期迁移回填 ${migrated} 条存量申报单的历史记录`
  }
  reload()
})
</script>
