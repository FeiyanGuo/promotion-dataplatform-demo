// 演示模式 API 层：与 @/lib/api 完全相同的接口，但所有数据保存在浏览器内存中
// - 无任何网络请求，数据不出浏览器，刷新页面即还原种子状态
// - 复用与服务端完全相同的宽表/权限/筛选引擎（server/lib 下的纯 JS 模块）
import * as XLSX from 'xlsx'
// @ts-ignore —— 引擎为服务端纯 JS 模块，演示构建不做类型检查（npm run build:demo 跳过 tsc）
import { buildWideTable, getYearRange } from '../../server/lib/wideTable.js'
// @ts-ignore
import { buildOrgIndex, orgTree, effectiveDepartments } from '../../server/lib/org.js'
// @ts-ignore
import { applyFilters } from '../../server/lib/filters.js'
// @ts-ignore
import promotionsSeed from '../../server/data/promotions.json'
// @ts-ignore
import rosterSeed from '../../server/data/roster.json'
// @ts-ignore
import usersSeed from '../../server/data/users.json'

export type { User, Filters, Meta, QueryResult, OrgNode } from './api'

// ── 内存数据仓库（深拷贝种子数据，互不污染）──
const store = {
  promotions: structuredClone(promotionsSeed) as Record<string, string>[],
  roster: structuredClone(rosterSeed) as Record<string, string>[],
  users: structuredClone(usersSeed) as Record<string, any>[],
  audit: [] as { time: string; user: string; name: string; action: string; detail: string; rows?: number }[],
}

let currentUser: any = null

function publicUser(u: any) {
  return { username: u.username, name: u.name, role: u.role, departments: u.departments, centers: u.centers || [] }
}

function logAudit(action: string, detail: string, rows?: number) {
  store.audit.unshift({
    time: new Date().toISOString(),
    user: currentUser?.username || '', name: currentUser?.name || '',
    action, detail, rows,
  })
}

function requireUser() {
  if (!currentUser) throw new Error('未登录')
  return currentUser
}

function requireAdmin() {
  const u = requireUser()
  if (u.role !== 'admin') throw new Error('仅管理员可访问')
  return u
}

function resolveScope(user: any, requested?: string[]) {
  const allowed = new Set(effectiveDepartments(user, store.roster))
  const depts = (Array.isArray(requested) && requested.length ? requested : [...allowed])
    .filter((d: string) => allowed.has(d))
  return depts.length ? depts : []
}

const delay = (v: any) => Promise.resolve(v)

