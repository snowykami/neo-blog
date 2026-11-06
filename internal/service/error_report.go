package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

/*
错误报告：浏览器（Sentry SDK 采集，含页面进程崩溃的补报）、Next.js 服务端与 Go 后端的错误按指纹聚合为「问题」，
每个问题每小时只保存有限条完整现场，其余只累计次数；上报按 IP 限频，计数在共享状态中，多副本共用。
开启请勿追踪（DNT / GPC）时只保存错误本身、页面地址与浏览器版本，不关联访客与用户，不保存设备信号；任何情况下都不保存 IP，只保存归属地
*/

const (
	errorReportRateLimit       = 30 // 每个 IP 每分钟最多上报次数
	errorReportRateWindow      = time.Minute
	errorEventsPerIssuePerHour = 10 // 每个问题每小时最多保存的完整事件数
	errorBreadcrumbLimit       = 50
	errorFrameLimit            = 60 // 每个异常最多保存的调用栈帧数（保留出错处附近的）
	errorExceptionLimit        = 5
	errorTextLimit             = 2000
	errorTitleLimit            = 512
	errorStackTextLimit        = 16 << 10
	MaxErrorEnvelopeSize       = 256 << 10 // 一次上报的请求体上限
)

type ErrorReportService struct{}

func NewErrorReportService() *ErrorReportService {
	return &ErrorReportService{}
}

// ErrorReportClient 上报请求的客户端信息，由 controller 从连接、Cookie 与请求头中读取
type ErrorReportClient struct {
	IP         string
	UserAgent  string
	VisitorKey string
	DoNotTrack bool
}

// errorReport 归一化后的一次错误，浏览器、Next.js 服务端与 Go 后端共用
type errorReport struct {
	Source     string
	Kind       string
	Level      string
	EventID    string
	Type       string // 异常类型，如 TypeError、panic
	Value      string // 异常消息或文字消息
	Path       string
	Method     string
	Release    string
	UserAgent  string
	At         time.Time
	Exceptions []sentryException
	Detail     map[string]any
}

// IngestEnvelope 接收一次 Sentry envelope 上报，只处理其中的错误事件
func (s *ErrorReportService) IngestEnvelope(ctx context.Context, body []byte, client ErrorReportClient) *errs.ServiceError {
	if !tools.GetErrorReportEnabled() {
		return nil
	}
	if !utils.AllowRequest("error_report:"+client.IP, errorReportRateLimit, errorReportRateWindow) {
		return errs.NewTooManyRequests("too_many_requests")
	}
	events, err := parseSentryEnvelope(body)
	if err != nil {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	// 爬虫与自动化工具执行脚本时的报错没有排查价值
	if utils.ParseUA(client.UserAgent).DeviceType == utils.DeviceBot {
		return nil
	}
	now := time.Now()
	for i := range events {
		report := reportFromSentry(&events[i], client.UserAgent, now)
		if err := s.record(ctx, report, client); err != nil {
			logrus.Warnf("record error report failed: %v", err)
		}
	}
	return nil
}

// BackendError Go 后端的一次 panic 或 5xx 响应
type BackendError struct {
	Panic  bool
	Status int
	Code   string // 返回给客户端的错误码（resps 的 message）
	Cause  string // 原始错误，只写日志与错误报告，不返回给客户端
	Stack  []byte // panic 时的调用栈
	Method string
	Path   string
}

// RecordBackendError 记录 Go 后端的 panic 与 5xx（直接写库，不经过上报接口）；记录失败只写日志，不影响请求
func (s *ErrorReportService) RecordBackendError(ctx context.Context, e BackendError) {
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("record backend error panicked: %v", r)
		}
	}()
	if !tools.GetErrorReportEnabled() {
		return
	}
	report := &errorReport{
		Source: constant.ErrorSourceBackend,
		Kind:   constant.ErrorKindError,
		Level:  "error",
		Path:   e.Path,
		Method: e.Method,
		At:     time.Now(),
		Detail: map[string]any{"status": e.Status, "request": map[string]any{"method": e.Method, "path": e.Path}},
	}
	if e.Panic {
		report.Level = "fatal"
		report.Type = "panic"
		report.Value = utils.Truncate(e.Cause, errorTextLimit)
		report.Detail["stack_text"] = utils.Truncate(string(e.Stack), errorStackTextLimit)
		if fn := firstAppFunction(string(e.Stack)); fn != "" {
			report.Detail["culprit_function"] = fn
		}
	} else {
		report.Type = firstNonEmpty(e.Code, "internal_server_error")
		report.Value = utils.Truncate(e.Cause, errorTextLimit)
	}
	if err := s.record(ctx, report, ErrorReportClient{UserAgent: ""}); err != nil {
		logrus.Warnf("record backend error failed: %v", err)
	}
}

