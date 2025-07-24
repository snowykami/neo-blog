package dto

type LabelDto struct {
	ID                uint   `json:"id"` // 标签ID
	Key               string `json:"key"`
	Value             string `json:"value"`
	Color             string `json:"color"`
	TailwindClassName string `json:"tailwind_class_name"`
}
