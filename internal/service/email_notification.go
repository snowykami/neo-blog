package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/static"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 通知汇总邮件的文案：语言跟收件人的 user.Language（不是站点默认语言），
// 列表项与站内列表共用同一套变量（见 docs/notification-spec.md 15.2）

// notificationEmailTexts 一种语言的汇总邮件文案，{actor} 等占位符由 renderNotificationText 填入
type notificationEmailTexts struct {
	heading        string
	summary        string // {interval} {count}
	cta            string
	attachedLabel  string
	settingsLabel  string
	sentBy         string
	multiSubject   string            // {count} {site}
	subjects       map[string]string // 单条邮件的主题，{actor} {site}
	lists          map[string]string // 列表项，{actor} {subject} {excerpt} {quoted}
	deletedSubject string            // 标题快照为空时的降级文案
	unknownActor   string            // 作者资料读不到时的降级称呼（不能把「—」写进句子）
	moreItems      string            // {count}
	attachedLikes  string            // {count}
	attachedReply  string            // {count}
	attachedAI     string
}

var notificationEmailTextsByLanguage = map[string]notificationEmailTexts{
	"zh": {
		deletedSubject: "（内容已删除）",
		unknownActor:   "有人",
		heading:        "你有新的互动",
		summary:        "过去 {interval} 有 {count} 条新互动",
		cta:            "在站内查看全部",
		attachedLabel:  "另外",
		settingsLabel:  "通知设置",
		sentBy:         "本邮件由站点自动发送，请勿直接回复。也可以在上面的链接里调整或关闭通知邮件。",
		multiSubject:   "你有 {count} 条新互动 · {site}",
		subjects: map[string]string{
			"comment.created":      "{actor} 评论了你的文章 · {site}",
			"comment.created.page": "{actor} 评论了你的页面 · {site}",
			"comment.replied":      "{actor} 回复了你的评论 · {site}",
			"comment.mentioned":    "{actor} 在评论里 @ 了你 · {site}",
		},
		lists: map[string]string{
			"comment.created":      "{actor} 评论了你的文章《{subject}》：{excerpt}",
			"comment.created.page": "{actor} 评论了你的页面《{subject}》：{excerpt}",
			"comment.replied":      "{actor} 回复了你在《{subject}》下的评论「{quoted}」：{excerpt}",
			"comment.mentioned":    "{actor} 在《{subject}》的评论里 @ 了你：{excerpt}",
		},
		moreItems:     "还有 {count} 条，去站内查看",
		attachedLikes: "另有 {count} 个赞",
		attachedReply: "另有 {count} 条线程回复",
		attachedAI:    "AI 助手 也回复了你",
	},
	"zh-tw": {
		deletedSubject: "（內容已刪除）",
		unknownActor:   "有人",
		heading:        "你有新的互動",
		summary:        "過去 {interval} 有 {count} 則新互動",
		cta:            "在站內查看全部",
		attachedLabel:  "另外",
		settingsLabel:  "通知設定",
		sentBy:         "本郵件由網站自動寄出，請勿直接回覆。也可以在上面的連結裡調整或關閉通知郵件。",
		multiSubject:   "你有 {count} 則新互動 · {site}",
		subjects: map[string]string{
			"comment.created":      "{actor} 留言了你的文章 · {site}",
			"comment.created.page": "{actor} 留言了你的頁面 · {site}",
			"comment.replied":      "{actor} 回覆了你的留言 · {site}",
			"comment.mentioned":    "{actor} 在留言裡 @ 了你 · {site}",
		},
		lists: map[string]string{
			"comment.created":      "{actor} 留言了你的文章《{subject}》：{excerpt}",
			"comment.created.page": "{actor} 留言了你的頁面《{subject}》：{excerpt}",
			"comment.replied":      "{actor} 回覆了你在《{subject}》下的留言「{quoted}」：{excerpt}",
			"comment.mentioned":    "{actor} 在《{subject}》的留言裡 @ 了你：{excerpt}",
		},
		moreItems:     "還有 {count} 則，去站內查看",
		attachedLikes: "另有 {count} 個讚",
		attachedReply: "另有 {count} 則討論串回覆",
		attachedAI:    "AI 助手 也回覆了你",
	},
	"en": {
		deletedSubject: "(deleted)",
		unknownActor:   "Someone",
		heading:        "You have new activity",
		summary:        "{count} new interactions in the last {interval}",
		cta:            "View all on the site",
		attachedLabel:  "Also",
		settingsLabel:  "Notification settings",
		sentBy:         "This email was sent automatically. You can adjust or turn off notification emails from the link above.",
		multiSubject:   "You have {count} new interactions · {site}",
		subjects: map[string]string{
			"comment.created":      "{actor} commented on your post · {site}",
			"comment.created.page": "{actor} commented on your page · {site}",
			"comment.replied":      "{actor} replied to your comment · {site}",
			"comment.mentioned":    "{actor} mentioned you in a comment · {site}",
		},
		lists: map[string]string{
			"comment.created":      "{actor} commented on your post \u201c{subject}\u201d: {excerpt}",
			"comment.created.page": "{actor} commented on your page \u201c{subject}\u201d: {excerpt}",
			"comment.replied":      "{actor} replied to your comment on \u201c{subject}\u201d: {excerpt}",
			"comment.mentioned":    "{actor} mentioned you in a comment on \u201c{subject}\u201d: {excerpt}",
		},
		moreItems:     "{count} more — view them on the site",
		attachedLikes: "{count} more likes",
		attachedReply: "{count} more thread replies",
		attachedAI:    "An AI assistant also replied to you",
	},
	"ja": {
		deletedSubject: "（削除済み）",
		unknownActor:   "誰か",
		heading:        "新しい動きがあります",
		summary:        "過去 {interval} に {count} 件の新しい動きがありました",
		cta:            "サイトで確認する",
		attachedLabel:  "ほか",
		settingsLabel:  "通知設定",
		sentBy:         "このメールは自動送信です。上のリンクから通知メールの設定を変更できます。",
		multiSubject:   "{count} 件の新しい動き · {site}",
		subjects: map[string]string{
			"comment.created":      "{actor} が記事にコメントしました · {site}",
			"comment.created.page": "{actor} がページにコメントしました · {site}",
			"comment.replied":      "{actor} があなたのコメントに返信しました · {site}",
			"comment.mentioned":    "{actor} がコメントであなたを @ しました · {site}",
		},
		lists: map[string]string{
			"comment.created":      "{actor} が記事「{subject}」にコメントしました：{excerpt}",
			"comment.created.page": "{actor} がページ「{subject}」にコメントしました：{excerpt}",
			"comment.replied":      "{actor} が「{subject}」のあなたのコメントに返信しました：{excerpt}",
			"comment.mentioned":    "{actor} が「{subject}」のコメントであなたを @ しました：{excerpt}",
		},
		moreItems:     "ほか {count} 件はサイトで確認できます",
		attachedLikes: "ほかに {count} 件のいいね",
		attachedReply: "ほかに {count} 件のスレッド返信",
		attachedAI:    "AI アシスタントもあなたに返信しました",
	},
	"ko": {
		deletedSubject: "(삭제됨)",
		unknownActor:   "누군가",
		heading:        "새로운 활동이 있습니다",
		summary:        "지난 {interval} 동안 새 활동 {count}건",
		cta:            "사이트에서 모두 보기",
		attachedLabel:  "그 외",
		settingsLabel:  "알림 설정",
		sentBy:         "이 메일은 자동으로 발송되었습니다. 위 링크에서 알림 메일 설정을 변경할 수 있습니다.",
		multiSubject:   "새 활동 {count}건 · {site}",
		subjects: map[string]string{
			"comment.created":      "{actor} 님이 글에 댓글을 남겼습니다 · {site}",
			"comment.created.page": "{actor} 님이 페이지에 댓글을 남겼습니다 · {site}",
			"comment.replied":      "{actor} 님이 내 댓글에 답글을 남겼습니다 · {site}",
			"comment.mentioned":    "{actor} 님이 댓글에서 나를 @했습니다 · {site}",
		},
		lists: map[string]string{
			"comment.created":      "{actor} 님이 글 \u201c{subject}\u201d에 댓글을 남겼습니다: {excerpt}",
			"comment.created.page": "{actor} 님이 페이지 \u201c{subject}\u201d에 댓글을 남겼습니다: {excerpt}",
			"comment.replied":      "{actor} 님이 \u201c{subject}\u201d의 내 댓글에 답글을 남겼습니다: {excerpt}",
			"comment.mentioned":    "{actor} 님이 \u201c{subject}\u201d 댓글에서 나를 @했습니다: {excerpt}",
		},
		moreItems:     "{count}건 더 있습니다. 사이트에서 확인하세요",
		attachedLikes: "좋아요 {count}건 더",
		attachedReply: "스레드 답글 {count}건 더",
		attachedAI:    "AI 어시스턴트도 답글을 남겼습니다",
	},
}

