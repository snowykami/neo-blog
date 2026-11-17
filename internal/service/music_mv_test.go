package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestMusicMVInfoSettingAndStream(t *testing.T) {
	editorCtx, adminCtx, userCtx, _, _ := setupEditTest(t)
	s := NewMusicService()
	guestCtx := context.Background()

	videoBytes := []byte("0123456789abcdefMP4VIDEO")
	var failFirstStream atomic.Bool
	var detailCalls, mvURLCalls, streamCalls atomic.Int32

	var ncmSrv *httptest.Server
	ncmSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON := func(v any) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(v)
		}
		switch r.URL.Path {
		case "/playlist/track/all":
			writeJSON(map[string]any{
				"code": 200,
				"songs": []map[string]any{
					{"id": 10, "name": "有MV的歌", "ar": []map[string]any{{"name": "歌手A"}}, "al": map[string]any{"name": "专辑A"}, "dt": 180000},
					{"id": 20, "name": "无MV的歌", "ar": []map[string]any{{"name": "歌手B"}}, "al": map[string]any{"name": "专辑B"}, "dt": 200000},
				},
				"privileges": []map[string]any{{"id": 10, "st": 0}, {"id": 20, "st": 0}},
			})
		case "/song/detail":
			detailCalls.Add(1)
			if r.Header.Get("Cookie") != "" {
				t.Errorf("/song/detail should not carry cookie")
			}
			switch r.URL.Query().Get("ids") {
			case "10":
				writeJSON(map[string]any{"code": 200, "songs": []map[string]any{{"id": 10, "name": "有MV的歌", "mv": 5001}}})
			case "20":
				writeJSON(map[string]any{"code": 200, "songs": []map[string]any{{"id": 20, "name": "无MV的歌", "mv": 0}}})
			default:
				writeJSON(map[string]any{"code": 200, "songs": []any{}})
			}
		case "/mv/url":
			mvURLCalls.Add(1)
			if r.URL.Query().Get("r") != "480" {
				t.Errorf("expected r=480, got %q", r.URL.Query().Get("r"))
			}
			if r.URL.Query().Get("id") != "5001" {
				writeJSON(map[string]any{"code": 200, "data": map[string]any{"url": ""}})
				return
			}
			token := "valid"
			if failFirstStream.CompareAndSwap(true, false) {
				token = "expired"
			}
			writeJSON(map[string]any{
				"code": 200,
				"data": map[string]any{
					"id":   5001,
					"url":  ncmSrv.URL + "/vod/5001.mp4?token=" + token,
					"r":    480,
					"expi": 3600,
				},
			})
		case "/vod/5001.mp4":
			streamCalls.Add(1)
			if r.URL.Query().Get("token") == "expired" {
				http.Error(w, "expired", http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeContent(w, r, "5001.mp4", time.Time{}, bytes.NewReader(videoBytes))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ncmSrv.Close)

	setMusicKV(t, map[string]any{
		"ncm_api_base_url": ncmSrv.URL,
		"ncm_cookie":       "abc",
		"ncm_playlist_id":  float64(888),
	})

	// 参数与白名单校验
	_, svcerr := s.GetSongMV(guestCtx, 0)
	expectCode(t, svcerr, http.StatusBadRequest, "invalid song id")
	_, svcerr = s.GetSongMV(guestCtx, 99999)
	expectCode(t, svcerr, http.StatusNotFound, "outside whitelist")

	// 无 MV 的白名单歌曲返回 available=false
	noMV, svcerr := s.GetSongMV(guestCtx, 20)
	if svcerr != nil || noMV.MVID != 0 || noMV.Available || noMV.StreamURL != "" {
		t.Fatalf("unexpected no-mv response: %+v, err=%v", noMV, svcerr)
	}
	// 再次查询命中负缓存，不再调用 /song/detail
	beforeDetail := detailCalls.Load()
	if _, svcerr = s.GetSongMV(guestCtx, 20); svcerr != nil || detailCalls.Load() != beforeDetail {
		t.Fatalf("expected song_id->mvid=0 cached, detailCalls=%d", detailCalls.Load())
	}

	// 有 MV 的白名单歌曲返回完整信息，且缓存生效
	mvInfo, svcerr := s.GetSongMV(guestCtx, 10)
	if svcerr != nil {
		t.Fatalf("GetSongMV(10): %v", svcerr)
	}
	if mvInfo.MVID != 5001 || !mvInfo.Available || mvInfo.OffsetMs != 0 || mvInfo.Disabled || mvInfo.StreamURL != "/api/v1/music/mv/5001/stream" {
		t.Fatalf("unexpected mv info: %+v", mvInfo)
	}
	beforeMVURL := mvURLCalls.Load()
	if _, svcerr = s.GetSongMV(guestCtx, 10); svcerr != nil || mvURLCalls.Load() != beforeMVURL {
		t.Fatalf("expected mv url cached, mvURLCalls=%d", mvURLCalls.Load())
	}

	// Service 层 RBAC 与参数边界校验
	_, svcerr = s.SaveSongMVSetting(guestCtx, 10, &dto.MusicMVSettingReq{OffsetMs: 500})
	expectCode(t, svcerr, http.StatusUnauthorized, "guest save mv setting")
	_, svcerr = s.SaveSongMVSetting(userCtx, 10, &dto.MusicMVSettingReq{OffsetMs: 500})
	expectCode(t, svcerr, http.StatusForbidden, "user save mv setting")
	_, svcerr = s.SaveSongMVSetting(editorCtx, 10, &dto.MusicMVSettingReq{OffsetMs: 500})
	expectCode(t, svcerr, http.StatusForbidden, "editor save mv setting")
	_, svcerr = s.SaveSongMVSetting(adminCtx, 10, &dto.MusicMVSettingReq{OffsetMs: -60001})
	expectCode(t, svcerr, http.StatusBadRequest, "offset below min")
	_, svcerr = s.SaveSongMVSetting(adminCtx, 10, &dto.MusicMVSettingReq{OffsetMs: 180001})
	expectCode(t, svcerr, http.StatusBadRequest, "offset above max")

	saved, svcerr := s.SaveSongMVSetting(adminCtx, 10, &dto.MusicMVSettingReq{OffsetMs: 1200, Disabled: true})
	if svcerr != nil || saved.OffsetMs != 1200 || !saved.Disabled || !saved.Available {
		t.Fatalf("admin save mv setting: %+v, err=%v", saved, svcerr)
	}
	fetchedAfterSave, svcerr := s.GetSongMV(guestCtx, 10)
	if svcerr != nil || fetchedAfterSave.OffsetMs != 1200 || !fetchedAfterSave.Disabled {
		t.Fatalf("guest read saved mv setting: %+v, err=%v", fetchedAfterSave, svcerr)
	}

	// 未在白名单内的任意 mvid 对访客拒绝代理
	_, svcerr = s.OpenMVStream(guestCtx, 9999, "bytes=0-3")
	expectCode(t, svcerr, http.StatusNotFound, "unapproved mvid stream")

	// Range 视频流代理：验证 206 Partial Content 及关键头
	stream, svcerr := s.OpenMVStream(guestCtx, 5001, "bytes=4-9")
	if svcerr != nil {
		t.Fatalf("OpenMVStream range: %v", svcerr)
	}
	chunk, _ := io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if stream.StatusCode != http.StatusPartialContent ||
		stream.ContentRange != "bytes 4-9/24" ||
		stream.AcceptRanges != "bytes" ||
		stream.ContentLength != 6 ||
		stream.ContentType != "video/mp4" ||
		string(chunk) != "456789" {
		t.Fatalf("unexpected range stream: status=%d range=%q len=%d type=%q body=%q",
			stream.StatusCode, stream.ContentRange, stream.ContentLength, stream.ContentType, string(chunk))
	}

	// 当缓存的直链返回 403 时，自动刷新一次 /mv/url 并重试成功
	musicMVURLCache.Clear()
	failFirstStream.Store(true)
	retryStream, svcerr := s.OpenMVStream(guestCtx, 5001, "bytes=0-3")
	if svcerr != nil {
		t.Fatalf("OpenMVStream retry after 403: %v", svcerr)
	}
	retryChunk, _ := io.ReadAll(retryStream.Body)
	_ = retryStream.Body.Close()
	if retryStream.StatusCode != http.StatusPartialContent || string(retryChunk) != "0123" {
		t.Fatalf("unexpected retry stream: status=%d body=%q", retryStream.StatusCode, string(retryChunk))
	}
}
