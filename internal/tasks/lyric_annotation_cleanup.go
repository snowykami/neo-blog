package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
)

const lyricAnnotationCleanupInterval = 6 * time.Hour

// StartLyricAnnotationCleanup 定期清理超过保留期、不属于当前全站歌词版本且没有手动编辑过的歌词标注（见 service.CleanupLyricAnnotations）
func StartLyricAnnotationCleanup() {
	runPeriodically("lyric_annotation_cleanup", lyricAnnotationCleanupInterval, func() {
		deleted, err := service.CleanupLyricAnnotations(time.Now())
		if err != nil {
			logrus.Errorf("lyric annotation cleanup failed: %v", err)
		} else if deleted > 0 {
			logrus.Infof("lyric annotation cleanup: deleted %d outdated annotations", deleted)
		}
	})
}
