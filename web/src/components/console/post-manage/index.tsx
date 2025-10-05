"use client";
import { deletePost, listPosts, updatePost } from "@/api/post";
import { OrderSelector } from "@/components/common/orderby-selector";
import { PageSizeSelector, PaginationController } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useDevice } from "@/contexts/device-context";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";
import { useToEditPost, useToPost } from "@/hooks/use-route";
import { OrderBy } from "@/models/common";
import { Post } from "@/models/post"
import { DropdownMenuGroup } from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import Image from "next/image";
import {
  useQueryState,
  parseAsInteger,
  parseAsBoolean,
  parseAsStringEnum,
  parseAsString
} from "nuqs";
import { useDebouncedState } from "@/hooks/use-debounce";
import { Badge } from "@/components/ui/badge";
import { CreateOrUpdatePostMetaButtonWithDialog } from "./post-meta-dialog-form";
import { useSiteInfo } from "@/contexts/site-info-context";

const PAGE_SIZE = 15;
const MOBILE_PAGE_SIZE = 10;

export function PostManage() {
  const t = useTranslations("Console.post_edit");
  const commonT = useTranslations("Common");
  const metricsT = useTranslations("Metrics");
  const { isMobile } = useDevice();
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [orderBy, setOrderBy] = useQueryState("order_by", parseAsStringEnum<OrderBy>(Object.values(OrderBy)).withDefault(OrderBy.CreatedAt).withOptions({ history: "replace", clearOnDefault: true }));
  const [desc, setDesc] = useQueryState("desc", parseAsBoolean.withDefault(true).withOptions({ history: "replace", clearOnDefault: true }));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1).withOptions({ history: "replace", clearOnDefault: true }));
  const [size, setSize] = useQueryState("size", parseAsInteger.withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE).withOptions({ history: "replace", clearOnDefault: true }));
  const [keywords, setKeywords] = useQueryState("keywords", parseAsString.withDefault("").withOptions({ history: "replace", clearOnDefault: true }));
  const [keywordsInput, setKeywordsInput, debouncedKeywordsInput] = useDebouncedState(keywords, 200);
  const [createPostDialogOpen, setCreatePostDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // 用于强制刷新列表

  useEffect(() => {
    listPosts({ page, size, orderBy, desc, keywords }).
      then(res => {
        setPosts(res.data.posts);
        setTotal(res.data.total);
      });
  }, [page, orderBy, desc, size, keywords, refreshKey]);

  useEffect(() => {
    setKeywords(debouncedKeywordsInput)
  }, [debouncedKeywordsInput, setKeywords, keywords])

  const onPostCreate = useCallback(({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => {
    setRefreshKey((k) => k + 1);
  }, []);

  const onPostUpdate = useCallback(({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, ...post } : p)));
  }, [setPosts]);

  const onPostDelete = useCallback(({ postId }: { postId: number }) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, [setPosts]);

  const onOrderChange = useCallback(({ orderBy, desc }: { orderBy: OrderBy; desc: boolean }) => {
    setOrderBy(orderBy);
    setDesc(desc);
    setPage(1);
  }, [setOrderBy, setDesc, setPage]);

  const onPageChange = useCallback((p: number) => {
    setPage(p);
  }, [setPage]);

  return <div>
    <div className="flex items-center justify-between mb-4 flex-wrap">
      <div>
        <Input type="search" placeholder={commonT("search")} value={keywordsInput} onChange={(e) => setKeywordsInput(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {<OrderSelector initialOrder={{ orderBy, desc }} onOrderChange={onOrderChange} />}
          <Button size="sm" onClick={() => setCreatePostDialogOpen(true)}>{t("create_post")}</Button>
          <CreateOrUpdatePostMetaButtonWithDialog
            open={createPostDialogOpen}
            onOpenChange={setCreatePostDialogOpen}
            post={null}
            onMetaChange={onPostCreate}
          />
        </div>
      </div>
    </div>
    <Separator className="flex-1" />
    {posts.map(post => <div key={post.id}>
      <PostItem post={post} onPostUpdate={onPostUpdate} onPostDelete={onPostDelete} />
      <Separator className="flex-1" />
    </div>)}
    <div className="flex justify-center items-center py-4">
      {total > 0 && <PaginationController initialPage={page} onPageChange={onPageChange} total={total} pageSize={size} />}
      <PageSizeSelector initialSize={size} onSizeChange={(s) => { setSize(s); setPage(1); }} /> {metricsT("per_page")}
    </div>
  </div>;
}

function PostItem({ post, onPostUpdate, onPostDelete }: { post: Post, onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => void, onPostDelete: ({ postId }: { postId: number }) => void }) {
  const commonT = useTranslations("Common");
  const postT = useTranslations("Metrics");
  const stateT = useTranslations("State");
  const { siteInfo } = useSiteInfo();
  const clickToPost = useToPost();
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-3">
        {/* left */}
        <div className="flex justify-start items-center gap-4">
          {/* avatar */}
          <Image
            src={post.cover || siteInfo.defaultCover || "/default-post-cover.png"}
            alt={post.title}
            width={80}
            height={80}
            className="w-16 h-10 object-cover rounded-md mb-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {post.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {(() => {
                const items: { value: string; className: string }[] = [
                  {
                    value: stateT(post.isPrivate ? "private" : "public"),
                    className: post.isPrivate ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"
                  },
                  { value: `${postT("view_count")}: ${post.viewCount}`, className: "bg-slate-100 text-slate-800" },
                  { value: `${postT("like_count")}: ${post.likeCount}`, className: "bg-slate-100 text-slate-800" },
                  { value: `${postT("comment_count")}: ${post.commentCount}`, className: "bg-slate-100 text-slate-800" },
                  { value: `${commonT("id")}: ${post.id}`, className: "bg-indigo-100 text-indigo-800" },
                  { value: `${commonT("created_at")}: ${new Date(post.createdAt).toLocaleDateString()}`, className: "bg-gray-100 text-gray-800" },
                  { value: `${commonT("updated_at")}: ${new Date(post.updatedAt).toLocaleDateString()}`, className: "bg-gray-100 text-gray-800" }
                ];

                return items.map((item, idx) => (
                  <Badge key={idx} className={`text-xs ${item.className}`} variant="secondary">
                    {item.value}
                  </Badge>
                ));
              })()}
            </div>
          </div>

        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button variant="ghost" size="sm" onClick={() => clickToPost({ post })}>
            <Eye className="inline size-4 mr-1" />
          </Button>
          <PostDropdownMenu
            post={post}
            onPostUpdate={onPostUpdate}
            onPostDelete={onPostDelete}
            metaDialogOpen={metaDialogOpen}
            setMetaDialogOpen={setMetaDialogOpen}
          />
          <CreateOrUpdatePostMetaButtonWithDialog
            post={post}
            onMetaChange={onPostUpdate}
            open={metaDialogOpen}
            onOpenChange={setMetaDialogOpen}
          />
        </div>
      </div>
    </div>
  )
}

