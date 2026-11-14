package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// AI 用户的管理工具（仅管理员）：与人物蒸馏 skill 配套，蒸馏完成后先查找平台上是否已有同一个人的 AI 用户，
// 有就读取后合并、按同一个用户名更新，没有再新建，最后试运行看看效果。导入沿用控制台「AI 用户 → 导入」的同一实现

// 试运行等待结果的时长与轮询间隔；超过时返回运行 ID，之后用 get_ai_user_run 查询（测试中可缩短）
var (
	dryRunWait     = 90 * time.Second
	dryRunInterval = 2 * time.Second
)

// aiUserFile 与导入文件相同的格式；profile 为性格档案对象。新建时缺少的字段取该类型的默认值，
// 更新已有的 AI 用户时缺少的字段保持原值（嵌套对象逐字段合并，数组整体替换）
type aiUserFile struct {
	Username       string         `json:"username" jsonschema:"1-20 characters without spaces, / or @; an existing AI user with this username is updated instead of created"`
	Nickname       string         `json:"nickname,omitempty" jsonschema:"display name, at most 20 characters (only used when creating)"`
	AvatarURL      string         `json:"avatar_url,omitempty" jsonschema:"public image URL (only used when creating)"`
	BackgroundURL  string         `json:"background_url,omitempty" jsonschema:"public image URL (only used when creating)"`
	PreferredColor string         `json:"preferred_color,omitempty" jsonschema:"theme color name (only used when creating)"`
	Tier           string         `json:"tier,omitempty" jsonschema:"ambient or expert; empty keeps the current tier on update (ambient on create)"`
	Profile        map[string]any `json:"profile,omitempty" jsonschema:"personality profile object, same as the profile in an exported AI user file (language, persona, tone, style_samples, interests, activity, behavior, limits, ...). On create missing fields take the tier's defaults; on update missing fields keep their current values (nested objects merge field by field, arrays are replaced)"`
}

func fileItemToTool(item dto.AIAgentFileItem) aiUserFile {
	out := aiUserFile{
		Username: item.Username, Nickname: item.Nickname, AvatarURL: item.AvatarUrl, BackgroundURL: item.BackgroundUrl,
		PreferredColor: item.PreferredColor, Tier: item.Tier,
	}
	_ = json.Unmarshal(item.Profile, &out.Profile)
	return out
}

func formatTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

// ---------- find_ai_users ----------

type findAIUsersInput struct {
	Names []string `json:"names" jsonschema:"names that could identify the person: usernames you plan to import, real name, nicknames, platform IDs, character names, in every language they are known by (at most 10)"`
	Limit int      `json:"limit,omitempty" jsonschema:"maximum number of matches, 1-20 (default 10)"`
}

type aiUserMatch struct {
	Username     string   `json:"username"`
	Nickname     string   `json:"nickname"`
	Tier         string   `json:"tier"`
	Status       string   `json:"status"`
	Archetype    string   `json:"archetype"`
	MatchedBy    []string `json:"matched_by" jsonschema:"how it matched: username, nickname, username_partial, nickname_partial, archetype, persona or profile"`
	LastActiveAt string   `json:"last_active_at,omitempty"`
}

type findAIUsersOutput struct {
	Matches        []aiUserMatch `json:"matches" jsonschema:"most likely first"`
	TakenUsernames []string      `json:"taken_usernames" jsonschema:"names that are usernames of regular (non-AI) users, so they cannot be used as an AI user's username"`
}

func findAIUsers(ctx context.Context, _ *mcp.CallToolRequest, in findAIUsersInput) (*mcp.CallToolResult, *findAIUsersOutput, error) {
	if err := requireScope(ctx, constant.ScopeAIAgentsRead); err != nil {
		return nil, nil, err
	}
	result, svcerr := service.NewAIAgentService().FindAIAgents(ctx, in.Names, in.Limit)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	out := &findAIUsersOutput{Matches: make([]aiUserMatch, 0, len(result.Matches)), TakenUsernames: result.TakenUsernames}
	for _, m := range result.Matches {
		out.Matches = append(out.Matches, aiUserMatch{
			Username: m.Username, Nickname: m.Nickname, Tier: m.Tier, Status: m.Status, Archetype: m.Archetype,
			MatchedBy: m.MatchedBy, LastActiveAt: formatTime(m.LastActiveAt),
		})
	}
	return nil, out, nil
}

// ---------- get_ai_user ----------

type getAIUserInput struct {
	Username string `json:"username" jsonschema:"username of the AI user"`
}

