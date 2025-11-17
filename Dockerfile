# build
FROM golang:1.24.2-alpine3.21 AS builder

ENV TZ=Asia/Chongqing

WORKDIR /app

RUN apk --no-cache add build-base git tzdata

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o server ./cmd/server

# production
FROM alpine:latest AS prod

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

ENTRYPOINT ["./server"]
