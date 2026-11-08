package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/static"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 邮件正文跟随站点默认语言（后台「站点语言」）：验证码邮件由访客触发，收件人看到的语言应与站点界面一致

// emailTexts 一种语言的邮件文案，占位符由 buildVerifyCodeEmail 填入
type emailTexts struct {
	subject     string // 普通验证码邮件的主题
	testSubject string
	heading     string
	testHeading string
	greeting    string // %s 为收件地址
	codeLabel   string
	expireNote  string // %d 为有效分钟数
	ignoreNote  string
	testNote    string
	sentBy      string
	footerNote  string // 站点标识后的补充说明，可为空
}

var emailTextsByLanguage = map[string]emailTexts{
	"zh-cn": {
		subject:     "邮箱验证码 · %s",
		testSubject: "邮件配置测试 · %s",
		heading:     "验证你的邮箱",
		testHeading: "邮件配置测试",
		greeting:    "你好，我们收到了 %s 的验证请求，请输入下面的验证码完成验证。",
		codeLabel:   "验证码",
		expireNote:  "验证码在 %d 分钟内有效，请勿转发给他人。",
		ignoreNote:  "如果不是你本人操作，忽略这封邮件即可，你的邮箱不会被做任何改动。",
		testNote:    "这是一封测试邮件：SMTP 配置可以正常工作，正文里的验证码无效，也不需要输入。",
		sentBy:      "本邮件由站点自动发送，请勿直接回复。",
	},
	"zh-tw": {
		subject:     "電子郵件驗證碼 · %s",
		testSubject: "郵件設定測試 · %s",
		heading:     "驗證你的電子郵件",
		testHeading: "郵件設定測試",
		greeting:    "你好，我們收到了 %s 的驗證請求，請輸入下方的驗證碼完成驗證。",
		codeLabel:   "驗證碼",
		expireNote:  "驗證碼在 %d 分鐘內有效，請勿轉寄給他人。",
		ignoreNote:  "如果不是你本人操作，忽略這封郵件即可，你的電子郵件不會有任何變動。",
		testNote:    "這是一封測試郵件：SMTP 設定可以正常運作，內文的驗證碼無效，也不需要輸入。",
		sentBy:      "本郵件由網站自動寄出，請勿直接回覆。",
	},
	"en-us": {
		subject:     "Your verification code · %s",
		testSubject: "Email settings test · %s",
		heading:     "Verify your email",
		testHeading: "Email settings test",
		greeting:    "Someone asked to verify %s. Enter the code below to continue.",
		codeLabel:   "Verification code",
		expireNote:  "The code is valid for %d minutes. Please don't share it with anyone.",
		ignoreNote:  "If this wasn't you, you can safely ignore this email — nothing will change.",
		testNote:    "This is a test email: your SMTP settings work, but the code above is not valid and doesn't need to be used.",
		sentBy:      "This email was sent automatically. Please don't reply to it.",
	},
	"ja-jp": {
		subject:     "メールアドレスの認証コード · %s",
		testSubject: "メール設定のテスト · %s",
		heading:     "メールアドレスの確認",
		testHeading: "メール設定のテスト",
		greeting:    "%s の確認リクエストを受け取りました。以下の認証コードを入力してください。",
		codeLabel:   "認証コード",
		expireNote:  "認証コードの有効期限は %d 分です。他の人に教えないでください。",
		ignoreNote:  "お心当たりがない場合は、このメールを破棄してください。メールアドレスは変更されません。",
		testNote:    "これはテストメールです。SMTP の設定は正常に動作していますが、本文の認証コードは無効です。",
		sentBy:      "このメールは自動送信されています。返信しないでください。",
	},
	"ko-kr": {
		subject:     "이메일 인증 코드 · %s",
		testSubject: "메일 설정 테스트 · %s",
		heading:     "이메일 주소 확인",
		testHeading: "메일 설정 테스트",
		greeting:    "%s 의 인증 요청을 받았습니다. 아래 인증 코드를 입력해 주세요.",
		codeLabel:   "인증 코드",
		expireNote:  "인증 코드는 %d분 동안 유효합니다. 다른 사람에게 알려 주지 마세요.",
		ignoreNote:  "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 메일 주소는 변경되지 않습니다.",
		testNote:    "테스트 메일입니다. SMTP 설정은 정상적으로 동작하지만 본문의 인증 코드는 사용할 수 없습니다.",
		sentBy:      "이 메일은 자동으로 발송되었습니다. 회신하지 마세요.",
	},
}

