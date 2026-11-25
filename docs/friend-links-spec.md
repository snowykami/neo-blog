# 友链系统需求规格（Spec）

> 状态：方案已收敛，原型验证中（2026-11-25）

## 1. 目标与边界

在 `neo-blog` 内建友链系统，支持**预设多语言分组 + 单页锚点顺排展示、预设色板染色卡片、服务端双维拨测、用户自助申请与修改、AI 自动填表与 AI 初审、后台全量管理及跨站 `APIToken` 共享**。

设计原则：
- **认证零重复造轮子**：未登录态直接复用通用组件 `GuestLoginInvite`（小窗 OIDC 快捷登录 + 现成登录/邮箱验证码注册弹窗 `LoginDialogModal`），所有友链写操作统一归属到已登录 `User`；
- **全分组同页顺排**：前台 `/[locale]/friends` 顶部采用 `underline` 底线标签栏，左侧固定「全部」，右侧依次为各公开分组；切换标签仅做平滑锚点滚动定位（配合滚动监听自动高亮当前分组），上下顺序严格跟随后台分组排序；
- **可控色域与国际化**：友链背景色限定从覆盖全色域的 **16 / 32 色预设语义色板**中选择（支持从头像自动取最接近色），分组支持**内置预设类型自动多语言翻译**。

---

## 2. 身份、配额与审核机制

### 2.1 登录引导与配额

1. **未登录引导**：在友链申请区展示 `GuestLoginInvite`（`reason="friend_link"`），优先引导 GitHub / OIDC 小窗一键登录（不离开当前页、不消耗 SMTP 邮件日额度），无第三方账号者点击「登录」走现成快捷登录/注册弹窗。
2. **配额限制**：每个普通用户最多同时拥有 **5 条**友链（物理删除后额度立即恢复）；管理员 `admin` 不限数量。

### 2.2 审核状态机（「AI 初筛 + 人工最高裁决」）

状态枚举：`pending`（AI 审核中）、`pre_approved`（预通过，待人工复核）、`approved`（已公开展示）、`rejected`（已驳回）。

1. **新建与修改均触发重审**：普通用户新建或修改任意已有友链，状态均进入 `pending` 并异步触发 AI 审核；仅 `approved` 状态的友链对外公开。
2. **AI 三档结论**：
   - `approved`：站点可达、内容健康合规、博客属性明确，直接上线公开；
   - `pre_approved`：无明显违规但存在不确定项（如暂未检测到反链、刚建站内容较少、被盾拦截等），进入后台待复核队列；
   - `rejected`：违规、灰产、营销推广或死链，记录原因并通知用户。
3. **管理员最高权限**：仅 `admin` 拥有审核权与后台直管权，可随时直接新增免审友链，或覆盖任意友链的状态、分组、颜色与排序。

### 2.3 防刷限流（基于 `pkg/sharedstate`）

- **AI 自动填写**：仅登录用户可用，单用户每日上限 **10 次**，同一 URL 结果缓存 **12 小时**；
- **AI 友链审核**：单用户每日最多触发 **5 次**；超出当日限额后不阻断提交，自动跳过大模型直接置为 `pre_approved` 交由管理员复核。

---

## 3. 数据模型（2 张表）

### 3.1 友链分组表 `friend_groups`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uint` | 主键 |
| `preset_key` | `varchar(32)` | 预设分组键：`friends`（朋友）/ `seniors`（大佬）/ `official`（官方网站）/ `projects`（开源项目）/ `tech`（技术生态）/ `others`（其他链接）/ `custom`（自定义）；非 `custom` 时前台按 `next-intl` 自动国际化并匹配默认图标 |
| `name` | `varchar(64)` | `preset_key = 'custom'` 时的自定义名称（预设分组可留空或作后台备注） |
| `slug` | `varchar(64)` | 唯一标识，供页面锚点 `#group-{slug}` 与外部 `?group=slug` 查询 |
| `description` | `varchar(255)` | 可选分组副标题（预设分组未填时使用默认多语言副标题） |
| `sort_order` | `int` | 升序权重，同时决定顶部 `underline` 标签左右顺序与页面区块上下顺序 |
| `is_public` | `bool` | 是否在本站 `/friends` 公开展示（`false` 时仅管理员或 `friends:read` Token 可读） |
| `skip_backlink_check` | `bool` | 单向推荐分组（如官方网站、大佬）设为 `true`，跳过反链检查 |

