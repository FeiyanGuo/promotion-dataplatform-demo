import express from 'express'
import XLSX from 'xlsx'
import { loadData, loadJson, saveJson, logAudit } from './lib/store.js'
import { buildWideTable, getYearRange } from './lib/wideTable.js'
import { buildOrgIndex, orgTree, effectiveDepartments } from './lib/org.js'
import { applyFilters } from './lib/filters.js'

const app = express()
app.use(express.json())

// ── 会话（内存态，原型级别；生产应接公司SSO）──
const sessions = new Map()

function parseCookies(req) {
  const out = {}
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, departments: u.departments, centers: u.centers || [] }
}

function auth(req, res, next) {
  const sid = parseCookies(req).sid
  const username = sessions.get(sid)
  if (!username) return res.status(401).json({ error: '未登录' })
  const user = loadData().users.find((u) => u.username === username)
  if (!user) return res.status(401).json({ error: '账号不存在' })
  req.user = user
  next()
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可访问' })
  next()
}

// ── 认证 ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = loadData().users.find((u) => u.username === username && u.password === password)
  if (!user) return res.status(401).json({ error: '账号或密码错误' })
  const sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
  sessions.set(sid, user.username)
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`)
  logAudit({ user: user.username, name: user.name, action: '登录', detail: '' })
  res.json({ user: publicUser(user) })
})

app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid
  if (sid && sessions.has(sid)) {
    const username = sessions.get(sid)
    const user = loadData().users.find((u) => u.username === username)
    logAudit({ user: username, name: user?.name || '', action: '登出', detail: '' })
    sessions.delete(sid)
  }
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0')
  res.json({ ok: true })
})

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

// ── 查询元数据（所有计数均按当前账号的有效部门权限收敛）──
app.get('/api/meta', auth, (req, res) => {
  const { promotions, roster } = loadData()
  const { minYear, maxYear } = getYearRange(promotions)
  const depts = effectiveDepartments(req.user, roster)
  const allowed = new Set(depts)
  const scoped = roster.filter((r) => allowed.has(r['部门']))
  const deptOf = new Map(roster.map((r) => [r['工号'], r['部门']]))
  const scopedPromoCount = promotions.filter((p) => allowed.has(deptOf.get(p['工号']))).length
  res.json({
    minYear,
    maxYear,
    departments: depts,
    scopeNodes: [...(req.user.centers || []), ...(req.user.departments || [])],
    promoRecordCount: scopedPromoCount,
    rosterCount: scoped.length,
    rosterCutoff: roster[0]?.['统计截止日期'] || '',
  })
})

// 服务端权限强制：请求里的部门必须与该账号的有效部门求交集
function resolveScope(req, requested) {
  const allowed = new Set(effectiveDepartments(req.user, loadData().roster))
  const depts = (Array.isArray(requested) && requested.length ? requested : [...allowed])
    .filter((d) => allowed.has(d))
  return depts.length ? depts : []
}

// ── 宽表查询 ──
app.post('/api/query', auth, (req, res) => {
  const { startYear, endYear, departments } = req.body || {}
  const { promotions, roster } = loadData()
  const { minYear, maxYear } = getYearRange(promotions)
  const sy = Number(startYear) || minYear
  const ey = Number(endYear) || maxYear
  if (sy < minYear || ey > maxYear || sy > ey) {
    return res.status(400).json({ error: `年份范围无效，可用范围 ${minYear}–${maxYear}` })
  }
  const depts = resolveScope(req, departments)
  if (!depts.length) return res.status(403).json({ error: '没有可见部门权限' })

  const result = buildWideTable({ promotions, roster, startYear: sy, endYear: ey, departments: depts })
  logAudit({
    user: req.user.username, name: req.user.name, action: '查询',
    detail: `年份 ${sy}–${ey}；部门 ${depts.join('、')}`,
    rows: result.rows.length,
  })
  res.json({ ...result, scopedDepartments: depts })
})

// ── 导出 Excel（服务端重新计算 + 权限过滤；支持所见即所得筛选或全量）──
app.post('/api/export', auth, (req, res) => {
  const { startYear, endYear, filters, all } = req.body || {}
  const { promotions, roster } = loadData()
  const { minYear, maxYear } = getYearRange(promotions)
  const sy = Number(startYear) || minYear
  const ey = Number(endYear) || maxYear
  const depts = resolveScope(req)
  if (!depts.length) return res.status(403).json({ error: '没有可见部门权限' })

  let { columns, rows } = buildWideTable({ promotions, roster, startYear: sy, endYear: ey, departments: depts })
  if (!all) rows = applyFilters(rows, filters || {})

  const aoa = [columns, ...rows.map((r) => columns.map((c) => r[c]))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map(() => ({ wch: 14 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '晋升宽表')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const f = filters || {}
  const fDesc = all ? '全量（无视筛选）' : [
    f.search && `搜索「${f.search}」`,
    f.departments?.length && `部门 ${f.departments.join('/')}`,
    (f.levelMin || f.levelMax) && `职级 ${f.levelMin || '不限'}–${f.levelMax || '不限'}`,
    ...Object.entries(f.yearFilters || {}).filter(([, v]) => v).map(([y, v]) => `${y}年${v}`),
  ].filter(Boolean).join('；') || '未设筛选'
  logAudit({
    user: req.user.username, name: req.user.name, action: '导出',
    detail: `年份 ${sy}–${ey}；${fDesc}`,
    rows: rows.length,
  })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="promotion_wide_${sy}-${ey}.xlsx"`)
  res.send(buf)
})

