# 站内互动通知系统需求规格（Spec）

> 状态：方案评审中，未实现（2026-11-08）
> 结论：可以做。现有事件源（点赞、评论）两处都已经算出了被互动内容的作者，接入成本比想象中低；缺失的是"收件人视角 + 已读状态 + 多渠道投递"这三层。

## 1. 目标

有人对你的内容做了动作时，你能知道，并且能点回去看到具体是哪一条。

- **站内通知**：顶栏入口 + 未读数徽标 + 通知列表页；支持已读 / 未读 / 一键全部已读。
- **邮件通知**：同一个事件可以同时走邮件通道。邮件**不逐条发**：定时把该收件人这一轮攒下的事件汇总成一封列表邮件（1. A 回复了你…… 2. B 赞了你的评论……），带直达链接与一个「通知设置」入口。
- **站内与邮件互不影响**：站内通知始终即时落库，汇总只发生在邮件侧，不会让站内延迟。
- **多渠道可扩展**：渠道（站内、邮件，将来还有 webhook / WebPush）与事件类型解耦，新增渠道不改事件表。
- **隐私安全默认收紧**：通知只给"本来就能看到这条内容的人"，收件人只能读自己的通知。

### 1.1 交付范围

| 阶段 | 内容 | 估时 |
|---|---|---|
| **P0** | 站内闭环：地基层（模型 / 配置 / 偏好 / 抑制）、写入链路（点赞与评论 5 种事件、折叠行）、接口、`/notifications` 页、头像徽标、`?comment=` 深链、`/notification-settings`（登录态） | 5–6 天 |
| **P1** | 邮件通道：模板与 5 语言文案、摘要 worker（重要触发 + 附带搭车）、清理、免登录偏好页（token）、限速与重试 | 2–2.5 天 |
| **P2** | SSE 实时、关注此帖 / 此线程、投递失败面板、灵动岛提示、聚合行展开明细 | 1 天 |

> 工时按「一个人、熟悉本仓库、含自测」估。任务级拆分见 13 章。

### 1.2 非目标

- 站内私信、关注/粉丝流、订阅式推送。都不做，但数据模型不阻碍将来加。
- **@提及**（`comment.mentioned`）。v1 不做，15.1 里只留了占位（N7 已定）。
- 全站广播 / 系统公告。这不是通知系统该干的事，不需要为此设计类型。
- 桌面通知、WebPush。P2 之后再议，接口上留扩展位但不实现。
- 管理台查看别人的通知。见第 9 节。

## 2. 现状盘点

仓库里目前**没有任何通知相关代码**。三处看起来相关，但都不能直接复用：

| 现有实现 | 是什么 | 为什么不能当通知用 |
|---|---|---|
| `model.VisitLog` + `VisitService.RecordInteraction`（`internal/service/visit.go`） | 管理员看的访问/互动时间线，点赞和评论都会记一条 `Action=like / comment` 与 `TargetUserID` | 只有管理员可读（`ListVisitLogs` 里 `if !ctxutils.IsAdmin` 直接 403）；没有收件人视角、没有已读；取消点赞会 `RemoveInteraction` 删掉记录；按保留期（默认 90 天）整体清理 |
| `agent_runs` + `internal/agentrunner` | AI 用户的租约队列（`status` / `lease_until` / 跨实例唤醒 / 退出时放回队列） | 是任务队列，不是通知；但它是投递 worker 的直接模板，见 6.3 |
| `pkg/utils/email.go` + `internal/service/email.go` + `internal/static/assets/email/*.tmpl` | 邮件发送、5 语言文案表、模板渲染、管理员测试发信 | 只服务验证码邮件；通知邮件要新模板与新文案，但渲染、发送、多语言选择、测试这些基础设施可以直接沿用 |

事件源只有两个，且**两处都已经算出了收件人**：

- `LikeService.ToggleLike`（`internal/service/like.go`）：`ownerID` = 被点赞的文章作者 / 评论作者
- `CommentService.CreateComment`（`internal/service/comment.go`）：`ownerID` = 回复时被回复评论的作者，否则是文章 / 页面作者

另外：没有 `@提及` 解析，没有收藏功能。所以 v1 的事件类型只有 5 种，见 3.1。

## 3. 核心概念

四个东西，各管一件事，不要合并：

| 概念 | 含义 | 存在形式 |
|---|---|---|
| **事件**（InteractionEvent） | "谁对什么做了什么"，与收件人无关 | `interaction_events` 表，一条动作一行 |
| **通知**（Notification） | "这条事件要告诉某个人"，带该收件人的已读与渠道状态 | `notifications` 表，事件 × 收件人一行 |
| **投递**（Delivery） | 某个渠道是否已送达 | v1 直接放在 `notifications` 的渠道状态列上；渠道变多或需要审计时再拆表 |
| **偏好**（Preference） | 某用户想收哪些类型、走哪些渠道 | `users.notification_prefs`（JSON） |

这么做而不是"一条动作一行直接当通知"的原因：

1. 将来 `@提及`、回复整个线程的参与者时，一个事件会有多个收件人，已读是每人一份，无法放在事件行上。
2. 邮件需要重试、需要聚合、需要审计，属于"投递"层，不能和"发生了什么"绑死。
3. 事件是事实，取消点赞时事件可以保留（用于统计），只是通知要撤掉。

### 3.1 事件类型

命名沿用已有的 `constant.AgentTriggerCommentReplied = "comment.replied"` 风格（点分小写）：

| 类型 | 触发点 | 收件人 | 归类 | 站内文案（简略） |
|---|---|---|---|---|
| `comment.created` | 评论了你的文章 / 页面 | 文章 / 页面作者 | 重要（真人）/ 附带（AI） | 「A 评论了你的文章《标题》」 |
| `comment.replied` | 回复了你的评论 | 被回复评论的作者 | 重要（真人）/ 附带（AI） | 「A 回复了你在文章《标题》下的评论「原评论」：内容」 |
| `post.liked` | 点赞了你的文章 | 文章作者 | 附带 | 「A 赞了你的文章《标题》」 |
| `comment.liked` | 点赞了你的评论 | 评论作者 | 附带 | 「A 赞了你的评论「原评论」」 |
| `comment.thread_replied` | 你发起的那串评论里别人在互相回复（P0 做，N6=c） | 线程发起人 + 主题作者 | 附带（折叠行） | 「A 等 5 人在你在《x》下的评论里回复了」 |

**重要与附带**（只影响邮件，不影响站内）：

- **重要**：真人发的评论 / 回复。会**触发**一封邮件。
- **附带**：点赞、AI 的任何互动、线程活动（`comment.thread_replied`）。**不触发**邮件，只搭该用户下一封邮件的车一起出现（见 6.2）。
- 站内通知对两者一视同仁：即时落库、都能读；降噪靠聚合行（见 3.4）。

类型常量放 `pkg/constant/constant.go`，与 `AgentTrigger*` 一起维护。完整事件表（含未实现类型、去重键）见 **15.1**，完整文案与变量见 **15.2 / 15.4**。

### 3.2 抑制规则

按顺序执行，任一命中就不产生通知（事件是否落库见 5.2）：

| # | 规则 | 说明 |
|---|---|---|
| 1 | `actor == owner` | 自己评论自己、自己给自己点赞 |
| 2 | `owner.IsAI` | AI 用户没有收件箱 |
| 3 | `actor.IsAI` 的互动归入**附带**；收件人关掉 `ai_interactions` 时连通知行都不产生 | AI 的点赞与评论都不触发邮件；默认在站内可见，用户可一键静音 AI（N9） |
| 4 | 私密评论先过 `canViewComment` | 私密评论只有评论者和目标所有者可见，不能顺手通知第三人 |
| 5 | `owner.Disabled` | 禁用用户不产生通知、不投递 |
| 6 | 取消点赞 → 硬删对应通知并撤销待发邮件 | 已经没意义了 |
| 7 | 回复只通知被回复人（`comment.replied`） | 逐条即时，不折叠 |
| 8 | 线程活动（`comment.thread_replied`）只给「线程发起人 + 主题作者」 | 排除本次 `actor` 与直接父评论作者（后者走规则 7）；主题作者可由站点级 `notification_thread_include_author` 关掉；同一天同一线程同一收件人只保留一行（折叠，见 3.4） |

