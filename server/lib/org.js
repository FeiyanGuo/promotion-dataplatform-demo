// 组织架构索引 + 节点授权展开
// 授权模型：账号持有「中心」和「部门」两级节点授权；中心授权自动覆盖其下全部部门（子树覆盖）

export function buildOrgIndex(roster) {
  // center -> { depts: Set, count: number } ; dept -> count
  const centers = new Map()
  const deptCount = new Map()
  for (const r of roster) {
    const center = (r['中心'] || '').trim() || '未分配中心'
    const dept = r['部门']
    if (!centers.has(center)) centers.set(center, { depts: new Set(), count: 0 })
    centers.get(center).depts.add(dept)
    deptCount.set(dept, (deptCount.get(dept) || 0) + 1)
    centers.get(center).count++
  }
  return { centers, deptCount }
}

export function orgTree(roster) {
  const { centers, deptCount } = buildOrgIndex(roster)
  return {
    name: '全公司',
    count: roster.length,
    children: [...centers.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'zh'))
      .map(([center, info]) => ({
        name: center,
        count: info.count,
        children: [...info.depts]
          .sort((a, b) => a.localeCompare(b, 'zh'))
          .map((dept) => ({ name: dept, count: deptCount.get(dept) || 0, children: [] })),
      })),
  }
}

// 账号的有效部门范围 = 中心授权展开的部门 ∪ 部门授权
export function effectiveDepartments(user, roster) {
  const { centers } = buildOrgIndex(roster)
  const out = new Set()
  for (const c of user.centers || []) {
    if (centers.has(c)) for (const d of centers.get(c).depts) out.add(d)
  }
  const allDepts = new Set(roster.map((r) => r['部门']))
  for (const d of user.departments || []) {
    if (allDepts.has(d)) out.add(d)
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'zh'))
}

// 节点是否已被某账号授权（中心看 centers，部门看 effective 展开后的直接/继承覆盖）
export function nodeGranted(user, node, roster) {
  const { centers } = buildOrgIndex(roster)
  if (centers.has(node)) return (user.centers || []).includes(node)
  // 部门：中心授权继承也算覆盖
  for (const [c, info] of centers) {
    if (info.depts.has(node) && (user.centers || []).includes(c)) return true
  }
  return (user.departments || []).includes(node)
}
