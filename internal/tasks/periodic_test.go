package tasks

import "testing"

// 一轮任务 panic 时不应向外抛出（否则后台协程会让整个进程退出）
func TestRunSafelyRecoversPanic(t *testing.T) {
	ran := false
	runSafely("test_task", func() {
		ran = true
		panic("boom")
	})
	if !ran {
		t.Fatal("task did not run")
	}
}
