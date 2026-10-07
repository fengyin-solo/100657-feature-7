<template>
  <section class="page" data-module="intakepump">
    <header class="page-head">
      <div>
        <h2>取水泵组管理</h2>
        <p class="page-desc">
          按泵组编号、所属水厂挑出待启泵，按额定流量升序排布翻页；启泵即记启停时间并按当年口径归一次班，故障自动落设备维护待办。
        </p>
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

    <p v-if="message" class="notice-banner" :class="messageOk ? 'ok' : 'err'">{{ message }}</p>

    <!-- 待启泵排布 -->
    <section class="block">
      <h3 class="block-title">待启泵排布（按额定流量升序）</h3>
      <form class="filter-bar" @submit.prevent="applyQuery">
        <label class="filter-item">
          <span>泵组编号</span>
          <input v-model="query.pumpNo" placeholder="如 INTA-0002" />
        </label>
        <label class="filter-item">
          <span>所属水厂</span>
          <input v-model="query.plant" placeholder="如 第一水厂" />
        </label>
        <button class="btn primary" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="clearQuery">重置条件</button>
        <label class="filter-item locate-item">
          <span>定位泵组编号</span>
          <input v-model="locateNo" placeholder="输入完整编号后定位" />
        </label>
        <button class="btn" type="button" @click="doLocate(locateNo)">定位到该泵</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>排布序号</th>
            <th v-for="column in pendingColumns" :key="column">{{ column }}</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in pendingRows"
            :key="String(row.id)"
            :class="{ 'row-highlight': String(row['泵组编号']) === highlightNo }"
          >
            <td>{{ (pageInfo.page - 1) * pageInfo.size + index + 1 }}</td>
            <td v-for="column in pendingColumns" :key="column">{{ row[column] || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="inspect(row)">定位查看</button>
              <button class="link" type="button" @click="doAction('提交启泵', row)">提交启泵</button>
              <button class="link danger" type="button" @click="doAction('上报故障', row)">上报故障</button>
            </td>
          </tr>
          <tr v-if="!pendingRows.length">
            <td :colspan="pendingColumns.length + 2" class="empty-state">
              当前条件下没有待启泵：可放宽泵组编号或所属水厂条件后再查，或先登记一台取水泵组。
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="pager">
        <span>共 {{ pageInfo.total }} 条待启泵，第 {{ pageInfo.page }} / {{ pageInfo.totalPages }} 页，每页 {{ pageInfo.size }} 条</span>
        <span class="pager-controls">
          <button class="btn" type="button" :disabled="pageInfo.page <= 1" @click="gotoPage(1)">首页</button>
          <button class="btn" type="button" :disabled="pageInfo.page <= 1" @click="gotoPage(pageInfo.page - 1)">上一页</button>
          <button
            v-for="p in pageList"
            :key="p"
            class="btn"
            :class="{ primary: p === pageInfo.page }"
            type="button"
            @click="gotoPage(p)"
          >
            {{ p }}
          </button>
          <button class="btn" type="button" :disabled="pageInfo.page >= pageInfo.totalPages" @click="gotoPage(pageInfo.page + 1)">下一页</button>
          <button class="btn" type="button" :disabled="pageInfo.page >= pageInfo.totalPages" @click="gotoPage(pageInfo.totalPages)">末页</button>
        </span>
      </footer>
    </section>

    <!-- 全部泵组台账 -->
    <section class="block">
      <h3 class="block-title">全部取水泵组</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>泵组状态</span>
          <select v-model="ledgerStatus">
            <option value="">全部状态</option>
            <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="ledgerStatus = ''">查看全部</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ledgerRows" :key="String(row.id)">
            <td v-for="column in ledgerColumns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="inspect(row)">查看</button>
              <button
                v-for="action in actionsFor(String(row.status))"
                :key="action"
                class="link"
                :class="{ danger: action === '上报故障' }"
                type="button"
                @click="doAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td :colspan="ledgerColumns.length + 2" class="empty-state">没有符合状态的取水泵组记录。</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ ledgerRows.length }} 条泵组记录（状态筛选后）</span>
      </footer>
    </section>

    <!-- 登记弹窗 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="modal">
        <h3>登记取水泵组</h3>
        <p class="modal-hint">同一泵组编号只能登记一次；运行电流允许区间 ({{ currentMin }}, {{ currentMax }}] 安培。</p>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field.key" class="filter-item">
            <span>{{ field.label }}</span>
            <input v-model="draft[field.key]" :placeholder="field.placeholder" />
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="submit">提交登记</button>
            <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 定位查看抽屉 -->
    <div v-if="selectedRow" class="drawer-mask" @click.self="selectedNo = ''">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>泵组 {{ selectedRow['泵组编号'] }}</h3>
          <button class="link" type="button" @click="selectedNo = ''">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="column in ledgerColumns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ selectedRow[column] || '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ selectedRow.status }}</dd>
        </dl>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  CURRENT_MAX,
  CURRENT_MIN,
  PAGE_SIZE,
  createPump,
  intakeAction,
  listPendingPumps,
  locatePump,
} from '@/api/intake-service'
import { useIntakeStore } from '@/stores/intake'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('intakepump')
const store = useIntakeStore()

const pendingColumns = ['泵组编号', '所属水厂', '泵组型号', '额定流量', '运行电流', '运行班组', '启停时间', '归属班次']
const ledgerColumns = [...pendingColumns, '泵组状态']
const statuses = ['待启泵', '运行中', '已停泵', '故障停泵']
const currentMin = CURRENT_MIN
const currentMax = CURRENT_MAX

const pendingRows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const pageInfo = ref({ total: 0, page: 1, size: PAGE_SIZE, totalPages: 1 })

const message = ref('')
const messageOk = ref(true)
const highlightNo = ref('')
const selectedNo = ref('')
const locateNo = ref('')
const ledgerStatus = ref('')

// 查询输入框初始值取会话里保留的条件，翻页或切走再回来都不退回全集。
const query = reactive({ pumpNo: store.pumpNo, plant: store.plant })

const createFields = [
  { key: 'pumpNo' as const, label: '泵组编号', placeholder: '如 INTA-0016' },
  { key: 'plant' as const, label: '所属水厂', placeholder: '如 第一水厂' },
  { key: 'model' as const, label: '泵组型号', placeholder: '如 单级双吸离心泵' },
  { key: 'ratedFlow' as const, label: '额定流量(m³/h)', placeholder: '大于 0 的数字' },
  { key: 'current' as const, label: `运行电流(A)，区间(${CURRENT_MIN},${CURRENT_MAX}]`, placeholder: '如 220' },
  { key: 'crew' as const, label: '运行班组', placeholder: '如 甲班' },
]
const emptyDraft = () => ({ pumpNo: '', plant: '', model: '', ratedFlow: '', current: '', crew: '' })
const draft = reactive(emptyDraft())
const showCreate = ref(false)

const stats = computed(() => [
  { label: '待启泵组', value: allRows.value.filter((row) => row.status === '待启泵').length },
  { label: '运行中泵组', value: allRows.value.filter((row) => row.status === '运行中').length },
  { label: '故障停泵数', value: allRows.value.filter((row) => row.status === '故障停泵').length },
])

const ledgerRows = computed(() =>
  ledgerStatus.value
    ? allRows.value.filter((row) => String(row.status) === ledgerStatus.value)
    : allRows.value,
)

const selectedRow = computed(() =>
  allRows.value.find((row) => String(row['泵组编号']) === selectedNo.value),
)

const pageList = computed(() => {
  const pages: number[] = []
  for (let p = 1; p <= pageInfo.value.totalPages; p += 1) {
    pages.push(p)
  }
  return pages
})

function notify(text: string, ok = false) {
  message.value = text
  messageOk.value = ok
}

function reloadPending() {
  const result = listPendingPumps(
    { pumpNo: store.pumpNo, plant: store.plant },
    store.page,
  )
  pendingRows.value = result.items
  pageInfo.value = {
    total: result.total,
    page: result.page,
    size: result.size,
    totalPages: result.totalPages,
  }
  // 条件变化后末页可能变少，服务层会把页码收回来，这里同步回会话。
  store.setPage(result.page)
}

function reloadLedger() {
  allRows.value = listEntries(meta.key, {}).items
}

function reload() {
  reloadPending()
  reloadLedger()
}

function applyQuery() {
  // 条件在翻页后保留：写进会话再查询，新查询回到第 1 页。
  store.setFilters(query.pumpNo, query.plant)
  highlightNo.value = ''
  reload()
}

function clearQuery() {
  query.pumpNo = ''
  query.plant = ''
  store.reset()
  highlightNo.value = ''
  reload()
}

function gotoPage(page: number) {
  store.setPage(page)
  reloadPending()
}

function doLocate(code: string) {
  const filters = { pumpNo: store.pumpNo, plant: store.plant }
  const result = locatePump(code, filters)
  const foundRow = allRows.value.find((row) => String(row['泵组编号']) === code.trim())

  if (result.ok || result.inFilters === false) {
    // 不在当前条件里时，按说明清空条件再定位，保证「定位到那一台就能直接看」。
    if (result.inFilters === false) {
      query.pumpNo = ''
      query.plant = ''
      store.setFilters('', '')
      const retried = locatePump(code, { pumpNo: '', plant: '' })
      if (retried.ok && retried.page) {
        store.setPage(retried.page)
      }
    } else if (result.page) {
      store.setPage(result.page)
    }
    reloadPending()
    highlightNo.value = code.trim()
    selectedNo.value = code.trim()
    notify(result.message, true)
    return
  }

  if (foundRow) {
    // 编号存在但不是待启泵：给出一句说明，同时打开该泵详情直接看。
    selectedNo.value = code.trim()
    notify(result.message, false)
  } else {
    notify(result.message, false)
  }
}

function inspect(row: EntryRow) {
  selectedNo.value = String(row['泵组编号'])
  highlightNo.value = String(row['泵组编号'])
}

function openCreate() {
  Object.assign(draft, emptyDraft())
  showCreate.value = true
}

function submitCreate() {
  const result = createPump({ ...draft })
  if (!result.ok) {
    notify(result.message, false)
    return
  }
  showCreate.value = false
  notify(result.message, true)
  // 登记后直接定位到这台新泵：清空条件、跳到它所在页并高亮、打开详情。
  query.pumpNo = ''
  query.plant = ''
  store.setFilters('', '')
  reload()
  if (result.pumpNo) {
    doLocate(result.pumpNo)
  }
}

function actionsFor(status: string): string[] {
  if (status === '待启泵') {
    return ['提交启泵', '上报故障']
  }
  if (status === '运行中') {
    return ['登记停泵', '上报故障']
  }
  if (status === '已停泵') {
    return ['提交启泵', '上报故障']
  }
  if (status === '故障停泵') {
    return ['上报故障']
  }
  return []
}

function doAction(action: string, row: EntryRow) {
  const result = intakeAction(Number(row.id), action)
  notify(result.message, result.ok)
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

onMounted(() => {
  query.pumpNo = store.pumpNo
  query.plant = store.plant
  reload()
})
</script>
