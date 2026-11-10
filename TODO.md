## 功能

- [] 支持 AI 预算管理，AI调用统计，Token输入输出，缓存写入缓存读取
- [] 支持 AI 生成文章，AI 生成文章摘要，AI 生成文章标题，AI 生成文章标签
- [] 全套可观测支持，指标/链路/日志。

## 优化方向

- [ ] AI用户提示词优化
- [ ] 博客AI编辑优化，去AI味
- [x] i18n 按命名空间拆分（NextIntlClientProvider 只传当前页用到的命名空间）→ 首屏省约 65 KB gzip，RSC 导航省约 55 KB gzip。收益最大、改动集中在一处。
- [x] 歌词字体的 CSS 移出全局图（改成 MusicLyricStage 内部动态 import，或者干脆用 <link> 按需插）→ 每页省 486 KB CSS 解析、约 130 KB 传输。
- [ ] motion 从 layout 摘掉（导航/灵动岛改 CSS 过渡）→ 每页省 374 KB JS 解析。
- [x] zod 从客户端共享 chunk 里剔除（侧栏运行时不再引组件注册表）→ 首页 JS −39 KB 传输 / −132 KB 解析。
- [ ] meilisearch 可选支持:针对多种权限生成租户令牌

## 性能：让点击即开

背景（2026-11 实测）：服务端渲染只要 5～20ms，每页只打 1 次后端，瓶颈不在服务端；慢在点击之后才去源站现取内容——
预取只拿到空壳（全站动态渲染）、没有加载骨架、文章页一次跳转约 410 KB（gzip 68 KB）。
完整链路点击到出内容约 0.6～0.9s，本机约 80～150ms。Next 已默认给 `/_next/static` 加 immutable，不用再配。

执行顺序：先把「因人而异」的东西从服务端渲染里拿掉（阶段零～二），页面对所有人一致后，预取和缓存才好做（阶段三～五）。

### 阶段零：私密文章只在后台可见

现状：前台列表和文章页的取数都带用户 cookie（`api/post.server.ts`），登录后能看到自己的私密文章，
公开数据和个人数据混在同一个请求里，页面没法按「所有人看到的一样」来缓存。

- [x] 前台的列表、标签、分类、归档、搜索、用户主页一律只返回公开文章，取数不再带 cookie
- [x] 私密文章的前台详情页对所有人 404（含作者和管理员）；作者在后台编辑器的预览里看
- [x] 后台文章管理照常可见；草稿预览（`?type=draft`）迁到后台预览，不再走前台路由
- [x] 后端保持保守授权：公开接口不认 cookie 里的身份去放开私密文章，只在后台接口返回
- [x] 核对置顶、上一篇/下一篇、相关文章、站内文章引用卡片、AI 用户读取都不会露出私密文章（目前没有上一篇/下一篇与相关文章接口）

### 阶段一：服务端渲染去个人化

现状：根布局为了登录态、偏好色、时区读 cookie 并查当前用户，全站 48 个路由都因此动态渲染，预取只能拿空壳。

- [x] 登录状态改到客户端：服务端只渲染「确认中」外壳，浏览器取 `/user/me` 后补头像、菜单、管理入口（用占位避免跳动）；后端登录时另写脚本可读的 `logged_in` 标记 Cookie，访客不请求 `/user/me`
- [x] 主题色 / 配色：服务端输出站点默认配色，用户偏好存 localStorage，页面加载前用内联脚本应用；登录后以账号偏好为准并写回 localStorage
- [x] 时区：服务端按固定时区（Asia/Shanghai）渲染并带 `<time datetime>`，水合后浏览器按本机时区重新格式化；去掉时区 cookie
- [x] 节日主题与当前日期：服务端跨请求缓存 10 分钟（`unstable_cache`，迁 Cache Components 后换 `cacheLife`），浏览器挂载后按本机时间再判断；页脚年份、next-intl `now` 不再在服务端按请求取
- [x] 文章页不读 `searchParams`：`?comment=` 定位交给浏览器，草稿预览已在阶段零迁走
- [x] 验收：根布局与前台页面不再调用 `cookies()` / `headers()` / 当前用户（只剩 `i18n/request.ts` 按语言 Cookie 与 `accept-language` 选语言，阶段二去掉；在此之前全站仍是 ƒ）

