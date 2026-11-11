// 账号相关的前端校验：注册、找回密码共用，与后端 internal/service/user.go（isValidPassword）、admin_user.go（isValidEmail）保持一致

// 密码长度
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 32

// 邮箱格式：本地部分与域名都不能为空、不能含空白和第二个 @，域名各段不能为空（如 a@b.c、a@localhost）。
// 只拦截明显的错误（如 bad-email），完整校验由后端 net/mail 负责
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

export function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX
}
