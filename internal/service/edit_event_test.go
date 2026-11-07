package service

import (
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func expectEditEvent(t *testing.T, sub *EditEventSubscription, want string) EditEvent {
	t.Helper()
	select {
	case ev := <-sub.Events:
		if ev.Type != want {
			t.Fatalf("event = %+v, want %s", ev, want)
		}
		return ev
	case <-time.After(time.Second):
		t.Fatalf("no %s event", want)
	}
	return EditEvent{}
}

func expectNoEditEvent(t *testing.T, sub *EditEventSubscription) {
	t.Helper()
	select {
	case ev := <-sub.Events:
		t.Fatalf("unexpected event %+v", ev)
	case <-time.After(50 * time.Millisecond):
	}
}

// 订阅权限、保存与会话变化的事件（带草稿版本号与 Token 名称），以及其他实例广播的分发
func TestEditEvents(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	svc := NewEditSessionService()

	// 无关的编辑者不能订阅
	if _, svcerr := svc.SubscribeEvents(other, constant.TargetTypePost, post.ID); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("other editor should be forbidden, got %v", svcerr)
	}
	sub, svcerr := svc.SubscribeEvents(author, constant.TargetTypePost, post.ID)
	if svcerr != nil {
		t.Fatalf("author subscribe: %v", svcerr)
	}
	defer sub.Close()
	adminSub, svcerr := svc.SubscribeEvents(admin, constant.TargetTypePost, post.ID)
	if svcerr != nil {
		t.Fatalf("admin subscribe: %v", svcerr)
	}

	// 开启会话与保存都会通知全部订阅者；保存事件带保存后的草稿版本号
	session, svcerr := svc.Acquire(author, constant.TargetTypePost, post.ID, "ua")
	if svcerr != nil {
		t.Fatalf("acquire: %v", svcerr)
	}
	expectEditEvent(t, sub, EditEventSession)
	expectEditEvent(t, adminSub, EditEventSession)
	if svcerr := saveDraft(author, post.ID, "<p>e1</p>", session.SessionID); svcerr != nil {
		t.Fatalf("save draft: %v", svcerr)
	}
	saved := expectEditEvent(t, sub, EditEventSaved)
	if saved.DraftVersion != reloadPost(t, post.ID).DraftVersion || saved.APITokenName != "" {
		t.Fatalf("saved event: %+v", saved)
	}
	expectEditEvent(t, adminSub, EditEventSaved)

	// 外部 AI 工具的保存带上 Token 名称
	authorUser := &model.User{}
	repo.GetDB().First(authorUser, post.UserID)
	agent := apiTokenCtx(t, createToken(t, authorUser, constant.ScopePostsWrite).Token)
	if svcerr := saveDraft(agent, post.ID, "<p>e2</p>", ""); svcerr != nil {
		t.Fatalf("agent save: %v", svcerr)
	}
	if ev := expectEditEvent(t, sub, EditEventSaved); ev.APITokenName != "claude" || ev.DraftVersion != saved.DraftVersion+1 {
		t.Fatalf("agent saved event: %+v", ev)
	}
	expectEditEvent(t, adminSub, EditEventSaved)

	// 取消订阅后不再收到；其他目标的事件不会送达
	adminSub.Close()
	adminSub.Close()
	PublishEditEvent(EditEvent{Type: EditEventSaved, TargetType: constant.TargetTypePost, TargetID: post.ID + 1})
	PublishEditEvent(EditEvent{Type: EditEventSaved, TargetType: constant.TargetTypePage, TargetID: post.ID})
	expectNoEditEvent(t, sub)
	PublishEditEvent(EditEvent{Type: EditEventSaved, TargetType: constant.TargetTypePost, TargetID: post.ID})
	expectEditEvent(t, sub, EditEventSaved)
	expectNoEditEvent(t, adminSub)

	// 其他实例的广播分发给本实例的订阅者；空消息（连接恢复）通知全部订阅者重新拉取
	editEvents.onNotify(`{"type":"saved","target_type":"post","target_id":` + strconv.FormatUint(uint64(post.ID), 10) + `,"draft_version":9}`)
	if ev := expectEditEvent(t, sub, EditEventSaved); ev.DraftVersion != 9 {
		t.Fatalf("broadcast event: %+v", ev)
	}
	editEvents.onNotify("not json")
	expectNoEditEvent(t, sub)
	editEvents.onNotify("")
	expectEditEvent(t, sub, EditEventResync)
}

// 订阅者处理不及时时丢弃多余的事件，不阻塞发布方；关停时结束全部订阅
func TestEditEventHubOverflowAndClose(t *testing.T) {
	hub := newEditEventHub()
	hub.listenOnce.Do(func() {}) // 不注册广播监听
	sub := hub.subscribe(constant.TargetTypePage, 1)
	defer sub.Close()
	done := make(chan struct{})
	go func() {
		for range editEventBuffer * 3 {
			hub.dispatch(EditEvent{Type: EditEventSaved, TargetType: constant.TargetTypePage, TargetID: 1})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("dispatch blocked on a slow subscriber")
	}
	if len(sub.Events) != editEventBuffer {
		t.Fatalf("buffered %d events, want %d", len(sub.Events), editEventBuffer)
	}
	hub.close()
	hub.close()
	select {
	case <-sub.Done:
	default:
		t.Fatal("subscription should end after close")
	}
}
