package service

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

// stubLyricSources 各来源返回固定结果（没有列出的来源为获取失败），选出的版本总是保存；delays 为各来源返回前的等待
func stubLyricSources(t *testing.T, results map[string]lyricSourceResult, delays ...map[string]time.Duration) *sync.Map {
	t.Helper()
	var mu sync.Mutex
	current := results
	calls := &sync.Map{}
	originalFetch, originalPersist, originalTimeout := lyricSourceFetch, lyricVersionPersistable, lyricStreamSourceTimeout
	lyricSourceFetch = func(_ *MusicService, ctx context.Context, id int64, kind string) lyricSourceResult {
		count, _ := calls.LoadOrStore(kind, new(int))
		mu.Lock()
		*count.(*int)++
		result, ok := current[kind]
		mu.Unlock()
		if len(delays) > 0 {
			time.Sleep(delays[0][kind])
		}
		if !ok {
			return lyricSourceResult{kind: kind}
		}
		result.kind = kind
		return result
	}
	lyricVersionPersistable = func(*MusicService, context.Context, int64) bool { return true }
	lyricStreamSourceTimeout = time.Second
	t.Cleanup(func() {
		lyricSourceFetch, lyricVersionPersistable, lyricStreamSourceTimeout = originalFetch, originalPersist, originalTimeout
	})
	return calls
}

const pipaNCMLrc = `[00:10.00]浔阳江头夜送客， 枫叶荻花秋瑟瑟。
[00:16.00]主人下马客在船， 举酒欲饮无管弦。`

const pipaNCMYrc = `[10000,6000](10000,3000,0)浔阳江头夜送客， (13000,3000,0)枫叶荻花秋瑟瑟。
[16000,6000](16000,3000,0)主人下马客在船， (19000,3000,0)举酒欲饮无管弦。`

