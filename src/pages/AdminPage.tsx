import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Upload, FileDown, ShieldCheck, Network, ChevronDown, ChevronRight, Loader2, UserPlus } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api, exportAclConfig, type OrgNode, type User } from '@/lib/api'

interface AuditEntry {
  time: string
  user: string
  name: string
  action: string
  detail: string
  rows?: number
}

export default function AdminPage({ onDataChanged }: { meta?: unknown; onDataChanged?: () => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [tree, setTree] = useState<OrgNode | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [savingNode, setSavingNode] = useState('')
  const aclFileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const [o, a] = await Promise.all([api.adminOrg(), api.adminAudit()])
      setTree(o.tree)
      setUsers(o.users)
      setAudit(a.audit)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  useEffect(() => { load() }, [])

  const bpUsers = users.filter((u) => u.role === 'bp')
  const admins = users.filter((u) => u.role === 'admin')

  // 中心 → 子部门 索引
  const centerOf = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of tree?.children || []) m.set(c.name, c.children.map((d) => d.name))
    return m
  }, [tree])

  const centerGranted = (center: string, u: User) => (u.centers || []).includes(center)
  const deptInherited = (dept: string, u: User) =>
    [...centerOf.entries()].some(([c, depts]) => depts.includes(dept) && centerGranted(c, u))
  const deptGrantedDirect = (dept: string, u: User) => u.departments.includes(dept)

  // 节点自动保存：变更即写库并记审计
  async function applyNode(node: string, usernames: string[]) {
    setSavingNode(node)
    try {
      const r = await api.updateAcl(node, usernames)
      setUsers(r.users)
    } catch (e: any) {
      toast.error(e.message)
      load() // 失败回滚为服务端状态
    } finally {
      setSavingNode('')
    }
  }

  function toggleCollapse(name: string) {
    setCollapsed((p) => {
      const n = new Set(p)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })
  }

  // 导出授权配置
  async function downloadAcl() {
    try {
      const blob = await exportAclConfig()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = '授权配置.xlsx'; a.click()
      URL.revokeObjectURL(url)
      toast.success('授权配置已导出，可编辑后回导')
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // 导入授权配置（全量替换）
  async function parseAclFile(file: File) {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!rows.length) { toast.error('文件中没有数据行'); return }
      const r = await api.importAcl(rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v ?? '')]))))
      toast.success(`授权配置导入完成：${r.grantedNodes} 个组织节点有授权`)
      load()
    } catch (e: any) {
      toast.error(e.message + (e.details ? `\n${e.details.join('\n')}` : ''))
    } finally {
      if (aclFileRef.current) aclFileRef.current.value = ''
    }
  }

  function bpBadge(u: User, inherited: boolean) {
    return (
      <Badge key={u.username} variant={inherited ? 'outline' : 'secondary'} className="text-xs">
        {u.name.replace('（HRBP）', '')}·{u.username}
        {inherited && <span className="ml-1 text-[10px]">继承</span>}
      </Badge>
    )
  }

  // 授权HRBP多选（内联字段）
  function BpSelect({ node, type }: { node: OrgNode; type: 'center' | 'dept' }) {
    const inheritedUsers = type === 'dept' ? bpUsers.filter((u) => deptInherited(node.name, u)) : []
    const directUsers = type === 'center'
      ? bpUsers.filter((u) => centerGranted(node.name, u))
      : bpUsers.filter((u) => deptGrantedDirect(node.name, u))
    const saving = savingNode === node.name

    return (
      <div className="flex items-center gap-2 flex-wrap">
        {inheritedUsers.map((u) => bpBadge(u, true))}
        {directUsers.map((u) => bpBadge(u, false))}
        {!inheritedUsers.length && !directUsers.length && <span className="text-xs text-muted-foreground">未授权</span>}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              配置
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="start">
            <p className="text-xs text-muted-foreground mb-2">
              {type === 'center' ? '授权后自动覆盖其下全部部门' : '追加授权不影响中心授权'}
            </p>
            <div className="space-y-2 max-h-56 overflow-auto">
              {bpUsers.map((u) => {
                const inherited = type === 'dept' && deptInherited(node.name, u)
                const checked = inherited || directUsers.some((x) => x.username === u.username)
                return (
                  <div key={u.username} className="flex items-center gap-2">
                    <Checkbox
                      id={`sel-${node.name}-${u.username}`}
                      checked={checked}
                      disabled={inherited}
                      onCheckedChange={() => {
                        const cur = directUsers.map((x) => x.username)
                        const next = cur.includes(u.username) ? cur.filter((x) => x !== u.username) : [...cur, u.username]
                        applyNode(node.name, next)
                      }}
                    />
                    <label htmlFor={`sel-${node.name}-${u.username}`} className={`text-sm ${inherited ? 'text-muted-foreground' : 'cursor-pointer'}`}>
                      {u.name} <span className="text-xs text-muted-foreground">@{u.username}</span>
                      {inherited && <span className="ml-1 text-[10px]">（中心继承，此处不可取消）</span>}
                    </label>
                  </div>
                )
              })}
              {!bpUsers.length && <p className="text-sm text-muted-foreground">暂无 HRBP 账号</p>}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Tabs defaultValue="acl">
        <TabsList>
          <TabsTrigger value="acl">组织授权</TabsTrigger>
          <TabsTrigger value="import">数据导入</TabsTrigger>
          <TabsTrigger value="audit">审计日志</TabsTrigger>
        </TabsList>

        <TabsContent value="acl" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Network className="w-5 h-5" />
                    <CardTitle className="text-lg">组织架构授权</CardTitle>
                  </div>
                  <CardDescription className="mt-1.5">
                    在「授权HRBP」字段直接配置，变更自动保存并记审计；中心授权自动覆盖其下全部部门。支持导出编辑后批量回导（全量替换）
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <input ref={aclFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={(e) => e.target.files?.[0] && parseAclFile(e.target.files[0])} />
                  <Button variant="outline" size="sm" onClick={() => aclFileRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-1.5" /> 导入授权配置
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadAcl}>
                    <FileDown className="w-4 h-4 mr-1.5" /> 导出授权配置
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed p-3 flex items-center gap-3 text-sm">
                <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  <span className="font-medium">管理员白名单：</span>
                  {admins.map((a) => <span key={a.username} className="mr-2">{a.name} <span className="text-muted-foreground">@{a.username}</span></span>)}
                  <span className="text-muted-foreground">—— 不受组织授权约束</span>
                </span>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-56">组织</TableHead>
                      <TableHead className="text-xs w-20">人数</TableHead>
                      <TableHead className="text-xs">授权HRBP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* 根节点 */}
                    {tree && (
                      <TableRow className="bg-slate-50/60">
                        <TableCell className="font-medium">{tree.name}</TableCell>
                        <TableCell className="text-xs">{tree.count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">全部可见（管理员白名单）</TableCell>
                      </TableRow>
                    )}
                    {/* 中心层 */}
                    {(tree?.children || []).map((center) => {
                      const isCollapsed = collapsed.has(center.name)
                      return [
                        <TableRow key={center.name} className="hover:bg-transparent">
                          <TableCell>
                            <button className="flex items-center gap-1.5 font-medium" onClick={() => toggleCollapse(center.name)}>
                              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              {center.name}
                            </button>
                          </TableCell>
                          <TableCell className="text-xs">{center.count}</TableCell>
                          <TableCell><BpSelect node={center} type="center" /></TableCell>
                        </TableRow>,
                        // 部门层
                        ...(!isCollapsed ? center.children.map((dept) => (
                          <TableRow key={dept.name}>
                            <TableCell><span className="pl-6 text-sm">{dept.name}</span></TableCell>
                            <TableCell className="text-xs">{dept.count}</TableCell>
                            <TableCell><BpSelect node={dept} type="dept" /></TableCell>
                          </TableRow>
                        )) : []),
                      ]
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="mt-4 space-y-4">
          <ImportCard
            dataset="promotions"
            title="晋升数据导入"
            description="上传晋升系统下载的长表（xlsx）。追加补数：按「工号+生效时间」去重更新；全量替换：整表覆盖"
            headers={['工号', '姓名', '晋升周期', '晋升前职级', '晋升后职级', '晋升生效时间', '晋升评审结果', '晋升评审说明']}
            dateCols={['晋升生效时间']}
            sample={['Q00999', '示例员工', '2026年H2', '15', '16', '2026-11-01', '通过', '']}
            onDone={onDataChanged}
          />
          <ImportCard
            dataset="roster"
            title="花名册导入"
            description="上传最新花名册（xlsx）。追加补数：按「工号」去重更新；全量替换：整表覆盖。【中心】+【部门】两级组织会自动生成上面的架构图"
            headers={['统计截止日期', '工号', '姓名', '中心', '部门', '职级', '学历', '2026年绩效', '是否校招生', '用工性质', '入职时间']}
            dateCols={['统计截止日期', '入职时间']}
            sample={['2026-11-02', 'Q00999', '示例员工', '技术中心', '技术部', '16', '本科', 'B', '否', '正式', '2022-07-01']}
            onDone={onDataChanged}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">审计日志</CardTitle>
              <CardDescription>登录、查询、导出、数据导入、权限调整全部留痕，最近 300 条</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[560px] rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="text-xs">时间</TableHead>
                      <TableHead className="text-xs">账号</TableHead>
                      <TableHead className="text-xs">操作</TableHead>
                      <TableHead className="text-xs">明细</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(a.time).toLocaleString('zh-CN')}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{a.name || a.user}</TableCell>
                        <TableCell className="text-xs"><Badge variant={a.action === '导出' || a.action === '数据导入' || a.action === '导入授权配置' ? 'default' : 'secondary'}>{a.action}</Badge></TableCell>
                        <TableCell className="text-xs">{a.detail}</TableCell>
                      </TableRow>
                    ))}
                    {!audit.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">暂无日志</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function normDate(v: any): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

function ImportCard({ dataset, title, description, headers, dateCols, sample, onDone }: {
  dataset: 'promotions' | 'roster'
  title: string
  description: string
  headers: string[]
  dateCols: string[]
  sample: string[]
  onDone?: () => void
}) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function parseFile(file: File) {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const parsed = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
      if (!parsed.length) { toast.error('文件中没有数据行'); return }
      const cols = Object.keys(parsed[0])
      const missing = headers.filter((h) => !cols.includes(h))
      if (missing.length) {
        toast.error(`缺少必需列：${missing.join('、')}`)
        setRows(null)
        setFileName('')
        return
      }
      const normalized = parsed.map((r) => {
        const out: Record<string, string> = {}
        for (const c of cols) out[c] = dateCols.includes(c) ? normDate(r[c]) : String(r[c] ?? '')
        return out
      })
      setRows(normalized)
      setFileName(file.name)
      toast.success(`已解析 ${normalized.length} 行，检查无误后可导入`)
    } catch (e: any) {
      toast.error('文件解析失败：' + (e.message || e))
    }
  }

  async function submit() {
    if (!rows) return
    setSubmitting(true)
    try {
      const r = await api.importData(dataset, mode, rows)
      toast.success(`导入完成：新增 ${r.added}、更新 ${r.updated}${r.removed ? `、移除 ${r.removed}` : ''}，现共 ${r.total} 条`)
      setRows(null)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      onDone?.()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([headers, sample])
    ws['!cols'] = headers.map(() => ({ wch: 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '模板')
    XLSX.writeFile(wb, `${dataset === 'promotions' ? '晋升数据' : '花名册'}导入模板.xlsx`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1.5" /> 选择文件
          </Button>
          <Button variant="ghost" onClick={downloadTemplate}>
            <FileDown className="w-4 h-4 mr-1.5" /> 下载模板
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}{rows ? `（${rows.length} 行已就绪）` : ''}</span>}
        </div>

        <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'append' | 'replace')} className="flex gap-6">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="append" id={`${dataset}-append`} />
            <Label htmlFor={`${dataset}-append`} className="cursor-pointer">追加补数（推荐）</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="replace" id={`${dataset}-replace`} />
            <Label htmlFor={`${dataset}-replace`} className="cursor-pointer">全量替换</Label>
          </div>
        </RadioGroup>

        {mode === 'replace' && (
          <p className="text-xs text-destructive">⚠️ 全量替换会删除现有全部数据后再写入，请确认文件包含完整数据</p>
        )}

        <Button onClick={submit} disabled={!rows || submitting}>
          {submitting ? '导入中…' : '确认导入'}
        </Button>
      </CardContent>
    </Card>
  )
}
