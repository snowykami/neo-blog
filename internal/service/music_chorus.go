package service

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 副歌片段（见 docs/music-player-spec.md 7.2g）：网易云客户端在进度条上标出的高潮 / 副歌片段（NeteaseCloudMusicApi 的 /song/chorus），
// 播放器在进度条上标出，歌词标注也把它作为判断副歌起点的参考。没有配置 API、请求失败或没有片段时为空列表

var musicChorusCache = cache.NewLRUCacheWithSize(1000, 1<<20)

// 有片段缓存 7 天，没有片段缓存 1 天（之后可能补上）；请求出错不缓存
const (
	musicChorusHitTTL  = 7 * 24 * time.Hour
	musicChorusMissTTL = 24 * time.Hour
)

type musicChorusCacheEntry struct {
	Chorus    []dto.MusicChorusDto `json:"chorus"`
	ExpiresAt int64                `json:"expires_at"`
}

// GetSongChorus 一首歌的副歌片段（毫秒）
func (s *MusicService) GetSongChorus(ctx context.Context, id int64) ([]dto.MusicChorusDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	return fetchSongChorus(ctx, id), nil
}

func fetchSongChorus(ctx context.Context, id int64) []dto.MusicChorusDto {
	if data, ok := musicChorusCache.Get(uint(id)); ok {
		var entry musicChorusCacheEntry
		if json.Unmarshal(data, &entry) == nil && time.Now().Unix() < entry.ExpiresAt {
			return entry.Chorus
		}
		musicChorusCache.Remove(uint(id))
	}
	cfg := tools.GetNCMConfig()
	if !validMusicAPIBaseURL(cfg.BaseURL) {
		return []dto.MusicChorusDto{}
	}
	var raw struct {
		Chorus []struct {
			StartTime int64 `json:"startTime"`
			EndTime   int64 `json:"endTime"`
		} `json:"chorus"`
	}
	// 副歌片段不需要登录，不携带 Cookie
	if err := ncmGet(ctx, tools.NCMConfig{BaseURL: cfg.BaseURL}, "/song/chorus", url.Values{"id": {strconv.FormatInt(id, 10)}}, &raw); err != nil {
		return []dto.MusicChorusDto{}
	}
	chorus := []dto.MusicChorusDto{}
	for _, item := range raw.Chorus {
		if item.StartTime >= 0 && item.EndTime > item.StartTime {
			chorus = append(chorus, dto.MusicChorusDto{Start: item.StartTime, End: item.EndTime})
		}
	}
	ttl := musicChorusHitTTL
	if len(chorus) == 0 {
		ttl = musicChorusMissTTL
	}
	if data, err := json.Marshal(musicChorusCacheEntry{Chorus: chorus, ExpiresAt: time.Now().Add(ttl).Unix()}); err == nil {
		musicChorusCache.Put(uint(id), data)
	}
	return chorus
}

// lyricChorusRange 副歌片段对应的歌词行（含首尾）与时间
type lyricChorusRange struct {
	From, To   int
	Start, End int64
}

// chorusLineRanges 把副歌片段换算成歌词行：起点取开始时间最接近片段开头的行（3 秒内），终点取片段结束前开始的最后一行
func chorusLineRanges(lines []lyricTimedLine, chorus []dto.MusicChorusDto) []lyricChorusRange {
	var ranges []lyricChorusRange
	for _, segment := range chorus {
		from, best := -1, int64(3001)
		for i, line := range lines {
			if line.Start < 0 {
				continue
			}
			diff := line.Start - segment.Start
			if diff < 0 {
				diff = -diff
			}
			if diff < best {
				from, best = i, diff
			}
		}
		if from < 0 {
			continue
		}
		to := from
		for i := from; i < len(lines); i++ {
			if lines[i].Start >= 0 && lines[i].Start < segment.End {
				to = i
			}
		}
		ranges = append(ranges, lyricChorusRange{From: from, To: to, Start: segment.Start, End: segment.End})
	}
	return ranges
}
