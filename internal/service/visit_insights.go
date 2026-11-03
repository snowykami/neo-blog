package service

import (
	"math"
	"net/url"
	"sort"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	readCompleteDepth = 90 // 滚动深度达到该值视为读完
	slowPageMinSample = 3  // 参与“最慢页面”排行的最少样本数
)

var webVitalOrder = []string{"LCP", "INP", "CLS", "FCP", "TTFB"}

// fillContentInsights 访客统计中的内容部分：新老访客、阅读参与度、文章表现、站内路径、外链与下载（均不含疑似自动化）
func fillContentInsights(result *dto.VisitInsightsDto, logs []model.VisitLog, visitorIDs []uint, since time.Time) error {
	newVisitors, err := repo.Visit.CountVisitorsFirstSeenSince(visitorIDs, since)
	if err != nil {
		return err
	}
	result.NewVisitors, result.ReturningVisitors = newVisitors, int64(len(visitorIDs))-newVisitors

	type postStats struct {
		views, engagedVisits, engagedTotal, depthTotal, completed int64
		sources                                                   map[[2]string]int64
	}
	posts := map[uint]*postStats{}
	paths := map[[2]string]int64{}
	var durations []int64
	var depthTotal int64
	buckets := make([]int64, 5)
	for i := range logs {
		l := &logs[i]
		if l.Trust == constant.VisitTrustBot {
			continue
		}
		var stats *postStats
		if l.TargetType == constant.TargetTypePost && l.TargetID > 0 {
			if stats = posts[l.TargetID]; stats == nil {
				stats = &postStats{sources: map[[2]string]int64{}}
				posts[l.TargetID] = stats
			}
			stats.views++
			if !(l.Source == "" || l.Source == utils.SourceInternal || l.Source == utils.SourceRandom || l.Source == utils.SourceDirect) {
				stats.sources[[2]string{l.Source, l.ReferrerHost}]++
			}
		}
		if l.Source == utils.SourceInternal {
			// 刷新或同页跳转（如锚点）不算路径
			if u, err := url.Parse(l.Referrer); err == nil && u.Path != "" && u.Path != pathOnly(l.Path) {
				paths[[2]string{u.Path, pathOnly(l.Path)}]++
			}
		}
		if l.EngagedMs == nil {
			continue
		}
		depth := 0
		if l.ScrollDepth != nil {
			depth = *l.ScrollDepth
		}
		durations = append(durations, *l.EngagedMs)
		depthTotal += int64(depth)
		buckets[depthBucket(depth)]++
		if stats != nil {
			stats.engagedVisits++
			stats.engagedTotal += *l.EngagedMs
			stats.depthTotal += int64(depth)
		}
		if depth >= readCompleteDepth {
			result.Engagement.Completed++
			if stats != nil {
				stats.completed++
			}
		}
	}

	// 阅读参与度
	labels := []string{"0-25", "25-50", "50-75", "75-90", "90-100"}
	result.Engagement.DepthBuckets = make([]dto.NamedCount, len(labels))
	for i, label := range labels {
		result.Engagement.DepthBuckets[i] = dto.NamedCount{Name: label, Count: buckets[i]}
	}
	if n := int64(len(durations)); n > 0 {
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		var total int64
		for _, d := range durations {
			total += d
		}
		result.Engagement.Visits = n
		result.Engagement.AvgEngagedMs = total / n
		result.Engagement.MedianEngaged = durations[n/2]
		result.Engagement.AvgScrollDepth = int(depthTotal / n)
	}

	// 文章表现：浏览量最高的文章，附带区间内的点赞与评论
	ids := make([]uint, 0, len(posts))
	for id := range posts {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		return posts[ids[i]].views > posts[ids[j]].views || (posts[ids[i]].views == posts[ids[j]].views && ids[i] < ids[j])
	})
	if len(ids) > visitInsightsTop {
		ids = ids[:visitInsightsTop]
	}
	infos, err := repo.Visit.GetTargetInfos(constant.TargetTypePost, ids)
	if err != nil {
		return err
	}
	interactions, err := repo.Visit.CountPostInteractions(since)
	if err != nil {
		return err
	}
	result.Posts = []dto.VisitPostInsightDto{}
	for _, id := range ids {
		info, ok := infos[id]
		if !ok {
			continue // 已删除
		}
		stats := posts[id]
		item := dto.VisitPostInsightDto{ID: id, Title: info.Title, Slug: info.Slug, Views: stats.views, EngagedVisits: stats.engagedVisits, Completed: stats.completed}
		if stats.engagedVisits > 0 {
			item.AvgEngagedMs = stats.engagedTotal / stats.engagedVisits
			item.AvgScrollDepth = int(stats.depthTotal / stats.engagedVisits)
		}
		var best int64
		for key, count := range stats.sources {
			if count > best || (count == best && key[0]+key[1] < item.TopSource+item.TopSourceHost) {
				best, item.TopSource, item.TopSourceHost = count, key[0], key[1]
			}
		}
		if item.TopSource != utils.SourceExternal {
			item.TopSourceHost = ""
		}
		for _, row := range interactions {
			if row.TargetID != id {
				continue
			}
			if row.Action == constant.VisitActionLike {
				item.Likes = row.Count
			} else {
				item.Comments = row.Count
			}
		}
		result.Posts = append(result.Posts, item)
	}

	// 站内路径
	result.Paths = []dto.VisitPathCount{}
	for key, count := range paths {
		result.Paths = append(result.Paths, dto.VisitPathCount{From: key[0], To: key[1], Count: count})
	}
	sort.Slice(result.Paths, func(i, j int) bool {
		a, b := result.Paths[i], result.Paths[j]
		return a.Count > b.Count || (a.Count == b.Count && a.From+a.To < b.From+b.To)
	})
	if len(result.Paths) > visitInsightsTop {
		result.Paths = result.Paths[:visitInsightsTop]
	}

	// 外链点击与文件下载
	if result.Outbound, err = topEventLabels(constant.VisitEventOutbound, since); err != nil {
		return err
	}
	result.Downloads, err = topEventLabels(constant.VisitEventDownload, since)
	return err
}

