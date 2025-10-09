"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash } from "lucide-react";
import { getCategories, deleteCategory } from "@/api/post";
import type { Category } from "@/models/category";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

/* External Dialog components used above - import here to keep file self-contained */
import { CreateOrUpdateCategoryDialogWithButton } from "../common/create-label-and-category"; import { useAuth } from "@/contexts/auth-context";
import { isAdmin, isEditor } from "@/utils/common/permission";
import Forbidden from "@/components/common/forbidden";
import { useOperationT } from "@/hooks/translations";

export function CategoryManage() {
  const t = useTranslations("Console.categories");
  const operationT = useOperationT();
  const { user } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    getCategories()
      .then(res => setCategories(res.data.categories || []))
      .catch(() => toast.error(operationT("fetch_failed")))
      .finally(() => setLoading(false));
  }, [operationT]);

  const onCategoryCreatedOrUpdated = (cat: Category) => {
    setCategories(prev => {
      const exist = prev.find(c => c.id === cat.id);
      if (exist) return prev.map(c => c.id === cat.id ? cat : c);
      return [cat, ...prev];
    });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCategory({ id });
      setCategories(prev => prev.filter(c => c.id !== id));
      toast.success(operationT("delete_success"));
    } catch {
      toast.error(operationT("delete_failed"));
    }
  };

  const filtered = categories.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.slug.toLowerCase().includes(query.toLowerCase())
  );

  if (!user || !isAdmin({ user }) && !isEditor({ user })) return <Forbidden />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder={t("search_categories")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <CreateOrUpdateCategoryDialogWithButton
          category={null}
          onSaved={(cat) => onCategoryCreatedOrUpdated(cat)}
        />
      </div>

      <div className="max-h-[60vh] overflow-auto grid gap-2">
        {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
        {!loading && filtered.length === 0 && <div className="text-sm text-muted-foreground">{t("no_categories")}</div>}
        {filtered.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900">
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium flex-shrink-0">{c.name}</span>
                <div className="text-sm text-muted-foreground truncate min-w-0">{c.id} - {c.slug}</div>
              </div>
              {c.description && <div className="text-sm text-muted-foreground truncate mt-1">{c.description}</div>}
            </div>
            <div className="flex items-center gap-2">
              <CreateOrUpdateCategoryDialogWithButton
                category={c}
                onSaved={(updated) => onCategoryCreatedOrUpdated(updated)}
              />
              <ConfirmDialog
                title={t("delete_category")}
                description={t("delete_category_description")}
                confirmLabel={operationT("delete")}
                cancelLabel={operationT("cancel")}
                confirmVariant="destructive"
                onConfirm={() => handleDelete(c.id)}
              >
                <Button variant="outline" size="icon" className="text-red-500 hover:text-red-600">
                  <Trash size={16} />
                </Button>
              </ConfirmDialog>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



