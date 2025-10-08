import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Post } from "@/models/post";
import { getPostUrl } from "@/utils/common/route";
import { useTranslations } from "next-intl";
// iframe 草稿预览器
export function PostPreviewDialogWithButton({ post, onPreview }: { post: Post, onPreview: () => void }) {
  const operationT = useTranslations("Operation");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={onPreview}>{operationT("preview")}</Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] !max-w-none h-[90vh] p-0 border-0">
        <DialogTitle className="sr-only">{operationT("preview")}</DialogTitle>
        <iframe
          src={getPostUrl({ post, type: 'draft' })}
          className="w-full h-full border-2 rounded-lg"
        />
      </DialogContent>
    </Dialog>
  );
}