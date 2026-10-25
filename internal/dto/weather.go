package dto

// WeatherReq 按经纬度查询当前天气（文章内的天气卡）
type WeatherReq struct {
	Lat *float64 `query:"lat"`
	Lon *float64 `query:"lon"`
}

// WeatherDto 当前天气；Condition 为统一的天气状况枚举，与前端天气卡一致
type WeatherDto struct {
	Condition   string  `json:"condition"`   // clear / partly_cloudy / cloudy / fog / drizzle / rain / sleet / snow / thunderstorm
	Temperature float64 `json:"temperature"` // 摄氏度
	Humidity    int     `json:"humidity"`    // 相对湿度，百分比
	WindSpeed   float64 `json:"wind_speed"`  // 风速，km/h
	WindLevel   int     `json:"wind_level"`  // 蒲福风级 0-12
	IsDay       bool    `json:"is_day"`
	ObservedAt  string  `json:"observed_at"` // 观测时间，当地时间 YYYY-MM-DDTHH:mm
	Timezone    string  `json:"timezone"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
}

// WeatherGeoReq 按名称搜索城市
type WeatherGeoReq struct {
	Query string `query:"q"`
	Lang  string `query:"lang"` // 结果语言，两位小写语言代码，默认 en
}

// WeatherLocateReq 按访客 IP 估计所在城市（天气卡的「网络定位」）
type WeatherLocateReq struct {
	Lang string `query:"lang"` // 结果语言，两位小写语言代码，默认 en
}

// WeatherPlaceDto 城市搜索结果
type WeatherPlaceDto struct {
	Name        string  `json:"name"`
	Admin1      string  `json:"admin1"` // 一级行政区（省 / 州）
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
}
