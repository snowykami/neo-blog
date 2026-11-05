package service

import (
	"context"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// createTestFile 直接写入一条文件记录，归属于 ctx 对应的用户
func createTestFile(t *testing.T, ctx context.Context, name, mimeType string) uint {
	t.Helper()
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	file := &model.File{Hash: name, UserID: userID, Name: name, Size: 123, MimeType: mimeType}
	if err := repo.File.Create(file); err != nil {
		t.Fatalf("create file: %v", err)
	}
	return file.ID
}

func expectErrMessage(t *testing.T, svcerr *errs.ServiceError, message, msg string) {
	t.Helper()
	if svcerr == nil || svcerr.Message != message {
		t.Fatalf("%s: want %s, got %v", msg, message, svcerr)
	}
}

func attachmentIDsOf(comment *dto.CommentDto) []uint {
	ids := make([]uint, 0, len(comment.Attachments))
	for _, attachment := range comment.Attachments {
		ids = append(ids, attachment.ID)
	}
	return ids
}

func getCommentDto(t *testing.T, ctx context.Context, id uint) *dto.CommentDto {
	t.Helper()
	comment, svcerr := NewCommentService().GetComment(ctx, id)
	if svcerr != nil {
		t.Fatalf("get comment: %v", svcerr)
	}
	return comment
}

func TestCreateCommentAttachments(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	create := func(ctx context.Context, content string, ids []uint) (uint, *errs.ServiceError) {
		return NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{
			TargetID: postID, TargetType: constant.TargetTypePost, Content: content, AttachmentIDs: ids,
		})
	}

	image := createTestFile(t, other, "a.png", "image/png")
	video := createTestFile(t, other, "b.mp4", "video/mp4")
	authorFile := createTestFile(t, author, "c.png", "image/png")

	// 自己的文件：去重并保持顺序，DTO 带稳定链接与文件信息
	id, svcerr := create(other, " 看图 ", []uint{video, image, video})
	if svcerr != nil {
		t.Fatalf("create with own files: %v", svcerr)
	}
	got := getCommentDto(t, other, id)
	if !slices.Equal(attachmentIDsOf(got), []uint{video, image}) {
		t.Fatalf("attachments = %v, want [%d %d]", attachmentIDsOf(got), video, image)
	}
	if a := got.Attachments[0]; a.URL != FileLink(video) || a.Name != "b.mp4" || a.MimeType != "video/mp4" || a.Size != 123 {
		t.Fatalf("attachment dto = %+v", a)
	}

	// 只有附件、没有文字也可以发；两者都没有不行
	if _, svcerr := create(other, "  ", []uint{image}); svcerr != nil {
		t.Fatalf("attachments only: %v", svcerr)
	}
	_, svcerr = create(other, "", nil)
	expectErrMessage(t, svcerr, "content_cannot_be_empty", "empty comment")

	// 他人的文件、不存在的文件都不能引用，管理员不受限
	_, svcerr = create(other, "x", []uint{image, authorFile})
	expectErrMessage(t, svcerr, "invalid_attachment", "other user's file")
	_, svcerr = create(other, "x", []uint{99999})
	expectErrMessage(t, svcerr, "invalid_attachment", "missing file")
	if _, svcerr := create(admin, "x", []uint{authorFile}); svcerr != nil {
		t.Fatalf("admin attaches any file: %v", svcerr)
	}

	// 最多 9 个（去重后计数）
	many := make([]uint, 0, 10)
	for i := range 10 {
		many = append(many, createTestFile(t, other, "f"+string(rune('0'+i))+".png", "image/png"))
	}
	if _, svcerr := create(other, "x", append(many[:9:9], many[0])); svcerr != nil {
		t.Fatalf("9 attachments with a duplicate: %v", svcerr)
	}
	_, svcerr = create(other, "x", many)
	expectErrMessage(t, svcerr, "too_many_attachments", "10 attachments")

	// 文件被删除后不再返回，列表接口同样带附件
	if err := repo.File.DeleteByID(video); err != nil {
		t.Fatalf("delete file: %v", err)
	}
	comments, svcerr := listComments(t, other, postID)
	if svcerr != nil {
		t.Fatalf("list comments: %v", svcerr)
	}
	idx := slices.IndexFunc(comments, func(c dto.CommentDto) bool { return c.ID == id })
	if idx < 0 || !slices.Equal(attachmentIDsOf(&comments[idx]), []uint{image}) {
		t.Fatalf("listed attachments after delete = %v", comments)
	}
}

func TestUpdateCommentAttachments(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	mine := createTestFile(t, other, "mine.png", "image/png")
	adminFile := createTestFile(t, admin, "admin.pdf", "application/pdf")
	authorFile := createTestFile(t, author, "author.png", "image/png")

	id, svcerr := NewCommentService().CreateComment(other, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: "c", AttachmentIDs: []uint{mine},
	})
	if svcerr != nil {
		t.Fatalf("create: %v", svcerr)
	}
	update := func(ctx context.Context, content string, ids *[]uint) *errs.ServiceError {
		return NewCommentService().UpdateComment(ctx, &dto.UpdateCommentReq{ID: id, Content: content, AttachmentIDs: ids})
	}
	expectAttachments := func(want ...uint) {
		t.Helper()
		if got := attachmentIDsOf(getCommentDto(t, other, id)); !slices.Equal(got, want) {
			t.Fatalf("attachments = %v, want %v", got, want)
		}
	}

	// 不传附件字段时保持原样
	if svcerr := update(other, "c2", nil); svcerr != nil {
		t.Fatalf("update without attachments: %v", svcerr)
	}
	expectAttachments(mine)

	// 管理员可以加入任意文件；评论作者之后可以保留它，但不能新加他人的文件
	if svcerr := update(admin, "c3", &[]uint{mine, adminFile}); svcerr != nil {
		t.Fatalf("admin adds file: %v", svcerr)
	}
	if svcerr := update(other, "c4", &[]uint{adminFile, mine}); svcerr != nil {
		t.Fatalf("owner keeps existing file: %v", svcerr)
	}
	expectAttachments(adminFile, mine)
	expectErrMessage(t, update(other, "c5", &[]uint{adminFile, mine, authorFile}), "invalid_attachment", "owner adds other's file")
	expectAttachments(adminFile, mine)

	// 清空附件后必须有文字
	expectErrMessage(t, update(other, "", &[]uint{}), "content_cannot_be_empty", "clear all")
	if svcerr := update(other, "", &[]uint{mine}); svcerr != nil {
		t.Fatalf("attachments only: %v", svcerr)
	}
	if svcerr := update(other, "text", &[]uint{}); svcerr != nil {
		t.Fatalf("clear attachments: %v", svcerr)
	}
	expectAttachments()
	var stored model.Comment
	if err := repo.GetDB().Select("attachment_ids").First(&stored, id).Error; err != nil || stored.AttachmentIDs != nil {
		t.Fatalf("cleared attachments should be NULL: %v %v", stored.AttachmentIDs, err)
	}
}

func TestTranslateAttachmentOnlyComment(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	image := createTestFile(t, other, "a.png", "image/png")
	id, svcerr := NewCommentService().CreateComment(other, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, AttachmentIDs: []uint{image},
	})
	if svcerr != nil {
		t.Fatalf("create: %v", svcerr)
	}
	_, svcerr = NewCommentTranslateService().Translate(other, &dto.TranslateCommentReq{ID: id, TargetLang: "en"})
	expectErrMessage(t, svcerr, "content_cannot_be_empty", "translate attachment-only comment")
}