### 3.2 友链主表 `friend_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uint` | 主键 |
| `user_id` | `uint` | 所属用户 ID（关联 `users.id`） |
| `group_id` | `uint` | 所属分组 ID（用户申请时可选意向分组或落入默认分组，管理员可改） |
| `name` | `varchar(64)` | 站点名称 |
| `url` | `varchar(512)` | 站点地址（仅限 `http/https`，按规范化域名防重） |
| `avatar` | `varchar(512)` | 头像 / Logo URL |
| `description` | `varchar(200)` | 一句话简介 |
| `color_key` | `varchar(32)` | 预设色板键名（对应全色域 16 / 32 色语义色板，如 `sky`、`cherry-blossom`、`amber`） |
| `backlink_url` | `varchar(512)` | 选填，对方悬挂本站友链的页面地址 |
| `sort_order` | `int` | 组内排序权重 |
| `status` | `varchar(16)` | `pending` / `pre_approved` / `approved` / `rejected` |
| `review_note` | `varchar(500)` | AI 初筛理由或管理员审核备注（仅本人与管理员可见） |
| `health_status` | `varchar(16)` | `unknown` / `healthy` / `slow` / `unreachable` |
| `latency_ms` | `int` | 服务端拨测耗时（`10ms` 取整，公开可读） |
| `fail_count` | `int` | 连续拨测失败次数（`>= 3` 次置为 `unreachable`，成功归零） |
| `backlink_status` | `varchar(16)` | `unchecked` / `verified` / `missing` / `skipped`（仅管理员可见） |
| `last_checked_at` | `*time.Time` | 最近拨测时间 |

---

## 4. 色板与服务端拨测

### 4.1 预设色板（16 核心色 / 32 全色域）

复用并对齐仓库现有的语义色域（`web/src/lib/lyrics/colors.ts`），禁止自由输入任意透明/极端明度 HEX，确保持久可读：
- 数据库仅存语义键 `color_key`（支持前端从头像提取主色后自动吸附到最近预设色）；
- 亮/暗主题渲染策略（通过原型实测对比择优）：
  - **OKLCH 明暗自适应派生（推荐）**：每个预设色固定色相 `H` 与适度彩度 `C`，浅色下派生高明度清透卡片底 + 深色同色相文字，深色下派生低明度微染卡片底 + 亮白文字，全色板对比度恒定 `>= 5.5:1`；
  - **单色透明度直混对照**：将固定基准色与卡片底按比例 `color-mix` 叠加。

### 4.2 服务端双维拨测

复用 `link_preview.go` SSRF 安全客户端，前端零探测请求：
- **存活延迟（每 6 小时）**：右上角 5 档信号格（`<1000ms` 3 格、`1000~1999ms` 2 格、`2000~2999ms` 1 格、`>=3000ms` 空框、连续失败 `>=3` 次 `×` 不可达）；
- **反链检查（提交首测 + 每 7 天）**：仅管理员后台可见（`verified / missing / skipped`）。

---

## 5. 前后台页面与开放接口

- **前台 `/[locale]/friends`**：
  1. 吸顶 `TabsList (variant="underline")`：`全部` + 各公开分组（点击锚点平滑滚动，手动滚动页面时 ScrollSpy 联动高亮当前分组底线）；
  2. 分组友链卡片墙（借鉴 Aria 圆角染色名片布局 + 右上角拨测信号格 + 随机串门）；
  3. 本站信息一键复制 + `GuestLoginInvite` / 已登录「我的友链（`x / 5`）」自助添加与编辑面板（支持 AI 自动填表、粘贴智能解析与色板实时预览）。
- **后台 `/[locale]/console/friends`**（仅 `admin`）：
  - `underline` 双标签：`友链管理`（待复核队列、AI 初筛意见、反链绿勾、新增/编辑/审核/重测）与 `分组与排序`（预设分组 i18n 选择、上下调序实时同步前台）。
- **开放接口**：`GET /api/v1/friends`（公开 CORS + `friends:read` / `friends:write` `APIToken` 支持读取私有分组）。
