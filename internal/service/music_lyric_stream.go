package service

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

const (
	lyricStreamSubBuffer      = 512
	lyricStreamResyncInterval = 500 * time.Millisecond
	lyricStreamDoneGraceTTL   = 2 * time.Minute
	lyricStreamErrorGraceTTL  = 30 * time.Second
)

// lyricStreamErrorPayload SSE error 事件载荷
type lyricStreamErrorPayload struct {
	Message string `json:"message"`
}

// lyricStreamSnapshot 存入 sharedstate 的流式进度快照，供中途加入或断线重连客户端回放历史行
type lyricStreamSnapshot[T any, M any] struct {
	Seq    int    `json:"seq"`
	Status string `json:"status"` // "running" | "done" | "error"
	Lines  []T    `json:"lines,omitempty"`
	Meta   *M     `json:"meta,omitempty"`
	Error  string `json:"error,omitempty"`
}

type lyricAIStreamEvent[T any, M any] struct {
	Key   string `json:"key"`
	Type  string `json:"type"` // "line" | "done" | "error" | "resync"
	Seq   int    `json:"seq,omitempty"`
	Line  *T     `json:"line,omitempty"`
	Meta  *M     `json:"meta,omitempty"`
	Error string `json:"error,omitempty"`
}

type lyricStreamSub[T any, M any] struct {
	Events <-chan lyricAIStreamEvent[T, M]
	Done   <-chan struct{}
	Close  func()
}

// lyricStreamHub 管理同曲同任务在单实例内的 SSE 订阅分发，并通过 sharedstate 实现跨副本同步与快照回放
type lyricStreamHub[T any, M any] struct {
	prefix     string
	channel    string
	mu         sync.Mutex
	subs       map[string]map[chan lyricAIStreamEvent[T, M]]struct{}
	shutdown   chan struct{}
	listenOnce sync.Once
}

func newLyricStreamHub[T any, M any](prefix string) *lyricStreamHub[T, M] {
	return &lyricStreamHub[T, M]{
		prefix:   prefix,
		channel:  prefix + ":stream_events",
		subs:     map[string]map[chan lyricAIStreamEvent[T, M]]struct{}{},
		shutdown: make(chan struct{}),
	}
}

func (h *lyricStreamHub[T, M]) snapshotKey(key string) string {
	return h.prefix + ":partial:" + key
}

func (h *lyricStreamHub[T, M]) subscribe(key string) *lyricStreamSub[T, M] {
	h.listenOnce.Do(func() {
		sharedstate.OnNotify(h.channel, h.onNotify)
	})
	ch := make(chan lyricAIStreamEvent[T, M], lyricStreamSubBuffer)
	h.mu.Lock()
	if h.subs[key] == nil {
		h.subs[key] = map[chan lyricAIStreamEvent[T, M]]struct{}{}
	}
	h.subs[key][ch] = struct{}{}
	h.mu.Unlock()
	var once sync.Once
	return &lyricStreamSub[T, M]{
		Events: ch,
		Done:   h.shutdown,
		Close: func() {
			once.Do(func() {
				h.mu.Lock()
				delete(h.subs[key], ch)
				if len(h.subs[key]) == 0 {
					delete(h.subs, key)
				}
				h.mu.Unlock()
			})
		},
	}
}

