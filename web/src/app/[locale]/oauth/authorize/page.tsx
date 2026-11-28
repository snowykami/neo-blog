'use client'

import type { APITokenScope } from '@/models/api-token'
import type { OAuthAuthorizeInfo, OAuthAuthorizeQuery } from '@/models/oauth'
import { isAxiosError } from 'axios'
import { AlertCircle, CheckCircle2, ExternalLink, Globe, LogOut, ShieldAlert, Terminal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getOAuthAuthorizeInfo, submitOAuthAuthorizeDecision } from '@/api/oauth'
import { userLogout } from '@/api/user'
import { AuthCardSkeleton } from '@/components/auth/common/auth-card-skeleton'
import { AuthHeader } from '@/components/auth/common/auth-header'
import { UserAvatar } from '@/components/common/avatar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { loginPath } from '@/hooks/use-route'
import { useErrorMessageT } from '@/hooks/use-translations'
import { Link, useRouter } from '@/i18n/navigation'
import { formatDisplayName } from '@/utils/common/username'

const FORBIDDEN_REDIRECT_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:'])

const SCOPE_DESC_KEYS = {
  'posts:read': 'scope_posts_read',
  'posts:write': 'scope_posts_write',
  'posts:publish': 'scope_posts_publish',
  'files:write': 'scope_files_write',
  'ai_agents:read': 'scope_ai_agents_read',
  'ai_agents:write': 'scope_ai_agents_write',
  'friends:read': 'scope_friends_read',
  'friends:write': 'scope_friends_write',
} as const satisfies Record<APITokenScope, string>

function isSafeCallbackRedirect(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return !FORBIDDEN_REDIRECT_PROTOCOLS.has(parsed.protocol.toLowerCase())
  }
  catch {
    return false
  }
}

function safeHttpsHostname(rawUrl: string): string | null {
  if (!rawUrl)
    return null
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === 'https:' && parsed.hostname ? parsed.hostname : null
  }
  catch {
    return null
  }
}

export default function OAuthAuthorizePage() {
  return (
    <>
      <AuthHeader />
      <Suspense fallback={<AuthCardSkeleton />}>
        <OAuthAuthorizeCard />
      </Suspense>
    </>
  )
}

