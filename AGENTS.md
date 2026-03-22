# neo-blog 仓库协作指南

本文件面向在本仓库内工作的自动化 Agent / 协作者，目标是让改动尽量贴合项目现有结构、编码风格和开发习惯。

## 1. 项目概览

- 本仓库是一个前后端同仓项目：
  - 后端：Go + Hertz + GORM，代码主要在仓库根目录的 `cmd/`、`internal/`、`pkg/`
  - 前端：Next.js App Router + TypeScript + Tailwind CSS，代码在 `web/`
- 前端包管理器使用 `pnpm`，且相关操作在 `web/` 目录下进行
- 文档与大量注释以中文为主；已有代码中的标识符、错误码、接口字段为英文

## 2. 先看再改

在动手前，先阅读目标功能附近的实现，优先复用现有模式，不要凭空发明新结构。

重点参考：

- 后端入口：`cmd/server/main.go`
- 路由：`internal/router/`、`internal/router/apiv1/`
- 控制器 / 服务 / 仓储：`internal/controller/`、`internal/service/`、`internal/repo/`
- DTO / Model：`internal/dto/`、`internal/model/`
- 前端 API：`web/src/api/`
- 前端页面与组件：`web/src/app/`、`web/src/components/`
- 国际化：`web/src/locales/`
- 项目说明：`README.md`、`web/README.md`

## 3. 目录与分层约定

### 后端

遵循现有分层，不要把职责揉在一起：

- `router`：注册路由
- `controller`：参数绑定、调用 service、返回响应
- `service`：业务逻辑、权限判断、流程编排
- `repo`：数据库访问、查询拼装
- `dto`：接口输入输出结构
- `model`：数据库模型
- `pkg`：公共工具、常量、错误、响应封装

新增接口时，优先沿用 `router -> controller -> service -> repo -> dto/model` 的链路。

### 前端

- `web/src/app/`：Next.js App Router 页面
- `web/src/api/`：请求封装
- `web/src/components/`：组件，按功能分目录
- `web/src/models/`：前端数据模型
- `web/src/hooks/`：自定义 hooks
- `web/src/utils/`、`web/src/lib/`：工具函数
- `web/src/locales/`：多语言文案

## 4. 编码风格

### 通用

- 先遵循现有写法，再考虑“理论上更优”的新写法
- 保持改动最小化，避免无关重构
- 注释语言跟随周边文件；本仓库大多数说明性注释使用中文
- 不要顺手修改无关文件、格式或导入顺序

### Go 后端

- 必须保持 `gofmt` / `goimports` 风格
- 包名、小文件名、目录命名遵循现有 Go 习惯
- 控制器层负责：
  - `BindAndValidate`
  - 调用 service
  - 通过 `pkg/resps` 返回响应
- service 层优先返回 `*errs.ServiceError`，不要直接拼 HTTP 响应
- repo 层专注 GORM 查询，不把大量业务判断塞进 repo
- 统一复用：
  - 错误：`pkg/errs`
  - 响应：`pkg/resps`
  - 常量：`pkg/constant`
  - 工具：`pkg/utils`
- 权限判断保持现有风格：优先写 `!(A || B)`，不要把等价条件展开成 `!A && !B`
- 涉及多角色访问控制时，遵循**保守授权 + 管理员最高权限**原则：
  - 默认按“最小权限”设计，未明确放开的能力一律不要默认开放
  - 访客（未登录用户）只能访问明确允许公开的数据与接口，不要因为前端页面可见就默认后端可访问
  - 普通用户只能访问自己的数据或明确授予用户级权限的资源
  - `admin` 视为最高权限角色，应可访问和管理所有资源；若存在 `editor`、`user` 等角色，其权限范围默认都是 `admin` 的子集
  - 新增权限逻辑时，要同时检查**路由中间件、controller/service 权限判断、前端页面可见性、前端按钮显隐**是否一致，避免出现“前端隐藏但后端未拦截”或“前端不可见但后端实际允许”的情况
  - 对公开接口、公开页面、用户资料等功能，优先先收紧再按需求逐项放开，不要先放开再补限制
