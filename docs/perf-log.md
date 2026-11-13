# 性能优化记录

> 每次优化记录「同一指标、改动前后」的量化结果，便于横向比较与回溯。
> 方案讨论放在 `TODO.md`，这里只记实测数据与可复现的测量方法。
> 最新一条在最上面。

## 测量口径

- **体积**：gzip 后的传输字节数，请求带 `Accept-Encoding: gzip` 且固定 `Accept-Language: zh-CN`（文案语言不同，体积差别明显，必须固定）。
- **改前**：当时线上版本；**改后**：本地生产构建（`cd web && pnpm build`，用 `.next/standalone/server.js` 起服务）。两边都用同一条 curl / 同一个浏览器，避免把 CDN、链路抖动算进结论。
- **时间**：服务端 TTFB 与渲染耗时跟这类改动基本无关（本地 TTFB 约 200~300 ms），所以时间收益一律**按带宽折算**，不直接比秒数。
- **只看首屏**：重复访问会被浏览器缓存吃掉（见 001 的「二次访问」一栏），单列。
- 前端 JS 的 chunk 划分会随代码变化，记录时同时写清 chunk 数量，避免「体积变小但请求变多」。

复现命令：

```bash
# 文案载荷（每个路由作用域要下发多少）
cd web && node scripts/i18n-report.mjs

# 单页首屏传输量（gzip）
curl -s -o /dev/null -w '%{size_download}\n' \
  -H 'Accept-Language: zh-CN' -H 'Accept-Encoding: gzip' https://blog.sfkm.me/

# 本地生产构建
cd web && pnpm build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
cd .next/standalone && BACKEND_URL=http://localhost:8888 PORT=3100 node server.js
```

---

## 005 首屏全链路性能优化（P0 / P1 / P2，2026-11-14）

### 改动

