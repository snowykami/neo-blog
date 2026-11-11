import { notFound } from 'next/navigation'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'

// 构建期只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM）。没有它的话 Next 用「地址未知」的外壳渲染这个路由，
// 根布局里读 usePathname 的客户端组件没法在服务端渲染，页面报错（500）而不是 404。404 页面不缓存（见 web/cache-handler.mjs）
export function generateStaticParams() {
  return [{ rest: [BUILD_PLACEHOLDER_PARAM] }]
}

// 404 页面没有可以校验的即时导航（notFound() 让页面本身不渲染），开发时不做校验
export const instant = false

// 未匹配的前台地址：根布局在 [locale] 段下，Next 不会自动给它渲染 not-found，这里兜住，按当前语言显示带站点外壳的 404
export default function CatchAllNotFound() {
  notFound()
}
