# 顶栏灵动岛提示仲裁规格（Spec）

> 状态：已实现（2026-11-09）。代码：`web/src/contexts/topbar-island.ts`（状态与仲裁）、`web/src/components/layout/topbar-island/topbar-island.tsx`（渲染与计时）、单测 `web/src/contexts/topbar-island.test.ts`。
> 范围：只涉及顶栏标题区「岛上同一时刻显示什么、什么时候换、被打断后怎么办」。面板形变、手势、歌词渲染等既有能力不变，见 `docs/handbook/04-features/13-island.md`。

## 1. 目标

参考 Apple 灵动岛的三层结构，把原来「一条串行队列」改成「活动常驻 + 提示可打断」：

- **持续活动**（播放器、阅读进度、上传、离线、新版本）一直在，被任何提示盖住后自动回来，不消耗寿命。
- **消息通知**（新通知、问候、节日、读完提示、切歌歌名）短暂出现，可被盖、按各自策略恢复或丢弃。
- **操作反馈**（点赞、评论、复制）要立刻可见，允许临时盖过其他内容。

非目标：

- 不做多种活动的可视化堆叠（Apple 的 minimal 小圆点已够，见 `topbar-island.tsx` 的 `secondary`）。
- 不做跨页面的提示持久化（队列仍在内存里，顶栏卸载即丢弃）。
- 不改动站内通知的后端语义（SSE 推送内容化另立需求，见第 10 节）。

## 2. 改造前的问题

| 位置 | 原状 | 问题 |
| --- | --- | --- |
| `contexts/topbar-island.ts` | `pushIslandAlert` 一律 `push` 到队尾，同 key 原位替换 | 反馈类提示被长提示压住，最长可达 10 秒 |
| 同上 | 溢出时 `slice(-4)` 丢掉**队首**（正在显示的那条） | 正在显示的内容被突然顶掉 |
| `topbar-island.tsx` | 只有 `alerts[0]` 会渲染；`panelOpen` 时一律不显示也不计时 | 开着迷你播放器时攒一串，收起后连环弹 |
| 同上 | `holding`（悬停/聚焦）时**不启动**计时器 | 鼠标停在顶栏，提示永远不结束，队列停摆 |
| 各调用点 | 1500 / 2400 / 4000 / 4500 混用，无最短可见时长 | 被插队时可能只显示几百毫秒（抖动） |

## 3. 三层模型

| 层 | 有寿命 | 例子 | 能否被盖 | 被盖后 |
| --- | --- | --- | --- | --- |
| `activity` | 无（状态驱动） | 播放中/暂停的音乐、文章阅读进度、上传进度、离线、新版本 | 任何 `notice` / `feedback` | 不暂停、不重播，露出时按当前状态重算 |
| `notice` | 有 | 新通知、问候、节日、读完啦、切歌歌名 | `feedback` | 按各自的 `resume` 策略 |
| `feedback` | 有（短） | 点赞、取消点赞、评论已发布、复制成功 | 只有同 key 合并 | —— |

关键约定：

1. **`activity` 没有「剩余时长」这个概念。** 音乐与阅读都是状态驱动的（`useMusic` / 阅读 store + 订阅，见 `reading-island.tsx` 的 `ResizeObserver` 与 `music-island.tsx` 的 `standby`），被盖住期间时间线本来就在前进，露出时重新测量即可。**禁止给 `activity` 加计时器。**
2. **`notice` 与 `feedback` 的区分不看「重要程度」，看「错过了会不会丢东西」。** 带交互的 `notice`（读完啦 → 点赞，`reading-island.tsx`）丢了就永远没有（`finishedRef` 只触发一次），所以它必须能恢复；纯确认类（切歌歌名）丢了无所谓，直接丢弃。
3. **必须在场的信息（离线、新版本）一律放 `activity`**，它们不打时长，也不该被「缩短时长」的规则影响。因此没有「不可打断的提示」这种设置：真的不能被盖掉的东西，它就是活动。

## 4. 仲裁规则

### 4.1 一次仲裁

```ts
export function pickIslandAlert(alerts: IslandAlertQueues): QueuedIslandAlert | undefined {
  return alerts.feedback[0] ?? alerts.notice[0]
}
```

即：

