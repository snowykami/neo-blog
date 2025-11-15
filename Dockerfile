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

RUN apk --no-cache add tzdata \
  && addgroup -S neo-blog \
  && adduser -S -G neo-blog neo-blog \
  && mkdir -p /app \
  && chown -R neo-blog:neo-blog /app

COPY --from=builder /app/server /app/server

RUN chmod +x /app/server \
  && chown neo-blog:neo-blog /app/server

USER neo-blog

EXPOSE 8888

ENTRYPOINT ["./server"]
