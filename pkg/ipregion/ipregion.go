// Package ipregion 离线 IP 归属地查询，基于 ip2region（Apache-2.0, lionsoul2014/ip2region）
//   - IPv4：内置数据文件（assets/ip2region_v4.xdb），随二进制分发，无需联网
//   - IPv6：数据文件较大（约 37MB）未内置，可通过环境变量 IP2REGION_V6_PATH 指定；
//     未指定时回退到在线接口（utils.GetIPInfo）并做内存缓存
package ipregion

import (
	_ "embed"
	"net"
	"strings"
	"sync"

	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

//go:embed assets/ip2region_v4.xdb
var v4Data []byte

// Region IP 归属地，未知字段为空字符串
type Region struct {
	Country     string
	Province    string
	City        string
	ISP         string
	CountryCode string
	Reserved    bool // 内网、本机等保留地址
}

// String 归属地展示文本：国内为「省份 城市 运营商」（直辖市省市相同只显示一次），国外为「国家 省/州 城市」
func (r Region) String() string {
	if r.Reserved {
		return "局域网"
	}
	parts := make([]string, 0, 4)
	add := func(s string) {
		if s != "" && (len(parts) == 0 || parts[len(parts)-1] != s) {
			parts = append(parts, s)
		}
	}
	if r.CountryCode == "CN" || r.Country == "中国" {
		add(r.Province)
		add(r.City)
		add(r.ISP)
		if len(parts) == 0 {
			add(r.Country)
		}
	} else {
		add(r.Country)
		add(r.Province)
		add(r.City)
	}
	return strings.Join(parts, " ")
}

var (
	v4Searcher *xdb.Searcher
	v6Searcher *xdb.Searcher
	initOnce   sync.Once

	// IPv6 在线查询结果缓存，超过上限时整体清空，避免无界增长
	onlineCache   = map[string]Region{}
	onlineCacheMu sync.Mutex
)

const onlineCacheLimit = 10000

func initSearchers() {
	var err error
	// 基于内存的查询是并发安全的
	if v4Searcher, err = xdb.NewWithBuffer(xdb.IPv4, v4Data); err != nil {
		logrus.Errorf("ip2region: load ipv4 xdb failed: %v", err)
	}
	if path := utils.Env.Get(constant.EnvKeyIP2RegionV6Path, ""); path != "" {
		content, err := xdb.LoadContentFromFile(path)
		if err == nil {
			v6Searcher, err = xdb.NewWithBuffer(xdb.IPv6, content)
		}
		if err != nil {
			logrus.Errorf("ip2region: load ipv6 xdb %s failed: %v", path, err)
		}
	}
}

// parse 解析 ip2region 的结果：国家|省份|城市|运营商|国家代码，0 表示缺失
func parse(raw string) Region {
	fields := strings.Split(raw, "|")
	get := func(i int) string {
		if i < len(fields) && fields[i] != "0" {
			return fields[i]
		}
		return ""
	}
	if get(0) == "Reserved" {
		return Region{Reserved: true}
	}
	return Region{Country: get(0), Province: get(1), City: get(2), ISP: get(3), CountryCode: get(4)}
}

// Lookup 查询 IP 归属地，查询失败返回空 Region
func Lookup(ip string) Region {
	initOnce.Do(initSearchers)
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return Region{}
	}
	if parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsLinkLocalUnicast() || parsed.IsUnspecified() {
		return Region{Reserved: true}
	}
	if v4 := parsed.To4(); v4 != nil {
		if v4Searcher == nil {
			return Region{}
		}
		raw, err := v4Searcher.Search(v4.String())
		if err != nil {
			return Region{}
		}
		return parse(raw)
	}
	if v6Searcher != nil {
		raw, err := v6Searcher.Search(parsed.String())
		if err != nil {
			return Region{}
		}
		return parse(raw)
	}
	return lookupOnline(parsed.String())
}

// lookupOnline 未配置 IPv6 数据文件时回退到在线接口
func lookupOnline(ip string) Region {
	onlineCacheMu.Lock()
	if region, ok := onlineCache[ip]; ok {
		onlineCacheMu.Unlock()
		return region
	}
	onlineCacheMu.Unlock()

	region := Region{}
	if data, err := utils.GetIPInfo(ip); err == nil && data != nil {
		region = Region{Country: data.Country, Province: data.Province, City: data.City, ISP: data.ISP, CountryCode: data.CountryCode}
	}

	onlineCacheMu.Lock()
	if len(onlineCache) >= onlineCacheLimit {
		onlineCache = map[string]Region{}
	}
	onlineCache[ip] = region
	onlineCacheMu.Unlock()
	return region
}
