package dto

type KVDto struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type SetKVReq struct {
	Key   string `path:"key" json:"key"`
	Value any    `json:"value"`
}
