# 后端运行时预制品基础镜像：预装裁剪版纯音频 LGPLv2.1 ffmpeg、tzdata 与非 root 运行用户
# 构建上下文：docker/prebuilts/backend-runtime
ARG ALPINE_IMAGE=alpine:3.24
ARG FFMPEG_VERSION=7.1.1

FROM ${ALPINE_IMAGE} AS ffmpeg-builder

ARG FFMPEG_VERSION=7.1.1

RUN set -eu; \
  mkdir -p /out/bin /out/share/licenses/ffmpeg /tmp/ffsrc; \
  apk --no-cache add build-base pkgconf curl tar xz zlib-dev; \
  if [ "$(uname -m)" = "x86_64" ]; then apk --no-cache add nasm; fi; \
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
  printf 'FFMPEG_VERSION=%s\nCONFIGURE=%s\n' "${FFMPEG_VERSION}" "${FF_CFG}" > /out/share/licenses/ffmpeg/BUILD_INFO.txt

FROM ${ALPINE_IMAGE}

ENV TZ=Asia/Chongqing

ARG NEO_UID=1000
ARG NEO_GID=1000

RUN apk --no-cache add tzdata \
  && addgroup -S -g ${NEO_GID} neo-blog \
  && adduser -S -u ${NEO_UID} -G neo-blog -s /sbin/nologin neo-blog \
  && mkdir -p /app \
  && chown -R neo-blog:neo-blog /app

COPY --from=ffmpeg-builder /out/ /usr/local/
