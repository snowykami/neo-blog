import { I18nScope } from '@/components/i18n-scope'
import { PlayerShell } from './player-shell'

export default function PlayerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <I18nScope scope="(player)">
      <PlayerShell>{children}</PlayerShell>
    </I18nScope>
  )
}
