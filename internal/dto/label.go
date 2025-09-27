package dto

type LabelDto struct {
	ID                uint   `json:"id"` // 标签ID
	Value             string `json:"value"`
	TailwindClassName string `json:"tailwind_class_name"`
}
