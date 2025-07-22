package utils

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"gopkg.in/gomail.v2"
	"html/template"
)

type emailUtils struct{}

var Email = emailUtils{}

type EmailConfig struct {
	Enable   bool   // 邮箱启用状态
	Username string // 邮箱用户名
	Address  string // 邮箱地址
	Host     string // 邮箱服务器地址
	Port     int    // 邮箱服务器端口
	Password string // 邮箱密码
	SSL      bool   // 是否使用SSL
}

// SendTemplate 发送HTML模板，从配置文件中读取邮箱配置，支持上下文控制
func (e *emailUtils) SendTemplate(emailConfig *EmailConfig, target, subject, htmlTemplate string, data map[string]interface{}) error {
	// 使用Go的模板系统处理HTML模板
	tmpl, err := template.New("email").Parse(htmlTemplate)
	if err != nil {
		return fmt.Errorf("解析模板失败: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("执行模板失败: %w", err)
	}

	// 发送处理后的HTML内容
	return e.SendEmail(emailConfig, target, subject, buf.String(), true)
}

// SendEmail 使用gomail库发送邮件
func (e *emailUtils) SendEmail(emailConfig *EmailConfig, target, subject, content string, isHTML bool) error {
	if !emailConfig.Enable {
		return nil
	}
	// 创建新邮件
	m := gomail.NewMessage()
	m.SetHeader("From", emailConfig.Address)
	m.SetHeader("To", target)
	m.SetHeader("Subject", subject)
	// 设置内容类型
	if isHTML {
		m.SetBody("text/html", content)
	} else {
		m.SetBody("text/plain", content)
	}
	// 创建发送器
	d := gomail.NewDialer(emailConfig.Host, emailConfig.Port, emailConfig.Username, emailConfig.Password)
	// 配置SSL/TLS
	if emailConfig.SSL {
		d.SSL = true
	} else {
		// 对于非SSL但需要STARTTLS的情况
		d.TLSConfig = &tls.Config{InsecureSkipVerify: true}
	}
	// 发送邮件
	if err := d.DialAndSend(m); err != nil {
		return fmt.Errorf("发送邮件失败: %w", err)
	}
	return nil
}

func (e *emailUtils) GetEmailConfigFromEnv() *EmailConfig {
	return &EmailConfig{
		Enable:   Env.GetenvAsBool("EMAIL_ENABLE", false),
		Username: Env.Get("EMAIL_USERNAME", ""),
		Address:  Env.Get("EMAIL_ADDRESS", ""),
		Host:     Env.Get("EMAIL_HOST", "smtp.example.com"),
		Port:     Env.GetenvAsInt("EMAIL_PORT", 587),
		Password: Env.Get("EMAIL_PASSWORD", ""),
		SSL:      Env.GetenvAsBool("EMAIL_SSL", true),
	}
}
