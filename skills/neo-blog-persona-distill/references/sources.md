# 素材采集手册

通用规则：

- 只采集公开内容和用户提供的材料。不登录他人账号，不使用用户没有明确提供的 Cookie，不绕过登录墙、付费墙、验证码、反爬与 robots 限制；请求放慢，每个站点不要短时间内大量抓取。
- 被拦截时只试一次，然后请用户截图、复制或用平台自带的导出功能，不要换着法子硬抓。
- 每条素材记录：来源（URL 或文件名）、时间、作者是否为 TA 本人、类型（长文 / 短评 / 聊天 / 代码评论）。
- 区分原创和转发、引用：只有 TA 自己写的字才能用于分析说话方式；转发和收藏可以用于分析兴趣。
- 时间戳单独收集到 `corpus/timestamps.txt`，每行一个 ISO 8601 时间（尽量带时区偏移，如 `2025-03-02T23:41:00+08:00`）。

## GitHub

有 `gh` CLI 时优先用 `gh api`（已登录时额度更高），否则用 `https://api.github.com/...`（未登录每小时 60 次）。

| 目的 | 接口 |
| --- | --- |
| 基本资料与跨平台线索 | `gh api users/<u>`：`bio`、`blog`、`location`、`company`、`twitter_username` |
| 自我介绍 | `gh api repos/<u>/<u>/readme -H "Accept: application/vnd.github.raw"`（个人主页 README，可能不存在） |
| 技术栈与兴趣 | `gh api "users/<u>/repos?per_page=100&sort=pushed"`：语言、topics、描述、是否 fork |
| 兴趣 | `gh api "users/<u>/starred?per_page=100"`：收藏的项目反映关注点 |
| 说话方式与作息 | `gh api "users/<u>/events/public?per_page=100"`：最近 90 天的 issue 评论、PR 评审、提交信息，带时间 |
| 更多发言 | `gh api "search/issues?q=commenter:<u>&sort=updated&per_page=50"`，再读具体 issue 下 TA 的评论 |

时区与作息：GitHub 接口返回的时间多为 UTC。git 提交记录保留了作者本地的时区偏移，更准确：

```bash
git clone --filter=blob:none --no-checkout https://github.com/<u>/<repo> /tmp/distill-repo
# 排除带 AI 署名的提交（见下方「去除 AI 生成的内容」）
git -C /tmp/distill-repo log --author="<名字或邮箱>" -i --invert-grep \
  --grep="co-authored-by: (claude|copilot|cursor|codex|devin)" --grep="generated with" --grep="noreply@anthropic.com" -E \
  --format=%ad --date=iso-strict >> distill-<id>/corpus/timestamps.txt
```

选 TA 最近活跃、且以 TA 为主要作者的 1～3 个仓库。注意工作仓库的提交时间反映的是上班时间，不一定是逛博客的时间，写报告时说明。

issue 评论、PR 评审、提交信息是 TA 在技术场合的说话方式，往往比聊天更正式；和其他来源对比着看。

### 去除 AI 生成的内容

GitHub 上的提交信息、PR 描述和评论很多是 AI 写的，不代表 TA 的说话方式；AI Agent 还会在任意时间批量提交，让作息统计失真。下面这些内容不用于说话方式分析，时间也不计入作息：

- **机器人账号**：用户名以 `[bot]` 结尾，或接口返回的 `type` 为 `Bot`，如 dependabot、renovate、github-actions、copilot-swe-agent、coderabbitai。
- **带 AI 署名的提交**：提交信息里有 `Co-authored-by: Claude`、`Co-authored-by: Copilot`、`noreply@anthropic.com`、`Generated with Claude Code`、`🤖 Generated with` 等尾注，或提到 Cursor、Codex、Devin 等工具代写。
- **AI 写的 PR 和 issue**：带 `## Summary`、`## Test plan`、`## Changes` 这类固定小节，配大段整齐的列表；措辞过于工整、面面俱到；语言和 TA 平时不一致（比如平时说中文，这里却是大段流畅的英文）。
- **AI 评审意见**：代码评审工具自动生成的长评论，以及 TA 原样转贴的 AI 输出。
- **批量出现的提交**：短时间内连续出现、风格高度一致的大段提交信息。

拿不准就不用，在报告里写明排除了多少条、按什么规则排除。剩下明显是 TA 手写的内容（简短、口语化、有错别字、符合 TA 平时的语言习惯）才作为说话方式素材。仓库、语言、Star 这类信息不受影响，仍可用于分析兴趣和专长。

## 个人网站 / 博客

- 先找「关于」页、友链页、RSS（常见路径 `/rss.xml`、`/feed`、`/atom.xml`、`/index.xml`、`/feed.xml`）。
- 读最近 10～20 篇文章的标题、标签、开头与结尾：长文用于分析兴趣、价值观、知识领域；说话方式更多看文章评论区里 TA 的回复、短动态、碎碎念。
- 文章发布时间可加入时间戳，但发布时间常常是定时发布，权重放低。

## 社交平台

开放接口（无需登录）：

