package agentrunner

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
)

// 带图片的消息编码为文本块 + [图N] 标签 + 图片块；不带图片的照旧是字符串
func TestChatMessageImages(t *testing.T) {
	plain, _ := json.Marshal(textMessage("user", "你好"))
	if string(plain) != `{"role":"user","content":"你好"}` {
		t.Fatalf("plain = %s", plain)
	}
	msg := textMessage("user", "正文 [图2]")
	msg.Images = []service.VisionImage{{Index: 2, DataURL: "data:image/png;base64,AAAA"}}
	data, _ := json.Marshal(msg)
	var decoded struct {
		Role    string           `json:"role"`
		Content []map[string]any `json:"content"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.Role != "user" || len(decoded.Content) != 3 {
		t.Fatalf("message = %s", data)
	}
	if decoded.Content[0]["text"] != "正文 [图2]" || decoded.Content[1]["text"] != "[图2]" || decoded.Content[2]["type"] != "image_url" {
		t.Fatalf("parts = %v", decoded.Content)
	}
}

// get_post 读到的图片：标上 [图N]、放进待附带列表；同一张图片不重复附带；未开启识图时原样返回；模型不支持时记一条步骤
func TestAttachPostImages(t *testing.T) {
	img := "data:image/png;base64," + base64.StdEncoding.EncodeToString(append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 16)...))
	out, _ := json.Marshal(map[string]any{"id": 5, "title": "t", "content": "文字 ![图](" + img + ") 结尾"})

	off := &execution{run: &dto.AgentLeaseRun{}, visionSeen: map[string]bool{}}
	if got := off.attachPostImages(context.Background(), map[string]any{"post": "5"}, string(out)); got != string(out) || len(off.pendingImages) != 0 {
		t.Fatalf("vision off: %s", got)
	}

	e := &execution{run: &dto.AgentLeaseRun{Vision: true}, visionSeen: map[string]bool{}, visionLeft: service.AIVisionMaxImages}
	got := e.attachPostImages(context.Background(), map[string]any{"post": "5"}, string(out))
	var detail struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(got), &detail); err != nil || !strings.Contains(detail.Content, ") [图1] 结尾") {
		t.Fatalf("annotated = %s", got)
	}
	if len(e.pendingImages) != 1 || e.pendingImages[0].postRef != "post:5" || len(e.pendingImages[0].images) != 1 || e.visionLeft != service.AIVisionMaxImages-1 {
		t.Fatalf("pending = %+v, left = %d", e.pendingImages, e.visionLeft)
	}
	e.pendingImages = nil
	e.attachPostImages(context.Background(), map[string]any{"post": "5"}, string(out))
	if len(e.pendingImages) != 0 {
		t.Fatal("same image attached twice")
	}

	unsupported := &execution{run: &dto.AgentLeaseRun{VisionUnsupported: true}, visionSeen: map[string]bool{}}
	unsupported.attachPostImages(context.Background(), map[string]any{"post": "5"}, string(out))
	if len(unsupported.pendingImages) != 0 || len(unsupported.trace) != 1 || unsupported.trace[0].Step != "vision" {
		t.Fatalf("trace = %+v", unsupported.trace)
	}
}
