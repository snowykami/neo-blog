'use client'

import type { GlobalSearchResult, SearchCommentHit, SearchPageHit } from '@/models/search'
import { ExternalLinkIcon, FileIcon, FileTextIcon, MessageSquareIcon, SearchIcon, UserIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { globalSearch } from '@/api/search'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { splitHighlight } from '@/utils/common/highlight'
import { getPageUrl, getPostUrl, getUserUrl, mainPath, withCommentAnchor } from '@/utils/common/route'

function HighlightedText({ text, terms }: { text: string, terms?: string[] }) {
  if (!terms?.length)
    return text
  return splitHighlight(text, terms).map((part, idx) => part.match
    ? <mark key={idx} className="rounded-xs bg-primary/18 text-inherit">{part.text}</mark>
    : part.text)
}

function mergeTerms(query: string, hitTerms?: string[]): string[] {
  const base = query.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  if (!hitTerms?.length)
    return base
  return Array.from(new Set([...base, ...hitTerms]))
}

function resolveCommentHref(comment: SearchCommentHit): string {
  const base = comment.targetType === 'page'
    ? getPageUrl({ id: comment.targetId, slug: comment.targetSlug })
    : getPostUrl({ post: { id: comment.targetId, slug: comment.targetSlug } })
  return withCommentAnchor(base, comment.id)
}

/**
 * 前台全站聚合搜索入口：支持实时检索公开文章、独立页面、公开评论与创作者用户（支持拼音与首字母检索），
 * 回车默认进入文章搜索结果页 /?query=关键词，支持 Ctrl/⌘ + K 快捷键唤起
 */
export function NavSearch({ className, onNavigate }: { className?: string, onNavigate?: () => void }) {
  const t = useTranslations('Search')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GlobalSearchResult | null>(null)

  useHotkeys('mod+k', (event) => {
    event.preventDefault()
    setOpen(true)
  }, { enableOnFormTags: false })

  const keyword = query.trim()

  useEffect(() => {
    if (!open || !keyword) {
      setResult(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      globalSearch({ q: keyword, limit: 5, signal: controller.signal })
        .then((res) => {
          if (!controller.signal.aborted) {
            setResult(res.data)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult(null)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false)
          }
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, keyword])

  const closeAndNavigate = (href: string, external = false) => {
    setOpen(false)
    setQuery('')
    setResult(null)
    onNavigate?.()
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(href)
  }

  const submitAllPosts = () => {
    if (!keyword)
      return
    closeAndNavigate(`${mainPath.home}?query=${encodeURIComponent(keyword)}`)
  }

  const openPageHit = (page: SearchPageHit) => {
    if (page.kind === 'link' && page.linkUrl) {
      const isExternal = /^https?:\/\//i.test(page.linkUrl)
      closeAndNavigate(page.linkUrl, isExternal)
      return
    }
    closeAndNavigate(getPageUrl(page))
  }

  const hasAnyHit = useMemo(() => {
    if (!result)
      return false
    return (
      result.posts.length > 0
      || result.pages.length > 0
      || result.comments.length > 0
      || result.users.length > 0
    )
  }, [result])

  return (
    <>
      <button
        type="button"
        aria-label={t('search')}
        title={t('search')}
        className={cn('inline-flex items-center justify-center', className)}
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden className="size-5" />
      </button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        shouldFilter={false}
        title={t('search')}
        description={t('description')}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('placeholder')}
        />
        <CommandList className="max-h-[min(70vh,440px)]">
          {keyword && (
            <>
              <CommandGroup>
                <CommandItem value={`search-posts:${keyword}`} onSelect={submitAllPosts}>
                  {loading ? <Spinner className="size-4" /> : <SearchIcon />}
                  <span className="truncate">{t('search_posts_for', { query: keyword })}</span>
                </CommandItem>
              </CommandGroup>

              {result && result.posts.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t('group_posts')}>
                    {result.posts.map((post) => {
                      const terms = mergeTerms(keyword, post.highlightTerms)
                      return (
                        <CommandItem
                          key={`post-${post.id}`}
                          value={`post-${post.id}`}
                          onSelect={() => closeAndNavigate(getPostUrl({ post }))}
                        >
                          <FileTextIcon className="mt-0.5 shrink-0 self-start text-muted-foreground" />
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">
                                <HighlightedText text={post.title} terms={terms} />
                              </span>
                              {post.categoryName && (
                                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  <HighlightedText text={post.categoryName} terms={terms} />
                                </span>
                              )}
                            </div>
                            {post.snippet && (
                              <span className="line-clamp-1 text-xs text-muted-foreground">
                                <HighlightedText text={post.snippet} terms={terms} />
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              )}

              {result && result.pages.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t('group_pages')}>
                    {result.pages.map((page) => {
                      const terms = mergeTerms(keyword, page.highlightTerms)
                      const isExternal = page.kind === 'link' && !!page.linkUrl && /^https?:\/\//i.test(page.linkUrl)
                      return (
                        <CommandItem
                          key={`page-${page.id}`}
                          value={`page-${page.id}`}
                          onSelect={() => openPageHit(page)}
                        >
                          {isExternal
                            ? <ExternalLinkIcon className="mt-0.5 shrink-0 self-start text-muted-foreground" />
                            : <FileIcon className="mt-0.5 shrink-0 self-start text-muted-foreground" />}
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <span className="truncate font-medium">
                              <HighlightedText text={page.title} terms={terms} />
                            </span>
                            {page.snippet && (
                              <span className="line-clamp-1 text-xs text-muted-foreground">
                                <HighlightedText text={page.snippet} terms={terms} />
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              )}

              {result && result.comments.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t('group_comments')}>
                    {result.comments.map((comment) => {
                      const terms = mergeTerms(keyword, comment.highlightTerms)
                      const authorName = comment.user?.nickname || comment.user?.username || ''
                      return (
                        <CommandItem
                          key={`comment-${comment.id}`}
                          value={`comment-${comment.id}`}
                          onSelect={() => closeAndNavigate(resolveCommentHref(comment))}
                        >
                          <MessageSquareIcon className="mt-0.5 shrink-0 self-start text-muted-foreground" />
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <span className="line-clamp-1 text-sm">
                              <HighlightedText text={comment.content} terms={terms} />
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {authorName
                                ? t('comment_meta_with_author', { author: authorName, title: comment.targetTitle })
                                : comment.targetTitle}
                            </span>
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              )}

              {result && result.users.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t('group_users')}>
                    {result.users.map((u) => {
                      const terms = mergeTerms(keyword, u.highlightTerms)
                      const displayName = u.nickname || u.username
                      return (
                        <CommandItem
                          key={`user-${u.id}`}
                          value={`user-${u.id}`}
                          onSelect={() => closeAndNavigate(getUserUrl(u))}
                        >
                          <Avatar className="size-5 shrink-0">
                            {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt={displayName} />}
                            <AvatarFallback className="text-[10px]">
                              <UserIcon className="size-3" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-1 items-baseline gap-2">
                            <span className="truncate font-medium">
                              <HighlightedText text={displayName} terms={terms} />
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              @
                              <HighlightedText text={u.username} terms={terms} />
                            </span>
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              )}

              {!loading && result && !hasAnyHit && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('no_results')}</p>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
