package service

import (
	"slices"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 一条评论里最多 @ 这么多人，防止「@所有人」式的骚扰
const maxCommentMentions = 3

// resolveCommentMentions 校验并规整被 @ 的用户：
// 去重、去掉自己，最多 3 个；id 必须存在且未被禁用，否则整条请求按参数错误拒绝。
// 私密评论只把「目标作者与参与过该线程的人」留给通知，其余被 @ 的人只在正文里出现
// （不在私密评论上抛可见性错误，避免把谁能看这条评论的规则泄漏出去）
func resolveCommentMentions(ids []uint, selfID uint) (model.UintIDs, *errs.ServiceError) {
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
		users = append(users, *user)
	}
	mentioned := make(model.UintIDs, 0, len(users))
	for i := range users {
		mentioned = append(mentioned, users[i].ID)
	}
	return mentioned, nil
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
