'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { useEffect, useSyncExternalStore } from 'react'

/**
 * # 顶栏灵动岛（实验性）的显示仲裁
 *
 * 岛上的内容分三层，层与层之间只有「上层盖下层」，同层内部按到达顺序（不插队）。设计规格见
 * `docs/island-arbitration-spec.md`，改这里的规则前先读它。
 *
 * | 层 | 有寿命 | 例子 | 谁能盖它 | 被盖后 |
 * | --- | --- | --- | --- | --- |
 * | `activity`（活动） | 无，状态驱动 | 音乐、阅读进度、离线、新版本 | 任何提示 | 不暂停、不重播，露出时按当前状态重算 |
 * | `notice`（消息） | 有，1.8～4.5 秒 | 新通知、问候、节日、读完啦、切歌歌名 | `feedback` | 按各自的 `resume` 策略 |
 * | `feedback`（反馈） | 有，约 1.4 秒 | 点赞、评论已发布、复制成功 | 只有同 key 合并 | —— |
 *
 * 不变的约定：
 *
 * 1. **活动没有「剩余时长」**。音乐与阅读都是状态驱动的（各自的 store + 订阅），被盖住期间时间线本来就在前进，
 *    露出时重新测量即可。不要给活动加计时器，也不要让活动自己"暂停恢复"。
 * 2. **提示之间不插队**：同层队列 FIFO，队首就是当前项，后来的排到队尾。所以「连续两次点赞」看到的是同一条提示
 *    合并后的 `×2`，而不是两条；「反馈盖掉了消息」时，消息按 `resume` 处理（见下）。
 * 3. **反馈永远压过消息**（`pickIslandAlert`：`feedback[0] ?? notice[0]`）。读者自己刚做的操作必须立刻可见，
 *    哪怕岛上正在播一条通知。
 * 4. **必须在场的信息放活动层**（离线、新版本），不要放提示层：它们不该被打时长，也不该被"缩短时长"影响。
 * 5. 后台未挂载（控制台等没有顶栏的页面）或该功能开关关闭时 `pushIslandAlert` 返回 `false`，
 *    **调用方必须回落到 toast**，这是唯一允许的降级方式。
 *
 * ## 新增一条提示的写法
 *
 * ```ts
 * // 读者的操作反馈（点赞、复制……）：直接调 notifySuccess，它固定走 feedback 层，不用自己管策略
 * notifySuccess('已复制', { key: 'copy', icon: <CopyIcon />, countable: true })
 *
 * // 站内消息类（新通知、问候……）：自己声明层与恢复策略
 * pushIslandAlert({
 *   key: 'notification',
 *   feature: 'feedback', // 归哪个后台开关管，见 IslandFeature
 *   layer: 'notice',
 *   resume: 'restart', // 被反馈盖掉后回到队首，重新计时
 *   icon: <BellRing />,
 *   text: '有新通知',
 * })
 * ```
 *
 * 新增一条活动用 `useIslandActivity`（组件里）或 `showIslandActivity`（组件外），并在 `IslandSettings` 里加开关；
 * 活动需要按 `priority` 仲裁（大的占主胶囊）、可选手势滑走隐藏（`hideable`）、可选退居第二时的小圆点（`minimal`）。
 *
 * 只在客户端的副作用与事件中修改，服务端渲染始终为空状态，因此用模块级仓库即可（同 `contexts/song-chorus.ts`），
 * 不在顶栏组件树里的组件（如根布局的新版本检查）也能登记活动。
 */

/** 后台可单独关闭的功能，与 IslandSettings 中除总开关外的字段一一对应 */
export type IslandFeature = Exclude<keyof IslandSettings, 'enabled'>

/**
 * 提示的层（见文件头）：
 * - `feedback`：读者的即时操作反馈，永远优先显示，不可被别的提示盖掉
 * - `notice`：站内消息类提示，排队显示，可被反馈盖掉
 */
export type IslandAlertLayer = 'notice' | 'feedback'

