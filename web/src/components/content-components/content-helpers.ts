import type { DOMOutputSpec } from '@tiptap/pm/model'
import { z } from 'zod'

/** 多行文本的降级内容：按行拆成段落 */
export function textParagraphs(text: string): DOMOutputSpec[] {
  return text.split(/\n+/).filter(Boolean).map(line => ['p', {}, line])
}

/** 外链降级内容的属性：新窗口打开时补全 rel */
export function linkAttrs(href: string, newTab = true): Record<string, string> {
  return newTab ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href }
}

function isSafeHref(value: string, allowRelative: boolean): boolean {
  // 站内相对路径：以单个 / 开头（排除 //host 形式的协议相对地址）
  if (allowRelative && /^\/(?!\/)/.test(value))
    return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

/** 链接地址：只允许 http(s) 绝对地址（allowRelative 时还允许站内路径），避免 javascript: 等协议 */
export function hrefSchema({ allowRelative = false } = {}) {
  return z.string().trim().max(2000).refine(value => isSafeHref(value, allowRelative))
}
