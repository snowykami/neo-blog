"use client"
import { getLikedUsers, toggleLike } from "@/api/like";
import { useAuth } from "@/contexts/auth-context";
import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { Post } from "@/models/post";
import { TargetType } from "@/models/types";
import { User } from "@/models/user";
import { HeartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFirstCharFromUser } from "@/utils/common/username";

const MAX_LIKED_USERS = 5;

export function BlogLikeButton({
  post
}: { post: Post }) {
  const commonT = useTranslations("Common");
  const operationT = useTranslations("Operation");
  const clickToUserProfile = useToUserProfile();
  const { user } = useAuth();
  const clickToLogin = useToLogin();
  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [likedUsers, setLikedUsers] = useState<User[]>([]);
  const [canClickLike, setCanClickLike] = useState(true);

  useEffect(() => {
    getLikedUsers({ targetType: TargetType.Post, targetId: post.id, number: 5 }).then(res => {
      setLikedUsers(res.data.users?.slice(0, MAX_LIKED_USERS) || []);
    }).catch(() => {
      setLikedUsers([]);
    });
  }, [post.isLiked, post.likeCount]);


  const handleToggleLike = () => {
    if (!canClickLike) {
      return;
    }
    setCanClickLike(false);
    if (!user) {
      toast.error(commonT("login_required"), {
        action: {
          label: operationT("login"),
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
          className={`rounded-full border-2 ${liked ? "bg-red-500" : "border-gray-300"} w-16 h-16 flex items-center justify-center cursor-pointer select-none`}>
          <HeartIcon className={`w-8 h-8 inline-block ${liked ? "text-red-500 fill-white" : "text-gray-400"}`} />
        </div>
      </div>
      <div className="text-lg py-4 text-gray-500 flex justify-center">{operationT("n_users_liked", { n: likeCount })}</div>
      {likedUsers.length > 0 && <div className="flex justify-center gap-2">
        {likedUsers.map(u => (
          <Avatar onClick={() => clickToUserProfile(u.username)} className="h-8 w-8 rounded-full border-2" key={u.id}>
            <AvatarImage src={getGravatarFromUser({ user: u, size: 60 })} alt={u.nickname} />
            <AvatarFallback className="rounded-full">{getFirstCharFromUser(u)}</AvatarFallback>
          </Avatar>
        ))}
      </div>}
    </div>
  );
}