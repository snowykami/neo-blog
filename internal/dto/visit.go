package dto

import "time"

// ReportVisitReq 浏览器上报一次访问
type ReportVisitReq struct {
	Path        string `json:"path"`
	TargetType  string `json:"target_type"` // post / page / other
	TargetID    uint   `json:"target_id"`
	Referrer    string `json:"referrer"`
	Fingerprint string `json:"fingerprint"` // 前端计算的浏览器指纹哈希
	// 浏览器公开的基础信号，用于一致性检测；开启请勿追踪时前端不上报，后端也不保存
	Signals *VisitSignals `json:"signals"`
}

// VisitSignals 浏览器无需授权即可读取的低熵信号
type VisitSignals struct {
	TimeZone    string   `json:"time_zone"`    // IANA 时区，如 Asia/Shanghai
	UTCOffset   *int     `json:"utc_offset"`   // 当前时区偏移（分钟，东正西负）
	Languages   []string `json:"languages"`    // navigator.languages 前 3 个
	Screen      string   `json:"screen"`       // 屏幕尺寸（CSS 像素），如 1920x1080
	DPR         float64  `json:"dpr"`          // 设备像素比
	TouchPoints *int     `json:"touch_points"` // 最大触控点数
	Pointer     string   `json:"pointer"`      // 主指针精度：fine / coarse
	ColorScheme string   `json:"color_scheme"` // 深浅色偏好：light / dark
	Webdriver   bool     `json:"webdriver"`    // navigator.webdriver
}

type ListVisitLogReq struct {
	PaginationParams
	Kind       string `query:"kind"`   // all / user / anonymous
	Action     string `query:"action"` // 空为全部；visit 仅访问；interaction 仅互动
	VisitorID  uint   `query:"visitor_id"`
	TargetType string `query:"target_type"`
	TargetID   uint   `query:"target_id"`
	Source     string `query:"source"`      // 按来源筛选
	SourceHost string `query:"source_host"` // 来源为其他网站时按域名筛选
	Trust      string `query:"trust"`       // 按可信度结论筛选，见 constant.VisitTrust*
	Country    string `query:"country"`     // 按推断国家筛选
	Device     string `query:"device"`      // 按设备类型筛选
	IncludeAI  *bool  `query:"include_ai"`  // 是否包含站内 AI 用户账号，默认 true
}

type VisitStatsReq struct {
	IncludeAI *bool `query:"include_ai"` // 是否包含站内 AI 用户账号，默认 true
}

type VisitInsightsReq struct {
	Days      int   `query:"days"`       // 1（今日）/ 7 / 30
	IncludeAI *bool `query:"include_ai"` // 是否包含站内 AI 用户账号，默认 true
}

func includeAIFlag(v *bool) bool {
	return v == nil || *v
}

func (r *ListVisitLogReq) ShouldIncludeAI() bool  { return r == nil || includeAIFlag(r.IncludeAI) }
func (r *VisitStatsReq) ShouldIncludeAI() bool    { return r == nil || includeAIFlag(r.IncludeAI) }
func (r *VisitInsightsReq) ShouldIncludeAI() bool { return r == nil || includeAIFlag(r.IncludeAI) }