// emailTextsForLanguage 取站点默认语言的文案，未收录的语言按英文
func emailTextsForLanguage(language string) emailTexts {
	if texts, ok := emailTextsByLanguage[strings.ToLower(strings.TrimSpace(language))]; ok {
		return texts
	}
	return emailTextsByLanguage["en-us"]
}

// verificationEmailData 验证码模板（internal/static/assets/email/verification-code.tmpl）的占位内容
type verificationEmailData struct {
	Lang       string // <html lang>
	Preheader  string // 收件箱列表里显示的预览文字
	SiteName   string
	SiteURL    string
	SiteIcon   string
	Heading    string
	Greeting   string
	CodeLabel  string
	Code       string
	ExpireNote string
	IgnoreNote string
	TestNote   string // 非测试邮件时为空，模板据此隐藏提示框
	FooterNote string
	SentBy     string
}

// buildVerificationEmailData 组装模板数据：站点名称、图标与地址取自后台站点配置
func buildVerificationEmailData(to, code string, isTest bool) verificationEmailData {
	language := config.String("default_language")
	texts := emailTextsForLanguage(language)
	siteName := tools.GetSiteName()
	expireNote := fmt.Sprintf(texts.expireNote, int(utils.EmailVerifyCodeTTL()/time.Minute))
	heading := texts.heading
	preheader := expireNote
	testNote := ""
	if isTest {
		heading = texts.testHeading
		preheader = texts.testNote
		testNote = texts.testNote
	}
	return verificationEmailData{
		Lang:       language,
		Preheader:  preheader,
		SiteName:   siteName,
		SiteURL:    tools.GetBaseUrl(),
		SiteIcon:   tools.GetSiteIcon(),
		Heading:    heading,
		Greeting:   fmt.Sprintf(texts.greeting, to),
		CodeLabel:  texts.codeLabel,
		Code:       code,
		ExpireNote: expireNote,
		IgnoreNote: func() string {
			if isTest {
				return ""
			}
			return texts.ignoreNote
		}(),
		TestNote:   testNote,
		FooterNote: config.String("owner_name"),
		SentBy:     texts.sentBy,
	}
}

// renderVerifyCodeEmail 渲染验证码邮件正文；测试邮件在正文顶部带一条提示，验证码无效
func renderVerifyCodeEmail(to, code string, isTest bool) (string, string, *errs.ServiceError) {
	data := buildVerificationEmailData(to, code, isTest)
	texts := emailTextsForLanguage(data.Lang)
	subjectTemplate := texts.subject
	if isTest {
		subjectTemplate = texts.testSubject
	}
	html, err := static.RenderTemplate("email/verification-code.tmpl", data)
	if err != nil {
		return "", "", errs.Internal("failed_to_render_email", err)
	}
	return fmt.Sprintf(subjectTemplate, data.SiteName), html, nil
}

// sendVerifyCodeEmail 渲染并发送验证码邮件；enable 由调用方决定，测试邮件即使未启用也要能发出去
func sendVerifyCodeEmail(emailConfig *utils.EmailConfig, to, code string, isTest bool) *errs.ServiceError {
	subject, html, serr := renderVerifyCodeEmail(to, code, isTest)
	if serr != nil {
		return serr
	}
	if err := utils.Email.SendEmail(emailConfig, to, subject, html, true); err != nil {
		return errs.Internal("failed_to_send_email", err)
	}
	return nil
}
