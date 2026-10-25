package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"golang.org/x/sync/singleflight"
)

// 天气信息：供文章内的天气卡使用，数据源为 Open-Meteo（无需 Key）
// 只接受经纬度与城市名；实时卡未指定城市时按访客 IP 定位，结果不保存
// 坐标取整后缓存，请求失败时返回过期的旧数据

const (
	weatherTTL            = 30 * time.Minute // 当前天气缓存时间
	weatherGeoTTL         = 24 * time.Hour   // 城市搜索缓存时间
	weatherRequestTimeout = 10 * time.Second
	weatherCacheMaxLen    = 1000
	weatherGeoQueryMaxLen = 60 // 城市名最大字符数
	weatherGeoResultCount = 8
)

// Open-Meteo 接口地址（测试中替换为本地服务）
var (
	openMeteoForecastURL  = "https://api.open-meteo.com/v1/forecast"
	openMeteoGeocodingURL = "https://geocoding-api.open-meteo.com/v1/search"
)

var weatherLangPattern = regexp.MustCompile(`^[a-z]{2}$`)

var (
	weatherCache    = newTTLCache[*dto.WeatherDto](weatherTTL, weatherCacheMaxLen)
	weatherGeoCache = newTTLCache[[]dto.WeatherPlaceDto](weatherGeoTTL, weatherCacheMaxLen)
	// 同一坐标 / 同一搜索词同时只请求一次
	weatherFetchGroup singleflight.Group
)

type WeatherService struct{}

func NewWeatherService() *WeatherService {
	return &WeatherService{}
}

// GetCurrent 获取坐标处的当前天气，坐标按 0.01°（约 1 km）取整后缓存
func (s *WeatherService) GetCurrent(ctx context.Context, req *dto.WeatherReq) (*dto.WeatherDto, *errs.ServiceError) {
	if req.Lat == nil || req.Lon == nil || !validCoordinate(*req.Lat, 90) || !validCoordinate(*req.Lon, 180) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lat, lon := roundCoordinate(*req.Lat), roundCoordinate(*req.Lon)
	coord := strconv.FormatFloat(lat, 'f', 2, 64) + "," + strconv.FormatFloat(lon, 'f', 2, 64)
	// 配置了和风天气时使用和风天气，否则使用 Open-Meteo；缓存 key 区分数据源
	key := "weather:open-meteo:" + coord
	fetch := func(ctx context.Context) (*dto.WeatherDto, error) { return fetchCurrentWeather(ctx, lat, lon) }
	if qw := tools.GetQWeatherConfig(); qw.Configured() {
		key = "weather:qweather:" + qw.Host + ":" + coord
		fetch = func(ctx context.Context) (*dto.WeatherDto, error) { return fetchQWeatherNow(ctx, qw, lat, lon) }
	}
	weather, err := cachedFetch(ctx, weatherCache, key, fetch)
	if err != nil {
		return nil, errs.New(http.StatusBadGateway, "weather_request_failed", err)
	}
	return weather, nil
}

// SearchPlaces 按名称搜索城市
func (s *WeatherService) SearchPlaces(ctx context.Context, req *dto.WeatherGeoReq) ([]dto.WeatherPlaceDto, *errs.ServiceError) {
	query := strings.TrimSpace(req.Query)
	if query == "" || utf8.RuneCountInString(query) > weatherGeoQueryMaxLen || !utf8.ValidString(query) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lang := strings.ToLower(req.Lang)
	if !weatherLangPattern.MatchString(lang) {
		lang = "en"
	}
	key := "geo:open-meteo:" + lang + ":" + strings.ToLower(query)
	fetch := func(ctx context.Context) ([]dto.WeatherPlaceDto, error) { return fetchPlaces(ctx, query, lang) }
	if qw := tools.GetQWeatherConfig(); qw.Configured() {
		key = "geo:qweather:" + qw.Host + ":" + lang + ":" + strings.ToLower(query)
		fetch = func(ctx context.Context) ([]dto.WeatherPlaceDto, error) {
			return fetchQWeatherPlaces(ctx, qw, query, lang)
		}
	}
	places, err := cachedFetch(ctx, weatherGeoCache, key, fetch)
	if err != nil {
		return nil, errs.New(http.StatusBadGateway, "weather_request_failed", err)
	}
	return places, nil
}