type VisitorDto struct {
	ID          uint      `json:"id"`
	User        *UserDto  `json:"user"`
	IP          string    `json:"ip"`
	Location    string    `json:"location"`
	OS          string    `json:"os"`
	Browser     string    `json:"browser"`
	DeviceType  string    `json:"device_type"`
	VisitCount  int64     `json:"visit_count"`
	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

type VisitLogDto struct {
	ID         uint     `json:"id"`
	VisitorID  *uint    `json:"visitor_id"`
	VisitCount int64    `json:"visit_count"` // 该访客的累计访问次数
	User       *UserDto `json:"user"`        // 访问者或执行互动的用户
	UserSource string   `json:"user_source"` // 为空时访问时已登录；browser / fingerprint 为登录后补记的登录前访问
	Action     string   `json:"action"`      // visit / like / comment
	TargetType string   `json:"target_type"` // 访问：post / page / other；互动：post / page / comment
	TargetID   uint     `json:"target_id"`
	TargetUser *UserDto `json:"target_user"` // 被互动内容的作者
	// 所在的文章或页面（目标为评论时为评论所在的文章/页面），已删除时为空
	Subject *CommentTargetDto `json:"subject"`
	// 被点赞或被回复的评论，已删除时为空
	TargetComment *VisitCommentDto `json:"target_comment"`
	// 评论/回复时新发表的评论，已删除时为空
	Comment *VisitCommentDto `json:"comment"`
	// 其他页面的路由类型与名称（如标签名、分类名、用户昵称），见 service.describeVisitPath
	PathKind   string    `json:"path_kind"`
	PathName   string    `json:"path_name"`
	Path       string    `json:"path"`
	Referrer   string    `json:"referrer"`
	Source     string    `json:"source"`      // 来源分类，见 utils.ClassifyReferrer
	SourceHost string    `json:"source_host"` // 来源域名，直接访问时为空
	IP         string    `json:"ip"`
	Location   string    `json:"location"`
	OS         string    `json:"os"`
	Browser    string    `json:"browser"`
	DeviceType string    `json:"device_type"`
	CreatedAt  time.Time `json:"created_at"`
	// 一致性检测结果，旧记录与互动记录为空
	Trust           string              `json:"trust"`            // trusted / proxy / spoofed / bot / unknown
	TrustScore      *int                `json:"trust_score"`      // 一致性得分 0-100
	TrustFlags      []VisitTrustFlagDto `json:"trust_flags"`      // 命中的规则，按严重度从高到低
	IPCountry       string              `json:"ip_country"`       // IP 所在国家代码（港澳台单独区分）
	InferredCountry string              `json:"inferred_country"` // 综合时区、语言、IP 推断的国家
	IPTrusted       bool                `json:"ip_trusted"`       // IP 归属地与推断结果一致且不是机房网段
	Language        string              `json:"language"`         // 首选语言
	UTCOffset       *int                `json:"utc_offset"`       // 浏览器时区偏移（分钟）
	EngagedMs       *int64              `json:"engaged_ms"`       // 有效停留时长（毫秒），未收到时为空
	ScrollDepth     *int                `json:"scroll_depth"`     // 最大滚动深度（0-100）
}

// VisitTrustFlagDto 命中的一致性规则
type VisitTrustFlagDto struct {
	ID       string `json:"id"`
	Severity string `json:"severity"` // high / medium / low / info
}

// VisitDetailDto 后台：单次访问详情
type VisitDetailDto struct {
	Visit   *VisitLogDto     `json:"visit"`
	Signals *VisitSignalsDto `json:"signals"` // 采集到的全部信号
	Trust   *VisitTrustDto   `json:"trust"`   // 一致性检测过程，互动记录为空
	History []*VisitLogDto   `json:"history"` // 同一访客最近的访问（含本次）
}

// VisitSignalsDto 访问记录保存的浏览器信号与请求头
type VisitSignalsDto struct {
	HasSignals     bool     `json:"has_signals"` // 是否上报了浏览器信号
	UserAgent      string   `json:"user_agent"`
	AcceptLanguage string   `json:"accept_language"`
	CHPlatform     string   `json:"ch_platform"` // Sec-CH-UA-Platform
	CHMobile       *bool    `json:"ch_mobile"`   // Sec-CH-UA-Mobile
	CHBrands       string   `json:"ch_brands"`   // Sec-CH-UA
	ISP            string   `json:"isp"`
	Datacenter     bool     `json:"datacenter"`   // IP 属于机房 / 云服务网段
	PrevCountry    string   `json:"prev_country"` // 该访客上一次访问的 IP 国家
	TimeZone       string   `json:"time_zone"`
	UTCOffset      *int     `json:"utc_offset"`
	Languages      []string `json:"languages"`
	Screen         string   `json:"screen"`
	DPR            float64  `json:"dpr"`
	TouchPoints    *int     `json:"touch_points"`
	Pointer        string   `json:"pointer"`
	ColorScheme    string   `json:"color_scheme"`
	Webdriver      bool     `json:"webdriver"`
}

// VisitTrustDto 一致性检测的完整过程：每条规则的结果与地区推断依据
type VisitTrustDto struct {
	Verdict    string                `json:"verdict"`
	Score      *int                  `json:"score"`
	Country    string                `json:"country"`    // 推断国家，无法推断时为空
	Confidence string                `json:"confidence"` // high / medium / low
	IPTrusted  bool                  `json:"ip_trusted"`
	Sources    []VisitTrustSourceDto `json:"sources"`
	Rules      []VisitRuleResultDto  `json:"rules"`
}

// VisitTrustSourceDto 地区推断的一个依据（IP / 时区 / 语言）
type VisitTrustSourceDto struct {
	Key     string `json:"key"`     // ip / tz / lang
	Value   string `json:"value"`   // 读到的原始值
	Country string `json:"country"` // 指向的国家
	Weight  int    `json:"weight"`  // 参与投票的权重，0 表示不参与
	Note    string `json:"note"`    // 不参与的原因键，见前端 Console.visits.trust.notes
	Agree   *bool  `json:"agree"`   // 是否与推断结果一致，不参与时为空
}

// VisitRuleResultDto 一条一致性规则的结果；说明文案由前端按 reason 与 params 生成
type VisitRuleResultDto struct {
	ID       string            `json:"id"`
	Category string            `json:"category"` // location / env / auto
	Status   string            `json:"status"`   // hit / pass / skip
	Severity string            `json:"severity"` // 命中时的严重度
	Reason   string            `json:"reason"`   // 文案键，见前端 Console.visits.trust.reasons
	Params   map[string]string `json:"params"`
}

// VisitInsightsDto 后台：访客统计（含推断地区与可信度分布）
type VisitInsightsDto struct {
	Days              int               `json:"days"`
	Total             int64             `json:"total"`         // 全部访问（含疑似自动化）
	PV                int64             `json:"pv"`            // 不含疑似自动化
	UV                int64             `json:"uv"`            // 独立访客，不含请勿追踪与疑似自动化
	SignalVisits      int64             `json:"signal_visits"` // 带浏览器信号的访问
	Verdicts          []NamedCount      `json:"verdicts"`
	Trend             []VisitTrendPoint `json:"trend"`              // 今日按小时，其余按天
	IPCountries       []NamedCount      `json:"ip_countries"`       // 带信号的访问按 IP 国家
	InferredCountries []NamedCount      `json:"inferred_countries"` // 带信号的访问按推断国家
	ProxyExits        []NamedCount      `json:"proxy_exits"`        // 疑似代理的 IP 国家
	Rules             []NamedCount      `json:"rules"`              // 命中次数（不含提示级）
	Devices           []NamedCount      `json:"devices"`
	OS                []NamedCount      `json:"os"`
	Browsers          []NamedCount      `json:"browsers"`
	Languages         []NamedCount      `json:"languages"`
	TimeZones         []NamedCount      `json:"time_zones"`
	ColorSchemes      []NamedCount      `json:"color_schemes"`

	NewVisitors       int64                 `json:"new_visitors"`       // 首次访问在区间内的访客
	ReturningVisitors int64                 `json:"returning_visitors"` // 区间之前就来过的访客
	Engagement        VisitEngagementDto    `json:"engagement"`
	Posts             []VisitPostInsightDto `json:"posts"`     // 文章阅读表现，按浏览量排序
	Paths             []VisitPathCount      `json:"paths"`     // 站内跳转路径
	Outbound          []NamedCount          `json:"outbound"`  // 外链点击
	Downloads         []NamedCount          `json:"downloads"` // 文件下载
	Vitals            []WebVitalDto         `json:"vitals"`
	SlowPages         []VisitSlowPageDto    `json:"slow_pages"` // LCP 最慢的页面
}

// VisitEngagementDto 阅读参与度汇总（不含疑似自动化）
type VisitEngagementDto struct {
	Visits         int64        `json:"visits"`           // 收到参与度数据的访问
	AvgEngagedMs   int64        `json:"avg_engaged_ms"`   // 平均有效停留时长
	MedianEngaged  int64        `json:"median_engaged"`   // 有效停留时长中位数（毫秒）
	Completed      int64        `json:"completed"`        // 滚动深度达到 90% 的访问
	DepthBuckets   []NamedCount `json:"depth_buckets"`    // 滚动深度分布：0-25 / 25-50 / 50-75 / 75-90 / 90-100
	AvgScrollDepth int          `json:"avg_scroll_depth"` // 平均滚动深度
}

// VisitPostInsightDto 一篇文章在区间内的阅读表现
type VisitPostInsightDto struct {
	ID             uint    `json:"id"`
	Title          string  `json:"title"`
	Slug           *string `json:"slug"`
	IsPrivate      bool    `json:"is_private"` // 私密文章的链接指向后台预览
	Views          int64   `json:"views"`
	EngagedVisits  int64   `json:"engaged_visits"`   // 收到参与度数据的访问
	AvgEngagedMs   int64   `json:"avg_engaged_ms"`   // 平均有效停留时长
	AvgScrollDepth int     `json:"avg_scroll_depth"` // 平均滚动深度
	Completed      int64   `json:"completed"`        // 读到 90% 的访问
	Likes          int64   `json:"likes"`            // 区间内新增点赞
	Comments       int64   `json:"comments"`         // 区间内新增评论
	TopSource      string  `json:"top_source"`       // 主要外部来源，见 utils.ClassifyReferrer
	TopSourceHost  string  `json:"top_source_host"`
}

// VisitPathCount 站内跳转：从 from 页面进入 to 页面的次数
type VisitPathCount struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int64  `json:"count"`
}

