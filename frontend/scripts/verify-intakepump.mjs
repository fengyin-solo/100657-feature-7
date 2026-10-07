// 核心业务规则冒烟验证：在 Node 下通过 vite 的 SSR 加载 TS 源码，
// 用内存 localStorage 跑取水泵组服务，校验排布/翻页/去重/电流区间/跨班/维护待办。
import { createServer } from 'vite'

const store = new Map()
const localStorageMock = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
}
globalThis.window = { localStorage: localStorageMock }
globalThis.localStorage = localStorageMock

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures += 1
    console.error(`FAIL  ${name} ${detail}`)
  }
}

const svc = await server.ssrLoadModule('/src/api/intakepump-service.ts')
const storeMod = await server.ssrLoadModule('/src/data/local-store.ts')

// 1) 待启泵排布：筛选 + 排序 + 翻页不重不漏，条数对得上
const q = svc.defaultQuery()
q.onlyPending = true
q.pageSize = 5
const p1 = svc.queryIntakePumps(q)
const p2 = svc.queryIntakePumps({ ...q, page: 2 })
check('待启泵总数=8', p1.total === 8, `total=${p1.total}`)
check('第1页5条', p1.items.length === 5)
check('第2页3条', p2.items.length === 3)
check('页脚from/to对账', p1.from === 1 && p1.to === 5 && p2.from === 6 && p2.to === 8)
const ids = [...p1.items, ...p2.items].map((r) => r.id)
check('两页不重不漏', new Set(ids).size === 8 && ids.length === 8)
const flows = p1.items.concat(p2.items).map((r) => Number(r['额定流量']))
const sortedAsc = flows.every((v, i) => i === 0 || flows[i - 1] <= v)
check('按额定流量升序', sortedAsc, JSON.stringify(flows))
check('同流量按编号(320:0101先于0107)', p1.items.concat(p2.items).findIndex((r) => r['泵组编号'] === 'INTA-0101') < p1.items.concat(p2.items).findIndex((r) => r['泵组编号'] === 'INTA-0107'))

// 2) 条件组合：第一水厂 + 待启泵
q.onlyPending = false
q.status = '待启泵'
q.plant = '第一水厂'
const pf = svc.queryIntakePumps({ ...q, page: 1 })
check('第一水厂待启泵4台', pf.total === 4, `total=${pf.total}`)
check('均属第一水厂', pf.items.every((r) => r['所属水厂'] === '第一水厂'))

// 找不到时给说明（页面空态），这里验证结果为空
q.plant = '第三水厂'
const none = svc.queryIntakePumps({ ...q, page: 1 })
check('查无结果 total=0', none.total === 0 && none.items.length === 0)

// 3) 同一台泵只登记一次
const dup = svc.registerIntakePump({ pumpCode: 'INTA-0101', plant: '第一水厂', model: 'X', ratedFlow: '400', runningCurrent: '', crew: '' })
check('重复编号被挡', dup.ok === false && dup.message.includes('只登记一次'), dup.message)
const badFlow = svc.registerIntakePump({ pumpCode: 'INTA-0900', plant: '第一水厂', model: 'X', ratedFlow: '0', runningCurrent: '', crew: '' })
check('额定流量非法被挡', badFlow.ok === false)
const badCurrent = svc.registerIntakePump({ pumpCode: 'INTA-0901', plant: '第一水厂', model: 'X', ratedFlow: '400', runningCurrent: '501', crew: '' })
check('登记电流超区间被挡', badCurrent.ok === false && badCurrent.message.includes('0～500'), badCurrent.message)
const okReg = svc.registerIntakePump({ pumpCode: 'INTA-0901', plant: '第一水厂', model: 'X', ratedFlow: '400', runningCurrent: '', crew: '甲班' })
check('合法登记成功', okReg.ok === true, okReg.message)

