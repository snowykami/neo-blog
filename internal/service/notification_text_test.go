package service

import (
	"strings"
	"testing"
	"time"
)

func TestNotificationSummary(t *testing.T) {
	cases := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"去掉 HTML 标签", `<p>你好 <strong>世界</strong></p>`, 60, "你好 世界"},
		{"合并换行与多余空白", "第一行\n\n第二行\t\t结尾", 60, "第一行 第二行 结尾"},
		{"反转义 HTML 实体", "a &amp; b &lt;c&gt;", 60, "a & b <c>"},
		{"按字符截断", strings.Repeat("字", 70), 60, strings.Repeat("字", 60) + "…"},
		{"不截断时不加省略号", "刚好", 2, "刚好"},
		{"空正文", "   ", 60, ""},
	}
	for _, tc := range cases {
		if got := NotificationSummary(tc.in, tc.max); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	// 落库摘要取 300 字符上限，与列宽一致
	long := strings.Repeat("字", 400)
	if got := notificationStoredExcerpt(long); len([]rune(got)) != notificationExcerptStoreRunes+1 {
		t.Errorf("stored excerpt runes = %d", len([]rune(got)))
	}
}

func TestNotificationDay(t *testing.T) {
	at := time.Date(2026, 11, 8, 17, 30, 0, 0, time.UTC)
	// 跨零点：UTC 还是 8 号，东京已经是 9 号
	if got := notificationDay(at, "UTC"); got != "20261108" {
		t.Errorf("utc day = %s", got)
	}
	if got := notificationDay(at, "Asia/Tokyo"); got != "20261109" {
		t.Errorf("tokyo day = %s", got)
	}
	// 空时区与非法时区都用服务器时区，不 panic
	if got := notificationDay(at, ""); len(got) != 8 {
		t.Errorf("empty timezone day = %s", got)
	}
	if got := notificationDay(at, "Not/AZone"); len(got) != 8 {
		t.Errorf("invalid timezone day = %s", got)
	}
}

func TestDedupeKeys(t *testing.T) {
	cases := map[string]string{
		dedupeKeyCommentCreated("post", 12, 1234): "comment.created:post:12:comment:1234",
		dedupeKeyCommentReplied(99, 1234):         "comment.replied:comment:99:comment:1234",
		dedupeKeyPostLiked(12, 3):                 "post.liked:post:12:user:3",
		dedupeKeyCommentLiked(99, 3):              "comment.liked:comment:99:user:3",
		dedupeKeyThreadReplied(77, "20261108", 5): "comment.thread_replied:comment:77:day:20261108:user:5",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("dedupe key = %q, want %q", got, want)
		}
	}
	// 去重键不能超过列宽（160）
	for key := range cases {
		if len(key) > 160 {
			t.Errorf("dedupe key %q exceeds column", key)
		}
	}
}
