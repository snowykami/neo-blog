package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 后台手动编辑歌词标注（见 docs/music-player-spec.md 7.2b「手动编辑」）：管理员在后台的歌词特效页查看与修改 AI 生成的标注，
// 只能改短语（选区与特效、颜色、字体、字形）、各行的情绪、副歌与粒子场景，以及全曲字体、导语与聚光灯，不能改歌词文本与时间轴；
// 时刻与尾奏热评保持原样。编辑过的标注记下 edited_at，不再因过期自动重新生成（管理员手动刷新时覆盖）。
// 正在生成时不能保存（409，避免与生成结果互相覆盖）；生成写回只覆盖没有手动编辑过的标注（见 lyricAnnotationService.saveGenerated），
// 生成期间保存的编辑不会被生成结果覆盖。已移出歌单的歌曲仍可打开编辑器（只是不再由 AI 生成，见 editorLines）

const (
	// 手动编辑时每行最多的短语数与短语长度（比模型宽松，仍防止异常数据）
	lyricAnnotationEditMaxPerLine     = 8
	lyricAnnotationEditMaxPhraseRunes = 40
)

// errInvalidLyricAnnotation 手动编辑的标注不合法
var errInvalidLyricAnnotation = errs.NewBadRequest("invalid_lyric_annotation")

// errLyricAnnotationGenerating 这首歌正在由 AI 生成标注，生成结束后才能保存手动编辑
var errLyricAnnotationGenerating = errs.NewConflict("lyric_annotation_generating")

// lyricAnnotationListMaxSize 后台歌词特效列表每页最多的歌曲数
const lyricAnnotationListMaxSize = 100

// editorLines 后台编辑器用的歌词与上下文：除了可以生成标注的歌曲（见 annotatableTrack），已移出歌单、也没有被公开内容引用的歌曲
// 也能打开（编辑器仅管理员可用，只读写已有的标注、不调用模型；歌词仍取全站歌词版本）；orphaned 为这种歌曲：读者无法播放，AI 不会再为它生成
func (s *MusicService) editorLines(ctx context.Context, id int64) ([]string, lyricAnnotationInfo, bool, *errs.ServiceError) {
	track := s.annotatableTrack(ctx, id)
	orphaned := track == nil
	if orphaned {
		track = &dto.MusicTrackDto{ID: id}
	}
	lines, info, svcerr := s.annotationSource(ctx, track)
	return lines, info, orphaned, svcerr
}

// GetLyricAnnotationEditor 后台编辑一首歌的歌词标注所需的数据：完整歌词与当前标注（还没有时 annotation 为空）
func (s *MusicService) GetLyricAnnotationEditor(ctx context.Context, id int64) (*dto.MusicLyricAnnotationEditorDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lines, _, orphaned, svcerr := s.editorLines(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	key, hash := lyricAnnotationKey(id, lines)
	result := &dto.MusicLyricAnnotationEditorDto{Lines: lines, Generating: lyricAnnotations.running(key), Orphaned: orphaned}
	var record model.LyricAnnotation
	err := repo.GetDB().WithContext(ctx).Where("song_id = ? AND lyric_hash = ?", id, hash).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	data := parseLyricAnnotationData(record.Data)
	result.Annotation = &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusReady, Font: data.Font, Intro: data.Intro, Outro: data.Outro, Moments: data.Moments, Spotlights: data.spotlightsFor(lines), Accent: data.Accent, Lines: data.Lines, Sprites: data.Sprites, Edited: record.EditedAt != nil}
	result.EditedAt = record.EditedAt
	result.GeneratedAt = &record.CreatedAt
	result.Model = record.Model
	return result, nil
}

// SaveLyricAnnotations 保存管理员手动编辑的歌词标注：校验后覆盖可编辑的部分，保留时刻与尾奏热评，记下编辑时间。
// 这份歌词正在生成标注（包括在其他实例上）时返回 409 lyric_annotation_generating
func (s *MusicService) SaveLyricAnnotations(ctx context.Context, id int64, req *dto.MusicLyricAnnotationsEditReq) (*dto.MusicLyricAnnotationEditorDto, *errs.ServiceError) {
	if id <= 0 || req == nil {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lines, info, _, svcerr := s.editorLines(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	key, hash := lyricAnnotationKey(id, lines)
	if lyricAnnotations.running(key) {
		return nil, errLyricAnnotationGenerating
	}
	db := repo.GetDB().WithContext(ctx)
	var existing model.LyricAnnotation
	err := db.Where("song_id = ? AND lyric_hash = ?", id, hash).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	var previous lyricAnnotationData
	if err == nil {
		previous = parseLyricAnnotationData(existing.Data)
	}
	data, ok := sanitizeEditedLyricAnnotations(lines, req, previous.Sprites)
	if !ok {
		return nil, errInvalidLyricAnnotation
	}
	now := time.Now()
	record := &model.LyricAnnotation{SongID: id, LyricHash: hash, Model: "manual", Source: info.Source, CreatedAt: now, EditedAt: &now}
	if err == nil {
		// 时刻、尾奏热评与自定义粒子不在编辑范围内，保持原样（行的场景可以选用这首歌已有的自定义粒子）
		data.Outro, data.Moments, data.Sprites = previous.Outro, previous.Moments, previous.Sprites
		record.Model, record.CreatedAt = existing.Model, existing.CreatedAt
	}
	raw, _ := json.Marshal(data)
	record.Data, record.Phrases = string(raw), lyricAnnotationPhraseCount(data.Lines)
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "source", "phrases", "edited_at"}),
	}
	if err := db.Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save edited lyric annotation for song %d failed: %v", id, err)
		return nil, errs.Internal("failed_to_update_target", err)
	}
	return s.GetLyricAnnotationEditor(ctx, id)
}