- 后端 DTO 的 JSON 字段保持 snake_case，与现有接口一致

### Next.js / TypeScript 前端

- 遵循现有 ESLint/格式化结果，不手写与项目风格冲突的格式
- TypeScript 处于 `strict` 模式，新增代码要补齐类型
- 组件默认优先服务端组件；只有在确实需要浏览器能力时才添加 `'use client'`
- 尽量复用已有 UI 组件、hooks、工具函数，不重复造轮子
- 涉及基础 UI、表单、反馈、弹层、导航、数据展示等场景时，**优先复用 shadcn/ui 组件或通过 shadcn CLI 添加组件**，不要先手写基础轮子
- 组件选型优先级统一为：
  1. 先复用仓库中已有的 `web/src/components/ui/` 与相关封装组件
  2. 若仓库中缺失，则优先在 `web/` 目录执行以下命令添加 shadcn 组件

```bash
pnpm dlx shadcn@latest add <comp>
```

  3. 只有在 shadcn 现有组件明显不适配需求、且无法通过组合/封装解决时，才允许新增自定义基础组件
- 新增 shadcn 组件时，优先使用 CLI 对应组件名（通常为 kebab-case），例如：`alert-dialog`、`dropdown-menu`、`radio-group`
- AI 在实现新页面或新交互时，应优先从以下 shadcn 组件中选型，而不是自行从零实现基础 UI：
  - Accordion
  - Alert
  - Alert Dialog
  - Aspect Ratio
  - Avatar
  - Badge
  - Breadcrumb
  - Button
  - Button Group
  - Calendar
  - Card
  - Carousel
  - Chart
  - Checkbox
  - Collapsible
  - Combobox
  - Command
  - Context Menu
  - Data Table
  - Date Picker
  - Dialog
  - Direction
  - Drawer
  - Dropdown Menu
  - Empty
  - Field
  - Hover Card
  - Input
  - Input Group
  - Input OTP
  - Item
  - Kbd
  - Label
  - Menubar
  - Native Select
  - Navigation Menu
  - Pagination
  - Popover
  - Progress
  - Radio Group
  - Resizable
  - Scroll Area
  - Select
  - Separator
  - Sheet
  - Sidebar
  - Skeleton
  - Slider
  - Sonner
  - Spinner
  - Switch
  - Table
  - Tabs
  - Textarea
  - Toast
  - Toggle
  - Toggle Group
  - Tooltip
  - Typography
- 用户可见文本优先接入 `next-intl`，不要新增散落的硬编码文案
- 新增或修改文案时，同步检查 `web/src/locales/` 下相关语言文件
- 前端请求统一走 `web/src/api/client.ts` 的 `axiosClient`
- 前端模型字段保持 camelCase；后端 snake_case 与前端 camelCase 的转换已由请求层处理，不要重复手动转换
- 项目已有 `@/*` 路径别名，跨目录导入优先复用该别名

### Tailwind / 表单约定

根据 `README.md` 与现有组件实现，优先沿用以下布局习惯：

- 表单整体容器：`grid gap-4`
- 单个表单项容器：`grid gap-2`
- 横向 flex 间距：`flex gap-3`

风格相近的页面和组件，尽量复用相同或相似的 Tailwind 类名组合。

## 5. 现有实现中的关键约定

- 前端使用 `next-intl` 做国际化
- 前端 UI 体系基于 Tailwind + shadcn/ui（见 `web/components.json`）
- 前端通过 `field-conv` 在请求层完成 camelCase / snake_case 转换
- 后端统一响应结构由 `pkg/resps` 输出
- 后端错误语义通过 `pkg/errs.ServiceError` 表达
- 帖子等资源普遍同时支持 `slug` 和 `id` 访问，相关逻辑先看现有实现再扩展

## 6. 修改时的建议流程

