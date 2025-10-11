package dto

type UserOpenIDDto struct {
	ID                uint   `json:"id"`
	UserID            uint   `json:"user_id"`
	Issuer            string `json:"issuer"`
	Sub               string `json:"sub"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Picture           string `json:"picture"`
	PreferredUsername string `json:"preferred_username"`
}
