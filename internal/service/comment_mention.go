package service

import (
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 一条评论里最多 @ 这么多人，防止「@所有人」式的骚扰
const maxCommentMentions = 3

// resolveCommentMentions 校验并规整被 @ 的用户：
// 去重、去掉自己，最多 3 个；id 必须存在且未被禁用，且正文里确实写了 `@用户名`
// （不认「只给 id 不带文字」的请求，否则可以拿它当骚扰别人的通道）。
// 正文里找不到的 id 直接丢掉而不是整条请求报错：编辑评论时删掉 @ 文字是正常操作。
// 私密评论的收件人由 filterMentionRecipients 另外收窄
func resolveCommentMentions(ids []uint, selfID uint, content string) (model.UintIDs, *errs.ServiceError) {
	if len(ids) == 0 {
		return nil, nil
	}
	unique := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == 0 || id == selfID || slices.Contains(unique, id) {
			continue
		}
		unique = append(unique, id)
	}
	if len(unique) > maxCommentMentions {
		return nil, errs.NewBadRequest("too_many_mentions")
	}
	users := make([]model.User, 0, len(unique))
	for _, id := range unique {
		user, err := repo.User.GetUserByID(id)
		if err != nil || user.Disabled {
			return nil, errs.NewBadRequest("invalid_mention")
		}
		if !mentionsUser(content, user.Username) {
			continue
		}
		users = append(users, *user)
	}
	mentioned := make(model.UintIDs, 0, len(users))
	for i := range users {
		mentioned = append(mentioned, users[i].ID)
	}
	return mentioned, nil
}

// mentionsUser 正文里是否写了 @用户名（前面是行首、空白或常见前置标点，名字后面不再接用户名字符）
func mentionsUser(content, username string) bool {
	if username == "" {
		return false
	}
	needle := "@" + username
	for offset := 0; offset < len(content); {
		index := strings.Index(content[offset:], needle)
		if index < 0 {
			return false
		}
		start := offset + index
		offset = start + len(needle)
		// 前面必须是行首或空白 / 标点，避免把邮箱、abc@name 当成提及
		if start > 0 {
			prev, _ := utf8.DecodeLastRuneInString(content[:start])
			if !isMentionBoundary(prev) {
				continue
			}
		}
		// 后面不能再接用户名字符，避免 @zhang 命中 @zhangyu
		if rest := content[offset:]; rest != "" {
			next, _ := utf8.DecodeRuneInString(rest)
			if isMentionNameRune(next) {
				continue
			}
		}
		return true
	}
	return false
}

// isMentionBoundary 提及前允许出现的字符
func isMentionBoundary(r rune) bool {
	return unicode.IsSpace(r) || strings.ContainsRune("（(【[「,，.。:：;；!！?？>", r)
}

// isMentionNameRune 用户名里允许出现的字符，与前端高亮的正则保持一致
func isMentionNameRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' || r == '-'
}

// filterMentionRecipients 私密评论的收件人只能是目标作者或参与过该线程的人
func filterMentionRecipients(ids []uint, targetOwnerID, rootID uint) []uint {
	if len(ids) == 0 {
		return nil
	}
	result := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == targetOwnerID {
			result = append(result, id)
			continue
		}
		if rootID != 0 {
			participated, err := repo.Comment.HasUserCommentedInTree(rootID, id)
			if err == nil && participated {
				result = append(result, id)
			}
		}
	}
	return result
}