// reportFromSentry 把 SDK 上报的事件归一化：来源（Next 服务端由 instrumentation.ts 以 node 平台上报）、类型（崩溃补报带 kind 标签）与页面路径
func reportFromSentry(event *sentryEvent, userAgent string, now time.Time) *errorReport {
	report := &errorReport{
		Source:     constant.ErrorSourceBrowser,
		Kind:       constant.ErrorKindMessage,
		Level:      firstNonEmpty(event.Level, "error"),
		EventID:    normalizeEventID(event.EventID),
		Release:    utils.Truncate(event.Release, 64),
		UserAgent:  userAgent,
		At:         event.time(now),
		Exceptions: trimExceptions(event.exceptions()),
	}
	if event.Platform == "node" || event.Tags["source"] == constant.ErrorSourceServer {
		report.Source = constant.ErrorSourceServer
	}
	if len(report.Exceptions) > 0 {
		report.Kind = constant.ErrorKindError
		last := report.Exceptions[len(report.Exceptions)-1]
		report.Type, report.Value = utils.Truncate(last.Type, 128), utils.Truncate(last.Value, errorTextLimit)
	} else {
		report.Value = utils.Truncate(event.message(), errorTextLimit)
	}
	switch event.Tags["kind"] {
	case constant.ErrorKindCrash:
		report.Kind, report.Level = constant.ErrorKindCrash, "fatal"
	case constant.ErrorKindDiscarded:
		report.Kind, report.Level = constant.ErrorKindDiscarded, "warning"
	}
	if event.Request != nil {
		if u, err := url.Parse(event.Request.URL); err == nil {
			report.Path = u.Path
		}
		// 服务端上报时请求头里带着读者浏览器的 UA
		if ua := event.Request.Headers["User-Agent"]; ua != "" && report.Source == constant.ErrorSourceServer {
			report.UserAgent = ua
		}
	}
	report.Path = utils.Truncate(report.Path, 512)
	report.Method = utils.Truncate(strings.ToUpper(event.Tags["method"]), 8)
	detail := map[string]any{}
	if len(report.Exceptions) > 0 {
		detail["exception"] = report.Exceptions
	}
	if crumbs := event.breadcrumbs(errorBreadcrumbLimit); len(crumbs) > 0 {
		detail["breadcrumbs"] = crumbs
	}
	if len(event.Contexts) > 0 {
		detail["contexts"] = event.Contexts
	}
	if len(event.Tags) > 0 {
		detail["tags"] = event.Tags
	}
	if len(event.Extra) > 0 {
		detail["extra"] = event.Extra
	}
	if event.Request != nil && event.Request.URL != "" {
		detail["request"] = map[string]any{"url": stripQuery(event.Request.URL)}
	}
	if event.SDK != nil {
		detail["sdk"] = event.SDK
	}
	if event.Environment != "" {
		detail["environment"] = event.Environment
	}
	report.Detail = detail
	return report
}