1. 反馈队列非空 → 显示反馈队首。
2. 否则消息队列非空 → 显示消息队首（有持续活动在场时时长压到 `NOTICE_WITH_ACTIVITY_MAX_MS`）。
3. 否则显示主活动（沿用活动自己的 `priority` 仲裁）。
4. 都没有 → 显示站名。

同层内是 FIFO：**队首就是当前项，后来的排到队尾，不插队**。所以「连续两次点赞」看到的是同一条提示合并后的 `×N`；两条不同的反馈也是先后播，不会互相打断。

### 4.2 被打断后的恢复：`resume`

每条 alert 自带策略，不按类一刀切：

| `resume` | 语义 | 用在哪 |
| --- | --- | --- |
| `restart`（notice 默认） | 回到队首，从未显示的时长重新计时 | 新通知、问候、节日、读完啦、网络恢复 |
| `continue` | 回到队首，接着剩余时长，保底 `MIN_ALERT_VISIBLE_MS` | 留给长文案（目前没有调用点） |
| `drop`（feedback 默认） | 不恢复，直接丢弃 | 切歌歌名（`music-track`）、所有 `feedback` |

实现：视图层在「显示项切换」时调 `interruptIslandAlert(seq, shownMs)`，仓库按策略处理队首；自然播完、读者点掉、滑走、`dismissIslandAlert` 都不会走到这里（那时条目已经出队）。

### 4.3 时长常量

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `FEEDBACK_ALERT_MS` | 1400 | 反馈默认时长，短于消息类 |
| `NOTICE_ALERT_MS` | 2400 | 消息类默认 |
| `NOTICE_WITH_ACTIVITY_MAX_MS` | 1800 | 场上有活动时的消息类上限 |
| `MIN_ALERT_VISIBLE_MS` | 1200 | 「算读者看到过」的下限：`continue` 恢复时保底 |
| `MAX_ALERT_INTERRUPTS` | 2 | 消息类被打断的次数上限，超过丢弃（防饿死） |

调用点可以自带 `duration`（如问候 4000、读完啦 4500），但仍受上面的上限与保底约束。

### 4.4 合并

同 `key` 且已在队列里 → 合并成一条：计数 +1、`seq` 变化（重新计时）、**不前移**。合并按 key 而不按时间窗：队列里的同 key 项本来就代表「同一件事还没播完」。

### 4.5 溢出

各层上限 `{ notice: 4, feedback: 2 }`，溢出丢**队尾**，队首（正在显示的那条）不动。

## 5. 与悬停、面板的关系

| 触发 | 改造前 | 现在 |
| --- | --- | --- |
| `holding`（悬停 / 聚焦） | 不启动计时器，整条队列停摆 | 只推迟 `notice`（读者正在看着它）；`feedback` **照常计时**，不该被鼠标停留卡住 |
| `panelOpen`（面板展开） | 所有 alert 不显示也不计时，收起后连环弹 | `pushIslandAlert` 对 `feedback` 直接返回 `false`，调用方回落 toast；`notice` 只入队，面板收起后再播 |

`holding` 与 `panelOpen` 都不计「打断次数」：面板开合、鼠标移开再回来不会悄悄消耗掉消息类的重播预算。

## 6. 实现结构

```
web/src/contexts/topbar-island.ts       状态与仲裁（纯逻辑，可直接单测）
  IslandActivity / IslandAlert / QueuedIslandAlert / IslandAlertQueues
  pickIslandAlert()          当前该显示哪条（反馈 > 消息）
  alertDurationOf()          这条这次停留多久（含活动在场压缩、continue 扣减）
  pushIslandAlert()          入队 / 合并 / 分层限额；不接受时返回 false（调用方回落 toast）
  finishIslandAlert()        播完 / 读者点掉 / 滑走
  dismissIslandAlert()       按 key 撤掉任意层任意一条
  interruptIslandAlert()     被更高优先的提示盖掉（视图层上报）
  setIslandSettings() / setIslandPanelOpen()   顶栏挂载与面板状态
  useIslandActivity() / showIslandActivity()   活动登记与撤下
  getIslandAlerts()          只读快照（组件外与单测用）

web/src/components/layout/topbar-island/topbar-island.tsx
  IslandStage 只做渲染、计时、手势；提示的来源是 useIslandAlert()，不再自己读 alerts[0]
```

