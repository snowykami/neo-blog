package dto

type AuthReq struct {
	TokenFromCookie        string `cookie:"token"`
	RefreshTokenFromCookie string `cookie:"refresh_token"`
	TokenFromHeader        string `header:"Authorization"`
}

type EmailVerifyReq struct {
	Email      string `header:"X-Email" vd:"email($)"`
	VerifyCode string `header:"X-Verify-Code" vd:"len($)>0"`
}
