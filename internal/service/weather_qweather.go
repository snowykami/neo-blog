package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
)

// 和风天气（QWeather）：在全局配置中填写 API Host 与 API Key 后代替 Open-Meteo 使用
// 实时天气 /v7/weather/now，城市搜索 /geo/v2/city/lookup；Key 通过请求头传递，不出现在请求地址中

// QWeatherCondition 将和风天气的天气图标代码映射为统一的天气状况
func QWeatherCondition(icon int) string {
	switch {
	case icon == 100 || icon == 150:
		return "clear"
	case (icon >= 101 && icon <= 103) || (icon >= 151 && icon <= 153):
		return "partly_cloudy"
	case icon == 104:
		return "cloudy"
	case icon >= 302 && icon <= 304:
		return "thunderstorm"
	case icon == 305 || icon == 309:
		return "drizzle"
	case icon == 313 || (icon >= 404 && icon <= 406) || icon == 456:
		return "sleet"
	case (icon >= 300 && icon <= 318) || icon == 350 || icon == 351 || icon == 399:
		return "rain"
	case (icon >= 400 && icon <= 410) || icon == 457 || icon == 499:
		return "snow"
	case icon >= 500 && icon <= 515:
		return "fog"
	}
	return "cloudy"
}

// qweatherIsNight 夜间图标：晴、多云等的夜间版本以 15x、35x、45x 表示
func qweatherIsNight(icon int) bool {
	return (icon >= 150 && icon <= 153) || icon == 350 || icon == 351 || icon == 456 || icon == 457
}

// qweatherLang 和风天气的语言参数：中文为 zh，其余沿用两位语言代码
func qweatherLang(lang string) string {
	if lang == "" {
		return "zh"
	}
	return lang
}

// leadingInt 读取字符串开头的整数，如风力等级 "3-4" 取 3
func leadingInt(value string) int {
	end := 0
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	n, _ := strconv.Atoi(value[:end])
	return n
}

func fetchQWeatherNow(ctx context.Context, cfg tools.QWeatherConfig, lat, lon float64) (*dto.WeatherDto, error) {
	params := url.Values{}
	// 和风天气的坐标为“经度,纬度”，最多两位小数
	params.Set("location", strconv.FormatFloat(lon, 'f', 2, 64)+","+strconv.FormatFloat(lat, 'f', 2, 64))
	params.Set("unit", "m")
	var raw struct {
		Now *struct {
			ObsTime   string `json:"obsTime"`
			Temp      string `json:"temp"`
			Icon      string `json:"icon"`
			WindScale string `json:"windScale"`
			WindSpeed string `json:"windSpeed"`
			Humidity  string `json:"humidity"`
		} `json:"now"`
	}
	if err := getQWeatherJSON(ctx, cfg, "/v7/weather/now", params, &raw); err != nil {
		return nil, err
	}
	now := raw.Now
	if now == nil || len(now.ObsTime) < 16 {
		return nil, fmt.Errorf("invalid response: missing current weather")
	}
	temp, err := strconv.ParseFloat(now.Temp, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid response: temp %q", now.Temp)
	}
	icon, _ := strconv.Atoi(now.Icon)
	humidity, _ := strconv.Atoi(now.Humidity)
	windSpeed, _ := strconv.ParseFloat(now.WindSpeed, 64)
	windLevel := leadingInt(now.WindScale)
	if now.WindScale == "" {
		windLevel = WindLevel(windSpeed)
	}
	return &dto.WeatherDto{
		Condition:   QWeatherCondition(icon),
		Temperature: math.Round(temp*10) / 10,
		Humidity:    humidity,
		WindSpeed:   windSpeed,
		WindLevel:   min(windLevel, 12),
		IsDay:       !qweatherIsNight(icon),
		// obsTime 形如 2026-10-23T14:36+08:00：前 16 位为观测地当地时间，其后为时区偏移
		ObservedAt: now.ObsTime[:16],
		Timezone:   now.ObsTime[16:],
		Latitude:   lat,
		Longitude:  lon,
	}, nil
}

