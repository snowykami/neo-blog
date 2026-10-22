'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ErrorPage({ status, message }: { status: number, message: string }) {
  const t = useTranslations()
  return (
    <div className="flex w-full flex-1 items-center justify-center py-24">
      <div className="w-full max-w-xl px-4 text-center">
        <h1 className="mb-4 text-4xl font-bold tabular-nums">{status}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Button asChild>
          <Link href="/">{t('Operation.back_to_home')}</Link>
        </Button>
      </div>
    </div>
  )
}
