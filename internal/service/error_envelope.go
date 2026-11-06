package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Sentry envelope 协议（https://develop.sentry.dev/sdk/envelopes/）：前端用开源的 Sentry SDK 采集错误，
// 通过 tunnel 选项发到本站（经 Next 服务端还原源码位置后转给后端），后端只解析其中的错误事件，其余类型（会话、客户端统计等）忽略

// sentryEvent 错误事件中用到的字段
type sentryEvent struct {
	EventID     string                    `json:"event_id"`
	Timestamp   json.RawMessage           `json:"timestamp"` // Unix 秒（可带小数）或 RFC 3339 字符串
	Level       string                    `json:"level"`
	Platform    string                    `json:"platform"`
	Release     string                    `json:"release"`
	Environment string                    `json:"environment"`
	Message     json.RawMessage           `json:"message"` // 字符串，或 {formatted, message}
	Logentry    *sentryLogentry           `json:"logentry"`
	Exception   *sentryExceptionList      `json:"exception"`
	Breadcrumbs json.RawMessage           `json:"breadcrumbs"` // 数组，或 {values: [...]}
	Tags        map[string]string         `json:"tags"`
	Contexts    map[string]map[string]any `json:"contexts"`
	Extra       map[string]any            `json:"extra"`
	Request     *sentryRequest            `json:"request"`
	SDK         *sentrySDK                `json:"sdk"`
}

type sentryLogentry struct {
	Message   string `json:"message"`
	Formatted string `json:"formatted"`
}

type sentryExceptionList struct {
	Values []sentryException `json:"values"`
}

type sentryException struct {
	Type       string            `json:"type"`
	Value      string            `json:"value"`
	Mechanism  *sentryMechanism  `json:"mechanism,omitempty"`
	Stacktrace *sentryStacktrace `json:"stacktrace,omitempty"`
}

type sentryMechanism struct {
	Type    string `json:"type"`
	Handled *bool  `json:"handled,omitempty"`
}

type sentryStacktrace struct {
	Frames []sentryFrame `json:"frames"` // 从最外层到出错处
}

type sentryFrame struct {
	Filename    string   `json:"filename,omitempty"`
	AbsPath     string   `json:"abs_path,omitempty"`
	Function    string   `json:"function,omitempty"`
	Lineno      int      `json:"lineno,omitempty"`
	Colno       int      `json:"colno,omitempty"`
	InApp       *bool    `json:"in_app,omitempty"`
	ContextLine string   `json:"context_line,omitempty"`
	PreContext  []string `json:"pre_context,omitempty"`
	PostContext []string `json:"post_context,omitempty"`
	// 还原前的压缩位置（Next 服务端还原源码位置时写入），如 /_next/static/chunks/x.js:1:2345
	Minified string `json:"minified,omitempty"`
}

type sentryRequest struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

type sentrySDK struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type envelopeItemHeader struct {
	Type   string `json:"type"`
	Length *int   `json:"length"`
}

var errInvalidEnvelope = errors.New("invalid envelope")

// parseSentryEnvelope 解析 envelope：第一行为信封头，之后每个条目为一行条目头加内容（条目头给出 length 时按字节数读取，否则读到行尾）；
// 返回其中的错误事件
func parseSentryEnvelope(body []byte) ([]sentryEvent, error) {
	line, rest, ok := bytes.Cut(body, []byte("\n"))
	if !ok || !json.Valid(line) {
		return nil, errInvalidEnvelope
	}
	var events []sentryEvent
	for len(bytes.TrimSpace(rest)) > 0 {
		var headerLine []byte
		headerLine, rest, _ = bytes.Cut(rest, []byte("\n"))
		if len(bytes.TrimSpace(headerLine)) == 0 {
			continue
		}
		var header envelopeItemHeader
		if err := json.Unmarshal(headerLine, &header); err != nil {
			return nil, errInvalidEnvelope
		}
		var payload []byte
		if header.Length != nil {
			if *header.Length < 0 || *header.Length > len(rest) {
				return nil, errInvalidEnvelope
			}
			payload, rest = rest[:*header.Length], rest[*header.Length:]
			rest = bytes.TrimPrefix(rest, []byte("\n"))
		} else {
			payload, rest, _ = bytes.Cut(rest, []byte("\n"))
		}
		if header.Type != "event" {
			continue
		}
		var event sentryEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			return nil, errInvalidEnvelope
		}
		events = append(events, event)
	}
	return events, nil
}

// message 事件的文字消息（captureMessage）：message 字段可能是字符串或对象，也可能放在 logentry 里
func (e *sentryEvent) message() string {
	if len(e.Message) > 0 {
		var text string
		if json.Unmarshal(e.Message, &text) == nil {
			return text
		}
		var entry sentryLogentry
		if json.Unmarshal(e.Message, &entry) == nil {
			return firstNonEmpty(entry.Formatted, entry.Message)
		}
	}
	if e.Logentry != nil {
		return firstNonEmpty(e.Logentry.Formatted, e.Logentry.Message)
	}
	return ""
}

// time 事件发生的时间：缺失、无法解析或与服务器时间相差超过一天时用服务器时间
func (e *sentryEvent) time(now time.Time) time.Time {
	var at time.Time
	var seconds float64
	var text string
	switch {
	case json.Unmarshal(e.Timestamp, &seconds) == nil && seconds > 0:
		at = time.Unix(0, int64(seconds*float64(time.Second)))
	case json.Unmarshal(e.Timestamp, &text) == nil:
		if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
			at = parsed
		} else if n, err := strconv.ParseFloat(text, 64); err == nil {
			at = time.Unix(0, int64(n*float64(time.Second)))
		}
	}
	if at.IsZero() || at.Sub(now) > 24*time.Hour || now.Sub(at) > 24*time.Hour {
		return now
	}
	return at
}

// breadcrumbs 面包屑：SDK 发送数组，旧版或其他实现可能是 {values: [...]}；只保留最近的 limit 条
func (e *sentryEvent) breadcrumbs(limit int) []map[string]any {
	var list []map[string]any
	if json.Unmarshal(e.Breadcrumbs, &list) != nil {
		var wrapped struct {
			Values []map[string]any `json:"values"`
		}
		if json.Unmarshal(e.Breadcrumbs, &wrapped) == nil {
			list = wrapped.Values
		}
	}
	if len(list) > limit {
		list = list[len(list)-limit:]
	}
	return list
}

// exceptions 异常链：最后一个为直接抛出的异常
func (e *sentryEvent) exceptions() []sentryException {
	if e.Exception == nil {
		return nil
	}
	return e.Exception.Values
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