// pipaTTML 与网易云的分行不同：每句诗拆成两行（且有错字「狄花」），带背景人声、翻译与音译
const pipaTTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><ttm:agent type="person" xml:id="v1"/>
<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
<translations><translation xml:lang="en"><text for="L2">Maple leaves and reed flowers rustle in autumn</text></translation></translations>
<transliterations><transliteration xml:lang="ja"><text for="L1">じんよう</text></transliteration><transliteration xml:lang="zh-Latn"><text for="L3"><span begin="00:16.000" end="00:17.000">zhu ren</span></text></transliteration></transliterations>
</iTunesMetadata></metadata></head>
<body><div>
<p begin="00:13.000" end="00:16.000" itunes:key="L2" ttm:agent="v1"><span begin="00:13.000" end="00:14.000">枫叶</span><span begin="00:14.000" end="00:16.000">狄花秋瑟瑟</span></p>
<p begin="00:10.000" end="00:13.000" itunes:key="L1" ttm:agent="v1"><span begin="00:10.000" end="00:11.000">浔阳</span><span begin="00:11.000" end="00:12.800">江头</span><span begin="00:12.800" end="00:13.000">夜送客</span><span ttm:role="x-bg"><span begin="00:12.000" end="00:13.000">(和声)</span></span><span ttm:role="x-translation" xml:lang="en">Seeing off a guest</span></p>
<p begin="00:16.000" end="00:19.000" itunes:key="L3"><span begin="00:16.000" end="00:17.000">主人</span> <span begin="00:17.000" end="00:19.000">下马客在船</span><span ttm:role="x-roman">zhu ren xia ma</span></p>
<p begin="00:19.000" end="00:22.000" itunes:key="L4">举酒欲饮无管弦</p>
</div></body></tt>`

func TestParseTTMLLyrics(t *testing.T) {
	got := parseTTMLLyrics(pipaTTML)
	texts := make([]string, len(got.Lines))
	for i, line := range got.Lines {
		texts[i] = line.Text
	}
	// 按开始时间排序；跳过背景人声与翻译、音译；span 之间的空白归到前一个音节；没有音节时间的行整行为一句
	want := []string{"浔阳江头夜送客", "枫叶狄花秋瑟瑟", "主人 下马客在船", "举酒欲饮无管弦"}
	if !reflect.DeepEqual(texts, want) {
		t.Fatalf("lines = %q, want %q", texts, want)
	}
	if got.Lines[0].Start != 10000 || got.Lines[1].Start != 13000 {
		t.Fatalf("starts = %d, %d", got.Lines[0].Start, got.Lines[1].Start)
	}
	// 翻译：行内的 x-translation 与 head 中按 key 提供的；音译只算拉丁字母的（只有假名的读音不算）
	if !reflect.DeepEqual(got.Translations, []string{"Seeing off a guest", "Maple leaves and reed flowers rustle in autumn", "", ""}) {
		t.Fatalf("translations = %q", got.Translations)
	}
	if !got.HasTranslation || !got.HasRomanization || !got.WordTimed {
		t.Fatalf("flags = %+v", got)
	}
	// 唱满 1.5 秒的音节记为长音
	if held := got.Lines[0].Held; held == nil || held.Text != "江头" || held.Duration != 1800 || held.Tail {
		t.Fatalf("held = %+v", got.Lines[0].Held)
	}
	if held := got.Lines[1].Held; held == nil || held.Text != "狄花秋瑟瑟" || !held.Tail {
		t.Fatalf("tail held = %+v", got.Lines[1].Held)
	}
	if parsed := parseTTMLLyrics("<tt><body><p>broken"); len(parsed.Lines) != 0 {
		t.Fatalf("broken document parsed: %+v", parsed)
	}
	if ms, ok := parseTTMLTime("1:02:03.5"); !ok || ms != 3723500 {
		t.Fatalf("clock time = %d %v", ms, ok)
	}
	if ms, ok := parseTTMLTime("12.3s"); !ok || ms != 12300 {
		t.Fatalf("seconds = %d %v", ms, ok)
	}
	if ms, ok := parseTTMLTime("450ms"); !ok || ms != 450 {
		t.Fatalf("ms = %d %v", ms, ok)
	}
}

func lyricPart(text string) *dto.MusicLyricPart { return &dto.MusicLyricPart{Lyric: text} }

func TestRankLyricCandidates(t *testing.T) {
	ncmYrc := &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc), Yrc: lyricPart(pipaNCMYrc)}
	qqQrc := &dto.MusicQQLyricDto{Format: "qrc", Lyric: "[10000,6000]浔阳江头夜送客(10000,6000)", Translation: "[00:10.00]Seeing off a guest"}
	kugouLrc := &dto.MusicKugouLyricDto{Format: "lrc", Lyric: pipaNCMLrc}
	kinds := func(candidates []lyricVersionCandidate) []string {
		result := []string{}
		for _, candidate := range candidates {
			result = append(result, candidate.kind+"/"+candidate.lines.Source)
		}
		return result
	}

	// 同为逐字：QQ 音乐自带翻译，排在网易云前面；逐行最后
	got := rankLyricCandidates(lyricSources{ncm: ncmYrc, qq: qqQrc, kugou: kugouLrc})
	if want := []string{"qq/qq-qrc", "ncm/ncm-yrc", "kugou/kugou-lrc"}; !reflect.DeepEqual(kinds(got), want) {
		t.Fatalf("ranked = %v, want %v", kinds(got), want)
	}
	// 质量相同时按 网易云 > QQ 音乐 的顺序；TTML（不论来源）总在最前，按 QQ 歌曲收录的记为 ttml-amll
	qqQrc.Translation, qqQrc.TTML = "", pipaTTML
	got = rankLyricCandidates(lyricSources{ncm: ncmYrc, qq: qqQrc})
	if want := []string{"ttml/ttml-amll", "ncm/ncm-yrc", "qq/qq-qrc"}; !reflect.DeepEqual(kinds(got), want) {
		t.Fatalf("ranked = %v, want %v", kinds(got), want)
	}
	got = rankLyricCandidates(lyricSources{ttml: &dto.MusicTTMLDto{Source: musicTTMLSourceCustom, TTML: pipaTTML}})
	if want := []string{"ttml/ttml-custom"}; !reflect.DeepEqual(kinds(got), want) {
		t.Fatalf("ranked = %v, want %v", kinds(got), want)
	}
	// 没有歌词的占位、纯音乐不算来源
	got = rankLyricCandidates(lyricSources{
		ncm: &dto.MusicLyricDto{Lrc: lyricPart("[00:00.00]pure_music_without_lyric")},
		qq:  &dto.MusicQQLyricDto{Format: "lrc", Lyric: "[00:00.00]此歌曲为没有填词的纯音乐，请您欣赏"},
	})
	if len(got) != 0 {
		t.Fatalf("instrumental ranked = %v", kinds(got))
	}
}

func TestChooseLyricVersion(t *testing.T) {
	candidate := func(kind string, tier, extras int) lyricVersionCandidate {
		return lyricVersionCandidate{kind: kind, tier: tier, lines: &lyricVersionLines{Source: kind, Extras: extras}}
	}
	failed := func(string) lyricOutcome { return lyricOutcomeFailed }
	missing := func(string) lyricOutcome { return lyricOutcomeMiss }
	ranked := []lyricVersionCandidate{candidate("ncm", 1, 1), candidate("qq", 1, 1), candidate("kugou", 2, 0)}
	cases := []struct {
		name         string
		candidates   []lyricVersionCandidate
		outcome      func(string) lyricOutcome
		pin, stored  string
		want         string
		wantKeep     bool
		wantNoLyrics bool
	}{
		{name: "first decision takes the best", candidates: ranked, outcome: failed, want: "ncm"},
		{name: "pin wins", candidates: ranked, outcome: failed, pin: "kugou", stored: "ncm", want: "kugou"},
		{name: "unavailable pin falls back to stickiness", candidates: ranked, outcome: failed, pin: "ttml", stored: "qq", want: "qq"},
		{name: "equal quality keeps the stored version", candidates: ranked, outcome: failed, stored: "qq", want: "qq"},
		{name: "strictly better source upgrades", candidates: append([]lyricVersionCandidate{candidate("ttml", 0, 0)}, ranked...), outcome: failed, stored: "qq", want: "ttml"},
		{name: "failed fetch never downgrades", candidates: ranked, outcome: failed, stored: "ttml", wantKeep: true},
		{name: "definite miss reselects", candidates: ranked, outcome: missing, stored: "ttml", want: "ncm"},
		{name: "no lyrics at all", outcome: missing, stored: "ttml", wantNoLyrics: true},
	}
	for _, c := range cases {
		chosen, keep := chooseLyricVersion(c.candidates, c.outcome, c.pin, c.stored)
		switch {
		case c.wantKeep:
			if !keep {
				t.Errorf("%s: should keep the stored version, chose %+v", c.name, chosen)
			}
		case c.wantNoLyrics:
			if keep || chosen != nil {
				t.Errorf("%s: should have no version, got %+v keep=%v", c.name, chosen, keep)
			}
		case keep || chosen == nil || chosen.kind != c.want:
			t.Errorf("%s: chose %+v keep=%v, want %s", c.name, chosen, keep, c.want)
		}
	}
}

// runLyricVersion 跑一次选择并返回推送的事件名与 decided 的结果
func runLyricVersion(t *testing.T, id int64) ([]string, dto.MusicLyricVersionDto) {
	t.Helper()
	var names []string
	var decided dto.MusicLyricVersionDto
	NewMusicService().StreamLyrics(context.Background(), id, false, func(event string, data any) error {
		names = append(names, event)
		if event == "decided" {
			decided = data.(dto.MusicLyricVersionDto)
		}
		return nil
	})
	return names, decided
}

func TestLyricVersionStickiness(t *testing.T) {
	setupTTMLDB(t)
	ncm := &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc), Yrc: lyricPart(pipaNCMYrc)}
	qq := &dto.MusicQQLyricDto{Format: "qrc", Lyric: "[10000,6000]浔阳江头夜送客(10000,6000)"}
	ttml := &dto.MusicTTMLDto{Source: musicTTMLSourceAMLL, TTML: pipaTTML}
	results := map[string]lyricSourceResult{
		"qq":    {data: qq, outcome: lyricOutcomeHit, qqTTML: lyricOutcomeMiss},
		"ncm":   {outcome: lyricOutcomeFailed},
		"ttml":  {outcome: lyricOutcomeMiss},
		"kugou": {outcome: lyricOutcomeMiss},
	}
	stubLyricSources(t, results)

	// 第一次：只有 QQ 音乐
	if _, got := runLyricVersion(t, 1); got.Source != "qq-qrc" {
		t.Fatalf("first = %+v", got)
	}
	// 网易云到了，质量相同：保持 QQ 音乐（只升不降）
	results["ncm"] = lyricSourceResult{data: ncm, outcome: lyricOutcomeHit}
	if _, got := runLyricVersion(t, 1); got.Source != "qq-qrc" {
		t.Fatalf("equal quality = %+v", got)
	}
	// AMLL 新收录了 TTML：升级
	results["ttml"] = lyricSourceResult{data: ttml, outcome: lyricOutcomeHit}
	names, got := runLyricVersion(t, 1)
	if got.Source != "ttml-amll" {
		t.Fatalf("upgrade = %+v", got)
	}
	if want := []string{"cache", "source", "source", "source", "source", "decided", "done"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("events = %v, want %v", names, want)
	}
	var record model.LyricCache
	repo.GetDB().Where("song_id = ?", 1).First(&record)
	if version := lyricSiteVersionOf(&record); record.Kind != "ttml" || record.Source != "ttml-amll" || version == nil || record.LyricHash != version.Hash {
		t.Fatalf("record = %+v", record)
	}
	// TTML 这次获取失败：不降级，标注仍按保存的 TTML 生成
	results["ttml"] = lyricSourceResult{outcome: lyricOutcomeFailed}
	if _, got := runLyricVersion(t, 1); got.Source != "ttml-amll" {
		t.Fatalf("failed ttml = %+v", got)
	}
	lines, info, svcerr := NewMusicService().annotationSource(context.Background(), &dto.MusicTrackDto{ID: 1, Name: "琵琶行"})
	if svcerr != nil || info.Source != "ttml-amll" || len(lines) != 4 || lines[1] != "枫叶狄花秋瑟瑟" {
		t.Fatalf("annotation source = %q %+v %v", lines, info.Source, svcerr)
	}
	// 管理员固定网易云：立即重新选择
	version, svcerr := NewMusicService().SaveLyricPin(context.Background(), 1, "ncm")
	if svcerr != nil || version.Source != "ncm-yrc" {
		t.Fatalf("pin = %+v %v", version, svcerr)
	}
	// 取消固定：TTML 仍在失败，网易云保持；TTML 恢复后升级回去
	if version, _ = NewMusicService().SaveLyricPin(context.Background(), 1, ""); version.Source != "ncm-yrc" {
		t.Fatalf("unpin while ttml fails = %+v", version)
	}
	results["ttml"] = lyricSourceResult{data: ttml, outcome: lyricOutcomeHit}
	if version, _ = NewMusicService().SaveLyricPin(context.Background(), 1, ""); version.Source != "ttml-amll" {
		t.Fatalf("unpin = %+v", version)
	}
	// TTML 确定没有了（且 QQ 音乐也没有按 mid 收录）：重新选择
	results["ttml"] = lyricSourceResult{outcome: lyricOutcomeMiss}
	if _, got := runLyricVersion(t, 1); got.Source != "ncm-yrc" {
		t.Fatalf("ttml gone = %+v", got)
	}
}

func TestLyricStreamSharesOneDecision(t *testing.T) {
	setupTTMLDB(t)
	results := map[string]lyricSourceResult{
		"ncm": {data: &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc)}, outcome: lyricOutcomeHit},
		"qq":  {outcome: lyricOutcomeMiss, qqTTML: lyricOutcomeMiss},
	}
	// TTML 慢、酷狗超时（stubLyricSources 把每个来源的时限设为 1 秒）
	calls := stubLyricSources(t, results, map[string]time.Duration{"ttml": 200 * time.Millisecond, "kugou": 3 * time.Second})

	type received struct {
		name string
		data any
		at   time.Duration
	}
	stream := func(out *[]received, ctx context.Context, stopAfter string) {
		start := time.Now()
		NewMusicService().StreamLyrics(ctx, 2, false, func(event string, data any) error {
			*out = append(*out, received{name: event, data: data, at: time.Since(start)})
			if event == stopAfter {
				return context.Canceled
			}
			return nil
		})
	}
	var first, second, dropped []received
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); stream(&first, context.Background(), "") }()
	// 中途断开的客户端不影响选择
	go func() { defer wg.Done(); stream(&dropped, context.Background(), "source") }()
	go func() {
		defer wg.Done()
		time.Sleep(500 * time.Millisecond)
		// 后来的请求加入进行中的选择，先补发已有的事件
		stream(&second, context.Background(), "")
	}()
	wg.Wait()

	if count, _ := calls.Load("ncm"); *count.(*int) != 1 {
		t.Fatalf("ncm fetched %d times, want 1 (shared decision)", *count.(*int))
	}
	if len(dropped) != 1 {
		t.Fatalf("dropped client got %d events", len(dropped))
	}
	for _, events := range [][]received{first, second} {
		names := []string{}
		for _, event := range events {
			names = append(names, event.name)
		}
		if want := []string{"source", "source", "source", "source", "decided", "done"}; !reflect.DeepEqual(names, want) {
			t.Fatalf("events = %v, want %v", names, want)
		}
	}
	// 来源到达即推送：网易云在 TTML 之前，超时的酷狗记为获取失败；全站版本为网易云逐行
	if first[0].at > 150*time.Millisecond || first[0].data.(dto.MusicLyricStreamSourceDto).Kind == "ttml" {
		t.Fatalf("first source event = %+v", first[0])
	}
	if kugou := first[3].data.(dto.MusicLyricStreamSourceDto); kugou.Kind != "kugou" || !kugou.Failed || first[3].at < 900*time.Millisecond {
		t.Fatalf("timed out source = %+v at %v", kugou, first[3].at)
	}
	if decided := first[4].data.(dto.MusicLyricVersionDto); decided.Kind != "ncm" || decided.Source != "ncm-lrc" {
		t.Fatalf("decided = %+v", decided)
	}
	// 推送的数据与各来源接口的返回相同
	for _, event := range first[:2] {
		if payload, _ := json.Marshal(event.data); strings.Contains(string(payload), `"kind":"ncm"`) && !strings.Contains(string(payload), `"kind":"ncm","data":{"lrc":{"lyric":"[00:10.00]`) {
			t.Fatalf("ncm payload = %s", payload)
		}
	}
}

