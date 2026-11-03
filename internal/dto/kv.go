package dto

type KVDto struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type SetKVReq struct {
	Key   string `path:"key" json:"key"`
	Value any    `json:"value"`
}

// SaveConfigReq 后台全局配置的修改，只包含改动的项
type SaveConfigReq struct {
	Items []KVDto `json:"items"`
}