### 3.3 去重

同一 `actor + 动作 + 目标` 只保留一条事件，避免"反复点赞/取消/再点赞"刷出多条通知。去重键：

```
comment.created:post:12:comment:1234
comment.replied:comment:99:comment:1234
post.liked:post:12:user:3
comment.liked:comment:99:user:3
comment.thread_replied:comment:<rootID>:day:<yyyymmdd>:user:<recipientID>
```

前两类本身幂等（带着新评论 id），后两类靠 `uniqueIndex` 兜底。线程活动那一条特殊：它是**折叠行**，键里带自然日与收件人，`notifications.dedupe_key` 上再建 `(dedupe_key, user_id)` 唯一索引做 upsert（见 4.2）。

`notifications` 上的 `(event_id, user_id)` 唯一，保证 worker 重放不会重复发邮件。

### 3.4 站内聚合行（X / Twitter 式）

50 个人赞了你，不该变成 50 行、50 个未读。模仿 X：**同类型 + 同目标 + 同一个自然日**的多条点赞，在列表里归并成**一行**。

- 归并确实发生在**渲染时**，明细行照旧一条不少（取消点赞才能精确删除）。
- **例外**：`comment.thread_replied` 没有「取消回复」的语义，所以不存明细，直接写一行**可变折叠行**（`AggregateCount` + `AggregateActors`），后续回复只做 `count+1`、刷新 `updated_at`、把 `read_at` 置回 NULL（有新活动就重新变未读）。
- 分组键：重要类（评论/回复）以 **`id` 自身**为一组（不归并）；点赞类以 `type + target_type + target_id + 自然日` 为一组；`comment.thread_replied` 本身就是一行折叠行，两个分支都不进。
- 一行显示：「`{actor1}`、`{actor2}` 和另外 `{n}` 人赞了你的文章《x》」，actor 最多列 2 个。
- **一个聚合行 = 1 个未读**。点开它就整组置已读，徽标数字也随之减少。
- 实现：一条分组查询就能同时拿到两种行（`CASE WHEN type IN (点赞类) THEN 分组键 ELSE 'id:'||id END` 作为 `GROUP BY` 键，`ORDER BY MAX(created_at) DESC` 分页），不用两个数据源拼接。SQLite 与 Postgres 都支持 `||` 与 `CASE`。
- 分天用 `user.TimeZone`（IANA，空则用服务器时区），跨时区的一天归并误差可接受。

## 4. 数据模型

### 4.1 `interaction_events`

```go
// 互动事件：谁对什么做了什么，与收件人无关；快照字段让列表与邮件都不必回查业务表
type InteractionEvent struct {
	gorm.Model
	Type         string `gorm:"size:32;index"`          // comment.created / comment.replied / post.liked / comment.liked / comment.thread_replied
	ActorID      uint   `gorm:"index"`                  // 触发者
	Actor        User   `gorm:"foreignKey:ActorID"`
	OwnerID      uint   `gorm:"index"`                  // 内容作者，v1 的唯一收件人
	TargetType   string `gorm:"size:16"`                // post / comment：被互动的对象
	TargetID     uint
	SubjectType  string `gorm:"size:16"`                // post / page：所在文章，用于跳转
	SubjectID    uint
	SubjectTitle string `gorm:"size:255"`               // 快照
	SubjectSlug  string `gorm:"size:255"`
	CommentID    uint                                   // 新评论（评论 / 回复事件）
	Excerpt      string `gorm:"size:300"`                // 快照：本条事件产生的评论正文（评论 / 回复）
	QuotedExcerpt string `gorm:"size:300"`               // 快照：被回复 / 被点赞的那条评论正文（收件人自己的评论）
	DedupeKey    string `gorm:"size:160;uniqueIndex"`   // 见 3.3
}
```

### 4.2 `notifications`

```go
// 通知：事件 × 收件人，带该收件人的已读与投递状态
type Notification struct {
	gorm.Model
	EventID uint `gorm:"uniqueIndex:idx_notification_event_user"`
	UserID  uint `gorm:"uniqueIndex:idx_notification_event_user;index:idx_notification_user_read"`
	Type    string `gorm:"size:32;index"`               // 冗余事件类型，列表筛选不必 join

	// 冗余快照：列表渲染不 join 事件表、actor 改昵称后仍显示当时的称呼也不需要，但目标被删时不至于空白
	ActorID      uint
	SubjectType  string `gorm:"size:16"`
	SubjectID    uint
	SubjectTitle string `gorm:"size:255"`
	SubjectSlug  string `gorm:"size:255"`
	TargetType   string `gorm:"size:16"`
	TargetID     uint
	CommentID    uint
	Excerpt      string `gorm:"size:300"`
	QuotedExcerpt string `gorm:"size:300"`

	// 折叠行（3.4）：只有 comment.thread_replied 用；点赞类靠明细行渲染时归并，不写这几列
	DedupeKey       string `gorm:"size:200;uniqueIndex:idx_notification_dedupe"` // 折叠行的 upsert 键（含自然日）
	AggregateCount  int    `gorm:"default:0"`               // 0 = 普通行；折叠行插入时置 1，每来一条 +1
	AggregateActors string `gorm:"size:120"`                // 前 2 个昵称，逗号分隔，用于「A、B 和另外 N 人」

	ReadAt *time.Time `gorm:"index:idx_notification_user_read"`

	InAppSent bool `gorm:"default:false"`

	// 邮件渠道状态机：pending → sending → sent / failed / skipped
	EmailState    string     `gorm:"size:16;default:pending;index:idx_notification_email_due"`
	EmailAttempts int        `gorm:"default:0"`
	EmailNextAt   *time.Time `gorm:"index:idx_notification_email_due"`
	EmailSentAt   *time.Time
	EmailLastErr  string     `gorm:"size:255"`
}
```

索引：

- `(event_id, user_id)` 唯一 —— 普通通知的幂等
- `(dedupe_key, user_id)` 唯一 —— 折叠行（`comment.thread_replied`）的 upsert 键：同一天同一线程同一收件人只有一行，`ON CONFLICT DO UPDATE` 累加 `aggregate_count`
- `(user_id, read_at, id)` —— 未读数与未读列表（`read_at` 为 NULL 时的等值查询走索引前缀）
- `(email_state, email_next_at)` —— 投递 worker 扫待发

### 4.3 用户偏好

`users` 表加一列 `NotificationPrefs string`（TEXT，存 JSON，可空 = 全默认），照 `AIWritingHabit` 的做法：

```json
{
  "inapp": ["comment.created", "comment.replied", "post.liked", "comment.liked"],
  "email": ["comment.created", "comment.replied"],
  "ai_interactions": true
}
```

只存在"读整份"的需求，不值得为它加一张表再 join；空字符串表示没改过默认值。

- `inapp` / `email` 都是"**允许**列表"。`inapp` 里任何一种都在站点开放范围内（站点级只做抑制，不做扩容）；`email` 是站点级白名单（N2）与用户选择的交集——**用户只能关，不能开站点没开的类型**。
- `ai_interactions`（N9）：`false` 时 AI 用户的互动**连通知行都不产生**（站内也看不到，评论本身仍在页面）。

### 4.4 迁移

新表 + 新可空列都属于纯增量：只改模型并加入 `internal/repo/init.go` 的 `models`，不写版本迁移。两张表都是**新建**，上面的唯一索引随建表一起创建，不触发「新增唯一索引要写版本迁移」那条规则（那条针对已有表改索引）。

