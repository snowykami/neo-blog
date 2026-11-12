package pinyin

import (
	"strings"
	"testing"
)

func TestDerive(t *testing.T) {
	t.Run("pure_chinese", func(t *testing.T) {
		full, initials := Derive("前端工程化")
		if !strings.Contains(full, "qian duan gong cheng hua") {
			t.Fatalf("unexpected full pinyin: %q", full)
		}
		if !strings.Contains(full, "qianduangongchenghua") {
			t.Fatalf("expected compact pinyin in %q", full)
		}
		if !strings.Contains(initials, "qdgch") {
			t.Fatalf("unexpected initials: %q", initials)
		}
	})

	t.Run("mixed_english_and_chinese", func(t *testing.T) {
		full, initials := Derive("Neo 博客系统")
		if !strings.Contains(full, "neo bo ke xi tong") || !strings.Contains(full, "neobokexitong") || !strings.Contains(full, "bokexitong") {
			t.Fatalf("unexpected mixed full: %q", full)
		}
		if !strings.Contains(initials, "nbkxt") || !strings.Contains(initials, "bkxt") {
			t.Fatalf("unexpected mixed initials: %q", initials)
		}
	})

	t.Run("heteronym_and_mid_title_phrase", func(t *testing.T) {
		full, initials := Derive("深入理解重庆分布式缓存")
		// 「重」有 zhong / chong 两种常见读音，句中连写 chongqing、fenbushi 与首字母 cqfbs 都应能前缀匹配
		if !strings.Contains(full, "chongqing") || !strings.Contains(full, "fenbushihuancun") {
			t.Fatalf("expected mid-title heteronym compact phrases in %q", full)
		}
		if !strings.Contains(initials, "cqfbs") || !strings.Contains(initials, "fbshc") {
			t.Fatalf("expected mid-title initials in %q", initials)
		}
	})

	t.Run("pure_english_ignored", func(t *testing.T) {
		full, initials := Derive("Kubernetes & Docker 101")
		if full != "" || initials != "" {
			t.Fatalf("pure ASCII should not generate pinyin noise, got full=%q initials=%q", full, initials)
		}
	})

	t.Run("single_han_character", func(t *testing.T) {
		full, initials := Derive("雪")
		if full != "xue" {
			t.Fatalf("expected full=xue, got %q", full)
		}
		if initials != "" {
			t.Fatalf("single character should not emit 1-char initial, got %q", initials)
		}
	})
}
