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
- [ ] 歌词字体的 CSS 移出全局图（改成 MusicLyricStage 内部动态 import，或者干脆用 <link> 按需插）→ 每页省 486 KB CSS 解析、约 130 KB 传输。
- [ ] motion 从 layout 摘掉（导航/灵动岛改 CSS 过渡）→ 每页省 374 KB JS 解析。
- [ ] zod 从客户端共享 chunk 里剔除（schema 只在服务端/编辑器侧用）→ 省 112 KB。
- [ ] /_next/static 改 immutable 长缓存。
- [ ] meilisearch 可选支持:针对多种权限生成租户令牌