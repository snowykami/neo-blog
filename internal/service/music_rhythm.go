package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	musicRhythmCacheTTL           = 7 * 24 * time.Hour
	musicRhythmJobTTL             = 90 * time.Second
	musicRhythmRetryAfter         = 30 * time.Minute
	musicRhythmMaxAudioDurationMs = 20 * 60 * 1000 // 超过 20 分钟的长音频跳过自动分析，避免占满磁盘与内存
	musicRhythmMaxAudioBytes      = 32 << 20
	musicRhythmMaxPCMBytes        = 20 * 60 * rhythmSampleRate * 4
	musicRhythmDownloadTimeout    = 45 * time.Second
	musicRhythmDecodeTimeout      = 30 * time.Second
	musicRhythmJobTotalTimeout    = 2 * time.Minute
)

var (
	musicRhythmCache = cache.NewTiered("music:rhythm", 500, 32<<20)
	musicRhythmSem   = make(chan struct{}, 1)
	musicRhythmHTTP  = &http.Client{Timeout: musicRhythmDownloadTimeout}

	rhythmFFmpeg struct {
		sync.RWMutex
		initialized bool
		available   bool
		path        string
	}
)

type rhythmJobService struct {
	prefix        string
	initOnce      sync.Once
	mu            sync.Mutex
	fetchAudioURL func(ctx context.Context, id int64) (string, error)
	done          func(songID int64, err error)
}

var musicRhythmJobs = &rhythmJobService{
	prefix:        "music_rhythm",
	fetchAudioURL: fetchRhythmStandardAudioURL,
}

func probeFFmpegBinary(configured string) (resolved string, disabled bool, err error) {
	trimmed := strings.TrimSpace(configured)
	switch strings.ToLower(trimmed) {
	case "false", "0", "off", "none":
		return "", true, nil
	}
	target := trimmed
	if target == "" {
		target = "ffmpeg"
	}
	path, err := exec.LookPath(target)
	if err != nil {
		return "", false, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, path, "-version").Run(); err != nil {
		return "", false, err
	}
	return path, false, nil
}

// InitMusicRhythm 在启动时探测 ffmpeg 是否可用；不可用时不阻塞启动，自动降级为仅读取已有缓存与管理员前端上传兜底
func InitMusicRhythm() {
	configured := utils.Env.Get(constant.EnvKeyFFmpegPath)
	resolved, disabled, err := probeFFmpegBinary(configured)
	rhythmFFmpeg.Lock()
	rhythmFFmpeg.initialized = true
	if disabled || err != nil {
		rhythmFFmpeg.available = false
		rhythmFFmpeg.path = ""
	} else {
		rhythmFFmpeg.available = true
		rhythmFFmpeg.path = resolved
	}
	rhythmFFmpeg.Unlock()

	if disabled {
		logrus.Infof("已通过 %s 禁用后端 ffmpeg，音乐节拍分析仅使用服务端缓存与管理员上传", constant.EnvKeyFFmpegPath)
		return
	}
	if err != nil {
		logrus.Infof("未检测到可用 ffmpeg (%v)，后端自动音频节拍分析已关闭，将依赖已有缓存与管理员前端上传兜底", err)
		return
	}
	logrus.Infof("检测到可用 ffmpeg (%s)，已启用音乐节拍后端自动分析", resolved)
}

func ensureMusicRhythmFFmpegInit() {
	rhythmFFmpeg.RLock()
	initialized := rhythmFFmpeg.initialized
	rhythmFFmpeg.RUnlock()
	if !initialized {
		InitMusicRhythm()
	}
}

func rhythmFFmpegStatus() (bool, string) {
	ensureMusicRhythmFFmpegInit()
	rhythmFFmpeg.RLock()
	defer rhythmFFmpeg.RUnlock()
	return rhythmFFmpeg.available, rhythmFFmpeg.path
}

// setMusicRhythmFFmpegForTest 仅供同包测试覆盖有/无 ffmpeg 运行态，调用方负责恢复状态
func setMusicRhythmFFmpegForTest(path string) {
	rhythmFFmpeg.Lock()
	defer rhythmFFmpeg.Unlock()
	rhythmFFmpeg.initialized = true
	rhythmFFmpeg.path = strings.TrimSpace(path)
	rhythmFFmpeg.available = rhythmFFmpeg.path != ""
}

