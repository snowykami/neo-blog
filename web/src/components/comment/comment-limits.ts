import { useSiteInfo } from '@/contexts/site-info-context'

/** 站点信息里缺少这些字段时（旧版本后端、缓存的旧数据）使用的默认值，与后端 config 一致 */
export const COMMENT_MAX_LENGTH_FALLBACK = 500
export const COMMENT_COLLAPSED_LINES_FALLBACK = 6

/** 评论的两项展示配置：字数上限（输入框与校验）与折叠行数（评论正文） */
export function useCommentLimits(): { maxLength: number, collapsedLines: number } {
  const { siteInfo } = useSiteInfo()
  return {
    maxLength: siteInfo.commentMaxLength || COMMENT_MAX_LENGTH_FALLBACK,
    collapsedLines: siteInfo.commentCollapsedLines || COMMENT_COLLAPSED_LINES_FALLBACK,
  }
}

/** 与后端一致的计数方式：去掉首尾空白后按字符（码点）数，emoji 等算一个字 */
export function commentCharCount(content: string): number {
  return [...content.trim()].length
}
