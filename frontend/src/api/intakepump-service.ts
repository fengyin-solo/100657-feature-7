import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 取水泵组专属业务：待启泵排布（筛选/排序/分页一份口径取到底）、登记去重、
// 启泵电流区间校验、启停与跨班口径、故障结论落设备维护待办。
const MODULE_KEY = 'intakepump'
const MAINT_KEY = 'equipmaint'

// 运行电流可填区间（A）：启泵时必须在 (0, 500] 内，登记时可留空（未运行）。
export const CURRENT_MIN_EXCLUSIVE = 0
export const CURRENT_MAX = 500
// 额定流量下限（m³/h）：登记时必须为正数。
export const FLOW_MIN_EXCLUSIVE = 0

export const DEFAULT_PAGE_SIZE = 5

export type IntakePumpQuery = {
  pumpCode: string
  plant: string
  status: string
  onlyPending: boolean
  sortAsc: boolean
  page: number
  pageSize: number
}

export type IntakePumpPage = {
  items: EntryRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  from: number
  to: number
}

export type IntakePumpDraft = {
  pumpCode: string
  plant: string
  model: string
  ratedFlow: string
  runningCurrent: string
  crew: string
}

const PENDING_STATUS = '待启泵'
const RUNNING_STATUS = '运行中'
const STOPPED_STATUS = '已停泵'
const FAULT_STATUS = '故障停泵'

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function toNumber(value: unknown): number {
  const n = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(n) ? n : Number.NaN
}

// 班次口径：白班 08:00-20:00，夜班 20:00-次日08:00。
function shiftAt(text: string): string {
  const hour = Number.parseInt(text.slice(11, 13), 10)
  return hour >= 8 && hour < 20 ? '白班' : '夜班'
}

// 跨班判断：启停落在不同班次即跨班；未停泵时只给启泵班次，不下跨班结论。
function isCrossShift(startText: string, stopText: string): boolean {
  const start = new Date(startText.replace(' ', 'T'))
  const stop = new Date(stopText.replace(' ', 'T'))
  if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime()) || stop < start) {
    return false
  }
  const boundary = (d: Date) => {
    const h = d.getHours()
    const dayIndex = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000)
    return h >= 8 && h < 20 ? dayIndex * 2 : dayIndex * 2 + 1
  }
  return boundary(start) !== boundary(stop)
}

export function defaultQuery(): IntakePumpQuery {
  return {
    pumpCode: '',
    plant: '',
    status: '',
    onlyPending: false,
    sortAsc: true,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  }
}

// 排布口径固定：先按泵组编号、所属水厂、泵组状态挑，再按额定流量升序（同流量按编号），
// 排序结果是全序的，分页照同一份顺序往下切，页与页不重不漏。
export function queryIntakePumps(query: IntakePumpQuery): IntakePumpPage {
  const code = query.pumpCode.trim()
  const plant = query.plant.trim()
  const status = query.onlyPending ? PENDING_STATUS : query.status

  const matched = listRows(MODULE_KEY)
    .filter((row) => (code === '' ? true : String(row['泵组编号'] ?? '').includes(code)))
    .filter((row) => (plant === '' ? true : String(row['所属水厂'] ?? '').includes(plant)))
    .filter((row) => (status === '' ? true : String(row.status) === status))

  const sorted = [...matched].sort((a, b) => {
    const fa = toNumber(a['额定流量'])
    const fb = toNumber(b['额定流量'])
    const flowCmp = Number.isFinite(fa) && Number.isFinite(fb) ? fa - fb : 0
    if (flowCmp !== 0) {
      return query.sortAsc ? flowCmp : -flowCmp
    }
    return String(a['泵组编号'] ?? '').localeCompare(String(b['泵组编号'] ?? ''), 'zh-Hans-CN')
  })

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(Math.max(1, query.page), totalPages)
  const startIndex = (page - 1) * query.pageSize
  const items = sorted.slice(startIndex, startIndex + query.pageSize)
  return {
    items,
    total,
    page,
    pageSize: query.pageSize,
    totalPages,
    from: total === 0 ? 0 : startIndex + 1,
    to: startIndex + items.length,
  }
}

export function getIntakePump(id: number): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === id)
}

export function intakePumpStats(): { label: string; value: number }[] {
  const rows = listRows(MODULE_KEY)
  return [
    { label: '待启泵组', value: rows.filter((r) => String(r.status) === PENDING_STATUS).length },
    { label: '运行中泵组', value: rows.filter((r) => String(r.status) === RUNNING_STATUS).length },
    { label: '故障停泵数', value: rows.filter((r) => String(r.status) === FAULT_STATUS).length },
  ]
}

function invalidCurrentMessage(): string {
  return `运行电流不合法：请填写 ${CURRENT_MIN_EXCLUSIVE}～${CURRENT_MAX} A 之间的数值（启泵须大于 0）`
}

