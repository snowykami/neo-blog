package utils

import (
	"time"

	"resty.dev/v3"
)

var client = resty.New().
	SetTimeout(30 * time.Second).       // 请求超时时间
	SetRetryCount(2).                   // 重试次数
	SetRetryWaitTime(1 * time.Second)   // 重试等待时间