func (h *lyricStreamHub[T, M]) dispatch(ev lyricAIStreamEvent[T, M]) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[ev.Key] {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (h *lyricStreamHub[T, M]) publish(ev lyricAIStreamEvent[T, M]) {
	h.dispatch(ev)
	if payload, err := json.Marshal(ev); err == nil {
		sharedstate.Notify(h.channel, string(payload))
	}
}

func (h *lyricStreamHub[T, M]) onNotify(message string) {
	if message == "" {
		h.mu.Lock()
		defer h.mu.Unlock()
		for key, subs := range h.subs {
			for ch := range subs {
				select {
				case ch <- lyricAIStreamEvent[T, M]{Key: key, Type: "resync"}:
				default:
				}
			}
		}
		return
	}
	var ev lyricAIStreamEvent[T, M]
	if err := json.Unmarshal([]byte(message), &ev); err != nil {
		logrus.Warnf("invalid lyric stream event %q: %v", message, err)
		return
	}
	h.dispatch(ev)
}

func (h *lyricStreamHub[T, M]) loadSnapshot(key string) *lyricStreamSnapshot[T, M] {
	if key == "" {
		return nil
	}
	var snap lyricStreamSnapshot[T, M]
	found, err := sharedstate.GetJSON(h.snapshotKey(key), &snap)
	if err != nil || !found {
		return nil
	}
	return &snap
}

func (h *lyricStreamHub[T, M]) saveSnapshot(key string, snap *lyricStreamSnapshot[T, M], ttl time.Duration) {
	if key == "" || snap == nil {
		return
	}
	if err := sharedstate.SetJSON(h.snapshotKey(key), snap, ttl); err != nil {
		logrus.Warnf("save lyric stream snapshot %s: %v", key, err)
	}
}

// initSnapshot 初始化进行中快照（通常在持锁启动生产者前写入，防止消费者先读到旧快照或空态）
func (h *lyricStreamHub[T, M]) initSnapshot(key string, initial []T, ttl time.Duration) *lyricStreamWriter[T, M] {
	copied := make([]T, len(initial))
	copy(copied, initial)
	snap := &lyricStreamSnapshot[T, M]{
		Seq:    len(copied),
		Status: "running",
		Lines:  copied,
	}
	h.saveSnapshot(key, snap, ttl)
	return &lyricStreamWriter[T, M]{
		hub:  h,
		key:  key,
		ttl:  ttl,
		snap: snap,
	}
}

// lyricStreamWriter 仅由单生产者持有，顺序写入进度快照并广播增量行事件
type lyricStreamWriter[T any, M any] struct {
	hub      *lyricStreamHub[T, M]
	key      string
	ttl      time.Duration
	snap     *lyricStreamSnapshot[T, M]
	finished bool
}

func (w *lyricStreamWriter[T, M]) EmitLine(line T) {
	w.snap.Seq++
	w.snap.Lines = append(w.snap.Lines, line)
	w.hub.saveSnapshot(w.key, w.snap, w.ttl)
	lineCopy := line
	w.hub.publish(lyricAIStreamEvent[T, M]{
		Key:  w.key,
		Type: "line",
		Seq:  w.snap.Seq,
		Line: &lineCopy,
	})
}

func (w *lyricStreamWriter[T, M]) Finish(meta M) {
	if w.finished {
		return
	}
	w.finished = true
	w.snap.Status = "done"
	w.snap.Meta = &meta
	w.hub.saveSnapshot(w.key, w.snap, lyricStreamDoneGraceTTL)
	metaCopy := meta
	w.hub.publish(lyricAIStreamEvent[T, M]{
		Key:  w.key,
		Type: "done",
		Seq:  w.snap.Seq,
		Meta: &metaCopy,
	})
}

func (w *lyricStreamWriter[T, M]) Fail(msg string) {
	if w.finished {
		return
	}
	w.finished = true
	w.snap.Status = "error"
	w.snap.Error = msg
	w.hub.saveSnapshot(w.key, w.snap, lyricStreamErrorGraceTTL)
	w.hub.publish(lyricAIStreamEvent[T, M]{
		Key:   w.key,
		Type:  "error",
		Seq:   w.snap.Seq,
		Error: msg,
	})
}

// consumeLyricStream 对单个消费者执行「历史回放 -> 实时广播 -> 落库收尾」无竞态消费循环。
// 调用方必须先调用 h.subscribe(key) 并确保生产者已启动，再调用本方法。
func consumeLyricStream[T any, M any](
	ctx context.Context,
	h *lyricStreamHub[T, M],
	key string,
	sub *lyricStreamSub[T, M],
	send func(event string, data any) error,
	checkFallback func() (lines []T, meta *M, done bool, failMsg string),
) {
	lastSeq := 0
	emitTailFrom := func(lines []T) bool {
		for ; lastSeq < len(lines); lastSeq++ {
			if err := send("line", lines[lastSeq]); err != nil {
				return false
			}
		}
		return true
	}

	if snap := h.loadSnapshot(key); snap != nil {
		if len(snap.Lines) > 0 {
			if err := send("replay", snap.Lines); err != nil {
				return
			}
			lastSeq = len(snap.Lines)
		}
		if snap.Status == "done" && snap.Meta != nil {
			_ = send("done", *snap.Meta)
			return
		}
		if snap.Status == "error" {
			_ = send("error", lyricStreamErrorPayload{Message: snap.Error})
			return
		}
	}

	syncSnapshot := func() (finished bool) {
		if snap := h.loadSnapshot(key); snap != nil {
			if !emitTailFrom(snap.Lines) {
				return true
			}
			if snap.Status == "done" && snap.Meta != nil {
				_ = send("done", *snap.Meta)
				return true
			}
			if snap.Status == "error" {
				_ = send("error", lyricStreamErrorPayload{Message: snap.Error})
				return true
			}
		}
		if checkFallback != nil {
			lines, meta, done, failMsg := checkFallback()
			if done && meta != nil {
				if !emitTailFrom(lines) {
					return true
				}
				_ = send("done", *meta)
				return true
			}
			if failMsg != "" {
				_ = send("error", lyricStreamErrorPayload{Message: failMsg})
				return true
			}
		}
		return false
	}

	ticker := time.NewTicker(lyricStreamResyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.Done:
			return
		case <-ticker.C:
			if syncSnapshot() {
				return
			}
		case ev := <-sub.Events:
			switch ev.Type {
			case "line":
				if ev.Seq <= lastSeq {
					continue
				}
				if ev.Seq == lastSeq+1 && ev.Line != nil {
					lastSeq = ev.Seq
					if err := send("line", *ev.Line); err != nil {
						return
					}
					continue
				}
				// 出现乱序或跨实例消息丢包时，从 sharedstate 快照补齐差量行
				if snap := h.loadSnapshot(key); snap != nil {
					if !emitTailFrom(snap.Lines) {
						return
					}
				} else if ev.Line != nil {
					lastSeq = ev.Seq
					if err := send("line", *ev.Line); err != nil {
						return
					}
				}
			case "resync":
				if syncSnapshot() {
					return
				}
			case "done":
				if snap := h.loadSnapshot(key); snap != nil {
					if !emitTailFrom(snap.Lines) {
						return
					}
				}
				if ev.Meta != nil {
					_ = send("done", *ev.Meta)
				}
				return
			case "error":
				msg := ev.Error
				if msg == "" {
					msg = "generation_failed"
				}
				_ = send("error", lyricStreamErrorPayload{Message: msg})
				return
			}
		}
	}
}