// notificationEmailTextsForLanguage 取收件人语言的文案：zh / zh-tw / en / ja / ko，其余按英文
func notificationEmailTextsForLanguage(language string) notificationEmailTexts {
	code := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(language, "_", "-")))
	switch {
	case code == "":
		return notificationEmailTextsByLanguage["en"]
	case strings.HasPrefix(code, "zh"):
		if strings.Contains(code, "tw") || strings.Contains(code, "hk") || strings.Contains(code, "mo") || strings.Contains(code, "hant") {
			return notificationEmailTextsByLanguage["zh-tw"]
		}
		return notificationEmailTextsByLanguage["zh"]
	case strings.HasPrefix(code, "ja"):
		return notificationEmailTextsByLanguage["ja"]
	case strings.HasPrefix(code, "ko"):
		return notificationEmailTextsByLanguage["ko"]
	default:
		return notificationEmailTextsByLanguage["en"]
	}
}

// renderNotificationText 用命名占位符填文案，缺的变量留空，避免把 {actor} 原样发出去
func renderNotificationText(tpl string, vars map[string]string) string {
	replacer := make([]string, 0, len(vars)*2)
	for key, value := range vars {
		replacer = append(replacer, "{"+key+"}", value)
	}
	return strings.NewReplacer(replacer...).Replace(tpl)
}

