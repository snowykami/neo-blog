package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestWeatherCurrent(t *testing.T) {
	var calls atomic.Int32
	failing := atomic.Bool{}
	var lastQuery atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		lastQuery.Store(r.URL.RawQuery)
		if failing.Load() {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"timezone": "Asia/Shanghai",
			"current": map[string]any{
				"time": "2026-10-23T14:30", "temperature_2m": 21.46, "relative_humidity_2m": 63.0,
				"weather_code": 61, "wind_speed_10m": 15.04, "is_day": 1,
			},
		})
	}))
	t.Cleanup(srv.Close)
	original := openMeteoForecastURL
	openMeteoForecastURL = srv.URL
	t.Cleanup(func() { openMeteoForecastURL = original })
	weatherCache.reset()

	s := NewWeatherService()
	ctx := context.Background()
	coord := func(lat, lon float64) *dto.WeatherReq { return &dto.WeatherReq{Lat: &lat, Lon: &lon} }

	// 缺少或越界的坐标不发出请求
	invalid := []*dto.WeatherReq{{}, {Lat: new(float64)}, coord(91, 0), coord(0, -181), coord(math.NaN(), 0), coord(0, math.Inf(1))}
	for i, req := range invalid {
		_, svcerr := s.GetCurrent(ctx, req)
		expectCode(t, svcerr, http.StatusBadRequest, fmt.Sprintf("invalid coordinate #%d", i))
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid coordinates should not request upstream, calls=%d", calls.Load())
	}

	weather, svcerr := s.GetCurrent(ctx, coord(31.23041, 121.47370))
	if svcerr != nil || weather.Condition != "rain" || weather.Temperature != 21.5 || weather.Humidity != 63 ||
		weather.WindLevel != 3 || !weather.IsDay || weather.ObservedAt != "2026-10-23T14:30" || weather.Latitude != 31.23 {
		t.Fatalf("weather: %v %+v", svcerr, weather)
	}
	// 请求上游时使用取整后的坐标
	if q := lastQuery.Load().(string); !strings.Contains(q, "latitude=31.23") || !strings.Contains(q, "longitude=121.47") {
		t.Fatalf("upstream query should use rounded coordinates: %s", q)
	}
	// 取整后相同的坐标命中缓存
	if _, svcerr = s.GetCurrent(ctx, coord(31.2349, 121.4699)); svcerr != nil || calls.Load() != 1 {
		t.Fatalf("weather should be cached: %v %d", svcerr, calls.Load())
	}

	// 过期后请求失败时返回旧数据；没有旧数据时返回 502
	failing.Store(true)
	weatherCache.mu.Lock()
	for k, e := range weatherCache.entries {
		e.fetchedAt = time.Now().Add(-weatherTTL)
		weatherCache.entries[k] = e
	}
	weatherCache.mu.Unlock()
	if weather, svcerr = s.GetCurrent(ctx, coord(31.23, 121.47)); svcerr != nil || weather.Condition != "rain" {
		t.Fatalf("stale weather: %v %+v", svcerr, weather)
	}
	_, svcerr = s.GetCurrent(ctx, coord(-33.87, 151.21))
	expectCode(t, svcerr, http.StatusBadGateway, "upstream failed")
}

func TestWeatherGeo(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		q := r.URL.Query()
		if q.Get("language") != "zh" && q.Get("language") != "en" {
			t.Errorf("unexpected language %q", q.Get("language"))
		}
		if q.Get("name") != "上海" {
			_, _ = w.Write([]byte(`{"generationtime_ms":0.1}`)) // 无结果时上游不返回 results
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"name": "上海", "admin1": "上海市", "country": "中国", "country_code": "CN", "latitude": 31.22222, "longitude": 121.45806},
				{"name": "", "latitude": 1, "longitude": 1},      // 无名称，丢弃
				{"name": "bad", "latitude": 100, "longitude": 1}, // 坐标越界，丢弃
			},
		})
	}))
	t.Cleanup(srv.Close)
	original := openMeteoGeocodingURL
	openMeteoGeocodingURL = srv.URL
	t.Cleanup(func() { openMeteoGeocodingURL = original })
	weatherGeoCache.reset()

	s := NewWeatherService()
	ctx := context.Background()

	for _, q := range []string{"", "   ", strings.Repeat("长", weatherGeoQueryMaxLen+1)} {
		_, svcerr := s.SearchPlaces(ctx, &dto.WeatherGeoReq{Query: q})
		expectCode(t, svcerr, http.StatusBadRequest, "invalid query")
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid queries should not request upstream, calls=%d", calls.Load())
	}

	places, svcerr := s.SearchPlaces(ctx, &dto.WeatherGeoReq{Query: " 上海 ", Lang: "zh"})
	if svcerr != nil || len(places) != 1 || places[0].Admin1 != "上海市" || places[0].CountryCode != "CN" {
		t.Fatalf("places: %v %+v", svcerr, places)
	}
	if _, svcerr = s.SearchPlaces(ctx, &dto.WeatherGeoReq{Query: "上海", Lang: "zh"}); svcerr != nil || calls.Load() != 1 {
		t.Fatalf("places should be cached: %v %d", svcerr, calls.Load())
	}
	// 非法语言代码回退为 en；无结果时返回空列表而非 nil
	places, svcerr = s.SearchPlaces(ctx, &dto.WeatherGeoReq{Query: "nowhere", Lang: "../x"})
	if svcerr != nil || places == nil || len(places) != 0 {
		t.Fatalf("empty places: %v %#v", svcerr, places)
	}
}

func TestWeatherMapping(t *testing.T) {
	conditions := map[int]string{0: "clear", 2: "partly_cloudy", 3: "cloudy", 45: "fog", 53: "drizzle", 66: "sleet", 82: "rain", 75: "snow", 99: "thunderstorm", 1000: "cloudy"}
	for code, want := range conditions {
		if got := WeatherCondition(code); got != want {
			t.Errorf("WeatherCondition(%d) = %s, want %s", code, got, want)
		}
	}
	levels := map[float64]int{0: 0, 0.9: 0, 1: 1, 11.9: 2, 12: 3, 61.9: 7, 117.9: 11, 118: 12, 300: 12}
	for speed, want := range levels {
		if got := WindLevel(speed); got != want {
			t.Errorf("WindLevel(%v) = %d, want %d", speed, got, want)
		}
	}
}
