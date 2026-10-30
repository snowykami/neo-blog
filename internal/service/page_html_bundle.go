package service

import (
	"archive/zip"
	"io"
	"path"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 静态文件包内的路径长度与层级上限
const (
	maxPageHTMLPathLen   = 512
	maxPageHTMLPathDepth = 32
)

// pageHTMLContentTypes 允许上传的扩展名与响应类型：类型只由扩展名决定，不信任文件内容与上传时的类型
var pageHTMLContentTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".htm":  "text/html; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".mjs":  "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map":  "application/json; charset=utf-8",
	".txt":  "text/plain; charset=utf-8",
	".wasm": "application/wasm",
	// 图片
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".bmp":  "image/bmp",
	// 字体
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	// 音视频
	".mp3":  "audio/mpeg",
	".ogg":  "audio/ogg",
	".oga":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".flac": "audio/flac",
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".ogv":  "video/ogg",
}

// PageHTMLContentType 按扩展名得到响应类型，不在白名单内时返回空字符串
func PageHTMLContentType(filePath string) string {
	return pageHTMLContentTypes[strings.ToLower(path.Ext(filePath))]
}

func isPageHTMLDocument(filePath string) bool {
	ext := strings.ToLower(path.Ext(filePath))
	return ext == ".html" || ext == ".htm"
}

// PageHTMLBundleError 静态文件包校验失败；Code 为错误码，Path 为出错的文件（可能为空）
type PageHTMLBundleError struct {
	Code string
	Path string
}

func (e *PageHTMLBundleError) Error() string {
	if e.Path == "" {
		return e.Code
	}
	return e.Code + ": " + e.Path
}

func bundleError(code, filePath string) *PageHTMLBundleError {
	return &PageHTMLBundleError{Code: code, Path: filePath}
}

// pageHTMLLimits 上传的硬性上限
type pageHTMLLimits struct {
	MaxTotalSize int64
	MaxFiles     int
	MaxFileSize  int64
}

func pageHTMLLimitsFromEnv() pageHTMLLimits {
	return pageHTMLLimits{
		MaxTotalSize: int64(utils.Env.GetAsInt(constant.EnvKeyPageHTMLMaxTotalSize, constant.DefaultPageHTMLMaxTotalSize)),
		MaxFiles:     utils.Env.GetAsInt(constant.EnvKeyPageHTMLMaxFiles, constant.DefaultPageHTMLMaxFiles),
		MaxFileSize:  int64(utils.Env.GetAsInt(constant.EnvKeyPageHTMLMaxFileSize, constant.DefaultPageHTMLMaxFileSize)),
	}
}

// bundleFile 校验通过、待写入存储的文件
type bundleFile struct {
	Path string
	Size int64
	open func() (io.ReadCloser, error)
}

type htmlBundle struct {
	Files []bundleFile // 按路径排序
	Entry string       // 默认入口文件
}

// parseHTMLBundle 解析上传的单个 .html 文件或 .zip 包，只做校验不写入存储：
// 拒绝路径穿越、绝对路径、符号链接等特殊条目与白名单外的扩展名，并检查大小与数量上限
func parseHTMLBundle(name string, src io.ReaderAt, size int64, limits pageHTMLLimits) (*htmlBundle, *PageHTMLBundleError) {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".htm":
		// 单个 HTML 文件统一保存为 index.html
		if size > limits.MaxFileSize || size > limits.MaxTotalSize {
			return nil, bundleError("page_html_file_too_large", name)
		}
		return &htmlBundle{
			Files: []bundleFile{{
				Path: "index.html",
				Size: size,
				open: func() (io.ReadCloser, error) { return io.NopCloser(io.NewSectionReader(src, 0, size)), nil },
			}},
			Entry: "index.html",
		}, nil
	case ".zip":
		return parseHTMLZip(src, size, limits)
	default:
		return nil, bundleError("page_html_unsupported_upload", name)
	}
}

