import { I18nScope } from '@/components/i18n-scope'
import { ConsoleShell } from './console-shell'

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <I18nScope scope="console">
      <ConsoleShell>{children}</ConsoleShell>
    </I18nScope>
  )
}
