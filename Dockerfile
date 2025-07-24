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

COPY --from=builder /app/server /app/server

EXPOSE 8888

RUN chmod +x ./server

ENTRYPOINT ["./server"]