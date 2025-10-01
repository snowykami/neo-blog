"use client";
import { OrderSelector } from "@/components/common/orderby-selector";
import { PageSizeSelector, PaginationController } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useDevice } from "@/contexts/device-context";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";
import { ArrangementMode, OrderBy } from "@/models/common";
import { DropdownMenuGroup } from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Eye, FileIcon, FilePlayIcon, ImageIcon, Link, MusicIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import mime from 'mime-types';
import { toast } from "sonner";
import {
  useQueryState,
  parseAsInteger,
  parseAsBoolean,
  parseAsStringEnum,
  parseAsString
} from "nuqs";
import { useDebouncedState } from "@/hooks/use-debounce";
import { batchDeleteFiles, deleteFile, listFiles } from "@/api/file";
import { BaseErrorResponse } from "@/models/resp";
import { formatDataSize } from "@/utils/common/datasize";
import { getFileUri } from "@/utils/client/file";
import { Checkbox } from "@/components/ui/checkbox"
import { ArrangementSelector } from "@/components/common/arrangement-selector";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogClose, DialogFooter, DialogHeader, DialogTitle, DialogContent, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

const PAGE_SIZE = 15;
const MOBILE_PAGE_SIZE = 10;

const mimeTypeIcons = {
  "image": ImageIcon,
  "audio": MusicIcon,
  "video": FilePlayIcon,
}