func TestLyricAnnotationsWaitForSiteVersion(t *testing.T) {
	setupTTMLDB(t)
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {data: &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc), Yrc: lyricPart(pipaNCMYrc)}, outcome: lyricOutcomeHit},
	}, map[string]time.Duration{"ttml": 300 * time.Millisecond})
	s := NewMusicService()
	track := &dto.MusicTrackDto{ID: 3}
	// 还没有选出版本：等不到时返回 pending，绝不先用网易云的歌词
	_, _, svcerr := s.annotationSource(withLyricVersionWait(context.Background(), 50*time.Millisecond), track)
	if svcerr != errLyricVersionPending {
		t.Fatalf("undecided = %v", svcerr)
	}
	// 选择完成后（获取失败的来源不影响）按选出的版本取歌词
	lines, info, svcerr := s.annotationSource(context.Background(), track)
	if svcerr != nil || info.Source != "ncm-yrc" || !info.WordTimed || len(lines) != 2 || lines[0] != "浔阳江头夜送客， 枫叶荻花秋瑟瑟。" {
		t.Fatalf("decided = %q %+v %v", lines, info, svcerr)
	}
	// 网易云版本的行与哈希与原来的规则相同，已有的标注照常使用
	if _, want := lyricAnnotationKey(3, lyricTextLines(pipaNCMYrc)); lyricLinesHash(3, &lyricVersionLines{Timed: info.Timed}) != want {
		t.Fatal("ncm hash changed")
	}
	// 全站版本是逐行歌词：前端不叠加特效，不生成
	stubLyricSources(t, map[string]lyricSourceResult{"ncm": {data: &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc)}, outcome: lyricOutcomeHit}})
	if _, _, svcerr := s.annotationSource(context.Background(), &dto.MusicTrackDto{ID: 4}); svcerr == nil || svcerr.Message != "lyric_annotations_unavailable" {
		t.Fatalf("line-timed version = %v", svcerr)
	}
}

