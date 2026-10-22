package utils

import (
	"time"

	"resty.dev/v3"
)

var client = resty.New().
	SetTimeout(30*time.Second).      // 请求超时时间
	SetRetryCount(2).                // 重试次数
	SetRetryWaitTime(1*time.Second). // 重试等待时间
	// resty v3.0.0-rc.1 起默认重试条件不再包含 HTTP 状态码，显式加回 429 / 5xx（不含 501）以保持原有重试行为
	AddRetryConditions(resty.RetryConditionStatusTooManyRequests, resty.RetryConditionStatus5XX)
