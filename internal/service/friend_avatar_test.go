package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func makeTestPNG(t *testing.T, w, h int, fill color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, fill)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

func makeTestJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 30, G: 120, B: 220, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

func makeTestICOWithEmbeddedPNG(pngData []byte, w, h byte) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0, 0, 1, 0, 1, 0})
	var entry [16]byte
	entry[0] = w
	entry[1] = h
	entry[4] = 1
	entry[6] = 32
	binary.LittleEndian.PutUint32(entry[8:12], uint32(len(pngData)))
	binary.LittleEndian.PutUint32(entry[12:16], 22)
	buf.Write(entry[:])
	buf.Write(pngData)
	return buf.Bytes()
}

func makeTestICOWith32BitDIB(w, h int) []byte {
	xorBytes := w * h * 4
	andStride := ((w + 31) / 32) * 4
	andBytes := andStride * h
	dibLen := 40 + xorBytes + andBytes
	dib := make([]byte, dibLen)
	binary.LittleEndian.PutUint32(dib[0:4], 40)
	binary.LittleEndian.PutUint32(dib[4:8], uint32(w))
	binary.LittleEndian.PutUint32(dib[8:12], uint32(h*2))
	binary.LittleEndian.PutUint16(dib[12:14], 1)
	binary.LittleEndian.PutUint16(dib[14:16], 32)
	for i := 0; i < w*h; i++ {
		off := 40 + i*4
		dib[off] = 200   // B
		dib[off+1] = 100 // G
		dib[off+2] = 50  // R
		dib[off+3] = 180 // A
	}

	var out bytes.Buffer
	out.Write([]byte{0, 0, 1, 0, 1, 0})
	var entry [16]byte
	if w < 256 {
		entry[0] = byte(w)
	}
	if h < 256 {
		entry[1] = byte(h)
	}
	entry[4] = 1
	entry[6] = 32
	binary.LittleEndian.PutUint32(entry[8:12], uint32(len(dib)))
	binary.LittleEndian.PutUint32(entry[12:16], 22)
	out.Write(entry[:])
	out.Write(dib)
	return out.Bytes()
}

func makeTestICOWith8BitPalette(w, h int) []byte {
	paletteBytes := 256 * 4
	xorStride := ((w*8 + 31) / 32) * 4
	xorBytes := xorStride * h
	andStride := ((w + 31) / 32) * 4
	andBytes := andStride * h
	dib := make([]byte, 40+paletteBytes+xorBytes+andBytes)
	binary.LittleEndian.PutUint32(dib[0:4], 40)
	binary.LittleEndian.PutUint32(dib[4:8], uint32(w))
	binary.LittleEndian.PutUint32(dib[8:12], uint32(h*2))
	binary.LittleEndian.PutUint16(dib[12:14], 1)
	binary.LittleEndian.PutUint16(dib[14:16], 8)
	// Palette index 1 = teal
	dib[40+4] = 180
	dib[40+5] = 160
	dib[40+6] = 20
	pixBase := 40 + paletteBytes
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dib[pixBase+y*xorStride+x] = 1
		}
	}
	var out bytes.Buffer
	out.Write([]byte{0, 0, 1, 0, 1, 0})
	var entry [16]byte
	entry[0] = byte(w)
	entry[1] = byte(h)
	entry[4] = 1
	entry[6] = 8
	binary.LittleEndian.PutUint32(entry[8:12], uint32(len(dib)))
	binary.LittleEndian.PutUint32(entry[12:16], 22)
	out.Write(entry[:])
	out.Write(dib)
	return out.Bytes()
}

