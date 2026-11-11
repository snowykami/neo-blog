package migrations

import (
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// kv2026111170 迁移时的配置表快照：值存为 {"value": 实际值}
type kv2026111170 struct {
	Key   string `gorm:"primaryKey;type:varchar(64)"`
	Value model.JSONMap
}

func (kv2026111170) TableName() string { return "kvs" }

// fileLinkColumns2026111170 迁移时可能保存站内文件链接的文本列（含软删除的记录）
var fileLinkColumns2026111170 = []struct {
	table   string
	columns []string
}{
	{"posts", []string{"content", "draft_content", "cover", "background_image"}},
	{"pages", []string{"content", "draft_content", "cover"}},
	{"users", []string{"avatar_url", "background_url"}},
	{"comments", []string{"content"}},
	{"content_revisions", []string{"content", "meta"}},
	{"oidc_configs", []string{"icon"}},
}

// absoluteFileLink2026111170 带域名的站内文件链接 http(s)://host/api/v1/file/f/<id>：前面必须是引号、括号、空白等分隔符
var absoluteFileLink2026111170 = regexp.MustCompile(`(^|[\s"'(=,\[>])((?i:https?)://([^\s"'<>()\\/]+))(/api/v1/file/f/\d+)`)

// relativeFileLinks 站内文件链接改存相对路径：此前上传接口返回、后台「复制链接」得到的都是带域名的地址，
// 粘贴进站点图标、默认封面、头像等处后，换域名就全部失效。
// 本站地址（环境变量 BASE_URL 与后台配置的站点地址）与本机地址（localhost、127.0.0.1、[::1]，对外本来就打不开）下的
// /api/v1/file/f/<id> 去掉协议与域名；其他站点的同名路径不动
func relativeFileLinks() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111170_relative_file_links",
		Migrate: func(tx *gorm.DB) error {
			hosts, err := ownHosts2026111170(tx)
			if err != nil {
				return err
			}
			rewrite := func(s string) (string, bool) { return relativize2026111170(s, hosts) }
			for _, target := range fileLinkColumns2026111170 {
				if err := rewriteTable2026111170(tx, target.table, target.columns, rewrite); err != nil {
					return err
				}
			}
			return rewriteKVs2026111170(tx, rewrite)
		},
	}
}

// ownHosts2026111170 本站地址的 host（含端口，小写）
func ownHosts2026111170(tx *gorm.DB) (map[string]bool, error) {
	hosts := map[string]bool{}
	add := func(raw string) {
		if u, err := url.Parse(strings.TrimSpace(raw)); err == nil && u.Host != "" {
			hosts[strings.ToLower(u.Host)] = true
		}
	}
	add(os.Getenv("BASE_URL"))
	if !tx.Migrator().HasTable(&kv2026111170{}) {
		return hosts, nil
	}
	var rows []kv2026111170
	if err := tx.Where("key IN ?", []string{"base_url", "site_info"}).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		switch v := row.Value["value"].(type) {
		case string:
			add(v)
		case map[string]any:
			if s, ok := v["base_url"].(string); ok {
				add(s)
			}
		}
	}
	return hosts, nil
}

// isOwnHost2026111170 本站或本机地址
func isOwnHost2026111170(host string, hosts map[string]bool) bool {
	host = strings.ToLower(host)
	if hosts[host] {
		return true
	}
	name := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		name = h
	}
	name = strings.Trim(name, "[]")
	if name == "localhost" {
		return true
	}
	ip := net.ParseIP(name)
	return ip != nil && ip.IsLoopback()
}

func relativize2026111170(s string, hosts map[string]bool) (string, bool) {
	if !strings.Contains(s, "/api/v1/file/f/") {
		return s, false
	}
	changed := false
	next := absoluteFileLink2026111170.ReplaceAllStringFunc(s, func(match string) string {
		m := absoluteFileLink2026111170.FindStringSubmatch(match)
		if !isOwnHost2026111170(m[3], hosts) {
			return match
		}
		changed = true
		return m[1] + m[4]
	})
	return next, changed
}

