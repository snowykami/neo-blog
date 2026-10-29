package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 后台手动编辑歌词标注（见 docs/music-player-spec.md 7.2b「手动编辑」）：管理员在后台的歌词特效页查看与修改 AI 生成的标注，
// 只能改短语（选区与特效、颜色、字体、字形、节奏）、各行的情绪、副歌与粒子场景，以及全曲字体、节奏、导语与聚光灯，不能改歌词文本与时间轴；
// 时刻与尾奏热评保持原样。编辑过的标注记下 edited_at，不再因过期自动重新生成（管理员手动刷新时覆盖）

const (
	// 手动编辑时每行最多的短语数与短语长度（比模型宽松，仍防止异常数据）
	lyricAnnotationEditMaxPerLine     = 8
	lyricAnnotationEditMaxPhraseRunes = 40
)

// errInvalidLyricAnnotation 手动编辑的标注不合法
var errInvalidLyricAnnotation = errs.NewBadRequest("invalid_lyric_annotation")

// GetLyricAnnotationEditor 后台编辑一首歌的歌词标注所需的数据：完整歌词与当前标注（还没有时 annotation 为空）
func (s *MusicService) GetLyricAnnotationEditor(ctx context.Context, id int64) (*dto.MusicLyricAnnotationEditorDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lines, _, svcerr := s.annotationLines(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	key, hash := lyricAnnotationKey(id, lines)
	result := &dto.MusicLyricAnnotationEditorDto{Lines: lines, Generating: lyricAnnotations.running(key)}
	var record model.LyricAnnotation
	err := repo.GetDB().WithContext(ctx).Where("song_id = ? AND lyric_hash = ?", id, hash).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	data := parseLyricAnnotationData(record.Data)
	result.Annotation = &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusReady, Font: data.Font, Pace: data.Pace, Intro: data.Intro, Outro: data.Outro, Moments: data.Moments, Spotlight: data.Spotlight, Lines: data.Lines, Edited: record.EditedAt != nil}
	result.EditedAt = record.EditedAt
	result.GeneratedAt = &record.CreatedAt
	result.Model = record.Model
	return result, nil
}

// SaveLyricAnnotations 保存管理员手动编辑的歌词标注：校验后覆盖可编辑的部分，保留时刻与尾奏热评，记下编辑时间
func (s *MusicService) SaveLyricAnnotations(ctx context.Context, id int64, req *dto.MusicLyricAnnotationsEditReq) (*dto.MusicLyricAnnotationEditorDto, *errs.ServiceError) {
	if id <= 0 || req == nil {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lines, _, svcerr := s.annotationLines(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	data, ok := sanitizeEditedLyricAnnotations(lines, req)
	if !ok {
		return nil, errInvalidLyricAnnotation
	}
	_, hash := lyricAnnotationKey(id, lines)
	db := repo.GetDB().WithContext(ctx)
	var existing model.LyricAnnotation
	err := db.Where("song_id = ? AND lyric_hash = ?", id, hash).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	now := time.Now()
	record := &model.LyricAnnotation{SongID: id, LyricHash: hash, Model: "manual", CreatedAt: now, EditedAt: &now}
	if err == nil {
		previous := parseLyricAnnotationData(existing.Data)
		data.Outro, data.Moments = previous.Outro, previous.Moments
		record.Model, record.CreatedAt = existing.Model, existing.CreatedAt
	}
	raw, _ := json.Marshal(data)
	record.Data = string(raw)
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "edited_at"}),
	}
	if err := db.Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save edited lyric annotation for song %d failed: %v", id, err)
		return nil, errs.NewInternalServer("failed_to_update_target")
	}
	return s.GetLyricAnnotationEditor(ctx, id)
}

// ListLyricAnnotations 后台歌词特效列表：每首歌最近的一份标注（同一首歌歌词变化后可能有多份），按生成或编辑时间倒序
func (s *MusicService) ListLyricAnnotations(ctx context.Context) ([]dto.MusicLyricAnnotationSummaryDto, *errs.ServiceError) {
	var records []model.LyricAnnotation
	if err := repo.GetDB().WithContext(ctx).Order("created_at DESC").Find(&records).Error; err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := []dto.MusicLyricAnnotationSummaryDto{}
	seen := map[int64]bool{}
	for _, record := range records {
		if seen[record.SongID] {
			continue
		}
		seen[record.SongID] = true
		phrases := 0
		for _, line := range parseLyricAnnotationData(record.Data).Lines {
			phrases += len(line.Phrases)
		}
		result = append(result, dto.MusicLyricAnnotationSummaryDto{SongID: record.SongID, Phrases: phrases, GeneratedAt: record.CreatedAt, EditedAt: record.EditedAt, Model: record.Model})
	}
	return result, nil
}