func TestBuildFriendAvatarThumbnailFormatsAndSecurity(t *testing.T) {
	// 1. 大尺寸半透明 PNG 缩放到 96×96 并保持 PNG 透明通道
	largeAlphaPNG := makeTestPNG(t, 512, 512, color.NRGBA{R: 12, G: 160, B: 240, A: 128})
	outPNG, ctPNG, err := buildFriendAvatarThumbnail(largeAlphaPNG)
	if err != nil {
		t.Fatalf("resize alpha png: %v", err)
	}
	if ctPNG != "image/png" {
		t.Fatalf("expected image/png, got %s", ctPNG)
	}
	cfgPNG, err := png.DecodeConfig(bytes.NewReader(outPNG))
	if err != nil || cfgPNG.Width != friendAvatarThumbSize || cfgPNG.Height != friendAvatarThumbSize {
		t.Fatalf("unexpected resized png config: %+v, err=%v", cfgPNG, err)
	}

	// 2. 非正方形不透明大图居中裁剪为 96×96 JPEG
	largeRectJPEG := makeTestJPEG(t, 800, 400)
	outJPG, ctJPG, err := buildFriendAvatarThumbnail(largeRectJPEG)
	if err != nil {
		t.Fatalf("resize rect jpeg: %v", err)
	}
	if ctJPG != "image/jpeg" {
		t.Fatalf("expected image/jpeg, got %s", ctJPG)
	}
	cfgJPG, err := jpeg.DecodeConfig(bytes.NewReader(outJPG))
	if err != nil || cfgJPG.Width != friendAvatarThumbSize || cfgJPG.Height != friendAvatarThumbSize {
		t.Fatalf("unexpected resized jpeg config: %+v, err=%v", cfgJPG, err)
	}

	// 3. ICO（内嵌 PNG、32 位 DIB、8 位调色板 DIB 均重编码为标准 PNG/JPEG，不直通原始 ICO）
	icoPNG := makeTestICOWithEmbeddedPNG(largeAlphaPNG, 0, 0)
	outICO1, ctICO1, err := buildFriendAvatarThumbnail(icoPNG)
	if err != nil || ctICO1 != "image/png" || len(outICO1) == 0 {
		t.Fatalf("ico embedded png failed: ct=%s len=%d err=%v", ctICO1, len(outICO1), err)
	}
	icoDIB := makeTestICOWith32BitDIB(128, 128)
	outICO2, ctICO2, err := buildFriendAvatarThumbnail(icoDIB)
	if err != nil || ctICO2 != "image/png" {
		t.Fatalf("ico 32-bit dib failed: ct=%s err=%v", ctICO2, err)
	}
	cfgICO2, err := png.DecodeConfig(bytes.NewReader(outICO2))
	if err != nil || cfgICO2.Width != friendAvatarThumbSize || cfgICO2.Height != friendAvatarThumbSize {
		t.Fatalf("unexpected resized ico dib config: %+v, err=%v", cfgICO2, err)
	}
	ico8Bit := makeTestICOWith8BitPalette(32, 32)
	outICO3, ctICO3, err := buildFriendAvatarThumbnail(ico8Bit)
	if err != nil || ctICO3 != "image/jpeg" || len(outICO3) == 0 {
		t.Fatalf("ico 8-bit palette failed: ct=%s err=%v", ctICO3, err)
	}

	// 4. 安全边界：后端缓存接口一律拒绝 SVG（由前端直连跨域原图渲染，彻底消除同源 SVG XSS/钓鱼）
	anySVG := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#0ea5e9"/></svg>`)
	if _, _, err := buildFriendAvatarThumbnail(anySVG); err == nil {
		t.Fatalf("expected raw svg to be rejected by backend same-origin cache")
	}
	htmlDisguised := []byte(`<!doctype html><html><body>not an image</body></html>`)
	if _, _, err := buildFriendAvatarThumbnail(htmlDisguised); err == nil {
		t.Fatalf("expected html disguised as image to be rejected")
	}

	// 5. PNG 解压炸弹与 ICO 内嵌 PNG 解压炸弹均被立即拦截，绝不回退直通
	var bombHeader bytes.Buffer
	bombHeader.WriteString("\x89PNG\r\n\x1a\n")
	var ihdr [25]byte
	binary.BigEndian.PutUint32(ihdr[0:4], 13)
	copy(ihdr[4:8], "IHDR")
	binary.BigEndian.PutUint32(ihdr[8:12], 20000)
	binary.BigEndian.PutUint32(ihdr[12:16], 20000)
	ihdr[16] = 8
	ihdr[17] = 6
	bombHeader.Write(ihdr[:])
	if _, _, err := buildFriendAvatarThumbnail(bombHeader.Bytes()); err == nil {
		t.Fatalf("expected oversized png dimensions to be rejected")
	}
	icoBomb := makeTestICOWithEmbeddedPNG(bombHeader.Bytes(), 0, 0)
	if _, _, err := buildFriendAvatarThumbnail(icoBomb); err == nil {
		t.Fatalf("expected ico wrapping png decompression bomb to be rejected without passthrough")
	}

	// 6. 非标准端口与反斜杠开放重定向路径校验
	if _, _, err := NormalizeFriendOutboundURL("https://example.com:8443/avatar.png"); err == nil {
		t.Fatalf("expected non-80/443 port to be blocked")
	}
	if model.IsSafeInternalAvatarPath("/\\evil.com") || model.IsSafeInternalAvatarPath("//evil.com") {
		t.Fatalf("expected open-redirect relative paths to be rejected")
	}
	if !model.IsSafeInternalAvatarPath("/api/v1/file/f/42/icon.png") {
		t.Fatalf("expected valid internal file link to be accepted")
	}
}

