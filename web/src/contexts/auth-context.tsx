'use client'

import type { User } from '@/models/user'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getLoginUser, userLogout } from '@/api/user'
import { useCommonT } from '@/hooks/use-translations'

interface AuthContextValue {
  user: User | null
  // 客户端仍在确认登录状态（服务端未能确定时补拉 /user/me 期间）
  loading: boolean
  setUser: (u: User | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({
  children,
  initialUser = null,
  isAnonymous = false,
}: {
  children: React.ReactNode
  initialUser?: User | null
  // 服务端已确认当前为访客（没有任何登录凭据）时为 true，客户端不再请求 /user/me
  isAnonymous?: boolean
}) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [loading, setLoading] = useState(!initialUser && !isAnonymous)
  const commonT = useCommonT()

  // 仅在首次挂载且服务端未能确定登录状态时（有凭据但服务端获取失败）在客户端补拉一次
  // 客户端登录 / 注册后由页面调用 setUser 写入，登出时置空，均无需再请求
  useEffect(() => {
    if (initialUser || isAnonymous)
      return
    let cancelled = false
    getLoginUser()
      .then((res) => {
        if (!cancelled)
          setUser(res.data)
      })
      .catch(() => {
        if (!cancelled)
          setUser(null)
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [initialUser, isAnonymous])

  const logout = useCallback(() => {
    userLogout()
      .then(() => {
        toast.success(commonT('logout_success'))
        setUser(null)
      })
      .catch(() => {
        toast.error(commonT('logout_failed'))
      })
  }, [commonT])
  const value = useMemo(() => ({ user, loading, setUser, logout }), [user, loading, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
