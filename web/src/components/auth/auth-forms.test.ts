import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPasswordForm } from '@/app/[locale]/auth/reset-password/page'
import { LocalRegisterForm } from './local-register-form'

const api = vi.hoisted(() => ({
  getCaptchaConfig: vi.fn(),
  requestEmailVerifyCode: vi.fn(),
  userRegister: vi.fn(),
  resetPassword: vi.fn(),
}))
const site = vi.hoisted(() => ({ siteInfo: { verifyCodeCoolDown: 60 } as Record<string, unknown> }))
vi.mock('@/api/user', () => api)
vi.mock('@/contexts/site-info-context', () => ({ useSiteInfo: () => site }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ setUser: vi.fn() }) }))
// 文案原样返回键名，便于断言
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/use-translations', () => {
  const t = (key: string) => key
  return { useCommonT: () => t, useOperationT: () => t, useErrorMessageT: () => () => '' }
})
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/auth/common/auth-header', () => ({ AuthHeader: () => null }))
// 人机验证：挂载后直接通过
vi.mock('@/components/common/captcha', () => ({
  default: function Captcha({ onSuccess }: { onSuccess: (token: string) => void }) {
    useEffect(() => onSuccess('captcha-token'), [onSuccess])
    return null
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function render(element: Parameters<typeof root.render>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
}

/** 按 label 文字找到对应的输入框 */
function field(label: string): HTMLInputElement {
  const el = [...container.querySelectorAll('label')].find(l => l.textContent === label)
  expect(el, `找不到「${label}」`).toBeTruthy()
  const input = container.querySelector<HTMLInputElement>(`[id="${el!.htmlFor}"]`)
  expect(input, `「${label}」没有关联到输入框`).toBeTruthy()
  return input!
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith(text))
  expect(button, `找不到按钮「${text}」`).toBeTruthy()
  await act(async () => {
    button!.click()
  })
  return button!
}

const messages = () => [...container.querySelectorAll('[data-slot="form-message"]')].map(el => el.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  site.siteInfo = { verifyCodeCoolDown: 60 }
  api.getCaptchaConfig.mockResolvedValue({ data: { provider: 'disable', siteKey: '' } })
  api.requestEmailVerifyCode.mockResolvedValue({ data: {} })
  api.userRegister.mockResolvedValue({ data: { user: { username: 'u' } } })
  api.resetPassword.mockResolvedValue({ data: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('注册表单', () => {
  it('表单提交（回车）时逐项校验，不合格时不提交', async () => {
    await render(createElement(LocalRegisterForm))
    await type(field('email'), 'bad-email')
    await submit()
    expect(messages()).toEqual(['username_required', 'password_required', 'email_invalid', 'verify_code_required'])
    expect(api.userRegister).not.toHaveBeenCalled()
  })

  it('验证码的 label 指向验证码输入框，邮箱输入框为 email 类型', async () => {
    await render(createElement(LocalRegisterForm))
    expect(field('email').type).toBe('email')
    expect(field('verify_code').getAttribute('autocomplete')).toBe('one-time-code')
  })

  it('邮箱格式不对时不发送验证码；发送失败不进入冷却', async () => {
    await render(createElement(LocalRegisterForm))
    await type(field('email'), 'bad-email')
    await click('obtain')
    expect(api.requestEmailVerifyCode).not.toHaveBeenCalled()
    expect(messages()).toEqual(['email_invalid'])

    api.requestEmailVerifyCode.mockRejectedValueOnce(new Error('boom'))
    await type(field('email'), 'someone@example.com')
    const button = await click('obtain')
    expect(api.requestEmailVerifyCode).toHaveBeenCalledWith({ email: 'someone@example.com', captchaToken: 'captcha-token' })
    expect(button.textContent).toBe('obtain')
    expect(button.disabled).toBe(false)

    await click('obtain')
    expect(button.textContent).toBe('obtain(60)')
  })

  it('填写完整后提交注册', async () => {
    await render(createElement(LocalRegisterForm))
    await type(field('username'), 'newbie')
    await type(field('password'), 'password123')
    await type(field('email'), 'someone@example.com')
    await type(field('verify_code'), '123456')
    await submit()
    expect(api.userRegister).toHaveBeenCalledWith({ username: 'newbie', password: 'password123', email: 'someone@example.com', verifyCode: '123456', captchaToken: 'captcha-token' })
  })

  it('邮件服务不可用时提示联系管理员，不能获取验证码和提交', async () => {
    site.siteInfo = { verifyCodeCoolDown: 60, emailAvailable: false }
    await render(createElement(LocalRegisterForm))
    expect(container.querySelector('[data-slot="alert"]')?.textContent).toBe('email_unavailable')
    expect((await click('obtain')).disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  })

  it('站点关闭邮箱验证时不显示验证码，直接注册', async () => {
    site.siteInfo = { verifyCodeCoolDown: 60, emailVerifyEnabled: false, emailAvailable: false }
    await render(createElement(LocalRegisterForm))
    expect(container.querySelector('[data-slot="alert"]')).toBeNull()
    expect([...container.querySelectorAll('label')].map(l => l.textContent)).toEqual(['username', 'password', 'email'])
    await type(field('username'), 'newbie')
    await type(field('password'), 'password123')
    await type(field('email'), 'someone@example.com')
    await submit()
    expect(api.userRegister).toHaveBeenCalledWith(expect.objectContaining({ verifyCode: '' }))
  })
})

describe('找回密码表单', () => {
  it('字段顺序为邮箱、验证码、新密码、确认密码', async () => {
    await render(createElement(ResetPasswordForm))
    expect([...container.querySelectorAll('label')].map(l => l.textContent)).toEqual(['email', 'verify_code', 'new_password', 'confirm_password'])
  })

  it('逐项校验：必填、密码长度、两次密码一致', async () => {
    await render(createElement(ResetPasswordForm))
    await submit()
    expect(messages()).toEqual(['email_required', 'verify_code_required', 'new_password_required', 'confirm_password_required'])
    await type(field('email'), 'someone@example.com')
    await type(field('verify_code'), '123456')
    await type(field('new_password'), 'short')
    await type(field('confirm_password'), 'other')
    await submit()
    expect(messages()).toEqual(['password_length', 'password_mismatch'])
    await type(field('new_password'), 'password123')
    await type(field('confirm_password'), 'password123')
    await submit()
    expect(api.resetPassword).toHaveBeenCalledWith({ email: 'someone@example.com', newPassword: 'password123', verifyCode: '123456' })
  })

  it('关闭邮箱验证或邮件服务不可用时提示联系管理员并禁用', async () => {
    site.siteInfo = { verifyCodeCoolDown: 60, emailVerifyEnabled: false }
    await render(createElement(ResetPasswordForm))
    expect(container.querySelector('[data-slot="alert"]')?.textContent).toBe('verify_disabled')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    act(() => root.unmount())
    container.remove()

    site.siteInfo = { verifyCodeCoolDown: 60, emailAvailable: false }
    await render(createElement(ResetPasswordForm))
    expect(container.querySelector('[data-slot="alert"]')?.textContent).toBe('email_unavailable')
  })
})
