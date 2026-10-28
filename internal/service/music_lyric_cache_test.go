package service

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

func TestLyricCache(t *testing.T) {
	setupEditTest(t)
	service := NewMusicService()
	ctx := context.Background()

	if _, svcerr := service.GetLyricCache(ctx, 9); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("missing cache should be 404, got %v", svcerr)
	}
	// 只接受三种来源；不合法时不请求任何来源
	if svcerr := service.SaveLyricCache(ctx, 9, "evil"); svcerr == nil || svcerr.Code != http.StatusBadRequest {
		t.Fatalf("invalid kind should be 400, got %v", svcerr)
	}

	data := `{"kind":"ttml","ttml":{"source":"amll","ttml":"<tt/>"},"ncm":{"lrc":{"lyric":"[00:01.00]晴天","version":1}}}`
	repo.GetDB().Create(&model.LyricCache{SongID: 9, Kind: "ttml", Data: data, UpdatedAt: time.Now()})
	got, svcerr := service.GetLyricCache(ctx, 9)
	if svcerr != nil || got.Kind != "ttml" || got.TTML == nil || got.TTML.TTML != "<tt/>" || got.Ncm == nil || got.QQ != nil {
		t.Fatalf("cache = %+v, %v", got, svcerr)
	}

	// 过期后不再返回
	repo.GetDB().Model(&model.LyricCache{}).Where("song_id = ?", 9).Update("updated_at", time.Now().Add(-lyricCacheTTL-time.Hour))
	if _, svcerr := service.GetLyricCache(ctx, 9); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("expired cache should be 404, got %v", svcerr)
	}
}
