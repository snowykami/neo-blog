package service

import (
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

// 旧版本歌词标注的清理（见 docs/music-player-spec.md 7.2b）：歌词文本或全站歌词版本变化后，按新文本重新生成，旧版本的标注保留，
// 切换回原来的来源时可以直接使用。只清理同时满足以下条件的：
//   - 不属于当前全站歌词版本（这首歌已经选出版本、且哈希不同；还没有选出版本或旧数据没有哈希的不清理）
//   - 没有手动编辑过（手动编辑过的旧版本一律保留，后台列表提示「有旧版本的手动编辑」）
//   - 生成于保留期之前
const LyricAnnotationRetention = 30 * 24 * time.Hour

// CleanupLyricAnnotations 删除超过保留期的旧版本 AI 标注，返回删除的记录数（由定时任务调用）
func CleanupLyricAnnotations(now time.Time) (int64, error) {
	result := repo.GetDB().
		Where("edited_at IS NULL AND created_at < ?", now.Add(-LyricAnnotationRetention)).
		Where("EXISTS (SELECT 1 FROM lyric_caches WHERE lyric_caches.song_id = lyric_annotations.song_id AND lyric_caches.lyric_hash <> '' AND lyric_caches.lyric_hash <> lyric_annotations.lyric_hash)").
		Delete(&model.LyricAnnotation{})
	return result.RowsAffected, result.Error
}
