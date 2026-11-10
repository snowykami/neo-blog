## 功能

- [] 支持 AI 预算管理，AI调用统计，Token输入输出，缓存写入缓存读取
- [] 支持 AI 生成文章，AI 生成文章摘要，AI 生成文章标题，AI 生成文章标签
- [] 全套可观测支持，指标/链路/日志。

## Bugs

- [ ] 用 Claude 过一遍近期改动，看看有没有什么问题
- [ ] i18n 测试器脚本，解析全文哪些地方的 i18n key 对不上，考虑到有些地方的 key 是动态生成的，进行泛匹配标记即可

## 优化方向

- [ ] AI用户提示词优化
- [ ] 博客AI编辑优化，去AI味
- [x] i18n 按命名空间拆分（NextIntlClientProvider 只传当前页用到的命名空间）→ 首屏省约 65 KB gzip，RSC 导航省约 55 KB gzip。收益最大、改动集中在一处。
- [x] 歌词字体的 CSS 移出全局图（改成 MusicLyricStage 内部动态 import，或者干脆用 <link> 按需插）→ 每页省 486 KB CSS 解析、约 130 KB 传输。
- [ ] motion 从 layout 摘掉（导航/灵动岛改 CSS 过渡）→ 每页省 374 KB JS 解析。
- [x] zod 从客户端共享 chunk 里剔除（侧栏运行时不再引组件注册表）→ 首页 JS −39 KB 传输 / −132 KB 解析。
- [ ] /_next/static 改 immutable 长缓存。
- [ ] meilisearch 可选支持:针对多种权限生成租户令牌

## 性能：让点击即开（Next 16 Cache Components / PPR）

背景：现在 58 个路由全是动态 SSR，Link 预取只拿到壳（1~6 KB），点一次要现算 + 打后端（300~600ms）。

### 阶段 0 验证迁移面（0.5 天，不改业务代码）

- [ ] 先提交现有改动：删 `utils/server/device.ts` 死代码 + 主题预览挪到客户端（已过 551 测试）
- [ ] 临时开 `cacheComponents: true` + `partialPrefetching: true`，构建并抄下 `blocking-prerender-dynamic` 清单
- [ ] 验证构建期不碰后端（`BACKEND_URL` 指向不可达地址仍能构建）
- [ ] 验证 `sitemap.xml` / `rss.xml` 是否变空（它们现在靠 `force-dynamic` 规避构建期取数）
- [ ] 验证 `/p/[id]` 首访耗時与二次访问是否命中 ISR 缓存
- [ ] 产出 go/no-go；no-go 则只做阶段 1 + 客户端数据缓存

### 阶段 1 缓存基础（1~2 天，两种路线都需要）

- [ ] `getCachedSiteInfo()` 从 `React.cache`（仅请求内）改成跨请求缓存
- [ ] 页面内多个后端请求并行化
- [ ] `/_next/static` 改 `immutable, max-age=31536000`

### 阶段 2 PPR 迁移（3~5 天）

- [ ] 2a 根布局拆 Suspense：登录态/语言/时区移出壳；`<html lang>` 用站点默认语言，客户端纠正
- [ ] 2b 文章页：公开正文 `use cache`，点赞/评论/草稿走 Suspense；404 与 slug 跳转保留在 generateMetadata
- [ ] 2c 列表页/静态页走 `use cache` + `cacheLife`
- [ ] 2d sitemap/rss 从 force-dynamic 迁到 `use cache` + 短 cacheLife
- [ ] 2e 逐页 SEO 验收：首包 200、完整响应含正文与 JSON-LD、LCP 未被推进 Suspense、fallback 有固定高度

### 阶段 3 缓存跨实例（1 天，强烈建议）

- [ ] `'use cache: remote'` + 自定义 cache handler 落 Redis（多副本、发版后缓存不丢）
- [ ] 用文章更新时间/版本号做 cacheTag，改动时 `revalidateTag` 精确失效

### 阶段 4 剩余体积（可并行）

- [ ] motion 瘦身或换 CSS（374 KB 解析 → 目标 100 KB 内）
- [ ] 歌单接口：恢复播放只取上一首（首屏省 91 KB gzip）
- [ ] 文章页 RSC 400 KB：评论分页、公式/高亮按需

### 阶段 5 静态资源 CDN（可选）

- [ ] `/_next/static` 上对象存储 + `assetPrefix`，顺带消灭滚动更新后的 chunk 404

