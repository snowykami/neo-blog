package service

import (
	"context"
	"net/url"
	"strconv"

	"github.com/snowykami/neo-blog/internal/dto"
)

// BigDataCloud 的免费坐标反查接口（无需 Key）；和风天气未配置时用它给访客定位取地名
var bigDataCloudReverseURL = "https://api.bigdatacloud.net/data/reverse-geocode-client"

// bigDataCloudLanguage 把语言代码映射为 BigDataCloud 的写法：zh 用简体、zh-tw 用繁体，其余原样传
func bigDataCloudLanguage(lang string) string {
	switch lang {
	case "zh":
		return "zh-Hans"
	case "zh-tw":
		return "zh-Hant"
	}
	return primaryWeatherLang(lang)
}

// fetchBigDataCloudReverse 反查坐标所在地名：locality 为区 / 街区，city 为市，principalSubdivision 为省 / 州
func fetchBigDataCloudReverse(ctx context.Context, lat, lon float64, lang string) (*dto.WeatherPlaceDto, error) {
	params := url.Values{}
	params.Set("latitude", strconv.FormatFloat(lat, 'f', 2, 64))
	params.Set("longitude", strconv.FormatFloat(lon, 'f', 2, 64))
	params.Set("localityLanguage", bigDataCloudLanguage(lang))
	var raw struct {
		City                 string `json:"city"`
		Locality             string `json:"locality"`
		PrincipalSubdivision string `json:"principalSubdivision"`
		CountryName          string `json:"countryName"`
		CountryCode          string `json:"countryCode"`
	}
	if err := getJSON(ctx, bigDataCloudReverseURL, params, &raw); err != nil {
		return nil, err
	}
	// 名称取最具体的层级，Admin1 为其上级（与名称重复时退到省级）
	name, admin := raw.Locality, raw.City
	if name == "" {
		name, admin = raw.City, raw.PrincipalSubdivision
	}
	if name == "" {
		name, admin = raw.PrincipalSubdivision, ""
	}
	if admin == name {
		admin = raw.PrincipalSubdivision
	}
	if admin == name {
		admin = ""
	}
	if name == "" {
		return nil, nil
	}
	return &dto.WeatherPlaceDto{
		Name:        name,
		Admin1:      admin,
		Country:     raw.CountryName,
		CountryCode: raw.CountryCode,
		Latitude:    lat,
		Longitude:   lon,
	}, nil
}
