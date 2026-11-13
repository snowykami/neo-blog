'use client'

import type { PageModel } from '@/models/page'
import { createContext, use } from 'react'

/** 布局服务端预取的导航页面（见 api/nav-pages.server.ts）；undefined 表示没有预取，顶栏挂载后自己请求 */
const NavPagesContext = createContext<PageModel[] | undefined>(undefined)

export function NavPagesProvider({ pages, children }: { pages?: PageModel[], children: React.ReactNode }) {
  return <NavPagesContext value={pages}>{children}</NavPagesContext>
}

export function useInitialNavPages() {
  return use(NavPagesContext)
}