// notificationEmailItem 汇总邮件列表里的一条
type notificationEmailItem struct {
	ActorName    string
	ActorAvatar  string
	ActorInitial string
	Text         string
	URL          string
	Time         string
}

// notificationEmailData 汇总邮件模板（internal/static/assets/email/notification.tmpl）的占位内容
type notificationEmailData struct {
	Lang          string
	Preheader     string
	SiteName      string
	SiteURL       string
	SiteIcon      string
	Heading       string
	Summary       string
	CTALabel      string
	InboxURL      string
	Items         []notificationEmailItem
	MoreItems     string
	AttachedLabel string
	AttachedLines []string
	FooterNote    string
	SettingsURL   string
	SettingsLabel string
	SentBy        string
}

// NotificationEmailContent 一封汇总邮件的主题与正文
type NotificationEmailContent struct {
	Subject string
	HTML    string
}

// NotificationEmailInput 渲染一封汇总邮件需要的数据：一个收件人一批到期的通知
type NotificationEmailInput struct {
	Recipient    *model.User
	Important    []model.Notification // 主列表，最多 notification_email_max_items 条
	ImportantAll int                  // 到期的重要通知总数，用于「还有 N 条」与主题计数
	Interval     time.Duration        // 这一批攒了多久
	Attached     []string             // 「另外」分区的成品文案
	SettingsURL  string               // 带 token 的通知设置链接
	Now          time.Time
}