func TestGetFriendAvatarThumbnailCacheAndPermissions(t *testing.T) {
	alice, bob, _, admin := setupFriendTest(t)
	svc := NewFriendService()

	origRT := friendOutboundRoundTripper
	var upstreamHits atomic.Int32
	samplePNG := makeTestPNG(t, 400, 400, color.NRGBA{R: 20, G: 80, B: 180, A: 255})
	friendOutboundRoundTripper = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Path, "/avatar.png") {
			upstreamHits.Add(1)
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"image/png"}},
				Body:       io.NopCloser(bytes.NewReader(samplePNG)),
			}, nil
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html"}},
			Body:       io.NopCloser(strings.NewReader("<html><title>Test</title></html>")),
		}, nil
	})
	t.Cleanup(func() {
		friendOutboundRoundTripper = origRT
	})

	pub, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil {
		t.Fatalf("list public friends: %v", svcerr)
	}
	groupID := pub.Groups[0].ID

	// Alice 创建一条尚未审核通过的友链（默认 pre_approved）
	mineDto, svcerr := svc.CreateMyFriendLink(userCtx(alice), &dto.UpsertMyFriendLinkReq{
		GroupID:     groupID,
		Name:        "Alice Site",
		URL:         "https://alice-avatar.example.com",
		Avatar:      "https://cdn.example.com/avatar.png",
		Description: "Alice blog",
		ColorKey:    "sky",
	})
	if svcerr != nil {
		t.Fatalf("create link: %v", svcerr)
	}
	if !strings.HasPrefix(mineDto.AvatarURL, "/api/v1/friends/avatar/") {
		t.Fatalf("expected internal avatar_url, got %q", mineDto.AvatarURL)
	}
	hash := model.FriendAvatarHash(mineDto.Avatar)

	// 大小写混合指纹直接拒绝（防 CDN 65536 倍缓存键放大）
	if _, err := svc.GetFriendAvatarThumbnail(userCtx(alice), mineDto.ID, strings.ToUpper(hash)); err == nil || err.Code != http.StatusNotFound {
		t.Fatalf("expected uppercase hash to be rejected with 404, got %v", err)
	}

	// 未登录访客、无关普通用户 Bob、以及仅持有 friends:read 受限 API Token 的管理员令牌均不可读取未审核友链头像
	if _, err := svc.GetFriendAvatarThumbnail(context.Background(), mineDto.ID, hash); err == nil || err.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for guest on unapproved link, got %v", err)
	}
	if _, err := svc.GetFriendAvatarThumbnail(userCtx(bob), mineDto.ID, hash); err == nil || err.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-owner bob, got %v", err)
	}
	readOnlyTokenCtx := ctxutils.WithAPIToken(userCtx(admin), &ctxutils.APITokenInfo{
		Name:   "partner-site",
		Scopes: []string{constant.ScopeFriendsRead},
	})
	if _, err := svc.GetFriendAvatarThumbnail(readOnlyTokenCtx, mineDto.ID, hash); err == nil || err.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for friends:read token on unapproved link, got %v", err)
	}

	// 提交者本人可预览且标记为非公开缓存（IsPublicCache=false）
	ownerRes, svcerr := svc.GetFriendAvatarThumbnail(userCtx(alice), mineDto.ID, hash)
	if svcerr != nil {
		t.Fatalf("owner fetch avatar failed: %v", svcerr)
	}
	if ownerRes.IsPublicCache {
		t.Fatalf("unapproved link avatar must not set IsPublicCache=true")
	}
	if ownerRes.ContentType != "image/jpeg" {
		t.Fatalf("opaque png should compress to jpeg, got %s", ownerRes.ContentType)
	}
	if upstreamHits.Load() != 1 {
		t.Fatalf("expected 1 upstream avatar fetch, got %d", upstreamHits.Load())
	}

	// 管理员审核通过后，访客可直接命中 Redis 缓存（不再次请求上游），且允许 public 缓存
	if _, svcerr := svc.AdminReviewLink(userCtx(admin), mineDto.ID, &dto.AdminReviewFriendLinkReq{
		Status: model.FriendStatusApproved,
	}); svcerr != nil {
		t.Fatalf("admin approve link: %v", svcerr)
	}

	guestRes, svcerr := svc.GetFriendAvatarThumbnail(context.Background(), mineDto.ID, hash)
	if svcerr != nil {
		t.Fatalf("guest fetch approved avatar failed: %v", svcerr)
	}
	if !guestRes.IsPublicCache || guestRes.RedirectURL != "" {
		t.Fatalf("expected IsPublicCache=true and direct data, got %+v", guestRes)
	}
	if upstreamHits.Load() != 1 {
		t.Fatalf("expected Redis/sharedstate cache hit with 0 extra upstream calls, got %d", upstreamHits.Load())
	}

	// 管理员还可使用站内上传文件链接作为友链头像（UseFileLinks 改写后的稳定相对路径）
	internalLink, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:     groupID,
		Name:        "Internal Icon Site",
		URL:         "https://internal-icon.example.com",
		Avatar:      "/api/v1/file/f/99/logo.png",
		Description: "Uses uploaded file",
		ColorKey:    "mint",
		Status:      model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("admin create link with internal file path failed: %v", svcerr)
	}
	if internalLink.AvatarURL != "/api/v1/file/f/99/logo.png" {
		t.Fatalf("expected internal file path preserved in AvatarURL, got %q", internalLink.AvatarURL)
	}
}