// WebVitalDto 一项 Web Vitals 指标的 p75 与评级分布
type WebVitalDto struct {
	Name             string   `json:"name"` // LCP / INP / CLS / FCP / TTFB
	Samples          int64    `json:"samples"`
	P75              float64  `json:"p75"` // CLS 无单位，其余为毫秒
	Good             int64    `json:"good"`
	NeedsImprovement int64    `json:"needs_improvement"`
	Poor             int64    `json:"poor"`
	MobileP75        *float64 `json:"mobile_p75"` // 手机与平板
	DesktopP75       *float64 `json:"desktop_p75"`
}

// VisitSlowPageDto LCP p75 最慢的页面
type VisitSlowPageDto struct {
	Path    string  `json:"path"`
	P75     float64 `json:"p75"`
	Samples int64   `json:"samples"`
}

// PlausibleEvent 兼容 Plausible 事件接口（/api/event）的上报内容，字段名沿用其协议
// 见 https://plausible.io/docs/events-api 与 @plausible-analytics/tracker
type PlausibleEvent struct {
	Name        string         `json:"n"`  // pageview / engagement / 自定义事件名
	URL         string         `json:"u"`  // 页面地址
	Domain      string         `json:"d"`  // 站点域名
	Referrer    *string        `json:"r"`  // 来源页
	Props       map[string]any `json:"p"`  // 自定义属性
	ScrollDepth *int           `json:"sd"` // engagement：最大滚动深度（0-100）
	EngagedMs   *int64         `json:"e"`  // engagement：自上次上报以来的有效停留时长（毫秒）
}

type NamedCount struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// VisitTrendPoint 某一天（或某小时）各可信度结论的访问数
type VisitTrendPoint struct {
	Label  string           `json:"label"` // 日期 2006-01-02 或小时 0-23
	Counts map[string]int64 `json:"counts"`
}

// VisitCommentDto 互动记录中涉及的评论摘要
type VisitCommentDto struct {
	ID      uint   `json:"id"`
	Content string `json:"content"` // 截断后的评论内容
}

type VisitStatsDto struct {
	TodayPV         int64 `json:"today_pv"`
	TodayUV         int64 `json:"today_uv"`
	TodayUserVisits int64 `json:"today_user_visits"`
	TotalVisitors   int64 `json:"total_visitors"`
	// 今日访问来源排行（不含站内跳转）
	TodaySources []VisitSourceCount `json:"today_sources"`
}

type VisitSourceCount struct {
	Source string `json:"source"`
	Host   string `json:"host"` // 仅其他网站（external）按域名区分
	Count  int64  `json:"count"`
}
