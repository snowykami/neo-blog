'use client'

import type { DesktopIslandFormMode, DesktopIslandPreferences } from '@/hooks/use-desktop-island-pref'
import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  DEFAULT_DESKTOP_ISLAND_PORT,
  requestDesktopIslandReconnect,
  updateDesktopIslandPrefs,
  useDesktopIslandPrefs,
  useDesktopIslandRuntime,
} from '@/hooks/use-desktop-island-pref'
import { cn } from '@/lib/utils'

interface PortFormValues {
  port: string
}

const BEHAVIOR_SWITCH_ITEMS: {
  key: keyof Pick<
    DesktopIslandPreferences,
    | 'hideWebIslandWhenConnected'
    | 'hideFloatingBallWhenConnected'
    | 'expandable'
    | 'showTrackPeek'
    | 'keepWhenPaused'
    | 'beatBars'
    | 'chorusGlow'
    | 'hdr'
  >
  labelKey: string
  descKey: string
}[] = [
  {
    key: 'hideWebIslandWhenConnected',
    labelKey: 'desktop_island.hide_web_island',
    descKey: 'desktop_island.hide_web_island_desc',
  },
  {
    key: 'hideFloatingBallWhenConnected',
    labelKey: 'desktop_island.hide_floating_ball',
    descKey: 'desktop_island.hide_floating_ball_desc',
  },
  {
    key: 'expandable',
    labelKey: 'desktop_island.expandable',
    descKey: 'desktop_island.expandable_desc',
  },
  {
    key: 'showTrackPeek',
    labelKey: 'desktop_island.show_track_peek',
    descKey: 'desktop_island.show_track_peek_desc',
  },
  {
    key: 'keepWhenPaused',
    labelKey: 'desktop_island.keep_when_paused',
    descKey: 'desktop_island.keep_when_paused_desc',
  },
  {
    key: 'beatBars',
    labelKey: 'desktop_island.beat_bars',
    descKey: 'desktop_island.beat_bars_desc',
  },
  {
    key: 'chorusGlow',
    labelKey: 'desktop_island.chorus_glow',
    descKey: 'desktop_island.chorus_glow_desc',
  },
  {
    key: 'hdr',
    labelKey: 'desktop_island.hdr',
    descKey: 'desktop_island.hdr_desc',
  },
]

const NIGHTLY_DMG_URL = 'https://github.com/snowykami/neo-blog/releases/download/island-nightly/NeoBlogIsland-universal.dmg'
const RELEASES_PAGE_URL = 'https://github.com/snowykami/neo-blog/releases'

export function DesktopIslandSettingsForm({ className }: { className?: string }) {
  const t = useTranslations('Console.user_preference')
  const prefs = useDesktopIslandPrefs()
  const { status } = useDesktopIslandRuntime()

  const form = useForm<PortFormValues>({
    defaultValues: {
      port: String(prefs.port),
    },
  })

  useEffect(() => {
    form.reset({ port: String(prefs.port) })
  }, [form, prefs.port])

  const onSavePort = (values: PortFormValues) => {
    const parsed = Number(values.port.trim())
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      form.setError('port', { message: t('desktop_island.port_invalid') })
      return
    }
    updateDesktopIslandPrefs({ port: parsed })
    requestDesktopIslandReconnect()
    toast.success(t('desktop_island.port_saved'))
  }

  const statusBadgeVariant = status === 'connected'
    ? 'default'
    : status === 'connecting'
      ? 'secondary'
      : 'outline'

  const statusText = !prefs.enabled
    ? t('desktop_island.status_disabled')
    : status === 'connected'
      ? t('desktop_island.status_connected')
      : status === 'connecting'
        ? t('desktop_island.status_connecting')
        : status === 'standby'
          ? t('desktop_island.status_standby')
          : t('desktop_island.status_disconnected')

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{t('desktop_island.card_title')}</CardTitle>
              <Badge variant={statusBadgeVariant}>{statusText}</Badge>
            </div>
            <CardDescription>{t('desktop_island.card_desc')}</CardDescription>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={checked => updateDesktopIslandPrefs({ enabled: checked })}
            aria-label={t('desktop_island.enable')}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="grid gap-1">
            <span className="text-xs font-medium">{t('desktop_island.download_title')}</span>
            <span className="text-muted-foreground text-xs">{t('desktop_island.download_desc')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <a href={NIGHTLY_DMG_URL} target="_blank" rel="noopener noreferrer">
                <DownloadIcon className="mr-1.5 size-3.5" />
                {t('desktop_island.download_nightly')}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={RELEASES_PAGE_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="mr-1.5 size-3.5" />
                {t('desktop_island.download_releases')}
              </a>
            </Button>
          </div>
        </div>

        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSavePort)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <FormLabel>{t('desktop_island.port_label')}</FormLabel>
                    <div className="flex gap-3">
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="numeric"
                          placeholder={String(DEFAULT_DESKTOP_ISLAND_PORT)}
                          className="font-mono"
                        />
                      </FormControl>
                      <Button type="submit" variant="secondary" disabled={!form.formState.isDirty}>
                        {t('desktop_island.port_save')}
                      </Button>
                    </div>
                    <FormDescription>{t('desktop_island.port_desc')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid content-start gap-2">
                <FormLabel>{t('desktop_island.form_mode_label')}</FormLabel>
                <Select
                  value={prefs.formMode}
                  onValueChange={val => updateDesktopIslandPrefs({ formMode: val as DesktopIslandFormMode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('desktop_island.form_mode_auto')}</SelectItem>
                    <SelectItem value="notch">{t('desktop_island.form_mode_notch')}</SelectItem>
                    <SelectItem value="capsule">{t('desktop_island.form_mode_capsule')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{t('desktop_island.form_mode_desc')}</p>
              </div>
            </div>

            {prefs.enabled && status !== 'connected' && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {status === 'standby' ? t('desktop_island.standby_hint') : t('desktop_island.reconnect_hint')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => requestDesktopIslandReconnect()}
                >
                  <RefreshCwIcon className="mr-1.5 size-3.5" />
                  {t('desktop_island.reconnect')}
                </Button>
              </div>
            )}
          </form>
        </Form>

        <Separator />

        <div className="grid gap-3">
          {BEHAVIOR_SWITCH_ITEMS.map(item => (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">{t(item.labelKey)}</span>
                <span className="text-muted-foreground text-xs">{t(item.descKey)}</span>
              </div>
              <Switch
                checked={prefs[item.key]}
                onCheckedChange={checked => updateDesktopIslandPrefs({ [item.key]: checked })}
                aria-label={t(item.labelKey)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