**一个坑**：`gorm.DeletedAt` 软删 + 唯一索引会让"删掉再生成"撞唯一键。点赞表已经踩过（`internal/repo/like.go` 里用 `Unscoped().Delete` 硬删）。取消点赞撤销通知、清理过期数据都用硬删。

## 5. 写入路径

### 5.1 接入点

```go
// internal/service/like.go        ToggleLike：点赞时
// internal/service/comment.go     CreateComment：评论与回复时
NewNotificationService().Emit(ctx, event)  // 内部完成抑制判断、去重、生成通知行
```

两处都已经有 `ownerID` 与目标信息，接入是"加一次调用"，不改现有逻辑。

### 5.2 事务边界

**事件与通知行必须和业务写在同一个事务里**，否则进程崩溃会丢通知（点赞成功但没有通知，用户永远不知道）。邮件不在请求路径上，写库后即返回。

现状要小改一处：`repo.Comment.CreateComment` 与 `repo.Like.ToggleLike` 都自己开事务，`CreateComment` 还要在事务里回写 `root_id`、同步目标评论数。所以有两条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| A（spec 倾向） | 给两个 repo 方法加可选 `tx *gorm.DB` 参数，由 service 开事务包住「业务 + 事件 + 通知」 | 改 2 个 repo 签名 + 调用点；崩溃也不会丢通知 |
| B（贴合现状） | 完全照现有 hook 风格（`RecordInteraction`、`NotifyCommentCreated` 都是事务提交后调用），`Emit` 放在业务成功之后 | 不改 repo 签名；进程在两者之间挂掉会**丢一条通知**（业务仍在） |

倾向 A：通知是"用户能看到有人互动"的唯一途径，丢了不会有补偿；而 B 的丢法在滚动更新时并不罕见。若实施时发现 repo 改造成本超出预期，退回 B 并在 5.3 登记为已知缺陷。

同一事务里顺手把邮件状态排好（见 3.1 的重要 / 附带）：

- **重要行**（真人评论 / 回复）：`email_state='pending'`、`email_next_at = created_at + notification_email_interval`，worker 扫到期行即可。
- **附带行**（点赞 / AI 互动）：`email_state='attached'`、`email_next_at` 为空，**永远不会被扫表命中**，只能被同一用户的重要行搭车带走。
- 收件人关掉了邮件、或该类型不在其偏好里：直接写 `email_state='skipped'`，不占用扫表。
- **折叠行**（`comment.thread_replied`）的 upsert 要维持这些不变量：`aggregate_count + 1`、`aggregate_actors` 只补到 2 个昵称、`updated_at` 刷新（列表按它排序，否则这一行会沉到后面）、`read_at` 置回 NULL、`email_state` 保持 `attached` 且 `email_next_at` 保持 NULL（它永远不该自己触发发信）。

### 5.3 失败处理

通知写入失败**不能让点赞 / 评论失败**。在事务内 `Create` 出错时记录日志并提交业务（`errs` 不上抛）。理由：通知是附属品，业务是主链路；丢一条通知比丢一条评论严重性低得多。

## 6. 渠道

### 6.1 抽象

```go
type Channel interface {
	Name() string // inapp / email
	// Send 幂等：同一通知同一渠道重复调用不会重复送达
	Send(ctx context.Context, n *model.Notification) error
}
```

v1 只有 `inapp` / `email` 两个实现。通道清单放在 service 初始化，注册式增加，不改事件与通知表。

- **站内**：写库即送达（`InAppSent = true`），零额外成本。P2 加 SSE 时在这里顺手推一条。
- **邮件**：见 6.2。

### 6.2 邮件

邮件是**定时汇总**，不是每条事件发一封；而且只有**重要消息**能触发发信。

- **触发条件**：只有**重要**消息（真人发的评论 / 回复）会触发一封邮件。点赞与 AI 互动**永远不会单独发信**。
  → 后果要说清楚：一个只有人点赞、从没人评论的用户，一封邮件也收不到。偏好页文案要写明「点赞与 AI 互动不会单独发邮件，会随下一次评论或回复一起提醒」。
  → 「重要」的集合就是站点级配置 `notification_email_types`（默认 `comment.created` + `comment.replied`），它同时是用户可选的**上限**（N2）：用户只能在这个集合里关，不能开站点没开的类型。
- **搭车**：重要行到期时，worker 顺手把该用户同一批的附带行一起渲染进这一封。**附带行没有到期时间（`email_state='attached'`），永远不会自己触发**。
- **附带窗口与上限**：只搭 `notification_email_attach_hours`（默认 24 小时）内、最多 `notification_email_attach_max`（默认 5）条，按时间倒序；超窗口的直接置 `skipped`（不能永远积压），超上限的只给一句「另有 {n} 个赞」。
- **汇总间隔**：重要消息在 `notification_email_interval`（默认 10 分钟）内合并成一封，避免一分钟 5 条评论发 5 封；0 则表示每轮（30 秒）就发。
- **发送单位**：一个收件人一批到期的重要行 + 搭车的附带行 = 一封邮件；多个收件人各一封。
- **列表形态**：每条一行，**站内列表与邮件共用同一套模板和变量**（站内用 `next-intl` 渲染、语言随界面；邮件服务端渲染、语言跟收件人），逐类型的完整文案见 **15.2**。
- **摘要字段来源**：`Excerpt` = 本次的评论 / 回复正文，`QuotedExcerpt` = 被回复 / 被点赞的那条评论正文（4.1 / 4.2），标题取 `SubjectTitle`；截断与降级规则见 **15.4**。
- **邮件结构**：主题用 15.2 的短主题（多条时「你有 N 条新互动 · 站点名」）；顶部一句话汇总 + CTA 按钮「在站内查看全部」；中间 `<ol>` 有序列表放重要项（每条 1. 2. 3.，带 actor 头像与相对时间）；列表下方一个「另外」分区放附带项（`另有 12 个赞`、`AI 助手 也回复了你`）；底部只有一个「通知设置」链接与站点地址（见 16 章 N11）。
- **单封上限**：重要项最多渲染 `notification_email_max_items`（默认 10）条，其余只计数，末尾显示「还有 N 条，去站内查看」，这些行一并置为已发送，不拆成第二封。
- **模板**：`internal/static/assets/email/notification.tmpl`，一份通用列表模板（不按类型分文件），复用验证码邮件那套卡片样式；类型差异只体现在列表项文案上。
- **文案**：扩到 `internal/service/email.go` 的 `emailTextsByLanguage`（5 种语言），**语言跟收件人的 `user.Language`**，不是站点默认语言。
- **正文不放全文**：列表项是截断的摘要，链接指向站内具体位置（未登录会先跳登录再回到目标，`redirect_back`）。
- **限速**：`utils.AllowRequest("notify_email:"+userID, notification_email_hourly_limit, time.Hour)`（`pkg/utils/ratelimit.go` 现有签名是 key + 次数 + 窗口），防止有人恶意刷别人邮箱。
- **退订 / 管理偏好**：邮件底部只有一个链接 `{site}通知设置` → `/notification-settings?token=...`（N11）。汇总邮件里混着多种类型，按类型退订本来就不成立，所以把「改偏好」整件事交给一个页面。没有一键入口的自动邮件很容易被点"标记为垃圾邮件"，会毁掉发信域名信誉。
  - `token = HMAC-SHA256(secret, userID|"notif-prefs"|exp)`，有效期 72 小时，**只能作用于通知偏好接口**（中间件解析后写受限身份，改不了昵称/密码/邮箱）。
  - `GET ?token=` 只渲染页面，任何修改都必须 `POST`，所以邮箱安全扫描器预取链接不会误操作。
  - 过期或无效 → 页面提示「链接已过期，请登录后继续」并弹登录框，登录成功后**留在本页**。
