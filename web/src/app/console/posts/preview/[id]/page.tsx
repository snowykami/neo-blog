import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPostForEditServer } from '@/api/post.server'
import { MainShell } from '@/app/(main)/main-shell'
import { BlogPost } from '@/app/(main)/p/[id]/blog-post'
import { isNotFoundLikeError } from '@/utils/common/error'

/*
 * 后台的文章预览：按前台文章页的样子渲染草稿与私密文章，仅作者本人与管理员（由后端接口判定）。
 * 私密文章与草稿不在前台出现，编辑器的「预览」与文章管理的「查看」（私密文章）都打开这里
 */

// 同一次渲染内元信息与页面共用一次请求
const getCachedDraft = cache(async (id: string) => {
  return getPostForEditServer({ id })
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
  const [post, operationT] = await Promise.all([getCachedDraft(id), getTranslations('Operation')])
  return {
    title: post ? `${operationT('preview')} ${post.title}` : operationT('preview'),
    robots: { index: false, follow: false },
  }
}

export default async function PostPreviewPage({ params }: Props) {
  const { id } = await params
  const post = await getCachedDraft(id)
  if (!post)
    notFound()
  return (
    <MainShell reportVisits={false}>
      <div className="flex flex-col h-100vh">
        <BlogPost post={post} isDraft />
      </div>
    </MainShell>
  )
}