// rewriteTable2026111170 分批改写表中含带域名文件链接的文本列；不经模型，不触发钩子、不更新 updated_at
func rewriteTable2026111170(tx *gorm.DB, table string, columns []string, rewrite func(string) (string, bool)) error {
	if !tx.Migrator().HasTable(table) {
		return nil
	}
	var present []string
	for _, column := range columns {
		if tx.Migrator().HasColumn(table, column) {
			present = append(present, column)
		}
	}
	if len(present) == 0 {
		return nil
	}
	conds := make([]string, len(present))
	args := make([]any, len(present))
	for i, column := range present {
		conds[i] = column + " LIKE ?"
		args[i] = "%://%/api/v1/file/f/%"
	}
	where := strings.Join(conds, " OR ")
	const batch = 200
	var lastID uint64
	for {
		var rows []map[string]any
		if err := tx.Table(table).Select(append([]string{"id"}, present...)).
			Where("id > ?", lastID).Where(where, args...).Order("id").Limit(batch).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			lastID = toUint2026111170(row["id"])
			updates := map[string]any{}
			for _, column := range present {
				value, ok := toString2026111170(row[column])
				if !ok {
					continue
				}
				if next, ok := rewrite(value); ok {
					updates[column] = next
				}
			}
			if len(updates) == 0 {
				continue
			}
			if next, ok := updates["content"].(string); ok && table == "posts" {
				old, _ := toString2026111170(row["content"])
				syncPostHashes2026111170(tx, updates, old, next)
			}
			if err := tx.Table(table).Where("id = ?", lastID).UpdateColumns(updates).Error; err != nil {
				return err
			}
		}
		if len(rows) < batch {
			return nil
		}
	}
}

// syncPostHashes2026111170 文章正文变了要同步正文哈希；AI 摘要依据的是改写前的正文时一并更新，只改了链接不算摘要过期
func syncPostHashes2026111170(tx *gorm.DB, updates map[string]any, old, next string) {
	if !tx.Migrator().HasColumn("posts", "content_hash") {
		return
	}
	updates["content_hash"] = model.HashContent(next)
	if !tx.Migrator().HasColumn("posts", "ai_summary_source_hash") {
		return
	}
	updates["ai_summary_source_hash"] = gorm.Expr("CASE WHEN ai_summary_source_hash = ? THEN ? ELSE ai_summary_source_hash END", model.HashContent(old), model.HashContent(next))
}

// rewriteKVs2026111170 配置值里的字符串（含站点信息等嵌套结构、图片列表）逐个改写
func rewriteKVs2026111170(tx *gorm.DB, rewrite func(string) (string, bool)) error {
	if !tx.Migrator().HasTable(&kv2026111170{}) {
		return nil
	}
	var rows []kv2026111170
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		next, changed := rewriteJSON2026111170(row.Value["value"], rewrite)
		if !changed {
			continue
		}
		if err := tx.Model(&kv2026111170{}).Where("key = ?", row.Key).Update("value", model.JSONMap{"value": next}).Error; err != nil {
			return err
		}
	}
	return nil
}

func rewriteJSON2026111170(v any, rewrite func(string) (string, bool)) (any, bool) {
	switch value := v.(type) {
	case string:
		return rewrite(value)
	case []any:
		changed := false
		for i, item := range value {
			if next, ok := rewriteJSON2026111170(item, rewrite); ok {
				value[i] = next
				changed = true
			}
		}
		return value, changed
	case map[string]any:
		changed := false
		for key, item := range value {
			if next, ok := rewriteJSON2026111170(item, rewrite); ok {
				value[key] = next
				changed = true
			}
		}
		return value, changed
	}
	return v, false
}

func toUint2026111170(v any) uint64 {
	switch n := v.(type) {
	case int64:
		return uint64(n)
	case int32:
		return uint64(n)
	case int:
		return uint64(n)
	case uint64:
		return n
	case uint32:
		return uint64(n)
	case uint:
		return uint64(n)
	}
	return 0
}

func toString2026111170(v any) (string, bool) {
	switch s := v.(type) {
	case string:
		return s, true
	case []byte:
		return string(s), true
	}
	return "", false
}
