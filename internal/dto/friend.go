package dto

import "time"

// FriendGroupPublicDto 前台与公开接口返回的友链分组（不含内部巡检配置）
type FriendGroupPublicDto struct {
	ID          uint                  `json:"id"`
	PresetKey   string                `json:"preset_key"`
	Name        string                `json:"name"`
	Slug        string                `json:"slug"`
	Description string                `json:"description"`
	SortOrder   int                   `json:"sort_order"`
	Links       []FriendLinkPublicDto `json:"links"`
}

// FriendGroupAdminDto 后台管理分组 DTO
type FriendGroupAdminDto struct {
	ID                uint      `json:"id"`
	PresetKey         string    `json:"preset_key"`
	Name              string    `json:"name"`
	Slug              string    `json:"slug"`
	Description       string    `json:"description"`
	SortOrder         int       `json:"sort_order"`
	IsPublic          bool      `json:"is_public"`
	SkipBacklinkCheck bool      `json:"skip_backlink_check"`
	LinkCount         int64     `json:"link_count"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// FriendLinkPublicDto 前台公开展示的友链（物理隔离审核备注、反链状态、提交人等内部字段）
type FriendLinkPublicDto struct {
	ID           uint   `json:"id"`
	GroupID      uint   `json:"group_id"`
	Name         string `json:"name"`
	URL          string `json:"url"`
	Avatar       string `json:"avatar"`
	AvatarURL    string `json:"avatar_url"`
	Description  string `json:"description"`
	ColorKey     string `json:"color_key"`
	SortOrder    int    `json:"sort_order"`
	HealthStatus string `json:"health_status"`
	LatencyMs    int    `json:"latency_ms"`
}

// FriendLinkMineDto 登录用户查看名下友链 DTO（可见本人审核状态与反馈原因，不含后台反链内部标记）
type FriendLinkMineDto struct {
	ID           uint      `json:"id"`
	GroupID      uint      `json:"group_id"`
	Name         string    `json:"name"`
	URL          string    `json:"url"`
	Avatar       string    `json:"avatar"`
	AvatarURL    string    `json:"avatar_url"`
	Description  string    `json:"description"`
	ColorKey     string    `json:"color_key"`
	BacklinkURL  string    `json:"backlink_url"`
	Status       string    `json:"status"`
	ReviewNote   string    `json:"review_note"`
	HealthStatus string    `json:"health_status"`
	LatencyMs    int       `json:"latency_ms"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// FriendLinkAdminDto 管理员后台查看的全量友链 DTO
type FriendLinkAdminDto struct {
	ID             uint           `json:"id"`
	UserID         uint           `json:"user_id"`
	User           *PublicUserDto `json:"user,omitempty"`
	GroupID        uint           `json:"group_id"`
	Name           string         `json:"name"`
	URL            string         `json:"url"`
	Avatar         string         `json:"avatar"`
	AvatarURL      string         `json:"avatar_url"`
	Description    string         `json:"description"`
	ColorKey       string         `json:"color_key"`
	BacklinkURL    string         `json:"backlink_url"`
	SortOrder      int            `json:"sort_order"`
	Status         string         `json:"status"`
	ReviewNote     string         `json:"review_note"`
	HealthStatus   string         `json:"health_status"`
	LatencyMs      int            `json:"latency_ms"`
	FailCount      int            `json:"fail_count"`
	BacklinkStatus string         `json:"backlink_status"`
	LastCheckedAt  *time.Time     `json:"last_checked_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// FriendSiteCardDto 本站友链名片信息（供博友一键复制）
type FriendSiteCardDto struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Avatar      string `json:"avatar"`
	Description string `json:"description"`
}

// PublicFriendsResp 前台 / 跨站开放接口返回结构
type PublicFriendsResp struct {
	Groups   []FriendGroupPublicDto `json:"groups"`
	SiteInfo FriendSiteCardDto      `json:"site_info"`
}

// MyFriendLinksResp 当前登录用户的友链列表与当日剩余配额
type MyFriendLinksResp struct {
	Links             []FriendLinkMineDto `json:"links"`
	QuotaLimit        int                 `json:"quota_limit"`
	AutofillRemaining int                 `json:"autofill_remaining"`
	AutofillLimit     int                 `json:"autofill_limit"`
	AIReviewRemaining int                 `json:"ai_review_remaining"`
	AIReviewLimit     int                 `json:"ai_review_limit"`
}

// FriendAutofillReq AI 自动填表请求
type FriendAutofillReq struct {
	URL string `json:"url"`
}

// FriendAutofillResp AI 自动填表结果
type FriendAutofillResp struct {
	Name              string `json:"name"`
	URL               string `json:"url"`
	Avatar            string `json:"avatar"`
	Description       string `json:"description"`
	ColorKey          string `json:"color_key"`
	AutofillRemaining int    `json:"autofill_remaining"`
}

// UpsertMyFriendLinkReq 普通用户新增或修改名下友链请求
type UpsertMyFriendLinkReq struct {
	GroupID     uint   `json:"group_id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Avatar      string `json:"avatar"`
	Description string `json:"description"`
	ColorKey    string `json:"color_key"`
	BacklinkURL string `json:"backlink_url"`
}

// AdminUpsertFriendGroupReq 管理员新增或更新友链分组请求
type AdminUpsertFriendGroupReq struct {
	PresetKey         string `json:"preset_key"`
	Name              string `json:"name"`
	Slug              string `json:"slug"`
	Description       string `json:"description"`
	SortOrder         int    `json:"sort_order"`
	IsPublic          bool   `json:"is_public"`
	SkipBacklinkCheck bool   `json:"skip_backlink_check"`
}

// AdminReorderFriendGroupsReq 管理员批量调整分组顺序请求
type AdminReorderFriendGroupsReq struct {
	IDs []uint `json:"ids"`
}

// AdminListFriendLinksReq 后台筛选友链请求
type AdminListFriendLinksReq struct {
	Page     int    `query:"page"`
	PageSize int    `query:"page_size"`
	Status   string `query:"status"`
	GroupID  uint   `query:"group_id"`
	Keyword  string `query:"keyword"`
}

// AdminListFriendLinksResp 后台友链分页结果
type AdminListFriendLinksResp struct {
	Links              []FriendLinkAdminDto `json:"links"`
	Total              int64                `json:"total"`
	PendingReviewCount int64                `json:"pending_review_count"`
}

// AdminUpsertFriendLinkReq 管理员直接新增或完整编辑友链请求
type AdminUpsertFriendLinkReq struct {
	GroupID     uint   `json:"group_id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Avatar      string `json:"avatar"`
	Description string `json:"description"`
	ColorKey    string `json:"color_key"`
	BacklinkURL string `json:"backlink_url"`
	SortOrder   int    `json:"sort_order"`
	Status      string `json:"status"`
	ReviewNote  string `json:"review_note"`
}

// AdminReviewFriendLinkReq 管理员快捷审核友链请求
type AdminReviewFriendLinkReq struct {
	Status     string `json:"status"`
	GroupID    *uint  `json:"group_id"`
	ReviewNote string `json:"review_note"`
}

// AdminTransferFriendLinkReq 管理员转移友链归属用户请求（UserID=0 表示收回为站长托管）
type AdminTransferFriendLinkReq struct {
	UserID uint `json:"user_id"`
}