// ListLyricAnnotations 后台歌词特效列表（分页）：博客歌单中的歌曲（按歌单顺序）与其他已有标注的歌曲（如文章引用的、已移出歌单的，
// 按最近一次生成时间倒序）；query 按歌名、歌手或歌曲 ID 筛选（不在歌单中的歌曲只能按 ID）。只读标注的短列，不读 Data。
// 歌单取不到（未配置网易云歌单、网易云出错）时只列出已有标注的歌曲，此时不判断是否已移出歌单
func (s *MusicService) ListLyricAnnotations(ctx context.Context, req *dto.MusicLyricAnnotationListReq) ([]dto.MusicLyricAnnotationListItemDto, int64, *errs.ServiceError) {
	db := repo.GetDB().WithContext(ctx)
	var annotated []int64
	if err := db.Model(&model.LyricAnnotation{}).Group("song_id").Order("MAX(created_at) DESC, song_id DESC").Pluck("song_id", &annotated).Error; err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err)
	}
	var tracks []dto.MusicTrackDto
	playlistKnown := false
	if tools.GetNCMConfig().Configured() {
		if list, svcerr := s.GetPlaylist(ctx); svcerr == nil {
			tracks, playlistKnown = list, true
		}
	}

	type row struct {
		id    int64
		track *dto.MusicTrackDto
	}
	keyword := strings.ToLower(strings.TrimSpace(req.Query))
	matches := func(id int64, track *dto.MusicTrackDto) bool {
		if keyword == "" || strings.Contains(strconv.FormatInt(id, 10), keyword) {
			return true
		}
		if track == nil {
			return false
		}
		return strings.Contains(strings.ToLower(track.Name), keyword) || slices.ContainsFunc(track.Artists, func(artist string) bool {
			return strings.Contains(strings.ToLower(artist), keyword)
		})
	}
	rows := []row{}
	inPlaylist := make(map[int64]bool, len(tracks))
	for i := range tracks {
		if inPlaylist[tracks[i].ID] {
			continue
		}
		inPlaylist[tracks[i].ID] = true
		if matches(tracks[i].ID, &tracks[i]) {
			rows = append(rows, row{id: tracks[i].ID, track: &tracks[i]})
		}
	}
	for _, id := range annotated {
		if !inPlaylist[id] && matches(id, nil) {
			rows = append(rows, row{id: id})
		}
	}

	total := int64(len(rows))
	size := min(max(req.Size, 1), lyricAnnotationListMaxSize)
	offset := min((max(req.Page, 1)-1)*size, uint64(len(rows)))
	rows = rows[offset:min(offset+size, uint64(len(rows)))]
	ids := make([]int64, len(rows))
	for i, r := range rows {
		ids[i] = r.id
	}
	summaries, svcerr := lyricAnnotationSummaries(ctx, ids)
	if svcerr != nil {
		return nil, 0, svcerr
	}
	items := make([]dto.MusicLyricAnnotationListItemDto, len(rows))
	for i, r := range rows {
		items[i] = dto.MusicLyricAnnotationListItemDto{SongID: r.id, Track: r.track, Summary: summaries[r.id]}
		// 已移出歌单、也没有被公开内容引用：读者无法播放，AI 不会再为它生成（仍可手动编辑或删除）
		items[i].Orphaned = playlistKnown && r.track == nil && !articleSongReferenced(r.id)
	}
	return items, total, nil
}

