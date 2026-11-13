# build
# Go 版本与 go.mod 的 toolchain 一致，升级 Go 时两处一起改；默认走官方镜像，可通过 --build-arg 切换镜像站
ARG GO_IMAGE=golang:1.26.10-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

FROM ${GO_IMAGE} AS builder

ENV TZ=Asia/Chongqing

WORKDIR /app

RUN apk --no-cache add build-base git tzdata

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o server ./cmd/server

# production
# 固定 Alpine 小版本（与构建阶段的 golang:*-alpine3.24 一致），避免 latest 跨大版本漂移；3.24 标签会跟随补丁版本更新
FROM ${ALPINE_IMAGE} AS prod

ENV TZ=Asia/Chongqing

WORKDIR /app

# 允许在 build 时通过 --build-arg 指定 UID/GID（默认 1000:1000）
ARG NEO_UID=1000
ARG NEO_GID=1000

RUN apk --no-cache add tzdata \
  && addgroup -S -g ${NEO_GID} neo-blog \
  && adduser -S -u ${NEO_UID} -G neo-blog -s /sbin/nologin neo-blog \
  && mkdir -p /app \
  && chown -R neo-blog:neo-blog /app

COPY --from=builder /app/server /app/server

RUN chmod +x /app/server \
  && chown neo-blog:neo-blog /app/server

USER neo-blog

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["/app/server", "-healthcheck"]

ENTRYPOINT ["/app/server"]