// 4) 启泵电流区间：不合法挡回并说明区间
const targetId = storeMod.listRows('intakepump').find((r) => r['泵组编号'] === 'INTA-0103').id
const c0 = svc.startIntakePump(targetId, '0')
check('电流0被挡', c0.ok === false && c0.message.includes('0～500'), c0.message)
const cNeg = svc.startIntakePump(targetId, '-5')
check('负电流被挡', cNeg.ok === false)
const cOk = svc.startIntakePump(targetId, '210.5')
check('合法电流启泵', cOk.ok === true, cOk.message)
const running = svc.getIntakePump(targetId)
check('启停时间从启泵那一刻记', typeof running['启停时间'] === 'string' && running['启停时间'].length === 16, running['启停时间'])
check('启泵年份固化', Number(running['启泵年份']) === new Date().getFullYear())
check('运行中不能再启', svc.startIntakePump(targetId, '200').ok === false)

// 5) 跨班：白班启、夜班停 => 跨班，按启泵当年口径结一次
//    用种子 INTA-0201（2026-10-06 21:30 夜班运行中），停泵由当前时间决定，
//    这里单独校验 isCrossShift 对种子 INTA-0202 的结论字段已固化
const seed0202 = storeMod.listRows('intakepump').find((r) => r['泵组编号'] === 'INTA-0202')
check('跨班结论已固化', seed0202['跨班结论'].includes('跨班') && seed0202['跨班结论'].includes('2026'), seed0202['跨班结论'])

// 老记录 INTA-0301：2025 启泵，历史结论留存
const oldPump = storeMod.listRows('intakepump').find((r) => r['泵组编号'] === 'INTA-0301')
check('老记录按当年结论留存', oldPump['历史结论'].includes('2025') && oldPump['跨班结论'] === oldPump['历史结论'])

// 6) 故障结论落设备维护待办，同一台泵重复提交只记一次
const faultTarget = storeMod.listRows('intakepump').find((r) => r['泵组编号'] === 'INTA-0104').id
const beforeCount = storeMod.listRows('equipmaint').length
const f1 = svc.reportIntakePumpFault(faultTarget)
const after1 = storeMod.listRows('equipmaint').length
check('故障生成维护待办', f1.ok === true && after1 === beforeCount + 1, f1.message)
const f2 = svc.reportIntakePumpFault(faultTarget)
const after2 = storeMod.listRows('equipmaint').length
check('重复上报不重复建待办', f2.ok === true && after2 === after1 && f2.message.includes('只记一次'), f2.message)

// 已存在待办的种子 INTA-0203（故障停泵 + EQUI-0001）：幂等返回已有待办，不新建
const maintBefore3 = storeMod.listRows('equipmaint').length
const f3 = svc.reportIntakePumpFault(storeMod.listRows('intakepump').find((r) => r['泵组编号'] === 'INTA-0203').id)
const maintAfter3 = storeMod.listRows('equipmaint').length
check('故障态重复提交幂等且不新建待办', f3.ok === true && maintAfter3 === maintBefore3 && f3.message.includes('EQUI-0001'), f3.message)

// 7) 找不到记录给说明
check('找不到启泵泵说明', svc.startIntakePump(99999, '100').ok === false)
check('找不到故障泵说明', svc.reportIntakePumpFault(99999).ok === false)

// 8) 翻页越界自动收敛：page 超范围回到最后一页（此时待启泵因前序登记变为 9 台）
const pendingCount = svc.queryIntakePumps({ ...svc.defaultQuery(), onlyPending: true, pageSize: 9999 }).total
const lastPage = Math.max(1, Math.ceil(pendingCount / 5))
const over = svc.queryIntakePumps({ ...svc.defaultQuery(), onlyPending: true, pageSize: 5, page: 99 })
check('页码越界收敛到末页', over.page === lastPage && over.items.length === pendingCount - (lastPage - 1) * 5, `page=${over.page} len=${over.items.length}`)

await server.close()
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