func (r *rhythmJobService) keyPrefix() string {
	r.initOnce.Do(func() {
		if r.prefix == "" {
			r.prefix = "music_rhythm_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return r.prefix
}

func (r *rhythmJobService) stateKeys(id int64) (jobKey, failedKey string) {
	idStr := strconv.FormatInt(id, 10)
	return r.keyPrefix() + ":job:" + idStr, r.keyPrefix() + ":failed:" + idStr
}

func (r *rhythmJobService) jobState(id int64) (running, coolingDown bool) {
	jobKey, failedKey := r.stateKeys(id)
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		logrus.Warnf("read music rhythm state %d: %v", id, err)
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (r *rhythmJobService) start(id int64, expectedDurationMs int64, ffmpegBin string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	jobKey, failedKey := r.stateKeys(id)
	lease, err := sharedstate.AcquireLease(jobKey, musicRhythmJobTTL)
	if err != nil || lease == nil {
		if err != nil {
			logrus.Warnf("start music rhythm job %d: %v", id, err)
		}
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go r.execute(lease, id, expectedDurationMs, ffmpegBin)
}

func (r *rhythmJobService) execute(lease *sharedstate.Lease, id int64, expectedDurationMs int64, ffmpegBin string) {
	var err error
	defer func() {
		if rec := recover(); rec != nil {
			logrus.Errorf("music rhythm panic for song %d: %v", id, rec)
			err = fmt.Errorf("panic: %v", rec)
		}
		if err != nil {
			_, failedKey := r.stateKeys(id)
			if setErr := sharedstate.Current().Set(failedKey, "1", musicRhythmRetryAfter); setErr != nil {
				logrus.Warnf("save music rhythm failure cooldown %d: %v", id, setErr)
			}
		}
		lease.Release()
		if r.done != nil {
			r.done(id, err)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), musicRhythmJobTotalTimeout)
	defer cancel()

	// 容器内同时最多执行一个解码 + 分析任务，保证内存峰值可控
	select {
	case musicRhythmSem <- struct{}{}:
		defer func() { <-musicRhythmSem }()
	case <-ctx.Done():
		err = ctx.Err()
		return
	}

	audioURL, fetchErr := r.fetchAudioURL(ctx, id)
	if fetchErr != nil {
		err = fetchErr
		logrus.Debugf("music rhythm fetch url skipped for song %d: %v", id, err)
		return
	}

	tmpPath, dlErr := downloadRhythmAudioTemp(ctx, audioURL)
	if dlErr != nil {
		err = dlErr
		logrus.Warnf("music rhythm download audio failed for song %d: %v", id, err)
		return
	}
	defer os.Remove(tmpPath)

	samples, decErr := decodeAudioSamplesWithFFmpeg(ctx, ffmpegBin, tmpPath)
	if decErr != nil {
		err = decErr
		logrus.Warnf("music rhythm ffmpeg decode failed for song %d: %v", id, err)
		return
	}

	analysis, algoErr := AnalyzeRhythm(samples, rhythmSampleRate)
	if algoErr != nil {
		err = algoErr
		logrus.Warnf("music rhythm analyze failed for song %d: %v", id, err)
		return
	}

	cleaned, svcErr := normalizeAndValidateRhythmAnalysis(analysis, expectedDurationMs)
	if svcErr != nil {
		err = svcErr
		logrus.Warnf("music rhythm validation failed for song %d: %s", id, svcErr.Message)
		return
	}

	if saveErr := saveSongRhythmRecord(id, "server", cleaned); saveErr != nil {
		err = saveErr
		logrus.Warnf("music rhythm persist failed for song %d: %v", id, err)
		return
	}
}

func fetchRhythmStandardAudioURL(ctx context.Context, id int64) (string, error) {
	cfg := tools.GetNCMConfig()
	if !cfg.Configured() {
		return "", errors.New("ncm not configured")
	}
	var result struct {
		Data []struct {
			URL           string          `json:"url"`
			FreeTrialInfo json.RawMessage `json:"freeTrialInfo"`
		} `json:"data"`
	}
	// 节拍分析固定降采样到 11025Hz 单声道，后端固定请求最低档 standard（~128kbps），兼顾速度与带宽
	params := url.Values{"id": {strconv.FormatInt(id, 10)}, "level": {"standard"}}
	if err := ncmGet(ctx, cfg, "/song/url/v1", params, &result); err != nil {
		return "", err
	}
	if len(result.Data) == 0 || result.Data[0].URL == "" {
		return "", errors.New("empty song audio url")
	}
	trial := bytes.TrimSpace(result.Data[0].FreeTrialInfo)
	if len(trial) > 0 && string(trial) != "null" {
		return "", errors.New("trial audio skipped for server rhythm analysis")
	}
	rawURL := strings.TrimSpace(result.Data[0].URL)
	if strings.HasPrefix(rawURL, "http://127.0.0.1") || strings.HasPrefix(rawURL, "http://localhost") {
		return rawURL, nil
	}
	return httpsURL(rawURL), nil
}

func downloadRhythmAudioTemp(ctx context.Context, audioURL string) (string, error) {
	dlCtx, cancel := context.WithTimeout(ctx, musicRhythmDownloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, audioURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := musicRhythmHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return "", fmt.Errorf("audio http status %d", resp.StatusCode)
	}
	if resp.ContentLength > musicRhythmMaxAudioBytes {
		return "", fmt.Errorf("audio content too large: %d", resp.ContentLength)
	}
	tmpFile, err := os.CreateTemp("", "neo-rhythm-*.audio")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()
	cleanup := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}

	written, err := io.Copy(tmpFile, io.LimitReader(resp.Body, musicRhythmMaxAudioBytes+1))
	if err != nil {
		cleanup()
		return "", err
	}
	if written > musicRhythmMaxAudioBytes {
		cleanup()
		return "", fmt.Errorf("audio size exceeds limit (%d bytes)", written)
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return tmpPath, nil
}

func decodeAudioSamplesWithFFmpeg(ctx context.Context, ffmpegBin, filePath string) ([]float32, error) {
	decCtx, cancel := context.WithTimeout(ctx, musicRhythmDecodeTimeout)
	defer cancel()
	// M4A 等容器可能有尾部 moov 原子需要 seek，输入必须走临时文件；输出固定为小端 11025Hz 单声道 f32le 流
	cmd := exec.CommandContext(
		decCtx,
		ffmpegBin,
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-i", filePath,
		"-vn", "-sn", "-dn",
		"-ac", "1",
		"-ar", strconv.Itoa(rhythmSampleRate),
		"-f", "f32le",
		"pipe:1",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	pcmBytes, readErr := io.ReadAll(io.LimitReader(stdout, musicRhythmMaxPCMBytes+4))
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("ffmpeg: %s (%w)", msg, waitErr)
		}
		return nil, waitErr
	}
	if len(pcmBytes) > musicRhythmMaxPCMBytes {
		return nil, errors.New("decoded audio exceeds max length")
	}
	sampleCount := len(pcmBytes) / 4
	samples := make([]float32, sampleCount)
	for i := range sampleCount {
		samples[i] = math.Float32frombits(binary.LittleEndian.Uint32(pcmBytes[i*4 : i*4+4]))
	}
	return samples, nil
}

func musicRhythmCacheKey(id int64) string {
	return strconv.FormatInt(id, 10)
}

func loadSavedSongRhythm(id int64) (*dto.MusicRhythmAnalysisDto, *errs.ServiceError) {
	key := musicRhythmCacheKey(id)
	if cached, ok := cache.GetJSON[dto.MusicRhythmAnalysisDto](musicRhythmCache, key); ok && cached.DurationMs > 0 {
		return &cached, nil
	}
	db := repo.GetDB()
	if db == nil {
		return nil, nil
	}
	var record model.MusicSongRhythm
	err := db.Where("song_id = ?", id).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, errs.Internal("failed_to_get_target", err)
	}
	var analysis dto.MusicRhythmAnalysisDto
	if err := json.Unmarshal([]byte(record.Data), &analysis); err != nil {
		logrus.Warnf("invalid stored music rhythm json for song %d: %v", id, err)
		return nil, nil
	}
	cache.SetJSON(musicRhythmCache, key, analysis, musicRhythmCacheTTL)
	return &analysis, nil
}

func saveSongRhythmRecord(id int64, source string, analysis *dto.MusicRhythmAnalysisDto) error {
	db := repo.GetDB()
	if db == nil {
		return repo.ErrDatabaseNotInitialized
	}
	payload, err := json.Marshal(analysis)
	if err != nil {
		return err
	}
	record := model.MusicSongRhythm{
		SongID:      id,
		AlgoVersion: analysis.AlgoVersion,
		DurationMs:  analysis.DurationMs,
		Source:      source,
		Data:        string(payload),
		UpdatedAt:   time.Now(),
	}
	if err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"algo_version", "duration_ms", "source", "data", "updated_at"}),
	}).Create(&record).Error; err != nil {
		return err
	}
	cache.SetJSON(musicRhythmCache, musicRhythmCacheKey(id), analysis, musicRhythmCacheTTL)
	return nil
}

