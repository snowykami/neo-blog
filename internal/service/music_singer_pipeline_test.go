package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/utils"
)

type stubCustomVocalProvider struct {
	id         string
	prio       int
	candidates []VocalEvidenceCandidate
	called     atomic.Int32
}

func (p *stubCustomVocalProvider) ID() string { return p.id }
func (p *stubCustomVocalProvider) Match(q *VocalSearchQuery) int {
	if q == nil || q.CleanTitle == "" {
		return -1
	}
	return p.prio
}
func (p *stubCustomVocalProvider) Search(_ context.Context, _ *VocalSearchQuery) ([]VocalEvidenceCandidate, error) {
	p.called.Add(1)
	return p.candidates, nil
}

func seedLyricCacheForPipelineTest(t *testing.T, _ int64, _ string, lrc string) {
	t.Helper()
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: &dto.MusicLyricPart{Lyric: lrc}},
			outcome: lyricOutcomeHit,
		},
	})
}

func TestVocalEvidenceProviderRegistryAndRouting(t *testing.T) {
	qVS := buildVocalSearchQuery(&lyricSingerInput{
		Track: &dto.MusicTrackDto{
			ID:      101,
			Name:    "ステラ (feat. 初音ミク)",
			Artists: []string{"じん", "初音ミク"},
		},
		Tasks: []lyricSingerLineTask{{Index: 1, Text: "きっとこの世界で"}},
	})
	if !qVS.PrefersVirtualSinger {
		t.Fatalf("expected PrefersVirtualSinger=true when Virtual Singer hint present without SEKAI unit")
	}

	qSEKAI := buildVocalSearchQuery(&lyricSingerInput{
		Track: &dto.MusicTrackDto{
			ID:      102,
			Name:    "ステラ (feat. 星乃一歌&天馬咲希&望月穂波&日野森志歩&初音ミク)",
			Artists: []string{"Leo/need", "初音ミク"},
		},
		Tasks: []lyricSingerLineTask{{Index: 1, Text: "きっとこの世界で"}},
	})
	if qSEKAI.PrefersVirtualSinger {
		t.Fatalf("expected PrefersVirtualSinger=false when SEKAI unit Leo/need is present")
	}
	if !qSEKAI.HasMultiArtistHint {
		t.Fatalf("expected HasMultiArtistHint=true")
	}

	// 验证自定义 VocalEvidenceProvider 可无侵入扩展并赢得仲裁优先级
	svcWithDefaults := &lyricSingerService{name: "ext_registry_count_test"}
	defaultCount := len(svcWithDefaults.effectiveProviders())
	custom := &stubCustomVocalProvider{
		id:   "utaten_custom",
		prio: 99,
		candidates: []VocalEvidenceCandidate{{
			ProviderID: "utaten_custom",
			SourceName: "Custom UtaTen Source",
			Title:      qSEKAI.CleanTitle,
			URL:        "https://example.com/utaten/stella",
			Format:     VocalEvidenceFormatNormalized,
			RawContent: "[星乃一歌]:\nきっとこの世界で 僕らは夢を紡ぐ\n君を照らす光になるように願いを込めて\n\n[天马咲希]:\n夢を抱えたまま走った あの日を忘れない\n夜明けの向こう側まで 響き渡れこの歌",
			Priority:   99,
		}},
	}
	svcWithDefaults.RegisterVocalEvidenceProvider(custom)
	if gotCount := len(svcWithDefaults.effectiveProviders()); gotCount != defaultCount+1 {
		t.Fatalf("expected RegisterVocalEvidenceProvider to append cleanly (%d -> %d)", defaultCount, gotCount)
	}

	// 单测执行检索与清洗时隔离公网探测，专注验证提供方接口与优先级筛选
	svc := &lyricSingerService{
		name:      "ext_provider_test",
		providers: []VocalEvidenceProvider{custom},
	}

	input := &lyricSingerInput{
		Track: &dto.MusicTrackDto{
			ID:      102,
			Name:    "ステラ",
			Artists: []string{"Leo/need"},
		},
		Tasks: []lyricSingerLineTask{
			{Index: 1, Text: "きっとこの世界で 僕らは夢を紡ぐ"},
			{Index: 2, Text: "君を照らす光になるように願いを込めて"},
			{Index: 3, Text: "夢を抱えたまま走った あの日を忘れない"},
			{Index: 4, Text: "夜明けの向こう側まで 響き渡れこの歌"},
		},
	}
	got := searchAndCleanVocalEvidence(context.Background(), svc, input)
	if got == nil || got.ProviderID != "utaten_custom" {
		t.Fatalf("expected custom provider candidate to win, got %+v", got)
	}
	if custom.called.Load() != 1 {
		t.Fatalf("expected custom provider called once, got %d", custom.called.Load())
	}
}

func TestVocalSearchCJKPenetrationAndAntiMismatch(t *testing.T) {
	origPrivate := utils.SafeFetchAllowPrivate
	utils.SafeFetchAllowPrivate = true
	t.Cleanup(func() { utils.SafeFetchAllowPrivate = origPrivate })

	// 1. 验证 CJK 歌名搜索英文 Wiki 时罗马音条目通过 `clean_name in wikitext` 穿透，而非误拒绝英文 title
	var apiHits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		q := r.URL.Query()
		if q.Get("list") == "search" {
			apiHits.Add(1)
			_, _ = w.Write([]byte(`{"query":{"search":[{"title":"Gunjou Sanka","snippet":"群青讃歌 SEKAI"}]}}`))
			return
		}
		if q.Get("action") == "parse" {
			_, _ = w.Write([]byte(`{"parse":{"title":"Gunjou Sanka","wikitext":{"*":"{{Infobox Song|title=群青讃歌}}<tabber>\nJapanese=\n<poem>\n'''{{Ichika|僕らは今日も明日も歩いてゆく}}'''\n'''{{Miku|駆け抜ける世界の果てまでずっと}}'''\n'''{{Minori|願いが溢れ出してゆくこの空に}}'''\n'''{{All|響け群青讃歌 僕らの歌声よ}}'''\n</poem>\n</tabber>"}}}`))
			return
		}
	}))
	defer srv.Close()

	provider := &mediaWikiClusterProvider{
		sites: []mediaWikiSite{{
			ID:       "projectsekai_mock",
			Name:     "Mock PJSK Wiki",
			APIBase:  srv.URL + "/api.php",
			PageBase: srv.URL + "/wiki/",
			Priority: 95,
		}},
	}
	query := buildVocalSearchQuery(&lyricSingerInput{
		Track: &dto.MusicTrackDto{ID: 201, Name: "群青讃歌", Artists: []string{"Eve", "星乃一歌", "初音ミク"}},
		Tasks: []lyricSingerLineTask{
			{Index: 1, Text: "僕らは今日も明日も歩いてゆく"},
			{Index: 2, Text: "駆け抜ける世界の果てまでずっと"},
			{Index: 3, Text: "願いが溢れ出してゆくこの空に"},
			{Index: 4, Text: "響け群青讃歌 僕らの歌声よ"},
		},
	})
	cands, err := provider.Search(context.Background(), query)
	if err != nil {
		t.Fatalf("provider search err: %v", err)
	}
	if len(cands) == 0 || !cleanAndVerifyCandidate(&cands[0], query) {
		t.Fatalf("expected CJK->Romaji penetration to pass cleanAndVerifyCandidate, cands=%+v", cands)
	}
	if apiHits.Load() == 0 {
		t.Fatalf("expected MediaWiki search API to be hit")
	}

	// 2. 验证反向短词误匹配防线：Crazy ∞ nighT 绝不接受同脚本下歌词零重合的 "CRAZY" 异曲
	wrongCand := VocalEvidenceCandidate{
		ProviderID: "mediawiki:bandori",
		SourceName: "Bandori Wiki",
		Title:      "CRAZY",
		Format:     VocalEvidenceFormatWikitext,
		RawContent: "<poem>\n{{Yukina|燃え上がる情熱の炎}}\n{{Lisa|夜空に響かせるメロディ}}\n{{SayO|運命を切り開く力}}\n</poem>",
		Priority:   85,
	}
	nightQuery := buildVocalSearchQuery(&lyricSingerInput{
		Track: &dto.MusicTrackDto{ID: 202, Name: "Crazy ∞ nighT", Artists: []string{"初音ミク", "鏡音リン"}},
		Tasks: []lyricSingerLineTask{
			{Index: 1, Text: "Deep in the forest 迷い込んだ村"},
			{Index: 2, Text: "おいでよ 今夜限りの素敵なパーティー"},
			{Index: 3, Text: "狂ったように踊り明かそう"},
			{Index: 4, Text: "手紙の通りに招かれたのなら"},
		},
	})
	if cleanAndVerifyCandidate(&wrongCand, nightQuery) {
		t.Fatalf("expected mismatched song CRAZY to be rejected by overlap guard for Crazy ∞ nighT")
	}

	// 3. 验证 PJSK 翻唱串台防线：纯虚拟歌手版本（镜音铃/连《おこちゃま戦争》）不得命中含草薙宁宁等 SEKAI 人类翻唱者的 PJSK 词条
	vsQuery := buildVocalSearchQuery(&lyricSingerInput{
		Track: &dto.MusicTrackDto{ID: 203, Name: "おこちゃま戦争", Artists: []string{"Giga", "鏡音リン", "鏡音レン"}},
		Tasks: []lyricSingerLineTask{
			{Index: 1, Text: "昔々のそのまた昔"},
			{Index: 2, Text: "とある貴族の仲良しな兄弟"},
			{Index: 3, Text: "ちゃんちゃらおかしいや"},
			{Index: 4, Text: "ほらほらお出ましだ"},
		},
	})
	pjskCoverCand := VocalEvidenceCandidate{
		ProviderID: "mediawiki:projectsekai",
		SourceName: "Project SEKAI Fandom Wiki",
		Title:      "Okochama Sensou",
		Format:     VocalEvidenceFormatWikitext,
		RawContent: "<tabber>\nSEKAI=\n<poem>\n{{Nene|昔々のそのまた昔}}\n{{Nene|とある貴族の仲良しな兄弟}}\n{{Tsukasa|ちゃんちゃらおかしいや}}\n{{All|ほらほらお出ましだ}}\n</poem>\n</tabber>",
		Priority:   95,
	}
	if cleanAndVerifyCandidate(&pjskCoverCand, vsQuery) {
		t.Fatalf("expected SEKAI human cover to be rejected for Virtual Singer original track")
	}
}

