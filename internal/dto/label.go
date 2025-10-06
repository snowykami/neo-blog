package dto

type LabelBase struct {
	Name              string `json:"name"`
	Slug              string `json:"slug"`
	TailwindClassName string `json:"tailwind_class_name"`
}

type LabelDto struct {
	ID uint `json:"id"` // 标签ID
	LabelBase
	PostCount int64 `json:"post_count"` // 该标签下的文章数量
}

type CreateLabelReq struct {
	LabelBase
}

type UpdateLabelReq struct {
	ID uint `path:"id" vd:"$>0" json:"id"` // 标签ID
	LabelBase
}