// running 这份歌词文本是否正在生成标注
func (a *lyricAnnotationService) running(key string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	job := a.jobs[key]
	return job != nil && job.running
}

// sanitizeEditedLyricAnnotations 校验手动编辑的标注：行必须是歌词中的原文（同一文本只能有一条），短语必须是该行的连续片段且不重复，
// 情绪、特效、颜色、字体、字形、节奏与场景只能取允许的值，导语不超过上限，聚光灯必须指向存在的行；不合法时返回 false（不做静默修正，
// 让管理员看到保存失败）。与模型输出的校验不同，手动编辑不限制特殊特效与场景的数量
func sanitizeEditedLyricAnnotations(lines []string, req *dto.MusicLyricAnnotationsEditReq) (lyricAnnotationData, bool) {
	counts := map[string]int{}
	for _, line := range lines {
		counts[line]++
	}
	data := lyricAnnotationData{Lines: []dto.MusicLyricAnnotationLine{}}
	if req.Font != "" && !lyricAnnotationFonts[req.Font] {
		return data, false
	}
	data.Font = req.Font
	if req.Pace != "" && req.Pace != "medium" && !lyricAnnotationPaces[req.Pace] {
		return data, false
	}
	if lyricAnnotationPaces[req.Pace] {
		data.Pace = req.Pace
	}
	intro := strings.TrimSpace(req.Intro)
	if utf8.RuneCountInString(intro) > lyricAnnotationMaxIntroRunes {
		return data, false
	}
	data.Intro = intro
	if spot := req.Spotlight; spot != nil {
		if spot.Occurrence < 0 || spot.Occurrence >= counts[spot.Text] {
			return data, false
		}
		data.Spotlight = &dto.MusicLyricAnnotationSpotlight{Text: spot.Text, Occurrence: spot.Occurrence}
	}
	seen := map[string]bool{}
	for _, item := range req.Lines {
		if counts[item.Text] == 0 || seen[item.Text] || len(item.Phrases) > lyricAnnotationEditMaxPerLine {
			return data, false
		}
		seen[item.Text] = true
		line := dto.MusicLyricAnnotationLine{Text: item.Text, Chorus: item.Chorus || item.ChorusStart, ChorusStart: item.ChorusStart, Phrases: []dto.MusicLyricAnnotationPhrase{}}
		if item.Mood != "" && !lyricAnnotationMoods[item.Mood] {
			return data, false
		}
		line.Mood = item.Mood
		if item.Scene != "" && !lyricAnnotationScenes[item.Scene] {
			return data, false
		}
		line.Scene = item.Scene
		if item.Scene != "" && item.SceneColor != "" {
			if line.SceneColor = normalizeLyricColor(item.SceneColor); line.SceneColor == "" {
				return data, false
			}
		}
		normalizedLine := normalizeLyricMatch(item.Text)
		phraseKeys := map[string]bool{}
		for _, phrase := range item.Phrases {
			text := strings.TrimSpace(phrase.Text)
			key := normalizeLyricMatch(text)
			if key == "" || phraseKeys[key] || utf8.RuneCountInString(text) > lyricAnnotationEditMaxPhraseRunes || !strings.Contains(normalizedLine, key) || !lyricAnnotationEffects[phrase.Effect] {
				return data, false
			}
			phraseKeys[key] = true
			annotated := dto.MusicLyricAnnotationPhrase{Text: text, Effect: phrase.Effect}
			if phrase.Color != "" {
				if annotated.Color = normalizeLyricColor(phrase.Color); annotated.Color == "" {
					return data, false
				}
			}
			if phrase.Font != "" && !lyricAnnotationFonts[phrase.Font] {
				return data, false
			}
			annotated.Font = phrase.Font
			for _, style := range phrase.Styles {
				if !lyricAnnotationStyles[style] {
					return data, false
				}
				if !slices.Contains(annotated.Styles, style) {
					annotated.Styles = append(annotated.Styles, style)
				}
			}
			if phrase.Pace != "" && phrase.Pace != "medium" && !lyricAnnotationPaces[phrase.Pace] {
				return data, false
			}
			// 与全曲节奏相同时不单独保存
			if lyricAnnotationPaces[phrase.Pace] && phrase.Pace != data.Pace {
				annotated.Pace = phrase.Pace
			}
			line.Phrases = append(line.Phrases, annotated)
		}
		// 没有任何标注的行不保存
		if line.Mood != "" || line.Chorus || line.Scene != "" || len(line.Phrases) > 0 {
			data.Lines = append(data.Lines, line)
		}
	}
	return data, true
}