func TestVocalCleanersAllFormats(t *testing.T) {
	t.Run("PJSK nested tabber + unit suffix + ruby + merge", func(t *testing.T) {
		wiki := `== Infobox ==
{{Song|name=テスト}}
== Lyrics ==
<tabber>
Game Version=
<poem>
{{Miku 25|短いバージョン一行目}}
{{Rin vbs|短いバージョン二行目}}
</poem>
|-|
Full Version=
<tabber>
Romaji=
<poem>
{{Miku 25|romaji one}}
</poem>
|-|
Japanese=
<poem>
'''{{Miku 25|{{ruby|夜明け|よあけ}}の{{ruby|空|そら}}を見上げて}}'''
'''{{Miku 25|消えない願いを抱きしめた}}'''
'''{{Rin wxs|走り出した鼓動は止まらない}}'''
'''{{Miku 25 & Rin vbs|僕らの声が重なり合う}}'''
</poem>
|-|
English=
Dawn sky looking up
</tabber>
</tabber>`
		q := &VocalSearchQuery{LyricsLines: make([]string, 30)}
		cleaned := cleanMediaWikiVocalEvidence(wiki, q)
		if !strings.Contains(cleaned, "[初音未来]:\n夜明けの空を見上げて\n消えない願いを抱きしめた") {
			t.Fatalf("expected Miku 25 normalized + merged, got:\n%s", cleaned)
		}
		if !strings.Contains(cleaned, "[镜音铃]:\n走り出した鼓動は止まらない") {
			t.Fatalf("expected Rin wxs normalized, got:\n%s", cleaned)
		}
		if !strings.Contains(cleaned, "[初音未来 & 镜音铃]:\n僕らの声が重なり合う") {
			t.Fatalf("expected multi singer normalized, got:\n%s", cleaned)
		}
		if strings.Contains(cleaned, "短いバージョン") || strings.Contains(cleaned, "romaji one") || strings.Contains(cleaned, "Dawn sky") {
			t.Fatalf("expected Full Japanese tab chosen exclusively, got:\n%s", cleaned)
		}
	})

	t.Run("Sekaipedia tag tabber + Lyrics line + Lyric", func(t *testing.T) {
		wiki := `{{#tag:tabber|
SEKAI=
{{Lyrics line
 | japanese = {{Lyric|Ichika|空の向こう側まで届いて}}
 | romaji = Sora no mukou
 | english = Reach beyond the sky
}}
{{Lyrics line
 | japanese = {{Lyric|Ichika, Minori|重なる想いひとつになって}} / {{Lyric|Tsukasa|ステージの幕が今上がる}}
 | romaji = Kasanaru omoi
}}
{{Lyrics line
 | japanese = {{Lyric|Kanade|静かな夜に溶ける melody}}
}}
{{!}}-{{!}}
English=
Empty translation only
}}`
		cleaned := cleanMediaWikiVocalEvidence(wiki, &VocalSearchQuery{HasCJKContext: true})
		for _, want := range []string{"[星乃一歌]:", "[星乃一歌 & 花里实乃里]:", "[天马司]:", "[宵崎奏]:", "重なる想いひとつになって"} {
			if !strings.Contains(cleaned, want) {
				t.Fatalf("missing %q in Sekaipedia cleaned output:\n%s", want, cleaned)
			}
		}
		if strings.Contains(cleaned, "Sora no mukou") || strings.Contains(cleaned, "Reach beyond") {
			t.Fatalf("romaji/english leaked into Sekaipedia cleaned output:\n%s", cleaned)
		}
	})

	t.Run("Revue Starlight multicc", func(t *testing.T) {
		wiki := `{{Lyrics
|Kan=<poem>
{{Karen|舞台の幕が開く瞬間}}
{{Hikari|運命が二人を引き寄せる}}
{{multicc|c1=Karen|c2=Hikari|c3=Mahiru|キラめきの彼方へ飛び込もう}}
</poem>
|Rom=Butai no maku
}}`
		cleaned := cleanMediaWikiVocalEvidence(wiki, &VocalSearchQuery{HasCJKContext: true})
		if !strings.Contains(cleaned, "[爱城华恋 & 神乐光 & 露崎真昼]:\nキラめきの彼方へ飛び込もう") {
			t.Fatalf("expected multicc trio resolved, got:\n%s", cleaned)
		}
	})

	t.Run("Miraheze color legend + lyrics table", func(t *testing.T) {
		wiki := `== Lyrics ==
{|
| <span style="color:#33CCBB">Hatsune Miku</span> || <span style="color:#FFA500">Kagamine Rin</span>
|}
{| {{lyrics table class}}
! Japanese !! Romaji !! English
|- style="color:#33CCBB;"
| 静かな森の奥深くで || Shizuka na mori || Deep in the quiet forest
|- style="color:#FFA500;"
| 秘密の扉が開かれる || Himitsu no tobira || The secret door opens
|-
| <span style="color:#33CCBB">今宵の宴が</span><span style="color:#FFA500">始まるよ</span> || Koyoi no utage || Tonight's banquet begins
|-
| {{Shared|回り続ける歯車のように}} || Mawari tsuzukeru || Like turning gears
|}`
		cleaned := cleanMediaWikiVocalEvidence(wiki, &VocalSearchQuery{HasCJKContext: true})
		if !strings.Contains(cleaned, "[初音未来]:\n静かな森の奥深くで") ||
			!strings.Contains(cleaned, "[镜音铃]:\n秘密の扉が開かれる") ||
			!strings.Contains(cleaned, "[合唱]:\n回り続ける歯車のように") {
			t.Fatalf("unexpected Miraheze cleaned output:\n%s", cleaned)
		}
		if strings.Contains(cleaned, "Shizuka na mori") || strings.Contains(cleaned, "Deep in the quiet") {
			t.Fatalf("romaji/english table columns leaked:\n%s", cleaned)
		}
	})

	t.Run("Moegirl HTML Lyrics-original span[title]", func(t *testing.T) {
		docHTML := `<html><body><div class="mw-parser-output">
			<div class="Lyrics-line">
				<div class="Lyrics-original"><span class="NoTitlebox" title="初音未来"><ruby>群青<rt>ぐんじょう</rt></ruby>の空が揺れている</span></div>
				<div class="Lyrics-translated">群青的天空在摇曳</div>
			</div>
			<div class="Lyrics-line">
				<div class="Lyrics-original"><span class="NoTitlebox" title="星乃一歌、初音未来">僕らの歌をずっと届けるよ</span></div>
				<div class="Lyrics-translated">永远传达我们的歌声</div>
			</div>
			<div class="Lyrics-line">
				<div class="Lyrics-original"><span class="NoTitlebox" title="合唱">さあ立ち上がれ今すぐ</span></div>
			</div>
		</div></body></html>`
		cleaned := cleanMoegirlHTMLVocalEvidence(docHTML, nil)
		if !strings.Contains(cleaned, "[初音未来]:\n群青の空が揺れている") ||
			!strings.Contains(cleaned, "[星乃一歌 & 初音未来]:\n僕らの歌をずっと届けるよ") ||
			!strings.Contains(cleaned, "[合唱]:\nさあ立ち上がれ今すぐ") {
			t.Fatalf("unexpected Moegirl cleaned output:\n%s", cleaned)
		}
		if strings.Contains(cleaned, "ぐんじょう") || strings.Contains(cleaned, "群青的天空在摇曳") {
			t.Fatalf("ruby rt or translation leaked into Moegirl output:\n%s", cleaned)
		}
	})

	t.Run("Genius bracket headers + noise exclusion", func(t *testing.T) {
		raw := `[00:01.00][Intro]
[ar:Duets]
[Verse 1: Hatsune Miku]
First starlight shining in the night
[Pre-Chorus]
Still following the glowing trail
[Chorus: Hatsune Miku & Kagamine Rin]
Sing out loud until tomorrow dawns
[Guitar Solo]
[Outro: Kagamine Rin]
Echoes fading softly in the dawn`
		cleaned, singers, tags := cleanBracketVocalEvidence(raw)
		if singers < 2 || tags < 3 {
			t.Fatalf("expected >=2 singers and >=3 switches, got singers=%d tags=%d\n%s", singers, tags, cleaned)
		}
		if strings.Contains(cleaned, "[Intro]") || strings.Contains(cleaned, "[Guitar Solo]") || strings.Contains(cleaned, "[ar:Duets]") {
			t.Fatalf("structural or metadata tags leaked:\n%s", cleaned)
		}
	})

	t.Run("Scroll box wrapper + bracket verse singer switching", func(t *testing.T) {
		wiki := `== Lyrics ==
{{Scroll box|content = <poem>
'''[Verse 1: Bradley Cooper]'''
Tell me somethin', girl
Are you happy in this modern world?

'''[Verse 2: Lady Gaga]'''
Tell me something, boy
Aren't you tired tryin' to fill that void?

'''[Chorus: Lady Gaga & Bradley Cooper]'''
I'm off the deep end, watch as I dive in
</poem>}}`
		cleaned := cleanMediaWikiVocalEvidence(wiki, &VocalSearchQuery{})
		for _, want := range []string{
			"[Bradley Cooper]:\nTell me somethin', girl",
			"[Lady Gaga]:\nTell me something, boy",
			"[Lady Gaga & Bradley Cooper]:\nI'm off the deep end, watch as I dive in",
		} {
			if !strings.Contains(cleaned, want) {
				t.Fatalf("missing %q in Scroll box cleaned output:\n%s", want, cleaned)
			}
		}
		if strings.Contains(cleaned, "[Scroll box]:") {
			t.Fatalf("Scroll box wrapper leaked as singer role:\n%s", cleaned)
		}
	})

	t.Run("Japanese blog HTML fullwidth space + br inheritance", func(t *testing.T) {
		blogHTML := `<html><body><div class="entry-content">
			<p>[スペ]　おひさまぱっぱか<br />ぽかぽか<br />[全員]　(はいっ)<br />[テイオー]　大好き</p>
		</div></body></html>`
		cleaned := cleanHTMLVocalEvidence(blogHTML, &VocalSearchQuery{HasCJKContext: true})
		for _, want := range []string{
			"[スペ]:\nおひさまぱっぱか\nぽかぽか",
			"[合唱]:\n(はいっ)",
			"[テイオー]:\n大好き",
		} {
			if !strings.Contains(cleaned, want) {
				t.Fatalf("missing %q in Hatena-style HTML cleaned output:\n%s", want, cleaned)
			}
		}

		// 同时验证当页面带有颜色图例走 extractHTMLColorOrBracketLines 路径时，全角空格与跨 <br /> 继承同样稳定
		withLegendHTML := `<html><body>
			<p><span style="color:#ff6699">スペ</span> / <span style="color:#38bdf8">テイオー</span></p>
			<p>[スペ]　おひさまぱっぱか<br />ぽかぽか<br />[全員]　(はいっ)<br />[テイオー]　大好き</p>
		</body></html>`
		cleanedLegend := cleanHTMLVocalEvidence(withLegendHTML, &VocalSearchQuery{HasCJKContext: true})
		for _, want := range []string{
			"[スペ]:\nおひさまぱっぱか\nぽかぽか",
			"[合唱]:\n(はいっ)",
			"[テイオー]:\n大好き",
		} {
			if !strings.Contains(cleanedLegend, want) {
				t.Fatalf("missing %q in HTML color+bracket cleaned output:\n%s", want, cleanedLegend)
			}
		}
	})

	t.Run("PJSK CopyLyrics Kan wrapper + Mmj unit token", func(t *testing.T) {
		wikitext := `== Lyrics ==
{{CopyLyrics Kan|
{{Lyrics head}}
{{Lyric|Minori|だからもっと 近づきたいから}}
{{Lyric|Haruka|届けたい 君のもとへ}}
{{Lyric|Mmj, Miku|MORE! MORE! JUMP!}}
}}`
		cleaned := cleanMediaWikiVocalEvidence(wikitext, &VocalSearchQuery{HasCJKContext: true})
		for _, want := range []string{
			"[花里实乃里]:\nだからもっと 近づきたいから",
			"[桐谷遥]:\n届けたい 君のもとへ",
			"[MORE MORE JUMP! & 初音未来]:\nMORE! MORE! JUMP!",
		} {
			if !strings.Contains(cleaned, want) {
				t.Fatalf("missing %q in CopyLyrics Kan cleaned output:\n%s", want, cleaned)
			}
		}
		if strings.Contains(cleaned, "CopyLyrics") || strings.Contains(cleaned, "}}") {
			t.Fatalf("unexpected template wrapper leaked in CopyLyrics Kan output:\n%s", cleaned)
		}
	})

	t.Run("Moegirl CSS var immunity + Lyrics-original non-fallback", func(t *testing.T) {
		moegirlHTML := `<html><body>
			<div class="mw-parser-output">
				<a style="color:var(--theme-link-color,#0645ad)">关闭注音</a>
				<div class="Lyrics-original">
					<p>君の声だけが響いてる</p>
					<p>夜空を越えて</p>
				</div>
				<div class="navbox">
					<span style="color:#ff5500">角色A</span>
					<span style="color:#00aaff">角色B</span>
				</div>
				<p><span style="color:#ff5500">页脚歌手1</span>：<span style="color:#00aaff">页脚歌手2</span></p>
				<p><span style="color:#ff5500">无关脚注</span></p>
				<p><span style="color:#00aaff">其他链接</span></p>
			</div>
		</body></html>`
		cleaned := cleanMoegirlHTMLVocalEvidence(moegirlHTML, &VocalSearchQuery{HasCJKContext: true})
		if cleaned != "" {
			t.Fatalf("expected empty output for mono-color .Lyrics-original with var()/navbox noise, got:\n%s", cleaned)
		}
	})

	t.Run("Moegirl title verification & Japanese kana guard", func(t *testing.T) {
		shallowQuery := &VocalSearchQuery{CleanTitle: "Shallow", Artists: []string{"Lady Gaga", "Bradley Cooper"}}
		if moegirlTitleMatchesQuery("Shall We Dance?", "Shallow", shallowQuery) {
			t.Fatalf("expected Shall We Dance? to be rejected for Shallow")
		}
		vtlQuery := &VocalSearchQuery{CleanTitle: "Virtual to LIVE", HasCJKContext: true}
		if !moegirlTitleMatchesQuery("Virtual_to_LIVE", "Virtual to LIVE", vtlQuery) {
			t.Fatalf("expected Virtual_to_LIVE to match Virtual to LIVE")
		}
		gunjouQuery := &VocalSearchQuery{CleanTitle: "群青讃歌", HasCJKContext: true}
		if !moegirlTitleMatchesQuery("群青赞歌", "群青讃歌", gunjouQuery) {
			t.Fatalf("expected simplified Chinese title 群青赞歌 to match 群青讃歌")
		}

		jpTrackQuery := &VocalSearchQuery{
			CleanTitle: "Virtual to LIVE",
			LyricsLines: []string{
				"ねぇ どんな未来が見えるかな",
				"きみと踏み出すステップ",
				"響き合うメロディ",
				"Virtual to LIVE!",
			},
		}
		cnCoverLines := []string{"穿过屏幕的星光", "与你相连的梦想", "Virtual to LIVE", "永远闪耀"}
		if verifyVocalLyricOverlap(cnCoverLines, 2, 85, jpTrackQuery) {
			t.Fatalf("expected pure Chinese cover lines to fail kana ratio guard against Japanese track")
		}
	})

	t.Run("HTML color legend excludes Lyrics-original rainbow, br font blocks, and call parens", func(t *testing.T) {
		// 1) 现代萌百 .Lyrics-original 内无 title 的逐字彩虹着色不应污染颜色图例
		rainbowHTML := `<html><body><div class="mw-parser-output">
			<div class="Lyrics-line">
				<div class="Lyrics-original">
					<span style="color:#4EBD9B">む</span><span style="color:#E8739A">が</span><span style="color:#38bdf8">え</span>
				</div>
			</div>
			<div class="Lyrics-line">
				<div class="Lyrics-original"><span style="color:#4EBD9B">目を開けば</span></div>
			</div>
		</div></body></html>`
		if got := cleanMoegirlHTMLVocalEvidence(rainbowHTML, &VocalSearchQuery{HasCJKContext: true}); got != "" {
			t.Fatalf("expected rainbow Lyrics-original without title to yield empty, got:\n%s", got)
		}

		// 2) Utaten 风格 <font color="#HEX">[角色]<br />歌词</font>(はいっ) 不应污染颜色图例，应平稳走括号提取
		utatenStyleHTML := `<html><body><div>
			<font color="#ff69b4">[スペ]<br />おひさまぱっぱか快晴レース</font>(はいっ)<br />
			<font color="#38bdf8">[テイオー]<br />第一第二第三しーごー</font>
		</div></body></html>`
		cleanedUtaten := cleanHTMLVocalEvidence(utatenStyleHTML, &VocalSearchQuery{HasCJKContext: true})
		for _, want := range []string{"[スペ]:\nおひさまぱっぱか快晴レース(はいっ)", "[テイオー]:\n第一第二第三しーごー"} {
			if !strings.Contains(cleanedUtaten, want) {
				t.Fatalf("expected %q from bracket fallback on br-containing <font>, got:\n%s", want, cleanedUtaten)
			}
		}

		// 3) 应援打 Call 博客括号提示 `（<span style="color:#0000ff">clap×2</span>）` 不应成为歌手图例
		callBlogHTML := `<html><body><article>
			<p>同じ未来を見ていたい（<span style="color:#0000ff">clap×2</span>）</p>
			<p>あの夢手にしたい（<span style="color:#ff0000">Fu！</span>）</p>
			<p>走れ GO</p>
		</article></body></html>`
		if got := cleanHTMLVocalEvidence(callBlogHTML, &VocalSearchQuery{HasCJKContext: true}); got != "" {
			t.Fatalf("expected call/cheering parens not to fabricate singers, got:\n%s", got)
		}
	})
}