func TestListLyricAnnotationsOutdated(t *testing.T) {
	setupTTMLDB(t)
	db := repo.GetDB()
	now := time.Now()
	edited := now.Add(-time.Hour)
	db.Create(&model.LyricCache{SongID: 1, Kind: "ttml", Source: "ttml-amll", LyricHash: "new", Data: "{}", UpdatedAt: now})
	db.Create(&model.LyricAnnotation{SongID: 1, LyricHash: "old", Data: `{"lines":[]}`, Model: "manual", CreatedAt: now.Add(-2 * time.Hour), EditedAt: &edited})
	db.Create(&model.LyricAnnotation{SongID: 2, LyricHash: "legacy", Data: `{"lines":[]}`, CreatedAt: now.Add(-3 * time.Hour)})
	got, svcerr := NewMusicService().ListLyricAnnotations(context.Background())
	// 只有旧版本的手动编辑：显示它并标为过时；没有记录全站版本哈希的歌曲不判断
	if svcerr != nil || len(got) != 2 || !got[0].Outdated || got[0].EditedAt == nil || got[1].Outdated {
		t.Fatalf("before regeneration = %+v %v", got, svcerr)
	}
	// 按新版本重新生成后显示新的一份，旧版本的手动编辑另外提示
	db.Create(&model.LyricAnnotation{SongID: 1, LyricHash: "new", Data: `{"lines":[]}`, Source: "ttml-amll", CreatedAt: now})
	got, _ = NewMusicService().ListLyricAnnotations(context.Background())
	if got[0].Outdated || got[0].Source != "ttml-amll" || got[0].OutdatedEditedAt == nil || got[0].OutdatedEditedAt.Sub(edited).Abs() > time.Second {
		t.Fatalf("after regeneration = %+v", got[0])
	}
}
