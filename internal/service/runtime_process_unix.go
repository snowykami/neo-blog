//go:build unix

package service

import (
	"syscall"
	"time"
)

// processCPUTime 本进程累计占用的 CPU 时间（用户态 + 内核态）
func processCPUTime() time.Duration {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return 0
	}
	return time.Duration(usage.Utime.Nano() + usage.Stime.Nano())
}