/**
 * 提示被更高优先的提示盖掉之后怎么办（只对 `notice` 有意义）：
 * - `restart`（默认）：回到队首，从头重新计时。提示都是即时信息，重播一遍通常比"只剩半句"更自然
 * - `continue`：接着上次没显示完的部分（不足 `MIN_ALERT_VISIBLE_MS` 时补足），适合读者可能已经读了一半的长文案
 * - `drop`：直接丢弃。适合"错过也无所谓"的确认类，如切歌歌名
 */
export type IslandAlertResume = 'restart' | 'continue' | 'drop'

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
  // 面板弹层的外观，默认为与胶囊一致的深色圆角卡片；需要与别处弹层一模一样时（如音乐用悬浮播放器的弹层）传入覆盖
  panelClassName?: string
  panelStyle?: CSSProperties
  // 没有面板时点按胶囊执行
  onPress?: () => void
  // 胶囊的描边辉光（如副歌时随歌词颜色发光），为空时不发光
  glow?: IslandGlow | null
  // 读者能否把它从顶栏滑走隐藏（断网、上传进度等需要一直看到的不允许）
  hideable?: boolean
  // 一段活动的标识（如当前曲目）：隐藏只在同一段内有效，换了（如切歌）重新出现；活动撤下后同样重新出现
  sessionKey?: string
  // 待命：同样的内容此刻正在别处显示（如悬浮球的弹层开着时的音乐），暂时不上岛；与撤下不同，读者的隐藏与选中都保留
  standby?: boolean
}

/** 胶囊的描边辉光：strong 时辉光范围更大、更亮（只变光，不改胶囊大小） */
export interface IslandGlow {
  color: string
  strong: boolean
}

export interface IslandAlert {
  // 合并键：队列里已有同样的键时合并成一条（计数加一、重新计时），不会排成两条
  key: string
  feature: IslandFeature
  // 层，默认 notice；读者的操作反馈用 feedback（见文件头）
  layer?: IslandAlertLayer
  // 被更优先的提示盖掉后的策略，默认 feedback → drop、notice → restart
  resume?: IslandAlertResume
  icon?: ReactNode
  text: string
  // 读屏朗读的文本，默认同 text（只有 notice 会朗读，反馈不打断读屏）
  announce?: string
  // 显示时长（毫秒），不传按时长默认值（见 FEEDBACK_ALERT_MS / NOTICE_ALERT_MS）
  duration?: number
  // 合并时显示次数（如连续点赞 ×3）
  countable?: boolean
  onPress?: () => void
}

export interface QueuedIslandAlert extends IslandAlert {
  // 归一化后的层与策略：入队时就把默认值填好，仲裁与渲染不用再判断
  layer: IslandAlertLayer
  resume: IslandAlertResume
  count: number
  // 每次入队或合并都会变化，用于重新计时、以及打断 / 结束时的身份校验
  seq: number
  // 累计已显示时长（毫秒），只有 resume === 'continue' 用得到
  shownMs: number
  // 被别的提示盖掉的次数，超过 MAX_ALERT_INTERRUPTS 后丢弃（防止一直被插队、永远播不完）
  interrupts: number
}

export interface IslandAlertQueues {
  // 消息类：队首是当前项
  notice: QueuedIslandAlert[]
  // 反馈类：队首是当前项，而且永远优先于消息类
  feedback: QueuedIslandAlert[]
}

interface IslandState {
  activities: IslandActivity[]
  alerts: IslandAlertQueues
  // 顶栏挂载时的后台开关；未挂载时为 null
  settings: IslandSettings | null
  // 面板展开中：反馈直接回落 toast（不攒到收起后连环弹），消息类只入队、不显示
  panelOpen: boolean
}

