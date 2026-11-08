'use client'

import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { pushIslandAlert } from '@/contexts/topbar-island'

/**
 * 操作成功的反馈（复制、评论已发布、点赞等）：顶栏灵动岛的「操作反馈」生效时在岛上短暂显示，否则（关闭或后台等没有顶栏的页面）照常弹 toast。
 * 失败的提示仍用 toast，需要读者注意的信息不放在会自动消失的岛上
 *
 * 这类提示固定走 `feedback` 层（见 contexts/topbar-island.ts 的文件头）：插队盖过消息类提示、停留约 1.4 秒、错过即丢。
 * 站内消息类提示（新通知、问候、读完啦……）不要用这里，直接调 `pushIslandAlert` 并声明 `layer: 'notice'` 与 `resume`。
 */
export function notifySuccess(text: string, options: { key: string, icon?: ReactNode, countable?: boolean }) {
  const shown = pushIslandAlert({
    key: options.key,
    feature: 'feedback',
    layer: 'feedback',
    resume: 'drop',
    icon: options.icon ?? <CheckIcon aria-hidden className="text-emerald-400" />,
    text,
    countable: options.countable,
  })
  if (!shown)
    toast.success(text)
}
