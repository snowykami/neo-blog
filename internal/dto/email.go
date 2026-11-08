package dto

// SendTestEmailReq 发送测试邮件：SMTP 相关字段为空时使用已保存的配置，便于在保存前先验证配置可用
type SendTestEmailReq struct {
	Host     string `json:"host"`     // 留空取已保存的 SMTP 服务器
	Port     int    `json:"port"`     // 0 取已保存的端口
	SSL      *bool  `json:"ssl"`      // nil 取已保存的设置（false 也是有效取值，所以用指针区分「没填」）
	Username string `json:"username"` // 留空取已保存的用户名
	Password string `json:"password"` // 留空取已保存的密码
	Address  string `json:"address"`  // 留空取已保存的发件人地址
	To       string `json:"to"`       // 收件人，留空时发给发件人地址
}

// SendTestEmailResp 测试邮件的发送结果
type SendTestEmailResp struct {
	To string `json:"to"` // 实际收件人
}
