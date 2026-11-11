import { AxiosError, AxiosHeaders } from 'axios'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVerifyCodeSender } from './use-verify-code-sender'

const site = vi.hoisted(() => ({ siteInfo: { verifyCodeCoolDown: 60 } as Record<string, unknown> }))
vi.mock('@/contexts/site-info-context', () => ({ useSiteInfo: () => site }))

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

type Sender = ReturnType<typeof useVerifyCodeSender>
let latest: Sender

function Probe() {
  latest = useVerifyCodeSender()
  return null
}

async function render() {
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(Probe))
  })
  return root
}

/** 后端业务错误（见 pkg/errs.Body） */
function apiError(status: number, code: string) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(code, String(status), config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { error: { reason: 'permission_denied', code } },
  })
}

describe('发送邮箱验证码', () => {
  beforeEach(() => {
    site.siteInfo = { verifyCodeCoolDown: 60 }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('发送成功后按站点配置进入冷却，冷却中不再发送', async () => {
    const root = await render()
    const request = vi.fn().mockResolvedValue({})
    let sent = false
    await act(async () => {
      sent = await latest.send(request)
    })
    expect(sent).toBe(true)
    expect(latest.coolDown).toBe(60)
    await act(async () => {
      sent = await latest.send(request)
    })
    expect(sent).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    root.unmount()
  })

  it('发送失败不进入冷却，可以立即重试', async () => {
    const root = await render()
    const request = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({})
    await act(async () => {
      await expect(latest.send(request)).rejects.toThrow('network')
    })
    expect(latest.coolDown).toBe(0)
    expect(latest.sending).toBe(false)
    await act(async () => {
      expect(await latest.send(request)).toBe(true)
    })
    expect(request).toHaveBeenCalledTimes(2)
    root.unmount()
  })

  it('冷却每秒减一直到结束', async () => {
    vi.useFakeTimers()
    site.siteInfo = { verifyCodeCoolDown: 3 }
    const root = await render()
    await act(async () => {
      await latest.send(() => Promise.resolve())
    })
    expect(latest.coolDown).toBe(3)
    for (const expected of [2, 1, 0]) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(latest.coolDown).toBe(expected)
    }
    root.unmount()
  })

  it('按站点信息给出是否需要验证码、邮件服务是否可用；缺省按需要且可用处理', async () => {
    const root = await render()
    expect(latest.verifyRequired).toBe(true)
    expect(latest.emailUnavailable).toBe(false)
    site.siteInfo = { verifyCodeCoolDown: 60, emailVerifyEnabled: false, emailAvailable: false }
    await act(async () => {
      root.render(createElement(Probe))
    })
    expect(latest.verifyRequired).toBe(false)
    expect(latest.emailUnavailable).toBe(true)
    root.unmount()
  })

  it('站点信息过期时，后端返回 email_service_unavailable 也切换为不可用', async () => {
    const root = await render()
    await act(async () => {
      await expect(latest.send(() => Promise.reject(apiError(403, 'email_service_unavailable')))).rejects.toBeInstanceOf(AxiosError)
    })
    expect(latest.emailUnavailable).toBe(true)
    expect(latest.coolDown).toBe(0)
    root.unmount()
  })
})