func (s *MusicService) rhythmTargetTrack(ctx context.Context, id int64, allowAdmin bool) *dto.MusicTrackDto {
	if track := s.annotatableTrack(ctx, id); track != nil {
		return track
	}
	if !allowAdmin || !tools.GetNCMConfig().Configured() {
		return nil
	}
	song, svcerr := s.GetSong(ctx, id)
	if svcerr != nil {
		return nil
	}
	return &dto.MusicTrackDto{ID: song.ID, Duration: song.Duration}
}

func (s *MusicService) expectedRhythmDurationMs(ctx context.Context, id int64) int64 {
	if track := s.playlistTrack(ctx, id); track != nil {
		return track.Duration
	}
	if !tools.GetNCMConfig().Configured() {
		return 0
	}
	song, svcerr := s.GetSong(ctx, id)
	if svcerr != nil || song == nil {
		return 0
	}
	return song.Duration
}

// GetSongRhythm 查询一首歌的服务端节拍缓存；未命中且后端配置了可用 ffmpeg 时为白名单/管理员曲目在后台队列分析
func (s *MusicService) GetSongRhythm(ctx context.Context, id int64) (*dto.MusicSongRhythmDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if !s.SongPlayable(ctx, id) {
		return nil, errs.NewNotFound("music_song_not_found")
	}
	if analysis, svcerr := loadSavedSongRhythm(id); svcerr != nil {
		return nil, svcerr
	} else if analysis != nil {
		return &dto.MusicSongRhythmDto{Status: "ready", Analysis: analysis}, nil
	}

	running, coolingDown := musicRhythmJobs.jobState(id)
	if running {
		return &dto.MusicSongRhythmDto{Status: "pending"}, nil
	}
	available, ffmpegBin := rhythmFFmpegStatus()
	if !available {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "ffmpeg_unavailable"}, nil
	}
	if coolingDown {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "analysis_failed"}, nil
	}

	user, ok := ctxutils.GetCurrentUser(ctx)
	isAdminUser := ok && user.IsAdmin()
	track := s.rhythmTargetTrack(ctx, id, isAdminUser)
	if track == nil {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "song_not_eligible"}, nil
	}
	if track.Duration > musicRhythmMaxAudioDurationMs {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "audio_too_long"}, nil
	}

	musicRhythmJobs.start(id, track.Duration, ffmpegBin)
	return &dto.MusicSongRhythmDto{Status: "pending"}, nil
}