func TestBraveAndYahooExternalURLFilter(t *testing.T) {
	if got, ok := extractBraveExternalURL("https://thegreatestshowman.fandom.com/wiki/Rewrite_the_Stars"); !ok || got != "https://thegreatestshowman.fandom.com/wiki/Rewrite_the_Stars" {
		t.Fatalf("expected greatestshowman fandom URL kept, got %q ok=%v", got, ok)
	}
	if _, ok := extractBraveExternalURL("https://en.wikipedia.org/wiki/Rewrite_the_Stars#Composition"); ok {
		t.Fatalf("expected fragment sitelink #Composition filtered out")
	}
	if _, ok := extractBraveExternalURL("https://search.brave.com/search?q=test"); ok {
		t.Fatalf("expected internal brave.com URL filtered out")
	}
	if _, ok := extractBraveExternalURL("https://www.youtube.com/watch?v=12345"); ok {
		t.Fatalf("expected youtube.com filtered out")
	}

	yahooWrapped := "https://rdsig.yahoo.co.jp/RV=2/RE=1700000000/RH=aHR0cHM6Ly9zZWFyY2gueWFob28uY28uanA-/RB=/RU=https%3A%2F%2Fkogane-music.hatenablog.com%2Fentry%2Fumapyoi-densetsu/RK=2/RS=abc"
	if got, ok := extractYahooExternalURL(yahooWrapped); !ok || got != "https://kogane-music.hatenablog.com/entry/umapyoi-densetsu" {
		t.Fatalf("expected unpacked yahoo URL, got %q ok=%v", got, ok)
	}

	q := &VocalSearchQuery{
		CleanTitle: "うまぴょい伝説",
		NormTitle:  normalizeSearchTitle("うまぴょい伝説"),
		Artists:    []string{"ウマ娘"},
	}
	hatenaScore := scoreWebSearchHitURL("https://kogane-music.hatenablog.com/entry/umapyoi-densetsu", "うまぴょい伝説 パート分け 歌詞", q)
	utatenScore := scoreWebSearchHitURL("https://utaten.com/specialArticle/index/6404", "うまぴょい伝説 パート分け 歌詞", q)
	if hatenaScore <= utatenScore {
		t.Fatalf("expected hatenablog (%d) to outrank utaten (%d)", hatenaScore, utatenScore)
	}
	if s := scoreWebSearchHitURL("https://genius.com/Lady-gaga-shallow-lyrics", "Shallow Lyrics", q); s != -1 {
		t.Fatalf("expected blocked genius.com to score -1, got %d", s)
	}
	if s := scoreWebSearchHitURL("https://jp.stanby.com/jobs/123", "Stanby", q); s != -1 {
		t.Fatalf("expected blocked stanby.com to score -1, got %d", s)
	}
	if s := scoreWebSearchHitURL("https://utaten.com/search?title=test", "UtaTen Search", q); s != -1 {
		t.Fatalf("expected utaten /search to score -1, got %d", s)
	}
	if s := scoreWebSearchHitURL("https://ameblo.jp/zakki440/entry-12887039362.html", "コール練習と雑記ブログ440 コール表", q); s != -1 {
		t.Fatalf("expected call/cheering tutorial post without part-division keywords to score -1, got %d", s)
	}
}

