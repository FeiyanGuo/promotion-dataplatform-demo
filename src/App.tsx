import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TrendingUp, LogOut, LayoutDashboard, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Meta, type User } from '@/lib/api'
import Login from '@/pages/Login'
import QueryPage from '@/pages/QueryPage'
import AdminPage from '@/pages/AdminPage'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<'query' | 'admin'>('query')

  useEffect(() => {
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (user) api.meta().then(setMeta).catch(() => {})
  }, [user])

  async function handleLogout() {
    await api.logout().catch(() => {})
    setUser(null)
    setMeta(null)
    toast.success('已退出登录')
  }

  if (checking) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">加载中…</div>

  if (!user) {
    return (
      <>
        <Login onLogin={(u) => { setUser(u); toast.success(`欢迎，${u.name}`) }} />
        <Toaster richColors position="top-center" />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="font-semibold">晋升数据中台</span>
            <nav className="ml-6 flex items-center gap-1 text-sm">
              <Button variant={tab === 'query' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('query')}>
                <LayoutDashboard className="w-4 h-4 mr-1" /> 查询下载
              </Button>
              {user.role === 'admin' && (
                <Button variant={tab === 'admin' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('admin')}>
                  <ShieldCheck className="w-4 h-4 mr-1" /> 管理后台
                </Button>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-xs text-muted-foreground leading-tight">{user.role === 'admin' ? '总部OD · 管理员（白名单）' : 'HRBP'}</div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1" /> 退出
            </Button>
          </div>
        </div>
      </header>

      {tab === 'query' ? <QueryPage /> : <AdminPage meta={meta} onDataChanged={() => api.meta().then(setMeta).catch(() => {})} />}

      <footer className="max-w-7xl mx-auto px-6 py-6 text-xs text-muted-foreground">
        {import.meta.env.MODE === 'demo'
          ? '演示模式 · 所有数据仅保存在你的浏览器内存中，不会上传到任何服务器，刷新页面即还原'
          : '原型环境 · 请勿导入真实生产数据 · 所有查询与导出行径均记入审计日志'}
      </footer>
      <Toaster richColors position="top-center" />
    </div>
  )
}
