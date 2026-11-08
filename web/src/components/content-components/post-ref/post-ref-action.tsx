'use client'

import type { ContentEditorActionProps } from '../types'
import type { PostRefInput } from './schema'
import type { Post } from '@/models/post'
import { CheckIcon, SearchIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { listPosts } from '@/api/post'
import { UserAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { isComposingKey } from '@/lib/ime'
import { cn } from '@/lib/utils'

type Status = { type: 'idle' } | { type: 'busy' } | { type: 'message', key: 'no_results' | 'failed', error?: boolean }

/**
 * 文章引用的「选择文章」：按标题搜索站内文章，点击一条把文章 id 写回表单
 * 搜索走公开的文章列表接口，因此只能选到当前用户能看到的文章（访客与普通用户只看公开文章，管理员不受限）
 */
export default function PostRefAction({ values, setValues }: ContentEditorActionProps<PostRefInput>) {
  const t = useTranslations('ContentComponents.postRef.action')
  const commonT = useTranslations()
  const format = useFormatter()
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const busy = status.type === 'busy'
  const selected = Number(values.postId) || 0

  const search = async () => {
    const keywords = query.trim()
    if (!keywords || busy)
      return
    setStatus({ type: 'busy' })
    try {
      const { data } = await listPosts({ query: keywords, noContent: true, size: 5 })
      setPosts(data.posts)
      setStatus(data.posts.length ? { type: 'idle' } : { type: 'message', key: 'no_results' })
    }
    catch {
      setStatus({ type: 'message', key: 'failed', error: true })
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">{t('title')}</span>
        <span className="text-xs text-muted-foreground">{t('hint')}</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          maxLength={50}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 回车搜索，不提交属性表单
            if (e.key === 'Enter' && !isComposingKey(e)) {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={busy || !query.trim()} onClick={() => void search()}>
          {busy ? <Spinner /> : <SearchIcon />}
          {t('search')}
        </Button>
      </div>
      {posts && posts.length > 0 && (
        <ul className="grid max-h-64 gap-1 overflow-y-auto" aria-label={t('results')}>
          {posts.map((post) => {
            const isSelected = selected === post.id
            return (
              <li key={post.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-primary/10 hover:bg-primary/10',
                  )}
                  onClick={() => setValues({ postId: post.id })}
                >
                  <UserAvatar user={post.user} size={40} className="size-8 shrink-0" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{post.title || t('untitled')}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[
                        post.user?.nickname || post.user?.username || commonT('Common.unknown_author'),
                        format.dateTime(new Date(post.createdAt), { year: 'numeric', month: '2-digit', day: '2-digit' }),
                      ].join(' · ')}
                    </span>
                  </span>
                  {isSelected && <CheckIcon className="size-4 shrink-0 text-primary" aria-label={t('selected')} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected > 0 && (
        <p className="text-xs text-muted-foreground">{t('current', { id: selected })}</p>
      )}
      {status.type === 'message' && (
        <p className={status.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{t(status.key)}</p>
      )}
    </div>
  )
}
