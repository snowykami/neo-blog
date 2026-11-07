package apiv1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 编辑事件流：鉴权、连接后先推送 ready，申请会话、保存草稿时逐条推送；保存接口返回新的草稿版本号，过期的基线版本号被拒绝
func TestEditEventsRoute(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	other := &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(author)
	repo.GetDB().Create(other)
	isPrivate := true
	postID, svcerr := service.NewPostService().CreatePost(context.WithValue(context.Background(), "user_id", author.ID), &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "t", Content: "<p>v1</p>"},
		IsPrivate:   &isPrivate,
	})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	base := startRoutes(t, registerPostRoutes)
	postURL := fmt.Sprintf("%s/post/p/%d", base, postID)
	authorCookie := loginCookie(t, author)
	request := func(method, url, cookie, sessionID, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, url, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		if sessionID != "" {
			req.Header.Set("X-Edit-Session", sessionID)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	for name, c := range map[string]struct {
		cookie string
		status int
	}{
		"unauthenticated": {"", http.StatusUnauthorized},
		"not the author":  {loginCookie(t, other), http.StatusForbidden},
	} {
		resp := request(http.MethodGet, postURL+"/edit-events", c.cookie, "", "")
		_ = resp.Body.Close()
		if resp.StatusCode != c.status {
			t.Errorf("%s: status %d, want %d", name, resp.StatusCode, c.status)
		}
	}

	stream := request(http.MethodGet, postURL+"/edit-events", authorCookie, "", "")
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK || stream.Header.Get("Content-Type") != "text/event-stream; charset=utf-8" || stream.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("stream: %d %v", stream.StatusCode, stream.Header)
	}
	events := make(chan string, 16)
	go func() {
		reader := bufio.NewReader(stream.Body)
		var block strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				close(events)
				return
			}
			if line == "\n" {
				events <- block.String()
				block.Reset()
				continue
			}
			block.WriteString(line)
		}
	}()
	expect := func(name string) string {
		t.Helper()
		select {
		case block, ok := <-events:
			if !ok || !strings.HasPrefix(block, "event: "+name+"\n") {
				t.Fatalf("got %q (open %v), want event %s", block, ok, name)
			}
			return block
		case <-time.After(2 * time.Second):
			t.Fatalf("no %s event", name)
		}
		return ""
	}
	expect("ready")

	resp := request(http.MethodPost, postURL+"/edit-session", authorCookie, "", "")
	var acquired struct {
		Data dto.EditSessionDto `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&acquired)
	_ = resp.Body.Close()
	if acquired.Data.SessionID == "" {
		t.Fatalf("acquire: %+v", acquired.Data)
	}
	expect(service.EditEventSession)

	resp = request(http.MethodPut, postURL, authorCookie, acquired.Data.SessionID, `{"draft_content":"<p>v2</p>","base_draft_version":0}`)
	var saved struct {
		Data dto.ContentSaveResult `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&saved)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || saved.Data.ID != postID || saved.Data.DraftVersion != 1 {
		t.Fatalf("save draft: %d %+v", resp.StatusCode, saved.Data)
	}
	if block := expect(service.EditEventSaved); !strings.Contains(block, `"draft_version":1`) {
		t.Fatalf("saved event should carry the draft version: %q", block)
	}

	// 基于过期版本的保存被拒绝，草稿不变
	resp = request(http.MethodPut, postURL, authorCookie, acquired.Data.SessionID, `{"draft_content":"<p>stale</p>","base_draft_version":0}`)
	var conflict struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&conflict)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict || conflict.Message != "draft_conflict" {
		t.Fatalf("stale save: %d %q", resp.StatusCode, conflict.Message)
	}
	if post, _ := repo.Post.GetPostByID(postID); post.DraftContent == nil || *post.DraftContent != "<p>v2</p>" {
		t.Fatalf("stale save must not write: %+v", post.DraftContent)
	}
}
