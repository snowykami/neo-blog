//go:build !unix

package service

import "time"

// processCPUTime 非 Unix 平台不统计 CPU 时间
func processCPUTime() time.Duration {
	return 0
}
