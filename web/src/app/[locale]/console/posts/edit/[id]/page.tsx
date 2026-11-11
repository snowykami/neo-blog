import { getTranslations } from 'next-intl/server'
import { getPostForEditServer } from '@/api/post.server'
import { PostEditor } from './post-editor'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const consoleT = await getTranslations('Console')
  const { id } = await params
  const post = await getPostForEditServer({ id })
    .then(r => r.data)
    .catch(() => null)
  return {
    title: `${consoleT('post_edit.title')} ${post?.title}`,
  }
}

export default function EditPostPage() {
  return <PostEditor />
}
