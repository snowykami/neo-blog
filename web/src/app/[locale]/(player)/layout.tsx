import { locale as rootLocale } from 'next/root-params'
import { I18nScope } from '@/components/i18n-scope'
import { PlayerShell } from './player-shell'

export default async function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await rootLocale()
  return (
    <I18nScope scope="(player)" locale={locale}>
      <PlayerShell>{children}</PlayerShell>
    </I18nScope>
  )
}
