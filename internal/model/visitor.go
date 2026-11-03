package model

import (
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// Visitor 访客：一个浏览器对应一条，通过 Cookie（VisitorKey）识别，Cookie 丢失时用指纹辅助找回
type Visitor struct {
	ID           uint   `gorm:"primaryKey"`
	VisitorKey   string `gorm:"type:varchar(64);uniqueIndex;not null"` // 种在浏览器 Cookie 中的随机ID
	Fingerprint  string `gorm:"type:varchar(64);index"`                // 浏览器指纹哈希
	UserID       *uint  `gorm:"index"`                                 // 最近一次登录的用户
	User         *User  `gorm:"constraint:OnDelete:SET NULL"`
	LastIP       string `gorm:"type:varchar(64)"`
	LastLocation string `gorm:"type:varchar(128)"`
	LastCountry  string `gorm:"type:varchar(8)"` // 最近一次访问的 IP 国家，用于发现 IP 国家突变
	OS           string `gorm:"type:varchar(32)"`
	Browser      string `gorm:"type:varchar(32)"`
	DeviceType   string `gorm:"type:varchar(16)"`
	VisitCount   int64
	CreatedAt    time.Time // 首次访问
	LastSeenAt   time.Time `gorm:"index"`
}

// VisitLog 访问记录：一次访问一条，保存当次的设备与位置快照
// 点赞、评论等站内互动也记在这里（Action 区分），与访问共用一条时间线
type VisitLog struct {
	ID        uint     `gorm:"primaryKey"`
	VisitorID *uint    `gorm:"index"` // 开启“请勿追踪”时为空；互动记录不关联访客
	Visitor   *Visitor `gorm:"constraint:OnDelete:SET NULL"`
	UserID    *uint    `gorm:"index"` // 访问者；互动记录中为执行互动的用户
	User      *User    `gorm:"constraint:OnDelete:SET NULL"`
	// 行为类型：visit / like / comment，见 constant.VisitAction*；升级前的旧记录由默认值补为 visit
	Action string `gorm:"type:varchar(16);default:visit;index"`
	// 访问：post / page / other；互动：post / page / comment（点赞或回复的评论）
	TargetType string `gorm:"type:varchar(16);index:idx_visit_logs_target"`
	TargetID   uint   `gorm:"index:idx_visit_logs_target"`
	CommentID  uint   `gorm:"index"` // 评论/回复时新发表的评论ID
	// 被互动内容（文章、页面、评论）的作者，便于展示与按作者筛选
	TargetUserID *uint  `gorm:"index"`
	TargetUser   *User  `gorm:"constraint:OnDelete:SET NULL"`
	Path         string `gorm:"type:varchar(512)"`
	Referrer     string `gorm:"type:varchar(512)"`
	// 来源分类：direct / internal / external / google、github 等常见来源，见 utils.ClassifyReferrer
	Source       string    `gorm:"type:varchar(32);index"`
	ReferrerHost string    `gorm:"type:varchar(255)"`
	IP           string    `gorm:"type:varchar(64)"`
	Location     string    `gorm:"type:varchar(128)"`
	UserAgent    string    `gorm:"type:text"`
	OS           string    `gorm:"type:varchar(32)"`
	Browser      string    `gorm:"type:varchar(32)"`
	DeviceType   string    `gorm:"type:varchar(16)"`
	CreatedAt    time.Time `gorm:"index"`

	// IP 归属地补充信息
	IPCountry   string `gorm:"type:varchar(8)"`  // 国家代码，港澳台单独区分
	ISP         string `gorm:"type:varchar(64)"` // 运营商
	Datacenter  bool   // 运营商属于机房 / 云服务商
	PrevCountry string `gorm:"type:varchar(8)"` // 该访客上一次访问的 IP 国家
	// 浏览器信号与请求头，开启请勿追踪时不保存
	HasSignals     bool
	TimeZone       string `gorm:"type:varchar(64)"`
	UTCOffset      *int   // 分钟，东正西负
	Languages      string `gorm:"type:varchar(128)"` // 逗号分隔
	Screen         string `gorm:"type:varchar(32)"`
	DPR            float64
	TouchPoints    *int
	Pointer        string `gorm:"type:varchar(8)"`
	ColorScheme    string `gorm:"type:varchar(8)"`
	Webdriver      bool
	AcceptLanguage string `gorm:"type:varchar(128)"`
	CHPlatform     string `gorm:"type:varchar(32)"`
	CHMobile       *bool
	CHBrands       string `gorm:"type:varchar(255)"`
	// 一致性检测结果，见 service.analyzeVisitTrust
	Trust           string `gorm:"type:varchar(16);default:'';index"`
	TrustScore      *int
	TrustFlags      string `gorm:"type:varchar(512)"` // 命中的规则：id:severity，逗号分隔，按严重度排序
	InferredCountry string `gorm:"type:varchar(8);index"`
	// 阅读参与度：由页面离开或切到后台时的 engagement 事件累计，未收到时为空
	EngagedMs   *int64 // 页面在前台且获得焦点的累计时长（毫秒）
	ScrollDepth *int   // 最大滚动深度（0-100）
}

// VisitEvent 页面内的行为与性能事件：外链点击、文件下载、Web Vitals
type VisitEvent struct {
	ID         uint   `gorm:"primaryKey"`
	VisitLogID *uint  `gorm:"index"` // 所在的那次访问，无法关联时为空
	VisitorID  *uint  `gorm:"index"`
	Name       string `gorm:"type:varchar(32);index:idx_visit_events_name_time"` // 见 constant.VisitEvent*
	Path       string `gorm:"type:varchar(512)"`
	Label      string `gorm:"type:varchar(512)"` // 外链 / 文件地址，或 Web Vitals 指标名
	Value      float64
	Rating     string    `gorm:"type:varchar(24)"` // Web Vitals 评级：good / needs-improvement / poor
	DeviceType string    `gorm:"type:varchar(16)"`
	CreatedAt  time.Time `gorm:"index:idx_visit_events_name_time"`
}

func (v *Visitor) ToDto() *dto.VisitorDto {
	result := &dto.VisitorDto{
		ID:          v.ID,
		IP:          v.LastIP,
		Location:    v.LastLocation,
		OS:          v.OS,
		Browser:     v.Browser,
		DeviceType:  v.DeviceType,
		VisitCount:  v.VisitCount,
		FirstSeenAt: v.CreatedAt,
		LastSeenAt:  v.LastSeenAt,
	}
	if v.User != nil {
		user := v.User.ToDto()
		result.User = &user
	}
	return result
}

func (l *VisitLog) ToDto() *dto.VisitLogDto {
	result := &dto.VisitLogDto{
		ID:         l.ID,
		VisitorID:  l.VisitorID,
		Action:     l.Action,
		TargetType: l.TargetType,
		TargetID:   l.TargetID,
		Path:       l.Path,
		Referrer:   l.Referrer,
		Source:     l.Source,
		SourceHost: l.ReferrerHost,
		IP:         l.IP,
		Location:   l.Location,
		OS:         l.OS,
		Browser:    l.Browser,
		DeviceType: l.DeviceType,
		CreatedAt:  l.CreatedAt,

		Trust:           l.Trust,
		TrustScore:      l.TrustScore,
		TrustFlags:      l.ParseTrustFlags(),
		IPCountry:       l.IPCountry,
		InferredCountry: l.InferredCountry,
		IPTrusted:       l.InferredCountry != "" && l.InferredCountry == l.IPCountry && !l.Datacenter,
		UTCOffset:       l.UTCOffset,
		EngagedMs:       l.EngagedMs,
		ScrollDepth:     l.ScrollDepth,
	}
	if langs := l.LanguageList(); len(langs) > 0 {
		result.Language = langs[0]
	}
	if l.User != nil {
		user := l.User.ToDto()
		result.User = &user
	}
	if l.TargetUser != nil {
		user := l.TargetUser.ToDto()
		result.TargetUser = &user
	}
	if l.Visitor != nil {
		result.VisitCount = l.Visitor.VisitCount
	}
	return result
}

// LanguageList 保存的浏览器语言列表
func (l *VisitLog) LanguageList() []string {
	if l.Languages == "" {
		return []string{}
	}
	return strings.Split(l.Languages, ",")
}

// ParseTrustFlags 解析命中的规则列表
func (l *VisitLog) ParseTrustFlags() []dto.VisitTrustFlagDto {
	flags := []dto.VisitTrustFlagDto{}
	if l.TrustFlags == "" {
		return flags
	}
	for _, item := range strings.Split(l.TrustFlags, ",") {
		id, severity, _ := strings.Cut(item, ":")
		flags = append(flags, dto.VisitTrustFlagDto{ID: id, Severity: severity})
	}
	return flags
}

// SignalsDto 后台详情展示的全部信号
func (l *VisitLog) SignalsDto() *dto.VisitSignalsDto {
	return &dto.VisitSignalsDto{
		HasSignals:     l.HasSignals,
		UserAgent:      l.UserAgent,
		AcceptLanguage: l.AcceptLanguage,
		CHPlatform:     l.CHPlatform,
		CHMobile:       l.CHMobile,
		CHBrands:       l.CHBrands,
		ISP:            l.ISP,
		Datacenter:     l.Datacenter,
		PrevCountry:    l.PrevCountry,
		TimeZone:       l.TimeZone,
		UTCOffset:      l.UTCOffset,
		Languages:      l.LanguageList(),
		Screen:         l.Screen,
		DPR:            l.DPR,
		TouchPoints:    l.TouchPoints,
		Pointer:        l.Pointer,
		ColorScheme:    l.ColorScheme,
		Webdriver:      l.Webdriver,
	}
}