### 阶段二：语言放进 URL

现状：服务端读用户设置、语言 cookie 与 `accept-language` 决定界面语言，同一个 URL 不同人返回不同语言，CDN 与缓存都用不了，搜索引擎只能收录一种语言。

- [x] 前台页面目录挪进 `app/[locale]/`；`/console`、`/api`、`rss.xml`、`sitemap`、`robots` 不带语言前缀（根布局即 `[locale]/layout.tsx`；后台也放进 `[locale]` 共用根布局，前台与后台之间仍是客户端跳转、音乐不断，地址不带前缀，由 proxy 按偏好改写语言段，`force-dynamic`；`app/` 根目录只剩接口、RSS、sitemap、robots、healthz 与 global-error / global-not-found）
- [x] next-intl `defineRouting` + `localePrefix: 'as-needed'`：中文不带前缀（旧链接与 SEO 不变），其他语言 `/en`、`/ja`、`/ko`、`/zh-tw`（zh-HK / zh-MO / zh-SG 有自己的文案，同样各有前缀 `/zh-hk`、`/zh-mo`、`/zh-sg`；路由参数用注册表代码 zh-TW，对外小写前缀，见 `i18n/routing.ts`）
- [x] `i18n/request.ts` 改为只读 URL 里的语言（`next/root-params`，Route Handler 显式传 locale）；新增 `proxy.ts`，只在首次访问时按偏好跳转（只对浏览器打开页面、地址不带前缀、偏好非默认语言时 307，跳转响应 `private, no-store`；客户端路由取数不跳；不写 Cookie，不带前缀的 200 响应对所有人一致；`Accept-Language: *` 视为无偏好）
- [x] 前台的 `next/link`、`useRouter` 换成 next-intl 的版本；语言切换改为跳转 URL（`@/i18n/navigation` 包一层：后台 / 接口地址原样交给 next；页脚新增语言切换，写 NEXT_LOCALE 后整页跳到目标语言地址；账号语言只在新设或首次同步时生效，之后本浏览器自己选的语言优先；文章 slug 跳转、链接页跳转、分页、分享链接、分享图、OIDC 回跳地址都带当前语言）
- [x] i18n 作用域生成器适配 `[locale]` 路径层级，重新生成清单（作用域名不变，清单无变化）
- [x] sitemap 与页面 `<head>` 加 `hreflang` 互相指向（每种语言一条 `<url>` + xhtml:link，含 x-default；canonical 指向当前语言；根布局统一 `metadataBase`；robots 屏蔽各语言的 `/auth/`）
- [x] 语言 JSON 文件内容不动
- [x] 静态化前置（阶段一实验构建把语言写死后发现）：`/auth/*` 页面的 `useSearchParams` 要包进 Suspense，否则预渲染报错（已包，骨架占位）；`/`、`/a`、`/c/[slug]` 读 `searchParams`、`/p/[id]` 等动态段没有 `generateStaticParams`，仍是 ƒ，留给阶段三～五
- 验收（2026-11 构建）：构建期不预渲染（`[locale]` 的 `generateStaticParams` 返回空数组），镜像构建连不上后端也不会把「Fail to fetch name」这类兜底内容固化进页面；`/privacy`、`/c`、`/l`、`/music`、`/random`、`/notifications`、`/notification-settings`、`/auth/*` 每种语言在第一次访问时用真实数据生成并按 ISR 缓存（30 秒，根布局 `revalidate = 30`）；站点信息、隐私页配置、分类 / 标签列表取不到时抛错而不是用兜底内容渲染：已有缓存继续提供，没有缓存时本次返回 500 且不进缓存（robots.txt、分享图仍用兜底站点信息）；`/`、`/a` 读 `searchParams`，显式 `force-dynamic`（构建期不渲染就判断不出动态，运行时会报 static to dynamic）；`/c/[slug]`、`/p/[id]`、`/page/[id]`、`/u/[username]`、后台仍按请求渲染
- 遗留：后台「站点语言」设置不再决定不带前缀地址的界面语言（固定简体中文），文案说明暂未改（本阶段不动语言 JSON）；文章正文里的站内链接是普通 `<a>`，不带语言前缀，靠 proxy 按偏好跳转；CDN 若缓存不带前缀的 200 响应会跳过首次访问跳转，阶段五配缓存时再定

