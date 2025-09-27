package dto

type LabelBase struct {
	Name              string `json:"name"`
	TailwindClassName string `json:"tailwind_class_name"`
}

type LabelDto struct {
	ID uint `path:"id" vd:"$>0"` // 标签ID
	LabelBase
}

type CreateLabelReq struct {
	LabelBase
}