// RenderNotificationEmail 渲染汇总邮件：主题里的条数只数重要项，附带项不上主题（见 15.2）
func RenderNotificationEmail(input *NotificationEmailInput) (*NotificationEmailContent, error) {
	texts := notificationEmailTextsForLanguage(input.Recipient.Language)
	vars := func(n *model.Notification) map[string]string {
		return map[string]string{
			"actor":   notificationActorDisplay(n, texts.unknownActor),
			"subject": notificationSubjectText(texts, n),
			"excerpt": NotificationSummary(n.Excerpt, notificationExcerptMaxRunes),
			"quoted":  NotificationSummary(n.QuotedExcerpt, notificationQuotedMaxRunes),
		}
	}

	items := make([]notificationEmailItem, 0, len(input.Important))
	for i := range input.Important {
		n := &input.Important[i]
		tpl := notificationItemTemplate(texts, n)
		items = append(items, notificationEmailItem{
			ActorName:    notificationActorDisplay(n, texts.unknownActor),
			ActorAvatar:  n.Actor.AvatarUrl,
			ActorInitial: notificationActorInitial(n, texts.unknownActor),
			Text:         renderNotificationText(tpl, vars(n)),
			URL:          notificationDeepLink(n),
			Time:         notificationTimeText(n.CreatedAt, input.Recipient.TimeZone, input.Now),
		})
	}

	data := notificationEmailData{
		Lang:          input.Recipient.Language,
		SiteName:      tools.GetSiteName(),
		SiteURL:       tools.GetBaseUrl(),
		SiteIcon:      tools.GetSiteIcon(),
		Heading:       texts.heading,
		Summary:       renderNotificationText(texts.summary, map[string]string{"count": fmt.Sprintf("%d", max(input.ImportantAll, len(items))), "interval": notificationIntervalText(input.Interval)}),
		CTALabel:      texts.cta,
		InboxURL:      tools.GetBaseUrl() + "/notifications",
		Items:         items,
		AttachedLabel: texts.attachedLabel,
		AttachedLines: input.Attached,
		FooterNote:    config.String("owner_name"),
		SettingsURL:   input.SettingsURL,
		SettingsLabel: texts.settingsLabel,
		SentBy:        texts.sentBy,
	}
	if remaining := input.ImportantAll - len(items); remaining > 0 {
		data.MoreItems = renderNotificationText(texts.moreItems, map[string]string{"count": fmt.Sprintf("%d", remaining)})
	}
	count := max(input.ImportantAll, len(items))
	subject := renderNotificationText(texts.multiSubject, map[string]string{"count": fmt.Sprintf("%d", count), "site": data.SiteName})
	if len(input.Important) == 1 && count == 1 {
		subject = renderNotificationText(notificationSubjectTemplate(texts, &input.Important[0]), map[string]string{
			"actor": notificationActorDisplay(&input.Important[0], texts.unknownActor),
			"site":  data.SiteName,
		})
	}
	data.Preheader = subject

	html, err := static.RenderTemplate("email/notification.tmpl", data)
	if err != nil {
		return nil, err
	}
	return &NotificationEmailContent{Subject: subject, HTML: html}, nil
}

// NotificationAttachedSummary 「另外」分区的文字：点赞折成一句，AI 互动与线程活动各占一行
func NotificationAttachedSummary(recipientLanguage string, likes, threadReplies int, hasAI bool) []string {
	texts := notificationEmailTextsForLanguage(recipientLanguage)
	lines := make([]string, 0, 3)
	if likes > 0 {
		lines = append(lines, renderNotificationText(texts.attachedLikes, map[string]string{"count": fmt.Sprintf("%d", likes)}))
	}
	if hasAI {
		lines = append(lines, texts.attachedAI)
	}
	if threadReplies > 0 {
		lines = append(lines, renderNotificationText(texts.attachedReply, map[string]string{"count": fmt.Sprintf("%d", threadReplies)}))
	}
	return lines
}

