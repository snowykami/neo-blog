'use client'

import type { VariantProps } from 'class-variance-authority'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * 分段切换器的外观变体（在 TabsList 上设置，TabsTrigger 通过 context 继承）：
 * - default：分段控件，轨道比页面底色略深，选中项为白色卡片 + 阴影，适合筛选 / 视图切换
 * - outline：透明轨道 + 描边，选中项为浅主题色，适合放在卡片内部
 * - solid：选中项填充主题色，强调当前状态
 * - underline：无轨道，选中项下方显示主题色短线，适合内容区的标签页
 * 轨道与选中项用前景色的透明度叠加，亮 / 暗模式下都能和页面底色、卡片底色区分开
 */
const tabsListVariants = cva('inline-flex w-fit items-center justify-center text-foreground/60', {
  variants: {
    variant: {
      default: 'h-9 rounded-lg bg-foreground/[.06] p-[3px] ring-1 ring-inset ring-foreground/[.04]',
      outline: 'h-9 rounded-lg border bg-transparent p-[3px]',
      solid: 'h-9 rounded-lg bg-foreground/[.06] p-[3px]',
      // 只允许横向滚动（窄屏时标签较多）：选中项的下划线向下偏移 1px 盖住底边，若不留出 pb-px 会多出 1px 高度而可以上下滚动；隐藏滚动条
      underline: 'h-10 gap-1 border-b border-foreground/10 overflow-x-auto overflow-y-hidden pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    },
  },
  defaultVariants: { variant: 'default' },
})

const tabsTriggerVariants = cva(
  'inline-flex flex-1 items-center justify-center gap-1.5 px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default: 'h-full rounded-md data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-foreground/[.06] dark:data-[state=active]:bg-foreground/15',
        outline: 'h-full rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary',
        solid: 'h-full rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm',
        underline: '-mb-px h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>['variant']>

const TabsVariantContext = React.createContext<TabsVariant>('default')

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const resolved = variant ?? 'default'
  return (
    <TabsVariantContext.Provider value={resolved}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={resolved}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, tabsListVariants, TabsTrigger, tabsTriggerVariants }