type getAIUserOutput struct {
	Status         string     `json:"status" jsonschema:"active or paused"`
	PausedReason   string     `json:"paused_reason,omitempty"`
	CreatedAt      string     `json:"created_at"`
	LastActiveAt   string     `json:"last_active_at,omitempty"`
	Agent          aiUserFile `json:"agent" jsonschema:"account and profile in the import file format; edit it and pass it to import_ai_users to update"`
	RecentComments []string   `json:"recent_comments" jsonschema:"the AI user's latest comments on the blog, newest first"`
}

func getAIUser(ctx context.Context, _ *mcp.CallToolRequest, in getAIUserInput) (*mcp.CallToolResult, *getAIUserOutput, error) {
	if err := requireScope(ctx, constant.ScopeAIAgentsRead); err != nil {
		return nil, nil, err
	}
	detail, svcerr := service.NewAIAgentService().GetAIAgentFile(ctx, in.Username)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	return nil, &getAIUserOutput{
		Status: detail.Status, PausedReason: detail.PausedReason, CreatedAt: detail.CreatedAt.Format(time.RFC3339),
		LastActiveAt: formatTime(detail.LastActiveAt), Agent: fileItemToTool(detail.Agent), RecentComments: detail.RecentComments,
	}, nil
}

// ---------- import_ai_users ----------

type importAIUsersInput struct {
	Agents []aiUserFile `json:"agents" jsonschema:"AI users to create or update, in the import file format (at most 200)"`
	DryRun bool         `json:"dry_run,omitempty" jsonschema:"only validate and report what would happen (create or update) without writing; do this first and show the user"`
}

type importAIUserResult struct {
	Username string `json:"username"`
	Action   string `json:"action,omitempty" jsonschema:"create or update; empty when it failed"`
	Error    string `json:"error,omitempty"`
}

type importAIUsersOutput struct {
	DryRun  bool                 `json:"dry_run"`
	Results []importAIUserResult `json:"results"`
}

func importAIUsers(ctx context.Context, _ *mcp.CallToolRequest, in importAIUsersInput) (*mcp.CallToolResult, *importAIUsersOutput, error) {
	if err := requireScope(ctx, constant.ScopeAIAgentsWrite); err != nil {
		return nil, nil, err
	}
	if len(in.Agents) == 0 {
		return nil, nil, errors.New("agents is empty")
	}
	// 转成与导入文件相同的结构，交给控制台导入的同一实现校验
	raw, err := json.Marshal(in.Agents)
	if err != nil {
		return nil, nil, err
	}
	var items []dto.AIAgentFileItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, nil, err
	}
	results, svcerr := service.NewAIAgentService().Import(ctx, &dto.ImportAIAgentsReq{Agents: items, DryRun: in.DryRun})
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	out := &importAIUsersOutput{DryRun: in.DryRun, Results: make([]importAIUserResult, 0, len(results))}
	for _, r := range results {
		item := importAIUserResult{Action: r.Action}
		if r.Index >= 0 && r.Index < len(items) {
			item.Username = items[r.Index].Username
		}
		if r.Error != nil {
			item.Error = r.Error.Code
			if hint, ok := errorHints[r.Error.Code]; ok {
				item.Error = hint + " [" + r.Error.Code + "]"
			}
			if r.Error.Field != "" {
				item.Error += fmt.Sprintf(" (field: %s)", r.Error.Field)
			}
		}
		out.Results = append(out.Results, item)
	}
	return nil, out, nil
}

// ---------- dry_run_ai_user / get_ai_user_run ----------

type dryRunAIUserInput struct {
	Username  string `json:"username" jsonschema:"username of the AI user"`
	PostID    uint   `json:"post_id,omitempty" jsonschema:"rehearse reading this post (use list_posts to find one); set either post_id or comment_id"`
	CommentID uint   `json:"comment_id,omitempty" jsonschema:"rehearse being replied to by this comment"`
}

type getAIUserRunInput struct {
	RunID uint `json:"run_id" jsonschema:"id returned by dry_run_ai_user"`
}

type aiUserRunAction struct {
	Type    string `json:"type" jsonschema:"like, comment, reply, update_profile or set_avatar"`
	Target  string `json:"target,omitempty"`
	Content string `json:"content,omitempty"`
}

type aiUserRunOutput struct {
	RunID   uint              `json:"run_id"`
	Status  string            `json:"status" jsonschema:"queued or leased while running; done or failed when finished"`
	Actions []aiUserRunAction `json:"actions" jsonschema:"what the AI user would do; nothing is executed in a dry run"`
	Reason  string            `json:"reason,omitempty" jsonschema:"the AI user's own explanation"`
	Error   string            `json:"error,omitempty"`
	Note    string            `json:"note,omitempty"`
}

