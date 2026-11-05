# neo-blog
新的博客，前端由next驱动，后端由hertz驱动

阅读：[DeepWiki Document / 文档](https://deepwiki.com/snowykami/neo-blog)

![](./image/image.png)

## 功能列表

- [x] 支持Markdown，HTML，Text格式的文章
- [x] 支持文章分类和标签
- [ ] 支持文章置顶
- [x] OIDC认证和注册
- [x] 支持多用户
- [x] 高级评论功能(后端已实装)
- [x] 支持多语言
- [x] 移动端适配
- [ ] 后台管理(未完善)
- [x] 富文本编辑器
- [x] 数学公式（LaTeX，行内 `$…$` 与公式块 `$$…$$`，KaTeX 渲染）

## 部署

### 使用容器化部署(Docker Compose)(推荐)

```yaml
services:
  frontend:
    container_name: neo-blog-frontend
    environment:
      - BACKEND_URL=http://neo-blog-backend:8888  # 此处的后端地址用于前端服务器访问后端服务
    image: snowykami/neo-blog-frontend:latest
    networks:
      - internal-network
    restart: always
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_started
    volumes:
      - .env.frontend:/app/.env.production:ro

  backend:
    container_name: neo-blog-backend
    image: snowykami/neo-blog-backend:latest
    environment:
      - BASE_URL=https://neo-blog-dev.sfkm.me # 此处是外部用户访问端点，用于在某些情况下后端可以生成正确的URL
    networks:
      - internal-network
    restart: always
    volumes:
      - ./data:/app/data
      - .env.backend:/app/.env:ro

networks:
  internal-network:
    driver: bridge
```


```bash
docker-compose up -d
# 或者
docker compose up -d
```

启动后，将外部网关请求转发到前端服务的端口即可

### 使用容器化部署(Kubernetes helm)

可以使用[Helm Chart](https://artifacthub.io/packages/helm/snowykami/neo-blog)进行部署。

```bash
# 从命令行设置此注册中心
helm repo add git.liteyuki.org https://git.liteyuki.org/api/packages/kubernetes/helm
helm repo update
# 要安装包，请运行以下命令
helm install neo-blog git.liteyuki.org/neo-blog
```

### 数据库与 Redis 配置

后端默认使用 `./data/data.db` 的 SQLite。可以用 `DB_URL` 一次配置好数据库，驱动由 scheme 决定；**设置了 `DB_URL` 时，`DB_DRIVER`、`DB_PATH`、`DB_HOST` 等其他 `DB_*` 变量全部忽略**，未设置时仍按 `DB_*` 读取（见 `.env.example`）。

| 数据库 | `DB_URL` 示例 |
| --- | --- |
| Postgres | `postgres://blog:password@postgres:5432/blog?sslmode=disable`（也可写 `postgresql://`） |
| SQLite（绝对路径） | `sqlite:///app/data/data.db` |
| SQLite（相对路径） | `sqlite://./data/data.db` 或 `file:./data/data.db` |

- Postgres 地址原样交给驱动，支持其全部连接参数；用户名、密码中的 `@`、`:`、`/` 等特殊字符需要 URL 编码
- SQLite 地址 `?` 之后的参数追加在默认参数之后，如 `sqlite://./data/data.db?_pragma=foreign_keys(1)`
- scheme 不认识时后端拒绝启动；启动日志中的连接信息会隐藏密码
- Helm 中为 `database.url`，或用 `database.existingSecret` 从已有 Secret 读取（键默认为 `db-url`）

`REDIS_URL` 为可选的共享状态地址，格式为 `redis://[user:password@]host:6379/0`，TLS 用 `rediss://`，也支持 `unix:///path/to/redis.sock`。未设置时使用进程内存，只支持单实例；配置了但连接失败时后端拒绝启动。Helm 中为 `redis.url`，或用 `redis.existingSecret` 从已有 Secret 读取（键默认为 `redis-url`）。

### 多副本部署

默认的单实例部署不需要 Redis。后端需要多个副本（`replicaCount > 1` 或启用自动扩缩容）时：

- 设置 `REDIS_URL`（Helm 中为 `redis.url` 或 `redis.existingSecret`），各副本通过 Redis 共享第三方登录 state、邮箱验证码、限流计数、AI 摘要任务状态、分布式锁与缓存失效通知；配置了 Redis 但连接失败时后端拒绝启动
- 数据库使用 Postgres（`DB_URL=postgres://…` 或 `DB_DRIVER=postgres`，SQLite 只支持单实例）
- 文件存储使用 S3 / WebDAV，或为所有副本挂载同一个共享卷
- 所有副本使用相同的 `JWT_SECRET` 与 `PASSWORD_SALT`

Helm Chart 会在缺少 Redis 或仍使用 SQLite 时拒绝渲染多副本部署（`database.existingSecret` 中的地址渲染时不可见，不做检查）。前端没有跨请求的进程内状态，可直接增加副本。

滚动更新或实例崩溃时，进行中的后台任务不会丢：

- AI 模型的并发上限是所有副本合计（名额是 Redis 中的租约），退出的实例占用的名额最多 45 秒后自动释放
- AI 摘要、存储迁移在 Redis 中登记待办与任务令牌；执行的实例退出后，其他实例在令牌过期后的一分钟内接着做完（存储迁移最多自动继续 5 次）
- AI 用户的任务：收到退出信号后不再领取新任务，等待已领取的最多 20 秒，来不及的立即放回队列由其他实例执行；同一次运行不会重复发评论
- 歌词标注的生成状态与失败冷却在 Redis 中，各副本不会重复生成；生成到一半的实例退出后，下次有人来看时重新生成
- 正在进行的流式响应（AI 写作、歌词流）会断开，重试即可

建议为前后端都配置就绪探针（`/healthz`），避免新实例还没启动完就接到请求。

### 使用源码构建部署(不推荐)

需要准备：go、nodejs、pnpm

1. 克隆仓库

```bash
git clone https://github.com/snowykami/neo-blog.git
cd neo-blog
```

2. 构建后端

```bash
go build -o server ./cmd/server
```

3. 构建前端


```bash
cd web
pnpm install
pnpm build
```

4. 启动和前端

```bash
# 启动后端
./server 

# 启动前端
pnpm start
```

可以通过环境变量或者.env.production文件配置后端API端点

## 开发

### 后端

```bash
# 启动后端服务器
go run ./cmd/server
```

### 前端

```bash
# 进入前端目录
cd web

# 安装依赖
pnpm install

# 启动前端开发服务器
pnpm dev
```

### 前端规范

表单元素使用`grid gap-4`作为容器，表单项使用`grid gap-2`作为容器

flex布局横向使用`flex gap-3`作为容器

### 联合调试

默认情况下，本机启动后端和前端服务器无须额外配置即可互联，若后端在不同的主机上，需要在.env.development(自己创建)中配置`BACKEND_URL`变量

### 环境变量配置

后端所有环境变量及其示例在[`.env.example`](./.env.example)文件中

### 权限

优先使用¬(A ∪ B) 而不是 ¬A ∩ ¬B，尽管两者等价，但前者更符合人类在正向判断的思维习惯

### AI Coding

请阅读[AI Coding 规范](./AGENTS.md)以了解如何使用 AI Coding 功能进行开发。
