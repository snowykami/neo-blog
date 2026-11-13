import type { useTranslations } from 'next-intl'
import type { NotificationItem, NotificationPreview } from '@/models/notification'
import { attachmentMarkerMessage, parseAttachmentMarker } from '@/components/notification/attachment-marker'
import { getPostUrl, withCommentAnchor } from '@/utils/common/route'

export type NotificationDisplayInput = Pick<
  NotificationPreview,
  | 'type'
  | 'actorNames'
  | 'aggregateCount'
  | 'subjectType'
  | 'subjectId'
  | 'subjectTitle'
  | 'subjectSlug'
  | 'targetType'
  | 'targetId'
  | 'commentId'
  | 'excerpt'
  | 'quotedExcerpt'
> & {
  actor?: { username?: string, nickname?: string } | null
}

type NotificationsTranslator = ReturnType<typeof useTranslations<'Notifications'>>

function truncateChars(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(normalized)
  if (chars.length <= maxChars)
    return normalized
  return `${chars.slice(0, maxChars).join('')}…`
}

/** 深链：评论 / 回复 / 提及 / 线程活动定位到那条评论，文章点赞回到文章页 */
export function getNotificationTargetHref(item: NotificationDisplayInput): string | null {
  const key = item.subjectSlug || item.subjectId
  if (!key)
    return null
  const base = item.subjectType === 'page'
    ? `/page/${key}`
    : getPostUrl({ post: { slug: item.subjectSlug, id: item.subjectId } })
  if (item.type === 'post.liked')
    return base
  const commentId = item.targetType === 'comment' && item.targetId ? item.targetId : item.commentId
  return withCommentAnchor(base, commentId ?? 0)
}

/** 列表页用的聚合触发者文案：「A、B和另外 N 人」 */
export function formatNotificationActors(t: NotificationsTranslator, item: NotificationDisplayInput): string {
  const fallbackName = item.actor?.nickname || item.actor?.username || ''
  const names = item.actorNames && item.actorNames.length > 0
    ? item.actorNames
    : (fallbackName ? [fallbackName] : [])
  const rest = Math.max(0, (item.aggregateCount || 1) - names.length)
  const listed = names.join(t('actor_separator'))
  return rest > 0 ? `${listed}${t('and_others', { count: rest })}` : listed
}

/** 灵动岛用的紧凑聚合触发者文案：「小明、小红等 3 人」 */
export function formatIslandActors(t: NotificationsTranslator, item: NotificationDisplayInput): string {
  const fallbackName = item.actor?.nickname || item.actor?.username || ''
  const names = item.actorNames && item.actorNames.length > 0
    ? item.actorNames.slice(0, 2)
    : (fallbackName ? [fallbackName] : [])
  const total = Math.max(names.length, item.aggregateCount || 1)
  const listed = names.map(name => truncateChars(name, 12)).join(t('actor_separator'))
  return total > names.length && listed
    ? `${listed}${t('island_and_others', { count: total })}`
    : listed
}

/** 正文快照：纯附件评论存的是占位标记，按界面语言渲染成「[图片 ×3]」 */
export function formatNotificationExcerpt(t: NotificationsTranslator, excerpt?: string): string {
  if (!excerpt)
    return ''
  const marker = parseAttachmentMarker(excerpt)
  if (!marker)
    return excerpt
  const { key, count } = attachmentMarkerMessage(marker)
  return t(key, { count })
}

/** 通知列表页的完整一行摘要 */
export function formatNotificationSummary(
  t: NotificationsTranslator,
  item: NotificationItem | NotificationDisplayInput,
  actors = formatNotificationActors(t, item),
): string {
  const subject = item.subjectTitle || t('deleted_subject')
  const quoted = formatNotificationExcerpt(t, item.quotedExcerpt)
  const excerpt = formatNotificationExcerpt(t, item.excerpt)
  switch (item.type) {
    case 'comment.created':
      return t(item.subjectType === 'page' ? 'types.comment_created_page' : 'types.comment_created', { actors, subject, excerpt })
    case 'comment.replied':
      return quoted
        ? t('types.comment_replied', { actors, subject, quoted, excerpt })
        : t('types.comment_replied_without_quote', { actors, excerpt })
    case 'post.liked':
      return t('types.post_liked', { actors, subject })
    case 'comment.liked':
      return quoted ? t('types.comment_liked', { actors, quoted }) : t('types.comment_liked_without_quote', { actors })
    case 'comment.thread_replied':
      return t('types.comment_thread_replied', { actors, subject })
    case 'comment.mentioned':
      return t('types.comment_mentioned', { actors, subject, excerpt })
    case 'system.test':
      return t('types.system_test')
    default:
      return `${actors} ${item.subjectTitle ?? ''}`.trim()
  }
}

/** 顶栏灵动岛紧凑通知摘要（单行截断友好） */
export function formatNotificationAlertText(
  t: NotificationsTranslator,
  item: NotificationDisplayInput,
): string {
  const actors = formatIslandActors(t, item)
  const subject = truncateChars(item.subjectTitle || t('deleted_subject'), 20)
  const quoted = truncateChars(formatNotificationExcerpt(t, item.quotedExcerpt), 24)
  const excerpt = truncateChars(formatNotificationExcerpt(t, item.excerpt), 26)
  switch (item.type) {
    case 'comment.created':
      return t(item.subjectType === 'page' ? 'island_types.comment_created_page' : 'island_types.comment_created', { actors, subject, excerpt })
    case 'comment.replied':
      return t('island_types.comment_replied', { actors, excerpt })
    case 'post.liked':
      return t('island_types.post_liked', { actors, subject })
    case 'comment.liked':
      return quoted
        ? t('island_types.comment_liked', { actors, quoted })
        : t('island_types.comment_liked_without_quote', { actors })
    case 'comment.thread_replied':
      return t('island_types.comment_thread_replied', { actors, subject })
    case 'comment.mentioned':
      return t('island_types.comment_mentioned', { actors, excerpt })
    case 'system.test':
      return t('island_types.system_test')
    default:
      return t('new_notification')
  }
}
