'use client'

import type { Category } from '@/models/category'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { deleteCategory, getCategories } from '@/api/post'
import { DeleteButtonWithPopconfirm } from '@/components/common/delete-button-with-popconfirm'

import { CreateOrUpdateCategoryDialogWithButton } from '@/components/console/common/create-label-and-category'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { isAdmin } from '@/utils/common/permission'

export function CategoryManage() {
  const t = useTranslations('Console.categories')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const { user } = useAuth()
  // 分类全站共享：编辑者只能新建，改名与删除只有管理员可以（与后端路由一致）
  const canManage = !!user && isAdmin({ user })

  const [query, setQuery] = useState('')
  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const categoriesQuery = useConsoleQuery(
    ['category/list'],
    () => getCategories().then(res => res.data.categories || []),
    { onError: () => toast.error(operationT('fetch_failed')) },
  )
  const categories = categoriesQuery.data ?? []
  const loading = categoriesQuery.loading && !categoriesQuery.data
  const { refresh, setData: setCategories } = categoriesQuery

  const onCategoryCreatedOrUpdated = (cat: Category) => {
    setCategories((prev = []) => {
      const exist = prev.find(c => c.id === cat.id)
      if (exist)
        return prev.map(c => (c.id === cat.id ? cat : c))
      return [cat, ...prev]
    })
  }

  const onChange = useCallback(() => {
    void refresh()
  }, [refresh])

  const filtered = categories.filter(
    c =>
      c.name.toLowerCase().includes(query.toLowerCase())
      || c.slug.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder={t('search_categories')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1"
        />
        <CreateOrUpdateCategoryDialogWithButton
          category={null}
          onSaved={cat => onCategoryCreatedOrUpdated(cat)}
        />
      </div>
      {!canManage && <p className="text-sm text-muted-foreground mb-4">{t('admin_only_hint')}</p>}

      {loading && (
        <div
          className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={commonT('loading')}
        >
          {Array.from({ length: 6 }, (_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <Empty className="rounded-xl border bg-card py-10">
          <EmptyDescription>{t('no_categories')}</EmptyDescription>
        </Empty>
      )}
      {!loading && filtered.length > 0 && (
        <div className="overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map(c => (
            <CategoryItem key={c.id} category={c} canManage={canManage} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryItem({ category, canManage, onChange }: { category: Category, canManage: boolean, onChange: () => void }) {
  const operationT = useOperationT()
  const handleDelete = async () => {
    await deleteCategory({ id: category.id })
    toast.success(operationT('delete_success'))
    onChange()
  }
  return (
    <div
      key={category.id}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card transition-colors hover:border-primary/40"
    >
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium flex-shrink-0">{category.name}</span>
          <div className="text-sm text-muted-foreground truncate min-w-0">
            -
            {' '}
            {category.slug}
          </div>
        </div>
        {category.description && (
          <div className="text-sm text-muted-foreground truncate mt-1">{category.description}</div>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          <CreateOrUpdateCategoryDialogWithButton
            category={category}
            onSaved={onChange}
          />
          <DeleteButtonWithPopconfirm name={category.name} onDelete={handleDelete} />
        </div>
      )}
    </div>
  )
}
