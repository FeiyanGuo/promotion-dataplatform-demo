// 宽表行筛选：部门多选、职级区间、逐年是否晋升、姓名/工号搜索，全部 AND 关系
export function applyFilters(rows, filters = {}) {
  const { search, departments, levelMin, levelMax, yearFilters } = filters
  const s = (search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (s) {
      const name = String(r['姓名'] || '').toLowerCase()
      const id = String(r['工号'] || '').toLowerCase()
      if (!name.includes(s) && !id.includes(s)) return false
    }
    if (Array.isArray(departments) && departments.length && !departments.includes(r['部门'])) return false
    if (levelMin !== '' && levelMin != null && Number(r['当前职级']) < Number(levelMin)) return false
    if (levelMax !== '' && levelMax != null && Number(r['当前职级']) > Number(levelMax)) return false
    for (const [y, v] of Object.entries(yearFilters || {})) {
      if (v && r[`${y}年是否晋升`] !== v) return false
    }
    return true
  })
}