func fetchQWeatherPlaces(ctx context.Context, cfg tools.QWeatherConfig, query, lang string) ([]dto.WeatherPlaceDto, error) {
	params := url.Values{}
	params.Set("location", query)
	params.Set("number", strconv.Itoa(weatherGeoResultCount))
	params.Set("lang", qweatherLang(lang))
	var raw struct {
		Location []struct {
			Name    string `json:"name"`
			Lat     string `json:"lat"`
			Lon     string `json:"lon"`
			Adm1    string `json:"adm1"`
			Adm2    string `json:"adm2"`
			Country string `json:"country"`
		} `json:"location"`
	}
	if err := getQWeatherJSON(ctx, cfg, "/geo/v2/city/lookup", params, &raw); err != nil {
		return nil, err
	}
	places := make([]dto.WeatherPlaceDto, 0, len(raw.Location))
	for _, r := range raw.Location {
		lat, latErr := strconv.ParseFloat(r.Lat, 64)
		lon, lonErr := strconv.ParseFloat(r.Lon, 64)
		if r.Name == "" || latErr != nil || lonErr != nil || !validCoordinate(lat, 90) || !validCoordinate(lon, 180) {
			continue
		}
		// 行政区显示到地级（与城市同名时显示省级）
		admin := r.Adm2
		if admin == "" || admin == r.Name {
			admin = r.Adm1
		}
		places = append(places, dto.WeatherPlaceDto{Name: r.Name, Admin1: admin, Country: r.Country, Latitude: lat, Longitude: lon})
	}
	return places, nil
}

// getQWeatherJSON 请求和风天气接口：响应体中的 code 为 "200" 时成功；城市搜索无结果时为 "404"，按空结果处理
func getQWeatherJSON(ctx context.Context, cfg tools.QWeatherConfig, path string, params url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, weatherRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.Host+path+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-QW-Api-Key", cfg.Key)
	req.Header.Set("User-Agent", "neo-blog")
	// 不手动设置 Accept-Encoding，由 net/http 透明处理和风天气的 gzip 响应
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var status struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(data, &status); err != nil {
		return fmt.Errorf("status %d: invalid response", resp.StatusCode)
	}
	switch {
	case status.Code == "200":
		return json.Unmarshal(data, out)
	case status.Code == "404" && strings.HasPrefix(path, "/geo/"):
		return nil
	}
	return fmt.Errorf("status %d, code %s", resp.StatusCode, status.Code)
}

// fetchQWeatherReverse 用和风的城市搜索接口按经纬度反查地名：location 支持「经度,纬度」，结果按距离排序
func fetchQWeatherReverse(ctx context.Context, cfg tools.QWeatherConfig, lat, lon float64, lang string) (*dto.WeatherPlaceDto, error) {
	params := url.Values{}
	params.Set("location", strconv.FormatFloat(lon, 'f', 2, 64)+","+strconv.FormatFloat(lat, 'f', 2, 64))
	params.Set("number", "1")
	params.Set("lang", qweatherLang(lang))
	var raw struct {
		Location []struct {
			Name    string `json:"name"`
			Lat     string `json:"lat"`
			Lon     string `json:"lon"`
			Adm1    string `json:"adm1"`
			Adm2    string `json:"adm2"`
			Country string `json:"country"`
		} `json:"location"`
	}
	if err := getQWeatherJSON(ctx, cfg, "/geo/v2/city/lookup", params, &raw); err != nil {
		return nil, err
	}
	if len(raw.Location) == 0 || raw.Location[0].Name == "" {
		return nil, nil
	}
	first := raw.Location[0]
	// 名称所在的上级行政区，与名称同名时退到省级
	admin := first.Adm2
	if admin == "" || admin == first.Name {
		admin = first.Adm1
	}
	// 和风返回的是行政区中心点，解析失败时用请求坐标
	placeLat, latErr := strconv.ParseFloat(first.Lat, 64)
	placeLon, lonErr := strconv.ParseFloat(first.Lon, 64)
	if latErr != nil || lonErr != nil || !validCoordinate(placeLat, 90) || !validCoordinate(placeLon, 180) {
		placeLat, placeLon = lat, lon
	}
	return &dto.WeatherPlaceDto{
		Name:      first.Name,
		Admin1:    admin,
		Country:   first.Country,
		Latitude:  placeLat,
		Longitude: placeLon,
	}, nil
}