func validCoordinate(value, limit float64) bool {
	return !math.IsNaN(value) && value >= -limit && value <= limit
}

// LocateByIP 按访客 IP 估计所在城市，并复用城市搜索拿到坐标
// 只做城市级估计：归属地来自离线 ip2region 数据（不联网），地名与坐标来自城市搜索（缓存 24 小时）
// 结果不落库，仅用于实时天气卡跟随访客所在地
func (s *WeatherService) LocateByIP(ctx context.Context, ip, lang string) (*dto.WeatherPlaceDto, *errs.ServiceError) {
	candidates := ipPlaceCandidates(ipregion.Lookup(strings.TrimSpace(ip)))
	if len(candidates) == 0 {
		return nil, errs.NewNotFound("weather_location_unavailable")
	}
	for _, name := range candidates {
		places, svcerr := s.SearchPlaces(ctx, &dto.WeatherGeoReq{Query: name, Lang: lang})
		if svcerr != nil {
			return nil, svcerr
		}
		// 城市搜索按相关度排序，取第一个可用结果
		for i := range places {
			if places[i].Name != "" {
				return &places[i], nil
			}
		}
	}
	return nil, errs.NewNotFound("weather_location_unavailable")
}

// ipPlaceCandidates 由 IP 归属地得到可用于地名搜索的候选城市名，按优先级排列
// ip2region 只有行政区名，且“0”表示未知；地名库对不带「市 / 省」后缀的名字匹配更好，因此两种写法都试
func ipPlaceCandidates(region ipregion.Region) []string {
	if region.Reserved {
		return nil
	}
	candidates := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" || name == "0" {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		candidates = append(candidates, name)
	}
	// 城市优先（更接近访客实际位置），其次省份
	add(region.City)
	add(strings.TrimSuffix(region.City, "市"))
	add(region.Province)
	add(strings.TrimSuffix(region.Province, "省"))
	return candidates
}

func roundCoordinate(value float64) float64 {
	rounded := math.Round(value*100) / 100
	if rounded == 0 {
		return 0 // 避免 -0 生成不同的缓存 key
	}
	return rounded
}

// WeatherCondition 将 WMO 天气代码映射为统一的天气状况
func WeatherCondition(code int) string {
	switch code {
	case 0, 1:
		return "clear"
	case 2:
		return "partly_cloudy"
	case 3:
		return "cloudy"
	case 45, 48:
		return "fog"
	case 51, 53, 55:
		return "drizzle"
	case 56, 57, 66, 67:
		return "sleet"
	case 61, 63, 65, 80, 81, 82:
		return "rain"
	case 71, 73, 75, 77, 85, 86:
		return "snow"
	case 95, 96, 99:
		return "thunderstorm"
	}
	return "cloudy"
}

// WindLevel 按风速（km/h）计算蒲福风级
func WindLevel(speed float64) int {
	for level, upper := range []float64{1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118} {
		if speed < upper {
			return level
		}
	}
	return 12
}

func fetchCurrentWeather(ctx context.Context, lat, lon float64) (*dto.WeatherDto, error) {
	params := url.Values{}
	params.Set("latitude", strconv.FormatFloat(lat, 'f', 2, 64))
	params.Set("longitude", strconv.FormatFloat(lon, 'f', 2, 64))
	params.Set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day")
	params.Set("timezone", "auto")
	var raw struct {
		Timezone string `json:"timezone"`
		Current  *struct {
			Time        string   `json:"time"`
			Temperature *float64 `json:"temperature_2m"`
			Humidity    *float64 `json:"relative_humidity_2m"`
			WeatherCode *int     `json:"weather_code"`
			WindSpeed   *float64 `json:"wind_speed_10m"`
			IsDay       int      `json:"is_day"`
		} `json:"current"`
	}
	if err := getOpenMeteoJSON(ctx, openMeteoForecastURL, params, &raw); err != nil {
		return nil, err
	}
	current := raw.Current
	if current == nil || current.Time == "" || current.Temperature == nil || current.Humidity == nil || current.WeatherCode == nil || current.WindSpeed == nil {
		return nil, fmt.Errorf("invalid response: missing current weather")
	}
	return &dto.WeatherDto{
		Condition:   WeatherCondition(*current.WeatherCode),
		Temperature: math.Round(*current.Temperature*10) / 10,
		Humidity:    int(math.Round(*current.Humidity)),
		WindSpeed:   math.Round(*current.WindSpeed*10) / 10,
		WindLevel:   WindLevel(*current.WindSpeed),
		IsDay:       current.IsDay == 1,
		ObservedAt:  current.Time,
		Timezone:    raw.Timezone,
		Latitude:    lat,
		Longitude:   lon,
	}, nil
}