1. **彻底移出首屏重依赖（P0）**：
   - **zod**：003 遗留在主题系统的 zod（`themes/types.ts` 定义校验）拆分至独立 `themes/schema.ts`，首屏彻底移出 zod（`111.4 KB raw / 32.7 KB gzip` → `0`）。
   - **@sentry/* 延后**：新增 `lib/telemetry/loader.ts` 监听并缓冲首屏未捕获错误与路由，推迟到 `requestIdleCallback` 空闲期动态加载 Sentry SDK（`~88.5 KB raw / ~27.1 KB gzip` → `0`）。
   - **歌词/律动引擎按需加载**：`MusicProvider` 挂在全局根布局，原本常驻加载歌词解析器、wanakana、AI 强调与律动模型。拆分为 `contexts/music-lyrics-engine.tsx`，无曲目或未播放时不下载（移出 `~60~85 KB`），曲目就绪时按需加载。
2. **首屏关键图片 SSR 直出与优先级（P0）**：
   - `ImageAvatar` 从 `@radix-ui/react-avatar`（SSR 不输出 `<img>`，需等水合后 `new Image()` 完成才上屏）重构为基于 `SafeImage`（`next/image`），服务端直接输出 `<img>`、`srcSet` 与精准 `sizes`。
   - 侧栏站长头像与背景横幅设为 `eager`；首屏第一篇博文封面在 Next 16 下启用 `preload`、`loading="eager"` 与 `fetchPriority="high"`（LCP 图片提前至 HTML 解析阶段并行下载）。
3. **交互组件拆包与按需懒加载（P1）**：
   - 将 `@radix-ui/react-select` 从 `pagination.tsx` 剥离入独立 `page-size-selector.tsx`，移出首页首屏（`-21.5 KB`）。
   - 搜索弹窗（`cmdk` + `react-hotkeys-hook`）、移动端抽屉菜单（`Sheet`）、文章大图预览器、分享弹窗（`react-icons` 平台图标）均改为点击/悬停/聚焦按需懒加载。
   - 评论区附件选择器懒加载抽屉 `vaul`（`-31.9 KB`）；正文下方评论区采用 `IntersectionObserver` 懒加载，支持 `?comment=` / `#comment` 锚点直接直出。
4. **服务端渲染优化与 CLS 消除（P1）**：
   - 导航栏自定义页面采用服务端 `'use cache'`（`cacheLife('site')` + `CacheTag.Pages`）预取，消除客户端首次挂载时的网络抖动。
   - 代码块工具栏包裹与 `highlight.js` 着色移至服务端（`utils/server/render-code.ts`）并随正文哈希缓存，客户端仅需事件委托处理复制，彻底消除水合后插入工具栏导致的 CLS 布局偏移。
   - 首页侧边栏移出 `searchParams` 的 Suspense 阻塞区，并在已有摘要时裁剪列表返回项冗余的完整 `content`。
5. **CSS 与 i18n 作用域细粒度治理（P2）**：
   - 全局移出 240+ 条 `--color-*-500` / `--color-*-200` 色板变量的 `tailwindcolor.css`（`-11.6 KB raw`），改为在正文与编辑器共用的 `content-themes/index.scss` 中按需引入。
   - `ContentComponents` 加入 `SPLIT_NAMESPACES` 拆为二级下发单元，访客页面不再携带编辑器/组件库专属的 11 个子命名空间文案。

### 打包产物与体积对比（生产构建）

| 页面 / 资源 | 改前 (raw / gzip) | 改后 (raw / gzip) | 净收益 |
| :--- | :--- | :--- | :--- |
| **首页 JS** | 1539.9 KB / 500.0 KB (40 chunks) | **1266.7 KB / 413.6 KB** (35 chunks) | **−273.2 KB / −86.4 KB (−17.3% gzip)** |
| **首页 CSS** | 267.5 KB / 45.0 KB | **249.9 KB / 38.8 KB** | **−17.6 KB / −6.2 KB (−13.8% gzip)** |
| **文章页 JS** | 1753.8 KB / 570.7 KB (46 chunks) | **1318.4 KB / 431.4 KB** (36 chunks) | **−435.4 KB / −139.3 KB (−24.4% gzip)** |
| **文章页 CSS** | 313.8 KB / 54.4 KB | **311.9 KB / 53.2 KB** | **−1.9 KB / −1.2 KB** |
| **i18n (main)** | 42.2 KB | **37.4 KB** | **−4.8 KB** |
| **i18n (main)/p/[id]** | 48.4 KB | **43.6 KB** | **−4.8 KB** |
| **i18n (player)** | 40.5 KB | **30.5 KB** | **−10.0 KB** |

### SSR 出图性能基准测试（回应“万一 SSR 更慢？”）

测试场景：Node 25 环境下模拟单页包含 **1 个侧栏横幅 + 12 个站内头像 + 10 张博文封面**，采样 1000 次：

- **网络 I/O 阻塞**：`0` 次（`next/image` 在 SSR 阶段仅为纯同步字符串拼接输出 `srcSet`，不发网络请求，无磁盘/图片解码阻塞）。
- **`renderToString` 耗时**：`0.315 ms` → `0.409 ms`（单页仅微增 **+0.094 ms**）。
- **`renderToReadableStream` 耗时**：`0.346 ms` → `0.518 ms`（单页仅微增 **+0.172 ms**）。
- **HTML 传输量变化**：输出 `<img>` 从 11 增至 22 个、`<link rel="preload">` 从 0 增至 3 个，HTML gzip 体积仅增加 **+0.84 KB**。

### 验证

- `pnpm lint` 0 error 通过；`tsc --noEmit` 通过。
- 113 个单测文件 / 810 个用例全量通过（含新增 `render-code.test.ts`、`image-avatar.test.ts` 以及 `coverage.test.ts`、`proxy.test.ts`）。
- 生产打包 `pnpm build`（Turbopack）构建成功并提取 sourcemap 确认特征包已完全剥离。

---

## 004 补齐两处漏掉的文案：配置项枚举值、通知事件（2026-11-10）

线上 `/notifications` 的整页事件文案、控制台「全局配置」里音乐音质等下拉选项都是原始键名。

两个不同的漏法（都是「生成器看不到」的类型）：

1. **后端枚举字段的选项文案**：`internal/config/items.go` 里用 `options(NCMSongLevels, "ncm_song_level_")`
   现拼键名（`ncm_song_level_exhigh`），前端只写 `t(option.label)`，静态分析看不到具体键。
   生成器现在会解析 `options(值列表, "前缀")`，把文案里该前缀下的键全部带上（顺带覆盖
   `content_theme_*`、`captcha_provider_*`）。
2. **翻译函数被当参数传出、而键带点**：`notifications-page.tsx` 把 `t` 传给 `notificationText()` 等函数，
   函数体里 `t('types.comment_created')` 用的是形参；之前的兜底只收集不含点的字面量，于是整组
   `Notifications.types.*` 都没进作用域。现在字面量兜底也接受带点的子路径（在文案里解得开才收）。

顺带补了 `comment.mentioned` 类型缺的文案分支（`types.comment_mentioned` 一直有文案但没人用）。

影响：`(main)/notifications` 作用域 +18 条（Notifications 的 events 与 tab 文案）；
控制台全局配置 +9 条（音质 6 个、内容主题 6 个、验证码来源 4 个里的一部分）。

---

## 003 zod 移出访客首屏（2026-11-10）

### 改动

首页带 zod 只有一条链：侧栏的「组件卡片」→ `content-components/props.ts` → 组件注册表 → 17 个
`*.content.ts` 各自的 schema → zod。

- `sidebar-cards.ts` 只留类型、常量与运行时轻量整理（补默认值、截断越界高度、拒绝非 http(s) 地址、预设去重），
  不再 import zod，也不再 import 注册表
- 新增 `sidebar-cards-schema.ts`：zod schema 与 `parseSidebarCard`，只在后台「全局配置 → 侧边栏卡片」保存时使用
- `gen-content-components.mjs` 多生成一份 `runtime-registry.generated.ts`（组件名 → `import()`），
  `--check` 同时校验两份产物；`ContentComponentView` 抽出只吃 `component + props` 的 `ContentView`
- 侧栏组件卡片按需加载组件定义：只有真的配了组件卡片、并且渲染到它时才拉那个模块（那时才会带上 zod）

### 首页冷启动（gzip 传输 / 解析后）

| 项 | 改前 | 改后 | 变化 |
| --- | ---: | ---: | ---: |
| JS chunk 数 | 40 | 38 | −2 |
| JS | 569 KB / 1731 KB | **530 KB / 1599 KB** | **−39 KB / −132 KB** |
| 其中 zod | 114 KB 原始 / 32.7 KB gzip | 0 | 移出 |
| CSS | 42 KB / 246 KB | 42 KB / 246 KB | 不变 |
| **整页合计** | **1082 KB** | **1029 KB** | −53 KB |

i18n 载荷不变：`(main)` 仍是 26.5 KB 原始 / 10.0 KB gzip，根作用域反而从 22.3 KB 降到 19.0 KB。

### 验证

- 首页 38 个 chunk 里没有任何一个含 zod 特征码；侧栏的预设卡片与 iframe 卡片渲染正常
- 新增两条单测：运行时注册表与生成物同步、每个组件都有按需加载入口
- 侧栏测试重写成两套语义：运行时宽松（补默认值、越界截断），保存时严格（未知组件 / 版本过高 / 非法地址一律拒绝）

### 遗留

文章页仍带 zod（32.3 KB gzip），来源是 `component-islands` 在客户端解析 `data-props` 时做校验。
要清掉得让服务端校验完再下发、客户端只渲染。

---

## 002 歌词字体与歌词引擎移出首屏（2026-11-10）

### 改动

1. **歌词网页字体改为按需注入**：`lib/lyrics/lyric-fonts.ts` 原来是 6 行静态 `import '@fontsource/…'`，
   被歌词舞台引入、舞台又被根布局的播放器引入，于是每个页面都要下载 6 份 `@font-face` 分片表（约 580 KB）。
   现在改成 `loadLyricFonts()` 在舞台挂载时注入 `<link>`，文件来自已有的 `public/fonts/<字体>.css`（`gen-webfonts.mjs` 生成；
   歌词按 700 排版，所以额外生成了一份 `noto-serif-sc-bold.css`）。
2. **歌词渲染引擎改为按需加载**：`music-lyric-stage` 在播放器、灵动岛、单曲卡三处都改成 `next/dynamic`，
   引擎（`lib/lyrics/lyric-player.ts` + 舞台粒子）单独成 chunk，首页与文章页都不再引用。
3. **播放器改为空闲挂载**：`FloatingWidgets` 用 `requestIdleCallback`（2 s 兜底）再挂 `MusicPlayer`，
   歌单加载与播放进度恢复照常执行，只是不挡首屏。
4. **hover 预取**：单曲卡的播放键上 `onPointerEnter`/`onFocus` 触发 `prefetchMusicPlayer()`，
   点下去不用等 chunk 下载（移动端无 hover，仅首次多点几十毫秒）。

### 首页冷启动（gzip 传输 / 解析后）

| 项 | 改前 | 改后 | 变化 |
| --- | ---: | ---: | ---: |
| JS | 575 KB / 1751 KB | 569 KB / 1731 KB | −6 KB / −20 KB |
| CSS | 204 KB / 728 KB | **42 KB / 246 KB** | **−162 KB / −482 KB** |
| 字体 woff2 | 69 KB | 69 KB | 不变（只下实际出现的字） |
| 接口 | 380 KB（本地未压缩；线上压后约 150 KB） | 380 KB | 不变（见「遗留」） |
| **整页合计** | **1250 KB** | **1082 KB** | **−168 KB（−13.4%）** |

CSS 文件数从 9 个降到 3 个（剩下的是 `globals.css` 与两个小组件样式）。

### 代价转移到该付的页面

播放器页 `/music`：字体样式表 147 KB 传输 / 472 KB 解析，6 个文件；woff2 实测 0 个——
系统字体够用时一个字形分片都不用下，只有歌词里出现系统没有的字才会取。

### 功能验证

- `/music` 点播放：歌词引擎 chunk 按需加载、舞台正常挂载、无控制台报错
- 字体样式表注入 6 个 `<link>`（带 `data-lyric-fonts` 标记），只在舞台挂载后请求
- 播放器空闲挂载后歌单与进度恢复逻辑照旧执行（`MusicPlayer` 仍是唯一加载歌单的地方）

### 为什么 JS 只降了 6 KB

原以为歌词引擎是大头，实测渲染器 chunk 只有 46.8 KB——首屏 JS 的真正大头在别处（motion 约 374 KB 解析、zod 约 112 KB、react-dom 与框架约 155 KB），
而且播放器状态机（`music-context` 里的解析、强调、节奏）由根布局的 `MusicProvider` 需要，本来就得在首屏。

### 遗留

- 歌单接口仍随播放器空闲挂载拉取（线上压后约 91 KB）。要再省得把「恢复上次播放」改成只取上一首、歌单等真正播放时再取。

---

## 001 i18n 文案按路由作用域下发（2026-11-10）

### 改动

`NextIntlClientProvider` 之前在根布局拿到**整份语言表**（zh：177.8 KB 原始 / 63.8 KB gzip），每个页面的 RSC payload 都带一份。现在按 48 个路由作用域各取所需，清单由 `web/scripts/i18n-scopes.mjs` 从模块图生成。

### 首屏传输量（HTML + 内联 RSC，gzip）

| 页面 | 改前 | 改后 | 变化 | 省下 |
| --- | ---: | ---: | ---: | ---: |
| 首页 `/` | 93.6 KB | 35.7 KB | **−61.9%** | 57.9 KB |
| 文章页 `/p/*` | 73.5 KB | 53.1 KB | −27.8% | 20.4 KB |
| 用户主页 `/u/*` | 72.9 KB | 28.0 KB | **−61.6%** | 44.9 KB |
| 档案 `/a` | 79.5 KB | 28.7 KB | **−63.9%** | 50.8 KB |
| 通知 `/notifications` | 76.0 KB | 27.4 KB | **−63.9%** | 48.6 KB |
| 音乐 `/music` | 75.1 KB | 27.7 KB | **−63.1%** | 47.4 KB |
| 隐私 `/privacy` | 79.4 KB | 25.9 KB | **−67.4%** | 53.5 KB |
| 控制台 `/console` | 75.4 KB | 20.1 KB | **−73.3%** | 55.3 KB |
| 控制台 `/console/users` | 75.5 KB | 21.1 KB | **−72.1%** | 54.4 KB |
| 控制台 `/console/global` | 75.7 KB | 39.1 KB | −48.3% | 36.6 KB |
| **十个页面平均** | **77.7 KB** | **30.7 KB** | **−60.5%** | 46.9 KB |

### 文案载荷本身（zh）

| 作用域 | 原始 | gzip | 占整份语言表 |
| --- | ---: | ---: | ---: |
| 整份语言表（改前，每页都带） | 177.8 KB | 63.8 KB | 100% |
| `root`（全站） | 22.3 KB | 8.3 KB | 13% |
| `(main)` | 26.5 KB | 10.0 KB | 16% |
| `(main)/p/[id]` 文章页 | 32.1 KB | 11.9 KB | 19% |
| `(main)/u/[username]` | 28.1 KB | 10.6 KB | 17% |
| `(player)/music` | 28.3 KB | 11.0 KB | 17% |
| `console` 外壳 | 23.6 KB | 8.8 KB | 14% |
| `console/global` 全局配置 | 57.1 KB | 20.7 KB | 32% |

48 个作用域，平均 20.9 KB 原始 / 最大 38.6 KB。

### 客户端导航（RSC 增量）

首页 → 文章：**369 KB → 70 KB 原始（−81%）**，**54 KB → 26 KB gzip（−52%）**。其中文案从 178 KB 降到 32 KB。

### 重复访问

JS 40 个、CSS 9 个全部命中浏览器缓存（传输 0 字节），整页只剩 97 KB（API + RSC + HTML）。即这项优化**只影响首次加载**。

### 时间折算

按 4G 常见有效带宽约 190 KB/s：首页少下 57.9 KB ≈ **省 0.3 s**，客户端导航少下 28 KB ≈ **省 0.15 s**。服务端渲染耗时未变。

### 为什么不都像首页那样降六成

- **文章页 −27.8%**：它的 RSC 里主要是正文 HTML、评论、目录等业务数据，文案只占其中一部分。另外它从最初的 43.1 KB 涨到 53.1 KB——为了修灵动岛浮层（浮层由顶栏渲染，文案必须归到 `(main)` 作用域）和歌词来源标签，`(main)` 补了约 20 KB 原始文案。属于**正确性换体积**，可接受。
- **控制台全局配置 −48.3%**：整页文案由后端配置表（`internal/config/items.go`）决定，前端没有任何字面量，只能整块带上。

### JS 体积：无变化

文案从来不在 JS bundle 里，所以首页仍是 40 个 chunk、1751 KB 解析 / 575 KB 传输。这项优化只解决「数据加载量」。

### 回归守护

- `web/src/locales/coverage.test.ts`：生成物是否随源码更新、每个作用域是否挂了 `layout`、作用域清单是否覆盖该子树的全部取用
- `pnpm build` 里含 `pnpm i18n:scopes:check`（Docker 构建上下文只有 `web/`，读不到后端配置表时自动跳过并说明）
- 开发环境缺键时在浏览器控制台打 `[i18n:作用域名] MISSING_MESSAGE: …`，页面上则表现为原始键名

### 当前最大的一类漏检原因（供后续参照）

静态模块图看不到的三种取用方式，现已分别处理：键由后端配置表决定（从 Go 源码读）、helper hook 返回翻译函数（跨文件解析）、翻译函数被当参数传出 / JSX 交给上层渲染（`RENDERED_BY_SCOPE` 表 + 未知键空间按文件字面量兜底）。遇到新的同类写法，加进生成器对应的表里并写清原因。

---

## 后续候选（未做，方案见 `TODO.md`）

首页首屏现在的大头（同一套测量口径，2026-11-10 实测）：

| 项 | 传输 | 解析 | 来源 |
| --- | ---: | ---: | --- |
| `/_next/static` JS（40 个） | 569 KB | 1731 KB | 其中 motion 约 374 KB、zod 约 112 KB、react-dom 与框架约 155 KB |
| `/_next/static` CSS（3 个） | 42 KB | 246 KB | `globals.css` 占 241 KB 解析 |
| 接口 | 线上压后约 150 KB | — | 歌单 91 KB 是单个最大 |

~~歌词字体 CSS~~、~~歌词引擎~~（002）、~~zod~~（003）已完成。剩下按收益排序：motion 替换（−110 KB 传输 / −374 KB 解析）→ 歌单恢复逻辑改造（−91 KB 首屏接口）→ 文章页 `component-islands` 的 zod（−32 KB）→ i18n 的 `Response.error_details`（−10 KB 原始/页）。

---

## 记录模板

```markdown
## 00N 标题（YYYY-MM-DD）

### 改动
一两句话说清改了什么、为什么。

### 指标
| 页面 | 改前 | 改后 | 变化 |
| --- | ---: | ---: | ---: |

### 时间折算
按 X KB/s：省 Y KB ≈ Z s。

### 代价 / 未覆盖
```

