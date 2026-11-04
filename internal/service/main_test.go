package service

import (
	"os"
	"testing"
)

// TestMain AI 用户的事件处理（文章公开、新评论等）在测试中一律同步执行：
// 异步执行时可能在用例结束、临时数据库被删除后才访问数据库，导致其他用例偶发失败
func TestMain(m *testing.M) {
	agentEventsSync = true
	os.Exit(m.Run())
}
