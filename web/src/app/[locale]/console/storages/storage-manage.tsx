'use client'
import type { StorageProviderConfig, StorageProviderUsage } from '@/models/file'
import { ArrowRightLeft, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { memo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { deleteStorageProvider, listStorageProviders } from '@/api/file'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { CreateOrUpdateStorageDialog } from '@/components/console/create-storage-dialog'
import { isDirectStorage, StorageMigrationDialog, StorageMigrationProgress, useStorageMigration } from '@/components/console/storage-migration'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { formatDataSize } from '@/utils/common/datasize'

const EMPTY_USAGE: StorageProviderUsage = { files: 0, bytes: 0, pageHtmlVersions: 0 }
const EMPTY_PROVIDERS: StorageProviderConfig[] = []
const EMPTY_USAGE_MAP: Record<string, StorageProviderUsage> = {}

const StorageProviderItem = memo(({
  storage,
  usage,
  canMigrate,
  onRequestEdit,
  onRequestMigrate,
  onRequestDelete,
}: {
  storage: StorageProviderConfig
  usage: StorageProviderUsage
  canMigrate: boolean
  onRequestEdit: (storage: StorageProviderConfig) => void
  onRequestMigrate: (storage: StorageProviderConfig) => void
  onRequestDelete: (storage: StorageProviderConfig) => void
}) => {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  const commonT = useCommonT()
  const inUse = usage.files > 0 || usage.pageHtmlVersions > 0
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
            <Button variant="outline" size="sm" disabled={!canMigrate} onClick={() => onRequestMigrate(storage)}>
              <ArrowRightLeft />
              {t('migration.migrate')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onRequestEdit(storage)}>
            {operationT('edit')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="text-red-500 hover:text-red-600"
            aria-label={operationT('delete')}
            title={operationT('delete')}
            onClick={() => onRequestDelete(storage)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
})

export function StorageProviderManage() {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const storagesQuery = useConsoleQuery(
    ['console/storages'],
    () => listStorageProviders().then(res => ({
      providers: res.data.providers || [],
      usage: res.data.usage || {},
    })),
    { onError: error => toast.error(`${t('fetch_storages_failed')}: ${errorMessageT(error)}`) },
  )
  const storages = storagesQuery.data?.providers ?? EMPTY_PROVIDERS
  const usage = storagesQuery.data?.usage ?? EMPTY_USAGE_MAP
  const loading = storagesQuery.loading && !storagesQuery.data
  const onStorageProviderAnyChange = storagesQuery.refresh
  // 迁移结束后刷新各存储的占用
  const migration = useStorageMigration(onStorageProviderAnyChange)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<StorageProviderConfig | undefined>(undefined)
  const [migratingStorage, setMigratingStorage] = useState<StorageProviderConfig | null>(null)
  const [deletingStorage, setDeletingStorage] = useState<StorageProviderConfig | null>(null)

  const openCreateDialog = useCallback(() => {
    setEditingStorage(undefined)
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((storage: StorageProviderConfig) => {
    setEditingStorage(storage)
    setDialogOpen(true)
  }, [])

  const handleMigrationStarted = useCallback(() => {
    setMigratingStorage(null)
    migration.refresh()
  }, [migration.refresh])

  const handleDeleteOne = useCallback(async () => {
    if (!deletingStorage)
      return
    await deleteStorageProvider({ id: deletingStorage.id })
    toast.success(operationT('delete_success'))
    onStorageProviderAnyChange()
  }, [deletingStorage, operationT, onStorageProviderAnyChange])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        {/* left header */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreateDialog}>{operationT('create')}</Button>
          </div>
        </div>
        {/* right header */}
        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-2"></div>
        </div>
      </div>
      <CreateOrUpdateStorageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initStorageProvider={editingStorage}
        onCreate={onStorageProviderAnyChange}
      />
      <StorageMigrationDialog
        open={!!migratingStorage}
        onOpenChange={open => !open && setMigratingStorage(null)}
        source={migratingStorage ?? undefined}
        usage={migratingStorage ? (usage[migratingStorage.id] ?? EMPTY_USAGE) : undefined}
        onStarted={handleMigrationStarted}
      />
      <ConfirmDialog
        open={!!deletingStorage}
        onOpenChange={open => !open && setDeletingStorage(null)}
        title={deletingStorage?.name ? operationT('delete_confirm_title', { name: deletingStorage.name }) : operationT('confirm_delete')}
        description={operationT('delete_description')}
        confirmLabel={operationT('delete')}
        errorText={operationT('delete_failed')}
        confirmVariant="destructive"
        onConfirm={handleDeleteOne}
      />
      {migration.status && (
        <StorageMigrationProgress status={migration.status} providers={storages} onChange={migration.refresh} />
      )}
      <Separator className="my-1" />
      <div>
        {loading && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('loading')}</div>
        )}
        {!loading && storages.length === 0 && (
          <Empty className="py-10">
            <EmptyDescription>{t('no_storages')}</EmptyDescription>
          </Empty>
        )}
        {storages.map(storage => (
          <div id={`storage-${storage.id}`} key={storage.id}>
            <StorageProviderItem
              storage={storage}
              usage={usage[storage.id] ?? EMPTY_USAGE}
              canMigrate={storages.length > 1 && !migration.running}
              onRequestEdit={openEditDialog}
              onRequestMigrate={setMigratingStorage}
              onRequestDelete={setDeletingStorage}
            />
            <Separator className="my-1" />
          </div>
        ))}
      </div>
    </div>
  )
}
