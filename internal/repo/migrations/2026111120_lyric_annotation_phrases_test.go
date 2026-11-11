package migrations

import "testing"

func TestCountLyricAnnotationPhrases(t *testing.T) {
	for raw, want := range map[string]int{
		`{"lines":[{"text":"a","phrases":[{"text":"a"}]},{"text":"b","phrases":[{"text":"b"},{"text":"c"}]}]}`: 3,
		// 更早的记录只有 lines 数组
		`[{"text":"a","phrases":[{"text":"a"},{"text":"b"}]},{"text":"c"}]`: 2,
		`{"lines":[]}`: 0,
		`not json`:     0,
		``:             0,
	} {
		if got := countLyricAnnotationPhrases(raw); got != want {
			t.Errorf("count(%q) = %d, want %d", raw, got, want)
		}
	}
}
