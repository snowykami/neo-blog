'use client'
import type { StorageProviderConfig } from '@/models/file'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteStorageProvider, listStorageProviders } from '@/api/file'
import { DeleteButtonWithConfirmDialog } from '@/components/common/delete-button-with-confirm-dialog'
import { CreateOrUpdateStorageDialog } from '@/components/console/create-storage-dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useCommonT, useOperationT } from '@/hooks/use-translations'

export function StorageProviderManage() {
  const t = useTranslations('Console.storages')
  const [storages, setStorages] = useState<StorageProviderConfig[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    listStorageProviders()
      .then((res) => {
        setStorages(res.data.providers || [])
      })
      .catch((error) => {
        toast.error(t('fetch_storages_failed') + (error?.message ? `: ${error.message}` : ''))
        setStorages([])
      })
  }, [t, refreshKey])

  const onStorageProviderAnyChange = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        {/* left header */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <CreateOrUpdateStorageDialog onCreate={onStorageProviderAnyChange} />
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
            <StorageProviderItem key={storage.id} storage={storage} onChange={onStorageProviderAnyChange} />
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

function StorageProviderItem({
  storage,
  onChange,
}: {
  storage: StorageProviderConfig
  onChange: () => void
}) {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  const commonT = useCommonT()
  const onDelete = useCallback(() => {
    deleteStorageProvider({ id: storage.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onChange()
      })
      .catch(err => toast.error(operationT('delete_failed') + (err?.message ? `: ${err.message}` : '')))
  }, [storage, onChange])
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
              {storage.isDefault && <Badge className="text-xs">{commonT('default')}</Badge>}
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto justify-end gap-2">
          <CreateOrUpdateStorageDialog initStorageProvider={storage} onCreate={onChange} />
          <DeleteButtonWithConfirmDialog onDelete={onDelete} />
        </div>
      </div>
    </div>
  )
}