`IslandAlert` 的字段（去掉默认值后的完整形状）：

```ts
interface IslandAlert {
  key: string                     // 合并键
  feature: IslandFeature          // 归哪个后台开关管
  layer?: 'notice' | 'feedback'   // 默认 notice
  resume?: 'restart' | 'continue' | 'drop'  // 默认 feedback → drop、notice → restart
  icon?: ReactNode
  text: string
  announce?: string               // 只有 notice 会被读屏朗读
  duration?: number
  countable?: boolean             // 合并时显示 ×N
  onPress?: () => void
}
```

`notifySuccess`（`island-feedback.tsx`）固定 `layer: 'feedback'`、`resume: 'drop'`，反馈类调用点不需要关心策略。

## 7. 现有提示的归类

| feature / key | 层 | duration | resume | 说明 |
| --- | --- | --- | --- | --- |
| `like` / `unlike` / `comment` / `copy` | feedback | 1400 | drop | `copy` 保持 `countable` |
| `music-track`（`music-island.tsx`） | notice | 1500 | drop | 歌词开唱就 `dismissIslandAlert`，本来就短命 |
| `notification`（`use-notification-unread.tsx`） | notice | 2400 / 有活动时 1800 | restart | 待内容化（第 10 节） |
| `greeting` / `holiday`（`ambient-island.tsx`） | notice | 4000 | restart | 一次性；已用 sessionStorage 去重 |
| `reading-finish`（`reading-island.tsx`） | notice | 4500 | restart | 带 `onPress`，丢失等于丢功能 |
| `network`（在线恢复） | notice | 2400 | restart | 离线态本身是 activity（`OFFLINE_PRIORITY = 100`） |
| 上传进度、新版本、离线 | activity | — | — | 不打时长，见 `upload-island.tsx` / `app-update-checker.tsx` |

## 8. 单测

`web/src/contexts/topbar-island.test.ts`（`cd web && pnpm test`）覆盖：

1. 反馈优先于消息；消息回到队首并重新计时（restart 不累计时长）
2. 同层 FIFO，两条反馈不互相插队
3. `resume: 'drop'` 被盖掉后不再出现
4. `resume: 'continue'` 累计已显示时长、扣减、保底最短可见时长
5. 被打断超过 `MAX_ALERT_INTERRUPTS` 后丢弃
6. 溢出丢队尾，正在显示的队首不受影响
7. 反馈队列上限更短（2 条）
8. 同 key 合并：计数 +1、`seq` 变化、不前移
9. 旧 `seq` 的结束请求不会误删新提示
10. `dismissIslandAlert` 跨层撤掉任意一条
11. 面板展开时反馈不入队、消息仍排队
12. 有活动在场时消息类时长压缩；反馈不受影响
13. 开关关闭或顶栏未挂载时不接受提示

## 9. 后续可做

1. **通知提示内容化**（第 10 节第 1 条）：后端 SSE 只推未读组数，「有新通知」既不知道是什么也不能点；同时它是「点赞不即时上岛」的主要成因。
2. **反馈的「进行中」态**：点赞的成功提示要等接口返回（`use-post-like.tsx` 的 `.then`），网络慢时点完会有一小段空窗，可考虑先上一句短提示、失败再覆盖。
3. **后台开关粒度**：新通知目前挂在「操作反馈」开关下（只有它是控制瞬时提示的开关），若以后配置项要细分，再拆一个"站内通知"。

## 10. 待确认

1. **通知内容化**：要支持「小明等 3 人赞了《x》」，需要后端推事件明细。点赞按 `类型:目标:自然日` 聚合成一个未读组（`internal/repo/notification.go` 的分组表达式），组数不涨时前端不会提示，这是「点赞不上岛」的主因，与灵动岛无关，属通知系统本身的改造。
2. **`reading-finish` 是否允许被打断**：现在允许（`restart`）。若要更保守，可把它改成活动层（不打时长、只能被点掉），而不是给提示层加「不可打断」的开关。
3. **`continue` 目前没有调用点**：保留它是为了让长文案将来有更自然的处理，不需要时也可以删掉这一档。
