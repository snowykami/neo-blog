package service

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func promptIDByLabel(t *testing.T, label string) uint {
	t.Helper()
	var prompt model.AIPrompt
	if err := repo.GetDB().Where("label = ?", label).First(&prompt).Error; err != nil {
		t.Fatalf("find prompt %s: %v", label, err)
	}
	return prompt.ID
}

func listLabels(t *testing.T, ctx context.Context, mode string) map[string]bool {
	t.Helper()
	prompts, svcerr := NewAIPromptService().List(ctx, mode)
	if svcerr != nil {
		t.Fatalf("list: %v", svcerr)
	}
	labels := map[string]bool{}
	for _, p := range prompts {
		labels[p.Label] = p.Editable
	}
	return labels
}

// 平台指令：首次启动写入默认指令，所有编辑者可用，只有管理员可以增删改
// 个人指令：只有创建者（与管理员）可见、可用、可管理
func TestAIPromptPermissions(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	s := NewAIPromptService()

	// 默认平台指令已写入，编辑者可见但不可编辑，管理员可编辑
	if labels := listLabels(t, author, aiWriteModeRewrite); len(labels) != 7 || labels["润色"] {
		t.Fatalf("author should see 7 read-only platform rewrite prompts: %v", labels)
	}
	if labels := listLabels(t, admin, aiWriteModeWrite); len(labels) != 4 || !labels["续写"] {
		t.Fatalf("admin should be able to edit platform prompts: %v", labels)
	}

	// 编辑者只能新增个人指令
	_, svcerr := s.Create(author, &dto.CreateOrUpdateAIPromptReq{Scope: model.AIPromptScopePlatform, Mode: aiWriteModeRewrite, Label: "x", Instruction: "y"})
	expectCode(t, svcerr, http.StatusForbidden, "editor create platform")
	mine, svcerr := s.Create(author, &dto.CreateOrUpdateAIPromptReq{Mode: aiWriteModeRewrite, Label: "  改成诗  ", Instruction: " 把选中内容改写成一首短诗。 "})
	if svcerr != nil || mine.Scope != model.AIPromptScopeUser || mine.Label != "改成诗" || !mine.Editable {
		t.Fatalf("create personal prompt: %v %+v", svcerr, mine)
	}
	// 个人指令只对创建者可见
	if labels := listLabels(t, author, aiWriteModeRewrite); !labels["改成诗"] {
		t.Fatalf("owner should see own prompt: %v", labels)
	}
	if labels := listLabels(t, other, aiWriteModeRewrite); len(labels) != 7 {
		t.Fatalf("other user should not see the personal prompt: %v", labels)
	}

	// 修改与删除：他人不行，管理员可以
	platformID := promptIDByLabel(t, "润色")
	_, svcerr = s.Update(author, &dto.CreateOrUpdateAIPromptReq{ID: platformID, Mode: aiWriteModeRewrite, Label: "改", Instruction: "改"})
	expectCode(t, svcerr, http.StatusForbidden, "editor update platform")
	expectCode(t, s.Delete(author, platformID), http.StatusForbidden, "editor delete platform")
	_, svcerr = s.Update(other, &dto.CreateOrUpdateAIPromptReq{ID: mine.ID, Mode: aiWriteModeRewrite, Label: "改", Instruction: "改"})
	expectCode(t, svcerr, http.StatusForbidden, "other update personal")
	updated, svcerr := s.Update(author, &dto.CreateOrUpdateAIPromptReq{ID: mine.ID, Mode: aiWriteModeRewrite, Label: "改成小诗", Instruction: "改写成四行短诗。"})
	if svcerr != nil || updated.Label != "改成小诗" || updated.Scope != model.AIPromptScopeUser {
		t.Fatalf("owner update: %v %+v", svcerr, updated)
	}
	if _, svcerr = s.Update(admin, &dto.CreateOrUpdateAIPromptReq{ID: platformID, Mode: aiWriteModeRewrite, Label: "润色", Instruction: "只修正错别字。"}); svcerr != nil {
		t.Fatalf("admin update platform: %v", svcerr)
	}

	// 输入校验
	_, svcerr = s.Create(author, &dto.CreateOrUpdateAIPromptReq{Mode: "translate", Label: "x", Instruction: "y"})
	expectCode(t, svcerr, http.StatusBadRequest, "bad mode")
	_, svcerr = s.Create(author, &dto.CreateOrUpdateAIPromptReq{Mode: aiWriteModeWrite, Label: " ", Instruction: "y"})
	expectCode(t, svcerr, http.StatusBadRequest, "empty label")
	_, svcerr = s.Create(author, &dto.CreateOrUpdateAIPromptReq{Mode: aiWriteModeWrite, Label: strings.Repeat("长", aiPromptMaxLabelRune+1), Instruction: "y"})
	expectCode(t, svcerr, http.StatusBadRequest, "long label")

	// AI 写作使用指令：要求取自指令；他人的个人指令、模式不符时拒绝
	configureAI(t, "https://example.com/v1")
	doc := "<p>a" + aiWriteSelectionStart + "选中" + aiWriteSelectionEnd + "b</p>"
	job, svcerr := NewAIWriteService().Prepare(author, constant.TargetTypePost, postIDOf(t), &dto.AIWriteReq{Mode: aiWriteModeRewrite, Document: doc, PromptID: platformID})
	if svcerr != nil || !strings.Contains(job.user, "只修正错别字。") {
		t.Fatalf("platform prompt instruction should be used: %v", svcerr)
	}
	expectCode(t, prepareErr(NewAIWriteService(), other, constant.TargetTypePost, postIDOf(t), &dto.AIWriteReq{Mode: aiWriteModeRewrite, Document: doc, PromptID: mine.ID}), http.StatusForbidden, "other's personal prompt")

	// 删除后不再出现；管理员删除平台指令后重启也不会重新写入默认指令
	if svcerr := s.Delete(author, mine.ID); svcerr != nil {
		t.Fatalf("delete own: %v", svcerr)
	}
	if svcerr := s.Delete(admin, platformID); svcerr != nil {
		t.Fatalf("admin delete platform: %v", svcerr)
	}
	if err := seedDefaultAIPromptsForTest(); err != nil {
		t.Fatalf("reseed: %v", err)
	}
	if labels := listLabels(t, author, aiWriteModeRewrite); labels["润色"] || labels["改成小诗"] || len(labels) != 6 {
		t.Fatalf("deleted prompts should stay deleted: %v", labels)
	}
}

func postIDOf(t *testing.T) uint {
	t.Helper()
	var post model.Post
	if err := repo.GetDB().First(&post).Error; err != nil {
		t.Fatalf("find post: %v", err)
	}
	return post.ID
}

// 重新执行初始化（模拟重启），只会补齐数据库结构，不会再次写入默认指令
func seedDefaultAIPromptsForTest() error {
	return repo.InitDatabase()
}
