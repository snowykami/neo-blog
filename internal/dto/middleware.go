package dto

type EmailVerifyReq struct {
	Email      string `header:"X-Email" vd:"email($)"`
	VerifyCode string `header:"X-Verify-Code" vd:"len($)>0"`
}
