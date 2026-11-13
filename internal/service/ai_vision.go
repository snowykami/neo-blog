package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 识图：后台开启「启用识图」后，AI 摘要与 AI 用户读文章时把正文中的图片一并发给模型。
// 图片以 data URL（base64）作为 OpenAI 兼容的 image_url 内容块放进用户消息，不依赖模型服务能否访问本站。
// 站内文件（/api/v1/file/f/<id>）直接从存储读取，外链图片经防 SSRF 的 utils.SafeFetch 下载；
// 按内容嗅探只接受 JPEG / PNG / WebP / GIF，单张、单次调用的数量与总大小都有上限，超出的图片只保留文字占位。
// 模型拒收图片（400 等）时去掉图片按纯文本重试一次，并按接口地址与模型记住一段时间，期间不再发送图片

const (
	AIVisionMaxImages     = 6                // 每次调用最多附带的图片数，取正文靠前的
	aiVisionMaxImageBytes = 4 << 20          // 单张图片上限，超过的跳过
	aiVisionMaxTotalBytes = 8 << 20          // 单次调用全部图片的上限（base64 后约 11 MB），超出的跳过
	aiVisionFetchTimeout  = 15 * time.Second // 单张图片的读取超时
)

// aiVisionImageTypes 接受的图片类型（按内容嗅探）
var aiVisionImageTypes = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}

// ContentImage 正文中的一张图片
type ContentImage struct {
	Index int    // 在正文中是第几张（从 1 开始），与占位 [图N] 对应
	Src   string // 原始地址
	Alt   string // 替代文本（已反转义）
}

// VisionImage 已读取、可以发给模型的图片
type VisionImage = llmclient.VisionImage