- **重试**：整批失败按 1m / 5m / 30m 退避（整批重发，不做部分重试），3 次后置 `failed` 并记 `EmailLastErr`，不再重试；批次标识写进 `X-NeoBlog-Notification-Batch` 头，方便排查重复。

### 6.3 投递 worker

参照 `internal/agentrunner` 的形状，但要简单得多（无 LLM、无长任务）：

```
internal/tasks/notification_email.go
  runPeriodically("notification_email", 30s, func() {
      1. 取 email_state='pending' AND email_next_at <= now ORDER BY user_id, id LIMIT 500
      2. 按 user_id 分组（一组 = 一封邮件）
      3. 逐组：条件更新 pending → sending（WHERE id IN (...) AND email_state='pending'），
         领到的行才是本封的“主列表”
      4. 拉附带行：WHERE user_id=? AND email_state='attached'
                   AND created_at > now()-attach_hours
                 ORDER BY created_at DESC LIMIT attach_max   -- 另用 count 查询取总数，用于「另有 N 个赞」
      5. 渲染（主列表 + 「另外」分区）并发送：成功 → 全部 sent；
         附带行超窗口的 → skipped；失败 → 整批回 pending 并退避
  })
```

- **超出 `attach_max` 的附带行不置 `skipped`**，它们继续挂着等下一封（下一次重要邮件再搭），只有超过 `attach_hours` 才由清理任务置 `skipped`。

- `email_next_at` 只给**重要**行算（`created_at + interval`）；附带行直接 `email_state='attached'`、没有 `email_next_at`，**扫表永远命中不到它们**，所以不会自己发信。
- `runPeriodically` 已保证多副本时每轮只有一个实例执行（`pkg/sharedstate.ClaimRound`）；组级抢占用上面的条件更新兜底，被别的实例领走的行 `RowsAffected` 对不上，直接跳过。
- 不引入新的队列 / 租约表：`notifications` 自己的 `email_state` 就是 outbox 状态机（pending / attached / sending / sent / failed / skipped）。

### 6.4 清理

`internal/tasks/notification_cleanup.go`：保留期默认 180 天（可配置），按 `created_at` 硬删通知与事件；已读且超过保留期的先删。与 `visit_log_cleanup` 同构。同一个任务顺手把 `email_state='attached'` 且 `created_at` 超过 `attach_hours` 的行置 `skipped`，否则长期没有重要邮件的用户会让附带行永远挂在 `attached`。

## 7. 已读与未读

- 已读状态**只在通知行上**：`ReadAt *time.Time`，NULL = 未读。
- **未读单位是聚合行（组），不是单条通知**：50 个赞归并成 1 行，就只算 1 个未读（X 的口径）。
- 单条已读：`POST /notifications/:id/read`，幂等；若该 `id` 属于聚合组，则**整组一起置已读**（按 `type + target_type + target_id + 自然日` 条件批量更新），返回整组。
- 一键已读：`POST /notifications/read-all`，body 可带 `{ before_id }`，避免把请求期间新到的通知也标掉；它标的是全部行（含点赞）。
- 未读数：`GET /notifications/unread-count`，返回**未读组数**（对分组后的结果 `COUNT(*)`，点赞组也算，N3），前端超过 99 显示 `99+`。
- 交互：**点开单条即已读**（乐观更新，失败回滚）；页面提供显式的「全部标为已读」按钮；**不做"进入页面自动全部已读"**，用户会漏看。

## 8. 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/v1/notifications` | 登录 | 列表；查询参数 `filter=all / unread`、`type=`、`page`、`size`（沿用 `PaginationParams`） |
| GET | `/api/v1/notifications/unread-count` | 登录 | `{ total, by_type: {...} }`（`total` 与 `by_type` 都是**组数**） |
| POST | `/api/v1/notifications/:id/read` | 登录 | 单条已读，幂等 |
| POST | `/api/v1/notifications/read-all` | 登录 | `{ before_id?: uint }` |
| GET | `/api/v1/notifications/preferences` | 登录 / 邮件 token | 读出当前用户偏好（未设置时返回默认）；token 走请求头 `X-Notify-Prefs-Token` |
| PUT | `/api/v1/notifications/preferences` | 登录 / 邮件 token | 保存偏好；带 token 时**只接受通知相关字段**，其它字段一律忽略 |
| POST | `/api/v1/notifications/preferences/unsubscribe-all` | 登录 / 邮件 token | 一键关掉全部通知邮件（页面上的「全部关闭邮件」按钮） |
| POST | `/api/v1/admin/notifications/test` | 管理员 | 给自己发一条测试通知（站内 + 可选邮件），与后台测试发信同构 |
| GET | `/api/v1/notifications/stream` | 登录 | P2：SSE 实时推送 |
| GET | `/api/v1/admin/notifications/deliveries?state=failed` | 管理员 | P2：投递失败排查 |

DTO 字段沿用仓库约定（后端 snake_case，前端 camelCase 由请求层转换）。

## 9. 权限与隐私

- **只能读自己的**：所有读写接口都按 `user_id = 当前用户` 过滤；`id` 命中他人通知时返回 404（不暴露存在性）。
- **管理员也不能读别人的通知**。这是个人数据而不是站内资源，"admin 最高权限"不覆盖这里。管理员需要的不是"看别人的通知"，而是"确认功能可用"——给一个「给我自己发一条测试通知」的入口（与刚做的邮件测试同构）。
- **不泄露收件人看不见的内容**：私密评论 / 私密文章在产生事件前就过可见性判断（3.2 规则 4）；邮件正文只带摘要，不带收件人本来看不到的东西。
- **不暴露邮箱**：通知数据里不带任何邮箱；邮件 `From` 用站点发件地址。
- **退订 token** 用 HMAC，不落库、可过期；比较用 `hmac.Equal`。

## 10. 前端

### 10.1 入口

头像下拉菜单第一项「通知」+ 未读数徽标（`Bell` 图标 + `Badge`）。顶栏已经有灵动岛、搜索，不再加独立图标位。站内已有 `island-feedback.tsx` 的灵动岛短提示，P2 可以用来做"来了新通知"的即时反馈。

### 10.2 通知页 `/notifications`

- `Tabs`：全部 / 未读 / 回复 / 点赞。**线程活动（`comment.thread_replied`）并入「回复」tab**，不单独开一个。
- 按日期分组（今天 / 昨天 / 更早），行内：actor 头像 + 文案 + **目标标题 + 正文摘要（截断 60 字，纯文本，N16 已定）** + 相对时间；未读行左侧小圆点。
- **聚合行**（3.4）：显示「A、B 和另外 12 人赞了你的文章《x》」，头像堆叠、不展开；点击即整组已读。列表接口不用两个数据源拼接，就是一条分组查询。
- 顶部「全部标为已读」；空状态用 `Empty`；加载用 `Skeleton`；触底加载（`IntersectionObserver`）。
- 文案**在前端渲染**（存结构化数据，`next-intl` 按 `type` 取模板），切界面语言即时生效。

### 10.3 深链

通知点进去要能落到那条评论。现状是评论组件没有任何锚点或定位能力（`GetCommentListReq` 支持 `root_id`，但前端没有消费），所以这是 P0 的前置小需求：

`?comment=<id>` → 查该评论的 root → 拉整条线程（`root_id`）→ 展开 + 高亮 + `scrollIntoView`。文章 / 页面被点赞的通知直接跳 `getPostUrl` 即可，不需要这个。

### 10.4 偏好设置

**所有可操作项都在独立的公开页 `/notification-settings`**，`/console/user-preference` 只放一行引导。

