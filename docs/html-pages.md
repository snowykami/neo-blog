# HTML 页面

独立页面的第三种类型（另外两种是正文页面 `content` 与链接页面 `link`）：管理员上传静态 HTML（单个 `.html` 或 `.zip` 包），后端解压到存储并代理访问，前台保留站点顶栏、在沙箱 iframe 中展示。适合独立的演示、小游戏、微型站点。

- 页面类型：`kind = "html"`，只有**管理员**能创建、修改 HTML 页面，或把其他页面改为 HTML 页面（编辑者在接口与控制台中都不可用）
- 实现：`internal/service/page_html.go`（上传、版本、访问）、`internal/service/page_html_bundle.go`（文件包校验）、`internal/controller/page_html.go`（响应头）、`web/src/components/html-page/`、`web/src/app/console/pages/html/[id]/`

## 1. 上传与版本

- 支持单个 `.html` / `.htm`（保存为 `index.html`）或 `.zip`。zip 默认入口为根目录的 `index.html`（其次 `index.htm`，再次是层级最浅的 HTML 文件），上传后可在控制台改选其他 HTML 文件作为入口。
- 压缩整个文件夹时所有文件都在同一个顶层目录下，这一层会被去掉；`__MACOSX/`、`.DS_Store`、`Thumbs.db` 等系统元数据直接跳过。
- 文件包在服务端校验后才写入存储，任何一项不通过都整体拒绝，并在响应的 `data.path` 中返回出错的文件：
  - 路径必须是规范的相对路径：拒绝绝对路径、`..` / `.` / 空段、反斜杠、冒号（盘符）、控制字符与非 UTF-8 文件名，路径长度 ≤ 512、层级 ≤ 32
  - 只接受普通文件：拒绝符号链接、设备文件等特殊条目，以及加密的 zip
  - 扩展名白名单：`html htm css js mjs json map txt wasm`、图片 `png jpg jpeg gif webp avif svg ico bmp`、字体 `woff woff2 ttf otf`、音视频 `mp3 ogg oga opus wav m4a aac flac mp4 webm ogv`。响应类型只由扩展名决定
  - 大小写不敏感的重名、文件与目录同名一律拒绝（避免在大小写不敏感的存储上互相覆盖）
  - 硬性上限（环境变量可调）：

    | 环境变量 | 默认值 | 含义 |
    | --- | --- | --- |
    | `PAGE_HTML_MAX_TOTAL_SIZE` | 100 MiB | 单个版本解压后的总大小；上传请求体也按它限制 |
    | `PAGE_HTML_MAX_FILES` | 1000 | 单个版本的文件数 |
    | `PAGE_HTML_MAX_FILE_SIZE` | 50 MiB | 单个文件的大小 |

    声明的大小先检查一次；实际解压时 `archive/zip` 会校验读出的字节数与声明一致，压缩炸弹无法绕过上限。
- 文件写入默认存储提供者（local / s3 / webdav 均可）的 `page-html/{页面ID}/{版本标识}/` 下。每次上传生成一个新版本并立即生效；每个页面保留最近 5 个版本（当前生效的版本始终保留），更早的版本连同存储中的文件一起删除。控制台可以把任一保留的版本切换为当前版本。删除页面时全部版本与文件随之删除。

## 2. 访问与沙箱

静态文件只经后端代理访问（不跳转存储直链），以便统一设置响应头：

```
GET /api/v1/page-html/{页面ID}/{版本标识}/{文件路径}
```

- 只能访问版本文件清单内的路径；目录路径指向其下的 `index.html`。
- **版本标识是 32 位随机字符串（能力地址）**。沙箱中的文档是不透明源，加载子资源时不会携带站点 Cookie，无法按登录态鉴权，因此用不可猜测的地址控制访问：公开页面的当前版本随页面详情公开；私密页面与未生效版本的标识只返回给管理员。知道地址的人可以访问对应版本，需要“撤回”时上传新版本即可（旧版本会随保留数量被清理）。
- 每个响应（包括 404）都带有：

  | 响应头 | 值 | 作用 |
  | --- | --- | --- |
  | `Content-Security-Policy` | `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals` | **不含 `allow-same-origin`**：即使在新标签页直接打开，文档也是不透明源（`origin` 为 `null`） |
  | `X-Content-Type-Options` | `nosniff` | 禁止浏览器按内容猜测类型 |
  | `Access-Control-Allow-Origin` | `*`（不带 `Allow-Credentials`） | 不透明源以 CORS 模式加载模块脚本、字体 |
  | `Cache-Control` | `public, max-age=31536000, immutable` | 同一版本的内容永不改变 |
  | `Referrer-Policy` | `no-referrer` | |

  另外支持单段 `Range` 请求，方便音视频拖动进度。

上传的 HTML 能做什么、不能做什么：

