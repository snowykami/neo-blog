'use client'
import type { StorageProviderConfig } from '@/models/file'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listStorageProviders } from '@/api/file'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useCommonT, useOperationT } from '@/hooks/translations'

export function StorageProviderManage() {
  const t = useTranslations('Console.storages')
  const [storages, setStorages] = useState<StorageProviderConfig[]>([])

  useEffect(() => {
    listStorageProviders()
      .then((res) => {
        setStorages(res.data.providers || [])
      })
      .catch((error) => {
        toast.error(t('fetch_storages_failed') + (error?.message ? `: ${error.message}` : ''))
        setStorages([])
      })
  }, [t])

  const onStorageProviderCreate = useCallback(() => {}, [])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        {/* left header */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <CreateStorageProviderDialogWithButton onCreate={onStorageProviderCreate} />
          </div>
        </div>
        {/* right header */}
        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-2"></div>
        </div>
      </div>
      <Separator className="my-1" />
      <div>
        {storages.map(storage => (
          <div id={`storage-${storage.id}`} key={storage.id}>
            <StorageProviderItem key={storage.id} storage={storage} />
            <Separator className="my-1" />
          </div>
        ))}
        {storages.length === 0 && (
          <div className="text-sm text-muted-foreground">{t('no_storages')}</div>
        )}
      </div>
    </div>
  )
}

function StorageProviderItem({ storage }: { storage: StorageProviderConfig }) {
  const t = useTranslations('Console.storages')
  const commonT = useCommonT()
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-2">
        {/* left */}
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-medium">{storage.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {commonT('id')}
                :
                {storage.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('storage_type')}
                :
                {storage.type}
              </span>
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto"></div>
      </div>
    </div>
  )
}

function CreateStorageProviderDialogWithButton({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">{operationT('create')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create_storage')}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>
            <div className="flex">
              <Button variant="outline">{operationT('cancel')}</Button>
              <Button
                onClick={() => {
                  onCreate()
                }}
                className="ml-2"
              >
                {operationT('create')}
              </Button>
            </div>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