- 页面路由：`web/src/app/(main)/notification-settings/page.tsx`（带 `(main)` 布局，未登录也能访问）。
- 三种访问态：
  - 已登录（cookie）→ 正常读写自己的偏好；
  - 邮件里的 `?token=` → 受限身份，只能读写通知偏好；
  - 未登录且无 token → 只渲染提示 + 「登录」按钮（点开顶栏同一个登录弹窗），**不渲染表单**，避免出现点不动的开关。
- 页面内容，复用 `react-hook-form` 分组布局，抽成 `NotificationPreferencesForm` 组件：
  - **站内**：评论 / 回复 / 点赞 三个开关；**AI 互动**一个独立开关（N9，默认开，文案说明关掉后 AI 的互动连通知都不产生）。
  - **邮件**：只有一个总开关（邮件只由真人评论 / 回复触发）+ 一行说明「点赞与 AI 互动不会单独发邮件，会随下一次评论或回复一起提醒」。
  - 底部「全部关闭邮件」按钮（`POST preferences/unsubscribe-all`）。
- 站点级没开放的类型**直接不显示**（不灰显，N2），列表底部一行小字「站点当前只开放评论与回复邮件」。
- 响应头带 `Referrer-Policy: no-referrer`，避免 URL 里的 token 随外链泄漏。

`/console/user-preference`（现有的配色 + AI 写作习惯页）**不放任何通知表单**，只加一块引导：

```
通知设置
站内与邮件通知的开关统一在通知设置页里管理。
[ 前往通知设置 → ]        ← Link href="/notification-settings"
```

### 10.5 文案

5 种语言都要补（`web/src/locales/`），`registry.test.ts` 会校验子集与占位符。

## 11. 性能与容量

- 写放大：一次点赞 = 1 事件 + 1 通知；一次评论 = 1 事件 + 1 通知。以本站互动量级（日均几十到几百）两张新表毫无压力。
- 邮件完全异步，不占请求链路。
- 未读数查询走覆盖索引，不做缓存；将来真热了再用 `sharedstate` 缓存计数。
- 保留期清理见 6.4。

## 12. 配置项

站点级（`internal/config/items.go`，`account` 页签）：

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `notification_email_enable` | bool | false | 是否发送通知邮件（站内通知不受影响） |
| `notification_email_types` | enum 列表 | 评论 + 回复 | 哪些类型算「重要」、允许触发邮件；点赞与线程活动永远只是附带，不进这个列表（见 16 章 N2） |
| `notification_email_interval` | int（分钟） | 10 | 重要消息的汇总间隔；0 = 每轮（30 秒）即发 |
| `notification_email_attach_hours` | int（小时） | 24 | 附带行（点赞 / AI）能搭车多久；超时未搭上就置 `skipped` |
| `notification_email_attach_max` | int | 5 | 单封邮件里附带行最多几条，超出只显示「另有 N 个赞」 |
| `notification_email_max_items` | int | 10 | 单封邮件里重要项最多列出几条 |
| `notification_email_hourly_limit` | int | 20 | 单用户每小时邮件上限 |
| `notification_thread_include_author` | bool | true | 线程活动是否也通知主题作者（N6=c 的可关开关） |
| `notification_retention_days` | int | 180 | 通知保留天数 |

用户级：`users.notification_prefs`（4.3）。

配置组放在 `internal/config/items.go` 的 `account` 页签里新开一组 `notification`（与已有的 `email` 组并列）。

token 密钥：**不新增配置项**，用 `utils.Jwt.SigningSecret()`（`JWT_SECRET`，代码注释里本来就写着「其他自签令牌由它派生密钥」）派生子密钥 `HMAC-SHA256(secret, "notif-prefs")`，避免多个用途共用同一个原始密钥。

## 13. 分阶段与任务清单

共 3 个阶段、25 个任务。每行给出「产出 / 验收 / 依赖」，估时含自测但不含 review 往返。

### 13.1 P0 站内闭环（5–6 天）

#### P0-A 地基（约 1.5 天，必须先做完）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| A1 | 类型常量 + 站点配置项 | `pkg/constant/constant.go` 加 5 个 `NotificationType*`；`internal/config/items.go` 在 `account` 页签新开 `notification` 组（8 个键 + 5 语言标签） | `go test ./internal/config/`；后台「账号」页签能看到新分组 | 0.25 |
| A2 | 两张表 + `users.notification_prefs` 列 | `internal/model/interaction_event.go`、`internal/model/notification.go`；`users.NotificationPrefs`；`internal/repo/init.go` 注册 | `go test ./internal/repo/`；跑起来的库里 `interaction_events` / `notifications` 与 3 个唯一索引都在；`migrate_test.go` 覆盖旧库升级 | 0.5 |
| A3 | 偏好读写 + 抑制规则（纯逻辑） | `internal/service/notification_prefs.go`（默认值合并、站点白名单 ∩ 用户选择、`ai_interactions`）；3.2 规则 1–6 抽成纯函数 | 单测逐条覆盖 6 条抑制规则 + 偏好合并 + 白名单交集 | 0.5 |
| A4 | 去重键与文案截断工具 | `pkg/utils` 或 service 内部：`BuildDedupeKey(event)`、`TruncateRunes`、剥 HTML / 合并空白 | 单测覆盖 15.4 的截断与降级（标题 40 / 正文 60 / 引用 40 / 昵称 20） | 0.25 |

#### P0-B 写入链路（约 1.5 天，依赖 A）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| B1 | 通知 repo | `internal/repo/notification.go`：`Create`、`UpsertThreadAggregate`（折叠行 upsert）、`DeleteByDedupe`、`List`（3.4 的分组查询）、`UnreadCount`（组数）、`MarkRead`（整组）、`MarkAllRead` | repo 单测：分组归并结果、未读组数、整组已读、折叠行 count 累加 | 0.5 |
| B2 | `NotificationService.Emit` | `internal/service/notification.go`：抑制 → 归类 → 写事件 → 写通知 / upsert 折叠行 → 初始化邮件状态（5.2） | service 单测：重要 vs 附带、`email_state` 取值、事件与通知都落库 | 0.5 |
| B3 | 事务改造 | `repo.Comment.CreateComment` / `repo.Like.ToggleLike` 加可选 `tx`（5.2 方案 A） | 单测：业务失败时事件与通知都不落库 | 0.25 |
| B4 | 点赞接入 | `internal/service/like.go`：点赞写事件 + 通知；取消点赞硬删通知 | 单测：连点赞/取消/再点赞只留一条通知；取消后通知消失 | 0.25 |
| B5 | 评论接入（含线程折叠） | `internal/service/comment.go`：`comment.created`、`comment.replied`、`comment.thread_replied`（回溯线程根用 `parent.RootID` / `parent.ID`，见 `repo/comment.go:140`）；主题作者开关 | 单测：4 种收件人组合（主题作者 / 线程发起人 / 直接父评论者 / 自己）与折叠行当天只一行 | 0.5 |

#### P0-C 接口（约 0.5 天，依赖 B）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| C1 | DTO + controller + router | `internal/dto/notification.go`、`internal/controller/notification.go`、`internal/router/apiv1/notification.go`（8 章里的前 4 条 + 偏好 3 条） | router 测试：他人 `id` 返回 404、未登录 401、`read-all` 带 `before_id` 正确 | 0.5 |