var (
	reHTMLImage     = regexp.MustCompile(`(?is)<img\b[^>]*>`)
	reMarkdownImage = regexp.MustCompile(`!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)`)
	// 属性前必须是空白或 /，避免 data-src 之类的属性被当成 src
	reImageSrc = regexp.MustCompile(`(?is)[\s/]src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
	reImageAlt = regexp.MustCompile(`(?is)[\s/]alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
	// Markdown 正文里的图片：Markdown 写法与原样保留的 <img>
	reMarkdownOrHTMLImage = regexp.MustCompile(reHTMLImage.String() + `|` + reMarkdownImage.String())
)

// imageAttr 取 <img> 标签的属性值（未反转义）
func imageAttr(re *regexp.Regexp, tag string) string {
	m := re.FindStringSubmatch(tag)
	if m == nil {
		return ""
	}
	return m[1] + m[2] + m[3]
}

// imagePlaceholder 正文中图片位置的文字占位：[图N：alt] 或 [图N]
func imagePlaceholder(index int, alt string) string {
	alt = strings.Join(strings.Fields(alt), " ")
	if alt == "" {
		return fmt.Sprintf("[图%d]", index)
	}
	return fmt.Sprintf("[图%d：%s]", index, clipRunes(alt, 100))
}

// replaceHTMLImages 把正文 HTML 中的 <img> 依次替换为文字占位，返回替换后的 HTML 与图片列表（按出现顺序）。
// 占位里的替代文本保持 HTML 转义，之后转纯文本时统一反转义
func replaceHTMLImages(content string) (string, []ContentImage) {
	var images []ContentImage
	out := reHTMLImage.ReplaceAllStringFunc(content, func(tag string) string {
		src := strings.TrimSpace(html.UnescapeString(imageAttr(reImageSrc, tag)))
		if src == "" {
			return ""
		}
		rawAlt := imageAttr(reImageAlt, tag)
		img := ContentImage{Index: len(images) + 1, Src: src, Alt: strings.TrimSpace(html.UnescapeString(rawAlt))}
		images = append(images, img)
		return " " + imagePlaceholder(img.Index, rawAlt) + " "
	})
	return out, images
}

// articleTextWithImages 正文 HTML 转为纯文本，图片在原位置留下 [图N：alt] 占位（未开启识图时也保留，模型至少知道这里有图）
func articleTextWithImages(content string) (string, []ContentImage) {
	replaced, images := replaceHTMLImages(content)
	return htmlToPlainText(replaced), images
}

// AnnotateMarkdownImages 在 Markdown 正文（工具读到的文章，可能夹带原样保留的 HTML 组件）的每张图片后面加上 [图N] 编号，
// 返回标注后的正文与图片列表（按出现顺序）；附带图片时据此与正文对应
func AnnotateMarkdownImages(markdown string) (string, []ContentImage) {
	var images []ContentImage
	out := reMarkdownOrHTMLImage.ReplaceAllStringFunc(markdown, func(m string) string {
		var src, alt string
		if strings.HasPrefix(m, "<") {
			src = html.UnescapeString(imageAttr(reImageSrc, m))
			alt = html.UnescapeString(imageAttr(reImageAlt, m))
		} else if sub := reMarkdownImage.FindStringSubmatch(m); sub != nil {
			alt, src = sub[1], sub[2]
		}
		src = strings.TrimSpace(src)
		if src == "" {
			return m
		}
		img := ContentImage{Index: len(images) + 1, Src: src, Alt: strings.TrimSpace(alt)}
		images = append(images, img)
		return m + fmt.Sprintf(" [图%d]", img.Index)
	})
	return out, images
}

// LoadVisionImages 读取正文靠前的图片（同一地址只读一次），最多 limit 张（不超过 AIVisionMaxImages）；
// 读不到、格式不支持、超过大小上限的跳过，只留文字占位。各图片并行读取，结果保持正文顺序
func LoadVisionImages(ctx context.Context, images []ContentImage, limit int) []VisionImage {
	limit = min(limit, AIVisionMaxImages)
	var candidates []ContentImage
	seen := map[string]bool{}
	for _, img := range images {
		if len(candidates) >= limit {
			break
		}
		if seen[img.Src] {
			continue
		}
		seen[img.Src] = true
		candidates = append(candidates, img)
	}
	if len(candidates) == 0 {
		return nil
	}
	loaded := make([][]byte, len(candidates))
	mimes := make([]string, len(candidates))
	var wg sync.WaitGroup
	for i, img := range candidates {
		wg.Go(func() {
			loadCtx, cancel := context.WithTimeout(ctx, aiVisionFetchTimeout)
			defer cancel()
			data, mime, err := loadVisionImage(loadCtx, img.Src)
			if err != nil {
				logrus.Debugf("skip image for vision %q: %v", clipRunes(img.Src, 120), err)
				return
			}
			loaded[i], mimes[i] = data, mime
		})
	}
	wg.Wait()
	var result []VisionImage
	total := 0
	for i, img := range candidates {
		data := loaded[i]
		if data == nil || total+len(data) > aiVisionMaxTotalBytes {
			continue
		}
		total += len(data)
		result = append(result, VisionImage{
			Index:   img.Index,
			Alt:     img.Alt,
			DataURL: "data:" + mimes[i] + ";base64," + base64.StdEncoding.EncodeToString(data),
			Size:    len(data),
		})
	}
	return result
}

// loadVisionImage 读取一张图片：站内文件从存储读取，data URL 直接解码，其他 http(s) 地址经防 SSRF 下载；返回内容与嗅探出的类型
func loadVisionImage(ctx context.Context, src string) ([]byte, string, error) {
	var data []byte
	var err error
	switch {
	case strings.HasPrefix(strings.ToLower(src), "data:"):
		data, err = decodeImageDataURL(src)
	default:
		if id, ok := siteFileID(src); ok {
			data, err = readSiteFile(ctx, id)
			break
		}
		target, ok := externalImageURL(src)
		if !ok {
			return nil, "", errors.New("unsupported image address")
		}
		var res *utils.SafeFetchResult
		res, err = utils.SafeFetch(ctx, target, aiVisionMaxImageBytes, "image/", "application/octet-stream", "binary/octet-stream")
		if err == nil {
			if res.Truncated {
				return nil, "", errors.New("image too large")
			}
			data = res.Body
		}
	}
	if err != nil {
		return nil, "", err
	}
	mime := http.DetectContentType(data)
	if !slices.Contains(aiVisionImageTypes, mime) {
		return nil, "", fmt.Errorf("unsupported image type %q", mime)
	}
	return data, mime, nil
}

// siteFileID 站内文件的稳定链接（相对路径或带本站域名）对应的文件 ID
func siteFileID(src string) (uint, bool) {
	u, err := url.Parse(src)
	if err != nil {
		return 0, false
	}
	if u.Host != "" {
		base, err := url.Parse(tools.GetBaseUrl())
		if err != nil || base.Host == "" || !strings.EqualFold(u.Host, base.Host) {
			return 0, false
		}
	} else if u.Scheme != "" {
		return 0, false
	}
	rest, ok := strings.CutPrefix(u.Path, fileLinkPath)
	if !ok {
		return 0, false
	}
	idStr, _, _ := strings.Cut(rest, "/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		return 0, false
	}
	return uint(id), true
}

// externalImageURL 可以下载的外链地址（http / https，协议相对地址按 https）；其他相对路径无法安全解析，不下载
func externalImageURL(src string) (string, bool) {
	if strings.HasPrefix(src, "//") {
		src = "https:" + src
	}
	u, err := url.Parse(src)
	if err != nil || u.Host == "" || !(u.Scheme == "http" || u.Scheme == "https") {
		return "", false
	}
	return u.String(), true
}

// readSiteFile 从存储读取站内文件，超过单张上限的不读
func readSiteFile(ctx context.Context, id uint) ([]byte, error) {
	file, svcerr := repo.File.GetByIDCached(id)
	if svcerr != nil {
		return nil, svcerr
	}
	if file.Size > aiVisionMaxImageBytes {
		return nil, errors.New("image too large")
	}
	provider, ok := storage.GetStorageProvider(file.ProviderID)
	if !ok {
		return nil, errors.New("storage provider not found")
	}
	f, err := provider.Open(ctx, fileStoragePath(file.Hash))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, aiVisionMaxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > aiVisionMaxImageBytes {
		return nil, errors.New("image too large")
	}
	return data, nil
}

// decodeImageDataURL 解码正文中内嵌的 base64 图片
func decodeImageDataURL(src string) ([]byte, error) {
	meta, payload, ok := strings.Cut(src, ",")
	if !ok || !strings.HasSuffix(strings.ToLower(meta), ";base64") {
		return nil, errors.New("unsupported data url")
	}
	if base64.StdEncoding.DecodedLen(len(payload)) > aiVisionMaxImageBytes+3 {
		return nil, errors.New("image too large")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payload))
	if err != nil {
		return nil, err
	}
	if len(data) > aiVisionMaxImageBytes {
		return nil, errors.New("image too large")
	}
	return data, nil
}

// VisionContentParts 用户消息的内容块：正文文本在前，每张图片前加一个 [图N] 标签。
func VisionContentParts(text string, images []VisionImage) any {
	return llmclient.VisionContentParts(text, images)
}

// AIVisionAvailable 已开启识图，且该模型最近没有拒收过图片；调用方据此决定要不要读取图片
func AIVisionAvailable(baseURL, model string) bool {
	return llmclient.VisionAvailable(baseURL, model)
}

// WithVisionFallbackNotice 在 ctx 上挂一个回调：本该附带的图片没有发出（模型拒收后按纯文本重试、或已知模型不支持）时调用
func WithVisionFallbackNotice(ctx context.Context, fn func(reason string)) context.Context {
	return llmclient.WithVisionFallbackNotice(ctx, fn)
}
