package v1

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/snowykami/neo-blog/internal/service"
)

// TestSongLyricStream 歌词流按事件逐条写出并立即发送（不等整个响应结束），带关闭代理缓冲与禁止改写的响应头
func TestSongLyricStream(t *testing.T) {
	original := streamLyrics
	t.Cleanup(func() { streamLyrics = original })
	type call struct {
		id      int64
		refresh bool
	}
	calls := make(chan call, 1)
	streamLyrics = func(_ *service.MusicService, _ context.Context, id int64, refresh bool, send func(string, any) error) {
		calls <- call{id, refresh}
		_ = send("source", map[string]any{"kind": "ncm", "data": nil})
		time.Sleep(400 * time.Millisecond)
		_ = send("decided", map[string]string{"kind": "ncm", "source": "ncm-lrc"})
		_ = send("done", struct{}{})
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	h := server.New(server.WithHostPorts(addr), server.WithStreamBody(true), server.WithExitWaitTime(0))
	h.GET("/api/v1/music/song/:id/lyric/stream", Music.SongLyricStream)
	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 无效的歌曲 id 返回普通 JSON 错误
	resp, err := http.Get("http://" + addr + "/api/v1/music/song/0/lyric/stream")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid id: %d", resp.StatusCode)
	}

	start := time.Now()
	resp, err = http.Get("http://" + addr + "/api/v1/music/song/476513774/lyric/stream?refresh=1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	for header, want := range map[string]string{"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"} {
		if got := resp.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	reader := bufio.NewReader(resp.Body)
	readEvent := func() (string, time.Duration) {
		var lines []string
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatalf("read event: %v", err)
			}
			if line == "\n" {
				return strings.Join(lines, ""), time.Since(start)
			}
			lines = append(lines, line)
		}
	}
	first, at := readEvent()
	if first != "event: source\ndata: {\"data\":null,\"kind\":\"ncm\"}\n" || at > 300*time.Millisecond {
		t.Fatalf("first event %q arrived after %v", first, at)
	}
	if decided, at := readEvent(); !strings.HasPrefix(decided, "event: decided\n") || at < 350*time.Millisecond {
		t.Fatalf("decided event %q at %v", decided, at)
	}
	if done, _ := readEvent(); done != "event: done\ndata: {}\n" {
		t.Fatalf("done event %q", done)
	}
	if got := <-calls; got.id != 476513774 || !got.refresh {
		t.Fatalf("stream called with %+v", got)
	}
}
