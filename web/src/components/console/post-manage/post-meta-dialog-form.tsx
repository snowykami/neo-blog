"use client"

import { getCategories, updatePost } from "@/api/post"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Category } from "@/models/category"
import { Post } from "@/models/post"
import { DialogClose } from "@radix-ui/react-dialog"
import { Check, ChevronsUpDown } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { SubmitHandler, useForm } from "react-hook-form"
import { Label } from '@/models/label';
import { getLabels } from "@/api/label"
import { toast } from "sonner"

interface PostMetaForm {
  title: string
  slug: string
  cover: string
  category: Category | null
  labels: Label[]
  isOrigin: boolean
  isPrivate: boolean
}


export function PostMetaSettingButtonWithDialog({
  post, onMetaChange,
  open, onOpenChange,
  isCreate = false
}: {
  post: Post, onMetaChange: ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => void,
  open: boolean, onOpenChange: (open: boolean) => void,
  isCreate?: boolean
}) {
  const operationT = useTranslations("Operation")
  const t = useTranslations("Console.post_edit")
  const form = useForm<PostMetaForm>({
    defaultValues: {
      title: post.title,
      slug: post.slug || "",
      cover: post.cover || "",
      category: post.category,
      labels: post.labels || [],
      isPrivate: post.isPrivate,
    }
  })

  const onSubmit: SubmitHandler<PostMetaForm> = (data) => {
    onMetaChange && onMetaChange({
      post: {
        id: post.id,
        title: data.title,
        slug: data.slug,
        cover: data.cover,
        category: data.category || undefined,
        labels: data.labels,
        isPrivate: data.isPrivate,
      }
    })
    updatePost({
      post: {
        id: post.id,
        title: data.title,
        slug: data.slug,
        cover: data.cover,
        categoryId: data.category?.id,
        labelIds: data.labels.map(l => l.id),
        isPrivate: data.isPrivate,
      }
    }).then(() => {
      toast.success(operationT("update_success"))
    }).catch(() => {
      toast.error(operationT("update_failed"))
    })
  }

  const handleCancel = () => {
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("post_meta")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("post_title")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("post_slug")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cover"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("post_cover")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <PostCategorySelector
              category={form.watch("category")}
              onCategoryChange={(category) => form.setValue("category", category)}
            />


            <PostLabelSelector
              labels={form.watch("labels")}
              onSelectedLabelsChange={(labels) => form.setValue("labels", labels)}
            />

            <DialogFooter>
              <DialogClose asChild>
                <div className="flex gap-2">
                  <Button onClick={handleCancel} variant="outline">{operationT("cancel")}</Button>
                  <Button onClick={() => form.handleSubmit(onSubmit)}>{operationT("save")}</Button>
                </div>
              </DialogClose>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function PostCategorySelector(
  { category, onCategoryChange }:
    { category: Category | null, onCategoryChange: (category: Category | null) => void }) {
  const t = useTranslations("Console.post_edit")
  const operationT = useTranslations("Operation")
  const [items, setItems] = useState<Category[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getCategories().then(res => {
      setItems(res.data.categories)
    }).catch(() => {
    })
  }, [])

  return (
    <FormField
      name="category"
      render={() => (
        <FormItem>
          <FormLabel>{t("post_category")}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  role="combobox"
                  aria-expanded={open}
                  className={cn("w-auto justify-between", !category && "text-muted-foreground")}
                >
                  {category ? `${category.name} (${category.slug})` : t("select_category")}
                  <ChevronsUpDown className="ml-2 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[240px] p-0">
                <Command>
                  <CommandInput
                    placeholder={operationT("search")}
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>{t("no_category")}</CommandEmpty>
                    <CommandGroup>
                      {[{ id: 0, name: t("uncategorized"), slug: "-", description: "" }, ...items].map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name + c.slug}
                          onSelect={() => {
                            onCategoryChange(c)
                            setOpen(false)
                          }}
                        >
                          {c.name} ({c.slug})
                          <Check className={cn("ml-auto", category?.id === c.id ? "opacity-100" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FormControl>
          <FormDescription>{t("post_category_desc")}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function PostLabelSelector(
  { labels, onSelectedLabelsChange }: { labels: Label[], onSelectedLabelsChange: (labels: Label[]) => void }
) {
  const t = useTranslations("Console.post_edit");
  const operationT = useTranslations("Operation");
  const [items, setItems] = useState<Label[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getLabels().then(res => {
      setItems(res.data.labels);
    }).catch(() => {
    });
  }, []);

  const toggle = (label: Label) => {
    const exists = labels.find((l) => l.id === label.id);
    if (exists) {
      onSelectedLabelsChange(labels.filter((l) => l.id !== label.id));
    } else {
      onSelectedLabelsChange([...labels, label]);
    }
  };

  const remove = (label: Label, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectedLabelsChange(labels.filter((l) => l.id !== label.id));
  };

  return (
    <FormField
      name="labels"
      render={() => (
        <FormItem>
          <FormLabel>{t("post_labels")}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  role="combobox"
                  aria-expanded={open}
                  className={cn("w-full h-auto py-2 justify-between text-left", labels.length === 0 && "text-muted-foreground")}
                >
                  <div className="flex flex-wrap gap-2 max-w-[60%]">
                    {labels.length === 0 ? t("select_labels") : labels.map(l => (
                      <span
                        key={l.id}
                        className="inline-flex items-center gap-2 px-2 py-0.5 rounded-lg bg-muted text-sm"
                        onClick={(e) => remove(l, e)}
                      >
                        <span>{l.name}</span>
                        <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </span>
                    ))}
                  </div>
                  <ChevronsUpDown className="ml-2 opacity-50" />
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-auto p-0">
                <Command>
                  <CommandInput
                    placeholder={operationT("search")}
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>{t("no_label")}</CommandEmpty>
                    <CommandGroup>
                      {items.map((l) => {
                        return (
                          <CommandItem
                            key={l.id}
                            value={l.name + l.slug}
                            onSelect={() => {
                              toggle(l);
                            }}
                          >
                            {l.name} ({l.slug})
                            <Check className={cn("ml-auto", labels.find((label) => label.id === l.id) ? "opacity-100" : "opacity-0")} />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                    {/* 可选：在这里提供“创建新标签”按钮 */}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
