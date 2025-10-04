"use client";

import { createLabel, updateLabel } from "@/api/label";
import { createCategory, updateCategory } from "@/api/post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Category } from "@/models/category";
import { Label } from "@/models/label";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

export function CreateOrUpdateLabelDialogWithButton({ label, onLabelCreated }: { label: Label | null, onLabelCreated?: (label: Label) => void }) {
  const t = useTranslations("Console.labels");
  const operationT = useTranslations("Operation");
  const [open, setOpen] = useState(false);

  const form = useForm<{ name: string; slug: string; tailwindClassName: string }>({
    mode: "onChange",
    defaultValues: label ?
      { name: label.name, slug: label.slug, tailwindClassName: label.tailwindClassName }
      :
      { name: "", slug: "", tailwindClassName: "" },
  });

  const onSubmit: SubmitHandler<{ name: string; slug: string; tailwindClassName: string }> = (data) => {
    if (data.name.trim() === "" || data.slug.trim() === "") {
      toast.error(t("label_name_and_slug_cannot_be_empty"));
      return;
    }
    if (label) {
      updateLabel({
        label: { id: label.id, name: data.name, slug: data.slug, tailwindClassName: data.tailwindClassName }
      }).then(() => {
        toast.success(operationT("update_success"));
        onLabelCreated?.({
          id: label.id,
          name: data.name,
          slug: data.slug,
          tailwindClassName: data.tailwindClassName,
        });
        setOpen(false);
        form.reset();
      }).catch((error) => {
        toast.error(operationT("update_failed") + (error.response?.data?.message ? `: ${error.response.data.message}` : ""));
      });

    } else {
      createLabel({
        label: { name: data.name, slug: data.slug, tailwindClassName: data.tailwindClassName }
      }).then(res => {
        toast.success(operationT("create_success"));
        onLabelCreated?.({
          id: res.data.id,
          name: data.name,
          slug: data.slug,
          tailwindClassName: data.tailwindClassName,
        });
        setOpen(false);
        form.reset();
      }).catch((error) => {
        toast.error(operationT("create_failed") + (error.response?.data?.message ? `: ${error.response.data.message}` : ""));
      });
    }


  }
  const handleCancel = () => {
    form.reset();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{label ? t("edit_label") : t("create_label")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label ? t("edit_label") : t("create_label")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: { value: true, message: t("label_name_and_slug_cannot_be_empty") },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("label_name")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              rules={{
                required: { value: true, message: t("label_name_and_slug_cannot_be_empty") },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("label_slug")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tailwindClassName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("label_tailwind_class")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <div className="flex gap-2">
                  <Button onClick={handleCancel} variant="outline" type="button">{operationT("cancel")}</Button>
                  <Button disabled={!form.formState.isValid} onClick={() => form.handleSubmit(onSubmit)}>{label ? operationT("update") : operationT("create")}</Button>
                </div>
              </DialogClose>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}


export function CreateOrUpdateCategoryDialogWithButton(
  {
    category, onSaved
  }: {
    category: Category | null,
    onSaved?: (category: Category) => void
  }
) {
  const t = useTranslations("Console.categories");
  const operationT = useTranslations("Operation");
  const [open, setOpen] = useState(false);

  const form = useForm<{ name: string; slug: string; description: string }>({
    mode: "onChange",
    defaultValues: category ?
      { name: category.name, slug: category.slug, description: category.description } :
      { name: "", slug: "", description: "" },
  });

  const onSubmit: SubmitHandler<{ name: string; slug: string; description: string }> = (data) => {
    // 防止只有空格提交（双重保险）
    if (data.name.trim() === "" || data.slug.trim() === "") {
      toast.error(t("category_name_and_slug_cannot_be_empty"));
      return;
    }
    if (category) {
      updateCategory({
        category: { id: category.id, name: data.name.trim(), slug: data.slug.trim(), description: data.description.trim() },
      })
        .then(() => {
          toast.success(operationT("update_success"));
          onSaved?.({
            id: category.id,
            name: data.name.trim(),
            slug: data.slug.trim(),
            description: data.description.trim(),
          });
          setOpen(false);
          form.reset();
        })
        .catch((error) => {
          toast.error(
            operationT("update_failed") +
            (error?.response?.data?.message ? `: ${error.response.data.message}` : "")
          );
        });
    } else {
      createCategory({
        category: { name: data.name.trim(), slug: data.slug.trim(), description: data.description.trim() },
      })
        .then((res) => {
          toast.success(operationT("create_success"));
          onSaved?.({
            id: res.data.id,
            name: data.name.trim(),
            slug: data.slug.trim(),
            description: data.description.trim(),
          });
          setOpen(false);
          form.reset();
        })
        .catch((error) => {
          toast.error(
            operationT("create_failed") +
            (error?.response?.data?.message ? `: ${error.response.data.message}` : "")
          );
        });
    }


  };

  const handleCancel = () => {
    form.reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{category ? t("edit_category") : t("create_category")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? t("edit_category") : t("create_category")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: { value: true, message: t("category_name_and_slug_cannot_be_empty") },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("category_name")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              rules={{
                required: { value: true, message: t("category_name_and_slug_cannot_be_empty") },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("category_slug")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("category_description")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <div className="flex gap-2">
                  <Button onClick={handleCancel} variant="outline" type="button">{operationT("cancel")}</Button>
                  <Button disabled={!form.formState.isValid} onClick={() => form.handleSubmit(onSubmit)}>{category ? operationT("update") : operationT("create")}</Button>
                </div>
              </DialogClose>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}