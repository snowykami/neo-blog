package model

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 友链预设分组键（与前端 i18n Friends.presets.* 一一对应；custom 表示使用自定义名称）
const (
	FriendGroupPresetFriends  = "friends"
	FriendGroupPresetSeniors  = "seniors"
	FriendGroupPresetOfficial = "official"
	FriendGroupPresetProjects = "projects"
	FriendGroupPresetTech     = "tech"
	FriendGroupPresetOthers   = "others"
	FriendGroupPresetCustom   = "custom"
)

var FriendGroupPresets = []string{
	FriendGroupPresetFriends,
	FriendGroupPresetSeniors,
	FriendGroupPresetOfficial,
	FriendGroupPresetProjects,
	FriendGroupPresetTech,
	FriendGroupPresetOthers,
	FriendGroupPresetCustom,
}

func NormalizeFriendGroupPreset(raw string) string {
	v := strings.TrimSpace(strings.ToLower(raw))
	if slices.Contains(FriendGroupPresets, v) {
		return v
	}
	return FriendGroupPresetCustom
}

// 友链审核状态
const (
	FriendStatusPending     = "pending"      // AI 审核中
	FriendStatusPreApproved = "pre_approved" // 预通过（待管理员人工复核）
	FriendStatusApproved    = "approved"     // 已公开展示
	FriendStatusRejected    = "rejected"     // 已驳回
)

var FriendStatuses = []string{
	FriendStatusPending,
	FriendStatusPreApproved,
	FriendStatusApproved,
	FriendStatusRejected,
}

// 友链拨测健康状态与反链检查状态
const (
	FriendHealthUnknown     = "unknown"
	FriendHealthHealthy     = "healthy"
	FriendHealthSlow        = "slow"
	FriendHealthUnreachable = "unreachable"

	FriendBacklinkUnchecked = "unchecked"
	FriendBacklinkVerified  = "verified"
	FriendBacklinkMissing   = "missing"
	FriendBacklinkSkipped   = "skipped"

	// 友链前台展示排序方式
	FriendSortModeManual   = "manual"   // 手动默认排序：按各分组内拖拽调整的 sort_order 升序展示
	FriendSortModeActivity = "activity" // 更新频次排序：预留接入友链 RSS 聚合后按最近发文活跃度排序
)

var FriendSortModes = []string{
	FriendSortModeManual,
	FriendSortModeActivity,
}

func NormalizeFriendSortMode(raw string) string {
	v := strings.TrimSpace(strings.ToLower(raw))
	if slices.Contains(FriendSortModes, v) {
		return v
	}
	return FriendSortModeManual
}

// FriendColorKeys 32 色全色域预设语义色板键（与前端 LYRIC_COLORS / FRIEND_PALETTE_32 保持 1:1 对齐）
var FriendColorKeys = []string{
	"crimson", "rose", "cherry-blossom", "bauhinia", "peach",
	"flame", "maple", "sunset", "coral", "amber",
	"gold", "sunshine", "lemon", "candlelight",
	"spring-green", "forest", "mint", "jade", "aurora",
	"lake", "sky", "ocean", "starry-blue", "midnight", "ice", "rain",
	"lavender", "violet", "twilight", "wisteria",
	"moonlight", "silver",
}

const DefaultFriendColorKey = "sky"

func NormalizeFriendColorKey(raw string) string {
	v := strings.TrimSpace(strings.ToLower(raw))
	if slices.Contains(FriendColorKeys, v) {
		return v
	}
	return DefaultFriendColorKey
}