export function FileManage() {
  const commonT = useTranslations("Common");
  const metricsT = useTranslations("Metrics");
  const operationT = useTranslations("Operation");
  const { isMobile } = useDevice();
  const [files, setFiles] = useState<FileModel[]>([]);
  const [total, setTotal] = useState(0);
  const [arrangement, setArrangement] = useQueryState("arrangement", parseAsStringEnum<ArrangementMode>(Object.values(ArrangementMode)).withDefault(ArrangementMode.List).withOptions({ history: "replace", clearOnDefault: true }));
  const [orderBy, setOrderBy] = useQueryState("order_by", parseAsStringEnum<OrderBy>(Object.values(OrderBy)).withDefault(OrderBy.CreatedAt).withOptions({ history: "replace", clearOnDefault: true }));
  const [desc, setDesc] = useQueryState("desc", parseAsBoolean.withDefault(true).withOptions({ history: "replace", clearOnDefault: true }));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1).withOptions({ history: "replace", clearOnDefault: true }));
  const [size, setSize] = useQueryState("size", parseAsInteger.withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE).withOptions({ history: "replace", clearOnDefault: true }));
  const [keywords, setKeywords] = useQueryState("keywords", parseAsString.withDefault("").withOptions({ history: "replace", clearOnDefault: true }));
  const [keywordsInput, setKeywordsInput, debouncedKeywordsInput] = useDebouncedState(keywords, 200);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    listFiles({ page, size, orderBy, desc, keywords }).
      then(res => {
        setFiles(res.data.files);
        setTotal(res.data.total);
      });
  }, [page, orderBy, desc, size, keywords]);

  useEffect(() => {
    setKeywords(debouncedKeywordsInput)
  }, [debouncedKeywordsInput, setKeywords, keywords])

  const onFileDelete = useCallback(({ fileId }: { fileId: number }) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, [setFiles]);

  const onOrderChange = useCallback(({ orderBy, desc }: { orderBy: OrderBy; desc: boolean }) => {
    setOrderBy(orderBy);
    setDesc(desc);
    setPage(1);
  }, [setOrderBy, setDesc, setPage]);

  const onPageChange = useCallback((p: number) => {
    setPage(p);
  }, [setPage]);

  const onFileIdSelect = useCallback((fileId: number) => {
    return (selected: boolean) => {
      setSelectedFileIds((prev) => {
        const newSet = new Set(prev);
        if (selected) {
          newSet.add(fileId);
        } else {
          newSet.delete(fileId);
        }
        return newSet;
      });
    }
  }, [setSelectedFileIds]);

  const onAllFileSelect = useCallback((selected: boolean) => {
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        files.forEach(file => newSet.add(file.id));
      } else {
        files.forEach(file => newSet.delete(file.id));
      }
      return newSet;
    });
  }, [files]);

  return <div>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <Checkbox checked={selectedFileIds.size === files.length} onCheckedChange={onAllFileSelect} />
        <BatchDeleteDialogWithButton ids={Array.from(selectedFileIds)} onFileDelete={onFileDelete} />
        <Input type="search" placeholder={commonT("search")} value={keywordsInput} onChange={(e) => setKeywordsInput(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ArrangementSelector initialArrangement={arrangement} onArrangementChange={setArrangement} />
          <OrderSelector
            initialOrder={{ orderBy, desc }}
            onOrderChange={onOrderChange}
            orderBys={[OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.Name, OrderBy.Size]}
          />
        </div>
      </div>
    </div>
    <Separator className="flex-1" />
    {/* 列表 */}
    {arrangement === ArrangementMode.List && files.map(file => <div key={file.id}>
      <FileItem file={file} layout={ArrangementMode.List} onFileDelete={onFileDelete} selected={selectedFileIds.has(file.id)} onSelect={onFileIdSelect(file.id)} />
      <Separator className="flex-1" />
    </div>)}
    {/* 网格 */}
    {arrangement === ArrangementMode.Grid && <div className={`grid gap-4 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
      {files.map(file => <FileItem key={file.id} file={file} layout={ArrangementMode.Grid} onFileDelete={onFileDelete} selected={selectedFileIds.has(file.id)} onSelect={onFileIdSelect(file.id)} />)}
    </div>}
    {/* 分页 */}
    <div className="flex justify-center items-center py-4">
      {total > 0 && <PaginationController initialPage={page} onPageChange={onPageChange} total={total} pageSize={size} />}
      <PageSizeSelector initialSize={size} onSizeChange={(s) => { setSize(s); setPage(1); }} /> {metricsT("per_page")}
    </div>
  </div>;
}

function FileItem({
  file,
  layout,
  onFileDelete,
  selected,
  onSelect,
}: {
  file: FileModel,
  layout: ArrangementMode,
  onFileDelete: ({ fileId }: { fileId: number }) => void
  selected: boolean,
  onSelect: (selected: boolean) => void
}) {
  const commonT = useTranslations("Common");
  if (layout === ArrangementMode.Grid) {
    return (
      <div className="relative group">
        <div className="flex flex-col items-center p-4 border rounded-lg hover:bg-accent/50 transition-colors">
          {/* 选择框 */}
          <div className="absolute top-2 left-2">
            <Checkbox checked={selected} onCheckedChange={onSelect} />
          </div>

          {/* 文件预览/图标 */}
          <div className="mb-3">
            <Avatar className="h-40 w-40 rounded-none">
              <AvatarImage className="object-contain" src={getFileUri(file.id)} alt={file.name} />
              <AvatarFallback>
                {(() => {
                  const mimeType = file.mimeType || mime.lookup(file.name) || "";
                  const IconComponent = mimeTypeIcons[mimeType.split("/")[0] as keyof typeof mimeTypeIcons];
                  return IconComponent ? <IconComponent className="w-8 h-8" /> : <FileIcon className="w-8 h-8" />;
                })()}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* 文件信息 */}
          <div className="text-center w-full">
            <div className="text-sm font-medium truncate mb-1" title={file.name}>
              {file.name}
            </div>
            <div className="flex flex-wrap justify-center items-center gap-2">
              <span className="text-xs text-muted-foreground">{commonT("id")}: {file.id}</span>
              <span className="text-xs text-muted-foreground">{formatDataSize({ size: file.size })}</span>

            </div>
          </div>

          {/* 操作按钮 - 悬停时显示 */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => window.open(getFileUri(file.id) + `/${file.name}`, "_blank")}
              >
                <Link className="w-3 h-3" />
              </Button>
              <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex w-full items-center gap-3 py-2">
        {/* left */}
        <div className="flex items-center gap-3">
          <Checkbox checked={selected} onCheckedChange={onSelect} />
          <Avatar className="h-10 w-10 rounded-none">
            <AvatarImage className="object-contain" src={getFileUri(file.id)} alt={file.name} width={40} height={40} />
            <AvatarFallback>
              {(() => {
                const mimeType = file.mimeType || mime.lookup(file.name) || "";
                const IconComponent = mimeTypeIcons[mimeType.split("/")[0] as keyof typeof mimeTypeIcons];
                return IconComponent ? <IconComponent className="w-4 h-4" /> : <FileIcon className="w-4 h-4" />;
              })()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm font-medium">
              {file.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">{commonT("id")}: {file.id}</span>
              <span className="text-xs text-muted-foreground">{commonT("size")}: {formatDataSize({ size: file.size })}</span>
              <span className="text-xs text-muted-foreground">{commonT("mime_type")}: {file.mimeType}</span>
              <span className="text-xs text-muted-foreground">{commonT("created_at")}: {new Date(file.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button variant="ghost" size="sm" onClick={() => window.open(getFileUri(file.id) + `/${file.name}`, "_blank")}>
            <Link className="inline size-4 mr-1" />
          </Button>
          <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
        </div>
      </div>
    </div>
  )
}

function FileDropdownMenu(
  {
    file,
    onFileDelete
  }: {
    file: FileModel,
    onFileDelete: ({ fileId }: { fileId: number }) => void
  }
) {
  const operationT = useTranslations("Operation");
  const { confirming: confirmingDelete, onClick: onDeleteClick, onBlur: onDeleteBlur } = useDoubleConfirm();
  const [open, setOpen] = useState(false);

  const handleDelete = () => {
    deleteFile({ id: file.id })
      .then(() => {
        toast.success(operationT("delete_success"));
        onFileDelete({ fileId: file.id });
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(operationT("delete_failed") + ": " + error.message);
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
          <DropdownMenuItem onClick={() => { }} className="cursor-pointer" >
            {operationT("view")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
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

function BatchDeleteDialogWithButton({ ids, onFileDelete }: { ids: number[], onFileDelete: ({ fileId }: { fileId: number }) => void }) {
  const t = useTranslations("Console.files");
  const operationT = useTranslations("Operation");

  const handleBatchDelete = () => {
    batchDeleteFiles({ ids })
      .then(() => {
        toast.success(operationT("delete_success"));
        ids.forEach(id => onFileDelete({ fileId: id }));
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(operationT("delete_failed") + ": " + error.message);
      });
  }

  return (
    <Dialog>
      <form>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={ids.length === 0}>
            {operationT("batch_delete")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{operationT("batch_delete")}</DialogTitle>
            <DialogDescription>
              {t("will_delete_n_files", { n: ids.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">
                {operationT("cancel")}
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button onClick={handleBatchDelete} type="button" variant="destructive">
                {operationT("confirm_delete")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </form>
    </Dialog>
  )
}