package service

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 编辑事件：文章 / 页面保存或编辑会话变化时，通知打开了该内容编辑页的客户端（SSE）
// - 编辑页据此拉取最新草稿，把他人（外部 AI 工具）的修改合并进来；被其他设备接管而只读的编辑页据此实时同步
// - 持有会话的编辑页据此尽快发现被接管
// 事件不携带正文，只带保存后的草稿版本号，客户端比较版本后自行拉取，重复或合并的事件不影响结果
// 订阅者是本实例上的 SSE 连接；其他实例的保存经 sharedstate 广播后，由各实例分发给自己的订阅者
const (
	EditEventSaved   = "saved"   // 正文或元信息已保存
	EditEventSession = "session" // 编辑会话变化（申请、接管或释放）
	EditEventResync  = "resync"  // 可能错过了事件（与 Redis 的连接中断后恢复），客户端应重新拉取

	editEventChannel = "edit_events"
	editEventBuffer  = 16 // 每个订阅者缓冲的事件数，写满时丢弃（客户端会重新拉取最新状态，丢弃不影响结果）
)

// EditEvent 编辑事件
type EditEvent struct {
	Type       string `json:"type"`
	TargetType string `json:"target_type"`
	TargetID   uint   `json:"target_id"`
	// 保存事件：保存后的草稿版本号（只改元信息时为当前版本），以及外部 AI 工具写入时的 Token 名称
	DraftVersion uint64 `json:"draft_version,omitempty"`
	APITokenName string `json:"api_token_name,omitempty"`
}

// EditEventSubscription 一个编辑页的事件订阅，用完必须 Close
type EditEventSubscription struct {
	Events <-chan EditEvent
	// 实例关停时关闭，SSE 连接随即结束，客户端重连到其他实例
	Done  <-chan struct{}
	Close func()
}

type editEventHub struct {
	mu         sync.Mutex
	subs       map[string]map[chan EditEvent]struct{}
	shutdown   chan struct{}
	closeOnce  sync.Once
	listenOnce sync.Once
}

var editEvents = newEditEventHub()

func newEditEventHub() *editEventHub {
	return &editEventHub{subs: map[string]map[chan EditEvent]struct{}{}, shutdown: make(chan struct{})}
}

func editEventKey(targetType string, targetID uint) string {
	return targetType + ":" + strconv.FormatUint(uint64(targetID), 10)
}

func (h *editEventHub) subscribe(targetType string, targetID uint) *EditEventSubscription {
	// 首次订阅时才监听其他实例的广播：没有订阅者时收到也无处分发
	h.listenOnce.Do(func() {
		sharedstate.OnNotify(editEventChannel, h.onNotify)
	})
	ch := make(chan EditEvent, editEventBuffer)
	key := editEventKey(targetType, targetID)
	h.mu.Lock()
	if h.subs[key] == nil {
		h.subs[key] = map[chan EditEvent]struct{}{}
	}
	h.subs[key][ch] = struct{}{}
	h.mu.Unlock()
	var once sync.Once
	return &EditEventSubscription{
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

// dispatch 分发给本实例上该目标的订阅者，不阻塞发布方
func (h *editEventHub) dispatch(event EditEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[editEventKey(event.TargetType, event.TargetID)] {
		select {
		case ch <- event:
		default:
		}
	}
}

// onNotify 其他实例的广播；空消息表示与 Redis 的连接恢复，期间可能错过了事件，通知本实例全部订阅者重新拉取
func (h *editEventHub) onNotify(message string) {
	if message == "" {
		h.mu.Lock()
		defer h.mu.Unlock()
		for _, subs := range h.subs {
			for ch := range subs {
				select {
				case ch <- EditEvent{Type: EditEventResync}:
				default:
				}
			}
		}
		return
	}
	var event EditEvent
	if err := json.Unmarshal([]byte(message), &event); err != nil {
		logrus.Warnf("invalid edit event %q: %v", message, err)
		return
	}
	h.dispatch(event)
}

// close 结束全部订阅（实例关停）
func (h *editEventHub) close() {
	h.closeOnce.Do(func() { close(h.shutdown) })
}

// PublishEditEvent 发布编辑事件：本实例直接分发，其他实例经 sharedstate 广播
func PublishEditEvent(event EditEvent) {
	editEvents.dispatch(event)
	payload, _ := json.Marshal(event)
	sharedstate.Notify(editEventChannel, string(payload))
}

// publishSavedEvent 保存文章 / 页面后发布保存事件，外部 AI 工具的写入带上 Token 名称，编辑页据此提示是谁改的
func publishSavedEvent(ctx context.Context, targetType string, targetID uint, draftVersion uint64) {
	event := EditEvent{Type: EditEventSaved, TargetType: targetType, TargetID: targetID, DraftVersion: draftVersion}
	if token, ok := ctxutils.GetAPIToken(ctx); ok {
		event.APITokenName = token.Name
	}
	PublishEditEvent(event)
}

// CloseEditEventStreams 实例关停时结束本实例上的全部事件流，客户端随后重连到其他实例
func CloseEditEventStreams() {
	editEvents.close()
}

// SubscribeEvents 订阅文章 / 页面的编辑事件，只有作者或管理员可以订阅
func (s *EditSessionService) SubscribeEvents(ctx context.Context, targetType string, targetID uint) (*EditEventSubscription, *errs.ServiceError) {
	if svcerr := s.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	return editEvents.subscribe(targetType, targetID), nil
}