1. 阅读目标模块及相邻实现
2. 确认应落在哪一层/哪个目录
3. 只做当前需求所需的最小改动
4. 自检是否破坏了前后端字段、权限逻辑、多语言或样式约定
5. 运行必要验证命令

## 7. 常用命令

### 仓库根目录

```bash
# 启动后端
go run ./cmd/server

# 构建后端
go build -o bin/server ./cmd/server

# 后端测试
go test ./...
```

### 前端目录 `web/`

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm lint:fix
```

## 8. 验证要求

按改动范围选择最小但足够的验证：

- 后端代码改动：至少运行 `go test ./...`
- 后端入口/编译相关改动：补充运行 `go build -o bin/server ./cmd/server`
- 前端代码改动：至少运行 `cd web && pnpm lint`
- 前端路由、构建、配置类改动：补充运行 `cd web && pnpm build`
- 前后端接口联动改动：检查 DTO、前端 model、API 封装、页面使用是否一致

如果当前环境无法完整执行验证，请在结果说明里明确写出“已执行”和“未执行”的部分。

## 9. 不要做的事

- 不要改动 `web/.next/`、`web/node_modules/`、构建产物或缓存目录
- 不要在没有明确需求时引入新的状态管理、请求库、UI 方案或格式化工具
- 不要绕过现有分层直接把业务逻辑塞进页面、controller 或 repo
- 不要在没有明确要求时执行 `git commit`、`git push`、大范围重构或批量格式化

## 10. Git 提交信息规范

仅在**需求明确要求执行 `git commit`** 时使用以下规范：

- 提交信息格式统一为：`<gitmoji> type(scope): subject`
- 推荐优先使用 **Gitmoji + Conventional Commit** 的组合写法，即：
  - 前缀使用 **一个最能代表本次改动主意图的 gitmoji 表情**
  - 后面仍保持 `type(scope): subject` 结构，便于检索、筛选与生成变更日志
- 推荐使用实际 emoji 字符，不使用 `:sparkles:` 这种短代码形式
- 常用 gitmoji 与 `type` 对应建议如下：
  - `✨ feat`：新功能
  - `🐛 fix`：修复问题
  - `♻️ refactor`：重构
  - `📝 docs`：文档调整
  - `✅ test`：测试相关
  - `🔧 chore`：杂项维护、配置微调
  - `💄 style`：纯样式/UI/格式调整（不影响逻辑）
  - `⚡️ perf`：性能优化
  - `📦 build`：构建系统、产物、依赖或包管理调整
  - `👷 ci`：CI/CD 调整
  - `⏪️ revert`：回滚变更
- 若改动明显属于特定语义，也可按需使用更贴切的 gitmoji，但仍建议保留后面的 `type(scope): subject` 结构，例如：
  - `🌐 feat(i18n): 补充法语界面文案`
  - `🚀 chore(deploy): 调整生产部署参数`
- `scope` 表示改动模块，优先使用具体功能域、目录或子系统名称，例如：
  - `post`
  - `comment`
  - `user`
  - `auth`
  - `router`
  - `repo`
  - `console`
  - `editor`
  - `i18n`
- `deploy`
- `subject` 要简洁明确，直接描述本次改动，不写空泛表述，不加句号，避免使用“更新代码”“修改一下”这类无信息量描述
- `subject` 使用动宾短语，聚焦“做了什么”，不要写成过程记录或情绪化描述
- 一次提交尽量只表达一个主要意图，避免把多个无关改动揉进同一条提交信息

示例：

- `✨ feat(comment): 完成后台评论管理接口`
- `🐛 fix(file): 修复删除文件时错误变量判断`
- `♻️ refactor(post): 拆分文章列表查询逻辑`
- `📝 docs(agents): 补充提交信息约定`
- `👷 ci(workflow): 调整镜像构建流程`

## 11. 涉及部署时

如果改动影响部署，请同步检查相关文件是否需要更新：

- `Dockerfile`
- `web/Dockerfile`
- `helm/`
- `.github/workflows/`
- `.gitea/workflows/`

仅在需求明确涉及部署链路时修改这些文件，避免“顺手修”。
