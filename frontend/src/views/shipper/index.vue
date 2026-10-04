<template>
  <section class="page" data-module="shipper">
    <header class="page-head">
      <div>
        <h2>托运人资质台账</h2>
        <p class="page-desc">
          登记危险品托运人及资质证书有效期。申报提交时按当天日期自动核对：资质过期或已注销的托运人整单退回。
          当前判定日期：{{ today }}
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记托运人</button>
        <button class="btn" type="button" @click="exportRows">导出资质台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册托运人</span>
        <strong class="stat-value">{{ activeShippers.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">资质过期</span>
        <strong class="stat-value">{{ expiredShippers.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已注销</span>
        <strong class="stat-value">{{ rows.filter((r) => String(r.status) === '已注销').length }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>托运人</span>
        <input v-model="filters['托运人']" placeholder="按托运人检索" />
      </label>
      <label class="filter-item">
        <span>资质证书编号</span>
        <input v-model="filters['资质证书编号']" placeholder="按证书编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>资质状态（按当天）</th>
          <th>档案状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': !qualificationOf(row).ok }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="status-tag" :class="qualificationOf(row).ok ? 'st-done' : 'st-danger'">
              {{ qualificationOf(row).state }}
            </span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link danger" type="button" @click="runAction('注销资质', row)">注销资质</button>
            <button class="link" type="button" @click="runAction('恢复在册', row)">恢复在册</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无托运人档案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 个托运人；过期/注销的托运人提交申报时整单退回草稿</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记托运人资质</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>托运人编号 *</span>
            <input v-model="form.托运人编号" placeholder="如 SP-005" />
          </label>
          <label class="form-item">
            <span>托运人名称 *</span>
            <input v-model="form.托运人" placeholder="与申报单填写名称完全一致" />
          </label>
          <label class="form-item">
            <span>资质证书编号 *</span>
            <input v-model="form.资质证书编号" placeholder="如 DG-2026-0999" />
          </label>
          <label class="form-item">
            <span>资质有效期至 *</span>
            <input v-model="form.资质有效期" type="date" />
          </label>
          <label class="form-item">
            <span>联系人</span>
            <input v-model="form.联系人" />
          </label>
          <label class="form-item">
            <span>联系电话</span>
            <input v-model="form.联系电话" />
          </label>
        </div>
        <footer class="modal-foot">
          <span v-if="formError" class="error-text">{{ formError }}</span>
          <div>
            <button class="btn primary" type="button" @click="save">保存档案</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { createEntry, downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { checkQualification, todayLocal } from '@/data/dangerous-goods'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('shipper')
const columns = ['托运人编号', '托运人', '资质证书编号', '资质有效期', '联系人', '联系电话']
const today = todayLocal()

const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const creating = ref(false)
const formError = ref('')

const activeShippers = computed(
  () => rows.value.filter((row) => String(row.status) === '在册' && checkQualification(row, today).ok),
)
const expiredShippers = computed(
  () => rows.value.filter((row) => String(row.status) === '在册' && checkQualification(row, today).state === '已过期'),
)

function qualificationOf(row: EntryRow) {
  return checkQualification(row, today)
}

const emptyForm = () => ({
  托运人编号: '',
  托运人: '',
  资质证书编号: '',
  资质有效期: today,
  联系人: '',
  联系电话: '',
})
const form = reactive(emptyForm())

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
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function save() {
  if (!form.托运人编号.trim() || !form.托运人.trim() || !form.资质证书编号.trim() || !form.资质有效期) {
    formError.value = '托运人编号、名称、资质证书编号与有效期为必填'
    return
  }
  const values: Record<string, string | number> = {
    托运人编号: form.托运人编号.trim(),
    托运人: form.托运人.trim(),
    资质证书编号: form.资质证书编号.trim(),
    资质有效期: form.资质有效期,
    联系人: form.联系人.trim(),
    联系电话: form.联系电话.trim(),
  }
  const result = createEntry(meta.key, values)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  rows.value = listEntries(meta.key, filters.value).items
}

onMounted(reload)
</script>
