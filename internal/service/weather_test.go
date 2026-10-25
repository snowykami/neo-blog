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
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
)

func TestWeatherCurrent(t *testing.T) {
	setupEditTest(t) // 天气数据源由配置决定，需要读取配置
	setMusicKV(t, map[string]any{"qweather_api_host": "", "qweather_api_key": ""})
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
	setupEditTest(t) // 天气数据源由配置决定，需要读取配置
	setMusicKV(t, map[string]any{"qweather_api_host": "", "qweather_api_key": ""})
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

// 配置了和风天气时使用和风天气：Key 通过请求头传递，坐标为“经度,纬度”，城市搜索无结果按空结果处理，Key 无效时报错
func TestWeatherQWeather(t *testing.T) {
	setupEditTest(t)
	var nowCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-QW-Api-Key") != "qw-key" || r.URL.Query().Get("key") != "" {
			_ = json.NewEncoder(w).Encode(map[string]any{"code": "401"})
			return
		}
		switch r.URL.Path {
		case "/v7/weather/now":
			nowCalls.Add(1)
			if r.URL.Query().Get("location") != "121.47,31.23" {
				t.Errorf("unexpected location %q", r.URL.Query().Get("location"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": "200", "now": map[string]any{
				"obsTime": "2026-10-23T14:36+08:00", "temp": "24", "icon": "305", "windScale": "3-4", "windSpeed": "15", "humidity": "72",
			}})
		case "/geo/v2/city/lookup":
			if r.URL.Query().Get("location") == "无此地" {
				_ = json.NewEncoder(w).Encode(map[string]any{"code": "404"})
				return
			}
			if r.URL.Query().Get("lang") != "zh" {
				t.Errorf("unexpected lang %q", r.URL.Query().Get("lang"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": "200", "location": []map[string]any{
				{"name": "杭州", "lat": "30.28746", "lon": "120.15358", "adm2": "杭州", "adm1": "浙江省", "country": "中国"},
				{"name": "坏数据", "lat": "x", "lon": "1"},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	weatherCache.reset()
	weatherGeoCache.reset()
	setMusicKV(t, map[string]any{"qweather_api_host": srv.URL + "/ignored/path", "qweather_api_key": "qw-key"})

	s := NewWeatherService()
	lat, lon := 31.234, 121.466
	weather, svcerr := s.GetCurrent(context.Background(), &dto.WeatherReq{Lat: &lat, Lon: &lon})
	if svcerr != nil {
		t.Fatalf("current: %v", svcerr)
	}
	if weather.Condition != "drizzle" || weather.Temperature != 24 || weather.Humidity != 72 || weather.WindLevel != 3 ||
		weather.ObservedAt != "2026-10-23T14:36" || weather.Timezone != "+08:00" || !weather.IsDay {
		t.Fatalf("unexpected weather: %+v", weather)
	}
	if _, svcerr = s.GetCurrent(context.Background(), &dto.WeatherReq{Lat: &lat, Lon: &lon}); svcerr != nil || nowCalls.Load() != 1 {
		t.Fatalf("weather should be cached: %v %d", svcerr, nowCalls.Load())
	}

	places, svcerr := s.SearchPlaces(context.Background(), &dto.WeatherGeoReq{Query: "杭州", Lang: "zh"})
	if svcerr != nil || len(places) != 1 || places[0].Name != "杭州" || places[0].Admin1 != "浙江省" || places[0].Latitude != 30.28746 {
		t.Fatalf("places: %v %+v", svcerr, places)
	}
	if places, svcerr = s.SearchPlaces(context.Background(), &dto.WeatherGeoReq{Query: "无此地", Lang: "zh"}); svcerr != nil || len(places) != 0 {
		t.Fatalf("no result should be empty: %v %+v", svcerr, places)
	}

	// Key 无效
	setMusicKV(t, map[string]any{"qweather_api_key": "wrong"})
	other := 30.0
	_, svcerr = s.GetCurrent(context.Background(), &dto.WeatherReq{Lat: &other, Lon: &lon})
	expectCode(t, svcerr, http.StatusBadGateway, "invalid key")
}

func TestQWeatherCondition(t *testing.T) {
	cases := map[int]string{100: "clear", 150: "clear", 101: "partly_cloudy", 153: "partly_cloudy", 104: "cloudy", 302: "thunderstorm", 305: "drizzle",
		306: "rain", 350: "rain", 313: "sleet", 404: "sleet", 400: "snow", 457: "snow", 501: "fog", 999: "cloudy"}
	for icon, want := range cases {
		if got := QWeatherCondition(icon); got != want {
			t.Errorf("icon %d: got %s, want %s", icon, got, want)
		}
	}
	if !qweatherIsNight(151) || qweatherIsNight(101) {
		t.Fatal("night icon detection")
	}
}

func TestWeatherLocateByIP(t *testing.T) {
	setupEditTest(t) // 天气数据源由配置决定，需要读取配置
	setMusicKV(t, map[string]any{"qweather_api_host": "", "qweather_api_key": ""})
	var queries []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		queries = append(queries, name)
		// 地名库对不带「市」后缀的名字匹配更好：带后缀的查不到结果
		if name != "重庆" {
			_, _ = w.Write([]byte(`{"generationtime_ms":0.1}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"name": "重庆", "admin1": "重庆市", "country": "中国", "country_code": "CN", "latitude": 29.56026, "longitude": 106.55771},
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

	// 内网 / 本机 / 非法地址无法估计位置，且不请求地名服务
	for _, ip := range []string{"", "127.0.0.1", "10.0.0.8", "::1", "not-an-ip"} {
		_, svcerr := s.LocateByIP(ctx, ip, "zh")
		expectCode(t, svcerr, http.StatusNotFound, "unlocatable ip "+ip)
	}
	if len(queries) != 0 {
		t.Fatalf("reserved ip should not request geocoding, queries=%v", queries)
	}

	// 归属地城市名带「市」后缀时，回退到去掉后缀的写法
	place, svcerr := s.LocateByIP(ctx, "222.178.10.1", "zh")
	if svcerr != nil || place == nil || place.Name != "重庆" || place.Latitude != 29.56026 || place.CountryCode != "CN" {
		t.Fatalf("place: %v %+v", svcerr, place)
	}
	if len(queries) != 2 || queries[0] != "重庆市" || queries[1] != "重庆" {
		t.Fatalf("unexpected queries: %v", queries)
	}
	// 同一城市命中缓存，不再请求地名服务
	if _, svcerr = s.LocateByIP(ctx, "222.178.10.2", "zh"); svcerr != nil || len(queries) != 2 {
		t.Fatalf("locate should be cached: %v %v", svcerr, queries)
	}
}

func TestIPPlaceCandidates(t *testing.T) {
	cases := []struct {
		name   string
		region ipregion.Region
		want   []string
	}{
		{"domestic city", ipregion.Region{Country: "中国", Province: "广东省", City: "深圳市", CountryCode: "CN"}, []string{"深圳市", "深圳", "广东省", "广东"}},
		{"municipality", ipregion.Region{Country: "中国", Province: "重庆市", City: "重庆市", CountryCode: "CN"}, []string{"重庆市", "重庆"}},
		{"city unknown", ipregion.Region{Country: "中国", Province: "浙江省", City: "0"}, []string{"浙江省", "浙江"}},
		{"overseas", ipregion.Region{Country: "United States", Province: "California", City: "0"}, []string{"California"}},
		{"reserved", ipregion.Region{Reserved: true}, nil},
		{"empty", ipregion.Region{}, nil},
	}
	for _, c := range cases {
		got := ipPlaceCandidates(c.region)
		if len(got) != len(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("%s: got %v, want %v", c.name, got, c.want)
				break
			}
		}
	}
}

func TestWeatherReverse(t *testing.T) {
	setupEditTest(t)
	setMusicKV(t, map[string]any{"qweather_api_host": "", "qweather_api_key": ""})
	var calls atomic.Int32
	var lastQuery atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		lastQuery.Store(r.URL.RawQuery)
		if r.URL.Query().Get("latitude") == "0.00" {
			// 无地名（如远洋）返回空字段，由服务层按 404 处理
			_ = json.NewEncoder(w).Encode(map[string]any{"city": "", "locality": "", "principalSubdivision": ""})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"city": "杭州市", "locality": "拱墅区", "principalSubdivision": "浙江省",
			"countryName": "中华人民共和国", "countryCode": "CN",
		})
	}))
	t.Cleanup(srv.Close)
	original := bigDataCloudReverseURL
	bigDataCloudReverseURL = srv.URL
	t.Cleanup(func() { bigDataCloudReverseURL = original })
	weatherReverseCache.reset()

	s := NewWeatherService()
	ctx := context.Background()
	reverse := func(lat, lon float64, lang string) (*dto.WeatherPlaceDto, *errs.ServiceError) {
		return s.Reverse(ctx, &dto.WeatherReverseReq{Lat: &lat, Lon: &lon, Lang: lang})
	}

	// 坐标缺失或越界时不请求上游
	invalid := []*dto.WeatherReverseReq{{}, {Lat: new(float64)}, func() *dto.WeatherReverseReq {
		lat, lon := 91.0, 0.0
		return &dto.WeatherReverseReq{Lat: &lat, Lon: &lon}
	}(), func() *dto.WeatherReverseReq {
		lat, lon := math.NaN(), 0.0
		return &dto.WeatherReverseReq{Lat: &lat, Lon: &lon}
	}()}
	for i, req := range invalid {
		_, svcerr := s.Reverse(ctx, req)
		expectCode(t, svcerr, http.StatusBadRequest, fmt.Sprintf("invalid coordinate #%d", i))
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid coordinates should not request upstream, calls=%d", calls.Load())
	}

	place, svcerr := reverse(30.27410, 120.15510, "zh")
	if svcerr != nil || place.Name != "拱墅区" || place.Admin1 != "杭州市" || place.CountryCode != "CN" || place.Latitude != 30.27 {
		t.Fatalf("reverse: %v %+v", svcerr, place)
	}
	// 简体、坐标取整
	if q := lastQuery.Load().(string); !strings.Contains(q, "localityLanguage=zh-Hans") || !strings.Contains(q, "latitude=30.27") {
		t.Fatalf("unexpected upstream query: %s", q)
	}
	// 取整后相同的坐标命中缓存，语言不同则分别请求
	if _, svcerr = reverse(30.27499, 120.15501, "zh"); svcerr != nil || calls.Load() != 1 {
		t.Fatalf("cache miss for same rounded coordinate: %v calls=%d", svcerr, calls.Load())
	}
	if _, svcerr = reverse(30.27410, 120.15510, "zh-tw"); svcerr != nil || calls.Load() != 2 {
		t.Fatalf("different language should be cached separately: %v calls=%d", svcerr, calls.Load())
	}
	if q := lastQuery.Load().(string); !strings.Contains(q, "localityLanguage=zh-Hant") {
		t.Fatalf("zh-tw should request traditional names: %s", q)
	}
	// 没有地名时返回 404，由前端退回「当前位置」
	_, svcerr = reverse(0, 0, "zh")
	expectCode(t, svcerr, http.StatusNotFound, "no place")
}

func TestWeatherReverseQWeather(t *testing.T) {
	setupEditTest(t)
	var lastQuery atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastQuery.Store(r.URL.RawQuery)
		_ = json.NewEncoder(w).Encode(map[string]any{"code": "200", "location": []map[string]any{
			{"name": "拱墅区", "lat": "30.319", "lon": "120.142", "adm2": "杭州市", "adm1": "浙江省", "country": "中国"},
			{"name": "杭州市", "lat": "30.287", "lon": "120.154", "adm2": "杭州市", "adm1": "浙江省", "country": "中国"},
		}})
	}))
	t.Cleanup(srv.Close)
	weatherReverseCache.reset()
	setMusicKV(t, map[string]any{"qweather_api_host": srv.URL, "qweather_api_key": "qw-key"})

	lat, lon := 30.27410, 120.15510
	place, svcerr := NewWeatherService().Reverse(context.Background(), &dto.WeatherReverseReq{Lat: &lat, Lon: &lon, Lang: "zh-tw"})
	if svcerr != nil || place.Name != "拱墅区" || place.Admin1 != "杭州市" || place.Latitude != 30.319 {
		t.Fatalf("qweather reverse: %v %+v", svcerr, place)
	}
	// 和风按「经度,纬度」查最近的一个，语言只认两位码
	q := lastQuery.Load().(string)
	if !strings.Contains(q, "location=120.16%2C30.27") || !strings.Contains(q, "number=1") || !strings.Contains(q, "lang=zh&") {
		t.Fatalf("unexpected upstream query: %s", q)
	}
}
