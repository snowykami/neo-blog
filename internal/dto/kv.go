package dto

type KVDto struct {
	Key      string `json:"key"`
	Value    any    `json:"value"`
	Secret   bool   `json:"secret,omitempty"`
	HasValue bool   `json:"has_value,omitempty"`
}

type SetKVReq struct {
	Key         string `path:"key" json:"key"`
	Value       any    `json:"value"`
	UpdateValue *bool  `json:"update_value,omitempty"`
	Secret      *bool  `json:"secret,omitempty"`
}

// SaveConfigReq 后台全局配置的修改，只包含改动的项
type SaveConfigReq struct {
	Items []KVDto `json:"items"`
}
