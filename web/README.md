这是一个 [Next.js](https://nextjs.org) 项目，使用 [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app) 引导。

## 开始

首先，运行开发服务器：

```bash
pnpm i

pnpm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000)

您可以通过修改 `app/page.tsx` 来开始编辑页面。该页面会在您编辑文件时自动更新。

此项目使用 [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) 来自动优化和加载 [Geist](https://vercel.com/font)，这是 Vercel 的新字体系列。

## 了解更多

要了解有关 Next.js 的更多信息，请查看以下资源：

- [Next.js Documentation](https://nextjs.org/docs) - 全面的 Next.js 文档。
- [Learn Next.js](https://nextjs.org/learn) - 互动式 Next.js 教程。

您可以查看 [Next.js GitHub 仓库](https://github.com/vercel/next.js) - 欢迎您的反馈和贡献！

## 在 Vercel 上部署

部署 Next.js 应用的最简单方法是使用 [Vercel 平台](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme)，这是 Next.js 的创建者提供的服务。

有关更多详细信息，请查看我们的 [Next.js 部署文档](https://nextjs.org/docs/app/building-your-application/deploying)。

## 项目结构解释
- `api/` - 封装的类型完整的API请求函数。
- `models/` - 模型类型定义。
- `context/` - React上下文，管理全局状态。
- `hooks/` - 自定义React钩子。
- `app/` - [App Router](https://nextjs.org/docs/app)规范目录，基于文件的路由，包含各个页面。
  - `(main)`为主路由组件夹，包含网站的主要页面。
  - `console`为管理后台路由组件夹，包含后台管理页面。
  - `api`为next服务器API路由组件夹，包含后端API接口。
  - `auth`为认证页面，包括登录，注册和找回密码等页面。
- `components/` - 可复用的React组件。
  - `common/` - 通用组件。
  - 其他文件夹按功能划分组件。
- `locales/` - 国际化资源文件。
- `types/` - 全局类型定义。
- `utils/` `lib/` - 工具函数和帮助程序。

## 规范化

- 项目使用eslint进行格式化，运行`pnpm lint`进行检查，运行`pnpm lint:fix`进行自动修复。

- 在风格相似的页面或组件，可以使用相同的tailwindcss类名。
