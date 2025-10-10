'use client'

import type { Category } from '@/models/category'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteCategory, getCategories } from '@/api/post'
import { DeleteButtonWithConfirmDialog } from '@/components/common/delete-button-with-confirm-dialog'
import Forbidden from '@/components/common/forbidden'

import { CreateOrUpdateCategoryDialogWithButton } from '@/components/console/common/create-label-and-category'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { isAdmin, isEditor } from '@/utils/common/permission'

export function CategoryManage() {
  const t = useTranslations('Console.categories')
  const operationT = useOperationT()
  const { user } = useAuth()

  const [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getCategories()
      .then(res => setCategories(res.data.categories || []))
      .catch(() => toast.error(operationT('fetch_failed')))
  }, [operationT, refreshKey])

  const onCategoryCreatedOrUpdated = (cat: Category) => {
    setCategories((prev) => {
      const exist = prev.find(c => c.id === cat.id)
      if (exist)
        return prev.map(c => (c.id === cat.id ? cat : c))
      return [cat, ...prev]
    })
  }

  const onChange = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  const filtered = categories.filter(
    c =>
      c.name.toLowerCase().includes(query.toLowerCase())
      || c.slug.toLowerCase().includes(query.toLowerCase()),
  )

  if (!user || (!isAdmin({ user }) && !isEditor({ user })))
    return <Forbidden />

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

      <div className="overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map(c => (
          <CategoryItem key={c.id} category={c} onChange={onChange} />
        ))}
      </div>
    </div>
  )
}

function CategoryItem({ category, onChange }: { category: Category, onChange: () => void }) {
  const operationT = useOperationT()
  const handleDelete = () => {
    deleteCategory({ id: category.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onChange()
      })
      .catch(() => toast.error(operationT('delete_failed')))
  }
  return (
    <div
      key={category.id}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900"
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
      <div className="flex items-center gap-2">
        <CreateOrUpdateCategoryDialogWithButton
          category={category}
          onSaved={onChange}
        />
        <DeleteButtonWithConfirmDialog onDelete={handleDelete} />
      </div>
    </div>
  )
}
