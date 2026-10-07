import { moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 取水泵组：排布、登记、校验、启停时间口径、故障转维护待办都收口在这一个文件里，
// 页面组件只负责渲染和调用，不做业务判断。

const KEY = 'intakepump'
const MAINT_KEY = 'equipmaint'

const PENDING_STATUS = '待启泵'
const RUNNING_STATUS = '运行中'
const STOPPED_STATUS = '已停泵'
const FAULT_STATUS = '故障停泵'
const MAINT_OPEN_STATUS = '待开工'

// 运行电流允许填写的区间（安培）：0 < 电流 <= 500，留空也不允许。
export const CURRENT_MIN = 0
export const CURRENT_MAX = 500

// 待启泵排布每页条数：固定一份顺序往下翻，页与页不重不漏。
export const PAGE_SIZE = 5

export type IntakeFilters = {
  pumpNo: string
  plant: string
}

export type IntakeDraft = {
  pumpNo: string
  plant: string
  model: string
  ratedFlow: string
  current: string
  crew: string
}

type PendingResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  totalPages: number
}

type LocateResult = {
  ok: boolean
  message: string
  page?: number
  index?: number
  status?: string
  inFilters?: boolean
}

// 当年班次口径：跨班运行只在启泵那一刻归一次班，之后不再重算。
// 08:00–20:00 为白班，20:00–次日 08:00（跨零点）为夜班，按启泵时刻落点归班。
export function shiftLabelAt(date: Date): string {
  const hour = date.getHours()
  const band = hour >= 8 && hour < 20 ? '白班' : '夜班'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}年${band} ${pad(date.getHours())}:${pad(date.getMinutes())}启泵`
}

function padDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// 额定流量参与排序，抽不出数字的排到最后；同流量按编号兜底，保证顺序稳定。
function flowValue(row: EntryRow): number {
  const value = Number.parseFloat(String(row['额定流量'] ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function sortPending(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const diff = flowValue(a) - flowValue(b)
    if (diff !== 0) {
      return diff
    }
    return String(a['泵组编号']).localeCompare(String(b['泵组编号']), 'zh-Hans-CN')
  })
}

function matchFilters(row: EntryRow, filters: IntakeFilters): boolean {
  const pumpNo = filters.pumpNo.trim()
  const plant = filters.plant.trim()
  if (pumpNo && !String(row['泵组编号'] ?? '').includes(pumpNo)) {
    return false
  }
  if (plant && !String(row['所属水厂'] ?? '').includes(plant)) {
    return false
  }
  return true
}

// 待启泵排布：先按泵组编号、所属水厂挑出「待启泵」，再按额定流量升序排布，
// 翻页沿用同一份筛选与排序切片，不重不漏，total 与条数对得上。
export function listPendingPumps(filters: IntakeFilters, page: number): PendingResult {
  const picked = sortPending(
    listRows(KEY).filter(
      (row) => String(row.status) === PENDING_STATUS && matchFilters(row, filters),
    ),
  )
  const total = picked.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  return {
    items: picked.slice(start, start + PAGE_SIZE),
    total,
    page: currentPage,
    size: PAGE_SIZE,
    totalPages,
  }
}

// 定位到具体某一台：编号精确匹配。找得到、不在待启集合、编号不存在分别给说明。
export function locatePump(pumpNoInput: string, filters: IntakeFilters): LocateResult {
  const code = pumpNoInput.trim()
  if (!code) {
    return { ok: false, message: '请输入要定位的泵组编号。' }
  }
  const row = listRows(KEY).find((item) => String(item['泵组编号']) === code)
  if (!row) {
    return { ok: false, message: `没有找到泵组编号为「${code}」的取水泵组，请核对编号后再定位。` }
  }
  const status = String(row.status)
  if (status !== PENDING_STATUS) {
    return { ok: false, message: `泵组 ${code} 当前为「${status}」，不在待启泵排布里。`, status }
  }
  const ordered = sortPending(
    listRows(KEY).filter((item) => String(item.status) === PENDING_STATUS),
  )
  const overallIndex = ordered.findIndex((item) => String(item['泵组编号']) === code)
  if (overallIndex < 0) {
    return { ok: false, message: `泵组 ${code} 不是待启泵，暂不参与排布。`, status }
  }
  const inFilters = matchFilters(row, filters)
  if (!inFilters) {
    return {
      ok: false,
      inFilters: false,
      status,
      message: `泵组 ${code} 是待启泵，但不满足当前筛选条件；已清空条件并为你定位到它。`,
    }
  }
  return {
    ok: true,
    inFilters: true,
    status,
    page: Math.floor(overallIndex / PAGE_SIZE) + 1,
    index: overallIndex % PAGE_SIZE,
    message: `已定位到泵组 ${code}，在待启泵排布第 ${Math.floor(overallIndex / PAGE_SIZE) + 1} 页。`,
  }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[], prefix: string): string {
  const seq = rows.reduce((max, row) => {
    const code = String(row['维护编号'] ?? '')
    const tail = /(\d+)\s*$/.exec(code)
    return tail ? Math.max(max, Number(tail[1])) : max
  }, 0)
  return `${prefix}-${String(seq + 1).padStart(4, '0')}`
}

function validateCurrent(raw: string): number | null {
  const text = raw.trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return null
  }
  return value
}

// 登记一台取水泵组：编号唯一、额定流量为正、运行电流落在允许区间，任一不过都挡回并说明。
export function createPump(draft: IntakeDraft): ActionResult & { pumpNo?: string } {
  const pumpNo = draft.pumpNo.trim()
  const plant = draft.plant.trim()
  const model = draft.model.trim()
  const crew = draft.crew.trim()
  if (!pumpNo || !plant || !model) {
    return { ok: false, message: '泵组编号、所属水厂、泵组型号都必须填写。' }
  }
  const rows = listRows(KEY)
  if (rows.some((row) => String(row['泵组编号']) === pumpNo)) {
    return { ok: false, message: `泵组编号「${pumpNo}」已登记过，同一台泵只登记一次。` }
  }
  const flow = Number.parseFloat(draft.ratedFlow)
  if (!Number.isFinite(flow) || flow <= 0) {
    return { ok: false, message: '额定流量必须是大于 0 的数字（单位 m³/h）。' }
  }
  const current = validateCurrent(draft.current)
  if (current === null) {
    return {
      ok: false,
      message: `运行电流填写不合法：只允许填写 ${CURRENT_MIN} 到 ${CURRENT_MAX} 安培之间的数字（不含 ${CURRENT_MIN}）。`,
    }
  }
  if (current <= CURRENT_MIN || current > CURRENT_MAX) {
    return {
      ok: false,
      message: `运行电流被挡回：允许区间是 (${CURRENT_MIN}, ${CURRENT_MAX}] 安培，请重新填写。`,
    }
  }
  const row: EntryRow = {
    id: nextId(rows),
    status: PENDING_STATUS,
    pending: true,
    abnormal: false,
    泵组编号: pumpNo,
    所属水厂: plant,
    泵组型号: model,
    额定流量: String(flow),
    运行电流: String(current),
    运行班组: crew || '未排班',
    启停时间: '',
    归属班次: '',
    泵组状态: PENDING_STATUS,
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `取水泵组 ${pumpNo} 已登记，当前为「${PENDING_STATUS}」。`, pumpNo }
}

// 同一台泵对应的未结（待开工）维护待办只允许一条，用来给故障转待办去重。
function findOpenMaint(rows: EntryRow[], pumpNo: string): EntryRow | undefined {
  return rows.find(
    (row) =>
      String(row['关联泵组编号'] ?? '') === pumpNo &&
      String(row.status) === MAINT_OPEN_STATUS,
  )
}

function createMaintTodo(pump: EntryRow): EntryRow[] {
  const rows = listRows(MAINT_KEY)
  const pumpNo = String(pump['泵组编号'])
  const existing = findOpenMaint(rows, pumpNo)
  if (existing) {
    return rows
  }
  const todo: EntryRow = {
    id: nextId(rows),
    status: MAINT_OPEN_STATUS,
    pending: true,
    abnormal: false,
    维护编号: nextCode(rows, 'EQUI'),
    维护设备: `取水泵组 ${pumpNo}`,
    维护类别: '故障维修',
    维护班组: String(pump['运行班组'] ?? '检修班'),
    计划工期: '3天',
    完工日期: '',
    更换配件: '待现场确认',
    关联泵组编号: pumpNo,
    维护状态: MAINT_OPEN_STATUS,
  }
  const saved = [...rows, todo]
  saveRows(MAINT_KEY, saved)
  return saved
}

// 取水泵组动作：启泵记启停时间并按当年口径归一次班；故障停泵同步落一条维护待办（同一台泵只记一次）。
export function intakeAction(id: number, action: string): ActionResult {
  const meta = moduleMeta(KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === target) {
    // 已经是故障停泵时重复上报：不新增维护待办，明确提示同一台泵只记一次。
    if (target === FAULT_STATUS) {
      const todo = findOpenMaint(listRows(MAINT_KEY), String(current['泵组编号']))
      return {
        ok: false,
        message: todo
          ? `泵组 ${current['泵组编号']} 已在故障停泵，维护待办「${todo['维护编号']}」已存在，同一台泵重复提交只记一次。`
          : `泵组 ${current['泵组编号']} 已经是「${target}」，不用重复操作。`,
      }
    }
    return { ok: false, message: `泵组 ${current['泵组编号']}已经是「${target}」，不用重复操作` }
  }

  const updated: EntryRow = { ...current, status: target }

  if (target === RUNNING_STATUS) {
    // 启停时间从启泵那一刻起算；跨班的按启泵时刻落一次当年班次口径，老记录不在这一步重算。
    const startedAt = new Date()
    updated['启停时间'] = padDateTime(startedAt)
    updated['归属班次'] = shiftLabelAt(startedAt)
    updated['泵组状态'] = RUNNING_STATUS
    updated.pending = false
    updated.abnormal = false
  } else if (target === STOPPED_STATUS) {
    updated['泵组状态'] = STOPPED_STATUS
    updated.pending = false
    updated.abnormal = false
  } else if (target === FAULT_STATUS) {
    updated['泵组状态'] = FAULT_STATUS
    updated.pending = false
    updated.abnormal = true
  }

  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)

  if (target === FAULT_STATUS) {
    // 查出来的故障结论落到设备维护待办；同一台泵重复提交只记一次。
    const before = listRows(MAINT_KEY)
    const existed = !!findOpenMaint(before, String(updated['泵组编号']))
    createMaintTodo(updated)
    const todo = findOpenMaint(listRows(MAINT_KEY), String(updated['泵组编号']))
    return {
      ok: true,
      message: existed
        ? `泵组 ${updated['泵组编号']}已上报故障；未结维护待办「${todo?.['维护编号'] ?? ''}」已存在，同一台泵只记一次。`
        : `泵组 ${updated['泵组编号']}已上报故障，已生成设备维护待办「${todo?.['维护编号'] ?? ''}」。`,
    }
  }

  return { ok: true, message: `泵组 ${updated['泵组编号']}已${action}，当前状态「${target}」` }
}
