package dto

import "time"

// CommentDto 评论；时间字段为 time.Time，按 RFC 3339 输出。不能用 time.Time.String()：
// 其时区缩写（如 CST）会被浏览器误解析，刚创建的评论时间还带单调时钟读数，前端会得到 Invalid Date
type CommentDto struct {
	ID             uint               `json:"id"`
	TargetID       uint               `json:"target_id"`
	TargetType     string             `json:"target_type"` // 目标类型，如 "post", "page"
	Content        string             `json:"content"`
	Language       string             `json:"language"` // 评论语言（AI 翻译时识别），未知时为空；与界面语言相同时前端不显示翻译按钮
	ReplyID        uint               `json:"reply_id"` // 回复的评论ID
	RootID         uint               `json:"root_id"`  // 线程根评论ID：通知深链据此定位整条线程
	Depth          int                `json:"depth"`    // 评论的层级深度
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
	User           UserDto            `json:"user"`        // 评论的
	ReplyCount     uint64             `json:"reply_count"` // 回复数量
	LikeCount      uint64             `json:"like_count"`  // 点赞数量
	IsLiked        bool               `json:"is_liked"`    // 当前用户是否点赞
	IsPrivate      bool               `json:"is_private"`
	Location       CommentLocationDto `json:"location"` // 用户地理位置
	OS             string             `json:"os"`       // 用户操作系统，基于User-Agent
	Browser        string             `json:"browser"`  // 用户浏览器，基于User-Agent
	ShowClientInfo bool               `json:"show_client_info"`
	// 附件按添加顺序展示在正文之后；已删除的文件不返回
	Attachments []CommentAttachmentDto `json:"attachments"`
	// MentionUserIDs 正文里被 @ 的用户 id，编辑评论时原样带回
	MentionUserIDs []uint `json:"mention_user_ids,omitempty"`
	// Mentions 被 @ 的人的当前用户名 / 昵称：正文里存的是评论当时的写法，
	// 渲染时以这里的 id 为准（用户改名后显示新名字，不会链到占用了旧名字的陌生人）
	Mentions []CommentMentionDto `json:"mentions,omitempty"`
	// 以下只在主评论列表中返回：整个回复线程（不限层级）中当前用户可见的回复数，以及最早回复的几位用户（去重），供折叠时展示
	ThreadCount uint64    `json:"thread_count,omitempty"`
	ThreadUsers []UserDto `json:"thread_users,omitempty"`
}

// CommentMentionDto 被 @ 的用户
type CommentMentionDto struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
}

// CommentAttachmentDto 评论附件：URL 为站内文件的稳定链接，返回时由中间件改写为直链
type CommentAttachmentDto struct {
	ID       uint   `json:"id"` // 文件 ID
	URL      string `json:"url"`
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
}

type CommentLocationDto struct {
	Country   string `json:"country"`
	Province  string `json:"province"`
	City      string `json:"city"`
	Districts string `json:"districts"`
	ISP       string `json:"isp"`
	IDC       string `json:"idc"`
}

type CreateCommentReq struct {
	TargetID       uint   `json:"target_id" binding:"required"`   // 目标ID
	TargetType     string `json:"target_type" binding:"required"` // 目标类型，如 "post", "page"
	Content        string `json:"content"`                        // 评论内容，没有附件时不能为空
	AttachmentIDs  []uint `json:"attachment_ids"`                 // 附件的文件 ID，最多 9 个
	MentionUserIDs []uint `json:"mention_user_ids"`               // 被 @ 的用户，最多 3 个；正文里仍写 @用户名
	ReplyID        uint   `json:"reply_id"`                       // 回复的评论ID
	IsPrivate      bool   `json:"is_private"`                     // 是否私密评论，默认false
	RemoteAddr     string // 远程地址
	UserAgent      string `header:"User-Agent"`     // 用户代理
	ShowClientInfo bool   `json:"show_client_info"` // 是否显示客户端信息
}

type UpdateCommentReq struct {
	ID             uint    `path:"id"`               // 评论ID
	Content        string  `json:"content"`          // 评论内容，没有附件时不能为空
	AttachmentIDs  *[]uint `json:"attachment_ids"`   // 附件的文件 ID，nil 不修改，空数组清空
	MentionUserIDs *[]uint `json:"mention_user_ids"` // 被 @ 的用户，nil 不修改，空数组清空
	IsPrivate      bool    `json:"is_private"`       // 是否私密
	ShowClientInfo bool    `json:"show_client_info"` // 是否显示客户端信息
}

type GetCommentListReq struct {
	PaginationParams
	TargetID   uint   `query:"target_id" binding:"required" vd:"$>0"`
	TargetType string `query:"target_type" binding:"required"`
	CommentID  uint   `query:"comment_id"`                  // 获取某条评论的所有子评论
	RootID     uint   `query:"root_id"`                     // 获取某条主评论下整个回复线程（不限层级，忽略 depth）
	Depth      *int   `query:"depth" default:"1" vd:"$>-1"` // 评论的层级深度
}

type ListUserCommentsReq struct {
	PaginationParams
	UserID uint `query:"user_id" binding:"required" vd:"$>0"` // 评论者的用户ID
}

// CommentTargetDto 评论所属的文章或页面，用于在用户主页展示标题与链接
type CommentTargetDto struct {
	ID        uint    `json:"id"`
	Type      string  `json:"type"` // "post" 或 "page"
	Title     string  `json:"title"`
	Slug      *string `json:"slug"`
	IsPrivate bool    `json:"is_private,omitempty"` // 是否私密：只在后台（仪表盘、访客记录）返回，后台据此把链接指向后台预览
}

// UserCommentDto 用户主页的评论条目，附带所属目标信息
type UserCommentDto struct {
	CommentDto
	Target CommentTargetDto `json:"target"`
}

type TranslateCommentReq struct {
	ID         uint   `path:"id"`                             // 评论ID
	TargetLang string `json:"target_lang" binding:"required"` // 目标语言（界面语言代码，如 zh、zh-tw、en、ja、ko）
	RemoteAddr string // 远程地址，用于未登录时限流
}

// CommentTranslationDto 评论的 AI 译文
type CommentTranslationDto struct {
	CommentID    uint   `json:"comment_id"`
	SourceLang   string `json:"source_lang"`   // AI 识别出的源语言
	TargetLang   string `json:"target_lang"`   // 目标语言
	Content      string `json:"content"`       // 译文；源语言与目标语言相同时为空
	SameLanguage bool   `json:"same_language"` // 评论已是目标语言，无需翻译
}
