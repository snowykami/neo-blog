package utils

import (
	"strconv"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 计数存放在共享状态中，多实例部署时各实例共用同一个窗口

const rateLimitKeyPrefix = "rate_limit:"

// AllowRequest 固定窗口限流：窗口内同一 key 的第 limit+1 次及之后的请求返回 false；共享状态不可用时放行
func AllowRequest(key string, limit int, window time.Duration) bool {
	count, err := sharedstate.Current().Incr(rateLimitKeyPrefix+key, window)
	if err != nil {
		logrus.Warnf("rate limit unavailable, allowing request: %v", err)
		return true
	}
	return count <= int64(limit)
}

// TooManyFailures 窗口内失败次数是否已达到上限（只读，不计数）
func TooManyFailures(key string, limit int) bool {
	value, ok, err := sharedstate.Current().Get(rateLimitKeyPrefix + key)
	if err != nil || !ok {
		return false
	}
	count, _ := strconv.Atoi(value)
	return count >= limit
}

// RecordFailure 记录一次失败
func RecordFailure(key string, window time.Duration) {
	if _, err := sharedstate.Current().Incr(rateLimitKeyPrefix+key, window); err != nil {
		logrus.Warnf("record failure %s: %v", key, err)
	}
}

// ResetFailures 成功后清空失败计数
func ResetFailures(key string) {
	if err := sharedstate.Current().Delete(rateLimitKeyPrefix + key); err != nil {
		logrus.Warnf("reset failures %s: %v", key, err)
	}
}
