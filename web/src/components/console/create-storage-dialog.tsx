import type { SubmitHandler } from 'react-hook-form'
import type { StorageProviderConfig } from '@/models/file'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createStorageProvider, updateStorageProvider } from '@/api/file'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { StorageType } from '@/models/types'
import { getErrorMessage } from '@/utils/common/error'
import { providerFormMap } from './storage-forms'

export function CreateOrUpdateStorageDialog({ initStorageProvider, onCreate }: { initStorageProvider?: StorageProviderConfig, onCreate: () => void }) {
  const t = useTranslations('Console.storages')
  const operationT = useOperationT()
  const [open, setOpen] = useState(false)
  const form = useForm<StorageProviderConfig>({
    defaultValues: initStorageProvider || {
      id: 0,
      name: '',
      type: StorageType.Local,
      isDefault: false,
      baseDir: '',
      s3Region: '',
      s3Bucket: '',
      s3Prefix: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3Endpoint: '',
      s3PathStyle: false,
      s3BaseUrl: '',
      webdavEndpoint: '',
      webdavUsername: '',
      webdavPassword: '',
    },
    mode: 'onChange',
  })
  const { watch, handleSubmit, formState, control } = form
  const selectedType = watch('type')

  const onSubmit: SubmitHandler<StorageProviderConfig> = async (data: StorageProviderConfig) => {
    if (initStorageProvider) {
      try {
        await updateStorageProvider({ provider: data })
        toast.success(operationT('update_success'))
        // 以新值作为表单基准，再次打开时显示最新配置
        form.reset(data)
        setOpen(false)
        onCreate()
      }
      catch (err) {
        const message = getErrorMessage(err)
        toast.error(operationT('update_failed') + (message ? `: ${message}` : ''))
      }
    }
    else {
      try {
        await createStorageProvider({ provider: data })
        toast.success(operationT('create_success'))
        form.reset()
        setOpen(false)
        onCreate()
      }
      catch (err) {
        const message = getErrorMessage(err)
        toast.error(operationT('create_failed') + (message ? `: ${message}` : ''))
      }
    }
  }

  const handleCancel = () => {
    form.reset()
    setOpen(false)
  }

  const StorageForm = selectedType ? providerFormMap[selectedType as StorageType] : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={initStorageProvider ? 'outline' : 'default'}>{operationT(initStorageProvider ? 'edit' : 'create')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('create_storage')}</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
            <StorageTypeSelector value={selectedType as StorageType} onChange={v => form.setValue('type', v)} />
            <FormField
              control={control}
              name="isDefault"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('is_default')}</FormLabel>
                  <FormControl>
                    <Checkbox
                      checked={field.value as boolean}
                      onCheckedChange={checked => field.onChange(checked)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="baseDir"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('base_dir')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {StorageForm && <StorageForm />}
            <DialogFooter>
              <div className="flex gap-3">
                <Button onClick={handleCancel} variant="outline" type="button">
                  {operationT('cancel')}
                </Button>
                {/* 只通过表单 submit 触发一次提交，成功后再关闭对话框 */}
                <Button disabled={!formState.isValid || formState.isSubmitting} type="submit">
                  {operationT('submit')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  )
}

export function StorageTypeSelector({ value, onChange }: { value: StorageType, onChange: (value: StorageType) => void }) {
  const t = useTranslations('Console.storages')
  const [open, setOpen] = useState(false)
  const storageTypes = Object.values(StorageType)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          {value
            ? storageTypes.find(storageType => storageType.includes(value))
            : t('select_storage_type')}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder={t('search_storage_type')} className="h-9" />
          <CommandList>
            <CommandEmpty>{t('no_storage_type_found')}</CommandEmpty>
            <CommandGroup>
              {storageTypes.map(storageType => (
                <CommandItem
                  key={storageType}
                  value={storageType}
                  onSelect={(currentValue) => {
                    if (currentValue === value)
                      return
                    onChange(currentValue as StorageType)
                    setOpen(false)
                  }}
                >
                  {storageType}
                  <Check
                    className={cn(
                      'ml-auto',
                      value === storageType ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
