package dto

type CategoryDto struct {
	ID          uint   `path:"id" json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Slug        string `json:"slug"`
}