#### P0-D 前端（约 2 天，依赖 C）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| D1 | API + 模型 | `web/src/api/notification.ts`、`web/src/models/notification.ts`（字段 camelCase，走 `axiosClient`） | `npx tsc --noEmit` | 0.25 |
| D2 | `/notifications` 页 | `web/src/app/(main)/notifications/`：Tabs（全部/未读/回复/点赞）、日期分组、聚合行（头像堆叠）、摘要 60 字纯文本、未读圆点、`Skeleton` / `Empty`、触底加载、「全部标为已读」 | 手动：50 个赞 = 1 行 1 未读；点开整组已读；切语言文案即时生效 | 1 |
| D3 | 头像菜单入口 + 徽标 | `web/src/components/layout/nav/avatar-with-dropdown-menu.tsx` 第一项「通知」+ `Badge`；`unread-count` 轮询（60s + 页面可见性） | 点赞后 60s 内徽标 +1；`99+` 截断 | 0.25 |
| D4 | `?comment=` 深链 | 评论组件支持「按 comment id 定位 → 展开线程 → 高亮 → `scrollIntoView`」（10.3） | 从通知点进去能落在目标评论上 | 0.5 |
| D5 | 偏好页（登录态） | `web/src/app/(main)/notification-settings/page.tsx` + `NotificationPreferencesForm`；`/console/user-preference` 加引导块（10.4） | 三种访问态正确；站点未开放的类型不显示 | 0.5 |
| D6 | 5 语言文案 | `web/src/locales/*`（通知页、偏好页、菜单、配置项标签） | `pnpm lint`；`registry.test.ts` 的占位符校验通过 | 0.5 |

#### P0-E 验收（约 0.5 天）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| E1 | 管理员测试通知 | `POST /api/v1/admin/notifications/test`（给自己发一条站内通知，与后台测试发信同构） | 后台点了能看到通知；不写邮件、不受 `email_enable` 限制 | 0.25 |
| E2 | 回归与手测清单 | `go test ./...`、`go build -o bin/server ./cmd/server`、`cd web && pnpm lint && npx tsc --noEmit`；手测：点赞 / 评论 / 回复 / 线程多人对话 / 取消点赞 / 已读 / 徽标 / 深链 / AI 开关 | 全部通过，问题登记到 17 章 | 0.25 |

### 13.2 P1 邮件（2–2.5 天）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| F1 | 邮件模板 | `internal/static/assets/email/notification.tmpl`：主列表 `<ol>` + 「另外」分区 + 底部单一「通知设置」链接；复用验证码邮件卡片样式 | 本机起 SMTP sink（`smtp_sink.py`）用真实发信验一遍观感 | 0.5 |
| F2 | 邮件文案 ×5 语言 | `internal/service/email.go` 的 `emailTextsByLanguage` 补 15.2 行 1–9 的列表项与主题 | 单测：5 语言渲染都拿到非空文案、变量齐全 | 0.5 |
| F3 | 投递 worker | `internal/tasks/notification_email.go`：6.3 的 5 步（扫 pending → 分组 → 条件抢占 → 拉附带行 → 渲染发送） | 单测：只有重要行触发；附带行搭车；超 `attach_hours` 不搭；超 `attach_max` 折叠成「另有 N 个赞」；主题 `{count}` 只数重要项 | 0.75 |
| F4 | 重试与限速 | 1m / 5m / 30m 退避、3 次后 `failed`、`X-NeoBlog-Notification-Batch` 头、`AllowRequest` 每小时上限 | 单测：失败三次后不再重试；超限直接 `skipped` | 0.25 |
| F5 | 清理任务 | `internal/tasks/notification_cleanup.go`：保留期硬删 + `attached` 超窗口置 `skipped` | 单测：过期行被删、超窗口附带行变 `skipped` | 0.25 |
| F6 | 免登录偏好页 | token 签发（`utils.Jwt.SigningSecret()` 派生子密钥）+ 中间件受限身份 + `X-Notify-Prefs-Token`；前端三种访问态与过期弹登录 | 单测：token 只能改通知字段、72h 过期、`GET` 无副作用；改昵称接口带 token 被拒 | 0.5 |

### 13.3 P2 体验（约 1 天）

| 编号 | 任务 | 产出 | 验收 | 估时 |
|---|---|---|---|---|
| G1 | SSE 实时 | `GET /api/v1/notifications/stream` + `sharedstate.Notify` 跨实例唤醒；前端替换轮询 | 多副本下一个实例收到互动，另一个实例的页面也收到 | 0.5 |
| G2 | 关注此帖 / 此线程 | 手动订阅（X 的 per-post 订阅）：订阅后该目标下新回复逐条通知 | 订阅/取消订阅生效，未订阅不受影响 | 0.5 |
| G3 | 投递失败面板 | `GET /api/v1/admin/notifications/deliveries?state=failed` + 后台页面 | 能看到失败原因、手动重试一条 | 0.25 |
| G4 | 灵动岛提示 | 复用 `island-feedback.tsx` 做「来了新通知」即时反馈 | 新通知到达时出现短提示，点击跳通知页 | 0.25 |
| G5 | 聚合行展开明细 | 点赞聚合行可展开看具体是谁 | 展开后仍算 1 个未读 | 0.25 |

### 13.4 关键路径与顺序

```
A1 → A2 → A3 → B1 → B2 → B3 → B4 / B5 → C1 → D1 → D2 → D3 / D4 / D5 → D6 → E1 → E2
                                                        ↑
                                                  P1: F1 / F2 可与 D 并行
```

- **A 阶段做完之前不要碰业务代码**：模型与抑制规则定下来，后面 B/C/D 才不会返工。
- **D4（深链）是唯一要动既有评论组件的前端任务**，单独一个 PR 更安全。
- **F1 / F2（模板与文案）不依赖后端**，可以和 D 阶段并行。
- G 阶段全部独立，任意顺序。

### 13.5 实施前的三个待确认

1. **事务方案 A 还是 B**（5.2）：A 要改 2 个 repo 签名，B 退化成事务后 hook。倾向 A。
2. **`?comment=` 深链的现有实现程度**（10.3 / D4）：需要先看 `web/src/components/comment/` 现在能不能按 id 定位，这决定 D4 是 0.5 天还是 1.5 天。
3. **`user.TimeZone` 的填充率**（3.4 分天）：现在默认空，全站都会落到服务器时区。若打算补，是另一个前端小需求，不阻塞本 spec。

## 14. 术语

| 术语 | 含义 |
|---|---|
| 事件 | 一次互动事实（谁对什么做了什么），与收件人无关 |
| 通知 | 事件对某个收件人的一份投递记录，带已读状态 |
| 投递 | 某渠道的一次送达尝试 |
| 收件人 | 被互动内容的作者；多数事件只有一个，线程活动类有两个（线程发起人 + 主题作者） |
| 抑制 | 因隐私或噪音原因不产生通知的规则 |
| 汇总邮件 | 一个收件人一轮内攒下的全部通知合并成的一封列表邮件 |
| 重要 / 附带 | 真人评论回复算重要（触发邮件）；点赞与 AI 互动算附带（只搭车） |
| 主题作者 | 文章 / 页面的作者。**文档里不用「楼主」**，避免和评论线程混淆 |
| 线程发起人 | 某条顶层评论的作者（口语里的「楼主」通常指他） |
| 聚合行 | 站内把同类型 + 同目标 + 同一天的多条通知归并成的一行，算 1 个未读 |
| 汇总间隔 | 重要消息攒多久合成一封，默认 10 分钟 |
| 深链 | 从通知直接定位到具体某条评论的位置 |

---

## 15. 事件与文案总表（参考）

本节是**唯一文案源**：站内列表、邮件列表、邮件主题都从这里取。当前只写中文，其余 4 种语言等文案定稿后一次性翻译。

### 15.1 事件类型总表

覆盖 5 种已实现的互动事件 + 2 种备选（状态列：✅ 本 spec 实现 / ⬜ 未实现，仅占位）：

