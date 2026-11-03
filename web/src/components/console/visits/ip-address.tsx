import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ipDisplay } from './format'

// IP 地址：IPv4 完整显示；IPv6 只显示网段前缀，悬停查看完整地址
export function IpAddress({ ip, className }: { ip: string, className?: string }) {
  const display = ipDisplay(ip)
  if (display === ip)
    return <span className={cn('font-mono', className)}>{ip}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('cursor-help font-mono underline decoration-dotted underline-offset-2', className)}>{display}</span>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{ip}</TooltipContent>
    </Tooltip>
  )
}
