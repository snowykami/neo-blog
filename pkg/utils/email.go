package utils

import (
	"bytes"
	"crypto/tls"
	"errors"
	"fmt"
	"html/template"

	"github.com/snowykami/neo-blog/pkg/constant"
	"gopkg.in/gomail.v2"
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

func (e *emailUtils) RenderTemplate(htmlTemplate string, data map[string]interface{}) (string, error) {
	// 使用Go的模板系统处理HTML模板
	tmpl, err := template.New("email").Parse(htmlTemplate)
	if err != nil {
		return "", fmt.Errorf("解析模板失败: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("执行模板失败: %w", err)
	}
	return buf.String(), nil
}

// SendEmail 使用gomail库发送邮件
func (e *emailUtils) SendEmail(emailConfig *EmailConfig, target, subject, content string, isHTML bool) error {
	if !emailConfig.Enable {
		return errors.New("邮箱服务未启用")
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
		Enable:   Env.GetAsBool(constant.EnvKeyEmailEnable, false),
		Username: Env.Get(constant.EnvKeyEmailUsername, ""),
		Address:  Env.Get(constant.EnvKeyEmailAddress, ""),
		Host:     Env.Get(constant.EnvKeyEmailHost, "smtp.example.com"),
		Port:     Env.GetAsInt(constant.EnvKeyEmailPort, 587),
		Password: Env.Get(constant.EnvKeyEmailPassword, ""),
		SSL:      Env.GetAsBool(constant.EnvKeyEmailSsl, true),
	}
}