### 阶段三：点击即开（体感提升最大）

- [x] 完整预取：文章卡片、上一篇/下一篇、导航在悬停或进入视口时预取整页（`router.prefetch` 完整模式 + `staleTimes`）→ 点击 0.7s → 约 40ms（用 Next 自带的 `experimental.dynamicOnHover`：`@/i18n/navigation` 的 Link 默认 `unstable_dynamicOnHover`，进入视口只预取到 loading 骨架，悬停或 touchstart 时升级为完整预取；`staleTimes` 改为 static 60 秒、dynamic 30 秒；目前没有上一篇/下一篇接口与组件，未做）
- [x] 加回 `loading.tsx` 骨架（`/p/[id]`、`/u/[username]`、`/c/[slug]`）：没预取到的点击也立刻切到骨架；404 与 slug 跳转判定留在 generateMetadata（实测加骨架后 generateMetadata 里判定一律变成 200，改为在各自手写的 layout 里判定：layout 在 loading 边界之外，判定完才开始流式输出；layout、generateMetadata、页面共用一次取数）
- [x] 去掉重复预取：标签链接 `prefetch={false}`（首页同一页预取 6 次）；预取不触发 generateMetadata 打后端（标签链接与页脚 RSS 链接不再预取；同一请求内 layout、generateMetadata、页面的取数用 React cache 去重，悬停的完整预取只打 1 次后端；视口预取仍会跑一次 layout + 元信息，见遗留）
- 验收（2026-11 生产构建 + 本机后端，Chrome 模拟 150ms 往返）：改前点击到正文出现 640～660ms、没有骨架；改后悬停 1.5 秒再点击 55～60ms（点击时不再发请求），只有视口预取的点击（键盘回车）8～12ms 出骨架、约 325ms 出正文，从没预取过的首屏外链接约 190ms 出骨架、约 520ms 出正文；首页加载的预取请求 16 个（8 个 `_tree` + 8 个到骨架为止），预取引起的后端请求 8 次，与改前相同；每悬停一张卡片多 1 个请求、1 次后端；文章页上的标签预取改前每篇 6 个请求（3 个标签 × 2），改后 0；文章、用户、分类不存在时浏览器、Googlebot、Twitterbot 都是 404，`/p/{id}`、`/en/p/{id}` 有 slug 时 308 到规范地址（与改前一致）；一次文章页文档请求只打 1 次后端
- 遗留：视口预取「到骨架为止」的请求里，Next 16.4（未开 Cache Components）总会完整取元信息，每个可见的文章 / 用户 / 分类链接仍有 1 次后端请求（首页一屏约 8 次，与改前持平）；要去掉只能放弃视口预取（键盘点击没有即时骨架）或给取数加跨请求缓存，留给阶段五

### 阶段四：页面数据瘦身（慢网与移动端收益最大）

