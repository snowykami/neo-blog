# 文章组件块：新增组件指南

文章 / 页面中可以插入构建期注册的 React 组件（组件块）。正文只保存组件名与 JSON props：

```html
<div data-component="badges" data-props='{"items":[...]}' data-version="1">降级内容</div>
```

- 编辑器：插入菜单 / 右键菜单 / 斜杠命令中的「组件库…」按 `src/components` 的目录树浏览组件，插入后按 schema 生成的表单编辑属性
- 前台：`ComponentIslands` 扫描正文占位，按注册表懒加载组件挂载；未知组件、版本过高或 props 校验失败时保留降级内容
- 安全：不执行正文中的任何代码；props 只是数据，由 zod schema 校验后交给组件渲染，链接类字段用 `hrefSchema` 限制为 http(s) / 站内路径

## 新增一个组件

1. 在组件旁新建 `<名称>.content.ts`（定义，默认导出）与 `<名称>.content-view.tsx`（渲染，`'use client'`），例如 `web/src/components/ui/badge.content.ts`：

   ```ts
   export default defineContentComponent({
     name: 'badges', // 写入正文的组件名，发布后不要修改
     version: 1, // props 结构不兼容变化时递增
     schema, // zod 对象，每个字段都带 .default()；多行文本用 .meta({ widget: 'textarea' | 'code' })
     component: dynamic(() => import('./badge.content-view')),
     icon: TagsIcon,
     keywords: ['badge', '徽章'], // 斜杠命令与组件库搜索
     fallback: props => [['p', {}, '...']], // 降级内容（Tiptap DOMOutputSpec），只用基础标签
     example: t => ({ ... }), // 组件库预览，t 读取 ContentComponents.<name>.example.*
   })
   ```

2. 运行 `pnpm gen:content`（`pnpm dev` / `pnpm build` 会自动运行）更新 `registry.generated.ts`；组件库中的位置即定义文件所在目录（文件名与目录同名时只显示目录）。
3. 在 12 个语言文件的 `ContentComponents.<name>` 下补齐 `name`、`description`、`fields.*`、枚举的 `options.<字段>.*`，以及可选的 `placeholders` / `descriptions` / `example`。
4. 运行 `pnpm test`：会检查注册表是否最新、组件名是否唯一、各语言文案是否完整、示例 props 是否通过校验。

## 不适合做成组件块的组件

依赖登录态、回调或业务数据的组件（编辑器、后台、评论、认证、各类弹窗等）无法只靠 JSON props 工作，也不应在正文中开放，因此不提供定义文件。
