package utils

import (
	"bytes"
	"fmt"
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
