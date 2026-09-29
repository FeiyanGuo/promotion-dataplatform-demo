// 统一 API 访问层：所有请求带 cookie
async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    let details: string[] | undefined
    try {
      const data = await res.json()
      if (data.error) msg = data.error
      if (Array.isArray(data.details)) details = data.details
    } catch { /* ignore */ }
    const err = new Error(msg) as Error & { details?: string[] }
    err.details = details
    throw err
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  meta: () => request('/api/meta'),
  query: (body: { startYear: number; endYear: number }) =>
    request('/api/query', { method: 'POST', body: JSON.stringify(body) }),
  adminOrg: () => request('/api/admin/org'),
  updateAcl: (node: string, usernames: string[]) =>
    request('/api/admin/acl', { method: 'PUT', body: JSON.stringify({ node, usernames }) }),
  importAcl: (rows: Record<string, string>[]) =>
    request('/api/admin/acl/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  importData: (dataset: 'promotions' | 'roster', mode: 'append' | 'replace', rows: Record<string, string>[]) =>
    request(`/api/admin/import/${dataset}`, { method: 'POST', body: JSON.stringify({ mode, rows }) }),
  adminAudit: () => request('/api/admin/audit'),
}

// 导出：POST 返回 xlsx 二进制，前端转存下载
export async function exportExcel(body: {
  startYear: number
  endYear: number
  all: boolean
  filters?: Filters
}): Promise<Blob> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `导出失败 (${res.status})`
    try { const d = await res.json(); if (d.error) msg = d.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.blob()
}

// 授权配置导出
export async function exportAclConfig(): Promise<Blob> {
  const res = await fetch('/api/admin/acl/export', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`导出失败 (${res.status})`)
  return res.blob()
}

export interface Filters {
  search?: string
  departments?: string[]
  levelMin?: string | number
  levelMax?: string | number
  yearFilters?: Record<string, '是' | '否' | ''>
}

export interface User {
  username: string
  name: string
  role: 'admin' | 'bp'
  departments: string[]
  centers: string[]
}

export interface Meta {
  minYear: number
  maxYear: number
  departments: string[]
  scopeNodes: string[]
  promoRecordCount: number
  rosterCount: number
  rosterCutoff: string
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, string>[]
  years: number[]
  scopedDepartments: string[]
}

export interface OrgNode {
  name: string
  count: number
  children: OrgNode[]
}
