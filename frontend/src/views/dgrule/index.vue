<template>
  <section class="page" data-module="dgrule">
    <header class="page-head">
      <div>
        <h2>危险品判定规则库</h2>
        <p class="page-desc">
          固定「哪些品名算危险品、对应哪一档包装等级」：品名别名、UN 编号、阈值、标准包装等级，
          以及申报等级与品类对不上时按哪一档收。申报单判定只认启用中的规则。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记判定规则</button>
        <button class="btn" type="button" @click="exportRows">导出规则库</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">规则总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">启用中规则</span>
        <strong class="stat-value">{{ rows.filter((r) => String(r.status) === '启用').length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">停用规则</span>
        <strong class="stat-value">{{ rows.filter((r) => String(r.status) === '停用').length }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>标准品名</span>
        <input v-model="filters['标准品名']" placeholder="按标准品名检索" />
      </label>
      <label class="filter-item">
        <span>UN编号</span>
        <input v-model="filters['UN编号']" placeholder="按 UN 编号检索" />
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': String(row.status) === '停用' }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="status-tag" :class="String(row.status) === '启用' ? 'st-done' : 'st-draft'">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('停用规则', row)">停用规则</button>
            <button class="link" type="button" @click="runAction('启用规则', row)">启用规则</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无判定规则</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条规则；停用后该品名不再参与申报判定</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记危险品判定规则</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>规则编号 *</span>
            <input v-model="form.规则编号" placeholder="如 DG-006" />
          </label>
          <label class="form-item">
            <span>标准品名 *</span>
            <input v-model="form.标准品名" placeholder="如 锂离子电池" />
          </label>
          <label class="form-item wide">
            <span>品名别名（分隔符可写 ；, 、/）</span>
            <input v-model="form.品名别名" placeholder="如 锂电池；充电宝；移动电源" />
          </label>
          <label class="form-item">
            <span>UN编号 *</span>
            <input v-model="form.UN编号" placeholder="如 UN3481" />
          </label>
          <label class="form-item">
            <span>危险性类别</span>
            <input v-model="form.危险性类别" placeholder="如 9" />
          </label>
          <label class="form-item">
            <span>阈值字段（留空=无阈值，品名命中即危险品）</span>
            <select v-model="form.阈值字段">
              <option value="">无阈值</option>
              <option value="件数">件数</option>
              <option value="额定能量Wh">额定能量Wh</option>
            </select>
          </label>
          <label class="form-item">
            <span>比较符</span>
            <select v-model="form.比较符">
              <option value=">=">&gt;=（达到即危险品）</option>
              <option value=">">&gt;</option>
            </select>
          </label>
          <label class="form-item">
            <span>阈值</span>
            <input v-model.number="form.阈值" type="number" min="0" placeholder="如 100" />
          </label>
          <label class="form-item">
            <span>是否必须走危险品通道</span>
            <select v-model="form.必须危险品">
              <option value="是">是（品名命中即危险品品类）</option>
              <option value="否">否（按阈值可判普货）</option>
            </select>
          </label>
          <label class="form-item">
            <span>标准包装等级 *</span>
            <select v-model="form.标准包装等级">
              <option value="I">I</option>
              <option value="II">II</option>
              <option value="III">III</option>
            </select>
          </label>
          <label class="form-item">
            <span>等级与品类对不上时</span>
            <select v-model="form.等级不符处理">
              <option value="就高">就高（从严收档）</option>
              <option value="就低">就低（从宽收档）</option>
              <option value="按规则">按规则（强制回标准档）</option>
            </select>
          </label>
        </div>
        <footer class="modal-foot">
          <span v-if="formError" class="error-text">{{ formError }}</span>
          <div>
            <button class="btn primary" type="button" @click="save">保存规则</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { createEntry, downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dgrule')
const columns = [
  '规则编号', '标准品名', '品名别名', 'UN编号', '危险性类别', '阈值字段', '比较符', '阈值',
  '必须危险品', '标准包装等级', '等级不符处理',
]

const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const creating = ref(false)
const formError = ref('')

const emptyForm = () => ({
  规则编号: '',
  标准品名: '',
  品名别名: '',
  UN编号: '',
  危险性类别: '',
  阈值字段: '',
  比较符: '>=',
  阈值: 0,
  必须危险品: '是',
  标准包装等级: 'II',
  等级不符处理: '就高',
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
  if (!form.规则编号.trim() || !form.标准品名.trim() || !form.UN编号.trim()) {
    formError.value = '规则编号、标准品名、UN 编号为必填'
    return
  }
  if (rows.value.some((row) => String(row['规则编号']) === form.规则编号.trim())) {
    formError.value = `规则编号 ${form.规则编号} 已存在`
    return
  }
  const values: Record<string, string | number> = {
    规则编号: form.规则编号.trim(),
    标准品名: form.标准品名.trim(),
    品名别名: form.品名别名.trim(),
    UN编号: form.UN编号.trim(),
    危险性类别: form.危险性类别.trim(),
    阈值字段: form.阈值字段,
    比较符: form.比较符,
    阈值: form.阈值字段 ? Number(form.阈值) || 0 : '',
    必须危险品: form.必须危险品,
    标准包装等级: form.标准包装等级,
    等级不符处理: form.等级不符处理,
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
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
}

onMounted(reload)
</script>