// notificationItemTemplate 列表项文案：页面评论用带 page 的键
func notificationItemTemplate(texts notificationEmailTexts, n *model.Notification) string {
	if n.Type == constant.NotificationTypeCommentCreated && n.SubjectType == constant.TargetTypePage {
		if tpl, ok := texts.lists["comment.created.page"]; ok {
			return tpl
		}
	}
	if tpl, ok := texts.lists[n.Type]; ok {
		return tpl
	}
	return "{actor} " + n.Type
}

// notificationSubjectTemplate 单条邮件的主题
func notificationSubjectTemplate(texts notificationEmailTexts, n *model.Notification) string {
	if n.Type == constant.NotificationTypeCommentCreated && n.SubjectType == constant.TargetTypePage {
		if tpl, ok := texts.subjects["comment.created.page"]; ok {
			return tpl
		}
	}
	if tpl, ok := texts.subjects[n.Type]; ok {
		return tpl
	}
	return "{actor} · {site}"
}

// notificationActorDisplay 通知里的称呼：昵称优先，其次用户名，超长截断；
// 作者资料读不到（已注销、关联未加载）时用该语言的「有人」兜底，不能把「—」写进句子
func notificationActorDisplay(n *model.Notification, unknownActor string) string {
	name := strings.TrimSpace(n.Actor.Nickname)
	if name == "" {
		name = n.Actor.Username
	}
	if name == "" {
		if unknownActor != "" {
			return unknownActor
		}
		return "someone"
	}
	return truncateRunes(name, notificationActorMaxRunes)
}

// notificationActorInitial 没有头像时的首字兜底
func notificationActorInitial(n *model.Notification, unknownActor string) string {
	name := notificationActorDisplay(n, unknownActor)
	for _, r := range name {
		return strings.ToUpper(string(r))
	}
	return "?"
}

// notificationSubjectText 标题快照，缺失时用该语言的降级文案
func notificationSubjectText(texts notificationEmailTexts, n *model.Notification) string {
	title := strings.TrimSpace(n.SubjectTitle)
	if title == "" {
		return texts.deletedSubject
	}
	return truncateRunes(title, notificationSubjectMaxRunes)
}

// notificationDeepLink 邮件里的链接：评论类定位到那条评论，点赞类回到文章页
func notificationDeepLink(n *model.Notification) string {
	base := tools.GetBaseUrl()
	path := "/p/"
	if n.SubjectType == constant.TargetTypePage {
		path = "/page/"
	}
	key := n.SubjectSlug
	if key == "" && n.SubjectID != 0 {
		key = fmt.Sprintf("%d", n.SubjectID)
	}
	url := base + path + key
	if n.Type == constant.NotificationTypePostLiked {
		return url
	}
	commentID := n.CommentID
	if n.TargetType == constant.TargetTypeComment && n.TargetID != 0 {
		commentID = n.TargetID
	}
	if commentID == 0 {
		return url
	}
	return fmt.Sprintf("%s?comment=%d", url, commentID)
}

// notificationTimeText 列表项的时间：当天只显示时间，更早的带上日期（按收件人时区）
func notificationTimeText(at time.Time, timeZone string, now time.Time) string {
	location := time.Local
	if timeZone != "" {
		if loaded, err := time.LoadLocation(timeZone); err == nil {
			location = loaded
		}
	}
	local, current := at.In(location), now.In(location)
	if local.Year() == current.Year() && local.YearDay() == current.YearDay() {
		return local.Format("15:04")
	}
	if local.Year() == current.Year() {
		return local.Format("01-02 15:04")
	}
	return local.Format("2006-01-02 15:04")
}

// notificationIntervalText 汇总间隔的写法：整小时用小时，否则用分钟
func notificationIntervalText(interval time.Duration) string {
	if interval <= 0 {
		interval = time.Minute
	}
	if interval%time.Hour == 0 {
		return fmt.Sprintf("%d 小时", int(interval/time.Hour))
	}
	return fmt.Sprintf("%d 分钟", int(interval/time.Minute))
}
