import { connection } from 'next/server'
import { I18nScope } from '@/components/i18n-scope'
import { ConsoleShell } from './console-shell'

// 后台地址不带语言前缀，界面语言由 proxy.ts 按偏好改写进 [locale] 段；页面主体都在浏览器里取数，
// 后台按请求渲染（connection()），与改前的 force-dynamic 相同：带 [id] 的后台页面（编辑器、详情页）的 id 是任意的，
// 不能按地址缓存；不按请求渲染时，Next 用「id 未知」的外壳渲染，读地址的客户端组件（侧栏、编辑器的 useParams）没法在服务端渲染，页面直接报错（500）。
// 允许阻塞（instant = false）：进入后台时等服务端渲染完再切换，不做即时导航校验
export const instant = false

export default async function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  await connection()
  return (
    <I18nScope scope="console">
      <ConsoleShell>{children}</ConsoleShell>
    </I18nScope>
  )
}
