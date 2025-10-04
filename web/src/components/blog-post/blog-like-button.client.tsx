"use client"
import { toggleLike } from "@/api/like";
import { useAuth } from "@/contexts/auth-context";
import { useToLogin } from "@/hooks/use-route";
import { Post } from "@/models/post";
import { TargetType } from "@/models/types";
import { HeartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export function BlogLikeButton({
  post
}: { post: Post }) {
  const commonT = useTranslations("Common");
  const operationT = useTranslations("Operation");
  const { user } = useAuth();
  const clickToLogin = useToLogin();
  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [canClickLike, setCanClickLike] = useState(true);

  const handleToggleLike = () => {
    if (!canClickLike) {
      return;
    }
    setCanClickLike(false);
    if (!user) {
      toast.error(commonT("login_required"), {
        action: {
          label: commonT("login"),
          onClick: clickToLogin,
        },
      })
      return;
    }
    // 提前转换状态，让用户觉得响应很快
    const likedPrev = liked;
    const likeCountPrev = likeCount;
    setLiked(prev => !prev);
    setLikeCount(prev => prev + (likedPrev ? -1 : 1));
    toggleLike(
      { targetType: TargetType.Post, targetId: post.id }
    ).then(res => {
      toast.success(res.data.status ? operationT("like_success") : operationT("unlike_success"));
      setCanClickLike(true);
    }).catch(error => {
      toast.error(operationT("like_failed") + ": " + error.message);
      setLiked(likedPrev);
      setLikeCount(likeCountPrev);
      setCanClickLike(true);
    });
  }

  return (
    <div>
      <div className="flex justify-center pt-6">
        <div
          onClick={handleToggleLike}
          className={`rounded-full border-2 ${liked ? "border-red-500" : "border-gray-300"} w-16 h-16 flex items-center justify-center cursor-pointer select-none`}>
          <HeartIcon className={`w-8 h-8 inline-block ${liked ? "text-red-500" : "text-gray-400"}`} />
        </div>
      </div>
      <div className="text-lg text-gray-500 flex justify-center">{likeCount}</div>
    </div>
  );
}