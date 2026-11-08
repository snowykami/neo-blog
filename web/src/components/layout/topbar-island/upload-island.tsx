'use client'

import { UploadIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { showIslandActivity } from '@/contexts/topbar-island'
import { IslandSlot, IslandText, ProgressRing } from './island-parts'

// 上传中仅次于离线：读者需要知道还有文件没传完
const UPLOAD_PRIORITY = 90

/**
 * 顶栏灵动岛的上传进度：各处上传（目前为评论附件）按 key 报告进度（0 ~ 100），全部完成或取消后撤下。
 * 胶囊显示进度环与总体百分比；是否显示由后台「上传进度」开关决定（顶栏按开关过滤活动）
 */
const uploads = new Map<string, number>()
const listeners = new Set<() => void>()
let snapshot = { count: 0, percent: 0 }
let hide: (() => void) | null = null

function emit() {
  const values = [...uploads.values()]
  snapshot = { count: values.length, percent: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0 }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 报告一项上传的进度；label 为胶囊的无障碍名称（如「附件上传中」），第一次报告时登记 */
export function reportIslandUpload(key: string, percent: number, label: string) {
  uploads.set(key, Math.min(100, Math.max(0, percent)))
  if (!hide) {
    // 活动层（见 contexts/topbar-island.ts 文件头）：不上时长、不允许读者滑走，也不会因为被提示盖住而丢进度
    hide = showIslandActivity({
      id: 'upload',
      feature: 'upload',
      priority: UPLOAD_PRIORITY,
      label,
      compact: <UploadCompact />,
      minimal: <UploadRing />,
    })
  }
  emit()
}

export function endIslandUpload(key: string) {
  if (!uploads.delete(key))
    return
  if (uploads.size === 0) {
    hide?.()
    hide = null
  }
  emit()
}

function useUploadSnapshot() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

function UploadRing() {
  return <ProgressRing percent={useUploadSnapshot().percent} />
}

function UploadCompact() {
  const t = useTranslations('TopbarIsland')
  const { count, percent } = useUploadSnapshot()
  return (
    <>
      <IslandSlot><UploadIcon aria-hidden /></IslandSlot>
      <IslandText>{t('upload_text', { count })}</IslandText>
      <IslandText className="shrink-0 text-white/60 tabular-nums">{`${percent}%`}</IslandText>
      <UploadRing />
    </>
  )
}