- 可以：运行脚本（含 ES module、WebAssembly）、打开弹窗与新窗口、提交表单、`alert` / `confirm`、全屏、`fetch` 允许跨域的第三方接口
- 不能：读写本站的 Cookie 与 localStorage（访问即抛 `SecurityError`）、以登录身份调用本站接口（带凭据的请求不会附带 Cookie，且接口不对 `null` 源开放 CORS）、操作父页面

这样即使 HTML 引用的第三方 CDN 脚本被篡改，或 API Token 泄露后被人上传了恶意页面（上传本身仍需管理员登录态），脚本也拿不到站点会话。

## 3. 前台展示

页面路由仍是 `/page/{slug}`，保留站点顶栏与导航，iframe 的 `sandbox` 属性与上面的 CSP 一致：

- 显示尺寸（页面设置 → 显示尺寸）：
  - `fill`（默认）：占满导航栏以下的视口
  - `ratio`：固定宽高比（如 `16:9`，宽高均为 1～1000 的整数），与顶栏同宽，上方显示标题与描述
  - `height`：固定高度（100～10000px），布局同上
  - 勾选「全屏页面」时总是占满整个窗口，顶栏收起为手势条
- 主题：入口地址附带 `?theme=light|dark`；之后站点切换主题时 iframe 不重新加载，而是收到消息：

  ```js
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'neo-blog:theme')
      document.documentElement.dataset.theme = e.data.theme // 'light' | 'dark'
  })
  ```

- iframe 内容不会被搜索引擎收录：页面的标题、描述与封面（用于分享卡片）取自页面设置。
- 尚未上传时前台显示空状态。

## 4. 独立的无 Cookie 源（可选）

默认的不透明源里 `localStorage`、`IndexedDB`、Cookie 都不可用，部分游戏或演示需要它们。可以配置一个专门托管 HTML 页面的源：

```bash
PAGE_HTML_ORIGIN=https://html.example-usercontent.com
```

设置后：

- 页面详情与控制台返回的入口地址改为该源下的绝对地址，`allow_same_origin` 为 `true`，前台 iframe 追加 `allow-same-origin`（前端还会确认地址确实不与站点同源）。
- 后端只在请求**经由该源**时才在 CSP 中追加 `allow-same-origin`：`Host` 必须是该源的主机，且 `X-Forwarded-Host`（若有）也都必须是它。从站点自身的地址访问同一路径时仍是严格沙箱。
- 配置无效（非 http(s)、带路径 / 查询 / 账号）或与站点 `BASE_URL` 同一主机名（不论端口，Cookie 不按端口隔离）时视为未配置，并记录警告。

部署要求：

- 让该域名**直接**反向代理到后端，并保留原始 `Host`（如 nginx 的 `proxy_set_header Host $host;`）。不要经由前端 Next.js 转发：rewrites 会把 `Host` 改写为后端地址、把原始主机放进 `X-Forwarded-Host`，后端会因此拒绝放开 `allow-same-origin`（失败时只是功能退化为严格沙箱，不会放宽）。
- 只需要放行 `/api/v1/page-html/` 前缀，其余接口可以在代理上拒绝。

取舍：

- **优先使用独立的可注册域名**（类似 `githubusercontent.com`）。如果用站点的子域名（如 `html.example.com`），它与站点同站（same-site）：站点若有设置了 `Domain=.example.com` 的 Cookie 会被发送到该子域，子域上的脚本也能为父域写 Cookie（cookie tossing）。使用子域名时请确认站点的 Cookie 都是仅限主机的（不带 `Domain`）。
- 所有 HTML 页面共用这一个源：一个页面的脚本可以读写其他 HTML 页面的 localStorage，也可以打开并操作同源的其他页面。只上传你信任的内容；需要互相隔离的页面不要依赖这一模式。
- 放开 `allow-same-origin` 后，页面可以对该源上的后端接口发同源请求，但该源没有站点 Cookie，所有请求都是匿名的。

## 5. 接口

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/page/p/{slug或ID}` | 按页面可见性 | HTML 页面额外返回 `html_bundle`（当前版本号、入口、地址、`allow_same_origin`） |
| `POST /api/v1/page/p`、`PUT /api/v1/page/p/{id}` | 编辑者；涉及 HTML 页面时仅管理员 | 新增字段 `kind: "html"`、`html_size_mode`、`html_aspect_ratio`、`html_height` |
| `GET /api/v1/page/p/{id}/html/versions` | 管理员 | 版本列表（新版本在前），含文件清单 |
| `POST /api/v1/page/p/{id}/html/versions` | 管理员 | `multipart/form-data`：`file`（必填）、`entry`（可选），创建新版本并立即生效 |
| `PUT /api/v1/page/p/{id}/html/versions/{vid}` | 管理员 | `{ "entry": "...", "active": true }`：修改入口文件 / 切换为当前版本 |
| `GET/HEAD /api/v1/page-html/{页面ID}/{版本标识}/{路径}` | 公开（能力地址） | 静态文件，带沙箱响应头 |