func pathOnly(path string) string {
	if u, err := url.Parse(path); err == nil {
		return u.Path
	}
	return path
}

func depthBucket(depth int) int {
	switch {
	case depth < 25:
		return 0
	case depth < 50:
		return 1
	case depth < 75:
		return 2
	case depth < readCompleteDepth:
		return 3
	}
	return 4
}

func topEventLabels(name string, since time.Time) ([]dto.NamedCount, error) {
	events, err := repo.Visit.ListVisitEvents(name, since)
	if err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, e := range events {
		counts[e.Label]++
	}
	return topCounts(counts, visitInsightsTop), nil
}

func topCounts(counts map[string]int64, limit int) []dto.NamedCount {
	items := make([]dto.NamedCount, 0, len(counts))
	for name, count := range counts {
		items = append(items, dto.NamedCount{Name: name, Count: count})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Count > items[j].Count || (items[i].Count == items[j].Count && items[i].Name < items[j].Name)
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items
}

// percentile75 第 75 百分位（最近秩法），values 会被排序
func percentile75(values []float64) float64 {
	sort.Float64s(values)
	return values[int(math.Ceil(0.75*float64(len(values))))-1]
}

// fillVitalInsights Web Vitals：各指标 p75（区分手机与桌面）、评级分布，以及 LCP 最慢的页面
func fillVitalInsights(result *dto.VisitInsightsDto, since time.Time) error {
	events, err := repo.Visit.ListVisitEvents(constant.VisitEventWebVital, since)
	if err != nil {
		return err
	}
	type group struct{ all, mobile, desktop []float64 }
	metrics := map[string]*group{}
	ratings := map[string]map[string]int64{}
	lcpByPath := map[string][]float64{}
	for _, e := range events {
		g := metrics[e.Label]
		if g == nil {
			g = &group{}
			metrics[e.Label] = g
			ratings[e.Label] = map[string]int64{}
		}
		g.all = append(g.all, e.Value)
		if e.DeviceType == utils.DeviceMobile || e.DeviceType == utils.DeviceTablet {
			g.mobile = append(g.mobile, e.Value)
		} else {
			g.desktop = append(g.desktop, e.Value)
		}
		ratings[e.Label][e.Rating]++
		if e.Label == "LCP" {
			lcpByPath[pathOnly(e.Path)] = append(lcpByPath[pathOnly(e.Path)], e.Value)
		}
	}
	result.Vitals = []dto.WebVitalDto{}
	for _, name := range webVitalOrder {
		g := metrics[name]
		if g == nil {
			continue
		}
		item := dto.WebVitalDto{
			Name: name, Samples: int64(len(g.all)), P75: percentile75(g.all),
			Good: ratings[name]["good"], NeedsImprovement: ratings[name]["needs-improvement"], Poor: ratings[name]["poor"],
		}
		if len(g.mobile) > 0 {
			p := percentile75(g.mobile)
			item.MobileP75 = &p
		}
		if len(g.desktop) > 0 {
			p := percentile75(g.desktop)
			item.DesktopP75 = &p
		}
		result.Vitals = append(result.Vitals, item)
	}
	result.SlowPages = []dto.VisitSlowPageDto{}
	for path, values := range lcpByPath {
		if len(values) >= slowPageMinSample {
			result.SlowPages = append(result.SlowPages, dto.VisitSlowPageDto{Path: path, P75: percentile75(values), Samples: int64(len(values))})
		}
	}
	sort.Slice(result.SlowPages, func(i, j int) bool { return result.SlowPages[i].P75 > result.SlowPages[j].P75 })
	if len(result.SlowPages) > 5 {
		result.SlowPages = result.SlowPages[:5]
	}
	return nil
}
