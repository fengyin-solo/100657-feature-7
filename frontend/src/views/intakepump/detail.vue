<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>取水泵组详情</h2>
        <p class="page-desc">定位到该台泵直接查看；返回后仍落在原筛选条件与页码。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回排布列表</button>
      </div>
    </header>

    <article v-if="row" class="stat-card" style="max-width: 720px">
      <h3 style="margin: 0 0 12px">
        {{ row['泵组编号'] }}
        <span class="badge info">{{ row.status }}</span>
        <span v-if="legacy()" class="badge warn">老记录按当年结论留存</span>
      </h3>
      <dl class="detail-grid">
        <dt>所属水厂</dt><dd>{{ row['所属水厂'] }}</dd>
        <dt>泵组型号</dt><dd>{{ row['泵组型号'] }}</dd>
        <dt>额定流量</dt><dd>{{ row['额定流量'] }} m³/h</dd>
        <dt>运行电流</dt>
        <dd>
          {{ row['运行电流'] === '' || row['运行电流'] === undefined ? '—' : `${row['运行电流']} A` }}
          <span class="field-hint">（启泵可填区间 {{ CURRENT_MIN_EXCLUSIVE }} &lt; I ≤ {{ CURRENT_MAX }} A）</span>
        </dd>
        <dt>运行班组</dt><dd>{{ row['运行班组'] || '—' }}</dd>
        <dt>启停时间</dt><dd>{{ row['启停时间'] || '尚未启泵' }}</dd>
        <dt>停泵时间</dt><dd>{{ row['停泵时间'] || '—' }}</dd>
        <dt>启泵班次</dt><dd>{{ row['启泵班次'] || '—' }}</dd>
        <dt>跨班口径</dt>
        <dd>
          <span v-if="row['跨班结论']">{{ row['跨班结论'] }}</span>
          <span v-else-if="String(row.status) === '运行中'">运行中，停泵时按启泵当年口径结一次</span>
          <span v-else>—</span>
        </dd>
      </dl>

      <div class="row-actions" style="margin-top: 14px">
        <button v-if="String(row.status) === '待启泵'" class="btn primary" type="button" @click="openStart">提交启泵</button>
        <button v-if="String(row.status) === '运行中'" class="btn" type="button" @click="stopPump">登记停泵</button>
        <button
          v-if="String(row.status) !== '故障停泵'"
          class="btn"
          type="button"
          @click="reportFault"
        >
          上报故障
        </button>
      </div>
      <p v-if="feedback" :class="feedbackOk ? 'success-text' : 'error-text'" class="field-hint" style="margin-top: 10px">
        {{ feedback }}
      </p>
    </article>

    <article v-else class="stat-card" style="max-width: 720px">
      <p class="error-text">没有找到编号为 {{ pumpId }} 的取水泵组：可能已被重置，或链接里的编号有误。</p>
    </article>

    <div v-if="startOpen" class="modal-mask" @click.self="startOpen = false">
      <div class="modal">
        <h3>启泵：{{ row?.['泵组编号'] }}</h3>
        <label>
          <span class="field-hint">运行电流（A，可填区间 {{ CURRENT_MIN_EXCLUSIVE }} &lt; I ≤ {{ CURRENT_MAX }}）*</span>
          <input
            v-model="startCurrent"
            type="number"
            :min="CURRENT_MIN_EXCLUSIVE"
            :max="CURRENT_MAX"
            step="0.1"
            style="width: 100%; margin-top: 4px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px"
          />
        </label>
        <p v-if="startError" class="error-text field-hint" style="margin-top: 8px">{{ startError }}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="startOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitStart">确认启泵</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  CURRENT_MAX,
  CURRENT_MIN_EXCLUSIVE,
  getIntakePump,
  reportIntakePumpFault,
  startIntakePump,
  stopIntakePump,
} from '@/api/intakepump-service'

const route = useRoute()
const router = useRouter()

const pumpId = computed(() => Number.parseInt(String(route.params.id ?? ''), 10))
const row = ref(Number.isFinite(pumpId.value) ? getIntakePump(pumpId.value) : undefined)
const feedback = ref('')
const feedbackOk = ref(false)

function legacy() {
  return Boolean(row.value && String(row.value['历史结论'] ?? ''))
}

const startOpen = ref(false)
const startCurrent = ref('')
const startError = ref('')

function refresh() {
  row.value = getIntakePump(pumpId.value)
}

function goBack() {
  // 条件与页码原样带回，不退回没挑过的全集。
  void router.push({ name: 'intakepump', query: route.query })
}

function openStart() {
  startCurrent.value = row.value && row.value['运行电流'] !== '' ? String(row.value['运行电流']) : ''
  startError.value = ''
  startOpen.value = true
}

function submitStart() {
  const result = startIntakePump(pumpId.value, startCurrent.value)
  if (!result.ok) {
    startError.value = result.message
    return
  }
  startOpen.value = false
  feedback.value = result.message
  feedbackOk.value = true
  refresh()
}

function stopPump() {
  const result = stopIntakePump(pumpId.value)
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}

function reportFault() {
  const result = reportIntakePumpFault(pumpId.value)
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}
</script>
