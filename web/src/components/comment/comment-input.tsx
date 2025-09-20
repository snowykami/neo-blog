import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CircleUser } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFirstCharFromUser } from "@/utils/common/username";
import { useAuth } from "@/contexts/auth-context";


export function CommentInput(
  {
    onCommentSubmitted,
    initContent = "",
    initIsPrivate = false,
    placeholder = "",
    isUpdate = false,
    initShowClientInfo = true
  }: {
    onCommentSubmitted: ({ commentContent, isPrivate, showClientInfo }: { commentContent: string, isPrivate: boolean, showClientInfo: boolean }) => void,
    initContent?: string,
    initIsPrivate?: boolean,
    placeholder?: string,
    isUpdate?: boolean,
    initShowClientInfo?: boolean
  }
) {
  const {user} = useAuth();
  const t = useTranslations('Comment')
  const commonT = useTranslations('Common')
  const clickToLogin = useToLogin()
  const clickToUserProfile = useToUserProfile();

  const [isPrivate, setIsPrivate] = useState(initIsPrivate);
  const [showClientInfo, setShowClientInfo] = useState(initShowClientInfo);
  const [commentContent, setCommentContent] = useState(initContent);

  const handleCommentSubmit = async () => {
    if (!user) {
      // 通知
      toast.error(t("login_required"), {
        action: {
          label: commonT("login"),
          onClick: clickToLogin,
        },
      })
      return;
    }
    if (!commentContent.trim()) {
      toast.error(t("content_required"));
      return;
    }
    if (initContent === commentContent.trim() && initIsPrivate === isPrivate && initShowClientInfo === showClientInfo) {
      toast.warning(t("comment_unchanged"));
      return;
    }
    onCommentSubmitted({ commentContent, isPrivate, showClientInfo });
    setCommentContent("");
  };

  return (
    <div className="fade-in-up">
      <div className="flex py-4 fade-in">
        <div onClick={user ? () => clickToUserProfile(user.username) : clickToLogin} className="cursor-pointer flex-shrink-0 w-10 h-10 fade-in">
          {user && <Avatar className="h-full w-full rounded-full">
            <AvatarImage src={getGravatarFromUser({ user, size: 120 })} alt={user.nickname} />
            <AvatarFallback className="rounded-full">{getFirstCharFromUser(user)}</AvatarFallback>
          </Avatar>}
          {!user && <CircleUser className="w-full h-full fade-in" />}
        </div>
        <div className="flex-1 pl-2 fade-in-up">
          <Textarea
            placeholder={placeholder || (user ? (isPrivate ? t("private_placeholder") : t("placeholder")) : t("login_required", { loginButton: "登录" }))}
            className="w-full p-2 border border-gray-300 rounded-md fade-in-up"
            value={commentContent}
            onChange={(e) => setCommentContent(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end fade-in-up space-x-4 items-center">
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={showClientInfo}
            onCheckedChange={checked => setShowClientInfo(checked === true)}
          />
          <Label onClick={() => setShowClientInfo(prev => !prev)}>{t("show_client_info")}</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={isPrivate}
            onCheckedChange={checked => setIsPrivate(checked === true)}
          />
          <Label onClick={() => setIsPrivate(prev => !prev)}>{t("private")}</Label>
        </div>
        <button onClick={handleCommentSubmit} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors fade-in-up">
          {isUpdate ? t("update") : t("submit")}
        </button>
      </div>
    </div>
  );
}