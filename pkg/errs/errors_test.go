package errs

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestFromDB(t *testing.T) {
	notFound := FromDB(fmt.Errorf("query: %w", gorm.ErrRecordNotFound), "label", "failed_to_get_target")
	if notFound.Code != http.StatusNotFound || notFound.Reason != ReasonNotFound || notFound.Resource != "label" {
		t.Fatalf("not found = %+v", notFound)
	}
	dup := FromDB(gorm.ErrDuplicatedKey, "category", "failed_to_create_target")
	if dup.Code != http.StatusConflict || dup.Reason != ReasonAlreadyExists {
		t.Fatalf("duplicate = %+v", dup)
	}
	internal := FromDB(errors.New("UNIQUE constraint failed: secret_table.col at /var/lib/data.db"), "label", "failed_to_create_target")
	if internal.Code != http.StatusInternalServerError || internal.Message != "failed_to_create_target" || !errors.Is(internal, internal.Err) {
		t.Fatalf("internal = %+v", internal)
	}
	// 原始错误只写日志，不出现在返回给客户端的内容里
	raw, _ := json.Marshal(internal.Body())
	if strings.Contains(string(raw), "secret_table") || strings.Contains(string(raw), "/var/lib") {
		t.Fatalf("body leaks internals: %s", raw)
	}
}

func TestReasonsAndCompat(t *testing.T) {
	if e := AlreadyExists("label", "slug", "aigc"); e.Message != "slug_already_exists" || e.Code != http.StatusConflict || e.Value != "aigc" {
		t.Fatalf("already exists = %+v", e)
	}
	// 旧的按状态码创建的写法得到对应的原因
	for status, reason := range map[int]Reason{400: ReasonInvalidArgument, 401: ReasonUnauthenticated, 403: ReasonPermissionDenied, 404: ReasonNotFound, 409: ReasonConflict, 429: ReasonTooManyRequests, 500: ReasonInternal, 503: ReasonUnavailable} {
		if got := New(status, "x", nil).Reason; got != reason {
			t.Errorf("status %d reason = %s", status, got)
		}
	}
	if e := NewBadRequest("invalid_email"); e.Body().Code != "invalid_email" || e.Body().Reason != ReasonInvalidArgument {
		t.Fatalf("body = %+v", e.Body())
	}
}
