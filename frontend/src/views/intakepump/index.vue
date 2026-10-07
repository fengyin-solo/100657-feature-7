<template>
  <section class="page" data-module="intakepump">
    <header class="page-head">
      <div>
        <h2>取水泵组管理</h2>
        <p class="page-desc">按泵组编号与所属水厂挑出待启泵组，按额定流量排序排布；翻页沿用同一份筛选与排序，页与页不重不漏。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记取水泵组</button>
        <button class="btn" type="button" @click="exportRows">导出取水泵组清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="applySearch">
      <label class="filter-item">
        <span>泵组编号</span>
        <input v-model="draftFilter.pumpCode" placeholder="按泵组编号检索" />
      </label>
      <label class="filter-item">
        <span>所属水厂</span>
        <input v-model="draftFilter.plant" placeholder="按所属水厂检索" list="plant-options" />
        <datalist id="plant-options">
          <option v-for="plant in plantOptions" :key="plant" :value="plant" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>泵组状态</span>
        <select v-model="draftFilter.status">
          <option value="">全部状态</option>
          <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <button
        type="button"
        class="chip-toggle"
        :class="{ active: query.onlyPending }"
        @click="togglePending"
      >
        只看待启泵
      </button>
      <button type="button" class="chip-toggle" @click="toggleSort">
        额定流量{{ query.sortAsc ? '升序 ↑' : '降序 ↓' }}
      </button>
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
        <tr v-for="row in page.items" :key="String(row.id)" class="clickable" @click="openDetail(row)">
          <td>{{ row['泵组编号'] }}</td>
          <td>{{ row['所属水厂'] }}</td>
          <td>{{ row['泵组型号'] }}</td>
          <td>{{ formatNumber(row['额定流量']) }}</td>
          <td>{{ row['运行电流'] === '' || row['运行电流'] === undefined ? '—' : formatNumber(row['运行电流']) }}</td>
          <td>{{ row['运行班组'] || '—' }}</td>
          <td>{{ row['启泵班次'] || '—' }}</td>
          <td>
            {{ row['启停时间'] || '—' }}
            <span v-if="crossShift(row)" class="badge warn">跨班</span>
            <span v-else-if="legacy(row)" class="badge info">老记录</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions" @click.stop>
            <button v-if="String(row.status) === '待启泵'" class="link" type="button" @click="openStart(row)">
              提交启泵
            </button>
            <button v-if="String(row.status) === '运行中'" class="link" type="button" @click="stopPump(row)">
              登记停泵
            </button>
            <button
              v-if="String(row.status) !== '故障停泵'"
              class="link"
              type="button"
              @click="reportFault(row)"
            >
              上报故障
            </button>
            <span v-else class="field-hint">已落维护待办</span>
          </td>
        </tr>
        <tr v-if="!page.items.length">
          <td :colspan="columns.length + 2" class="empty-state">{{ emptyHint }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>第 {{ page.from }}～{{ page.to }} 条，共 {{ page.total }} 条（本页 {{ page.items.length }} 条，条数已对上）</span>
      <div class="pager">
        <button class="btn" type="button" :disabled="page.page <= 1" @click="goPage(page.page - 1)">上一页</button>
        <span>第 {{ page.page }} / {{ page.totalPages }} 页</span>
        <button class="btn" type="button" :disabled="page.page >= page.totalPages" @click="goPage(page.page + 1)">下一页</button>
      </div>
    </footer>
    <p v-if="feedback" class="page-foot" style="margin-top: 4px">
      <span :class="feedbackOk ? 'success-text' : 'error-text'">{{ feedback }}</span>
    </p>

    <!-- 登记弹窗：同一台泵只登记一次 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal wide">
        <h3>登记取水泵组</h3>
        <div class="form-grid">
          <label>
            <span>泵组编号 *</span>
            <input v-model="createForm.pumpCode" placeholder="如 INTA-0109" />
          </label>
          <label>
            <span>所属水厂 *</span>
            <input v-model="createForm.plant" placeholder="如 第一水厂" list="plant-options" />
          </label>
          <label>
            <span>泵组型号 *</span>
            <input v-model="createForm.model" placeholder="如 KQSN400-M9" />
          </label>
          <label>
            <span>额定流量（m³/h，大于 0）*</span>
            <input v-model="createForm.ratedFlow" type="number" min="0" step="1" placeholder="如 400" />
          </label>
          <label>
            <span>运行电流（A，{{ CURRENT_MIN_EXCLUSIVE }}～{{ CURRENT_MAX }}，可留空）</span>
            <input v-model="createForm.runningCurrent" type="number" :min="CURRENT_MIN_EXCLUSIVE" :max="CURRENT_MAX" step="0.1" />
          </label>
          <label>
            <span>运行班组</span>
            <input v-model="createForm.crew" placeholder="如 甲班" />
          </label>
        </div>
        <p v-if="createError" class="error-text field-hint" style="margin-top: 8px">{{ createError }}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">登记</button>
        </div>
      </div>
    </div>

    <!-- 启泵弹窗：运行电流不合法就挡回 -->
    <div v-if="startTarget" class="modal-mask" @click.self="startTarget = null">
      <div class="modal">
        <h3>启泵：{{ startTarget['泵组编号'] }}</h3>
        <p class="field-hint">{{ startTarget['所属水厂'] }} · {{ startTarget['泵组型号'] }} · 额定流量 {{ formatNumber(startTarget['额定流量']) }} m³/h</p>
        <label>
          <span class="field-hint">运行电流（A，可填区间 {{ CURRENT_MIN_EXCLUSIVE }} &lt; I ≤ {{ CURRENT_MAX }}）*</span>
          <input
            v-model="startCurrent"
            type="number"
            :min="CURRENT_MIN_EXCLUSIVE"
            :max="CURRENT_MAX"
            step="0.1"
            placeholder="如 260"
            style="width: 100%; margin-top: 4px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px"
          />
        </label>
        <p v-if="startError" class="error-text field-hint" style="margin-top: 8px">{{ startError }}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="startTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitStart">确认启泵</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  CURRENT_MAX,
  CURRENT_MIN_EXCLUSIVE,
  DEFAULT_PAGE_SIZE,
  defaultQuery,
  intakePumpStats,
  queryIntakePumps,
  registerIntakePump,
  reportIntakePumpFault,
  startIntakePump,
  stopIntakePump,
} from '@/api/intakepump-service'
import { downloadEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()

const columns = ['泵组编号', '所属水厂', '泵组型号', '额定流量', '运行电流', '运行班组', '启泵班次', '启停时间']
const statuses = ['待启泵', '运行中', '已停泵', '故障停泵']

const stats = ref(intakePumpStats())
const feedback = ref('')
const feedbackOk = ref(false)

// 生效中的查询条件与输入框草稿分开：翻页只沿用生效条件，点查询才把草稿提上来。
const query = reactive(defaultQuery())
const draftFilter = reactive({ pumpCode: '', plant: '', status: '' })

const page = ref(queryIntakePumps(query))
const plantOptions = computed(() => {
  // 水厂选项从全量记录里取，便于下拉；筛选本身仍走输入框包含匹配。
  const all = queryIntakePumps({ ...defaultQuery(), pageSize: 9999 })
  return [...new Set(all.items.map((row) => String(row['所属水厂'] ?? '')).filter(Boolean))]
})
const statusSummary = computed(() => {
  const all = queryIntakePumps({ ...defaultQuery(), pageSize: 9999 })
  return statuses.map((status) => ({
    status,
    count: all.items.filter((row) => String(row.status) === status).length,
  }))
})

const emptyHint = computed(() => {
  if (query.onlyPending || query.pumpCode || query.plant || query.status) {
    return '按当前条件没有找到待启泵组：可放宽编号、水厂或状态条件后再查'
  }
  return '暂无取水泵组数据，可先登记取水泵组'
})

function formatNumber(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : String(value ?? '')
}

function crossShift(row: EntryRow): boolean {
  return String(row['跨班结论'] ?? '').includes('跨班')
}

function legacy(row: EntryRow): boolean {
  return Boolean(String(row['历史结论'] ?? ''))
}

function readQueryFromRoute() {
  query.pumpCode = String(route.query.code ?? '')
  query.plant = String(route.query.plant ?? '')
  query.status = String(route.query.status ?? '')
  query.onlyPending = route.query.pending === '1'
  query.sortAsc = route.query.asc !== '0'
  query.page = Number.parseInt(String(route.query.page ?? '1'), 10) || 1
  query.pageSize = DEFAULT_PAGE_SIZE
  draftFilter.pumpCode = query.pumpCode
  draftFilter.plant = query.plant
  draftFilter.status = query.status
}

function syncRoute() {
  const params: Record<string, string> = {}
  if (query.pumpCode) params.code = query.pumpCode
  if (query.plant) params.plant = query.plant
  if (query.status) params.status = query.status
  if (query.onlyPending) params.pending = '1'
  if (!query.sortAsc) params.asc = '0'
  if (query.page > 1) params.page = String(query.page)
  router.replace({ name: 'intakepump', query: params })
}

function reload(keepPage = false) {
  if (!keepPage) {
    query.page = 1
  }
  page.value = queryIntakePumps(query)
  stats.value = intakePumpStats()
  syncRoute()
}

function applySearch() {
  query.pumpCode = draftFilter.pumpCode
  query.plant = draftFilter.plant
  query.status = draftFilter.status
  feedback.value = ''
  reload()
}

function togglePending() {
  query.onlyPending = !query.onlyPending
  feedback.value = ''
  reload()
}

function toggleSort() {
  query.sortAsc = !query.sortAsc
  feedback.value = ''
  reload()
}

function resetFilters() {
  Object.assign(query, defaultQuery())
  Object.assign(draftFilter, { pumpCode: '', plant: '', status: '' })
  feedback.value = ''
  reload()
}

function goPage(target: number) {
  if (target < 1 || target > page.value.totalPages) {
    return
  }
  query.page = target
  reload(true)
}

function openDetail(row: EntryRow) {
  // 条件随路由带走：从详情回来仍落在原筛选、原页码，定位到那一台直接看。
  void router.push({ name: 'intakepump-detail', params: { id: String(row.id) }, query: route.query })
}

function exportRows() {
  downloadEntries('intakepump')
}

// ---- 登记 ----
const createOpen = ref(false)
const createError = ref('')
const createForm = reactive({ pumpCode: '', plant: '', model: '', ratedFlow: '', runningCurrent: '', crew: '' })

function openCreate() {
  Object.assign(createForm, { pumpCode: '', plant: '', model: '', ratedFlow: '', runningCurrent: '', crew: '' })
  createError.value = ''
  createOpen.value = true
}

function submitCreate() {
  const result = registerIntakePump({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  feedback.value = result.message
  feedbackOk.value = true
  reload()
}

// ---- 启泵 ----
const startTarget = ref<EntryRow | null>(null)
const startCurrent = ref('')
const startError = ref('')

function openStart(row: EntryRow) {
  startTarget.value = row
  startCurrent.value = row['运行电流'] !== '' ? String(row['运行电流']) : ''
  startError.value = ''
}

function submitStart() {
  if (!startTarget.value) {
    return
  }
  const result = startIntakePump(Number(startTarget.value.id), startCurrent.value)
  if (!result.ok) {
    startError.value = result.message
    return
  }
  startTarget.value = null
  feedback.value = result.message
  feedbackOk.value = true
  reload(true)
}

function stopPump(row: EntryRow) {
  const result = stopIntakePump(Number(row.id))
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    reload(true)
  }
}

function reportFault(row: EntryRow) {
  const result = reportIntakePumpFault(Number(row.id))
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    reload(true)
  }
}

onMounted(() => {
  readQueryFromRoute()
  page.value = queryIntakePumps(query)
  stats.value = intakePumpStats()
})
</script>
