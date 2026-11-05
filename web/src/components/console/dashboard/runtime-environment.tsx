'use client'

import type { RuntimeEnvironment } from '@/models/misc'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { jetBrainsMono } from './runtime-shared'

// 实例的运行环境（Kubernetes、Docker、虚拟机等）：由实例自己检测，只用于展示

/** 运行环境的详细信息，读不到的项不显示 */
export function useEnvironmentDetails(environment: RuntimeEnvironment) {
  const t = useTranslations('Console.dashboard')
  return [
    { key: 'arch', label: t('runtime_env_arch'), value: environment.arch },
    { key: 'kernel', label: t('runtime_env_kernel'), value: environment.kernel },
    { key: 'distro', label: t('runtime_env_distro'), value: environment.distro },
    { key: 'pod', label: t('runtime_env_pod'), value: environment.podName },
    { key: 'namespace', label: t('runtime_env_namespace'), value: environment.podNamespace },
    { key: 'node', label: t('runtime_env_node'), value: environment.nodeName },
    { key: 'evidence', label: t('runtime_env_evidence'), value: environment.evidence },
  ].filter(item => item.value)
}

export function useEnvironmentKindLabel() {
  const t = useTranslations('Console.dashboard')
  return (environment: RuntimeEnvironment) => (t.has(`runtime_env_kind_${environment.kind}`) ? t(`runtime_env_kind_${environment.kind}`) : environment.kind)
}

/** 环境徽标：悬停或键盘聚焦时显示架构、内核、发行版、Pod 信息与检测依据 */
export function EnvironmentBadge({ environment }: { environment: RuntimeEnvironment }) {
  const t = useTranslations('Console.dashboard')
  const kindLabel = useEnvironmentKindLabel()
  const details = useEnvironmentDetails(environment)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className="cursor-default focus-visible:ring-2 focus-visible:ring-ring">
          {kindLabel(environment)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <div className="grid gap-1">
          <span className="font-semibold">{t('runtime_env_title')}</span>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {details.map(item => (
              <div key={item.key} className="contents">
                <dt className="opacity-80">{item.label}</dt>
                <dd className={cn(jetBrainsMono.className, 'break-all')}>{item.value}</dd>
              </div>
            ))}
          </dl>
          {environment.kind === 'linux' && <span className="opacity-80">{t('runtime_env_linux_hint')}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** 「全部指标」里的运行环境一节 */
export function EnvironmentDetails({ environment }: { environment: RuntimeEnvironment }) {
  const t = useTranslations('Console.dashboard')
  const kindLabel = useEnvironmentKindLabel()
  const details = useEnvironmentDetails(environment)
  return (
    <dl className="grid gap-1.5 border-b pb-2 text-sm">
      <div className="flex items-center justify-between gap-3 leading-relaxed">
        <dt className="text-muted-foreground">{t('runtime_env_title')}</dt>
        <dd>{kindLabel(environment)}</dd>
      </div>
      {details.map(item => (
        <div key={item.key} className="flex items-center justify-between gap-3 leading-relaxed">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn(jetBrainsMono.className, 'min-w-0 text-right break-all')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
