# neo-blog
新的博客，前端由next驱动，后端由hertz驱动

## 部署

### 使用容器化部署(Docker Compose)(推荐)

```yaml
services:
  frontend:
    container_name: neo-blog-frontend
    image: snowykami/neo-blog-frontend:latest
    networks:
      - internal-network
    restart: always
    volumes:
      - .env.frontend:/app/.env.production:ro

  backend:
    container_name: neo-blog-backend
    image: snowykami/neo-blog-backend:latest
    environment:
      - BASE_URL=https://neo-blog-dev.sfkm.me
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

请勿更改后端容器名，前端容器构建时写死了后端API端点，若有更改请自行构建

```bash
docker-compose up -d
# 或者
docker compose up -d
```

### 使用源码构建部署

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

此阶段可以通过.env.production文件配置后端API端点

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

