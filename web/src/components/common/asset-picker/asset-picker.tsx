'use client'

import type { PickedAsset } from './utils'
import { FolderOpenIcon, UploadIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { useIsMobile } from '@/hooks/use-mobile'
import { useOperationT } from '@/hooks/use-translations'
import { isAdmin } from '@/utils/common/permission'
import { AssetLibrary } from './asset-library'
import { AssetUploader } from './asset-uploader'
import { lockedTypeOf } from './utils'

export type AssetPickerTab = 'library' | 'upload'

export interface AssetPickerProps {
  /** 触发器（asChild），不传时需通过 open / onOpenChange 受控打开 */
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 与 <input accept> 相同的写法，如 image/*；同时用于资产库筛选与本地上传校验 */
  accept?: string
  /** 是否多选，默认单选 */
  multiple?: boolean
  /** 多选时最多可选数量 */
  max?: number
  /** 本地上传单个文件的大小上限（字节） */
  maxSize?: number
  /** 本地上传图片的默认压缩等级 0-10 */
  compressLevel?: number
  title?: string
  defaultTab?: AssetPickerTab
  onSelect: (assets: PickedAsset[]) => void
}

/**
 * 全局资产选择器：从资产库选择已有文件，或本地上传后直接选中；桌面端为对话框，移动端为底部抽屉
 */
export function AssetPicker({ children, open: openProp, onOpenChange, title, ...bodyProps }: AssetPickerProps) {
  const t = useTranslations('AssetPicker')
  const isMobile = useIsMobile()
  const [innerOpen, setInnerOpen] = React.useState(false)
  const open = openProp ?? innerOpen
  const setOpen = (next: boolean) => {
    setInnerOpen(next)
    onOpenChange?.(next)
  }
  const heading = title ?? t('title')
  const body = <AssetPickerBody {...bodyProps} onClose={() => setOpen(false)} isMobile={isMobile} />

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        {children && <DrawerTrigger asChild>{children}</DrawerTrigger>}
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{heading}</DrawerTitle>
            <DrawerDescription>{t('description')}</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

/** 弹层内容：每次打开时重新挂载，选中状态随之重置 */
function AssetPickerBody({
  accept,
  multiple = false,
  max,
  maxSize,
  compressLevel = 5,
  defaultTab = 'library',
  onSelect,
  onClose,
  isMobile,
}: Omit<AssetPickerProps, 'children' | 'open' | 'onOpenChange' | 'title'> & { onClose: () => void, isMobile: boolean }) {
  const t = useTranslations('AssetPicker')
  const operationT = useOperationT()
  const { user } = useAuth()
  const [tab, setTab] = React.useState<AssetPickerTab>(defaultTab)
  const [selected, setSelected] = React.useState<PickedAsset[]>([])
  const [refreshKey, setRefreshKey] = React.useState(0)
  const limit = multiple ? max : 1

  const addAsset = (asset: PickedAsset, prev: PickedAsset[]) => {
    if (!multiple)
      return [asset]
    if (prev.some(item => item.id === asset.id))
      return prev
    if (limit && prev.length >= limit) {
      toast.warning(t('max_reached', { count: limit }))
      return prev
    }
    return [...prev, asset]
  }

  const toggle = (asset: PickedAsset) => setSelected(prev =>
    prev.some(item => item.id === asset.id) ? prev.filter(item => item.id !== asset.id) : addAsset(asset, prev))

  const confirm = (assets: PickedAsset[]) => {
    if (assets.length === 0)
      return
    onSelect(assets)
    onClose()
  }

  const Footer = isMobile ? DrawerFooter : DialogFooter
  return (
    <>
      <Tabs value={tab} onValueChange={value => setTab(value as AssetPickerTab)} className="min-h-0 flex-1 gap-3 max-md:px-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="library">
            <FolderOpenIcon />
            {t('tab_library')}
          </TabsTrigger>
          <TabsTrigger value="upload">
            <UploadIcon />
            {t('tab_upload')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="min-h-0">
          <AssetLibrary
            accept={accept}
            lockedType={lockedTypeOf(accept)}
            canViewAll={!!user && isAdmin({ user })}
            refreshKey={refreshKey}
            selected={selected}
            onToggle={toggle}
            // 单选时双击直接确认
            onConfirm={asset => !multiple && confirm([asset])}
          />
        </TabsContent>
        <TabsContent value="upload">
          <AssetUploader
            accept={accept}
            multiple={multiple}
            maxSize={maxSize}
            defaultCompressLevel={compressLevel}
            onUploaded={asset => setSelected(prev => addAsset(asset, prev))}
            onBatchDone={() => {
              // 上传完成后刷新资产库并切换过去，新文件已处于选中状态
              setRefreshKey(key => key + 1)
              setTab('library')
            }}
          />
        </TabsContent>
      </Tabs>
      <Footer className="flex-row items-center gap-2 sm:justify-between">
        <span className="flex-1 text-sm text-muted-foreground">
          {limit && multiple ? t('selected_count_limit', { count: selected.length, limit }) : t('selected_count', { count: selected.length })}
        </span>
        <Button type="button" variant="outline" onClick={onClose}>{operationT('cancel')}</Button>
        <Button type="button" disabled={selected.length === 0} onClick={() => confirm(selected)}>{operationT('confirm')}</Button>
      </Footer>
    </>
  )
}