/** 反馈类提示的默认停留时长：短于消息类，因为它随时会来，读者也不需要读很久 */
export const FEEDBACK_ALERT_MS = 1400
/** 消息类提示的默认停留时长 */
export const NOTICE_ALERT_MS = 2400
/** 场上有持续活动时消息类的上限：读者本来就有东西可看，提示要更短 */
export const NOTICE_WITH_ACTIVITY_MAX_MS = 1800
/**
 * 一条提示至少显示这么久才算「读者看到过」：被盖过（resume: continue）后接着播时用来保底，
 * 避免连续打断后只剩两百毫秒一闪而过。同层提示本来按队列依次播，不会再被缩短
 */
export const MIN_ALERT_VISIBLE_MS = 1200
/** 消息类被盖掉的次数上限，超过就丢弃 */
export const MAX_ALERT_INTERRUPTS = 2
/** 各层队列上限，溢出丢队尾（队首是正在显示的那条，不能动） */
const MAX_QUEUED_ALERTS: Record<IslandAlertLayer, number> = { notice: 4, feedback: 2 }

const EMPTY_ALERTS: IslandAlertQueues = { notice: [], feedback: [] }
const EMPTY_STATE: IslandState = { activities: [], alerts: EMPTY_ALERTS, settings: null, panelOpen: false }
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

/** 当前该显示哪条提示：反馈优先于消息；同层内队首就是当前项（后来的排到队尾，不插队） */
export function pickIslandAlert(alerts: IslandAlertQueues): QueuedIslandAlert | undefined {
  return alerts.feedback[0] ?? alerts.notice[0]
}

/** 订阅"当前该显示的提示"；视图层只需要它，不用自己挑队首 */
export function useIslandAlert(): QueuedIslandAlert | undefined {
  return useSyncExternalStore(subscribe, () => pickIslandAlert(state.alerts), () => undefined)
}

/** 提示队列的只读快照：不在组件里的调用方与单测用（组件里请用 useIslandAlert / useIslandState 订阅） */
export function getIslandAlerts(): IslandAlertQueues {
  return state.alerts
}

/**
 * 一条提示这次该停留多久：
 * - 自身 `duration`，否则按层取默认值
 * - 消息类且场上有持续活动时，压到 `NOTICE_WITH_ACTIVITY_MAX_MS` 以内
 * - 被盖过（resume: continue）时扣掉已显示的部分，但保底 `MIN_ALERT_VISIBLE_MS`
 */
export function alertDurationOf(alert: QueuedIslandAlert, withActivity: boolean): number {
  const base = alert.duration ?? (alert.layer === 'feedback' ? FEEDBACK_ALERT_MS : NOTICE_ALERT_MS)
  const capped = alert.layer === 'notice' && withActivity ? Math.min(base, NOTICE_WITH_ACTIVITY_MAX_MS) : base
  return alert.shownMs > 0 ? Math.max(MIN_ALERT_VISIBLE_MS, capped - alert.shownMs) : capped
}

/** 顶栏挂载、开关变化时写入；卸载时传 null，之后的提示回落到 toast */
export function setIslandSettings(settings: IslandSettings | null) {
  if (state.settings === settings)
    return
  update({ ...state, settings, alerts: settings ? state.alerts : EMPTY_ALERTS, panelOpen: settings ? state.panelOpen : false })
}

/**
 * 面板（迷你播放器、迷你目录等）展开时写入：反馈不再入队（调用方回落 toast），
 * 消息类只排队、等面板收起后再播，避免读数时被提示打断、也避免收起后连环弹
 */