// ── 管理员：账号列表 ──
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json({ users: loadData().users.map(publicUser) })
})

// ── 管理员：组织授权到人（架构图节点授权；中心授权自动覆盖其下全部部门）──
app.get('/api/admin/org', auth, adminOnly, (req, res) => {
  const { roster } = loadData()
  res.json({ tree: orgTree(roster), users: loadData().users.map(publicUser) })
})

app.put('/api/admin/acl', auth, adminOnly, (req, res) => {
  const { node, usernames } = req.body || {}
  const { roster } = loadData()
  const { centers } = buildOrgIndex(roster)
  const isCenter = centers.has(node)
  if (!node || (!isCenter && !centers.has(node))) {
    const allDepts = new Set(roster.map((r) => r['部门']))
    if (!allDepts.has(node)) return res.status(400).json({ error: '组织节点不存在' })
  }
  const grant = new Set(Array.isArray(usernames) ? usernames : [])
  const users = loadJson('users.json')
  const changed = []
  for (const u of users.filter((x) => x.role === 'bp')) {
    u.centers = u.centers || []
    const list = isCenter ? u.centers : u.departments
    const has = list.includes(node)
    const should = grant.has(u.username)
    if (has && !should) {
      if (isCenter) u.centers = u.centers.filter((c) => c !== node)
      else u.departments = u.departments.filter((d) => d !== node)
      changed.push(`${u.name}：移除`)
    } else if (!has && should) {
      list.push(node)
      changed.push(`${u.name}：新增`)
    }
  }
  saveJson('users.json', users)
  logAudit({
    user: req.user.username, name: req.user.name, action: '调整权限',
    detail: `「${node}」（${isCenter ? '中心' : '部门'}）授权变更 —— ${changed.length ? changed.join('，') : '无变化'}`,
  })
  res.json({ users: users.map(publicUser) })
})

// ── 管理员：数据导入（晋升数据 / 花名册；追加补数 = 按主键去重更新）──
const DATASET_REQUIRED = {
  promotions: ['工号', '姓名', '晋升周期', '晋升前职级', '晋升后职级', '晋升生效时间'],
  roster: ['统计截止日期', '工号', '姓名', '中心', '部门'],
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

app.post('/api/admin/import/:dataset', auth, adminOnly, (req, res) => {
  const dataset = req.params.dataset
  const required = DATASET_REQUIRED[dataset]
  if (!required) return res.status(404).json({ error: '未知数据集' })
  const { mode, rows } = req.body || {}
  if (!['append', 'replace'].includes(mode)) return res.status(400).json({ error: 'mode 必须是 append 或 replace' })
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: '文件中没有数据行' })

  const bad = []
  const incoming = rows.slice(0, 50000).map((r, i) => {
    const row = normalizeRow(r)
    const missing = required.filter((c) => !String(row[c] ?? '').trim())
    if (missing.length) bad.push(`第 ${i + 2} 行缺少：${missing.join('、')}`)
    return row
  })
  if (bad.length) return res.status(400).json({ error: `列校验失败（共 ${bad.length} 行有问题，前 5 条）：`, details: bad.slice(0, 5) })

  const file = dataset === 'promotions' ? 'promotions.json' : 'roster.json'
  const existing = loadJson(file)
  const key = (r) => (dataset === 'promotions' ? `${r['工号']}|${r['晋升生效时间']}` : r['工号'])

  let result
  if (mode === 'replace') {
    result = { added: incoming.length, updated: 0, removed: Math.max(0, existing.length - incoming.length) }
    saveJson(file, incoming)
  } else {
    const index = new Map(existing.map((r, i) => [key(r), i]))
    let added = 0; let updated = 0
    for (const row of incoming) {
      const k = key(row)
      if (index.has(k)) { existing[index.get(k)] = row; updated++ } else { existing.push(row); added++ }
    }
    saveJson(file, existing)
    result = { added, updated, removed: 0 }
  }
  const total = loadJson(file).length
  logAudit({
    user: req.user.username, name: req.user.name, action: '数据导入',
    detail: `${dataset === 'promotions' ? '晋升数据' : '花名册'} · ${mode === 'replace' ? '全量替换' : '追加补数'}：新增 ${result.added}、更新 ${result.updated}${result.removed ? `、移除 ${result.removed}` : ''}，现共 ${total} 条`,
  })
  res.json({ ok: true, ...result, total })
})

