import { I18nScope } from '@/components/i18n-scope'
import { PlayerShell } from './player-shell'

export default async function PlayerLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params
  return (
    <I18nScope scope="(player)" locale={locale}>
      <PlayerShell>{children}</PlayerShell>
    </I18nScope>
  )
}
