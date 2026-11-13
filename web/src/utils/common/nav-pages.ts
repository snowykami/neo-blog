import type { PageModel } from '@/models/page'

/** 导航中展示的自定义页面：只取公开且勾选了「导航展示」的页面，按导航排序升序（服务端预取与浏览器刷新共用） */
export function toNavPages(pages: PageModel[] | undefined | null): PageModel[] {
  return (pages || [])
    .filter(page => page.showInNav && !page.isPrivate)
    .sort((a, b) => a.navOrder - b.navOrder || a.id - b.id)
}

/** 导航页面的请求参数：服务端与浏览器一致 */
export const NAV_PAGES_QUERY = { onlyNav: true, noContent: true, page: 1, size: 50 } as const