function PostDropdownMenu(
  {
    post,
    onPostUpdate,
    onPostDelete,
    metaDialogOpen,
    setMetaDialogOpen
  }: {
    post: Post,
    onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => void,
    onPostDelete: ({ postId }: { postId: number }) => void,
    metaDialogOpen: boolean,
    setMetaDialogOpen: (open: boolean) => void
  }
) {
  const operationT = useTranslations("Operation");
  const clickToPostEdit = useToEditPost();
  const clickToPost = useToPost();
  const { confirming: confirmingDelete, onClick: onDeleteClick, onBlur: onDeleteBlur } = useDoubleConfirm();
  const [open, setOpen] = useState(false);
  const handleTogglePrivate = () => {
    updatePost({ post: { ...post, isPrivate: !post.isPrivate } })
      .then(() => {
        toast.success(operationT("update_success"));
        onPostUpdate({ post: { id: post.id, isPrivate: !post.isPrivate } });
      })
      .catch(() => {
        toast.error(operationT("update_failed"));
      });
  }

  const handleDelete = () => {
    deletePost({ id: post.id })
      .then(() => {
        toast.success(operationT("delete_success"));
        onPostDelete({ postId: post.id });
      })
      .catch(() => {
        toast.error(operationT("delete_failed"));
      });
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onDeleteBlur();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <Ellipsis className="w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-4" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => clickToPostEdit({ post })} className="cursor-pointer" >
            {operationT("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMetaDialogOpen(true)} className="cursor-pointer" >
            {operationT("setting")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => clickToPost({ post })} className="cursor-pointer" >
            {operationT("view")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handleTogglePrivate} className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer">
            {operationT(post.isPrivate ? "set_public" : "set_private")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              if (!confirmingDelete) {
                e.preventDefault();
                onDeleteClick(() => handleDelete());
              } else {
                onDeleteClick(() => handleDelete());
              }
            }}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer">
            {confirmingDelete ? operationT("confirm_delete") : operationT("delete")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}