| # | 事件类型 | 含义 | 触发点 | 被互动对象 | 收件人 | 去重键 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | `comment.created` | 评论了你的**文章** | `CommentService.CreateComment`（`ReplyID=0`、`TargetType=post`） | `post` | 文章作者 | `comment.created:post:<postID>:comment:<newID>` | ✅ |
| 2 | `comment.created` | 评论了你的**页面** | 同上，`TargetType=page` | `page` | 页面作者 | `comment.created:page:<pageID>:comment:<newID>` | ✅ |
| 3 | `comment.replied` | 回复了你的**评论** | `CreateComment`（`ReplyID≠0`） | `comment`（你的那条） | 被回复评论的作者 | `comment.replied:comment:<被回复ID>:comment:<newID>` | ✅ |
| 4 | `post.liked` | 赞了你的**文章** | `LikeService.ToggleLike` | `post` | 文章作者 | `post.liked:post:<postID>:user:<actorID>` | ✅ |
| 5 | `comment.liked` | 赞了你的**评论** | `LikeService.ToggleLike` | `comment` | 评论作者 | `comment.liked:comment:<commentID>:user:<actorID>` | ✅ |
| 6 | `comment.mentioned` | 在评论里 **@** 了你 | `CreateComment`（v1 不做，见 16 章 N7） | `comment` | 被提及的人 | `comment.mentioned:comment:<commentID>:user:<mentionedID>` | ⬜ |
| 7 | `comment.thread_replied` | 你发起的那串评论里，别人在互相回复 | `CreateComment`（回溯线程根） | `comment`（线程根） | 线程发起人 + 主题作者（后者可站点级关） | `comment.thread_replied:comment:<rootID>:day:<yyyymmdd>:user:<recipientID>` | ✅ P0（N6=c） |

说明：

- **没有 `page.liked`**：`ToggleLike` 只接受 `post` / `comment`，页面不支持点赞。将来要加的话就是第 6 种已实现类型，文案套 `post.liked` 换掉名词。
- **深度 > 0 的评论都是 `comment.replied`**，不区分“回复楼中楼”。
- **私密评论、纯附件评论、AI 用户发的评论都不是新类型**，只是同一类型的文案变体，见 15.4。
- **系统通知**（账号禁用、角色变更、站点公告）不是互动事件，不进上表；通知表将来直接加 `system.*` 类型即可，模板与列表结构不用改。

### 15.2 文案表

变量含义见 15.4。行号对应 15.1；`《》` 包标题、`「」` 包被引用评论、`：` 引出新正文。

| # | 事件类型 | 站内列表文案 / 邮件列表项 | 单条邮件主题 | 点击跳转 |
|---|---|---|---|---|
| 1 | `comment.created`（文章） | `{actor} 评论了你的文章《{subject}》：{excerpt}` | `{actor} 评论了你的文章 · {site}` | `/p/{slug}?comment={commentID}` |
| 2 | `comment.created`（页面） | `{actor} 评论了你的页面《{subject}》：{excerpt}` | `{actor} 评论了你的页面 · {site}` | `/page/{slug}?comment={commentID}` |
| 3 | `comment.replied` | `{actor} 回复了你在{文章/页面}《{subject}》下的评论「{quoted}」：{excerpt}` | `{actor} 回复了你的评论 · {site}` | `/p/{slug}?comment={commentID}` 或 `/page/…` |
| 4 | `post.liked` | `{actor} 赞了你的文章《{subject}》` | `{actor} 赞了你的文章 · {site}` | `/p/{slug}` |
| 5 | `comment.liked` | `{actor} 赞了你的评论「{quoted}」` | `{actor} 赞了你的评论 · {site}` | `/p/{slug}?comment={commentID}` |
| 6 | 点赞聚合行（3.4） | 文章：`{actor1}、{actor2} 和另外 {rest} 人赞了你的文章《{subject}》`；评论：`{actor1}、{actor2} 和另外 {rest} 人赞了你的评论「{quoted}」` | 不单独发（只在汇总邮件里） | 同该目标 |
| 7 | 邮件「另外」分区（附带项） | `另有 {n} 个赞` / `{actor} 也赞了你的评论` / `AI 助手 也回复了你` / `另有 {n} 条线程回复` | 不单独发 | 站内点赞 tab |
| 8 | `comment.thread_replied`（收件人 = 线程发起人） | `{actor1}、{actor2} 和另外 {rest} 人在你在《{subject}》下的评论里回复了` | 不单独发（附带） | `/p/{slug}?comment={rootCommentID}` |
| 9 | `comment.thread_replied`（收件人 = 主题作者） | `{actor1}、{actor2} 和另外 {rest} 人在你的文章《{subject}》的评论区回复了` | 不单独发（附带） | `/p/{slug}` |

邮件多条时主题统一为 `你有 {count} 条新互动 · {site}`，正文顶部再给一句 `过去 {interval} 有 {count} 条新互动`。主题里的 `{count}` **只数重要项**（附带项不上主题），否则一个 50 赞的用户会看到“你有 50 条新互动”却没几条真对话。

### 15.3 渲染样例（中文，参考观感）

样例数据：`actor=林小满`、`subject=关于把博客换成 Next.js 这件事`、
`quoted=第三段那个字体是霞鹜文楷吗？`、`excerpt=是霞鹜文楷，站内就是它`、`site=Snowykami's Blog`。

站内列表（顶栏下拉面板 / `/notifications` 页）：

```text
今天
  林小满  评论了你的文章《关于把博客换成 Next.js 这件事》：是霞鹜文楷，站内就是它        12:31
  阿雪    赞了你的评论「第三段那个字体是霞鹜文楷吗？」                                        11:02
  阿雪    回复了你在文章《关于把博客换成 Next.js 这件事》下的评论「第三段那个字体是霞鹜文楷吗？」：
          对，正文和代码块都是霞鹜文楷                                           昨天 22:07
```

邮件（一封汇总，3 条）：

```text
主题：你有 3 条新互动 · Snowykami's Blog

过去 10 分钟有 3 条新互动                          [在站内查看全部]

1. 林小满 评论了你的文章《关于把博客换成 Next.js 这件事》：是霞鹜文楷，站内就是它
2. 阿雪 赞了你的评论「第三段那个字体是霞鹜文楷吗？」
3. 阿雪 回复了你在文章《关于把博客换成 Next.js 这件事》下的评论
   「第三段那个字体是霞鹜文楷吗？」：对，正文和代码块都是霞鹜文楷

— 通知设置：{{site}}/notification-settings?token=xxxx
```

### 15.4 变量与边界

变量定义：

| 变量 | 含义 | 来源字段 | 截断 | 为空时 |
|---|---|---|---|---|
| `{actor}` | 触发者昵称，无昵称时用用户名 | `User.Nickname / Username` | 20 字 | `已注销用户` |
| `{subject}` | 文章 / 页面标题快照 | `SubjectTitle` | 40 字，超出加 `…` | `（内容已删除）` |
| `{excerpt}` | 本次评论 / 回复正文 | `Excerpt` | 60 字，超出加 `…` | 见下方“纯附件”行 |
| `{quoted}` | 被回复 / 被点赞的评论正文 | `QuotedExcerpt` | 40 字，超出加 `…` | 去掉引用片段，降级句式 |
| `{site}` | 站点名 | `tools.GetSiteName()` | — | — |
| `{count}` `{interval}` | 条数 / 汇总间隔 | worker 计算 | — | — |
| `{actor1}` `{actor2}` `{rest}` | 聚合行里的前 2 个昵称 + 剩余人数 | 分组查询 | 昵称 20 字 | 只剩 1 人时用单数文案（15.2 行 4/5） |
| `{n}` | 未展示的附带项数量 | worker 计算 | — | — |

边界与降级：