// record 累计到问题，并在未超出每小时的保存上限时保存这次现场
func (s *ErrorReportService) record(ctx context.Context, report *errorReport, client ErrorReportClient) error {
	issue, err := repo.ErrorReport.UpsertIssue(&model.ErrorIssue{
		Fingerprint: errorFingerprint(report),
		Source:      report.Source,
		Kind:        report.Kind,
		Level:       report.Level,
		Title:       utils.Truncate(errorTitle(report), errorTitleLimit),
		Culprit:     utils.Truncate(errorCulprit(report), errorTitleLimit),
		LastRelease: report.Release,
		FirstSeenAt: report.At,
		LastSeenAt:  report.At,
	})
	if err != nil {
		return err
	}
	hour := report.At.Truncate(time.Hour).Unix()
	saved, err := sharedstate.Current().Incr(fmt.Sprintf("error_report_events:%d:%d", issue.ID, hour), time.Hour)
	if err == nil && saved > errorEventsPerIssuePerHour {
		return nil
	}

	ua := utils.ParseUA(report.UserAgent)
	event := &model.ErrorEvent{
		IssueID:        issue.ID,
		EventID:        report.EventID,
		Source:         report.Source,
		Level:          report.Level,
		Message:        utils.Truncate(errorTitle(report), errorTextLimit),
		Path:           report.Path,
		Method:         report.Method,
		Release:        report.Release,
		UserAgent:      utils.Truncate(report.UserAgent, 512),
		OS:             ua.OS,
		OSVersion:      utils.Truncate(ua.OSVersion, 32),
		Browser:        ua.Browser,
		BrowserVersion: utils.Truncate(ua.BrowserVer, 32),
		DeviceType:     ua.DeviceType,
		Anonymous:      client.DoNotTrack,
		Detail:         report.Detail,
		CreatedAt:      report.At,
	}
	if client.IP != "" {
		event.Location = utils.Truncate(ipregion.Lookup(client.IP).String(), 128)
	}
	if client.DoNotTrack {
		// 请勿追踪：不保存设备信号，也不关联访客与用户
		if contexts, ok := event.Detail["contexts"].(map[string]map[string]any); ok {
			delete(contexts, "signals")
		}
	} else {
		if client.VisitorKey != "" {
			if visitor, err := repo.Visit.GetVisitorByKey(client.VisitorKey); err == nil {
				event.VisitorID = &visitor.ID
			}
		}
		if userID, ok := ctxutils.GetCurrentUserID(ctx); ok {
			event.UserID = &userID
		}
	}
	return repo.ErrorReport.CreateEvent(event)
}

// errorFingerprint 聚合用的指纹：来源、类型、归一化后的异常类型与消息，以及出错处附近的站内调用栈；
// 页面崩溃没有调用栈，按页面所属的栏目（路径第一段）聚合
func errorFingerprint(report *errorReport) string {
	parts := []string{report.Source, report.Kind}
	switch report.Kind {
	case constant.ErrorKindCrash, constant.ErrorKindDiscarded:
		parts = append(parts, pathSection(report.Path))
	default:
		parts = append(parts, report.Type, normalizeErrorMessage(report.Value))
		for _, frame := range culpritFrames(report.Exceptions, 3) {
			parts = append(parts, frame.Filename+":"+frame.Function)
		}
		if report.Source == constant.ErrorSourceBackend {
			parts = append(parts, report.Method, pathSection(report.Path))
			if fn, ok := report.Detail["culprit_function"].(string); ok {
				parts = append(parts, fn)
			}
		}
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])
}

// errorTitle 问题标题：异常为「类型: 消息」，其余为消息本身
func errorTitle(report *errorReport) string {
	switch report.Kind {
	case constant.ErrorKindCrash:
		return firstNonEmpty(report.Value, "Page crashed")
	case constant.ErrorKindDiscarded:
		return firstNonEmpty(report.Value, "Page discarded in background")
	}
	if report.Type != "" && report.Value != "" {
		return report.Type + ": " + report.Value
	}
	return firstNonEmpty(report.Value, report.Type, "Unknown error")
}

// errorCulprit 出错位置：最内层的站内调用栈帧；后端为请求的方法与路径，panic 时附上出错的函数
func errorCulprit(report *errorReport) string {
	if report.Source == constant.ErrorSourceBackend {
		culprit := strings.TrimSpace(report.Method + " " + report.Path)
		if fn, ok := report.Detail["culprit_function"].(string); ok {
			culprit += " · " + fn
		}
		return culprit
	}
	if frames := culpritFrames(report.Exceptions, 1); len(frames) > 0 {
		frame := frames[0]
		location := frame.Filename
		if frame.Lineno > 0 {
			location += ":" + strconv.Itoa(frame.Lineno)
		}
		if frame.Function != "" {
			return frame.Function + " (" + location + ")"
		}
		return location
	}
	return report.Path
}

