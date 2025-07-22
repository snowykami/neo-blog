package dto

type LabelDto struct {
	Key               string `json:"key"`
	Value             string `json:"value"`
	Color             string `json:"color"`
	TailwindClassName string `json:"tailwind_class_name"`
}
