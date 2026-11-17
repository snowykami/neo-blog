#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="debug"
UNIVERSAL=false
PACKAGE=false
OPEN_AFTER=false

for arg in "$@"; do
    case "$arg" in
        --release)
            CONFIG="release"
            ;;
        --universal)
            UNIVERSAL=true
            ;;
        --package|--dmg)
            PACKAGE=true
            ;;
        --open)
            OPEN_AFTER=true
            ;;
        *)
            echo "未知参数: $arg" >&2
            echo "用法: $0 [--release] [--universal] [--package|--dmg] [--open]" >&2
            exit 1
            ;;
    esac
done

APP_VERSION="${APP_VERSION:-0.1.0}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"

if [[ "$UNIVERSAL" == "true" ]]; then
    echo "==> 编译 NeoBlogIsland Universal Binary ($CONFIG: arm64 + x86_64, version=$APP_VERSION)..."
    swift build -c "$CONFIG" --arch arm64 --arch x86_64
    BIN_DIR="$(swift build -c "$CONFIG" --arch arm64 --arch x86_64 --show-bin-path)"
else
    echo "==> 编译 NeoBlogIsland ($CONFIG, version=$APP_VERSION)..."
    swift build -c "$CONFIG"
    BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
fi

BIN_PATH="${BIN_DIR}/NeoBlogIsland"

if [[ ! -f "$BIN_PATH" ]]; then
    echo "错误：未找到编译产物 $BIN_PATH" >&2
    exit 1
fi

APP_DIR="dist/NeoBlogIsland.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"

cp "$BIN_PATH" "$MACOS_DIR/NeoBlogIsland"
chmod +x "$MACOS_DIR/NeoBlogIsland"

if [[ "$CONFIG" == "release" ]]; then
    strip -rSTx "$MACOS_DIR/NeoBlogIsland" 2>/dev/null || strip -x "$MACOS_DIR/NeoBlogIsland" || true
fi

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>NeoBlogIsland</string>
    <key>CFBundleIdentifier</key>
    <string>me.sfkm.neoblog.island</string>
    <key>CFBundleName</key>
    <string>NeoBlogIsland</string>
    <key>CFBundleDisplayName</key>
    <string>NeoBlogIsland</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${APP_VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${BUILD_NUMBER}</string>
    <key>LSMinimumSystemVersion</key>
    <string>15.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
</dict>
</plist>
PLIST

echo "==> 签名应用包 (identity=${CODESIGN_IDENTITY})..."
codesign --force --deep --sign "$CODESIGN_IDENTITY" "$APP_DIR"

echo "==> 已打包无头应用：$PWD/$APP_DIR"
file "$MACOS_DIR/NeoBlogIsland"

if [[ "$PACKAGE" == "true" ]]; then
    ARCH_SUFFIX="universal"
    if [[ "$UNIVERSAL" != "true" ]]; then
        ARCH_SUFFIX="$(uname -m)"
    fi
    ZIP_NAME="NeoBlogIsland-${ARCH_SUFFIX}.app.zip"
    DMG_NAME="NeoBlogIsland-${ARCH_SUFFIX}.dmg"
    STAGE_DIR="dist/dmg-staging"

    rm -rf "dist/$ZIP_NAME" "dist/$DMG_NAME" "dist/SHA256SUMS.txt" "$STAGE_DIR"

    echo "==> 生成压缩归档 dist/$ZIP_NAME ..."
    ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "dist/$ZIP_NAME"

    echo "==> 生成磁盘映像 dist/$DMG_NAME ..."
    mkdir -p "$STAGE_DIR"
    cp -R "$APP_DIR" "$STAGE_DIR/NeoBlogIsland.app"
    ln -s /Applications "$STAGE_DIR/Applications"
    cat > "$STAGE_DIR/首次打开说明.txt" <<'README'
NeoBlogIsland (neo-blog macOS 原生桌面灵动岛)
=============================================

1. 安装方式
   将 NeoBlogIsland.app 拖入右侧 Applications（应用程序）文件夹即可。

2. 首次启动说明
   若双击打开时 macOS 提示“未验证开发者”或“已损坏”，可在终端执行以下命令解除隔离属性后启动：

   xattr -cr /Applications/NeoBlogIsland.app
   open /Applications/NeoBlogIsland.app

3. 使用与配置
   - 启动后顶部菜单栏会出现波形图标，同时屏幕顶部刘海/胶囊区域进入待命。
   - 在博客「后台 › 个人设置 › 个性化 › 桌面灵动岛（macOS）」中开启联动即可实时投射歌词与控播。
README

    hdiutil create \
        -volname "NeoBlogIsland" \
        -srcfolder "$STAGE_DIR" \
        -ov \
        -format UDZO \
        "dist/$DMG_NAME" >/dev/null
    rm -rf "$STAGE_DIR"

    (
        cd dist
        shasum -a 256 "$DMG_NAME" "$ZIP_NAME" > SHA256SUMS.txt
    )
    echo "==> 分发包已生成："
    cat dist/SHA256SUMS.txt
fi

if [[ "$OPEN_AFTER" == "true" ]]; then
    pkill -x NeoBlogIsland 2>/dev/null || true
    sleep 0.3
    open "$APP_DIR"
    echo "==> NeoBlogIsland 已在屏幕顶部启动！（右键灵动岛或刷新浏览器验证台即可切换形态）"
fi
