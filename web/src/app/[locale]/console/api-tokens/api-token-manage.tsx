'use client'

import type { APIToken } from '@/models/api-token'
import { KeyRound } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { listAPITokens, revokeAPIToken } from '@/api/api-token'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useErrorMessageT } from '@/hooks/use-translations'
import { CreateAPITokenDialog } from './create-api-token-dialog'

const COLUMN_COUNT = 6

type TokenStatus = 'active' | 'expired' | 'revoked'

function tokenStatus(token: APIToken): TokenStatus {
  if (token.revokedAt)
    return 'revoked'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())
    return 'expired'
  return 'active'
}

export function APITokenManage() {
  const t = useTranslations('Console.api_tokens')
  const format = useFormatter()
  const errorMessageT = useErrorMessageT()
  const [tokens, setTokens] = useState<APIToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchTokens = useCallback(() => {
    setLoading(true)
    listAPITokens()
      .then((res) => {
        setTokens(res.data.apiTokens || [])
        setError('')
      })
      .catch((err: unknown) => setError(errorMessageT(err)))
      .finally(() => setLoading(false))
  }, [errorMessageT])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const formatDate = (value: string | null, fallback: string) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : fallback

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-2xl gap-1">
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          <p className="text-sm text-muted-foreground">{t('description_safety')}</p>
        </div>
        <CreateAPITokenDialog onCreated={fetchTokens} />
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('scopes')}</TableHead>
              <TableHead>{t('last_used_at')}</TableHead>
              <TableHead>{t('expires_at')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tokens.length === 0 && Array.from({ length: 3 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: COLUMN_COUNT }, (_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!loading && error && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center">
                  <div className="grid justify-items-center gap-3">
                    <p role="alert" className="text-sm text-destructive">{`${t('load_failed')}: ${error}`}</p>
                    <Button size="sm" variant="outline" onClick={fetchTokens}>{t('retry')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && tokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {!error && tokens.map((token) => {
              const status = tokenStatus(token)
              return (
                <TableRow key={token.id} className={status === 'active' ? undefined : 'text-muted-foreground'}>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                        {token.name}
                      </span>
                      <code className="text-xs text-muted-foreground">{`${token.prefix}…`}</code>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {token.scopes.map(scope => (
                        <Badge key={scope} variant="outline" className="font-mono text-[11px]">{scope}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDate(token.lastUsedAt, t('never_used'))}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDate(token.expiresAt, t('never_expires'))}</TableCell>
                  <TableCell>
                    <Badge variant={status === 'active' ? 'outline' : status === 'revoked' ? 'destructive' : 'secondary'}>
                      {t(`status_${status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {status !== 'revoked' && (
                      <ConfirmDialog
                        title={t('revoke_title', { name: token.name })}
                        description={t('revoke_description')}
                        confirmLabel={t('revoke')}
                        errorText={t('revoke_failed')}
                        onConfirm={async () => {
                          await revokeAPIToken({ id: token.id })
                          fetchTokens()
                        }}
                      >
                        <Button size="sm" variant="ghost" className="text-destructive">{t('revoke')}</Button>
                      </ConfirmDialog>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