export const api = {
  login(username: string, password: string) {
    const user = store.users.find((u) => u.username === username && u.password === password)
    if (!user) return delay(Promise.reject(new Error('账号或密码错误')))
    currentUser = user
    logAudit('登录', '')
    return delay({ user: publicUser(user) })
  },
  logout() {
    logAudit('登出', '')
    currentUser = null
    return delay({ ok: true })
  },
  me() {
    if (!currentUser) return delay(Promise.reject(new Error('未登录')))
    return delay({ user: publicUser(currentUser) })
  },
  meta() {
    const user = requireUser()
    const { minYear, maxYear } = getYearRange(store.promotions)
    const depts = effectiveDepartments(user, store.roster)
    const allowed = new Set(depts)
    const scoped = store.roster.filter((r) => allowed.has(r['部门']))
    const deptOf = new Map(store.roster.map((r) => [r['工号'], r['部门']]))
    const scopedPromoCount = store.promotions.filter((p) => allowed.has(deptOf.get(p['工号']))).length
    return delay({
      minYear, maxYear, departments: depts,
      scopeNodes: [...(user.centers || []), ...(user.departments || [])],
      promoRecordCount: scopedPromoCount,
      rosterCount: scoped.length,
      rosterCutoff: store.roster[0]?.['统计截止日期'] || '',
    })
  },
  query(body: { startYear: number; endYear: number }) {
    const user = requireUser()
    const { minYear, maxYear } = getYearRange(store.promotions)
    const sy = Number(body?.startYear) || minYear
    const ey = Number(body?.endYear) || maxYear
    if (sy < minYear || ey > maxYear || sy > ey) {
      return delay(Promise.reject(new Error(`年份范围无效，可用范围 ${minYear}–${maxYear}`)))
    }
    const depts = resolveScope(user)
    if (!depts.length) return delay(Promise.reject(new Error('没有可见部门权限')))
    const result = buildWideTable({ promotions: store.promotions, roster: store.roster, startYear: sy, endYear: ey, departments: depts })
    logAudit('查询', `年份 ${sy}–${ey}；部门 ${depts.join('、')}`, result.rows.length)
    return delay({ ...result, scopedDepartments: depts })
  },
  adminOrg() {
    requireAdmin()
    return delay({ tree: orgTree(store.roster), users: store.users.map(publicUser) })
  },
  updateAcl(node: string, usernames: string[]) {
    const admin = requireAdmin()
    const { centers } = buildOrgIndex(store.roster)
    const isCenter = centers.has(node)
    if (!node || (!isCenter && !centers.has(node))) {
      const allDepts = new Set(store.roster.map((r) => r['部门']))
      if (!allDepts.has(node)) return delay(Promise.reject(new Error('组织节点不存在')))
    }
    const grant = new Set(Array.isArray(usernames) ? usernames : [])
    const changed: string[] = []
    for (const u of store.users.filter((x: any) => x.role === 'bp')) {
      u.centers = u.centers || []
      const list = isCenter ? u.centers : u.departments
      const has = list.includes(node)
      const should = grant.has(u.username)
      if (has && !should) {
        if (isCenter) u.centers = u.centers.filter((c: string) => c !== node)
        else u.departments = u.departments.filter((d: string) => d !== node)
        changed.push(`${u.name}：移除`)
      } else if (!has && should) {
        list.push(node)
        changed.push(`${u.name}：新增`)
      }
    }
    logAudit('调整权限', `「${node}」（${isCenter ? '中心' : '部门'}）授权变更 —— ${changed.length ? changed.join('，') : '无变化'}`)
    void admin
    return delay({ users: store.users.map(publicUser) })
  },
  importData(dataset: 'promotions' | 'roster', mode: 'append' | 'replace', rows: Record<string, string>[]) {
    requireAdmin()
    const required = dataset === 'promotions'
      ? ['工号', '姓名', '晋升周期', '晋升前职级', '晋升后职级', '晋升生效时间']
      : ['统计截止日期', '工号', '姓名', '中心', '部门']
    if (!['append', 'replace'].includes(mode)) return delay(Promise.reject(new Error('mode 必须是 append 或 replace')))
    if (!Array.isArray(rows) || !rows.length) return delay(Promise.reject(new Error('文件中没有数据行')))
    const bad: string[] = []
    const incoming = rows.slice(0, 50000).map((r, i) => {
      const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)]))
      const missing = required.filter((c) => !String(row[c] ?? '').trim())
      if (missing.length) bad.push(`第 ${i + 2} 行缺少：${missing.join('、')}`)
      return row
    })
    if (bad.length) return delay(Promise.reject(new Error(`列校验失败（共 ${bad.length} 行有问题，前 5 条）：${bad.slice(0, 5).join(' | ')}`)))

    const key = dataset === 'promotions'
      ? (r: any) => `${r['工号']}|${r['晋升生效时间']}`
      : (r: any) => r['工号']
    const target = dataset === 'promotions' ? store.promotions : store.roster
    let result
    if (mode === 'replace') {
      result = { added: incoming.length, updated: 0, removed: Math.max(0, target.length - incoming.length) }
      if (dataset === 'promotions') store.promotions = incoming; else store.roster = incoming
    } else {
      const index = new Map(target.map((r, i) => [key(r), i]))
      let added = 0; let updated = 0
      for (const row of incoming) {
        const k = key(row)
        if (index.has(k)) { target[index.get(k)!] = row; updated++ } else { target.push(row); added++ }
      }
      result = { added, updated, removed: 0 }
    }
    const total = target.length
    logAudit('数据导入', `${dataset === 'promotions' ? '晋升数据' : '花名册'} · ${mode === 'replace' ? '全量替换' : '追加补数'}：新增 ${result.added}、更新 ${result.updated}，现共 ${total} 条`)
    return delay({ ok: true, ...result, total })
  },
  importAcl(rows: Record<string, string>[]) {
    requireAdmin()
    if (!Array.isArray(rows) || !rows.length) return delay(Promise.reject(new Error('文件中没有数据行')))
    const { centers } = buildOrgIndex(store.roster)
    const bps = store.users.filter((u: any) => u.role === 'bp')
    const bpNames = new Set(bps.map((u: any) => u.username))
    const errors: string[] = []
    const grants: { node: string; type: string; usernames: string[] }[] = []
    rows.forEach((r, i) => {
      const node = String(r['组织名称'] || '').trim()
      if (!node) return
      const isCenter = centers.has(node)
      const isDept = !isCenter && [...centers.values()].some((v: any) => v.depts.has(node))
      if (!isCenter && !isDept) { errors.push(`第 ${i + 2} 行：组织「${node}」不存在`); return }
      const names = String(r['直接授权HRBP账号'] || r['授权HRBP账号'] || '').split(/[、，,;；\s]+/).filter(Boolean)
      for (const n of names) if (!bpNames.has(n)) { errors.push(`第 ${i + 2} 行：账号 ${n} 不存在`); return }
      grants.push({ node, type: isCenter ? 'center' : 'dept', usernames: names })
    })
    if (errors.length) return delay(Promise.reject(new Error(`校验失败：${errors.slice(0, 10).join(' | ')}`)))
    for (const u of bps) { u.centers = []; u.departments = [] }
    for (const g of grants) {
      for (const n of g.usernames) {
        const u = bps.find((x: any) => x.username === n)
        if (g.type === 'center') { if (!u.centers.includes(g.node)) u.centers.push(g.node) }
        else if (!u.departments.includes(g.node)) u.departments.push(g.node)
      }
    }
    logAudit('导入授权配置', `全量替换授权：${grants.filter((g) => g.usernames.length).length} 个组织节点有授权`)
    return delay({ ok: true, grantedNodes: grants.filter((g) => g.usernames.length).length })
  },
  adminAudit() {
    requireAdmin()
    return delay({ audit: store.audit.slice(0, 300) })
  },
}

