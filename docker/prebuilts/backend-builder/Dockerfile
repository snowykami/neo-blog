# 后端 Go 构建期预制品基础镜像：预装 build-base、git 与 tzdata
# 构建上下文：docker/prebuilts/backend-builder
ARG GO_IMAGE=golang:1.26.10-alpine3.24

FROM ${GO_IMAGE}

ENV TZ=Asia/Chongqing

WORKDIR /app

RUN apk --no-cache add build-base git tzdata