// culpritFrames 直接抛出的异常中最靠近出错处的 n 个站内帧（没有站内帧时取最内层的帧）
func culpritFrames(exceptions []sentryException, n int) []sentryFrame {
	if len(exceptions) == 0 {
		return nil
	}
	last := exceptions[len(exceptions)-1]
	if last.Stacktrace == nil || len(last.Stacktrace.Frames) == 0 {
		return nil
	}
	frames := last.Stacktrace.Frames
	var result []sentryFrame
	for i := len(frames) - 1; i >= 0 && len(result) < n; i-- {
		if frames[i].InApp != nil && *frames[i].InApp {
			result = append(result, frames[i])
		}
	}
	if len(result) == 0 {
		result = append(result, frames[len(frames)-1])
	}
	return result
}

// trimExceptions 限制异常链的长度、每个异常的帧数与文本长度，避免单条事件过大
func trimExceptions(exceptions []sentryException) []sentryException {
	if len(exceptions) > errorExceptionLimit {
		exceptions = exceptions[len(exceptions)-errorExceptionLimit:]
	}
	result := make([]sentryException, 0, len(exceptions))
	for _, e := range exceptions {
		e.Type = utils.Truncate(e.Type, 128)
		e.Value = utils.Truncate(e.Value, errorTextLimit)
		if e.Stacktrace != nil {
			frames := e.Stacktrace.Frames
			if len(frames) > errorFrameLimit {
				frames = frames[len(frames)-errorFrameLimit:]
			}
			trimmed := make([]sentryFrame, len(frames))
			for i, f := range frames {
				f.Filename = utils.Truncate(f.Filename, 512)
				f.AbsPath = utils.Truncate(stripQuery(f.AbsPath), 512)
				f.Function = utils.Truncate(f.Function, 256)
				f.ContextLine = utils.Truncate(f.ContextLine, 300)
				f.PreContext = truncateLines(f.PreContext, 5, 300)
				f.PostContext = truncateLines(f.PostContext, 5, 300)
				trimmed[i] = f
			}
			e.Stacktrace = &sentryStacktrace{Frames: trimmed}
		}
		result = append(result, e)
	}
	return result
}

func truncateLines(lines []string, maxLines, maxLen int) []string {
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	result := make([]string, len(lines))
	for i, line := range lines {
		result[i] = utils.Truncate(line, maxLen)
	}
	return result
}

var (
	errorHexPattern    = regexp.MustCompile(`\b[0-9a-fA-F]{8,}\b`)
	errorNumberPattern = regexp.MustCompile(`\d+`)
	errorURLPattern    = regexp.MustCompile(`https?://\S+`)
	eventIDPattern     = regexp.MustCompile(`^[0-9a-f]{32}$`)
	goFuncPattern      = regexp.MustCompile(`^(github\.com/snowykami/neo-blog/\S+)\(`)
	// 本项目的源码文件（不论构建时的目录在哪）与行号
	goFilePattern = regexp.MustCompile(`(?:^|/)((?:internal|pkg|cmd)/\S+\.go):(\d+)`)
)

// normalizeErrorMessage 去掉消息里每次都不同的部分（地址、ID、数字），让同一个问题聚到一起
func normalizeErrorMessage(message string) string {
	message = errorURLPattern.ReplaceAllString(message, "<url>")
	message = errorHexPattern.ReplaceAllString(message, "<hex>")
	message = errorNumberPattern.ReplaceAllString(message, "<n>")
	return strings.TrimSpace(message)
}

// pathSection 路径所属的栏目：/p/slug 归为 /p/*，只有一段时原样返回
func pathSection(path string) string {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if len(segments) <= 1 {
		return "/" + segments[0]
	}
	return "/" + segments[0] + "/*"
}

// firstAppFunction panic 发生处：调用栈中第一个本项目的帧（跳过错误报告中间件本身），用于 panic 的聚合与出错位置。
// Hertz 的 recovery 给出的调用栈每帧两行：「文件:行号 (pc)」与「\t函数: 源码」；也兼容 runtime/debug.Stack 的「包.函数(...)」与「\t文件:行号」
func firstAppFunction(stack string) string {
	lines := strings.Split(stack, "\n")
	for i, line := range lines {
		m := goFilePattern.FindStringSubmatch(line)
		if m == nil || strings.Contains(line, "/pkg/mod/") || strings.HasSuffix(m[1], "internal/middleware/error_report.go") {
			continue
		}
		location := m[1] + ":" + m[2]
		// Hertz 格式：函数在下一行；debug.Stack 格式：函数在上一行
		if i+1 < len(lines) && strings.HasPrefix(lines[i+1], "\t") && !goFilePattern.MatchString(lines[i+1]) {
			if fn, _, ok := strings.Cut(strings.TrimSpace(lines[i+1]), ": "); ok {
				return location + " " + fn
			}
		}
		if i > 0 {
			if fm := goFuncPattern.FindStringSubmatch(strings.TrimSpace(lines[i-1])); fm != nil {
				return location + " " + fm[1][strings.LastIndex(fm[1], "/")+1:]
			}
		}
		return location
	}
	return ""
}

