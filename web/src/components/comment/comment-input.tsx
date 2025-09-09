import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { User } from "@/models/user";
import { useTranslations } from "next-intl";
import { useState } from "react";
import NeedLogin from "@/components/common/need-login";
import { toast } from "sonner";
import { getGravatarByUser } from "@/components/common/gravatar";
import { CircleUser } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label";


export function CommentInput(
  {
    user,
    onCommentSubmitted,
    initContent = "",
    initIsPrivate = false,
    isUpdate = false
  }: {
    user: User | null,
    onCommentSubmitted: ({ commentContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => void,
    initContent?: string,
    initIsPrivate?: boolean,
    isUpdate?: boolean,
  }
) {
  const t = useTranslations('Comment')
  const commonT = useTranslations('Common')
  const clickToLogin = useToLogin()
  const clickToUserProfile = useToUserProfile();

  const [isPrivate, setIsPrivate] = useState(initIsPrivate);
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
    onCommentSubmitted({ commentContent, isPrivate });
    setCommentContent("");
  };

  return (
    <div className="fade-in-up">
      <div className="flex py-4 fade-in">
        <div onClick={user ? () => clickToUserProfile(user.username) : clickToLogin} className="flex-shrink-0 w-10 h-10 fade-in">
          {user ? getGravatarByUser(user) : null}
          {!user && <CircleUser className="w-full h-full fade-in" />}
        </div>
        <div className="flex-1 pl-2 fade-in-up">
          <Textarea
            placeholder={user ? t("placeholder") : t("login_required", { loginButton: "登录" })}
            className="w-full p-2 border border-gray-300 rounded-md fade-in-up"
            value={commentContent}
            onChange={(e) => setCommentContent(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end fade-in-up space-x-4 items-center">
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={isPrivate}
            onCheckedChange={checked => setIsPrivate(checked === true)}
          />
          <Label>{t("private")}</Label>
        </div>

        <button onClick={handleCommentSubmit} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors fade-in-up">
          {isUpdate ? t("update") : t("submit")}
        </button>
      </div>
    </div>
  );
}