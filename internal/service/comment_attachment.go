package service

import (
	"context"
	"slices"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// maxCommentAttachments 一条评论最多的附件数
const maxCommentAttachments = 9

// resolveCommentAttachments 校验评论附件并去重（保持顺序）：最多 9 个，文件必须存在；
// 新加入的文件只能是当前用户自己上传的（管理员不限），编辑时 kept 中原有的附件可以保留
func resolveCommentAttachments(ctx context.Context, ids []uint, kept model.FileIDs) (model.FileIDs, *errs.ServiceError) {
	result := make(model.FileIDs, 0, len(ids))
	for _, id := range ids {
		if !slices.Contains(result, id) {
			result = append(result, id)
		}
	}
	if len(result) > maxCommentAttachments {
		return nil, errs.NewBadRequest("too_many_attachments")
	}
	if len(result) == 0 {
		return nil, nil
	}
	files, err := repo.File.ListByIDs(result)
	if err != nil {
		logrus.Errorf("resolveCommentAttachments: ListByIDs error: %s", err.Error())
		return nil, errs.Internal("failed_to_get_target", err).WithResource("file")
	}
	owners := make(map[uint]uint, len(files))
	for _, file := range files {
		owners[file.ID] = file.UserID
	}
	isAdmin := ctxutils.IsAdmin(ctx)
	for _, id := range result {
		ownerID, ok := owners[id]
		// 文件不存在与无权使用返回同一错误，不暴露他人文件是否存在
		if !ok || !(isAdmin || slices.Contains(kept, id) || ctxutils.IsOwnerOfTarget(ctx, ownerID)) {
			return nil, errs.NewBadRequest("invalid_attachment")
		}
	}
	return result, nil
}

// commentAttachmentFiles 一次查询这批评论引用的全部附件文件，按文件 ID 索引
func commentAttachmentFiles(comments []model.Comment) map[uint]model.File {
	var ids []uint
	for _, comment := range comments {
		ids = append(ids, comment.AttachmentIDs...)
	}
	if len(ids) == 0 {
		return nil
	}
	files, err := repo.File.ListByIDs(ids)
	if err != nil {
		logrus.Errorf("commentAttachmentFiles: ListByIDs error: %s", err.Error())
		return nil
	}
	result := make(map[uint]model.File, len(files))
	for _, file := range files {
		result[file.ID] = file
	}
	return result
}

// toCommentAttachmentDtos 按保存顺序输出附件，已删除的文件跳过
func toCommentAttachmentDtos(ids model.FileIDs, files map[uint]model.File) []dto.CommentAttachmentDto {
	result := make([]dto.CommentAttachmentDto, 0, len(ids))
	for _, id := range ids {
		file, ok := files[id]
		if !ok {
			continue
		}
		result = append(result, dto.CommentAttachmentDto{
			ID:       file.ID,
			URL:      FileLink(file.ID),
			Name:     file.Name,
			MimeType: file.MimeType,
			Size:     file.Size,
		})
	}
	return result
}