// ndjsonLineScanner 增量扫描流式响应中的每个顶层 JSON 对象（O(N) 括号深度状态机）。
// 自动跳过 Markdown 代码围栏、行号前缀与空白分隔，兼容紧凑 NDJSON 与多行格式化单对象。
type ndjsonLineScanner struct {
	buf     strings.Builder
	inObj   bool
	depth   int
	inStr   bool
	escaped bool
}

func (s *ndjsonLineScanner) Feed(chunk string, onObj func(objJSON string)) {
	for i := 0; i < len(chunk); i++ {
		b := chunk[i]
		if !s.inObj {
			if b == '{' {
				s.inObj = true
				s.depth = 1
				s.inStr = false
				s.escaped = false
				s.buf.Reset()
				s.buf.WriteByte(b)
			}
			continue
		}
		s.buf.WriteByte(b)
		if s.escaped {
			s.escaped = false
			continue
		}
		if s.inStr {
			if b == '\\' {
				s.escaped = true
			} else if b == '"' {
				s.inStr = false
			}
			continue
		}
		switch b {
		case '"':
			s.inStr = true
		case '{':
			s.depth++
		case '}':
			s.depth--
			if s.depth == 0 {
				obj := s.buf.String()
				s.buf.Reset()
				s.inObj = false
				onObj(obj)
			}
		}
	}
}

func (s *ndjsonLineScanner) Reset() {
	s.buf.Reset()
	s.inObj = false
	s.depth = 0
	s.inStr = false
	s.escaped = false
}
