package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 歌词结构预标注的离线核对（不在常规测试中运行）：读取 NEO_STRUCTURE_EVAL_DIR/songs 下的歌词快照
// （{"track": 歌单中的曲目, "cache": /music/song/:id/lyric/cache 的 data, "chorus": /music/song/:id/chorus 的 data}），
// 按全站版本算出结构，写入 NEO_STRUCTURE_EVAL_DIR/backend.json，供与前端的时间轴比对：
//
//	NEO_STRUCTURE_EVAL_DIR=/tmp/neo-premark go test ./internal/service -run TestLyricStructureEval -v
func TestLyricStructureEval(t *testing.T) {
	dir := os.Getenv("NEO_STRUCTURE_EVAL_DIR")
	if dir == "" {
		t.Skip("set NEO_STRUCTURE_EVAL_DIR to run the lyric structure evaluation")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "songs", "*.json"))
	type evalBackground struct {
		Text       string `json:"text"`
		Start, End int64
	}
	type evalLine struct {
		Text       string          `json:"text"`
		Start      int64           `json:"start"`
		End        int64           `json:"end"`
		Credit     bool            `json:"credit"`
		Repeat     int             `json:"repeat"`
		Varied     bool            `json:"varied"`
		Gap        int64           `json:"gap"`
		Singer     string          `json:"singer"`
		Background *evalBackground `json:"bg,omitempty"`
	}
	type evalSong struct {
		ID        int64      `json:"id"`
		Kind      string     `json:"kind"`
		Source    string     `json:"source"`
		WordTimed bool       `json:"word_timed"`
		Duration  int64      `json:"duration"`
		Outro     int64      `json:"outro"`
		Lines     []evalLine `json:"lines"`
		Chorus    [][2]int   `json:"chorus"`
	}
	var songs []evalSong
	// 提示词的 token 粗估：中日韩文字每字约 1 个，其余每 4 个字符约 1 个；对比去掉结构标记后的同一份提示词
	estimate := func(text string) int {
		cjk, other := 0, 0
		for _, r := range text {
			if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) || r > 0x3000 {
				cjk++
			} else {
				other++
			}
		}
		return cjk + other/4
	}
	text := lyricAnnotationText
	markerRe := regexp.MustCompile(`　〔(\d+\.\ds|repeat \d+(, varied)?|credits|singer 2|together|bg: "[^〕]*")〕|(?m)^〔(intro|instrumental break|outro): \d+s〕\n`)
	notes := strings.NewReplacer(text.DurationNote, "", text.RepeatNote, "", text.CreditNote, "", text.SingerNote, "", text.BackgroundNote, "", text.GapNote, "")
	systemTokens := estimate(text.PlanPrompt)
	var withTokens, withoutTokens, prompts int
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var input struct {
			Track  dto.MusicTrackDto      `json:"track"`
			Cache  dto.MusicLyricCacheDto `json:"cache"`
			Chorus []dto.MusicChorusDto   `json:"chorus"`
		}
		if err := json.Unmarshal(raw, &input); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		version := lyricVersionOf(input.Cache.Kind, &input.Cache)
		if version == nil {
			continue
		}
		info := lyricAnnotationInfo{
			Title: input.Track.Name, Artists: input.Track.Artists, Source: version.Source,
			Timed: version.Timed, WordTimed: version.WordTimed, Duration: input.Track.Duration,
		}
		structure := lyricStructureOf(info)
		song := evalSong{ID: input.Track.ID, Kind: input.Cache.Kind, Source: version.Source, WordTimed: version.WordTimed, Duration: info.Duration, Outro: structure.Outro}
		for i, line := range version.Timed {
			item := evalLine{Text: line.Text, Start: line.Start, End: line.End, Credit: structure.Credit[i], Repeat: structure.Repeat[i], Varied: structure.Varied[i], Gap: structure.GapBefore[i], Singer: line.Singer}
			if bg := line.Background; bg != nil {
				item.Background = &evalBackground{Text: bg.Text, Start: bg.Start, End: bg.End}
			}
			song.Lines = append(song.Lines, item)
		}
		for _, r := range chorusLineRanges(version.Timed, input.Chorus) {
			song.Chorus = append(song.Chorus, [2]int{r.From, r.To})
		}
		songs = append(songs, song)
		// NEO_STRUCTURE_EVAL_SAMPLE=<歌曲 id>：打印这首歌送给模型的全曲规划消息中的歌词部分
		if sample := os.Getenv("NEO_STRUCTURE_EVAL_SAMPLE"); sample != "" && sample == strconv.FormatInt(input.Track.ID, 10) {
			prompt := buildLyricAnnotationPrompt(info, version.Texts())
			t.Logf("%s - %s\n%s", input.Track.Name, strings.Join(input.Track.Artists, " / "), prompt[strings.Index(prompt, "<lyrics>"):])
		}
		if version.WordTimed {
			texts := version.Texts()
			user := []string{buildLyricAnnotationPrompt(info, texts)}
			chunks := lyricAnnotationChunks(len(texts))
			for _, chunk := range chunks {
				user = append(user, buildLyricAnnotationLinesPrompt(info, texts, lyricAnnotationPlan{}, chunk[0], chunk[1], len(chunks)))
			}
			for k, message := range user {
				system := estimate(text.LinesPrompt)
				if k == 0 {
					system = systemTokens
				}
				withTokens += system + estimate(message)
				withoutTokens += system + estimate(notes.Replace(markerRe.ReplaceAllString(message, "")))
				prompts++
			}
		}
	}
	if prompts > 0 {
		t.Logf("input tokens (system + user, estimated) per call: %d -> %d (+%.1f%%) over %d calls",
			withoutTokens/prompts, withTokens/prompts, 100*float64(withTokens-withoutTokens)/float64(withoutTokens), prompts)
	}
	out, _ := json.MarshalIndent(songs, "", " ")
	if err := os.WriteFile(filepath.Join(dir, "backend.json"), out, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %d songs", len(songs))
}
