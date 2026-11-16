# build
# Go 版本与 go.mod 的 toolchain 一致，升级 Go 时两处一起改；默认走官方镜像，可通过 --build-arg 切换镜像站
ARG GO_IMAGE=golang:1.26.10-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24
# 可选是否在后端镜像中编入裁剪版纯音频 LGPL ffmpeg（默认 false 保持纯净与零体积增量）
ARG ENABLE_FFMPEG=false
ARG FFMPEG_VERSION=7.1.1

FROM ${GO_IMAGE} AS builder

ENV TZ=Asia/Chongqing

WORKDIR /app

RUN apk --no-cache add build-base git tzdata

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o server ./cmd/server

# ffmpeg-builder：仅当 ENABLE_FFMPEG=true 时编译裁剪版纯音频 LGPLv2.1 ffmpeg，否则输出空目录
FROM ${ALPINE_IMAGE} AS ffmpeg-builder

ARG ENABLE_FFMPEG=false
ARG FFMPEG_VERSION=7.1.1

RUN set -eu; \
  mkdir -p /out/bin /out/share/licenses/ffmpeg; \
  case "$(printf '%s' "${ENABLE_FFMPEG}" | tr '[:upper:]' '[:lower:]')" in \
    1|true|yes|on) \
      apk --no-cache add build-base pkgconf curl tar xz zlib-dev; \
      if [ "$(uname -m)" = "x86_64" ]; then apk --no-cache add nasm; fi; \
      mkdir -p /tmp/ffsrc; \
      (curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o /tmp/ffmpeg.tar.xz && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffsrc --strip-components=1) || \
      (curl -fsSL "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n${FFMPEG_VERSION}.tar.gz" -o /tmp/ffmpeg.tar.gz && tar -xf /tmp/ffmpeg.tar.gz -C /tmp/ffsrc --strip-components=1); \
      cd /tmp/ffsrc; \
      FF_CFG="--prefix=/tmp/ffbuild --disable-gpl --disable-nonfree --disable-everything --disable-network --disable-autodetect --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --enable-small --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample --enable-avutil --enable-zlib --enable-protocol=fd,file,pipe --enable-demuxer=aac,flac,matroska,mov,mp3,ogg,pcm_f32le,pcm_s16le,wav --enable-decoder=aac,aac_latm,alac,flac,mp3,mp3float,opus,pcm_f32le,pcm_f64le,pcm_s16be,pcm_s16le,pcm_s24be,pcm_s24le,pcm_s32le,vorbis --enable-parser=aac,aac_latm,flac,mpegaudio,opus,vorbis --enable-filter=aformat,anull,aresample --enable-encoder=pcm_f32le,pcm_s16le --enable-muxer=pcm_f32le,pcm_s16le,wav"; \
      ./configure ${FF_CFG}; \
      make -j"$(nproc)"; \
      cp ffmpeg /out/bin/ffmpeg; \
      strip /out/bin/ffmpeg; \
      /out/bin/ffmpeg -version; \
      dd if=/dev/zero bs=8820 count=1 2>/dev/null | /out/bin/ffmpeg -nostdin -hide_banner -loglevel error -f s16le -ar 44100 -ac 2 -i pipe:0 -ac 1 -ar 11025 -f f32le pipe:1 | wc -c | grep -q '^[1-9]'; \
      cp COPYING.LGPLv2.1 /out/share/licenses/ffmpeg/COPYING.LGPLv2.1; \
      printf 'FFMPEG_VERSION=%s\nCONFIGURE=%s\n' "${FFMPEG_VERSION}" "${FF_CFG}" > /out/share/licenses/ffmpeg/BUILD_INFO.txt; \
      ;; \
    *) \
      echo "ENABLE_FFMPEG=${ENABLE_FFMPEG}: skip building ffmpeg"; \
      ;; \
  esac

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
COPY --from=ffmpeg-builder /out/ /usr/local/

RUN chmod +x /app/server \
  && chown neo-blog:neo-blog /app/server

USER neo-blog

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["/app/server", "-healthcheck"]

ENTRYPOINT ["/app/server"]
