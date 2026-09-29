import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Users, FileSpreadsheet, Search, SlidersHorizontal, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import { api, exportExcel, type Filters, type Meta, type QueryResult } from '@/lib/api'

// 数字感知比较：两值都是数字按数值排，否则按中文排序
function compareCells(a: string, b: string): number {
  const sa = String(a ?? '').trim(); const sb = String(b ?? '').trim()
  if (sa !== '' && sb !== '' && !isNaN(Number(sa)) && !isNaN(Number(sb))) return Number(sa) - Number(sb)
  return sa.localeCompare(sb, 'zh')
}

export default function QueryPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)

  // 筛选状态（全部 AND 关系）
  const [showFilters, setShowFilters] = useState(true)
  const [search, setSearch] = useState('')
  const [fDepts, setFDepts] = useState<string[]>([])
  const [lvMin, setLvMin] = useState('')
  const [lvMax, setLvMax] = useState('')
  const [yearFilter, setYearFilter] = useState<Record<string, '是' | '否' | ''>>({})
  const [exportAll, setExportAll] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 排序状态
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '工号', dir: 'asc' })

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => toast.error(e.message))
  }, [])

  async function runQuery() {
    if (!meta) return
    setLoading(true)
    try {
      // 永远展示全量年份
      const r = await api.query({ startYear: meta.minYear, endYear: meta.maxYear })
      setResult(r)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 进入页面自动加载全范围数据
  useEffect(() => {
    if (meta && !result) runQuery()
  }, [meta])

  const years = useMemo(() => result?.years || [], [result])

  const levels = useMemo(() => {
    if (!result) return []
    return [...new Set(result.rows.map((r) => Number(r['当前职级'])))].sort((a, b) => a - b)
  }, [result])

  // 部门筛选树：从已加载数据中提取 中心 → 部门（均在权限范围内）
  const { deptTree, allDepts } = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of result?.rows || []) {
      const center = r['中心'] || '未分配中心'
      const dept = r['部门']
      if (!m.has(center)) m.set(center, [])
      if (!m.get(center)!.includes(dept)) m.get(center)!.push(dept)
    }
    const tree = [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'zh'))
      .map(([c, ds]) => [c, [...ds].sort((a, b) => a.localeCompare(b, 'zh'))] as [string, string[]])
    return { deptTree: tree, allDepts: tree.flatMap(([, ds]) => ds) }
  }, [result])

  const filters: Filters = useMemo(() => ({
    search,
    departments: fDepts,
    levelMin: lvMin,
    levelMax: lvMax,
    yearFilters: Object.fromEntries(Object.entries(yearFilter).filter(([, v]) => v)),
  }), [search, fDepts, lvMin, lvMax, yearFilter])

  const filtered = useMemo(() => {
    if (!result) return []
    const s = search.trim().toLowerCase()
    return result.rows.filter((r) => {
      if (s && !r['姓名'].toLowerCase().includes(s) && !r['工号'].toLowerCase().includes(s)) return false
      if (fDepts.length && !fDepts.includes(r['部门'])) return false
      if (lvMin !== '' && Number(r['当前职级']) < Number(lvMin)) return false
      if (lvMax !== '' && Number(r['当前职级']) > Number(lvMax)) return false
      for (const [y, v] of Object.entries(yearFilter)) {
        if (v && r[`${y}年是否晋升`] !== v) return false
      }
      return true
    })
  }, [result, search, fDepts, lvMin, lvMax, yearFilter])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => compareCells(a[sort.key], b[sort.key]) * dir)
  }, [filtered, sort])

  function toggleSort(key: string) {
    setSort((p) => p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  function resetFilters() {
    setSearch(''); setFDepts([]); setLvMin(''); setLvMax('')
    setYearFilter({})
  }

  const activeFilterCount =
    (search ? 1 : 0) + (fDepts.length ? 1 : 0) + ((lvMin || lvMax) ? 1 : 0) +
    Object.values(yearFilter).filter(Boolean).length

  async function download() {
    if (!meta) return
    setExporting(true)
    try {
      const blob = await exportExcel({ startYear: meta.minYear, endYear: meta.maxYear, all: exportAll, filters })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `晋升数据表${exportAll ? '_全量' : '_筛选'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(exportAll ? '全量导出完成' : `已导出当前筛选结果（${filtered.length} 人）`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExporting(false)
    }
  }

  if (!meta) return <div className="p-8 text-muted-foreground">加载中…</div>

  const promotedCount = filtered.filter((r) => Number(r['累计晋升次数']) > 0).length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">我可见的人员</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{meta.rosterCount}</div>
            <p className="text-xs text-muted-foreground mt-1">花名册截止 {meta.rosterCutoff}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">权限内晋升记录</CardTitle>
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{meta.promoRecordCount}</div>
            <p className="text-xs text-muted-foreground mt-1">仅限我的部门范围 · {meta.minYear}–{meta.maxYear} 年</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">晋升数据表</CardTitle>
              <CardDescription>已自动加载你权限范围内的全部数据（{meta.minYear}–{meta.maxYear} 年），可用下方筛选栏过滤，点表头排序</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal className="w-4 h-4 mr-1.5" />
              筛选{activeFilterCount ? `（${activeFilterCount}）` : ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showFilters && (
            <div className="rounded-lg border bg-slate-50/50 p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="搜索姓名或工号…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9">
                      部门{fDepts.length ? `（已选 ${fDepts.length}）` : '（全部）'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3" align="start">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">按中心/部门筛选</span>
                      <div className="flex gap-2 text-xs">
                        <button className="text-primary hover:underline" onClick={() => setFDepts(allDepts)}>全选</button>
                        <button className="text-muted-foreground hover:underline" onClick={() => setFDepts([])}>清空</button>
                      </div>
                    </div>
                    <div className="space-y-1 max-h-72 overflow-auto">
                      {deptTree.map(([center, depts]) => {
                        const selectedCount = depts.filter((d) => fDepts.includes(d)).length
                        const centerState = selectedCount === 0 ? false : selectedCount === depts.length ? true : 'indeterminate'
                        return (
                          <div key={center}>
                            <div className="flex items-center gap-2 py-1">
                              <Checkbox
                                id={`fc-${center}`}
                                checked={centerState}
                                onCheckedChange={() => setFDepts((p) => centerState === true ? p.filter((d) => !depts.includes(d)) : [...new Set([...p, ...depts])])}
                              />
                              <label htmlFor={`fc-${center}`} className="text-sm font-medium cursor-pointer">{center}</label>
                            </div>
                            <div className="pl-6 space-y-1">
                              {depts.map((d) => (
                                <div key={d} className="flex items-center gap-2">
                                  <Checkbox id={`f-${d}`} checked={fDepts.includes(d)} onCheckedChange={() => setFDepts((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d])} />
                                  <label htmlFor={`f-${d}`} className="text-sm cursor-pointer">{d}</label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex items-center gap-1.5 text-sm">
                  <Label className="text-muted-foreground whitespace-nowrap">职级</Label>
                  <select className="h-9 rounded-md border border-input bg-background px-2" value={lvMin} onChange={(e) => setLvMin(e.target.value)}>
                    <option value="">不限</option>
                    {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span className="text-muted-foreground">–</span>
                  <select className="h-9 rounded-md border border-input bg-background px-2" value={lvMax} onChange={(e) => setLvMax(e.target.value)}>
                    <option value="">不限</option>
                    {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> 清空筛选
                  </Button>
                )}
              </div>

              {years.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">逐年筛选：</span>
                  {years.map((y) => (
                    <div key={y} className="flex items-center gap-1.5 text-sm">
                      <Label className="text-muted-foreground whitespace-nowrap">{y}年</Label>
                      <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={yearFilter[y] || ''} onChange={(e) => setYearFilter((p) => ({ ...p, [y]: e.target.value as '是' | '否' | '' }))}>
                        <option value="">全部</option>
                        <option value="是">晋升</option>
                        <option value="否">未晋升</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {loading ? '加载中…' : `显示 ${sorted.length} / ${result?.rows.length ?? 0} 人，其中 ${promotedCount} 人有晋升记录`}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Switch id="export-all" checked={exportAll} onCheckedChange={(v) => setExportAll(!!v)} />
                <Label htmlFor="export-all" className="text-muted-foreground cursor-pointer">导出全量</Label>
              </div>
              <Button onClick={download} disabled={exporting || !result}>
                <Download className="w-4 h-4 mr-1.5" /> {exporting ? '导出中…' : '下载 Excel'}
              </Button>
            </div>
          </div>

          {result && (
            <div className="overflow-auto max-h-[560px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    {result.columns.map((c) => (
                      <TableHead key={c} className="whitespace-nowrap text-xs cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort(c)}>
                        <span className="inline-flex items-center gap-1">
                          {c}
                          {sort.key === c && (sort.dir === 'asc'
                            ? <ArrowUp className="w-3 h-3" />
                            : <ArrowDown className="w-3 h-3" />)}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => (
                    <TableRow key={row['工号']}>
                      {result.columns.map((c) => (
                        <TableCell key={c} className="whitespace-nowrap text-xs">
                          {c.includes('是否晋升')
                            ? <Badge variant={row[c] === '是' ? 'default' : 'outline'} className="text-xs">{row[c]}</Badge>
                            : row[c]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {!sorted.length && (
                    <TableRow><TableCell colSpan={result.columns.length} className="text-center text-muted-foreground py-8">没有符合筛选条件的数据</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
