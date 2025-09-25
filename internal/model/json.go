package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// JSONMap 是一个通用的 JSON 类型（map[string]any）
type JSONMap map[string]any

func (JSONMap) GormDataType() string {
	return "json"
}

func (JSONMap) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	switch db.Dialector.Name() {
	case "mysql":
		return "JSON"
	case "postgres":
		return "JSONB"
	default: // sqlite 等
		return "TEXT"
	}
}

// Value 实现 driver.Valuer，用于写入数据库
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	b, err := json.Marshal(map[string]any(j))
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// Scan 实现 sql.Scanner，用于从数据库读取并反序列化
func (j *JSONMap) Scan(src any) error {
	if src == nil {
		*j = nil
		return nil
	}
	var data []byte
	switch v := src.(type) {
	case string:
		data = []byte(v)
	case []byte:
		data = v
	default:
		return fmt.Errorf("cannot scan JSONMap from %T", src)
	}
	if len(data) == 0 {
		*j = nil
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	*j = JSONMap(m)
	return nil
}

func (j JSONMap) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any(j))
}

func (j *JSONMap) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		*j = nil
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	*j = JSONMap(m)
	return nil
}
