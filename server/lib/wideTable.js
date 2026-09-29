// 晋升宽表生成：长表(工号×多条晋升记录) → 宽表(每人一行 × 每年 是否晋升/晋升时间)
// 年份归属规则：按「晋升生效时间」的自然年归集；同年多条取最早生效的一条。

export function getYearRange(promotions) {
  const years = promotions.map((p) => Number(String(p['晋升生效时间']).slice(0, 4)))
  return { minYear: Math.min(...years), maxYear: Math.max(...years) }
}

export function buildWideTable({ promotions, roster, startYear, endYear, departments }) {
  // 权限在服务端强制执行：只保留用户可见部门内的人员
  const scopedRoster = roster.filter((r) => departments.includes(r['部门']))

  // 归集：工号 -> 年份 -> 晋升记录（同年多条取最早生效）
  const byEmpYear = new Map()
  for (const p of promotions) {
    const year = Number(String(p['晋升生效时间']).slice(0, 4))
    if (year < startYear || year > endYear) continue
    const key = p['工号']
    if (!byEmpYear.has(key)) byEmpYear.set(key, new Map())
    const yearMap = byEmpYear.get(key)
    if (!yearMap.has(year) || p['晋升生效时间'] < yearMap.get(year)['晋升生效时间']) {
      yearMap.set(year, p)
    }
  }

  const years = []
  for (let y = startYear; y <= endYear; y++) years.push(y)

  const rows = scopedRoster.map((r) => {
    const row = {
      工号: r['工号'],
      姓名: r['姓名'],
      中心: r['中心'] || '',
      部门: r['部门'],
      当前职级: r['职级'],
      入职时间: r['入职时间'],
    }
    let count = 0
    let firstDate = ''
    let lastDate = ''
    let lastLevel = ''
    for (const y of years) {
      const rec = byEmpYear.get(r['工号'])?.get(y)
      row[`${y}年是否晋升`] = rec ? '是' : '否'
      row[`${y}年晋升时间`] = rec ? rec['晋升生效时间'] : ''
      if (rec) {
        count++
        if (!firstDate || rec['晋升生效时间'] < firstDate) firstDate = rec['晋升生效时间']
        if (!lastDate || rec['晋升生效时间'] > lastDate) {
          lastDate = rec['晋升生效时间']
          lastLevel = rec['晋升后职级']
        }
      }
    }
    row['累计晋升次数'] = String(count)
    row['首次晋升时间'] = firstDate
    row['最近晋升时间'] = lastDate
    row['最近晋升后职级'] = lastLevel
    return row
  })

  const columns = ['工号', '姓名', '中心', '部门', '当前职级', '入职时间',
    ...years.flatMap((y) => [`${y}年是否晋升`, `${y}年晋升时间`]),
    '累计晋升次数', '首次晋升时间', '最近晋升时间', '最近晋升后职级']

  return { columns, rows, years }
}
