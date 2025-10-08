"use client"

import { createPost, getCategories, updatePost } from "@/api/post"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Category } from "@/models/category"
import { Post } from "@/models/post"
import { DialogClose, DialogDescription } from "@radix-ui/react-dialog"
import { Check, ChevronsUpDown, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { SubmitHandler, useForm } from "react-hook-form"
import { Label } from '@/models/label';
import { getLabels } from "@/api/label"
import { toast } from "sonner"
import { CreateOrUpdateCategoryDialogWithButton, CreateOrUpdateLabelDialogWithButton } from "../common/create-label-and-category"
import { Textarea } from "@/components/ui/textarea"
import { BaseResponseError } from "@/models/resp"

interface PostMetaForm {
  title: string
  slug: string
  cover: string
  category: Category | null
  labels: Label[]
  isPrivate: boolean
  description: string
}


export function CreateOrUpdatePostMetaDialogWithoutButton({
  post, onPostChange: onMetaChange,
  open, onOpenChange,
}: {
  post: Post | null, onPostChange: ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => void,
  open: boolean, onOpenChange: (open: boolean) => void,
}) {
  const operationT = useTranslations("Operation")
  const commonT = useTranslations("Common")
  const t = useTranslations("Console.post_edit")
  const form = useForm<PostMetaForm>({
    defaultValues: post ? {
      title: post.title,
      slug: post.slug || "",
      cover: post.cover || "",
      category: post.category,
      labels: post.labels || [],
      isPrivate: post.isPrivate,
      description: post.description || "",
    } : {
      title: "",
      slug: "",
      cover: "",
      category: null,
      labels: [],
      isPrivate: false,
      description: "",
    }
  })

  const onSubmit: SubmitHandler<PostMetaForm> = (data) => {
    if (post) {
      // 更新文章元信息
      updatePost({
        post: {
          id: post.id,
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          categoryId: data.category?.id,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          isPrivate: data.isPrivate,
        }
      }).then(() => {
        toast.success(operationT("update_success"))
        onMetaChange({
          post: {
            id: post.id,
            title: data.title,
            slug: data.slug,
            cover: data.cover,
            category: data.category,
            description: data.description,
            labels: data.labels,
            isPrivate: data.isPrivate,
            type: "html",
          }
        })
        onOpenChange(false)
      }).catch((error: BaseResponseError) => {
        toast.error(operationT("update_failed") + ": " + (error?.response?.data?.message || error.message));
      })
    } else {
      // 创建新文章时，同时创建文章内容
      createPost({
        post: {
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          categoryId: data.category?.id || null,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          isPrivate: data.isPrivate,
          content: `<h1>${data.title}</h1>`,
          type: "html",
        }
      }).then((res) => {
        toast.success(operationT("create_success"))
        onMetaChange({ post: res.data })
        form.reset()
        onOpenChange(false)
      }).catch((error: BaseResponseError) => {
        toast.error(operationT("create_failed") + ": " + (error?.response?.data?.message || error.message))
      })
    }
  }

  const handleCancel = () => {
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {post ? operationT("update") : operationT("create")} {t("post_meta")}
          </DialogTitle>
          {post && <div className="flex justify-between items-center gap-2">
            <div className="font-mono text-sm">
              {commonT("created_at")}: {new Date(post.createdAt).toLocaleString()}
            </div>
            <div className="font-mono text-sm">
              {commonT("updated_at")}: {new Date(post.updatedAt).toLocaleString()}
            </div>
          </div>}
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

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("post_description")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="max-h-4 md:max-h-none" />
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
                  <Button onClick={handleCancel} type="button" variant="outline">{operationT("cancel")}</Button>
                  <Button onClick={() => form.handleSubmit(onSubmit)}>{post ? operationT("update") : operationT("create")}</Button>
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
  {
    category,
    onCategoryChange,
  }:
    {
      category: Category | null,
      onCategoryChange: (category: Category | null) => void,
    }) {
  const t = useTranslations("Console.post_edit")
  const operationT = useTranslations("Operation")
  const [items, setItems] = useState<Category[]>([])
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getCategories().then(res => {
      setItems(res.data.categories)
    }).catch(() => {
    })
  }, [refreshKey])

  return (
    <FormField
      name="category"
      render={() => (
        <FormItem>
          <FormLabel>{t("post_category")}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen}>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={open}
                      className={cn("w-full h-auto py-2 justify-between text-left", !category && "text-muted-foreground")}
                    >
                      {category ? `${category.name} (${category.slug})` : t("select_category")}
                      <ChevronsUpDown className="ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                </div>
                <div className="flex-shrink-0">
                  <CreateOrUpdateCategoryDialogWithButton
                    category={null}
                    buttonSize={"default"}
                    onSaved={() => setRefreshKey((k) => k + 1)}
                  />
                </div>
              </div>
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
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function PostLabelSelector(
  {
    labels,
    onSelectedLabelsChange,
  }: {
    labels: Label[],
    onSelectedLabelsChange: (labels: Label[]) => void,
  }
) {
  const t = useTranslations("Console.post_edit");
  const operationT = useTranslations("Operation");
  const [items, setItems] = useState<Label[]>([]);
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    console.log("refreshing labels...");
    getLabels().then(res => {
      setItems(res?.data?.labels ?? []);
    }).catch(() => {
    });
  }, [refreshKey]);

  const toggle = (label: Label) => {
    const exists = (labels ?? []).find((l) => l.id === label.id);
    if (exists) {
      onSelectedLabelsChange((labels ?? []).filter((l) => l.id !== label.id));
    } else {
      onSelectedLabelsChange([...(labels ?? []), label]);
    }
  };

  const remove = (label: Label, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectedLabelsChange((labels ?? []).filter((l) => l.id !== label.id));
  };

  // 渲染时也使用安全变量
  const safeItems = items ?? [];
  const safeLabels = labels ?? [];

  return (
    <FormField
      name="labels"
      render={() => (
        <FormItem>
          <FormLabel>{t("post_labels")}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen}>
              <div className="">
                {/* 标签列表 */}
                <div className="max-h-18 p-2 rounded-lg border overflow-y-auto overflow-x-hidden">
                  <div className="flex flex-wrap gap-2">
                    {safeLabels.length === 0 ? (
                      <div className="text-muted-foreground">{t("select_labels")}</div>
                    ) : (
                      safeLabels.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className="inline-flex items-center gap-2 px-2 py-0.5 rounded-lg bg-muted text-sm hover:opacity-90"
                          title={l.name}
                        >
                          <span>{l.name}</span>
                          <XIcon onClick={(e) => remove(l, e)} className="w-3 h-3 text-muted-foreground" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
                {/* 标签选择器和创建行 */}
                <div className="flex items-center justify-between mt-2">
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={open}
                      className={cn("w-auto h-auto py-2 justify-between text-left", safeLabels.length === 0 && "text-muted-foreground")}
                    >
                      {t("select_labels")}
                      <ChevronsUpDown className="ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <div>
                    <CreateOrUpdateLabelDialogWithButton
                      buttonSize={"default"}
                      label={null}
                      onLabelCreated={() => setRefreshKey((key) => key + 1)}
                    />
                  </div>
                </div>
              </div>
              <PopoverContent className="w-auto p-0">
                <Command>
                  <CommandInput
                    placeholder={operationT("search")}
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>{t("no_label")}</CommandEmpty>
                    <CommandGroup>
                      {safeItems.map((l) => {
                        return (
                          <CommandItem
                            key={l.id}
                            value={l.name + l.slug}
                            onSelect={() => {
                              toggle(l);
                            }}
                          >
                            {l.name} ({l.slug})
                            <Check className={cn("ml-auto", safeLabels.find((label) => label.id === l.id) ? "opacity-100" : "opacity-0")} />
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