// 同一台泵（泵组编号）只登记一次。
export function registerIntakePump(draft: IntakePumpDraft): ActionResult {
  const pumpCode = draft.pumpCode.trim()
  const plant = draft.plant.trim()
  const model = draft.model.trim()
  if (!pumpCode || !plant || !model) {
    return { ok: false, message: '泵组编号、所属水厂、泵组型号都要填写' }
  }
  const rows = listRows(MODULE_KEY)
  if (rows.some((row) => String(row['泵组编号']) === pumpCode)) {
    return { ok: false, message: `泵组 ${pumpCode} 已登记过，同一台泵只登记一次` }
  }
  const flow = toNumber(draft.ratedFlow)
  if (!Number.isFinite(flow) || flow <= FLOW_MIN_EXCLUSIVE) {
    return { ok: false, message: `额定流量不合法：请填写大于 ${FLOW_MIN_EXCLUSIVE} 的数值（m³/h）` }
  }
  const currentText = draft.runningCurrent.trim()
  if (currentText !== '') {
    const current = toNumber(currentText)
    if (!Number.isFinite(current) || current < CURRENT_MIN_EXCLUSIVE || current > CURRENT_MAX) {
      return { ok: false, message: invalidCurrentMessage() }
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: PENDING_STATUS,
    pending: true,
    abnormal: false,
    泵组编号: pumpCode,
    所属水厂: plant,
    泵组型号: model,
    额定流量: flow,
    运行电流: currentText,
    运行班组: draft.crew.trim(),
    启停时间: '',
    泵组状态: PENDING_STATUS,
  }
  saveRows(MODULE_KEY, [...rows, row])
  return { ok: true, message: `泵组 ${pumpCode} 已登记，当前状态「${PENDING_STATUS}」` }
}

export function startIntakePump(id: number, currentText: string): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到这台取水泵组（编号 ${id}），无法启泵` }
  }
  const row = rows[index]
  if (String(row.status) !== PENDING_STATUS) {
    return { ok: false, message: `泵组 ${row['泵组编号']} 当前是「${row.status}」，只有待启泵的泵组能启泵` }
  }
  const current = toNumber(currentText)
  if (!Number.isFinite(current) || current <= CURRENT_MIN_EXCLUSIVE || current > CURRENT_MAX) {
    return { ok: false, message: invalidCurrentMessage() }
  }

  // 启停时间从启泵那一刻算起，启泵年份与班次在此时固化，作为跨班口径的依据。
  const startedAt = nowText()
  const updated: EntryRow = {
    ...row,
    status: RUNNING_STATUS,
    pending: true,
    abnormal: false,
    运行电流: current,
    启停时间: startedAt,
    停泵时间: '',
    启泵年份: Number.parseInt(startedAt.slice(0, 4), 10),
    启泵班次: shiftAt(startedAt),
    跨班结论: '',
    历史结论: '',
    泵组状态: RUNNING_STATUS,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `泵组 ${updated['泵组编号']} 已启泵，启停时间记为 ${startedAt}（${updated['启泵班次']}）` }
}

export function stopIntakePump(id: number): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到这台取水泵组（编号 ${id}），无法停泵` }
  }
  const row = rows[index]
  if (String(row.status) !== RUNNING_STATUS) {
    return { ok: false, message: `泵组 ${row['泵组编号']} 当前是「${row.status}」，只有运行中的泵组能停泵` }
  }
  const startedAt = String(row['启停时间'] ?? '')
  const stoppedAt = nowText()

  // 跨班按启泵当年口径只算一次，结论在停泵时固化；老记录自带历史结论，不在这里重算。
  let conclusion = String(row['跨班结论'] ?? '')
  if (!String(row['历史结论'] ?? '')) {
    conclusion = isCrossShift(startedAt, stoppedAt)
      ? `跨班（按${row['启泵年份'] ?? startedAt.slice(0, 4)}年口径计一次）`
      : '未跨班'
  }
  const updated: EntryRow = {
    ...row,
    status: STOPPED_STATUS,
    pending: false,
    停泵时间: stoppedAt,
    跨班结论: conclusion,
    泵组状态: STOPPED_STATUS,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `泵组 ${updated['泵组编号']} 已停泵，${conclusion || '班次结论沿用历史记录'}` }
}

function nextMaintId(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const code = String(row['维护编号'] ?? '')
    const n = Number.parseInt(code.replace(/^EQUI-/, ''), 10)
    if (Number.isFinite(n)) {
      max = Math.max(max, n)
    }
  }
  return `EQUI-${String(max + 1).padStart(4, '0')}`
}

export function reportIntakePumpFault(id: number): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到这台取水泵组（编号 ${id}），无法上报故障` }
  }
  const row = rows[index]
  const pumpCode = String(row['泵组编号'])

  // 查出来的结论落到设备维护待办；同一台泵重复提交只记一次，幂等返回已有待办。
  const maintRows = listRows(MAINT_KEY)
  const existed = maintRows.find(
    (item) => String(item['维护设备']) === pumpCode && String(item['维护类别']) === '泵组故障检修',
  )

  if (String(row.status) !== FAULT_STATUS) {
    const updated: EntryRow = { ...row, status: FAULT_STATUS, pending: false, abnormal: true, 泵组状态: FAULT_STATUS }
    const nextPumps = [...rows]
    nextPumps[index] = updated
    saveRows(MODULE_KEY, nextPumps)
  }

  if (existed) {
    return {
      ok: true,
      message: `泵组 ${pumpCode} 已是故障停泵，设备维护待办 ${existed['维护编号']} 已存在，同一台泵只记一次`,
    }
  }

  // 故障态但缺待办的历史数据同样补一条，保证故障结论不漏落到待办。
  const todo: EntryRow = {
    id: maintRows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '待开工',
    pending: true,
    abnormal: false,
    维护编号: nextMaintId(maintRows),
    维护设备: pumpCode,
    维护类别: '泵组故障检修',
    维护班组: '机修班',
    计划工期: '3天',
    完工日期: '',
    更换配件: '待评估',
    维护状态: '待开工',
  }
  saveRows(MAINT_KEY, [...maintRows, todo])
  return { ok: true, message: `泵组 ${pumpCode} 已报故障，已生成设备维护待办 ${todo['维护编号']}` }
}
