package service

import (
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "time/tzdata" // 与 utils.NormalizeTimeZone 一致：容器里没有系统时区数据也能按 IANA 名称分天
)

// 文案截断上限（见 docs/notification-spec.md 15.4）：标题 40、正文 60、引用 40、昵称 20
const (
	notificationSubjectMaxRunes = 40
	notificationExcerptMaxRunes = 60
	notificationQuotedMaxRunes  = 40
	notificationActorMaxRunes   = 20
	// notificationExcerptStoreRunes 落库的摘要长度，与 notifications.excerpt 列宽一致
	notificationExcerptStoreRunes = 300
)

var (
	reNotificationTag   = regexp.MustCompile(`(?s)<[^>]+>`)
	reNotificationSpace = regexp.MustCompile(`\s+`)
	// reNotificationAttachment 纯附件评论的占位标记，整段摘要恰好是它时才按附件渲染
	reNotificationAttachment = regexp.MustCompile(`^\[\[neo:attachment:(image|file):(\d+)\]\]$`)
)

// 纯附件评论的附件种类
const (
	notificationAttachmentImage = "image"
	notificationAttachmentFile  = "file"
)

// NotificationAttachmentMarker 纯附件评论在通知快照里的占位标记（与语言无关），如 [[neo:attachment:image:3]]；
// 前端（web/src/app/(main)/notifications）与邮件按收件人语言渲染，格式两边须保持一致
func NotificationAttachmentMarker(kind string, count int) string {
	return "[[neo:attachment:" + kind + ":" + strconv.Itoa(max(count, 1)) + "]]"
}

// parseNotificationAttachmentMarker 摘要是附件占位标记时返回种类与数量
func parseNotificationAttachmentMarker(excerpt string) (kind string, count int, ok bool) {
	match := reNotificationAttachment.FindStringSubmatch(strings.TrimSpace(excerpt))
	if match == nil {
		return "", 0, false
	}
	count, err := strconv.Atoi(match[2])
	if err != nil {
		return "", 0, false
	}
	return match[1], max(count, 1), true
}

// NotificationSummary 把评论正文压成单行纯文本并按字符截断，站内列表与邮件共用
func NotificationSummary(content string, max int) string {
	text := reNotificationTag.ReplaceAllString(content, " ")
	text = html.UnescapeString(text)
	text = strings.TrimSpace(reNotificationSpace.ReplaceAllString(text, " "))
	if max <= 0 {
		return text
	}
	return truncateRunes(text, max)
}

// notificationStoredExcerpt 落库的正文摘要：先截断到列宽，渲染时再按各渠道的上限截断
func notificationStoredExcerpt(content string) string {
	return NotificationSummary(content, notificationExcerptStoreRunes)
}

// notificationDay 收件人所在时区的自然日（yyyymmdd），聚合行按它分天。
// 时区为空或非法时用服务器时区，跨时区的一天归并误差可接受（见 3.4）
func notificationDay(at time.Time, timeZone string) string {
	location := time.Local
	if timeZone != "" {
		if loaded, err := time.LoadLocation(timeZone); err == nil {
			location = loaded
		}
	}
	return at.In(location).Format("20060102")
}

// 去重键（见 3.3）：同一 actor + 动作 + 目标只保留一条事件 / 通知

func dedupeKeyCommentCreated(subjectType string, subjectID, commentID uint) string {
	return fmt.Sprintf("comment.created:%s:%d:comment:%d", subjectType, subjectID, commentID)
}

func dedupeKeyCommentReplied(repliedCommentID, commentID uint) string {
	return fmt.Sprintf("comment.replied:comment:%d:comment:%d", repliedCommentID, commentID)
}

func dedupeKeyPostLiked(postID, actorID uint) string {
	return fmt.Sprintf("post.liked:post:%d:user:%d", postID, actorID)
}

func dedupeKeyCommentLiked(commentID, actorID uint) string {
	return fmt.Sprintf("comment.liked:comment:%d:user:%d", commentID, actorID)
}

// dedupeKeyCommentMentioned 提及：同一条评论对同一个人只提醒一次
func dedupeKeyCommentMentioned(commentID, mentionedID uint) string {
	return fmt.Sprintf("comment.mentioned:comment:%d:user:%d", commentID, mentionedID)
}

// dedupeKeyThreadReplied 线程活动是折叠行：同一天同一线程同一收件人只有一行
func dedupeKeyThreadReplied(rootCommentID uint, day string, recipientID uint) string {
	return fmt.Sprintf("comment.thread_replied:comment:%d:day:%s:user:%d", rootCommentID, day, recipientID)
}