// lyricAnnotationSummaries 这些歌曲的标注概况：同一首歌可能有多份标注（歌词或全站歌词版本变化后），优先显示属于当前全站歌词版本的那份；
// 没有时显示最近的一份并标为过时（下次播放时按新版本重新生成）。手动编辑过、但属于旧版本的标注不再显示在播放器里，记下最近的编辑时间提醒管理员。
// 只读短列（短语数在写入时算好），不读 Data
func lyricAnnotationSummaries(ctx context.Context, ids []int64) (map[int64]*dto.MusicLyricAnnotationSummaryDto, *errs.ServiceError) {
	result := make(map[int64]*dto.MusicLyricAnnotationSummaryDto, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	db := repo.GetDB().WithContext(ctx)
	var records []model.LyricAnnotation
	if err := db.Select("id", "song_id", "lyric_hash", "phrases", "model", "source", "created_at", "edited_at").
		Where("song_id IN ?", ids).Order("created_at DESC").Order("id DESC").Find(&records).Error; err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	// 当前全站歌词版本的哈希；还没有选出版本、或旧数据没有记录哈希的歌曲不判断是否过时
	var versions []model.LyricCache
	if err := db.Select("song_id", "lyric_hash").Where("song_id IN ? AND lyric_hash <> ''", ids).Find(&versions).Error; err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	current := make(map[int64]string, len(versions))
	for _, version := range versions {
		current[version.SongID] = version.LyricHash
	}

	type songRecords struct {
		shown, outdatedEdit *model.LyricAnnotation
	}
	bySong := map[int64]*songRecords{}
	for i := range records {
		record := &records[i]
		song := bySong[record.SongID]
		if song == nil {
			song = &songRecords{shown: record}
			bySong[record.SongID] = song
		}
		hash, known := current[record.SongID]
		if known && record.LyricHash == hash && song.shown.LyricHash != hash {
			song.shown = record
		}
		if known && record.LyricHash != hash && record.EditedAt != nil && (song.outdatedEdit == nil || record.EditedAt.After(*song.outdatedEdit.EditedAt)) {
			song.outdatedEdit = record
		}
	}
	for id, song := range bySong {
		hash, known := current[id]
		summary := &dto.MusicLyricAnnotationSummaryDto{
			SongID: id, Phrases: song.shown.Phrases, GeneratedAt: song.shown.CreatedAt, EditedAt: song.shown.EditedAt, Model: song.shown.Model,
			Source: song.shown.Source, Outdated: known && song.shown.LyricHash != hash,
		}
		if song.outdatedEdit != nil && song.outdatedEdit != song.shown {
			summary.OutdatedEditedAt = song.outdatedEdit.EditedAt
		}
		result[id] = summary
	}
	return result, nil
}

// running 这份歌词文本是否正在生成标注（包括在其他实例上）
func (a *lyricAnnotationService) running(key string) bool {
	running, _ := a.jobState(key)
	return running
}

// sanitizeEditedLyricAnnotations 校验手动编辑的标注：行必须是歌词中的原文（同一文本只能有一条），短语必须是该行的连续片段且不重复，
// 情绪、特效、颜色、字体、字形与场景（内置场景或这首歌已有的自定义粒子）只能取允许的值，导语不超过上限，聚光灯必须指向存在的行；不合法时返回 false（不做静默修正，
// 让管理员看到保存失败）。与模型输出的校验不同，手动编辑不限制特殊特效与场景的数量
func sanitizeEditedLyricAnnotations(lines []string, req *dto.MusicLyricAnnotationsEditReq, sprites []dto.MusicLyricSprite) (lyricAnnotationData, bool) {
	counts := map[string]int{}
	for _, line := range lines {
		counts[line]++
	}
	data := lyricAnnotationData{Lines: []dto.MusicLyricAnnotationLine{}}
	if req.Font != "" && !lyricAnnotationFonts[req.Font] {
		return data, false
	}
	data.Font = req.Font
	intro := strings.TrimSpace(req.Intro)
	if utf8.RuneCountInString(intro) > lyricAnnotationMaxIntroRunes {
		return data, false
	}
	data.Intro = intro
	if req.Accent != "" {
		if data.Accent = sanitizeLyricAccent(req.Accent); data.Accent == "" {
			return data, false
		}
	}
	// 聚光灯：歌词中存在的那几次出现，不重复；不同的句子最多 lyricAnnotationMaxSpotlights 句、合计最多 lyricAnnotationMaxSpotlightLines 处
	if len(req.Spotlights) > lyricAnnotationMaxSpotlightLines {
		return data, false
	}
	spotTexts := map[string]bool{}
	for _, spot := range req.Spotlights {
		if spot.Occurrence < 0 || spot.Occurrence >= counts[spot.Text] || slices.Contains(data.Spotlights, spot) {
			return data, false
		}
		spotTexts[spot.Text] = true
		data.Spotlights = append(data.Spotlights, spot)
	}
	if len(spotTexts) > lyricAnnotationMaxSpotlights {
		return data, false
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
		// 场景：内置场景，或这首歌已有的自定义粒子（custom:<name>）
		if item.Scene != "" && lyricSpriteScene(item.Scene, sprites, nil) != item.Scene {
			return data, false
		}
		line.Scene = item.Scene
		if item.Scene != "" && item.SceneColor != "" {
			if line.SceneColor = normalizeLyricColor(item.SceneColor); line.SceneColor == "" {
				return data, false
			}
		}
		// 持续行数：0 为默认行数，只对有场景的行有效
		if item.SceneLines < 0 || item.SceneLines > lyricAnnotationMaxSceneLines {
			return data, false
		}
		if item.Scene != "" {
			line.SceneLines = item.SceneLines
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
			line.Phrases = append(line.Phrases, annotated)
		}
		// 没有任何标注的行不保存
		if line.Mood != "" || line.Chorus || line.Scene != "" || len(line.Phrases) > 0 {
			data.Lines = append(data.Lines, line)
		}
	}
	return data, true
}
