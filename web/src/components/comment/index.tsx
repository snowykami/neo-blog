'use client'
import type { CommentSubmitPayload } from './comment-input'
import type { ActiveInput } from './comment-item'
import type { Comment } from '@/models/comment'
import type { UserBrief } from '@/models/user'
import { Loader2, MessageCircleHeartIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createComment, deleteComment, getComment, listComments } from '@/api/comment'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { usePostStats } from '@/hooks/use-post-stats'
import { useErrorMessageT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { TargetType } from '@/models/types'
import { OrderSelector } from '../common/orderby-selector'
import { SectionTitle } from '../layout/site-shell'
import { CommentInput } from './comment-input'
import { CommentItem } from './comment-item'
import './style.css'

export function CommentSection({
  targetType,
  targetId,
  totalCount = 0,
  ownerId,
  owner,
}: {
  targetType: TargetType
  targetId: number
  totalCount?: number
  ownerId?: number
  owner?: UserBrief
}) {
  const { siteInfo } = useSiteInfo()
  const t = useTranslations('Comment')
  const errorMessageT = useErrorMessageT()
  const pageSize = siteInfo.commentsPerPage || 8
  const [comments, setComments] = useState<Comment[]>([])
  const [activeInput, setActiveInput] = useState<ActiveInput>(null)
  const [page, setPage] = useState(1) // 当前页码
  const [totalCommentCount, setTotalCommentCount] = useState(totalCount) // 评论总数
  // 文章页按 ISR 缓存，传进来的总数是快照：换成浏览器另取的最新值（与统计行共用一次请求，见 hooks/use-post-stats.ts）
  const liveCommentCount = usePostStats(targetType === TargetType.Post ? targetId : 0)?.commentCount
  useEffect(() => {
    if (liveCommentCount !== undefined)
      setTotalCommentCount(liveCommentCount)
  }, [liveCommentCount])
  const [needLoadMore, setNeedLoadMore] = useState(false) // 是否需要加载更多，当最后一次获取的评论数小于分页大小时设为false
  const [orderBy, setOrderBy] = useState<OrderBy>(OrderBy.CreatedAt) // 排序字段，默认按创建时间
  const [desc, setDesc] = useState(true) // 是否降序，默认降序
  const [initialLoading, setInitialLoading] = useState(true) // 首屏加载中
  const [loadingMore, setLoadingMore] = useState(false) // 加载更多中
  const [translatable, setTranslatable] = useState(false) // 后端已配置 AI 时可翻译评论
  // 通知深链：?comment=<id> 定位到那条评论所在的线程，展开并高亮
  const [focus, setFocus] = useState<{ rootId: number, commentId: number } | null>(null)
  // 请求序号：排序或目标变化后，丢弃过期请求的结果
  const requestSeqRef = useRef(0)
  // 上次加载后本地删除的顶层评论数，非 0 时下一页的 offset 会错位
  const localDeletedRef = useRef(0)
  // 深链定位的线程根：它可能不在已加载的页里，列表（首屏、重新拉取）晚到时要合并进去，不能被覆盖掉
  const pinnedRootRef = useRef<Comment | null>(null)
  // 深链里的评论 id：读到后立即从地址里去掉 ?comment=（之后刷新、分享、返回都不再重复定位），以这里记的为准
  const deepLinkRef = useRef<{ target: string, commentId: number } | null>(null)
  // 已经解析过的深链（含身份）：Activity 重新显示时不重复请求、不重复定位
  const resolvedLinkRef = useRef<string | null>(null)
  // 已加载列表对应的条件（目标、排序、身份），以及已加载到第几页：Activity 重新显示时条件没变，就保留已加载的内容只在后台刷新
  const loadedKeyRef = useRef<string | null>(null)
  const pageRef = useRef(1)
  pageRef.current = page

  // 登出或换账号：上一个账号能看到的私密评论、点赞状态、展开的回复都要清掉，按新身份重新拉取。
  // 渲染期间就清空并换掉列表的 key（重新挂载每条评论），不让旧内容再画一帧。
  // epoch 为登出 / 换账号的次数；访客登录不加：访客能看到的登录后都能看到，快捷登录后紧接着的评论、回复也不能被重拉打断
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [viewer, setViewer] = useState({ userId, epoch: 0 })
  if (viewer.userId !== userId) {
    const reset = viewer.userId !== null
    setViewer({ userId, epoch: reset ? viewer.epoch + 1 : viewer.epoch })
    if (reset) {
      setComments([])
      setFocus(null)
      setActiveInput(null)
      setInitialLoading(true)
      // 上一个账号看到的线程根（可能是私密评论）不能留到新身份下，深链按新身份重新解析
      pinnedRootRef.current = null
    }
  }
  const viewerEpoch = viewer.epoch

  // 加载顶层评论。条件（目标、排序、身份）变化时从第一页重新加载并显示骨架；
  // 条件没变（Activity 隐藏后重新显示，effect 会重跑）时保留已加载的各页，在后台一次取回同样多的条数替换，页面高度不跳
  useEffect(() => {
    const key = JSON.stringify([targetType, targetId, pageSize, orderBy, desc, viewerEpoch])
    const seq = ++requestSeqRef.current
    const background = loadedKeyRef.current === key
    const pages = background ? pageRef.current : 1
    setLoadingMore(false)
    if (!background) {
      setPage(1)
      setNeedLoadMore(false)
      setInitialLoading(true)
      localDeletedRef.current = 0
    }

    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: 1,
      size: pageSize * pages,
      commentId: 0,
    }).then((response) => {
      if (seq !== requestSeqRef.current)
        return
      const list: Comment[] = response.data.comments || []
      loadedKeyRef.current = key
      // 一次取回了从第一页到当前页的全部，本地删除造成的 offset 错位随之消除
      localDeletedRef.current = 0
      setComments(withPinnedRoot(list, pinnedRootRef.current))
      setTranslatable(Boolean(response.data.translatable))
      // 取回的条数少于请求的条数时，没有更多了
      setNeedLoadMore(list.length >= pageSize * pages)
    }).catch((error) => {
      // 后台刷新失败时保留已有内容，不打扰读者
      if (seq !== requestSeqRef.current || background)
        return
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    }).finally(() => {
      if (seq === requestSeqRef.current)
        setInitialLoading(false)
    })
  }, [targetId, targetType, pageSize, orderBy, desc, t, viewerEpoch])

  const onCommentSubmitted = async ({
    commentContent,
    attachments,
    mentionUserIds,
    isPrivate,
    showClientInfo,
  }: CommentSubmitPayload) => {
    try {
      const res = await createComment({
        targetType,
        targetId,
        content: commentContent,
        attachmentIds: attachments.map(attachment => attachment.id),
        mentionUserIds,
        replyId: null,
        isPrivate,
        showClientInfo,
      })
      notifySuccess(t('comment_success'), { key: 'comment', icon: <MessageCircleHeartIcon aria-hidden className="text-sky-400" /> })
      setTotalCommentCount(c => c + 1)
      setActiveInput(null)
      getComment({ id: res.data.id }).then((response) => {
        // 按 id 去重，避免与后续“加载更多”的结果重复
        setComments(prevComments => [response.data, ...prevComments.filter(c => c.id !== response.data.id)])
      }).catch(() => {})
    }
    catch (error) {
      toast.error(`${t('comment_failed')}: ${errorMessageT(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
  }

  const onCountChange = (delta: number) => {
    setTotalCommentCount(c => Math.max(0, c + delta))
  }

  // 失败时抛出，由删除确认气泡统一提示并保持打开；主评论下的回复会一并删除
  const onCommentDelete = async ({ commentId }: { commentId: number }) => {
    await deleteComment({ id: commentId })
    toast.success(t('delete_success'))
    const removed = comments.find(comment => comment.id === commentId)
    if (pinnedRootRef.current?.id === commentId)
      pinnedRootRef.current = null
    setComments(prevComments => prevComments.filter(comment => comment.id !== commentId))
    onCountChange(-1 - (removed?.threadCount ?? 0))
    localDeletedRef.current += 1
  }

  // 读取 ?comment= 深链：先查这条评论在哪个线程，再把线程根补进列表（它可能还没被翻到）。
  // 参数读到后立即从地址里去掉，定位只做一次：之后加载更多、展开别的线程、收起目标线程都不会被拉回
  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const targetKey = `${targetType}:${targetId}`
    const fromUrl = takeCommentParam()
    if (fromUrl > 0)
      deepLinkRef.current = { target: targetKey, commentId: fromUrl }
    const commentId = deepLinkRef.current?.target === targetKey ? deepLinkRef.current.commentId : 0
    if (commentId <= 0) {
      pinnedRootRef.current = null
      resolvedLinkRef.current = null
      setFocus(null)
      return
    }
    const resolveKey = `${targetKey}:${commentId}:${viewerEpoch}`
    if (resolvedLinkRef.current === resolveKey)
      return
    pinnedRootRef.current = null
    let cancelled = false
    getComment({ id: commentId }).then(async (response) => {
      if (cancelled)
        return
      const target = response.data
      // 只定位本页目标下的评论：手改 ?comment= 不能把别的文章的线程插进来
      if (target.targetType !== targetType || target.targetId !== targetId) {
        resolvedLinkRef.current = resolveKey
        setFocus(null)
        return
      }
      const rootId = target.rootId || target.id
      setFocus({ rootId, commentId: target.id })
      const root = rootId === target.id ? target : (await getComment({ id: rootId })).data
      if (cancelled || root.targetType !== targetType || root.targetId !== targetId)
        return
      resolvedLinkRef.current = resolveKey
      pinnedRootRef.current = root
      setComments(prev => withPinnedRoot(prev, root))
    }).catch(() => {
      // 评论可能已被删除：不打断页面，只是没有可定位的目标
      if (!cancelled) {
        resolvedLinkRef.current = resolveKey
        setFocus(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [targetId, targetType, viewerEpoch])

  const handleLoadMore = () => {
    if (loadingMore || initialLoading)
      return
    const seq = requestSeqRef.current
    const nextPage = page + 1
    // 有本地删除时 offset 已错位，改为从第一页重新拉取到下一页，保证不漏评论
    const refetchAll = localDeletedRef.current > 0
    setLoadingMore(true)
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: refetchAll ? 1 : nextPage,
      size: refetchAll ? pageSize * nextPage : pageSize,
      commentId: 0,
    }).then((response) => {
      if (seq !== requestSeqRef.current)
        return
      const list: Comment[] = response.data.comments || []
      setNeedLoadMore(list.length >= (refetchAll ? pageSize * nextPage : pageSize))
      if (refetchAll) {
        localDeletedRef.current = 0
        // 服务端结果已包含本地新增的评论，直接替换（深链定位的线程根不在其中时仍保留）
        setComments(withPinnedRoot(list, pinnedRootRef.current))
      }
      else {
        // 按 id 去重：本地新增评论会让后续页的 offset 后移，导致重复
        setComments((prevComments) => {
          const ids = new Set(prevComments.map(c => c.id))
          return [...prevComments, ...list.filter(c => !ids.has(c.id))]
        })
      }
      setPage(nextPage)
    }).catch((error) => {
      if (seq !== requestSeqRef.current)
        return
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    }).finally(() => {
      if (seq === requestSeqRef.current)
        setLoadingMore(false)
    })
  }

  // 本帖上下文候选用户：文章作者优先，其次是当前已加载评论及回复摘要中的参与者
  const sectionUsers = useMemo(() => {
    const list: UserBrief[] = []
    if (owner)
      list.push(owner)
    for (const c of comments) {
      if (c.user)
        list.push(c.user)
      if (c.threadUsers)
        list.push(...c.threadUsers)
    }
    return list
  }, [comments, owner])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="text-xl md:text-2xl">
          {t('comment')}
          <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{totalCommentCount}</span>
        </SectionTitle>
        <div className="flex">
          <OrderSelector
            value={{ orderBy, desc }}
            onOrderChange={(o) => {
              setOrderBy(o.orderBy)
              setDesc(o.desc)
            }}
            orderBys={[
              OrderBy.CreatedAt,
              OrderBy.LikeCount,
              OrderBy.CommentCount,
              OrderBy.UpdatedAt,
            ]}
          />
        </div>
      </div>
      <div className="mt-4">
        <CommentInput
          collapsible
          showAvatar
          contextUsers={sectionUsers}
          ownerId={ownerId}
          onCommentSubmitted={onCommentSubmitted}
        />
      </div>
      <div className="mt-2" key={viewerEpoch}>
        {initialLoading
          ? <CommentLoading />
          : comments.map(comment => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onCommentDelete={onCommentDelete}
                activeInput={activeInput}
                setActiveInputId={setActiveInput}
                onCountChange={onCountChange}
                ownerId={ownerId}
                sectionUsers={sectionUsers}
                translatable={translatable}
                focusRootId={focus?.rootId}
                focusCommentId={focus?.commentId}
              />
            ))}
        {!initialLoading && (needLoadMore
          ? (
              <div className="flex justify-center my-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={loadingMore}
                  onClick={handleLoadMore}
                >
                  {loadingMore && <Loader2 className="animate-spin" />}
                  {loadingMore ? t('loading') : t('load_more')}
                </Button>
              </div>
            )
          : (
              <p className="my-4 text-center text-sm text-muted-foreground">{comments.length === 0 ? t('empty') : t('no_more')}</p>
            ))}
      </div>
    </div>
  )
}

/**
 * 读出地址里的 ?comment= 并把它去掉。用原生 history.replaceState 且 state 传 null（Next 推荐的写法）：
 * Next 会把新地址同步进路由状态并保留内部的历史状态；传入现有的 history.state（带 __NA）会被当成 Next 自己的调用而跳过同步
 */
function takeCommentParam(): number {
  const url = new URL(window.location.href)
  const raw = url.searchParams.get('comment')
  if (raw === null)
    return 0
  url.searchParams.delete('comment')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : 0
}

/** 把深链定位的线程根放在列表最前面；列表里已经有它时保持原样 */
function withPinnedRoot(list: Comment[], root: Comment | null): Comment[] {
  if (!root || list.some(comment => comment.id === root.id))
    return list
  return [root, ...list]
}

function CommentLoading() {
  return (
    <div className="space-y-6 py-8">
      {[...Array.from({ length: 3 })].map((_, i) => (
        <div key={i} className="flex gap-3 fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
          <Skeleton className="w-10 h-10 rounded-full fade-in" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4 fade-in" />
            <Skeleton className="h-4 w-3/4 fade-in" />
            <Skeleton className="h-4 w-2/3 fade-in" />
          </div>
        </div>
      ))}
    </div>
  )
}
