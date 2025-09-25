package model

type KV struct {
	Key   string `gorm:"primaryKey;type:varchar(64);not null;comment:键"`
	Value JSONMap
}