func parseHTMLZip(src io.ReaderAt, size int64, limits pageHTMLLimits) (*htmlBundle, *PageHTMLBundleError) {
	zr, err := zip.NewReader(src, size)
	if err != nil {
		return nil, bundleError("page_html_invalid_zip", "")
	}
	var (
		files     []bundleFile
		totalSize int64
		// 按小写路径检查重名与「文件 / 目录」冲突，避免在大小写不敏感的存储上互相覆盖
		filePaths = map[string]bool{}
		dirPaths  = map[string]bool{}
	)
	for _, f := range zr.File {
		mode := f.Mode()
		isDir := mode.IsDir() || strings.HasSuffix(f.Name, "/")
		filePath, ok := normalizeBundlePath(strings.TrimSuffix(f.Name, "/"))
		if !ok {
			return nil, bundleError("page_html_invalid_path", f.Name)
		}
		if isDir || isBundleJunk(filePath) {
			continue
		}
		// 符号链接、设备文件等非普通文件一律拒绝
		if !mode.IsRegular() {
			return nil, bundleError("page_html_unsupported_entry", filePath)
		}
		if f.Flags&0x1 != 0 {
			return nil, bundleError("page_html_encrypted_zip", filePath)
		}
		if PageHTMLContentType(filePath) == "" {
			return nil, bundleError("page_html_file_type_not_allowed", filePath)
		}
		// 声明的大小先做一次检查；实际解压时 archive/zip 会校验读出的字节数与声明一致
		if f.UncompressedSize64 > uint64(limits.MaxFileSize) {
			return nil, bundleError("page_html_file_too_large", filePath)
		}
		totalSize += int64(f.UncompressedSize64)
		if totalSize > limits.MaxTotalSize {
			return nil, bundleError("page_html_bundle_too_large", "")
		}
		if len(files)+1 > limits.MaxFiles {
			return nil, bundleError("page_html_too_many_files", "")
		}
		lower := strings.ToLower(filePath)
		if filePaths[lower] || dirPaths[lower] {
			return nil, bundleError("page_html_duplicate_file", filePath)
		}
		for dir := path.Dir(lower); dir != "."; dir = path.Dir(dir) {
			if filePaths[dir] {
				return nil, bundleError("page_html_duplicate_file", filePath)
			}
			dirPaths[dir] = true
		}
		filePaths[lower] = true
		files = append(files, bundleFile{Path: filePath, Size: int64(f.UncompressedSize64), open: f.Open})
	}
	if len(files) == 0 {
		return nil, bundleError("page_html_empty_bundle", "")
	}
	stripCommonRoot(files)
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	entry := defaultBundleEntry(files)
	if entry == "" {
		return nil, bundleError("page_html_entry_missing", "")
	}
	return &htmlBundle{Files: files, Entry: entry}, nil
}

// normalizeBundlePath 校验包内路径：必须是不含 . / .. / 空段的相对路径，且为合法 UTF-8、不含反斜杠、冒号与控制字符
// 不做“清理后放行”，任何不规范的路径都直接拒绝
func normalizeBundlePath(name string) (string, bool) {
	if name == "" || len(name) > maxPageHTMLPathLen || !utf8.ValidString(name) {
		return "", false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f || r == '\\' || r == ':' {
			return "", false
		}
	}
	segments := strings.Split(name, "/")
	if len(segments) > maxPageHTMLPathDepth {
		return "", false
	}
	for _, seg := range segments {
		if seg == "" || seg == "." || seg == ".." {
			return "", false
		}
	}
	return name, true
}

// isBundleJunk 系统压缩时附带的元数据文件（macOS 的 __MACOSX、.DS_Store，Windows 的 Thumbs.db 等），直接跳过
func isBundleJunk(filePath string) bool {
	if strings.HasPrefix(filePath, "__MACOSX/") {
		return true
	}
	base := path.Base(filePath)
	return base == ".DS_Store" || base == "Thumbs.db" || base == "desktop.ini" || strings.HasPrefix(base, "._")
}

// stripCommonRoot 压缩整个文件夹时所有文件都在同一个顶层目录下，去掉这一层，让入口位于根目录
func stripCommonRoot(files []bundleFile) {
	root, _, found := strings.Cut(files[0].Path, "/")
	if !found {
		return
	}
	prefix := root + "/"
	for _, f := range files {
		if !strings.HasPrefix(f.Path, prefix) {
			return
		}
	}
	for i := range files {
		files[i].Path = strings.TrimPrefix(files[i].Path, prefix)
	}
}

// defaultBundleEntry 默认入口：根目录的 index.html / index.htm，否则取层级最浅的第一个 HTML 文件（files 已按路径排序）
func defaultBundleEntry(files []bundleFile) string {
	for _, index := range []string{"index.html", "index.htm"} {
		if slices.ContainsFunc(files, func(f bundleFile) bool { return f.Path == index }) {
			return index
		}
	}
	entry, depth := "", 0
	for _, f := range files {
		if !isPageHTMLDocument(f.Path) {
			continue
		}
		if d := strings.Count(f.Path, "/"); entry == "" || d < depth {
			entry, depth = f.Path, d
		}
	}
	return entry
}
