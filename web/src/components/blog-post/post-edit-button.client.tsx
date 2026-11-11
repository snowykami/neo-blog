'use client'

import type { Post } from '@/models/post'
import { PencilLineIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { isAdmin } from '@/utils/common/permission'
import { getPostEditUrl } from '@/utils/common/route'

/**
 * 文章快捷编辑入口：仅作者本人或管理员可见（后端编辑接口仍会校验权限）
 */
export function PostEditButton({ post }: { post: Pick<Post, 'id' | 'slug' | 'user'> }) {
  const { user } = useAuth()
  const operationT = useOperationT()
  if (!user || !(user.id === post.user.id || isAdmin({ user })))
    return null
  return (
    <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary" aria-label={operationT('edit')} title={operationT('edit')}>
      <Link href={getPostEditUrl(post)}>
        <PencilLineIcon aria-hidden />
      </Link>
    </Button>
  )
}
