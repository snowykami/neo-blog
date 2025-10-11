package utils

import (
	"bytes"
	"fmt"
	"net"
	"strings"
	"text/template"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type IPData struct {
	IP          string `json:"ip"`
	Dec         string `json:"dec"`
	Country     string `json:"country"`
	CountryCode string `json:"countryCode"`
	Province    string `json:"province"`
	City        string `json:"city"`
	Districts   string `json:"districts"`
	IDC         string `json:"idc"`
	ISP         string `json:"isp"`
	Net         string `json:"net"`
	Zipcode     string `json:"zipcode"`
	Areacode    string `json:"areacode"`
	Protocol    string `json:"protocol"`
	Location    string `json:"location"`
	MyIP        string `json:"myip"`
	Time        string `json:"time"`
}

type IPInfoResponse struct {
	Code int     `json:"code"`
	Msg  string  `json:"msg"`
	Data *IPData `json:"data"`
}

func GetIPInfo(ip string) (*IPData, error) {
	// https://api.mir6.com/api/ip?ip={ip}&type=json
	ipInfoResponse := &IPInfoResponse{}
	logrus.Info(fmt.Sprintf("https://api.mir6.com/api/ip?ip=%s&type=json", ip))
	resp, err := client.R().
		SetResult(ipInfoResponse).
		Get(fmt.Sprintf("https://api.mir6.com/api/ip?ip=%s&type=json", ip))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", resp.StatusCode(), resp.String())
	}
	return ipInfoResponse.Data, nil
}

func GetLocationString(ip string) string {
	ipInfo, err := GetIPInfo(ip)
	if err != nil {
		logrus.Error(err)
		return ""
	}
	if ipInfo == nil {
		return ""
	}

	tpl := Env.Get(constant.EnvKeyLocationFormat, "{{.Country}} {{.Province}} {{.City}} {{.ISP}}")
	t, err := template.New("location").Parse(tpl)
	if err != nil {
		logrus.Error(err)
		return ""
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, ipInfo); err != nil {
		logrus.Error(err)
		return ""
	}
	return buf.String()
}

func NewIPRecord(ip string) string {
	return fmt.Sprintf("%d,%s;", time.Now().Unix(), ip)
}

var reservedNets []*net.IPNet

func init() {
	cidrs := []string{
		// IPv4 私有/保留/特殊
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",     // loopback
		"169.254.0.0/16",  // link-local (APIPA)
		"100.64.0.0/10",   // CGN
		"192.0.2.0/24",    // TEST-NET-1
		"198.51.100.0/24", // TEST-NET-2
		"203.0.113.0/24",  // TEST-NET-3
		"224.0.0.0/4",     // multicast
		"240.0.0.0/4",     // reserved
		// IPv6 私有/保留/特殊
		"::1/128",       // loopback
		"fc00::/7",      // unique local
		"fe80::/10",     // link-local
		"2001:db8::/32", // documentation
		"::/128",        // unspecified
		"ff00::/8",      // multicast
	}
	for _, s := range cidrs {
		if _, n, err := net.ParseCIDR(s); err == nil {
			reservedNets = append(reservedNets, n)
		}
	}
}

func IsReservedIP(ip string) bool {
	// empty 字符串视为保留/不可用
	if strings.TrimSpace(ip) == "" {
		return true
	}
	// 去掉 IPv6 zone，如 "fe80::1%en0"
	if i := strings.Index(ip, "%"); i >= 0 {
		ip = ip[:i]
	}
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		// 无法解析的也当作保留/不可信
		return true
	}
	for _, n := range reservedNets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

// DesensitizeIpData removes sensitive fields from the IPData struct.
func DesensitizeIpData(data *IPData) {
	data.IP = ""
	data.Dec = ""
	data.Net = ""
	data.Zipcode = ""
	data.Areacode = ""
	data.Protocol = ""
	data.MyIP = ""
	data.Time = ""
	data.Location = ""
}