- [x] 文章页客户端组件只传需要的字段，正文只发一份（现在按钮组件又带了一份，约 38 KB）（编辑入口、版权卡、点赞、分享改为只收 id / slug / 标题 / 描述 / 时间 / 作者 / 点赞状态，几个组件共用同一个对象，RSC 里只序列化一次；灵动岛、目录、评论、背景、AI 摘要原本就只传字段。post 对象带的正文原文不再进入 RSC）
- [ ] KaTeX 公式渲染结果缓存，不再每次跳转完整发送（约 190 KB）（只做了一半：正文里的公式只输出 HTML、不再输出 MathML，读屏改用外层节点的 `role="math"` + `aria-label`（LaTeX 源码），显示逐像素不变；渲染结果本来就按内容哈希缓存在服务端进程内。公式 HTML 仍随每次跳转完整发送：不发就只能在浏览器里渲染（KaTeX 脚本 77 KB gzip，第一次进公式文章反而更大，移动端还要多解析一份脚本），或让 SSR 与 RSC 拿到不同的正文（依赖水合不比对 innerHTML，太脆），都没做；只输出 MathML 体积最小，但 Chrome 不支持 KaTeX 输出的 `\mathbb`、`\mathbf` 等字体变体，也没选）
- [x] 界面文案只在首屏下发，跳转时不重发（约 33 KB）（嵌套的作用域只下发相对父作用域多出来的文案，客户端的嵌套 Provider 并上外层 Provider 已有的；首页 → 文章、文章 → 文章只带文章页这一层的约 9 KB（gzip 约 3 KB），根布局与 (main) 的约 61 KB 不再随跳转重发；作用域清单与 `pnpm i18n:scopes:check` 不变）
- [ ] 目标：每次跳转 68 KB → 约 28 KB（gzip，−58%）（普通长文达成，公式密集的文章没达成：剩下的主要是公式 HTML，见上）
- 验收（2026-11 生产构建 + 本机后端的数据库副本）：库里没有带公式的文章，测量用的是「How to Fix Any Bug」正文 + 80 个行内公式、40 个独立公式的测试文章（4 个代码块；独立公式 8 种各重复 5 次，gzip 偏乐观）。文章 → 文章、没预取过的客户端跳转（RSC 含 layout 与页面），Next 实际传输的 gzip：公式文章 63.0 KB → 36.5 KB（原始 491 KB → 354 KB），普通长文（How to Fix Any Bug，正文 18.7 KB）39.8 KB → 18.9 KB（原始 141 KB → 60 KB）；首页 → 公式文章（视口预取到骨架 + 点击，Node gzip 估算）21.8 + 43.5 KB → 6.2 + 31.0 KB。按来源拆（公式文章，gzip 边际值）：文案 19.1 KB → 3.2 KB，post 对象里的正文原文 8.8 KB → 0，正文 HTML 27.2 KB → 23.8 KB（去掉 MathML 原始少 41 KB；这篇的公式重复多，gzip 早已压掉大半 MathML，不重复的公式实测 gzip 少约 32%），其余约 6 KB 不变。首屏文档也跟着变小：公式文章 1177 KB → 937 KB（gzip 130 KB → 95 KB），普通长文 295 KB → 200 KB（gzip 73 KB → 51 KB）

### 阶段五：可缓存渲染

- [ ] 公开页面改 PPR / `use cache`（阶段零～二做完后，外壳已对所有人一致）
- [ ] 点赞状态、编辑按钮、评论区放进客户端小块或 Suspense，正文保持所有人一致
- [ ] 浏览量、点赞数：缓存里放快照，浏览器再补一次最新值
- [ ] 多实例共用缓存：Redis cache handler，后端数据变更时按 cacheTag 失效
- [ ] 等 Next 默认开启 Cache Components 后再全量开，按已整理的阻塞清单逐项验收
- [ ] 预期：每次请求服务端再省 30～95ms，服务器负载下降

### 其他（不影响点击即开，可并行）

- [ ] motion 瘦身或换 CSS（374 KB 解析 → 目标 100 KB 内）
- [ ] 歌单接口：恢复播放只取上一首（首屏省 91 KB gzip）
- [ ] `/_next/static` 上对象存储 + `assetPrefix`，顺带消灭滚动更新后的 chunk 404
