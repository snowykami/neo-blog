package dto

type LabelDto struct {
	ID                uint   `path:"id" vd:"$>0"` // 标签ID
	Value             string `json:"value"`
	TailwindClassName string `json:"tailwind_class_name"`
}
