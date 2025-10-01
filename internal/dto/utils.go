package dto

type PaginationParams struct {
	Page    uint64 `query:"page" default:"1"`
	Size    uint64 `query:"size" default:"10"`
	OrderBy string `query:"order_by" default:"created_at"`
	Desc    bool   `query:"desc" default:"true"` // 默认是从大值到小值
}

func (p *PaginationParams) Order() string {
	if p.Desc {
		return p.OrderBy + " DESC"
	}
	return p.OrderBy + " ASC"
}

func (p *PaginationParams) Offset() uint64 {
	if p.Page == 0 {
		p.Page = 1
	}
	return (p.Page - 1) * p.Size
}

type BindID struct {
	Uint   uint   `path:"id"`
	Uint64 uint64 `path:"id"`
	Int64  int64  `path:"id"`
}