export async function exportExcel(body: { startYear: number; endYear: number; all: boolean; filters?: any }): Promise<Blob> {
  const user = requireUser()
  const { minYear, maxYear } = getYearRange(store.promotions)
  const sy = Number(body.startYear) || minYear
  const ey = Number(body.endYear) || maxYear
  const depts = resolveScope(user)
  let { columns, rows } = buildWideTable({ promotions: store.promotions, roster: store.roster, startYear: sy, endYear: ey, departments: depts })
  if (!body.all) rows = applyFilters(rows, body.filters || {})
  const aoa = [columns, ...rows.map((r: any) => columns.map((c: string) => r[c]))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map(() => ({ wch: 14 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '晋升宽表')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const f = body.filters || {}
  const fDesc = body.all ? '全量（无视筛选）' : [
    f.search && `搜索「${f.search}」`,
    f.departments?.length && `部门 ${f.departments.join('/')}`,
    (f.levelMin || f.levelMax) && `职级 ${f.levelMin || '不限'}–${f.levelMax || '不限'}`,
    ...Object.entries(f.yearFilters || {}).filter(([, v]) => v).map(([y, v]) => `${y}年${v}`),
  ].filter(Boolean).join('；') || '未设筛选'
  logAudit('导出', `年份 ${sy}–${ey}；${fDesc}`, rows.length)
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export async function exportAclConfig(): Promise<Blob> {
  requireAdmin()
  const nameOf = (list: any[]) => list.map((u) => u.username).join('、')
  const bps = store.users.filter((u: any) => u.role === 'bp')
  const aoa: any[][] = [['组织类型', '组织名称', '直接授权HRBP账号', '经由中心继承（导入时忽略）']]
  for (const c of orgTree(store.roster).children) {
    const inh = bps.filter((u: any) => (u.centers || []).includes(c.name))
    aoa.push(['中心', c.name, nameOf(inh), ''])
    for (const d of c.children) {
      aoa.push(['部门', d.name, nameOf(bps.filter((u: any) => (u.departments || []).includes(d.name))), nameOf(inh)])
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 28 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '授权配置')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  logAudit('导出授权配置', '')
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
