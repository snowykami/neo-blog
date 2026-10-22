'use client'

import type { Post } from '@/models/post'
import { PencilLineIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { isAdmin } from '@/utils/common/permission'
import { getPostEditUrl } from '@/utils/common/route'

/**
 * 文章快捷编辑入口：仅作者本人或管理员可见（后端编辑接口仍会校验权限）
 */
export function PostEditButton({ post }: { post: Post }) {
  const { user } = useAuth()
  const operationT = useOperationT()
  if (!user || !(user.id === post.user.id || isAdmin({ user })))
    return null
  return (
    <Button asChild variant="ghost" size="icon" className="shrink-0 text-foreground/50 hover:text-primary" aria-label={operationT('edit')} title={operationT('edit')}>
      <Link href={getPostEditUrl(post)}>
        <PencilLineIcon aria-hidden />
      </Link>
    </Button>
  )
}
