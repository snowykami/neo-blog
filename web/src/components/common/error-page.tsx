'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ErrorPage({ status, message }: { status: number, message: string }) {
  const t = useTranslations()
  return (
    <div className="w-full flex-1 flex items-center justify-center pt-40">
      <div className="text-center max-w-xl w-full px-4">
        <h1 className="text-4xl font-bold mb-4">{status}</h1>
        <p className="text-muted-foreground mb-6">{message}</p>
        <Button>
          <Link href="/">{t('Operation.back_to_home')}</Link>
        </Button>
      </div>
    </div>
  )
}