func fetchPlaces(ctx context.Context, query, lang string) ([]dto.WeatherPlaceDto, error) {
	params := url.Values{}
	params.Set("name", query)
	params.Set("count", strconv.Itoa(weatherGeoResultCount))
	params.Set("language", lang)
	params.Set("format", "json")
	var raw struct {
		Results []struct {
			Name        string  `json:"name"`
			Admin1      string  `json:"admin1"`
			Country     string  `json:"country"`
			CountryCode string  `json:"country_code"`
			Latitude    float64 `json:"latitude"`
			Longitude   float64 `json:"longitude"`
		} `json:"results"`
	}
	if err := getOpenMeteoJSON(ctx, openMeteoGeocodingURL, params, &raw); err != nil {
		return nil, err
	}
	places := make([]dto.WeatherPlaceDto, 0, len(raw.Results))
	for _, r := range raw.Results {
		if r.Name == "" || !validCoordinate(r.Latitude, 90) || !validCoordinate(r.Longitude, 180) {
			continue
		}
		places = append(places, dto.WeatherPlaceDto{
			Name:        r.Name,
			Admin1:      r.Admin1,
			Country:     r.Country,
			CountryCode: r.CountryCode,
			Latitude:    r.Latitude,
			Longitude:   r.Longitude,
		})
	}
	return places, nil
}

func getOpenMeteoJSON(ctx context.Context, endpoint string, params url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, weatherRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "neo-blog")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("invalid response: %w", err)
	}
	return nil
}

// cachedFetch 先读缓存，未命中或过期时请求（同一 key 合并为一次）；请求失败时返回过期的旧数据
func cachedFetch[T any](ctx context.Context, cache *ttlCache[T], key string, fetch func(context.Context) (T, error)) (T, error) {
	cached, fresh, ok := cache.get(key)
	if ok && fresh {
		return cached, nil
	}
	// 请求不随单个访客的请求取消，结果供所有等待者使用
	value, err, _ := weatherFetchGroup.Do(key, func() (any, error) {
		return fetch(context.WithoutCancel(ctx))
	})
	if err != nil {
		logrus.Warnf("weather request failed: %v", err)
		if ok {
			return cached, nil
		}
		var zero T
		return zero, err
	}
	result := value.(T)
	cache.set(key, result)
	return result, nil
}

type ttlEntry[T any] struct {
	value     T
	fetchedAt time.Time
}

// ttlCache 带过期时间与条数上限的内存缓存；过期条目保留，用于上游失败时兜底
type ttlCache[T any] struct {
	mu      sync.Mutex
	entries map[string]ttlEntry[T]
	ttl     time.Duration
	maxLen  int
}

func newTTLCache[T any](ttl time.Duration, maxLen int) *ttlCache[T] {
	return &ttlCache[T]{entries: map[string]ttlEntry[T]{}, ttl: ttl, maxLen: maxLen}
}

func (c *ttlCache[T]) get(key string) (value T, fresh bool, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	return entry.value, ok && time.Since(entry.fetchedAt) < c.ttl, ok
}

// set 写入缓存；超出上限时先清理过期条目，仍超出则任意淘汰一条
func (c *ttlCache[T]) set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists && len(c.entries) >= c.maxLen {
		for k, e := range c.entries {
			if time.Since(e.fetchedAt) >= c.ttl {
				delete(c.entries, k)
			}
		}
		for k := range c.entries {
			if len(c.entries) < c.maxLen {
				break
			}
			delete(c.entries, k)
		}
	}
	c.entries[key] = ttlEntry[T]{value: value, fetchedAt: time.Now()}
}

// reset 清空缓存（测试用）
func (c *ttlCache[T]) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = map[string]ttlEntry[T]{}
}
