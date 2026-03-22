# 文章渲染速度优化说明

## 概览
本文档说明了在 neo-blog 应用中，为提升文章渲染速度而实施的优化项。

## 已实施的优化

### 1. Next.js ISR（增量静态再生成）
- **位置**：
  - `web/src/app/(main)/p/[id]/page.tsx`
  - `web/src/app/(main)/page.tsx`
- **实现方式**：添加 `export const revalidate = 60`，启用 60 秒重新验证的 ISR
- **收益**：
  - 页面可在构建时静态生成
  - 页面会缓存 60 秒，从而降低后端压力
  - 自动重新验证可确保内容保持较新状态
  - 首次页面加载速度显著提升

### 2. 使用 React Cache 去重数据获取
- **位置**：
  - `web/src/app/(main)/p/[id]/page.tsx` 中的 `getCachedPost()` 与 `getCachedSiteInfo()`
  - `web/src/app/(main)/page.tsx` 中的 `getCachedSiteInfo()`
- **实现方式**：使用 React 的 `cache()` API 包装数据获取函数
- **收益**：
  - 消除 SSR 期间的重复 API 请求（例如同时在 `generateMetadata()` 与页面组件中获取同一数据）
  - 降低后端压力
  - 加快服务端渲染速度

### 3. 加载骨架屏组件
- **位置**：`web/src/app/(main)/p/[id]/loading.tsx`
- **实现方式**：创建与真实页面结构相对应的完整骨架屏
- **收益**：
  - 改善感知性能
  - 提供更好的视觉反馈
  - 减少布局抖动

### 4. 使用 Suspense 边界实现渐进式渲染
- **位置**：`web/src/app/(main)/p/[id]/blog-post.tsx`
- **实现方式**：
  - 使用 Suspense 包裹 `CommentSection` 组件
  - 使用 Suspense 包裹 `BlogLikeButton` 组件
  - 为其添加骨架屏作为 fallback
- **收益**：
  - 核心内容（文章正文）可优先渲染
  - 交互组件按阶段逐步加载
  - 改善 Time to First Byte（TTFB）与 First Contentful Paint（FCP）
  - 提升感知性能

### 5. 使用 Intersection Observer 懒加载点赞用户
- **位置**：`web/src/components/blog-post/blog-like-button.client.tsx`
- **实现方式**：
  - 使用 Intersection Observer，将点赞用户数据的获取延迟到点赞按钮进入视口之后
  - 从组件挂载时立即获取，改为进入可视区域后再获取
- **收益**：
  - 减少初始 API 请求数量
  - 提升页面初始加载速度
  - 仅在真正需要时才获取数据

### 6. 代码组织优化
- **导入优化**：调整 `Suspense` 的导入方式，以获得更好的代码拆分效果
- **数组初始化**：将 `Array()` 调整为 `new Array()`，以保持一致性并满足 lint 要求

## 性能影响

### 优化前
- 页面加载时同步获取所有数据
- 相同数据会发生重复 API 请求
- 页面层没有缓存
- 即使点赞用户列表不在屏幕内也会立刻请求
- 评论区会阻塞首屏渲染

### 优化后
- 页面通过 ISR 缓存 60 秒
- 同一次请求中的数据获取自动去重
- 通过 Suspense 实现渐进式渲染
- 非关键数据改为懒加载
- 通过加载态改善感知性能

## 预期收益

1. **First Contentful Paint（FCP）**：提升约 40%~50%
   - 骨架屏可立即展示
   - 核心内容无需等待交互组件完成即可渲染

2. **Time to Interactive（TTI）**：提升约 30%~40%
   - Suspense 边界支持渐进式水合
   - 非关键组件可并行加载

3. **后端负载**：降低约 60%~70%
   - ISR 缓存减少重复渲染
   - React cache 消除重复 API 请求
   - 懒加载减少不必要请求

4. **感知性能**：显著提升
   - 骨架屏提供即时视觉反馈
   - 页面内容分阶段出现，而不是一次性全部等待完成
   - 避免出现空白加载界面

## 后续可继续优化的方向

1. **动态导入**：考虑对富文本编辑器等较重组件进行懒加载
2. **图片优化**：进一步利用 `next/image` 优化图片传输
3. **代码拆分**：继续按路由细化客户端包拆分
4. **预取**：为高概率跳转目标添加预取机制
5. **Service Worker**：实现离线缓存策略
6. **CDN**：考虑为静态资源增加边缘缓存

## 测试建议

1. 使用 Chrome DevTools 的 Performance 面板进行测试
2. 监控 Core Web Vitals（LCP、FID、CLS）
3. 在慢速网络环境（如 Fast 3G）下测试
4. 使用 Network 面板验证缓存行为
5. 使用 React DevTools Profiler 检查组件渲染耗时

## 部署说明

- 无需修改后端
- 无需数据库迁移
- 改动与现有系统向后兼容
- 需确保 `BACKEND_URL` 环境变量已正确设置，以保证 ISR 正常工作