// SaveSongRhythm 保存管理员前端分析并上传的节拍缓存，供全站访客直接复用
func (s *MusicService) SaveSongRhythm(ctx context.Context, id int64, req *dto.MusicRhythmAnalysisDto) (*dto.MusicSongRhythmDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	expectedDurationMs := s.expectedRhythmDurationMs(ctx, id)
	cleaned, svcerr := normalizeAndValidateRhythmAnalysis(req, expectedDurationMs)
	if svcerr != nil {
		return nil, svcerr
	}
	if err := saveSongRhythmRecord(id, "admin", cleaned); err != nil {
		return nil, errs.Internal("failed_to_save_target", err)
	}
	_, failedKey := musicRhythmJobs.stateKeys(id)
	_ = sharedstate.Current().Delete(failedKey)
	return &dto.MusicSongRhythmDto{Status: "ready", Analysis: cleaned}, nil
}

// RefreshSongRhythm 清除一首歌的服务端节拍缓存；若后端有可用 ffmpeg 则立即触发重新分析
func (s *MusicService) RefreshSongRhythm(ctx context.Context, id int64) (*dto.MusicSongRhythmDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if db := repo.GetDB(); db != nil {
		if err := db.Where("song_id = ?", id).Delete(&model.MusicSongRhythm{}).Error; err != nil {
			return nil, errs.Internal("failed_to_delete_target", err)
		}
	}
	musicRhythmCache.Delete(musicRhythmCacheKey(id))
	_, failedKey := musicRhythmJobs.stateKeys(id)
	_ = sharedstate.Current().Delete(failedKey)

	if running, _ := musicRhythmJobs.jobState(id); running {
		return &dto.MusicSongRhythmDto{Status: "pending"}, nil
	}
	available, ffmpegBin := rhythmFFmpegStatus()
	if !available {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "ffmpeg_unavailable"}, nil
	}
	track := s.rhythmTargetTrack(ctx, id, true)
	if track == nil {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "song_not_eligible"}, nil
	}
	if track.Duration > musicRhythmMaxAudioDurationMs {
		return &dto.MusicSongRhythmDto{Status: "unavailable", Reason: "audio_too_long"}, nil
	}
	musicRhythmJobs.start(id, track.Duration, ffmpegBin)
	return &dto.MusicSongRhythmDto{Status: "pending"}, nil
}