func TestLyricSingerPipelineZeroHallucinationPreLLMGate(t *testing.T) {
	soloTrack := dto.MusicTrackDto{
		ID:      301,
		Name:    "Monsters",
		Artists: []string{"Katie Sky"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{soloTrack})
	seedLyricCacheForPipelineTest(t, 301, "ncm", `[00:05.00]I see your monsters
[00:10.00]I see your pain
[00:15.00]Tell me your problems
[00:20.00]I'll chase them away
[00:25.00]I'll be your lighthouse`)

	_, _, wait := stubLyricSingerService(t, nil, nil, nil)
	lyricSingers.complete = nil // 强制进入四层新流水线

	var alignCalls atomic.Int32
	lyricSingers.alignComplete = func(_ context.Context, _ tools.AIConfig, _, _ string) (string, error) {
		alignCalls.Add(1)
		return `{"empty":false}`, nil
	}
	// 注入空提供方列表确保外部搜索零命中
	lyricSingers.providers = []VocalEvidenceProvider{&stubCustomVocalProvider{id: "empty_provider", prio: 99}}

	svc := NewMusicService()
	first, svcerr := svc.GetLyricSingers(context.Background(), 301, "ncm-lrc", "")
	if svcerr != nil {
		t.Fatalf("GetLyricSingers err: %v", svcerr)
	}
	if first.Status != lyricTranslationStatusPending {
		t.Fatalf("expected initial pending status, got %q", first.Status)
	}
	wait()

	if alignCalls.Load() != 0 {
		t.Fatalf("expected ZERO LLM calls under zero-hallucination gate, got %d", alignCalls.Load())
	}

	ready, svcerr := svc.GetLyricSingers(context.Background(), 301, "ncm-lrc", "")
	if svcerr != nil {
		t.Fatalf("GetLyricSingers ready err: %v", svcerr)
	}
	if ready.Status != lyricTranslationStatusReady || len(ready.Singers) != 0 || len(ready.Lines) != 0 {
		t.Fatalf("expected ready empty result for solo track, got %+v", ready)
	}

	var rec model.LyricSingerAnnotation
	if err := repo.GetDB().Where("song_id = ? AND source = ?", 301, "ncm-lrc").First(&rec).Error; err != nil {
		t.Fatalf("expected persisted empty annotation row: %v", err)
	}
	if rec.Model != "pipeline:no_evidence" {
		t.Fatalf("expected model=pipeline:no_evidence, got %q", rec.Model)
	}
}

func TestLyricSingerCompactIndexMappingAndPostSanitize(t *testing.T) {
	duetTrack := dto.MusicTrackDto{
		ID:      302,
		Name:    "ステラ (feat. 星乃一歌&天馬咲希&望月穂波&日野森志歩&初音ミク)",
		Artists: []string{"Leo/need", "初音ミク"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{duetTrack})
	seedLyricCacheForPipelineTest(t, 302, "ncm", `[00:01.00]作詞：じん
[00:05.00]きっとこの世界で光る未来へ
[00:10.00]君を照らす光になるはずさ
[00:15.00]夢を抱えたまま走った日々と
[00:20.00]夜明けの向こう側まで届けよう
[00:25.00]僕らの声が響く場所へ今すぐ`)

	_, _, wait := stubLyricSingerService(t, nil, nil, nil)
	lyricSingers.complete = nil

	lyricSingers.providers = []VocalEvidenceProvider{&stubCustomVocalProvider{
		id:   "mock_pjsk_wiki",
		prio: 95,
		candidates: []VocalEvidenceCandidate{{
			ProviderID: "mock_pjsk_wiki",
			SourceName: "Mock PJSK Wiki",
			Title:      "ステラ",
			URL:        "https://projectsekai.fandom.com/wiki/Stella",
			Format:     VocalEvidenceFormatWikitext,
			RawContent: "<poem>\n{{Ichika|きっとこの世界で光る未来へ}}\n{{Ichika|君を照らす光になるはずさ}}\n{{Miku|夢を抱えたまま走った日々と}}\n{{Miku|夜明けの向こう側まで届けよう}}\n{{All|僕らの声が響く場所へ今すぐ}}\n</poem>",
			Priority:   95,
		}},
	}}

	var alignCalls atomic.Int32
	lyricSingers.alignComplete = func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
		call := alignCalls.Add(1)
		if call == 1 {
			if !strings.Contains(user, "Mock PJSK Wiki") || !strings.Contains(user, "[星乃一歌]:") {
				t.Fatalf("expected cleaned candidate injected in user prompt, got:\n%s", user)
			}
			// 第一次刻意返回残缺长度触发自动重试
			return `{"empty":false,"singers":[{"id":"v1","name":"星乃一歌","role":"person","color":"ocean","align":"left"},{"id":"v2","name":"初音未来","role":"person","color":"ocean","align":"left"}],"mapping":["v1"]}`, nil
		}
		// 第二次故意让 v1 与 v2 颜色重复（均为 ocean）且 align 全部塌陷为 left，测试后处理去重与左右交错修复，同时包含应跳过的制作人行 ""
		return `{
			"empty": false,
			"evidence_source": "Mock PJSK Wiki",
			"evidence_url": "https://projectsekai.fandom.com/wiki/Stella",
			"singers": [
				{"id": "v1", "name": "星乃一歌", "role": "person", "color": "ocean", "align": "left"},
				{"id": "v2", "name": "初音未来", "role": "person", "color": "ocean", "align": "left"},
				{"id": "g1", "name": "合唱", "role": "group", "color": "starry-blue", "align": "center", "members": ["v1", "v2"]}
			],
			"mapping": ["v1", "v1", "v2", "v2", "g1"]
		}`, nil
	}

	svc := NewMusicService()
	_, svcerr := svc.GetLyricSingers(context.Background(), 302, "ncm-lrc", "")
	if svcerr != nil {
		t.Fatalf("GetLyricSingers start err: %v", svcerr)
	}
	wait()

	if alignCalls.Load() != 2 {
		t.Fatalf("expected 2 LLM calls (1 retry on incomplete mapping), got %d", alignCalls.Load())
	}

	ready, svcerr := svc.GetLyricSingers(context.Background(), 302, "ncm-lrc", "")
	if svcerr != nil {
		t.Fatalf("GetLyricSingers ready err: %v", svcerr)
	}
	if ready.Status != lyricTranslationStatusReady || len(ready.Singers) != 3 || len(ready.Lines) != 5 {
		t.Fatalf("unexpected ready result: %+v", ready)
	}

	// 验证颜色互不重复
	seenColors := map[string]bool{}
	alignByID := map[string]string{}
	for _, s := range ready.Singers {
		if seenColors[s.Color] {
			t.Fatalf("duplicate color %q in singers: %+v", s.Color, ready.Singers)
		}
		seenColors[s.Color] = true
		alignByID[s.ID] = s.Align
	}
	if alignByID["v1"] == alignByID["v2"] {
		t.Fatalf("expected v1 and v2 person align to stagger left/right, got %+v", ready.Singers)
	}
	if alignByID["g1"] != "center" {
		t.Fatalf("expected g1 center, got %q", alignByID["g1"])
	}
	if ready.Lines[0].Text != "きっとこの世界で光る未来へ" || ready.Lines[0].Agent != "v1" || ready.Lines[4].Agent != "g1" {
		t.Fatalf("unexpected aligned lines: %+v", ready.Lines)
	}

	// 验证落库 lyric_hash 与 GetLyricSingers 提取结果完全绑定
	input, svcerr := svc.extractLyricSingerInput(context.Background(), &duetTrack, "ncm-lrc")
	if svcerr != nil {
		t.Fatalf("extractLyricSingerInput err: %v", svcerr)
	}
	var rec model.LyricSingerAnnotation
	if err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", 302, "ncm-lrc", input.LyricHash).First(&rec).Error; err != nil {
		t.Fatalf("expected SHA256 lyric_hash bound record: %v", err)
	}
}

