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
import { deleteFile, listFiles } from "@/api/file";
import { BaseErrorResponse } from "@/models/resp";
import { formatDataSize } from "@/utils/common/datasize";
import { getFileUri } from "@/utils/client/file";
import { Checkbox } from "@/components/ui/checkbox"
import { ArrangementSelector } from "@/components/common/arrangement-selector";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
    {files.map(file => <div key={file.id}>
      <FileItem file={file} onFileDelete={onFileDelete} selected={selectedFileIds.has(file.id)} onSelect={onFileIdSelect(file.id)} />
      <Separator className="flex-1" />
    </div>)}
    <div className="flex justify-center items-center py-4">
      {total > 0 && <PaginationController initialPage={page} onPageChange={onPageChange} total={total} pageSize={size} />}
      <PageSizeSelector initialSize={size} onSizeChange={(s) => { setSize(s); setPage(1); }} /> {metricsT("per_page")}
    </div>
  </div>;
}



function FileItem({
  file,
  onFileDelete,
  selected,
  onSelect,
}: {
  file: FileModel,
  onFileDelete: ({ fileId }: { fileId: number }) => void
  selected: boolean,
  onSelect: (selected: boolean) => void
}) {
  const commonT = useTranslations("Common");
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-2">
        {/* left */}
        <div className="flex items-center gap-3">
          <Checkbox checked={selected} onCheckedChange={onSelect} />
          <Avatar className="h-8 w-8 rounded-sm">
            <AvatarImage src={getFileUri(file.id)} alt={file.name} width={40} height={40} />
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
              <span className="text-xs text-muted-foreground">{commonT("size")}: {formatDataSize({ size: file.size })}</span>
              <span className="text-xs text-muted-foreground">{commonT("mime_type")}: {file.mimeType}</span>
              <span className="text-xs text-muted-foreground">{commonT("id")}: {file.id}</span>
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