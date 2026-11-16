#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 编译 NeoBlogIsland (Swift 6 / AppKit + SwiftUI)..."
swift build -c debug

APP_DIR="dist/NeoBlogIsland.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"

cp ".build/debug/NeoBlogIsland" "$MACOS_DIR/NeoBlogIsland"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
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
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
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

echo "==> 已打包无头应用：$PWD/$APP_DIR"
if [[ "${1:-}" == "--open" ]]; then
    pkill -x NeoBlogIsland 2>/dev/null || true
    sleep 0.3
    open "$APP_DIR"
    echo "==> NeoBlogIsland 已在屏幕顶部启动！（右键灵动岛或刷新浏览器验证台即可切换形态）"
fi