func TestLyricSingerLowCoverageGateRejectsGarbage(t *testing.T) {
	track := dto.MusicTrackDto{
		ID:      303,
		Name:    "リモコン",
		Artists: []string{"鏡音リン", "鏡音レン"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	seedLyricCacheForPipelineTest(t, 303, "ncm", `[00:05.00]行一 座る
[00:10.00]行二 ボタン
[00:15.00]行三 押す
[00:20.00]行四 逃げる
[00:25.00]行五 踊る
[00:30.00]行六 歌う`)

	_, _, wait := stubLyricSingerService(t, nil, nil, nil)
	lyricSingers.complete = nil

	lyricSingers.providers = []VocalEvidenceProvider{&stubCustomVocalProvider{
		id:   "mock_short_wiki",
		prio: 90,
		candidates: []VocalEvidenceCandidate{{
			ProviderID: "mock_short_wiki",
			SourceName: "Mock Wiki",
			Title:      "リモコン",
			Format:     VocalEvidenceFormatNormalized,
			RawContent: "[镜音铃]:\n行一 座る\n十分長い追加歌詞テキストをここに入れて閾値通過させる\n\n[镜音连]:\n行二 ボタン\nさらに追加の歌詞テキストを並べて四十文字以上を満たす",
			Priority:   90,
		}},
	}}
	lyricSingers.alignComplete = func(_ context.Context, _ tools.AIConfig, _, _ string) (string, error) {
		// 仅映射 2/6 = 33% (< 60%) 应触发覆盖率防线拒绝
		return `{
			"empty": false,
			"singers": [
				{"id": "v1", "name": "镜音铃", "role": "person", "color": "gold", "align": "left"},
				{"id": "v2", "name": "镜音连", "role": "person", "color": "ocean", "align": "right"}
			],
			"mapping": ["v1", "v2", "", "", "", ""]
		}`, nil
	}

	svc := NewMusicService()
	_, svcerr := svc.GetLyricSingers(context.Background(), 303, "ncm-lrc", "")
	if svcerr != nil {
		t.Fatalf("GetLyricSingers start err: %v", svcerr)
	}
	wait()

	ready, _ := svc.GetLyricSingers(context.Background(), 303, "ncm-lrc", "")
	if ready.Status != lyricTranslationStatusReady || len(ready.Singers) != 0 {
		t.Fatalf("expected low coverage rejected to empty, got %+v", ready)
	}
}

func TestLyricSingerUnnamedTTMLTriggersExternalSearch(t *testing.T) {
	track := dto.MusicTrackDto{
		ID:      304,
		Name:    "モア！ジャンプ！モア！",
		Artists: []string{"MORE MORE JUMP!"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	unnamedTTML := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent xml:id="v1" type="person"/>
  <ttm:agent xml:id="v2" type="person"/>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:03.000" ttm:agent="v1">だからもっと 近づきたいから</p>
  <p begin="00:04.000" end="00:06.000" ttm:agent="v1">全力で跳ねていこうよ</p>
  <p begin="00:07.000" end="00:09.000" ttm:agent="v2">もっと 声を聞かせてよ</p>
  <p begin="00:10.000" end="00:12.000" ttm:agent="v2">届くまで歌い続けるから</p>
  <p begin="00:13.000" end="00:15.000" ttm:agent="v1">君と描く未来のステージ</p>
</div></body></tt>`
	stubLyricSources(t, map[string]lyricSourceResult{
		"ttml": {
			data:    &dto.MusicTTMLDto{Source: "ttml-amll", TTML: unnamedTTML},
			outcome: lyricOutcomeHit,
		},
	})

	_, _, wait := stubLyricSingerService(t, nil, nil, nil)
	lyricSingers.complete = nil

	custom := &stubCustomVocalProvider{
		id:   "mock_pjsk_unnamed_ttml",
		prio: 95,
		candidates: []VocalEvidenceCandidate{{
			ProviderID: "mock_pjsk_unnamed_ttml",
			SourceName: "Mock PJSK Wiki",
			Title:      "MORE! JUMP! MORE!",
			URL:        "https://projectsekai.fandom.com/wiki/MORE!_JUMP!_MORE!",
			Format:     VocalEvidenceFormatNormalized,
			RawContent: "[花里实乃里]:\nだからもっと 近づきたいから\n全力で跳ねていこうよ\n君と描く未来のステージ\n\n[桐谷遥]:\nもっと 声を聞かせてよ\n届くまで歌い続けるから",
			Priority:   95,
		}},
	}
	lyricSingers.providers = []VocalEvidenceProvider{custom}

	var sawExternalEvidence atomic.Bool
	var sawUnnamedTTMLAgent atomic.Bool
	lyricSingers.alignComplete = func(_ context.Context, _ tools.AIConfig, _, user string) (string, error) {
		if strings.Contains(user, "[花里实乃里]:") && strings.Contains(user, "[桐谷遥]:") {
			sawExternalEvidence.Store(true)
		}
		if strings.Contains(user, "agent=v1") || strings.Contains(user, "【TTML 声明声部清单】") {
			sawUnnamedTTMLAgent.Store(true)
		}
		return `{
			"empty": false,
			"evidence_source": "Mock PJSK Wiki",
			"evidence_url": "https://projectsekai.fandom.com/wiki/MORE!_JUMP!_MORE!",
			"singers": [
				{"id": "v1", "name": "花里实乃里", "role": "person", "color": "cherry-blossom", "align": "left"},
				{"id": "v2", "name": "桐谷遥", "role": "person", "color": "ocean", "align": "right"}
			],
			"mapping": ["v1", "v1", "v2", "v2", "v1"]
		}`, nil
	}

	svc := NewMusicService()
	first, svcerr := svc.GetLyricSingers(context.Background(), 304, "ttml-amll", "")
	if svcerr != nil || first.Status != lyricTranslationStatusPending {
		t.Fatalf("expected pending for unnamed TTML, got %+v, err=%v", first, svcerr)
	}
	wait()

	if custom.called.Load() == 0 {
		t.Fatalf("expected external provider search to run for unnamed TTML")
	}
	if !sawExternalEvidence.Load() {
		t.Fatalf("expected cleaned external evidence injected into aligner prompt for unnamed TTML")
	}
	if sawUnnamedTTMLAgent.Load() {
		t.Fatalf("expected unnamed TTML agents to be omitted from aligner prompt when external evidence is present")
	}

	ready, svcerr := svc.GetLyricSingers(context.Background(), 304, "ttml-amll", "")
	if svcerr != nil || ready.Status != lyricTranslationStatusReady || len(ready.Singers) != 2 || len(ready.Lines) != 5 {
		t.Fatalf("unexpected unnamed TTML ready result: %+v, err=%v", ready, svcerr)
	}
	if ready.Singers[0].Name != "花里实乃里" || ready.Singers[1].Name != "桐谷遥" {
		t.Fatalf("expected real character names resolved from external evidence, got %+v", ready.Singers)
	}
}

func TestVocalCleanerGeniusAndHatenaAndTitleBracket(t *testing.T) {
	geniusHTML := `<html><body>
		<nav>Noise Navigation</nav>
		<div data-lyrics-container="true">
			<div data-exclude-from-selection="true">156 Contributors Rewrite The Stars Lyrics Read More</div>
			[hololive IDOL PROJECT「Prism Melody」歌詞]<br/>
			[Verse 1: Phillip Carlyle]<br/>
			<a href="/anno">You know I want you</a><br/>
			It's not a secret I try to hide<br/>
			[Verse 2: Anne Wheeler]<br/>
			You know you want me<br/>
		</div>
		<div data-lyrics-container="true">
			[Chorus: Phillip Carlyle &amp; Anne Wheeler]<br/>
			What if we rewrite the stars
		</div>
	</body></html>`

	cleanedGenius := cleanHTMLVocalEvidence(geniusHTML, nil)
	for _, banned := range []string{"156 Contributors", "Noise Navigation", "Prism Melody"} {
		if strings.Contains(cleanedGenius, banned) {
			t.Fatalf("expected %q stripped from Genius cleaned output, got:\n%s", banned, cleanedGenius)
		}
	}
	for _, want := range []string{"[Phillip Carlyle]:", "[Anne Wheeler]:", "[Phillip Carlyle & Anne Wheeler]:", "What if we rewrite the stars"} {
		if !strings.Contains(cleanedGenius, want) {
			t.Fatalf("expected %q in Genius cleaned output, got:\n%s", want, cleanedGenius)
		}
	}

	hatenaHTML := `<html><body>
		<aside>人気ランキング [1位]</aside>
		<div class="entry-content">
			<p>[スペ]　おひさまぱっぱか　快晴レース<br />[テイオー]　第一第二第三しーごー<br />[全員]　うまだっち</p>
		</div>
	</body></html>`

	cleanedHatena := cleanHTMLVocalEvidence(hatenaHTML, nil)
	if strings.Contains(cleanedHatena, "人気ランキング") {
		t.Fatalf("expected sidebar noise stripped from Hatena entry-content, got:\n%s", cleanedHatena)
	}
	for _, want := range []string{"[スペ]:", "[テイオー]:", "[合唱]:", "第一第二第三しーごー"} {
		if !strings.Contains(cleanedHatena, want) {
			t.Fatalf("expected %q in Hatena cleaned output, got:\n%s", want, cleanedHatena)
		}
	}

	if role, secOnly := parseBracketRoleToken("hololive IDOL PROJECT「Prism Melody」歌詞"); !secOnly || role != "" {
		t.Fatalf("expected title lyric header treated as sectionOnly=true, got role=%q secOnly=%v", role, secOnly)
	}
}

func TestCleanMoegirlMultiTableSelectsBestVersion(t *testing.T) {
	htmlDoc := `<div class="mw-parser-output">
		<div class="Lyrics">
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="无关翻唱A">第一句测试歌词足够长超过阈值</span></div></div>
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="无关翻唱B">第二句测试歌词继续延伸凑足长度</span></div></div>
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="无关翻唱A">第三句翻唱版本完全不同的末尾内容</span></div></div>
		</div>
		<div class="Lyrics">
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="洛天依">上古之初 混沌未开 阴阳分两仪</span></div></div>
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="乐正绫">九九八十一难 世事本无常</span></div></div>
			<div class="Lyrics-line"><div class="Lyrics-original"><span title="洛天依">西行路上 历经沧桑 初心终不改</span></div></div>
		</div>
	</div>`

	q := &VocalSearchQuery{
		RawTitle:    "九九八十一",
		CleanTitle:  "九九八十一",
		Artists:     []string{"洛天依", "乐正绫"},
		LyricsLines: []string{"上古之初 混沌未开 阴阳分两仪", "九九八十一难 世事本无常", "西行路上 历经沧桑 初心终不改"},
	}

	cleaned := cleanMoegirlHTMLVocalEvidence(htmlDoc, q)
	if strings.Contains(cleaned, "无关翻唱A") || strings.Contains(cleaned, "无关翻唱B") {
		t.Fatalf("expected multi-table cleaner to pick only the matching duet table without concatenation, got:\n%s", cleaned)
	}
	for _, want := range []string{"[洛天依]:", "[乐正绫]:", "上古之初 混沌未开 阴阳分两仪", "九九八十一难 世事本无常"} {
		if !strings.Contains(cleaned, want) {
			t.Fatalf("expected %q in selected Moegirl container, got:\n%s", want, cleaned)
		}
	}

	// 验证日语假名歌曲不会被误杀罗马音 Wiki（仅拒绝高中文比例的中文翻唱）
	jpQ := &VocalSearchQuery{
		LyricsLines: []string{
			"きらきら光る星空を見上げて",
			"君と歩いた季節を思い出す",
			"声を出してさあ歌おうよ",
			"笑顔のまま明日へ進もう",
		},
	}
	romajiLines := []string{
		"Kirakira hikaru hoshizora wo miagete",
		"Kimi to aruita kisetsu wo omoidasu",
		"Koe wo dashite saa utaou yo",
		"Egao no mama ashita e susumou",
	}
	if !verifyVocalLyricOverlap(romajiLines, 0, 88, jpQ) {
		t.Fatalf("expected Romaji authoritative wiki (priority 88) not to be rejected by CJK-cover guard")
	}
	chineseCoverLines := []string{
		"仰望闪耀发光的星空",
		"想起曾与你漫步的季节",
		"放声歌唱吧大家一起",
		"带着笑容迈向明天",
	}
	if verifyVocalLyricOverlap(chineseCoverLines, 0, 88, jpQ) {
		t.Fatalf("expected pure Chinese cover of Japanese kana song to be rejected")
	}
}

// TestEvalPlaylistVocalPipeline 本地真实 30 首歌单端到端评测验收（仅在 NEO_RUN_VOCAL_EVAL=1 时触发，严禁打印任何密钥配置）
func TestEvalPlaylistVocalPipeline(t *testing.T) {
	if os.Getenv("NEO_RUN_VOCAL_EVAL") != "1" {
		t.Skip("set NEO_RUN_VOCAL_EVAL=1 to run the live 30-track vocal segmentation acceptance test")
	}

	dbPath := strings.TrimSpace(os.Getenv("NEO_EVAL_DB_PATH"))
	if dbPath == "" {
		if _, err := os.Stat("../../data/data.db"); err == nil {
			dbPath = "../../data/data.db"
		} else {
			dbPath = "./data/data.db"
		}
	}
	_ = os.Setenv("DB_DRIVER", "sqlite")
	_ = os.Setenv("DB_PATH", dbPath)
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init eval database %s: %v", dbPath, err)
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		t.Fatal("ai_api_base_url / ai_api_key / ai_model must be configured in the database")
	}

	playlistPath := filepath.Join("..", "..", "scripts", "actual_playlist_30.json")
	rawTracks, err := os.ReadFile(playlistPath)
	if err != nil {
		t.Fatalf("read %s: %v", playlistPath, err)
	}
	var rawItems []struct {
		ID      int64           `json:"id"`
		Name    string          `json:"name"`
		Artists json.RawMessage `json:"artists"`
		Aliases []string        `json:"aliases,omitempty"`
		Album   string          `json:"album,omitempty"`
	}
	if err := json.Unmarshal(rawTracks, &rawItems); err != nil {
		t.Fatalf("unmarshal playlist tracks: %v", err)
	}
	tracks := make([]dto.MusicTrackDto, 0, len(rawItems))
	for _, item := range rawItems {
		var artists []string
		if len(item.Artists) > 0 && item.Artists[0] == '[' {
			_ = json.Unmarshal(item.Artists, &artists)
		} else {
			var joined string
			if json.Unmarshal(item.Artists, &joined) == nil {
				for _, p := range strings.Split(joined, "/") {
					if trimmed := strings.TrimSpace(p); trimmed != "" {
						artists = append(artists, trimmed)
					}
				}
			}
		}
		tracks = append(tracks, dto.MusicTrackDto{
			ID:      item.ID,
			Name:    item.Name,
			Artists: artists,
			Aliases: item.Aliases,
			Album:   item.Album,
		})
	}

	// 将测试歌单写入内存歌单缓存并清理历史污染记录（含未匹配/制作人/旧脚本标记）
	ncmCfg := tools.GetNCMConfig()
	if ncmCfg.Configured() {
		key := fmt.Sprintf("%s\n%s\n%d", ncmCfg.BaseURL, ncmCfg.Cookie, ncmCfg.PlaylistID)
		storePlaylist(key, tracks)
	}

	db := repo.GetDB()
	// 让本地库 LyricCache 在评测中作为高速兜底快照（并在本地 NCM 侧车未启动时免除无效等待），同时允许 QQ/AMLL 实时抓取补全缺失歌词
	ncmReachable := false
	if ncmCfg.Configured() {
		probeClient := &http.Client{Timeout: 1500 * time.Millisecond}
		if probeResp, pErr := probeClient.Get(strings.TrimRight(ncmCfg.BaseURL, "/") + "/"); pErr == nil {
			probeResp.Body.Close()
			ncmReachable = true
		}
	}
	origSourceFetch := lyricSourceFetch
	lyricSourceFetch = func(s *MusicService, c context.Context, id int64, kind string) lyricSourceResult {
		var lc model.LyricCache
		if err := db.WithContext(c).Where("song_id = ?", id).First(&lc).Error; err == nil && lc.Data != "" {
			var snap dto.MusicLyricCacheDto
			if json.Unmarshal([]byte(lc.Data), &snap) == nil {
				switch kind {
				case "ncm":
					if snap.Ncm != nil {
						return lyricSourceResult{kind: "ncm", data: snap.Ncm, outcome: lyricOutcomeHit}
					}
				case "ttml":
					if snap.TTML != nil {
						return lyricSourceResult{kind: "ttml", data: snap.TTML, outcome: lyricOutcomeHit}
					}
				case "qq":
					if snap.QQ != nil && (snap.QQ.Lyric != "" || snap.QQ.TTML != "") {
						return lyricSourceResult{kind: "qq", data: snap.QQ, outcome: lyricOutcomeHit}
					}
				case "kugou":
					if snap.Kugou != nil {
						return lyricSourceResult{kind: "kugou", data: snap.Kugou, outcome: lyricOutcomeHit}
					}
				}
			}
		}
		if kind == "ncm" && !ncmReachable {
			return lyricSourceResult{kind: "ncm", outcome: lyricOutcomeMiss}
		}
		return origSourceFetch(s, c, id, kind)
	}
	t.Cleanup(func() { lyricSourceFetch = origSourceFetch })

	if delRes := db.Where("model LIKE ? OR data LIKE ? OR data LIKE ?", "%:pipeline", "%未匹配%", "%制作人%").
		Delete(&model.LyricSingerAnnotation{}); delRes.Error != nil {
		t.Fatalf("cleanup dirty annotations: %v", delRes.Error)
	} else {
		t.Logf("cleaned %d historical dirty rows from lyric_singer_annotations", delRes.RowsAffected)
	}
	// 默认清理本次评测 30 首的非 TTML 历史缓存，确保真实经过新四层管线端到端执行（设 NEO_EVAL_KEEP_EXISTING=1 可跳过）
	if os.Getenv("NEO_EVAL_KEEP_EXISTING") != "1" {
		trackIDs := make([]int64, 0, len(tracks))
		for _, tr := range tracks {
			trackIDs = append(trackIDs, tr.ID)
		}
		if delRes := db.Where("song_id IN ? AND model != ?", trackIDs, "ttml:agents").Delete(&model.LyricSingerAnnotation{}); delRes.Error != nil {
			t.Fatalf("cleanup playlist non-TTML annotations: %v", delRes.Error)
		} else {
			t.Logf("cleared %d existing non-TTML playlist rows for live evaluation", delRes.RowsAffected)
		}
	}

	svc := NewMusicService()
	ctx := context.Background()

	type trackEvalResult struct {
		Track      dto.MusicTrackDto
		Status     string
		Source     string
		Model      string
		Singers    int
		Lines      int
		TotalLines int
		SoloTrack  bool
		Err        string
		Duration   time.Duration
	}

	results := make([]trackEvalResult, len(tracks))
	var mu sync.Mutex
	var wg sync.WaitGroup
	gate := make(chan struct{}, 2) // 适度控并发，兼顾速度与 Wiki 礼貌抓取

	for idx, tr := range tracks {
		idx := idx
		tr := tr
		wg.Add(1)
		go func() {
			defer wg.Done()
			gate <- struct{}{}
			defer func() { <-gate }()

			start := time.Now()
			res := trackEvalResult{
				Track:     tr,
				SoloTrack: tr.ID == 28481189 || tr.ID == 28578696 || tr.ID == 2045878963, // 纯独唱或无声部拆分曲目允许为空
			}

			pollSource := ""
			resp, callErr := svc.GetLyricSingers(ctx, tr.ID, pollSource, "")
			if callErr != nil {
				res.Err = callErr.Message
				res.Duration = time.Since(start)
				mu.Lock()
				results[idx] = res
				mu.Unlock()
				return
			}
			if resp.Source != "" {
				pollSource = resp.Source
			}

			deadline := time.Now().Add(150 * time.Second)
			for resp.Status == lyricTranslationStatusPending && time.Now().Before(deadline) {
				time.Sleep(1500 * time.Millisecond)
				resp, callErr = svc.GetLyricSingers(ctx, tr.ID, pollSource, "")
				if callErr != nil {
					res.Err = callErr.Message
					break
				}
				if resp.Source != "" {
					pollSource = resp.Source
				}
			}
			res.Duration = time.Since(start)
			if resp != nil {
				res.Status = resp.Status
				res.Source = resp.Source
				if res.Source == "" {
					res.Source = pollSource
				}
				res.Singers = len(resp.Singers)
				res.Lines = len(resp.Lines)

				if res.Source != "" {
					if input, inErr := svc.extractLyricSingerInput(ctx, &tr, res.Source); inErr == nil {
						res.TotalLines = len(input.Tasks)
						var rec model.LyricSingerAnnotation
						if dbErr := db.Where("song_id = ? AND source = ? AND lyric_hash = ?", tr.ID, input.Source, input.LyricHash).First(&rec).Error; dbErr == nil {
							res.Model = rec.Model
						}
					}
				}

				// 校验颜色不重复与左右排版（有多位个人歌手时）
				seenColors := map[string]bool{}
				personLeft, personRight := 0, 0
				for _, s := range resp.Singers {
					if seenColors[s.Color] {
						res.Err = fmt.Sprintf("duplicate color %q", s.Color)
					}
					seenColors[s.Color] = true
					if s.Role == "person" {
						if s.Align == "left" {
							personLeft++
						} else if s.Align == "right" {
							personRight++
						}
					}
				}
				if personLeft+personRight >= 2 && (personLeft == 0 || personRight == 0) {
					res.Err = fmt.Sprintf("non-alternating person align: left=%d right=%d", personLeft, personRight)
				}
			}
			mu.Lock()
			results[idx] = res
			mu.Unlock()
		}()
	}
	wg.Wait()

	var eligibleMulti, hitMulti, soloReadyEmpty, skippedNoLyric int
	for i, r := range results {
		if r.Err == "lyric_not_found" {
			skippedNoLyric++
			t.Logf("[%02d] %d %-24s | SKIP_NO_LYRIC (%v)", i+1, r.Track.ID, clipRunes(r.Track.Name, 22), r.Duration.Round(time.Millisecond))
			continue
		}
		if r.SoloTrack {
			if r.Status == lyricTranslationStatusReady && r.Singers == 0 && r.Err == "" {
				soloReadyEmpty++
			} else {
				t.Errorf("solo/no-evidence track %d (%s) expected status=ready & singers=0, got status=%s singers=%d err=%s",
					r.Track.ID, r.Track.Name, r.Status, r.Singers, r.Err)
			}
			t.Logf("[%02d] %d %-24s | SOLO status=%s singers=%d model=%s (%v)",
				i+1, r.Track.ID, clipRunes(r.Track.Name, 22), r.Status, r.Singers, r.Model, r.Duration.Round(time.Millisecond))
			continue
		}
		eligibleMulti++
		if r.Status == lyricTranslationStatusReady && r.Singers >= 2 && r.Lines > 0 && r.Err == "" {
			hitMulti++
		}
		t.Logf("[%02d] %d %-24s | %-9s status=%-7s singers=%2d lines=%3d/%-3d model=%-22s err=%s (%v)",
			i+1, r.Track.ID, clipRunes(r.Track.Name, 22), r.Source, r.Status, r.Singers, r.Lines, r.TotalLines, r.Model, r.Err, r.Duration.Round(time.Millisecond))
	}

	if eligibleMulti == 0 {
		t.Fatalf("no multi-singer tracks had cached/fetched lyrics (skippedNoLyric=%d)", skippedNoLyric)
	}
	hitRate := float64(hitMulti) * 100 / float64(eligibleMulti)
	t.Logf("=== EVAL SUMMARY: multi_hit=%d/%d (%.1f%%), solo_ready_empty=%d, skipped_no_lyric=%d ===",
		hitMulti, eligibleMulti, hitRate, soloReadyEmpty, skippedNoLyric)
	if hitRate < 80.0 {
		t.Fatalf("multi-singer alignment hit rate %.1f%% (%d/%d) < 80.0%% acceptance target", hitRate, hitMulti, eligibleMulti)
	}
}
