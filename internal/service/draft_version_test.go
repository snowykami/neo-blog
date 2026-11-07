package service

import (
	"errors"
	"sync"
	"testing"

	"github.com/snowykami/neo-blog/internal/repo"
)

// 草稿版本号的比较与加一在库中原子完成：过期的版本号不能写入，并发写入同一版本时只有一个成功
func TestSaveWithDraftVersion(t *testing.T) {
	_, _, _, post, _ := setupEditTest(t)
	base := post.DraftVersion

	stale := reloadPost(t, post.ID)
	content := "<p>stale</p>"
	stale.DraftContent = &content
	if err := repo.Post.SavePostWithDraftVersion(stale, base+1); !errors.Is(err, repo.ErrDraftVersionConflict) {
		t.Fatalf("wrong expected version must conflict, got %v", err)
	}
	if got := reloadPost(t, post.ID); got.DraftVersion != base || (got.DraftContent != nil && *got.DraftContent == content) {
		t.Fatalf("conflicting save must not write: %+v", got)
	}

	const writers = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	succeeded, conflicted := 0, 0
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := reloadPost(t, post.ID)
			c := "<p>writer</p>"
			if i%2 == 0 {
				c = "<p>other writer</p>"
			}
			p.DraftContent = &c
			err := repo.Post.SavePostWithDraftVersion(p, base)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, repo.ErrDraftVersionConflict):
				conflicted++
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()
	if succeeded != 1 || conflicted != writers-1 {
		t.Fatalf("succeeded %d, conflicted %d", succeeded, conflicted)
	}
	if got := reloadPost(t, post.ID); got.DraftVersion != base+1 {
		t.Fatalf("version = %d, want %d", got.DraftVersion, base+1)
	}
}
