'use client'

import type { EditSession, EditSessionTarget } from '@/models/edit-session'
import { useCallback, useEffect, useState } from 'react'
import { acquireEditSession, getEditSession } from '@/api/edit-session'

export type EditSessionStatus = 'acquiring' | 'active' | 'taken_over' | 'error'

/**
 * 编辑会话：同一文章/页面同时只允许最新打开编辑页的会话保存正文
 * - 进入编辑页时申请会话，会顶掉其他设备/窗口的旧会话
 * - 保存被拒绝（409）或检查发现已被顶掉时进入 taken_over，由页面切换为只读
 * - takeOver 重新申请会话以接管编辑，调用方负责随后加载服务端最新内容
 * - id 为 0 时视为尚未就绪，不申请会话，就绪后自动申请
 */
export function useEditSession(target: EditSessionTarget, id: number) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<EditSessionStatus>('acquiring')
  // 被顶掉时，当前持有会话的一方
  const [holder, setHolder] = useState<EditSession | null>(null)

  const acquire = useCallback(async () => {
    // id 未就绪（如编辑页尚未加载出内容）时不申请
    if (!id)
      return false
    setStatus('acquiring')
    try {
      const res = await acquireEditSession({ target, id })
      setSessionId(res.data.sessionId ?? null)
      setHolder(null)
      setStatus('active')
      return true
    }
    catch {
      setStatus('error')
      return false
    }
  }, [target, id])

  // 标记已被顶掉，并获取接管方信息用于提示
  const markTakenOver = useCallback(async () => {
    setStatus('taken_over')
    try {
      const res = await getEditSession({ target, id, sessionId })
      setHolder(res.data)
    }
    catch {
      setHolder(null)
    }
  }, [target, id, sessionId])

  // 轻量检查当前会话是否仍有效，用于空闲时与页面重新获得焦点时
  const check = useCallback(async () => {
    if (status !== 'active' || !sessionId)
      return
    try {
      const res = await getEditSession({ target, id, sessionId })
      if (res.data && !res.data.isCurrent) {
        setHolder(res.data)
        setStatus('taken_over')
      }
    }
    catch {
      // 检查失败不影响编辑，下次保存时会再校验
    }
  }, [status, target, id, sessionId])

  // 进入编辑页即申请会话
  useEffect(() => {
    acquire()
  }, [acquire])

  // 切回该页面时立即检查，尽快发现已被其他设备接管
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible')
        check()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [check])

  return { sessionId, status, holder, isActive: status === 'active', takeOver: acquire, markTakenOver, check }
}
