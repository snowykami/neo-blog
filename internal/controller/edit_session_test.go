package v1

import (
	"context"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 编辑事件流定时发送心跳注释，到最长时长后结束（客户端随后重连并重新鉴权）
func TestEditEventsHeartbeatAndMaxDuration(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(author)
	ctx := context.WithValue(context.Background(), "user_id", author.ID)
	pageID, svcerr := service.NewPageService().CreatePage(ctx, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	originalHeartbeat, originalMax := editEventHeartbeat, editEventMaxDuration
	editEventHeartbeat, editEventMaxDuration = 100*time.Millisecond, 350*time.Millisecond
	t.Cleanup(func() { editEventHeartbeat, editEventMaxDuration = originalHeartbeat, originalMax })

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	h := server.New(server.WithHostPorts(addr), server.WithStreamBody(true), server.WithExitWaitTime(0))
	events := EditSession.Events(constant.TargetTypePage)
	// 测试中跳过鉴权中间件，直接以作者身份访问
	h.GET("/api/v1/page/p/:id/edit-events", func(c context.Context, rc *app.RequestContext) {
		events(context.WithValue(c, "user_id", author.ID), rc)
	})
	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	start := time.Now()
	resp, err := http.Get("http://" + addr + "/api/v1/page/p/" + strconv.FormatUint(uint64(pageID), 10) + "/edit-events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	elapsed := time.Since(start)
	text := string(body)
	if !strings.HasPrefix(text, "event: ready\n") || strings.Count(text, ": ping\n\n") < 2 {
		t.Fatalf("stream = %q", text)
	}
	if elapsed < 300*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("stream ended after %v, want about the max duration", elapsed)
	}
}
