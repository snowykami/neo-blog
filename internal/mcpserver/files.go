package mcpserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

const maxImageSize = 10 << 20 // 单张图片上限，与普通用户的上传上限一致

// 只接受按内容识别出的位图格式；SVG 可内嵌脚本，不允许上传
var allowedImageTypes = []string{"image/png", "image/jpeg", "image/gif", "image/webp"}

type uploadImageInput struct {
	Filename   string `json:"filename" jsonschema:"file name with extension, e.g. diagram.png"`
	DataBase64 string `json:"data_base64" jsonschema:"image bytes encoded as standard base64 (a data: URL prefix is also accepted). PNG, JPEG, GIF or WebP, at most 10 MiB"`
}

type uploadImageOutput struct {
	ID       uint   `json:"id"`
	URL      string `json:"url"`
	Markdown string `json:"markdown" jsonschema:"ready-to-insert Markdown image syntax"`
}

// decodeImage 解码 base64 并按内容识别图片类型（不信任文件名）
func decodeImage(data string) ([]byte, string, error) {
	if i := strings.Index(data, ","); strings.HasPrefix(data, "data:") && i > 0 {
		data = data[i+1:]
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(data))
	if err != nil {
		return nil, "", errors.New("data_base64 is not valid base64")
	}
	if len(raw) == 0 {
		return nil, "", errors.New("image is empty")
	}
	if len(raw) > maxImageSize {
		return nil, "", fmt.Errorf("image is larger than %d MiB", maxImageSize>>20)
	}
	mimeType := http.DetectContentType(raw)
	if !slices.Contains(allowedImageTypes, mimeType) {
		return nil, "", fmt.Errorf("unsupported image type %q; only PNG, JPEG, GIF and WebP are allowed", mimeType)
	}
	return raw, mimeType, nil
}

func uploadImage(ctx context.Context, _ *mcp.CallToolRequest, in uploadImageInput) (*mcp.CallToolResult, *uploadImageOutput, error) {
	if err := requireScope(ctx, constant.ScopeFilesWrite); err != nil {
		return nil, nil, err
	}
	name := filepath.Base(strings.TrimSpace(in.Filename))
	if name == "" || name == "." || name == "/" {
		return nil, nil, errors.New("filename is required")
	}
	raw, mimeType, err := decodeImage(in.DataBase64)
	if err != nil {
		return nil, nil, err
	}
	saved, svcerr := service.NewFileService().SaveFile(ctx, &service.SaveFileInput{
		Name:     name,
		Size:     int64(len(raw)),
		MimeType: mimeType,
		Src:      bytes.NewReader(raw),
	})
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	alt := strings.TrimSuffix(name, filepath.Ext(name))
	return nil, &uploadImageOutput{ID: saved.ID, URL: saved.URL, Markdown: fmt.Sprintf("![%s](%s)", alt, saved.URL)}, nil
}

func registerFileTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "upload_image",
		Description: "Upload an image (PNG, JPEG, GIF or WebP, at most 10 MiB) and get its URL for use in post content or as a cover. Requires files:write.",
		Annotations: &mcp.ToolAnnotations{Title: "Upload image", DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(false)},
	}, uploadImage)
}