function OAuthAuthorizeCard() {
  const t = useTranslations('OAuth')
  const roleT = useTranslations('Role')
  const errorMessageT = useErrorMessageT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading, refresh, setUser } = useAuth()

  const queryString = searchParams.toString()
  const authorizeReturnPath = queryString ? `/oauth/authorize?${queryString}` : '/oauth/authorize'

  const queryParams: OAuthAuthorizeQuery = useMemo(() => ({
    clientId: searchParams.get('client_id')?.trim() ?? '',
    redirectUri: searchParams.get('redirect_uri')?.trim() ?? '',
    responseType: searchParams.get('response_type')?.trim() ?? '',
    scope: searchParams.get('scope')?.trim() || undefined,
    state: searchParams.get('state')?.trim() || undefined,
    codeChallenge: searchParams.get('code_challenge')?.trim() ?? '',
    codeChallengeMethod: searchParams.get('code_challenge_method')?.trim() ?? '',
    resource: searchParams.get('resource')?.trim() || undefined,
  }), [searchParams])

  const [info, setInfo] = useState<OAuthAuthorizeInfo | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<APITokenScope[]>([])
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const probedSessionRef = useRef(false)
  const switchingRef = useRef(false)

  useEffect(() => {
    if (authLoading || switchingRef.current)
      return

    let cancelled = false
    const redirectToLogin = () => {
      router.replace(`${loginPath}?redirect_back=${encodeURIComponent(authorizeReturnPath)}`)
    }

    const load = async () => {
      let activeUser = user
      if (!activeUser && !probedSessionRef.current) {
        probedSessionRef.current = true
        activeUser = await refresh()
      }
      if (cancelled)
        return
      if (!activeUser) {
        redirectToLogin()
        return
      }

      if (!queryParams.clientId || !queryParams.redirectUri || !queryParams.codeChallenge) {
        setFatalError(t('missing_required_params'))
        setLoadingInfo(false)
        return
      }

      setLoadingInfo(true)
      setFatalError(null)
      try {
        const res = await getOAuthAuthorizeInfo(queryParams)
        if (cancelled)
          return
        setInfo(res.data)
        setSelectedScopes(res.data.grantedScopes)
      }
      catch (error) {
        if (cancelled)
          return
        if (isAxiosError(error) && error.response?.status === 401) {
          redirectToLogin()
          return
        }
        setFatalError(errorMessageT(error) || t('load_failed'))
      }
      finally {
        if (!cancelled)
          setLoadingInfo(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, refresh, router, authorizeReturnPath, queryParams, errorMessageT, t])

  const handleSwitchAccount = async () => {
    if (switchingAccount || submitting !== null)
      return
    switchingRef.current = true
    setSwitchingAccount(true)
    await userLogout().catch(() => {})
    setUser(null)
    router.replace(`${loginPath}?redirect_back=${encodeURIComponent(authorizeReturnPath)}`)
  }

  const toggleScope = (scope: APITokenScope, checked: boolean) => {
    setSelectedScopes(prev => checked
      ? (prev.includes(scope) ? prev : [...prev, scope])
      : prev.filter(item => item !== scope))
  }

  const handleDecision = async (approve: boolean) => {
    if (!info || submitting)
      return
    if (approve && selectedScopes.length === 0) {
      toast.error(t('scopes_required'))
      return
    }
    setSubmitting(approve ? 'approve' : 'deny')
    try {
      const res = await submitOAuthAuthorizeDecision({
        ...queryParams,
        approve,
        scopes: approve ? selectedScopes : undefined,
      })
      const targetUrl = res.data.redirectUrl
      if (!isSafeCallbackRedirect(targetUrl)) {
        toast.error(t('unsafe_redirect_blocked'))
        setSubmitting(null)
        return
      }
      window.location.assign(targetUrl)
    }
    catch (error) {
      const message = errorMessageT(error)
      toast.error(t('authorize_failed') + (message ? `: ${message}` : ''))
      setSubmitting(null)
    }
  }

  if (authLoading || loadingInfo)
    return <AuthCardSkeleton />

  if (fatalError || !info || !user) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5 shrink-0" aria-hidden />
            <CardTitle className="text-lg">{t('invalid_request_title')}</CardTitle>
          </div>
          <CardDescription>{t('invalid_request_description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Alert variant="destructive">
            <AlertTitle>{t('error_detail_label')}</AlertTitle>
            <AlertDescription>{fatalError || t('load_failed')}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex gap-3">
          {user && (
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={switchingAccount}
              onClick={() => void handleSwitchAccount()}
            >
              <LogOut className="size-4" aria-hidden />
              {t('switch_account')}
            </Button>
          )}
          <Button asChild variant="outline" className="flex-1">
            <Link href="/">{t('back_home')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const clientHost = safeHttpsHostname(info.clientUri)
  const roleKey = user.role === 'admin' || user.role === 'editor' ? user.role : 'user'

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl border bg-muted/50 text-foreground">
          <Terminal className="size-6" aria-hidden />
        </div>
        <CardTitle className="text-xl">{t('title', { client: info.clientName })}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {clientHost && (
          <div className="pt-1">
            <a
              href={info.clientUri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <Globe className="size-3.5" aria-hidden />
              <span>{clientHost}</span>
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        )}
      </CardHeader>

      <CardContent className="grid gap-4">
        {/* 当前授权账号 */}
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <UserAvatar user={user} className="size-9 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{formatDisplayName(user)}</span>
                <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                  {roleT(roleKey)}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{`@${user.username}`}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleSwitchAccount()}
            disabled={submitting !== null || switchingAccount}
            className="shrink-0 text-xs text-muted-foreground"
          >
            <LogOut className="size-3.5" aria-hidden />
            {t('switch_account')}
          </Button>
        </div>

        {/* 回调目标地址 */}
        <div className="grid gap-1.5 rounded-lg border px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">{t('callback_label')}</span>
            <Badge variant="outline" className="font-mono text-[11px]">
              {info.callbackTarget}
            </Badge>
          </div>
          <p className="font-mono text-[11px] break-all text-muted-foreground">{info.redirectUri}</p>
        </div>

        <Separator />

        {/* 请求的权限列表（支持取消勾选收窄子集） */}
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('permissions_label')}</span>
            <span className="text-xs text-muted-foreground">
              {t('selected_count', { count: selectedScopes.length })}
            </span>
          </div>
          <div className="grid gap-2">
            {info.grantedScopes.map((scope) => {
              const checked = selectedScopes.includes(scope)
              const scopeDescKey = SCOPE_DESC_KEYS[scope]
              return (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={submitting !== null}
                    onCheckedChange={val => toggleScope(scope, val === true)}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <code className="font-mono text-xs font-medium text-foreground">{scope}</code>
                    <span className="text-xs text-muted-foreground">{t(scopeDescKey)}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {info.unavailableScopes.length > 0 && (
          <Alert>
            <ShieldAlert className="size-4" aria-hidden />
            <AlertTitle className="text-xs">{t('filtered_scopes_title')}</AlertTitle>
            <AlertDescription className="text-xs">
              {t('filtered_scopes_description', { scopes: info.unavailableScopes.join(', ') })}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <span>{t('safety_notice')}</span>
        </div>
      </CardContent>

      <CardFooter className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={submitting !== null}
          onClick={() => void handleDecision(false)}
        >
          {submitting === 'deny' ? t('denying') : t('deny')}
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={submitting !== null || selectedScopes.length === 0}
          onClick={() => void handleDecision(true)}
        >
          {submitting === 'approve' ? t('approving') : t('approve')}
        </Button>
      </CardFooter>
    </Card>
  )
}