export function setIslandPanelOpen(panelOpen: boolean) {
  if (state.panelOpen !== panelOpen)
    update({ ...state, panelOpen })
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

/** 补上默认的层与恢复策略：调用点只写自己关心的字段 */
function normalizeAlert(alert: IslandAlert): QueuedIslandAlert {
  const layer = alert.layer ?? 'notice'
  return {
    ...alert,
    layer,
    resume: alert.resume ?? (layer === 'feedback' ? 'drop' : 'restart'),
    count: 1,
    seq: 0,
    shownMs: 0,
    interrupts: 0,
  }
}

function setQueue(layer: IslandAlertLayer, queue: QueuedIslandAlert[]) {
  update({
    ...state,
    alerts: layer === 'feedback'
      ? { ...state.alerts, feedback: queue }
      : { ...state.alerts, notice: queue },
  })
}

/**
 * 推送一条提示；功能未生效（关闭、后台页没有顶栏、面板展开时的反馈）时返回 false，调用方自行回落（如改用 toast）。
 * 同一 `key` 已在队列里时合并成一条，不会排第二条。
 */
export function pushIslandAlert(alert: IslandAlert): boolean {
  const normalized = normalizeAlert(alert)
  if (!islandAccepts(normalized.feature))
    return false
  // 面板展开时读者正在操作别的东西：反馈直接回落 toast，不排队（否则收起面板会连着弹好几条）
  if (normalized.layer === 'feedback' && state.panelOpen)
    return false
  const seq = ++alertSeq
  const queue = state.alerts[normalized.layer]
  const index = queue.findIndex(other => other.key === normalized.key)
  const merged: QueuedIslandAlert = { ...normalized, seq }
  let next: QueuedIslandAlert[]
  if (index >= 0) {
    // 同一件事还没播完：原位替换、计数加一、重新计时（不算插队，也不前移）
    next = queue.map((other, i) => i === index ? { ...merged, count: other.count + 1, interrupts: other.interrupts } : other)
  }
  else {
    next = [...queue, merged]
  }
  // 溢出丢队尾：队首是正在显示的那条
  setQueue(normalized.layer, next.slice(0, MAX_QUEUED_ALERTS[normalized.layer]))
  return true
}

/** 撤下某一类提示（不论在哪一层、是否正在显示），如歌词开唱后撤下切歌提示 */
export function dismissIslandAlert(key: string) {
  const { notice, feedback } = state.alerts
  if (!notice.some(alert => alert.key === key) && !feedback.some(alert => alert.key === key))
    return
  update({
    ...state,
    alerts: { notice: notice.filter(alert => alert.key !== key), feedback: feedback.filter(alert => alert.key !== key) },
  })
}

/** 某一层的队首是否是这条提示（用于打断 / 结束前的身份校验，避免恢复出已经撤掉的幽灵提示） */
function headLayerOf(seq: number): IslandAlertLayer | null {
  if (state.alerts.feedback[0]?.seq === seq)
    return 'feedback'
  if (state.alerts.notice[0]?.seq === seq)
    return 'notice'
  return null
}

/** 当前提示显示完毕（或被读者点掉、滑走）：只有队首的那条能出队，期间合并过的会重新计时 */
export function finishIslandAlert(seq: number) {
  const layer = headLayerOf(seq)
  if (!layer)
    return
  setQueue(layer, state.alerts[layer].slice(1))
}

/**
 * 一条提示被更高优先的提示顶掉（如反馈盖过了消息）时调用，由视图层在「显示项切换」时上报：
 * 按它自己的 `resume` 策略处理——回到队首重新计时 / 接着剩余时长 / 丢弃；被顶超过 `MAX_ALERT_INTERRUPTS`
 * 次的直接丢弃，避免一直被插队、永远播不完。
 *
 * 自然播完、读者点掉、滑动撤下的都不走这里（那时它已经被 `finishIslandAlert` / `dismissIslandAlert` 出队了，
 * 这里会因为找不到队首而什么都不做）。
 */
export function interruptIslandAlert(seq: number, shownMs: number) {
  const layer = headLayerOf(seq)
  if (!layer)
    return
  const [current, ...rest] = state.alerts[layer]
  const interrupts = current.interrupts + 1
  const dropped = current.resume === 'drop' || interrupts > MAX_ALERT_INTERRUPTS
  // restart 不需要记住已经显示多久（下次从头计时），只有 continue 累计
  const shown = current.resume === 'continue' ? current.shownMs + Math.max(0, shownMs) : 0
  setQueue(layer, dropped ? rest : [{ ...current, interrupts, shownMs: shown }, ...rest])
}