| 平台 | 方式 |
| --- | --- |
| Mastodon 及兼容实例 | `https://<实例>/api/v1/accounts/lookup?acct=<用户名>` 取 id，再 `https://<实例>/api/v1/accounts/<id>/statuses?limit=40&exclude_reblogs=true`，用 `max_id` 翻页 |
| Bluesky | `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&limit=50&filter=posts_no_replies`（去掉 filter 可包含回复） |
| V2EX | 资料 `https://www.v2ex.com/api/members/show.json?username=<u>`；回复列表 `https://www.v2ex.com/member/<u>/replies` |
| Reddit | `https://www.reddit.com/user/<u>/comments.json?limit=100`（需要设置 User-Agent） |

通常需要登录或有反爬的平台（微博、X、小红书、知乎、B 站动态、即刻、豆瓣等）：先尝试读取公开主页一次，读不到就请用户截图主页和最近的动态、评论，或复制粘贴文字。B 站可以看视频简介、专栏文章；知乎可以看公开回答。

社交平台上的回复、评论最接近博客评论的场景，是 `style_samples` 最好的参照。

## 搜索引擎

- 组合搜索：`"<ID>"`、`"<名字>" "<ID>"`、`"<ID>" site:github.com`、`"<ID>" 博客`、`"<名字>" 演讲 OR 采访 OR 播客`，以及 TA 的个人网站域名。
- 身份确认：至少两处互相印证才算同一个人，例如个人网站链接到该账号、头像相同、跨平台使用同一 ID 且简介一致。在报告里把每个结果标为「确认」「可能」「排除」，只用「确认」的。
- 搜索的目的是找 TA 公开的发言和作品（演讲、访谈、开源项目、技术文章、社区讨论），不要深挖住址、家人、工作单位内部信息等隐私，搜到了也不记录。

## 聊天记录截图 / 导出

- 先问清楚哪一方是 TA（左侧还是右侧、头像、备注名）。
- 用你的看图能力逐张读取截图，只转写 TA 的消息，保留：
  - 原文的标点、空格、错别字、语气词
  - 表情和表情包，记为 `[表情: 捂脸]`、`[表情包: 猫猫震惊]`
  - 能看到时间时记下时间
  - 连发多条短消息还是一条长消息、是否常发语音（记为 `[语音]`）
- 其他人记为「A」「B」，不保留第三方的名字、头像描述和私事；需要上下文时只用一句话概括对方说了什么。
- 导出的文本记录（如 Telegram 导出的 JSON、微信导出的 txt）同样只提取 TA 的发言。
- 聊天是最随意的场合。如果 TA 在公开场合说话更正式，写 `style_samples` 时以公开场合为准，聊天素材主要用来提取口头禅、表情习惯和性格。

### QQ 聊天记录（QQ Chat Exporter）

QQ 记录用 [QQ Chat Exporter](https://github.com/shuakami/qq-chat-exporter)（QCE）导出。它需要用户本人登录 QQ，所以由用户在自己的电脑上操作，Agent 只告诉用户导出哪些会话、哪段时间，不接触账号和 QCE 的访问令牌。

1. 在 QCE 网页的「会话」里找到 TA 的**私聊**，以及你们的**共同群聊**（能看到 TA 发言的群）。
2. 点该会话的「导出」：格式选 **JSON**；关闭媒体资源（图片、视频、表情文件）下载，只要文字，导出快很多；过滤掉入群通知、撤回提示等系统消息；时间范围用日历自定义。
3. 把导出的 JSON 放到 `distill-<id>/raw/qq/`，提取 TA 本人的发言并统计样本：

   ```bash
   python3 scripts/qce_extract.py --uin <TA 的 QQ 号> --out distill-<id>/corpus distill-<id>/raw/qq/*.json
   ```

   脚本只输出 TA 的消息（跳过系统消息和撤回，@ 到的人换成「@某人」），写入 `corpus/qq.txt` 与 `corpus/qq-timestamps.txt`；按私聊、群聊统计「有文字的发言」条数，并提示要不要扩大时间窗口。

普通导出只包含已同步到这台电脑的记录。私聊更早的记录可以在 QCE 里用「漫游导出」补，群聊没有这个功能。

**时间窗口：从 7 天开始，不够再翻倍，够了就停**

- **目标**：TA 有文字的发言合计至少 200 条，其中群聊至少 50 条（群聊更接近公开场合的说话方式，是 `style_samples` 的主要参照）。没有共同群时，私聊够 200 条即可。
- **第 1 轮**：私聊和每个共同群都只导出最近 7 天。
- **翻倍**：跑一次 `qce_extract.py`，哪一类不够，就只把那一类的窗口翻倍：14 → 28 → 56 → 112 → 224 → 365 天，最多 1 年。每轮只导出**新增的那一段**（例如第 2 轮导出 8～14 天前），和已有文件一起重新运行脚本，重复的消息会自动去掉。
- **群很多时**：第 1 轮之后只继续扩大 TA 发言最多的 3～5 个群，TA 几乎不说话的群不再导出。
- **够了就停**：达到目标就不再导出更早的记录，省时间，近期的发言也更能代表现在的 TA。翻到 1 年仍不够时停止，在报告里注明样本量和可信度。
- 原始导出里有其他人的聊天内容，只留在本地 `raw/` 下；提取完成后，用户要求时就删除。

## 其他

- 演讲、播客、视频字幕：口语习惯、口头禅、讲解问题的方式。
- 自我介绍、简历（用户提供时）：只提取兴趣和专长，不记录单位、学校、联系方式。
