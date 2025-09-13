package utils

import "regexp"

type Result struct {
  OS         string
  OSVersion  string
  Browser    string
  BrowserVer string
}

// ParseUA 解析 UA，返回结构化信息
func ParseUA(ua string) Result {
  r := Result{}

  // 1. 操作系统 + 版本
  osRe := []*regexp.Regexp{
    regexp.MustCompile(`\(Macintosh;.*Mac OS X ([0-9_]+)\)`),
    regexp.MustCompile(`\(Windows NT ([0-9.]+)\)`),
    regexp.MustCompile(`\(iPhone;.*OS ([0-9_]+)`),
    regexp.MustCompile(`\(Android ([0-9.]+)`),
    regexp.MustCompile(`\(X11;.*Linux `),
  }
  for _, re := range osRe {
    if m := re.FindStringSubmatch(ua); len(m) > 1 {
      switch {
      case strings.Contains(m[0], "Macintosh"):
        r.OS, r.OSVersion = "macOS", strings.Replace(m[1], "_", ".", -1)
      case strings.Contains(m[0], "Windows NT"):
        r.OS, r.OSVersion = "Windows", m[1]
      case strings.Contains(m[0], "iPhone"):
        r.OS, r.OSVersion = "iOS", strings.Replace(m[1], "_", ".", -1)
      case strings.Contains(m[0], "Android"):
        r.OS, r.OSVersion = "Android", m[1]
      case strings.Contains(m[0], "Linux"):
        r.OS = "Linux"
      }
      break
    }
  }

  // 2. 浏览器 + 版本（按优先级匹配）
  browserRe := []struct {
    re   *regexp.Regexp
    name string
  }{
    {regexp.MustCompile(`Edg/([\d.]+)`), "Edge"},
    {regexp.MustCompile(`Chrome/([\d.]+)`), "Chrome"},
    {regexp.MustCompile(`Firefox/([\d.]+)`), "Firefox"},
    {regexp.MustCompile(`Version/([\d.]+).*Safari`), "Safari"},
    {regexp.MustCompile(`OPR/([\d.]+)`), "Opera"},
  }
  for _, b := range browserRe {
    if m := b.re.FindStringSubmatch(ua); len(m) > 1 {
      r.Browser, r.BrowserVer = b.name, m[1]
      break
    }
  }

  return r
}
