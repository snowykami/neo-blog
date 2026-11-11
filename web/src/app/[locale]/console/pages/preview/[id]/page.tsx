import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPageForEditServer } from '@/api/page.server'
import { MainShell } from '@/app/[locale]/(main)/main-shell'
import { PageView } from '@/app/[locale]/(main)/page/[id]/page-view'
import { isNotFoundLikeError } from '@/utils/common/error'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

/*
 * 后台的页面预览：按前台页面的样子渲染草稿与私密页面，仅作者本人与管理员（由后端接口判定）。
 * 私密页面与草稿不在前台出现，编辑器的「预览」与页面管理的「查看」（私密页面）都打开这里
 */

// 同一次渲染内元信息与页面共用一次请求
const getCachedDraft = cache(async (id: string) => {
  return getPageForEditServer({ id })
    .then(res => res.data)
    .catch((error) => {
      // 不存在 / 无权查看时显示 404，其余错误交给错误边界
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const [page, operationT] = await Promise.all([getCachedDraft(id), getTranslations('Operation')])
  return {
    title: page ? `${operationT('preview')} ${page.title}` : operationT('preview'),
    robots: { index: false, follow: false },
  }
}

export default async function PagePreviewPage({ params }: Props) {
  const { id } = await params
  const page = await getCachedDraft(id)
  if (!page)
    notFound()
  return (
    <MainShell reportVisits={false}>
      <PageView page={page} isDraft />
    </MainShell>
  )
}
