'use client'

import { AlertCircle, Compass, ShieldAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

export default function ErrorPage({ status, message }: { status: number, message: string }) {
  const t = useTranslations()
  const Icon = status === 403 ? ShieldAlert : status === 404 ? Compass : AlertCircle
  return (
    <div className="flex w-full flex-1 items-center justify-center px-4 py-20">
      <div className="surface-card flex w-full max-w-md flex-col items-center rounded-2xl bg-card p-8 text-center sm:p-10">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-7" aria-hidden />
        </div>
        <h1 className="mb-2 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{status}</h1>
        <p className="mb-6 text-sm text-balance text-muted-foreground sm:text-base">{message}</p>
        <Button asChild>
          <Link href="/">{t('Operation.back_to_home')}</Link>
        </Button>
      </div>
    </div>
  )
}