// FriendGroup 友链分组（见 docs/friend-links-spec.md 3.1）
type FriendGroup struct {
	ID                uint `gorm:"primarykey"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
	PresetKey         string `gorm:"type:varchar(32);not null;default:'custom'"`
	Name              string `gorm:"type:varchar(64);not null;default:''"`
	Slug              string `gorm:"type:varchar(64);uniqueIndex;not null"`
	Description       string `gorm:"type:varchar(255);not null;default:''"`
	SortOrder         int    `gorm:"not null;default:0;index"`
	IsPublic          bool   `gorm:"not null"`
	SkipBacklinkCheck bool   `gorm:"not null;default:false"`
}

func (g *FriendGroup) ToPublicDto(links []dto.FriendLinkPublicDto) dto.FriendGroupPublicDto {
	if links == nil {
		links = []dto.FriendLinkPublicDto{}
	}
	return dto.FriendGroupPublicDto{
		ID:          g.ID,
		PresetKey:   NormalizeFriendGroupPreset(g.PresetKey),
		Name:        g.Name,
		Slug:        g.Slug,
		Description: g.Description,
		SortOrder:   g.SortOrder,
		Links:       links,
	}
}

func (g *FriendGroup) ToAdminDto(linkCount int64) dto.FriendGroupAdminDto {
	return dto.FriendGroupAdminDto{
		ID:                g.ID,
		PresetKey:         NormalizeFriendGroupPreset(g.PresetKey),
		Name:              g.Name,
		Slug:              g.Slug,
		Description:       g.Description,
		SortOrder:         g.SortOrder,
		IsPublic:          g.IsPublic,
		SkipBacklinkCheck: g.SkipBacklinkCheck,
		LinkCount:         linkCount,
		CreatedAt:         g.CreatedAt,
		UpdatedAt:         g.UpdatedAt,
	}
}

// DefaultFriendGroups 首次初始化时写入的预设国际化分组
var DefaultFriendGroups = []FriendGroup{
	{PresetKey: FriendGroupPresetFriends, Slug: "friends", SortOrder: 10, IsPublic: true, SkipBacklinkCheck: false},
	{PresetKey: FriendGroupPresetSeniors, Slug: "seniors", SortOrder: 20, IsPublic: true, SkipBacklinkCheck: true},
	{PresetKey: FriendGroupPresetOfficial, Slug: "official", SortOrder: 30, IsPublic: true, SkipBacklinkCheck: true},
	{PresetKey: FriendGroupPresetProjects, Slug: "projects", SortOrder: 40, IsPublic: true, SkipBacklinkCheck: false},
	{PresetKey: FriendGroupPresetOthers, Slug: "others", SortOrder: 50, IsPublic: true, SkipBacklinkCheck: false},
}

// FriendLink 友链主表（见 docs/friend-links-spec.md 3.2）
type FriendLink struct {
	ID             uint      `gorm:"primarykey"`
	CreatedAt      time.Time `gorm:"index"`
	UpdatedAt      time.Time
	UserID         *uint  `gorm:"index"`
	User           *User  `gorm:"constraint:OnDelete:SET NULL"`
	GroupID        uint   `gorm:"not null;index"`
	Name           string `gorm:"type:varchar(64);not null"`
	URL            string `gorm:"type:varchar(512);not null"`
	NormalizedHost string `gorm:"type:varchar(255);uniqueIndex;not null"`
	Avatar         string `gorm:"type:varchar(512);not null;default:''"`
	Description    string `gorm:"type:varchar(200);not null;default:''"`
	ColorKey       string `gorm:"type:varchar(32);not null;default:'sky'"`
	RSSURL         string `gorm:"column:rss_url;type:varchar(512);not null;default:''"`
	BacklinkURL    string `gorm:"type:varchar(512);not null;default:''"`
	SortOrder      int    `gorm:"not null;default:0"`
	Status         string `gorm:"type:varchar(16);not null;default:'pending';index"`
	ReviewNote     string `gorm:"type:varchar(500);not null;default:''"`
	HealthStatus   string `gorm:"type:varchar(16);not null;default:'unknown'"`
	LatencyMs      int    `gorm:"not null;default:0"`
	FailCount      int    `gorm:"not null;default:0"`
	BacklinkStatus string `gorm:"type:varchar(16);not null;default:'unchecked'"`
	LastCheckedAt  *time.Time
}

// IsSafeInternalAvatarPath 校验是否为安全的站内头像相对路径（严格防 // 与 /\ 开放重定向、路径穿越及控制字符）
func IsSafeInternalAvatarPath(raw string) bool {
	if len(raw) < 2 || len(raw) > 512 || raw[0] != '/' || raw[1] == '/' {
		return false
	}
	if strings.ContainsAny(raw, "\\ \t\r\n") || strings.Contains(raw, "..") {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] < 0x20 || raw[i] == 0x7f {
			return false
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || !strings.HasPrefix(u.Path, "/") {
		return false
	}
	return strings.HasPrefix(u.Path, "/api/v1/file/f/") || u.Path == "/api/site-icon"
}

func isExternalSVGAvatarURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return strings.HasSuffix(strings.ToLower(u.Path), ".svg")
}

// FriendAvatarHash 计算原始头像 URL 的 16 位小写十六进制短指纹，用于构造缓存路径
func FriendAvatarHash(rawAvatar string) string {
	trimmed := strings.TrimSpace(rawAvatar)
	if trimmed == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(trimmed))
	return hex.EncodeToString(sum[:8])
}

// AvatarCacheURL 返回前端渲染使用的站内头像缩略图缓存路径；站内文件与外站 .svg 保持直连
func (l *FriendLink) AvatarCacheURL() string {
	trimmed := strings.TrimSpace(l.Avatar)
	if trimmed == "" || l.ID == 0 {
		return ""
	}
	if IsSafeInternalAvatarPath(trimmed) || isExternalSVGAvatarURL(trimmed) {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "/") {
		return ""
	}
	return fmt.Sprintf("/api/v1/friends/avatar/%d/%s", l.ID, FriendAvatarHash(trimmed))
}

func (l *FriendLink) ToPublicDto() dto.FriendLinkPublicDto {
	return dto.FriendLinkPublicDto{
		ID:           l.ID,
		GroupID:      l.GroupID,
		Name:         l.Name,
		URL:          l.URL,
		Avatar:       l.Avatar,
		AvatarURL:    l.AvatarCacheURL(),
		Description:  l.Description,
		ColorKey:     NormalizeFriendColorKey(l.ColorKey),
		RSSURL:       l.RSSURL,
		SortOrder:    l.SortOrder,
		HealthStatus: l.HealthStatus,
		LatencyMs:    l.LatencyMs,
	}
}

func (l *FriendLink) ToMineDto() dto.FriendLinkMineDto {
	return dto.FriendLinkMineDto{
		ID:           l.ID,
		GroupID:      l.GroupID,
		Name:         l.Name,
		URL:          l.URL,
		Avatar:       l.Avatar,
		AvatarURL:    l.AvatarCacheURL(),
		Description:  l.Description,
		ColorKey:     NormalizeFriendColorKey(l.ColorKey),
		RSSURL:       l.RSSURL,
		BacklinkURL:  l.BacklinkURL,
		Status:       l.Status,
		ReviewNote:   l.ReviewNote,
		HealthStatus: l.HealthStatus,
		LatencyMs:    l.LatencyMs,
		CreatedAt:    l.CreatedAt,
		UpdatedAt:    l.UpdatedAt,
	}
}

// OwnerUserID 返回归属用户 ID；站长托管（UserID 为 nil）时返回 0
func (l *FriendLink) OwnerUserID() uint {
	if l.UserID == nil {
		return 0
	}
	return *l.UserID
}

func (l *FriendLink) ToAdminDto() dto.FriendLinkAdminDto {
	var userDto *dto.PublicUserDto
	if l.User != nil && l.User.ID != 0 {
		u := l.User.ToPublicDto()
		userDto = &u
	}
	return dto.FriendLinkAdminDto{
		ID:             l.ID,
		UserID:         l.OwnerUserID(),
		User:           userDto,
		GroupID:        l.GroupID,
		Name:           l.Name,
		URL:            l.URL,
		Avatar:         l.Avatar,
		AvatarURL:      l.AvatarCacheURL(),
		Description:    l.Description,
		ColorKey:       NormalizeFriendColorKey(l.ColorKey),
		RSSURL:         l.RSSURL,
		BacklinkURL:    l.BacklinkURL,
		SortOrder:      l.SortOrder,
		Status:         l.Status,
		ReviewNote:     l.ReviewNote,
		HealthStatus:   l.HealthStatus,
		LatencyMs:      l.LatencyMs,
		FailCount:      l.FailCount,
		BacklinkStatus: l.BacklinkStatus,
		LastCheckedAt:  l.LastCheckedAt,
		CreatedAt:      l.CreatedAt,
		UpdatedAt:      l.UpdatedAt,
	}
}
