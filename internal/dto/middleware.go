package dto

type EmailVerifyReq struct {
	Email      string `header:"X-Email" vd:"email($)"`
	VerifyCode string `header:"X-VerifyCode" vd:"len($)>0"`
}