func runOutput(run *dto.AgentRunDto) *aiUserRunOutput {
	out := &aiUserRunOutput{RunID: run.ID, Status: run.Status, Actions: make([]aiUserRunAction, 0, len(run.Actions)), Reason: run.Reason, Error: run.Error}
	for _, a := range run.Actions {
		out.Actions = append(out.Actions, aiUserRunAction{Type: a.Type, Target: a.Target, Content: a.Content})
	}
	return out
}

func runFinished(status string) bool {
	return status == constant.AgentRunStatusDone || status == constant.AgentRunStatusFailed || status == constant.AgentRunStatusSkipped
}

func dryRunAIUser(ctx context.Context, _ *mcp.CallToolRequest, in dryRunAIUserInput) (*mcp.CallToolResult, *aiUserRunOutput, error) {
	if err := requireScope(ctx, constant.ScopeAIAgentsWrite); err != nil {
		return nil, nil, err
	}
	if (in.PostID == 0) == (in.CommentID == 0) {
		return nil, nil, errors.New("set exactly one of post_id or comment_id")
	}
	svc := service.NewAIAgentService()
	detail, svcerr := svc.GetAIAgentFile(ctx, in.Username)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	req := &dto.AIAgentDryRunReq{ID: detail.ID, TargetType: constant.TargetTypePost, TargetID: in.PostID}
	if in.CommentID != 0 {
		req.TargetType, req.TargetID = constant.TargetTypeComment, in.CommentID
	}
	run, svcerr := svc.DryRun(ctx, req)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	// 由后端的 worker 执行，等待一段时间；来不及时返回运行 ID，之后用 get_ai_user_run 查询
	deadline := time.Now().Add(dryRunWait)
	for !runFinished(run.Status) && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(dryRunInterval):
		}
		if latest, svcerr := svc.GetRun(ctx, run.ID); svcerr == nil {
			run = latest
		}
	}
	out := runOutput(run)
	if !runFinished(run.Status) {
		out.Note = "still running; call get_ai_user_run with this run_id later"
	}
	return nil, out, nil
}

func getAIUserRun(ctx context.Context, _ *mcp.CallToolRequest, in getAIUserRunInput) (*mcp.CallToolResult, *aiUserRunOutput, error) {
	if err := requireScope(ctx, constant.ScopeAIAgentsRead); err != nil {
		return nil, nil, err
	}
	run, svcerr := service.NewAIAgentService().GetRun(ctx, in.RunID)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	return nil, runOutput(run), nil
}

func registerAIAgentTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "find_ai_users",
		Description: "Find AI users that may already represent the same person, before importing a distilled AI user. " +
			"Matches usernames, nicknames and profiles (archetype, persona) against the given names; exact username matches come first. " +
			"Also tells which names are taken by regular users. Admin only; requires ai_agents:read.",
		Annotations: &mcp.ToolAnnotations{Title: "Find AI users", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, findAIUsers)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_ai_user",
		Description: "Get an AI user's account and profile in the import file format, plus its status and latest comments, so you can merge a new distillation into it. Admin only; requires ai_agents:read.",
		Annotations: &mcp.ToolAnnotations{Title: "Get AI user", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, getAIUser)
	mcp.AddTool(server, &mcp.Tool{
		Name: "import_ai_users",
		Description: "Create or update AI users from import file items, the same as Console > AI users > Import. " +
			"An existing AI user with the same username is updated: the given profile fields are merged into its profile (fields you leave out keep their values), account info such as nickname and avatar is kept. " +
			"Run with dry_run first and show the user what will be created or updated. Admin only; requires ai_agents:write.",
		Annotations: &mcp.ToolAnnotations{Title: "Import AI users", DestructiveHint: boolPtr(true), IdempotentHint: true, OpenWorldHint: boolPtr(false)},
	}, importAIUsers)
	mcp.AddTool(server, &mcp.Tool{
		Name: "dry_run_ai_user",
		Description: "Rehearse an AI user on a post or a comment reply and return what it would do (comments, likes) without executing anything. " +
			"Calls the site's AI model, so use it sparingly. Waits up to about 90 seconds. Admin only; requires ai_agents:write.",
		Annotations: &mcp.ToolAnnotations{Title: "Dry-run AI user", DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)},
	}, dryRunAIUser)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_ai_user_run",
		Description: "Get the result of an AI user run, e.g. a dry run that was still running. Admin only; requires ai_agents:read.",
		Annotations: &mcp.ToolAnnotations{Title: "Get AI user run", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, getAIUserRun)
}