// ── 管理员：授权配置导出（批量配置留底/编辑用）──
app.get('/api/admin/acl/export', auth, adminOnly, (req, res) => {
  const { roster } = loadData()
  const users = loadJson('users.json')
  const bps = users.filter((u) => u.role === 'bp')
  const nameOf = (list) => list.map((u) => u.username).join('、')
  const aoa = [['组织类型', '组织名称', '直接授权HRBP账号', '经由中心继承（导入时忽略）']]
  for (const c of orgTree(roster).children) {
    const inh = bps.filter((u) => (u.centers || []).includes(c.name))
    aoa.push(['中心', c.name, nameOf(inh), ''])
    for (const d of c.children) {
      aoa.push(['部门', d.name, nameOf(bps.filter((u) => (u.departments || []).includes(d.name))), nameOf(inh)])
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 28 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '授权配置')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  logAudit({ user: req.user.username, name: req.user.name, action: '导出授权配置', detail: '' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="acl_config.xlsx"')
  res.send(buf)
})

// ── 管理员：授权配置导入（全量替换；先校验后写入，失败则整体不落盘）──
app.post('/api/admin/acl/import', auth, adminOnly, (req, res) => {
  const { rows } = req.body || {}
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: '文件中没有数据行' })
  const { roster } = loadData()
  const { centers } = buildOrgIndex(roster)
  const users = loadJson('users.json')
  const bps = users.filter((u) => u.role === 'bp')
  const bpNames = new Set(bps.map((u) => u.username))

  const errors = []
  const grants = []
  rows.forEach((r, i) => {
    const node = String(r['组织名称'] || '').trim()
    if (!node) return
    const isCenter = centers.has(node)
    const isDept = !isCenter && [...centers.values()].some((v) => v.depts.has(node))
    if (!isCenter && !isDept) { errors.push(`第 ${i + 2} 行：组织「${node}」不存在`); return }
    const names = String(r['直接授权HRBP账号'] || r['授权HRBP账号'] || '')
      .split(/[、，,;；\s]+/).filter(Boolean)
    for (const n of names) if (!bpNames.has(n)) { errors.push(`第 ${i + 2} 行：账号 ${n} 不存在`); return }
    grants.push({ node, type: isCenter ? 'center' : 'dept', usernames: names })
  })
  if (errors.length) return res.status(400).json({ error: `校验失败（共 ${errors.length} 处，前 10 条）：`, details: errors.slice(0, 10) })

  // 全量替换：清空所有 BP 的中心/部门授权后按文件重写
  for (const u of bps) { u.centers = []; u.departments = [] }
  for (const g of grants) {
    for (const n of g.usernames) {
      const u = bps.find((x) => x.username === n)
      if (g.type === 'center') { if (!u.centers.includes(g.node)) u.centers.push(g.node) }
      else if (!u.departments.includes(g.node)) u.departments.push(g.node)
    }
  }
  saveJson('users.json', users)
  const grantedNodes = grants.filter((g) => g.usernames.length).length
  logAudit({
    user: req.user.username, name: req.user.name, action: '导入授权配置',
    detail: `全量替换授权：${grantedNodes} 个组织节点有授权，涉及 ${bps.filter((u) => (u.centers || []).length || (u.departments || []).length).length} 个 BP 账号`,
  })
  res.json({ ok: true, grantedNodes })
})

// ── 管理员：审计日志 ──
app.get('/api/admin/audit', auth, adminOnly, (req, res) => {
  res.json({ audit: loadJson('audit.json').slice(0, 300) })
})

export default app
