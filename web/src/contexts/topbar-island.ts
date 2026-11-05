'use client'

import type { ReactNode } from 'react'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { useEffect, useSyncExternalStore } from 'react'

/**
 * 顶栏灵动岛（实验性）的状态：标题区同一时刻只显示一个「活动」，多个活动按优先级仲裁，第二名缩成主胶囊旁的小圆点；
 * 「提示」是短暂抢占胶囊的一句话（复制成功、评论已发布、切歌等），按顺序排队、同类合并，显示完回到原来的活动。
 * 只在客户端的副作用与事件中修改，服务端渲染始终为空状态，因此用模块级仓库即可（同 contexts/song-chorus.ts），
 * 不在顶栏组件树里的组件（如根布局的新版本检查）也能登记活动。
 * 后台的各项开关由顶栏挂载时写入（setIslandSettings）；顶栏未挂载（后台页面）时不接受提示，调用方回落到 toast
 */

/** 后台可单独关闭的功能，与 IslandSettings 中除总开关外的字段一一对应 */
export type IslandFeature = Exclude<keyof IslandSettings, 'enabled'>

export interface IslandActivity {
  id: string
  feature: IslandFeature
  // 数值大的占主胶囊
  priority: number
  // 胶囊的无障碍名称：只写摘要（如「正在播放：歌名 - 歌手」），不随歌词逐句变化
  label: string
  // 胶囊内容（紧凑态）；需要逐帧变化的部分由内容组件自己订阅数据，活动本身只在状态切换时更新
  compact: ReactNode
  // 退居第二时显示的小圆点内容，没有时第二名不显示
  minimal?: ReactNode
  // 点按展开的面板（后台关闭「点按展开」时不显示）
  panel?: ReactNode
  // 没有面板时点按胶囊执行
  onPress?: () => void
  // 胶囊描边辉光的颜色（如副歌时的封面主色），为空时不发光
  glow?: string | null
}

export interface IslandAlert {
  // 合并键：与排队中的提示相同时合并为一条（计数加一、重新计时）
  key: string
  feature: IslandFeature
  icon?: ReactNode
  text: string
  // 读屏朗读的文本，默认同 text
  announce?: string
  // 显示时长（毫秒）
  duration?: number
  // 合并时显示次数（如连续点赞 ×3）
  countable?: boolean
  onPress?: () => void
}

export interface QueuedIslandAlert extends IslandAlert {
  count: number
  // 每次入队或合并都会变化，用于重新计时
  seq: number
}

interface IslandState {
  activities: IslandActivity[]
  alerts: QueuedIslandAlert[]
  // 顶栏挂载时的后台开关；未挂载时为 null
  settings: IslandSettings | null
}

// 排队的提示最多保留几条，更早的直接丢弃（提示都是即时反馈，过时就没有意义了）
const MAX_QUEUED_ALERTS = 4

const EMPTY_STATE: IslandState = { activities: [], alerts: [], settings: null }
let state = EMPTY_STATE
let alertSeq = 0
const listeners = new Set<() => void>()

function update(next: IslandState) {
  state = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getState = () => state
const getServerState = () => EMPTY_STATE

/** 某项功能当前是否生效：顶栏已挂载、总开关与该项都开启 */
export function islandAccepts(feature: IslandFeature): boolean {
  const settings = state.settings
  return !!settings && settings.enabled && settings[feature]
}

export function useIslandState(): IslandState {
  return useSyncExternalStore(subscribe, getState, getServerState)
}

export function useIslandAccepts(feature: IslandFeature): boolean {
  return useSyncExternalStore(subscribe, () => islandAccepts(feature), () => false)
}

/** 顶栏挂载、开关变化时写入；卸载时传 null，之后的提示回落到 toast */
export function setIslandSettings(settings: IslandSettings | null) {
  if (state.settings !== settings)
    update({ ...state, settings, alerts: settings ? state.alerts : [] })
}

function upsertActivity(activity: IslandActivity) {
  const activities = state.activities.filter(other => other.id !== activity.id)
  activities.push(activity)
  // 稳定排序：同优先级先登记的在前
  activities.sort((a, b) => b.priority - a.priority)
  update({ ...state, activities })
}

function removeActivity(id: string, activity: IslandActivity) {
  // 只移除自己登记的那一份，避免卸载晚于新活动登记时误删
  if (state.activities.includes(activity))
    update({ ...state, activities: state.activities.filter(other => other.id !== id) })
}

/**
 * 登记一个活动，传 null 时撤下；activity 变化时替换。调用方应以 useMemo 保证只在状态切换时生成新对象，
 * 避免每次渲染都重新登记
 */
export function useIslandActivity(activity: IslandActivity | null) {
  useEffect(() => {
    if (!activity)
      return
    upsertActivity(activity)
    return () => removeActivity(activity.id, activity)
  }, [activity])
}

/** 不在组件里的调用方（如上传进度）直接登记 / 撤下 */
export function showIslandActivity(activity: IslandActivity) {
  upsertActivity(activity)
  return () => removeActivity(activity.id, activity)
}

/** 推送一条提示；功能未生效（关闭或顶栏未挂载）时返回 false，调用方自行回落（如改用 toast） */
export function pushIslandAlert(alert: IslandAlert): boolean {
  if (!islandAccepts(alert.feature))
    return false
  const seq = ++alertSeq
  const index = state.alerts.findIndex(other => other.key === alert.key)
  const alerts = [...state.alerts]
  if (index >= 0)
    alerts[index] = { ...alert, count: alerts[index].count + 1, seq }
  else
    alerts.push({ ...alert, count: 1, seq })
  update({ ...state, alerts: alerts.slice(-MAX_QUEUED_ALERTS) })
  return true
}

/** 当前提示显示完毕（seq 仍是这一条时才移除，期间合并过的会重新计时） */
export function finishIslandAlert(seq: number) {
  if (state.alerts[0]?.seq === seq)
    update({ ...state, alerts: state.alerts.slice(1) })
}
