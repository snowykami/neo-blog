FRONTEND_IMAGE = snowykami/neo-blog-frontend:latest
BACKEND_IMAGE = snowykami/neo-blog-backend:latest

# 镜像名
FRONTEND_IMAGE = snowykami/neo-blog-frontend:latest
BACKEND_IMAGE = snowykami/neo-blog-backend:latest

# 构建前端镜像
.PHONY: build-frontend
build-frontend:
	docker build -t $(FRONTEND_IMAGE) ./web

# 构建后端镜像
.PHONY: build-backend
build-backend:
	docker build -t $(BACKEND_IMAGE) .

# 构建全部镜像
.PHONY: build
build: build-frontend build-backend

# 推送前端镜像
.PHONY: push-frontend
push-frontend:
	docker push $(FRONTEND_IMAGE)

# 推送后端镜像
.PHONY: push-backend
push-backend:
	docker push $(BACKEND_IMAGE)

# 推送全部镜像
.PHONY: push
push: push-frontend push-backend