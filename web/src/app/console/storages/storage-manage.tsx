'use client'
import type { StorageProviderConfig, StorageProviderUsage } from '@/models/file'
import { ArrowRightLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteStorageProvider, listStorageProviders } from '@/api/file'
import { DeleteButtonWithPopconfirm } from '@/components/common/delete-button-with-popconfirm'
import { CreateOrUpdateStorageDialog } from '@/components/console/create-storage-dialog'
import { isDirectStorage, StorageMigrationDialog, StorageMigrationProgress, useStorageMigration } from '@/components/console/storage-migration'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { formatDataSize } from '@/utils/common/datasize'

const EMPTY_USAGE: StorageProviderUsage = { files: 0, bytes: 0, pageHtmlVersions: 0 }

export function StorageProviderManage() {
  const t = useTranslations('Console.storages')
  const [storages, setStorages] = useState<StorageProviderConfig[]>([])
  const [usage, setUsage] = useState<Record<string, StorageProviderUsage>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    listStorageProviders()
      .then((res) => {
        setStorages(res.data.providers || [])
        setUsage(res.data.usage || {})
      })
      .catch((error) => {
        toast.error(t('fetch_storages_failed') + (error?.message ? `: ${error.message}` : ''))
        setStorages([])
      })
  }, [t, refreshKey])

  const onStorageProviderAnyChange = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])
  // 迁移结束后刷新各存储的占用
  const migration = useStorageMigration(onStorageProviderAnyChange)

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
      {migration.status && (
        <StorageMigrationProgress status={migration.status} providers={storages} onChange={migration.refresh} />
      )}
      <Separator className="my-1" />
      <div>
        {storages.map(storage => (
          <div id={`storage-${storage.id}`} key={storage.id}>
            <StorageProviderItem
              key={storage.id}
              storage={storage}
              usage={usage[storage.id] ?? EMPTY_USAGE}
              canMigrate={storages.length > 1 && !migration.running}
              onChange={onStorageProviderAnyChange}
              onMigrationStarted={migration.refresh}
            />
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
  usage,
  canMigrate,
  onChange,
  onMigrationStarted,
}: {
  storage: StorageProviderConfig
  usage: StorageProviderUsage
  canMigrate: boolean
  onChange: () => void
  onMigrationStarted: () => void
}) {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  const commonT = useCommonT()
  const [migrateOpen, setMigrateOpen] = useState(false)
  const inUse = usage.files > 0 || usage.pageHtmlVersions > 0
  const onDelete = useCallback(async () => {
    await deleteStorageProvider({ id: storage.id })
    toast.success(operationT('delete_success'))
    onChange()
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
              <span className="text-xs text-muted-foreground">
                {t('usage', { files: usage.files, size: formatDataSize({ size: usage.bytes }) })}
                {usage.pageHtmlVersions > 0 && ` · ${t('usage_pages', { n: usage.pageHtmlVersions })}`}
              </span>
              {storage.isDefault && <Badge className="text-xs">{commonT('default')}</Badge>}
              <Badge variant="outline" className="text-xs" title={t(isDirectStorage(storage) ? 'direct_hint' : 'proxy_hint')}>
                {t(isDirectStorage(storage) ? 'migration.direct' : 'migration.proxy')}
              </Badge>
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto justify-end gap-2">
          {inUse && (
            <Button variant="outline" size="sm" disabled={!canMigrate} onClick={() => setMigrateOpen(true)}>
              <ArrowRightLeft />
              {t('migration.migrate')}
            </Button>
          )}
          <CreateOrUpdateStorageDialog initStorageProvider={storage} onCreate={onChange} />
          <DeleteButtonWithPopconfirm name={storage.name} onDelete={onDelete} />
        </div>
      </div>
      <StorageMigrationDialog
        open={migrateOpen}
        onOpenChange={setMigrateOpen}
        source={storage}
        usage={usage}
        onStarted={() => {
          setMigrateOpen(false)
          onMigrationStarted()
        }}
      />
    </div>
  )
}
