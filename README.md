# 重要消息

由于 CVE-2025-66478 及 CVE-2025-55182 漏洞，可远程执行代码，虽然有容器化层能防护一部分，但是避免不了通过网络横向渗透，请所有用户立刻升级到最新构建！！！

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
