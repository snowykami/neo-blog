package dto

// GithubRepoDto GitHub 仓库的公开信息（文章内的仓库卡）
type GithubRepoDto struct {
	FullName    string   `json:"full_name"`
	Owner       string   `json:"owner"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	HTMLURL     string   `json:"html_url"`
	OwnerAvatar string   `json:"owner_avatar"`
	Language    string   `json:"language"`
	License     string   `json:"license"`
	Topics      []string `json:"topics"`
	Stars       int      `json:"stars"`
	Forks       int      `json:"forks"`
	Archived    bool     `json:"archived"`
}
