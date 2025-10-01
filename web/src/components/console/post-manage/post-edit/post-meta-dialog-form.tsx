"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Category } from "@/models/category"
import { Post } from "@/models/post"
import { useTranslations } from "next-intl"
import { SubmitHandler, useForm } from "react-hook-form"

interface PostMetaForm {
  title: string
  description: string
  slug: string
  cover: string
  category: Category | null
  labels: number[]
  isOrigin: boolean
  isPrivate: boolean
}


export function PostSettingButtonWithDialog({ post, onMetaChange }: { post: Post, onMetaChange?: (meta: Partial<Post>) => void }) {
  const operationT = useTranslations("Operation")
  const t = useTranslations("Console.post_edit")
  const form = useForm<PostMetaForm>({
    defaultValues: {
      title: post.title,
      description: post.description,
      slug: post.slug || "",
      cover: post.cover || "",
      category: post.category,
      labels: post.labels ? post.labels.map(label => label.id) : [],
      isOrigin: post.isOriginal,
      isPrivate: post.isPrivate,
    }
  })

  const onSubmit: SubmitHandler<PostMetaForm> = data => {
    console.log(data)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">{operationT("setting")}</Button>
      </DialogTrigger>
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("post_description")}</FormLabel>
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
          </form>
        </Form>

      </DialogContent>
    </Dialog>
  )
}