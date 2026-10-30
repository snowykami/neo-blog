# 用 MCP 让外部 AI 编辑文章

neo-blog 后端内置了一个远程 MCP 服务（Streamable HTTP），Claude Code、Claude Desktop、Cursor 等支持 MCP 的 AI 工具可以用**个人 API Token** 以你的身份读取、起草和发布文章。

- 端点：`https://<你的站点>/api/v1/mcp`（经前端 rewrites 转发到后端，也可以直连后端 `http://<后端>:8888/api/v1/mcp`）
- 鉴权：`Authorization: Bearer nbp_...`，**只接受 API Token**，不接受浏览器 Cookie
- 实现：`internal/mcpserver/`，路由见 `internal/router/apiv1/mcp.go`

## 1. 创建 API Token

控制台 → 个人设置 → **API Token** → 创建 Token：

| 权限范围 | 能做什么 | 角色要求 |
| --- | --- | --- |
| `posts:read` | 列出、读取文章；作者本人与管理员可读草稿 | 所有登录用户 |
| `posts:write` | 创建文章、写入草稿；**不会改动读者看到的内容** | 编辑者及以上 |
| `posts:publish` | 发布 / 取消发布；修改公开文章的标题、摘要、slug、封面、分类、标签 | 编辑者及以上 |
| `files:write` | 上传图片 | 所有登录用户 |

- Token 明文只在创建时显示一次，库中只保存 SHA-256 哈希；遗失后吊销并重新创建即可。
- **生效权限 = Token 的权限范围 ∩ 用户当前角色**。用户被降级或禁用后，已有 Token 立即随之受限或失效。
- 管理 Token 的接口（`/api/v1/user/api-tokens`）只接受浏览器登录态，Token 不能创建或吊销 Token。
- 只想让 AI 起草、由自己发布时，只勾选 `posts:read` + `posts:write`（+ `files:write`）。

## 2. 连接客户端

### Claude Code

```bash
claude mcp add --transport http neo-blog https://<你的站点>/api/v1/mcp --header "Authorization: Bearer nbp_xxx"
```

加上 `--scope user` 可在所有项目中使用；`claude mcp list` 可检查连接状态。创建 Token 后的弹窗里会直接给出填好地址与 Token 的命令。

### Cursor 等使用 JSON 配置的客户端

```json
{
  "mcpServers": {
    "neo-blog": {
      "type": "http",
      "url": "https://<你的站点>/api/v1/mcp",
      "headers": { "Authorization": "Bearer nbp_xxx" }
    }
  }
}
```

### Claude Desktop

Claude Desktop 的配置文件只能启动本地进程，可以借助 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接远程端点（编辑 `claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "neo-blog": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<你的站点>/api/v1/mcp", "--header", "Authorization:${NEO_BLOG_AUTH}"],
      "env": { "NEO_BLOG_AUTH": "Bearer nbp_xxx" }
    }
  }
}
```

> Claude.ai 网页版的「自定义连接器」需要 OAuth 授权流程，目前**不支持**（见第 5 节）。

## 3. 工具

| 工具 | 权限 | 说明 |
| --- | --- | --- |
| `list_posts` | `posts:read` | 搜索 / 列出文章（关键词、分类、标签、仅自己的），不含正文；管理员可见所有私密文章 |
| `get_post` | `posts:read` | 读取单篇文章的元信息与正文；作者或管理员默认读到最新草稿 |
| `list_taxonomy` | `posts:read` | 列出全部分类与标签及其 ID |
| `create_post` | `posts:write` | 新建文章：以**私密**状态创建，正文写入草稿 |
| `update_post` | `posts:write` | 正文写入草稿；元信息立即生效，公开文章上修改元信息还需要 `posts:publish` |
| `publish_post` | `posts:publish` | 把当前草稿发布为正文，并将文章设为公开 |
| `unpublish_post` | `posts:publish` | 将文章设为私密，内容保留 |
| `upload_image` | `files:write` | 上传 base64 编码的 PNG / JPEG / GIF / WebP（≤ 10 MiB），返回 URL 与 Markdown |

没有删除工具。工具的参数校验失败、权限不足、被编辑锁拒绝等都会以可读的工具错误返回，便于 AI 向用户解释原因。

### 正文格式

库中正文是富文本编辑器（Tiptap）产出的 HTML。工具默认以 **Markdown** 读写（`content_format: "markdown"`），服务端负责转换：

- 写入：GFM Markdown → HTML（表格、代码块、删除线等）；Markdown 中可以直接写 HTML。
- 读取：HTML → Markdown。站内组件块（`<div data-component=...>`）原样保留为 HTML，往返不丢失。
- 文字颜色、对齐等 Markdown 无法表达的样式在 Markdown 往返中会丢失；对排版复杂的文章做小修改时，请让 AI 使用 `content_format: "html"`。

## 4. 安全边界：草稿、编辑锁与版本历史

- **草稿优先**：`create_post` / `update_post` 只写草稿，读者看到的正文不变，直到 `publish_post`。新文章默认私密。
- **编辑锁**：沿用控制台的编辑会话（`edit-session`）。文章在控制台编辑页中打开时，AI 的所有写入（包括元信息与发布）都会被拒绝（`edit_session_in_use`），绝不覆盖正在编辑的人。编辑页会定时刷新会话的活跃时间；关闭编辑页约 3 分钟后锁自动释放。人随时可以在编辑页接管，横幅会显示“API Token「名称」”为当前持有者。
- **版本历史**：AI 的每次写入都单独记录一个版本（不受自动保存 10 分钟间隔限制），并记录所用 Token；第一次写入前会记录编辑起点。控制台的版本历史中显示“经 API Token「名称」”，可随时恢复或放弃未发布的修改。
- **权限复用**：工具直接调用 service 层，作者 / 管理员判断、私密文章可见性等与控制台完全一致。

## 5. 暂不支持 / 后续计划

- **OAuth（第二阶段）**：Claude.ai 网页版与部分托管客户端只支持 OAuth 授权的远程 MCP。需要实现授权服务器元数据（RFC 8414）、受保护资源元数据（RFC 9728）、动态客户端注册与授权码 + PKCE 流程，Token 仍映射到本文的权限范围。
- 页面（Page）、评论等其他资源的工具。

## 6. 本地调试

```bash
# 列出工具（无状态 JSON 模式，可直接用 curl 调用）
curl -s http://localhost:8888/api/v1/mcp \
  -H 'Authorization: Bearer nbp_xxx' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

也可以使用 MCP Inspector：`npx @modelcontextprotocol/inspector`，Transport 选 Streamable HTTP 并添加 `Authorization` 头。
