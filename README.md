# neo-blog
新的博客，前端由next驱动，后端由hertz驱动

## 功能列表

- [x] 支持Markdown，HTML，Text格式的文章
- [x] 支持文章分类和标签
- [ ] 页面管理
- [ ] 支持文章置顶
- [x] OIDC认证和注册
- [x] 支持多用户
- [ ] 高级评论功能(后端已实装)
- [ ] 支持多语言
- [x] 移动端适配
- [ ] 后台管理
- [ ] 富文本编辑器

## 部署

### 使用容器化部署(Docker Compose)(推荐)

```yaml
services:
  frontend:
    container_name: neo-blog-frontend
    environment:
      - BACKEND_URL=http://neo-blog-backend:8888  # 此处请保证和后端服务的名称一致
    image: snowykami/neo-blog-frontend:latest
    networks:
      - internal-network
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - .env.frontend:/app/.env.production:ro

  backend:
    container_name: neo-blog-backend
    image: snowykami/neo-blog-backend:latest
    environment:
      - BASE_URL=https://neo-blog-dev.sfkm.me # 此处是外部用户访问端点，也许你使用了nginx等反向代理
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

### 使用源码构建部署(除开发场景外不推荐)

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

## 环境变量配置
后端所有环境变量及其示例在[`.env.example`](./.env.example)文件中