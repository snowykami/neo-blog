package utils

import "time"

const rateLimitKeyPrefix = "rate_limit:"

// AllowRequest 固定窗口限流：窗口内同一 key 的第 limit+1 次及之后的请求返回 false
func AllowRequest(key string, limit int, window time.Duration) bool {
	return KV.GetInstance().Incr(rateLimitKeyPrefix+key, window) <= limit
}

// TooManyFailures 窗口内失败次数是否已达到上限（只读，不计数）
func TooManyFailures(key string, limit int) bool {
	value, ok := KV.GetInstance().Get(rateLimitKeyPrefix + key)
	if !ok {
		return false
	}
	count, _ := value.(int)
	return count >= limit
}

// RecordFailure 记录一次失败
func RecordFailure(key string, window time.Duration) {
	KV.GetInstance().Incr(rateLimitKeyPrefix+key, window)
}

// ResetFailures 成功后清空失败计数
func ResetFailures(key string) {
	KV.GetInstance().Delete(rateLimitKeyPrefix + key)
}
