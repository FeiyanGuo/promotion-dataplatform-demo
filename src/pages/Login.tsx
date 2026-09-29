import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'

export default function Login({ onLogin }: { onLogin: (user: any) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { user } = await api.login(username.trim(), password)
      onLogin(user)
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">晋升数据中台</h1>
          <p className="text-sm text-muted-foreground">按权限自助查询、下载晋升宽表 · 原型 v0.1</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">登录</CardTitle>
            <CardDescription>使用平台账号登录，数据范围由账号权限决定</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">账号</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="工号或账号" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? '登录中…' : '登录'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
            <p className="flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="w-3.5 h-3.5" /> 演示账号（密码见部署说明）</p>
            <p>admin —— 总部OD，可见全部 8 个部门</p>
            <p>bp_wang —— HRBP，可见 技术部 / 产品部</p>
            <p>bp_chen —— HRBP，可见 销售部 / 市场部</p>
            <p>bp_liu —— HRBP，可见 人事部 / 财务部 / 法务部 / 运营部</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
