package agentrunner

import (
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestCleanComment(t *testing.T) {
	noPeriod := []string{"这个坑我也踩过", "猫猫好圆"}
	withPeriod := []string{"我也是这么做的。", "有道理。"}
	withEmoji := []string{"好耶 🎉", "笑死"}
	cases := []struct {
		in      string
		samples []string
		want    string
	}{
		{"“离线库这个思路挺省事的。”", noPeriod, "离线库这个思路挺省事的"},
		{"**WAL** 模式确实快——不过要注意 `checkpoint`。", noPeriod, "WAL 模式确实快，不过要注意 checkpoint"},
		{"- 第一点\n- 第二点", nil, "第一点\n第二点"},
		{"有道理。", withPeriod, "有道理。"},
		{"好耶🎉🎉", noPeriod, "好耶"},
		{"好耶🎉", withEmoji, "好耶🎉"},
		{"这段写得很细\n\n\n收藏了", nil, "这段写得很细\n收藏了"},
		{"「」", nil, ""},
		{"他说“行吧”就走了", nil, "他说“行吧”就走了"},
	}
	for _, c := range cases {
		if got := cleanComment(c.in, c.samples); got != c.want {
			t.Errorf("cleanComment(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestToneIssues(t *testing.T) {
	aiLike := []string{
		"感谢分享，学到了很多",
		"这篇写得非常好",
		"值得一提的是，作者的思路很清晰",
		"这不仅是技术问题，而且是管理问题",
		"这不是 bug 而是 feature",
		"从工程角度来看，这样设计更合理",
		"看完这篇文章，我也想试试",
		"希望对大家有帮助",
		"期待更多分享",
		"彩排这个比喻挺对的，不过彩排多了也容易自我怀疑",
	}
	for _, c := range aiLike {
		if len(toneIssues(c, "ambient")) == 0 {
			t.Errorf("%q should be flagged", c)
		}
	}
	human := []string{
		"这个坑我也踩过，sqlite 开 WAL 之后好多了",
		"猫猫好圆",
		"笑死，我也是这么改的",
		"第三步那里我这边要先改权限才行，不知道是不是版本问题",
		"确实，不过我更喜欢 Go 的写法",
		"至少知道怎么讲得好听一点了",
	}
	for _, c := range human {
		if issues := toneIssues(c, "ambient"); len(issues) > 0 {
			t.Errorf("%q flagged as %v", c, issues)
		}
	}
	long := strings.Repeat("长", 150)
	if len(toneIssues(long, "ambient")) == 0 || len(toneIssues(long, "expert")) != 0 {
		t.Error("length budget: ambient 100, expert 200")
	}
}

func TestHumanizeActions(t *testing.T) {
	actions := []dto.AgentActionDto{
		{Type: "like", Target: "post:1"},
		{Type: "comment", Target: "post:1", Content: "“”"},
		{Type: "comment", Target: "post:2", Content: "感谢分享！学到了。"},
		{Type: "reply", Target: "comment:3", Content: "笑死"},
	}
	kept, issues := humanizeActions(actions, nil, "ambient")
	if len(kept) != 3 || kept[1].Content != "感谢分享！学到了" || kept[2].Content != "笑死" {
		t.Fatalf("kept = %+v", kept)
	}
	if len(issues) != 1 || !strings.Contains(issues[0], "post:2") || !strings.Contains(issues[0], "客套话") {
		t.Fatalf("issues = %v", issues)
	}
	if prompt := rewritePrompt(issues); !strings.Contains(prompt, "AI 味太重") || !strings.Contains(prompt, "post:2") {
		t.Fatalf("rewrite prompt = %s", prompt)
	}
}
