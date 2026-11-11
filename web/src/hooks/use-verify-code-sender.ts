'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { getErrorBody } from '@/utils/common/error'

/**
 * 发送邮箱验证码：注册、找回密码共用
 * - 只有发送成功才进入冷却（时长取站点配置），失败（邮箱格式、邮件服务不可用、网络错误等）可以立即重试；后端在发信失败时也会释放冷却
 * - verifyRequired：站点是否要求邮箱验证码（后端 ENABLE_EMAIL_VERIFY），缺省按要求处理
 * - emailUnavailable：站点没有配置邮件服务，发不出验证码；站点信息可能是旧的，发送时后端返回 email_service_unavailable 也会切换为不可用
 */
export function useVerifyCodeSender() {
  const { siteInfo } = useSiteInfo()
  const [coolDown, setCoolDown] = useState(0)
  const [sending, setSending] = useState(false)
  const [reportedUnavailable, setReportedUnavailable] = useState(false)
  // 连点时 state 还没更新，用 ref 拦住重复发送
  const busyRef = useRef(false)
  const coolDownRef = useRef(0)
  coolDownRef.current = coolDown

  useEffect(() => {
    if (coolDown <= 0)
      return
    const id = window.setInterval(() => {
      setCoolDown(c => (c > 1 ? c - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [coolDown])

  const coolDownSeconds = siteInfo.verifyCodeCoolDown || 60

  /**
   * 发送验证码：正在发送或冷却中时不发送并返回 false；成功返回 true 并开始冷却；失败时抛出原始错误，由调用方提示
   */
  const send = useCallback(async (request: () => Promise<unknown>): Promise<boolean> => {
    if (busyRef.current || coolDownRef.current > 0)
      return false
    busyRef.current = true
    setSending(true)
    try {
      await request()
      setCoolDown(coolDownSeconds)
      return true
    }
    catch (error) {
      if (getErrorBody(error)?.code === 'email_service_unavailable')
        setReportedUnavailable(true)
      throw error
    }
    finally {
      busyRef.current = false
      setSending(false)
    }
  }, [coolDownSeconds])

  return {
    coolDown,
    sending,
    send,
    verifyRequired: siteInfo.emailVerifyEnabled !== false,
    emailUnavailable: siteInfo.emailAvailable === false || reportedUnavailable,
  }
}
