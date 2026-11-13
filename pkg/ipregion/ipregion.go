// Package ipregion 离线优先的 IP 归属地查询，基于 ip2region（Apache-2.0, lionsoul2014/ip2region）
//   - IPv4：内置数据文件（assets/ip2region_v4.xdb），随二进制分发，无需联网
//   - IPv6：可通过环境变量 IP2REGION_V6_PATH 指定本地离线库；未指定时回退短超时外网查询（带 singleflight 防击穿与正/负有界缓存）
package ipregion

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
	"golang.org/x/sync/singleflight"
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

func (r Region) isEmpty() bool {
	return !r.Reserved && r.Country == "" && r.Province == "" && r.City == "" && r.ISP == "" && r.CountryCode == ""
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

const (
	v6OnlineTimeout     = 2500 * time.Millisecond
	v6OnlineSuccessTTL  = time.Hour
	v6OnlineNegativeTTL = 2 * time.Minute
	v6OnlineCacheMax    = 4096
)

type v6CacheEntry struct {
	region    Region
	expiresAt time.Time
}

var (
	v4Searcher *xdb.Searcher
	v6Searcher *xdb.Searcher
	initOnce   sync.Once

	v6OnlineHTTPClient = &http.Client{Timeout: v6OnlineTimeout}
	v6OnlineEndpoint   = "https://api.mir6.com/api/ip"
	v6OnlineGroup      singleflight.Group

	v6CacheMu sync.RWMutex
	v6Cache   = make(map[string]v6CacheEntry)
	v6Now     = time.Now
)

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
	canonical := parsed.String()
	if utils.IsReservedIP(canonical) {
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
		raw, err := v6Searcher.Search(canonical)
		if err != nil {
			return Region{}
		}
		return parse(raw)
	}
	return lookupIPv6Online(canonical)
}

func lookupIPv6Online(canonicalIP string) Region {
	now := v6Now()
	v6CacheMu.RLock()
	entry, ok := v6Cache[canonicalIP]
	v6CacheMu.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.region
	}

	val, _, _ := v6OnlineGroup.Do(canonicalIP, func() (any, error) {
		recheckNow := v6Now()
		v6CacheMu.RLock()
		cached, hit := v6Cache[canonicalIP]
		v6CacheMu.RUnlock()
		if hit && recheckNow.Before(cached.expiresAt) {
			return cached.region, nil
		}

		region, err := fetchIPv6RegionHTTP(canonicalIP)
		ttl := v6OnlineSuccessTTL
		if err != nil || region.isEmpty() {
			ttl = v6OnlineNegativeTTL
			region = Region{}
		}
		storeIPv6Cache(canonicalIP, region, v6Now().Add(ttl))
		return region, nil
	})
	res, _ := val.(Region)
	return res
}

func storeIPv6Cache(ip string, region Region, expiresAt time.Time) {
	now := v6Now()
	v6CacheMu.Lock()
	defer v6CacheMu.Unlock()
	if _, exists := v6Cache[ip]; !exists && len(v6Cache) >= v6OnlineCacheMax {
		for k, v := range v6Cache {
			if !now.Before(v.expiresAt) {
				delete(v6Cache, k)
			}
		}
		for k := range v6Cache {
			if len(v6Cache) < v6OnlineCacheMax {
				break
			}
			delete(v6Cache, k)
		}
	}
	v6Cache[ip] = v6CacheEntry{region: region, expiresAt: expiresAt}
}

func fetchIPv6RegionHTTP(ip string) (Region, error) {
	reqURL := fmt.Sprintf("%s?ip=%s&type=json", v6OnlineEndpoint, url.QueryEscape(ip))
	resp, err := v6OnlineHTTPClient.Get(reqURL)
	if err != nil {
		return Region{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Region{}, fmt.Errorf("status %d", resp.StatusCode)
	}
	var payload utils.IPInfoResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Region{}, err
	}
	if payload.Data == nil {
		return Region{}, fmt.Errorf("empty ip data")
	}
	return Region{
		Country:     payload.Data.Country,
		Province:    payload.Data.Province,
		City:        payload.Data.City,
		ISP:         payload.Data.ISP,
		CountryCode: payload.Data.CountryCode,
	}, nil
}