| 情况 | 处理 | 降级后的文案 |
|---|---|---|
| 私密评论 | 末尾加 `（私密）`，提醒收件人这条不会公开 | `{actor} 评论了你的文章《x》：内容（私密）` |
| 纯附件评论（正文为空） | `{excerpt}` 换成附件占位 | 1 个附件：`[图片]` / `[附件]`；多个：`[图片 ×3]` |
| 正文含换行 / HTML | 合并空白、剥标签后再截断 | — |
| `{quoted}` 为空（原评论已被删） | 去掉引用片段 | `{actor} 回复了你的评论：{excerpt}` |
| 被点赞的评论已被删 | `*.liked` 通知直接删掉（无意义） | — |
| 被评论的文章 / 页面已删 | `comment.*` 保留，标不可点 | `{actor} 评论了你的文章（已删除）` |
| actor 已注销 | 头像用默认图 | `已注销用户 赞了你的评论「…」` |
| actor 是 AI 用户 | 头部多一个 `AI` 小徽标（邮件文本里写 `AI 助手`），其余一致 | `AI 助手 回复了你在文章《x》下的评论「…」：…` |
| 收件人就是 actor | 不产生通知（见 3.2 规则 1） | — |
| 附带行超过 attach_hours 未搭上车 | 置 `skipped`，不再出现（不能永久积压） | — |
| 附带行超过 attach_max | 只留前 `attach_max` 条，其余折成 `另有 {n} 个赞` | `另有 12 个赞` |
| 聚合组只有 1 人 | 不算聚合，用 15.2 行 4/5 的单人文案 | `林小满 赞了你的文章《x》` |
| 线程折叠行只有 1 条 | 用单人文案 | `林小满 在你在《x》下的评论里回复了` |
| 线程根评论已被删 | 折叠行保留，标题降级为主题标题 | `林小满 等 5 人在《x》的评论区回复了` |
| 同一线程当天已读后又来新回复 | `read_at` 置回 NULL，重新变未读（避免"读过就永远收不到"） | — |

文案键名（供实现参考，不强制）：站内 `Notifications.types.<事件类型>_<subjectType>`，邮件 `emailTexts.notify.<事件类型>_<subjectType>`，二者字段与顺序保持一致，避免两边文案对不上。

---

## 16. 已定事项

下面这些已经拍板，并已回填到正文对应小节，**不需要再确认**；要推翻请直接说编号。

| 编号 | 结论 | 正文落点 |
|---|---|---|
| N1 | 点赞：站内通知发，**邮件永不单独发**（只搭车） | 3.1 / 6.2 |
| N4 | 重要消息汇总间隔 10 分钟（`notification_email_interval`）；点赞按 N1 只搭车，不再有单独间隔 | 6.2 / 6.3 / 12 |
| N5 | 已读：显式「全部标为已读」+ 点开单条即已读，不做进页面自动全读 | 7 |
| N7 | v1 不做 @提及，`comment.mentioned` 只留占位 | 1.2 / 15.1 |
| N8 | 入口：头像下拉菜单第一项 + 未读徽标，不加独立铃铛 | 10.1 |
| N10 | 保留期 180 天，`notification_retention_days` 可配 | 6.4 / 12 |
| N12 | 深链要定位 + 高亮 + 展开线程，`?comment=` 是 P0 前置小需求 | 10.3 |
| N13 | 邮件模板就一份通用列表模板 | 6.2 |
| N14 | 投递失败面板放 P2 | 13.3 |
| N15 | 标点：标题 `《》`、引用 `「」`、正文用 `：` 引出 | 15.2 |
| N16 | 站内列表带正文摘要，截断 60 字，按纯文本渲染 | 10.2 / 15.4 |
| S1 | 邮件只由「重要」消息（真人评论 / 回复）触发；点赞与 AI 互动只搭车，24 小时窗口、最多 5 条，超时置 `skipped` | 3.1 / 6.2 / 6.3 / 12 |
| S2 | 站内按 X 式聚合行归并（同类型 + 目标 + 自然日），一个聚合行 = 1 个未读 | 3.4 / 7 / 10.2 / 15.2 |
| N2 | 站点级邮件类型是**白名单上限**：用户只能关不能开；站点未开放的类型在偏好页**直接隐藏**（不灰显） | 12 / 4.3 |
| N3 | 未读徽标 = 未读聚合组总数，**点赞组也算**（X 口径） | 7 / 3.4 |
| N9 | AI 互动给一个独立总开关（`notification_prefs.ai_interactions`，默认开）；关掉后连站内通知行都不产生 | 3.2 / 4.3 / 10.4 |
| N11 | 独立公开页 `/notification-settings`；邮件里只放一个带 token 的链接，token 只能操作通知偏好、72 小时有效、`GET` 无副作用；`/console/user-preference` 只放引导文本 + 链接 | 6.2 / 8 / 10.4 |
| N6 | **c**：补两个缺口——线程发起人与主题作者都收线程活动，按「线程 + 自然日」折叠成一行，主题作者可用 `notification_thread_include_author` 关掉；归类附带（不触发邮件） | 3.1 / 3.2 / 3.4 / 4.2 / 12 / 15.1 |

---

## 17. 待定事项

暂无。N1–N16、S1 / S2 全部落定（见 16 章）。P0、P1 已按 13 章实现完毕，P2 除「关注此帖 / 此线程」外也已实现。

### 17.1 P2 未实现：关注此帖 / 此线程

需要一个**新的第 6 种事件类型**（例如 `comment.subscribed`）、一张订阅表和一套新文案；而 1.2 又写着「订阅式推送不做」，两者需要先对齐口径再动手。实现记录见 18 章。

### 17.2 实现记录（与正文的差异，code review 时重点看）

| # | 差异 | 原因 |
|---|---|---|
| 1 | **不实现 6.1 的 `Channel` 接口**：站内写入即送达，邮件由 `internal/tasks/notification_email.go` 的定时 worker 直接发 | v1 只有两个渠道，其中一个不在请求路径上；抽象出来没有第二个调用方，等 WebPush 进来再抽 |
| 2 | `notifications.dedupe_key` **所有行都写入**（正文写的是「折叠行的 upsert 键」） | 唯一索引是 `(dedupe_key, user_id)`，普通行若留空会立刻互相冲突 |
| 3 | 站内偏好关掉某类型 = **不产生通知行**，因此该类型也收不到邮件 | 通知行是邮件的载体，一行同时承载站内与邮件状态；偏好页文案已写明 |
| 4 | 线程活动的站内文案统一用 15.4 的降级句式「…在《x》的评论区回复了」 | 「线程发起人」「主题作者」两种文案需要前端知道收件人身份，一行数据里没有这个字段；降级句意思不变 |
| 5 | 管理员测试通知走 `POST /admin/notifications/test`，写一条 `system.test` 事件 + 通知 | `(event_id, user_id)` 唯一索引让 `event_id=0` 的行互相冲突 |
| 6 | 通知邮件文案放在 `internal/service/email_notification.go`，没有并进 `email.go` 的 `emailTextsByLanguage` | 验证码邮件的结构体字段完全不同，混在一起两边都难读 |
| 7 | SSE 单条连接最多存活 10 分钟（到点前端自动重连），并保留 60 秒轮询兜底 | 客户端异常断开时服务端不容易感知，用寿命上限兜住连接泄漏；代理不支持长连接时仍有徽标更新 |
| 8 | 后台测试通知的入口是配置组顶部的 `<Widget: notification_test>` | 与「发送测试邮件」同构，不需要为它单独开一个页面 |
| 9 | 站内列表文案由前端按类型拼（`Notifications.types.*`），邮件由后端拼 | 界面语言要即时切换，邮件语言跟收件人的 `user.Language`，两边共用同一套变量与截断规则 |

### 17.3 未验证

- Postgres 上的分组查询（`CASE WHEN … || …` 与 `make_interval`）只有 SQLite 实际跑过，`NEO_TEST_POSTGRES_DSN` 未配置。
- 前端只做了构建与静态检查（`pnpm build`、`tsc`、`eslint`、`vitest`），没有在浏览器里点一遍完整流程（需要一份带数据的后端）。
- 邮件在真实 SMTP 上只验证过验证码邮件（本轮复用同一发送函数），通知汇总邮件只跑了模板渲染与 worker 单测。