func normalizeEventID(id string) string {
	id = strings.ToLower(strings.ReplaceAll(id, "-", ""))
	if eventIDPattern.MatchString(id) {
		return id
	}
	return ""
}

// stripQuery 去掉地址中的查询参数与片段（可能带着令牌等敏感信息）
func stripQuery(raw string) string {
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		return raw[:i]
	}
	return raw
}

// ---------- 控制台 ----------

func (s *ErrorReportService) ListIssues(ctx context.Context, req *dto.ListErrorIssuesReq) ([]*dto.ErrorIssueDto, int64, *errs.ServiceError) {
	issues, total, err := repo.ErrorReport.ListIssues(req)
	if err != nil {
		return nil, 0, errs.Internal("internal_server_error", err)
	}
	result := make([]*dto.ErrorIssueDto, len(issues))
	for i := range issues {
		result[i] = issues[i].ToDto()
	}
	return result, total, nil
}

func (s *ErrorReportService) GetIssue(ctx context.Context, id uint) (*dto.ErrorIssueDetailDto, *errs.ServiceError) {
	issue, err := repo.ErrorReport.GetIssue(id)
	if err != nil {
		return nil, errorReportLookupError(err)
	}
	detail, err := repo.ErrorReport.IssueBreakdown(id, 5)
	if err != nil {
		return nil, errs.Internal("internal_server_error", err)
	}
	detail.ErrorIssueDto = *issue.ToDto()
	return detail, nil
}

func (s *ErrorReportService) ListEvents(ctx context.Context, issueID uint, req *dto.ListErrorEventsReq) ([]*dto.ErrorEventSummaryDto, int64, *errs.ServiceError) {
	events, total, err := repo.ErrorReport.ListEvents(issueID, req)
	if err != nil {
		return nil, 0, errs.Internal("internal_server_error", err)
	}
	result := make([]*dto.ErrorEventSummaryDto, len(events))
	for i := range events {
		result[i] = events[i].ToSummaryDto()
	}
	return result, total, nil
}

func (s *ErrorReportService) GetEvent(ctx context.Context, id uint) (*dto.ErrorEventDto, *errs.ServiceError) {
	event, err := repo.ErrorReport.GetEvent(id)
	if err != nil {
		return nil, errorReportLookupError(err)
	}
	return event.ToDto(), nil
}

func (s *ErrorReportService) UpdateIssueStatus(ctx context.Context, id uint, req *dto.UpdateErrorIssueReq) *errs.ServiceError {
	if !(req.Status == constant.ErrorStatusUnresolved || req.Status == constant.ErrorStatusResolved || req.Status == constant.ErrorStatusIgnored) {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	if _, err := repo.ErrorReport.GetIssue(id); err != nil {
		return errorReportLookupError(err)
	}
	if err := repo.ErrorReport.UpdateIssueStatus(id, req.Status, time.Now()); err != nil {
		return errs.Internal("internal_server_error", err)
	}
	return nil
}

func (s *ErrorReportService) DeleteIssue(ctx context.Context, id uint) *errs.ServiceError {
	if _, err := repo.ErrorReport.GetIssue(id); err != nil {
		return errorReportLookupError(err)
	}
	if err := repo.ErrorReport.DeleteIssue(id); err != nil {
		return errs.Internal("internal_server_error", err)
	}
	return nil
}

func (s *ErrorReportService) GetStats(ctx context.Context) (*dto.ErrorReportStats, *errs.ServiceError) {
	stats, err := repo.ErrorReport.Stats(time.Now().Add(-24 * time.Hour))
	if err != nil {
		return nil, errs.Internal("internal_server_error", err)
	}
	return stats, nil
}

func errorReportLookupError(err error) *errs.ServiceError {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.NewNotFound("target_not_found")
	}
	return errs.Internal("internal_server_error", err)
}
