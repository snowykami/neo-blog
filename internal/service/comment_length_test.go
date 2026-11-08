package service

import (
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 评论字数上限可配置：默认 500，后台调小后立即生效；创建与编辑走同一套校验
func TestCommentContentLengthLimit(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	svc := NewCommentService()

	createCommentOf := func(content string) (uint, *errs.ServiceError) {
		return svc.CreateComment(author, &dto.CreateCommentReq{
			TargetID: postID, TargetType: constant.TargetTypePost, Content: content,
		})
	}

	if got := tools.GetCommentMaxLength(); got != config.CommentMaxLengthDefault {
		t.Fatalf("默认上限 = %d, 期望 %d", got, config.CommentMaxLengthDefault)
	}
	// 原先的 200 字限制已放开到 500
	if _, svcerr := createCommentOf(strings.Repeat("字", 500)); svcerr != nil {
		t.Fatalf("500 字应当可以评论: %v", svcerr)
	}
	if _, svcerr := createCommentOf(strings.Repeat("字", 501)); svcerr == nil {
		t.Fatal("501 字应当被拒绝")
	}
	// 首尾空白不计入字数
	if _, svcerr := createCommentOf("  " + strings.Repeat("字", 500) + "  "); svcerr != nil {
		t.Fatalf("去空白后 500 字应当可以评论: %v", svcerr)
	}

	// 后台调小上限后立即生效（编辑已有评论同样受限）
	if svcerr := config.Save([]config.Change{{Key: "comment_max_length", Value: 20}}); svcerr != nil {
		t.Fatalf("保存配置: %v", svcerr)
	}
	if got := tools.GetCommentMaxLength(); got != 20 {
		t.Fatalf("调整后上限 = %d, 期望 20", got)
	}
	if _, svcerr := createCommentOf(strings.Repeat("字", 21)); svcerr == nil {
		t.Fatal("超过调整后的上限应当被拒绝")
	}
	id, svcerr := createCommentOf(strings.Repeat("字", 20))
	if svcerr != nil {
		t.Fatalf("等于调整后的上限应当可以评论: %v", svcerr)
	}
	if svcerr := svc.UpdateComment(author, &dto.UpdateCommentReq{ID: id, Content: strings.Repeat("字", 21)}); svcerr == nil {
		t.Fatal("编辑成超长内容应当被拒绝")
	}
	if svcerr := svc.UpdateComment(author, &dto.UpdateCommentReq{ID: id, Content: strings.Repeat("字", 20)}); svcerr != nil {
		t.Fatalf("编辑成上限内的内容应当成功: %v", svcerr)
	}
}

// 折叠行数同样来自配置，缺省 6 行
func TestCommentCollapsedLinesConfig(t *testing.T) {
	setupEditTest(t)
	if got := tools.GetCommentCollapsedLines(); got != config.CommentCollapsedLinesDefault {
		t.Fatalf("默认折叠行数 = %d, 期望 %d", got, config.CommentCollapsedLinesDefault)
	}
	if svcerr := config.Save([]config.Change{{Key: "comment_collapsed_lines", Value: 3}}); svcerr != nil {
		t.Fatalf("保存配置: %v", svcerr)
	}
	if got := tools.GetCommentCollapsedLines(); got != 3 {
		t.Fatalf("调整后折叠行数 = %d, 期望 3", got)
	}
}
