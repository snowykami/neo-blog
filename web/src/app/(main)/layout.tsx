import { I18nScope } from '@/components/i18n-scope'
import { MainShell } from './main-shell'

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <I18nScope scope="(main)">
      <MainShell>{children}</MainShell>
    </I18nScope>
  )
}
