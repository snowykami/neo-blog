'use client'

import type { User } from '@/models/user'
import { isAxiosError } from 'axios'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getLoginUser, userLogout } from '@/api/user'
import { useCommonT } from '@/hooks/use-translations'
import { needsLoginUserFetch, rememberLoginState } from '@/utils/client/session-hint'

interface AuthContextValue {
  user: User | null
  // 浏览器仍在确认登录状态：服务端渲染与水合阶段恒为 true（外壳对所有人一致），挂载后取到 /user/me 或确认是访客时变为 false
  loading: boolean
  setUser: (u: User | null) => void
  // 重新拉取登录状态：第三方登录在小窗里完成（Cookie 已由后端写好）时用它刷新本页
  refresh: () => Promise<User | null>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// 只有后端明确表示未登录时才记为访客；网络错误、5xx 不改变记录，下次照常探测
function isUnauthorized(error: unknown): boolean {
  return isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)
}

/**
 * 登录状态只在浏览器里确定：服务端渲染的外壳对所有人一致（「确认中」状态，头像、菜单等处用占位），
 * 挂载后按登录标记决定是否请求 /user/me（见 utils/client/session-hint.ts）
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const commonT = useCommonT()

  const setUser = useCallback((next: User | null) => {
    setUserState(next)
    rememberLoginState(Boolean(next))
  }, [])

  // 挂载时确定一次登录状态；之后客户端登录 / 注册由页面调用 setUser 写入，登出时置空，均无需再请求
  useEffect(() => {
    if (!needsLoginUserFetch()) {
      setLoading(false)
      return
    }
    let cancelled = false
    getLoginUser()
      .then((res) => {
        if (cancelled)
          return
        setUserState(res.data)
        rememberLoginState(true)
      })
      .catch((error) => {
        if (cancelled)
          return
        setUserState(null)
        if (isUnauthorized(error))
          rememberLoginState(false)
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await getLoginUser()
      setUser(res.data)
      return res.data
    }
    catch (error) {
      setUserState(null)
      if (isUnauthorized(error))
        rememberLoginState(false)
      return null
    }
  }, [setUser])

  const logout = useCallback(() => {
    userLogout()
      .then(() => {
        toast.success(commonT('logout_success'))
        setUser(null)
      })
      .catch(() => {
        toast.error(commonT('logout_failed'))
      })
  }, [commonT, setUser])
  const value = useMemo(() => ({ user, loading, setUser, refresh, logout }), [user, loading, setUser, refresh, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
