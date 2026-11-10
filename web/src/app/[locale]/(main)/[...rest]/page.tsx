import { notFound } from 'next/navigation'

// 未匹配的前台地址：根布局在 [locale] 段下，Next 不会自动给它渲染 not-found，这里兜住，按当前语言显示带站点外壳的 404
export default function CatchAllNotFound() {
  notFound()
}
