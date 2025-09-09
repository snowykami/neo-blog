"use client"

import { clickToUserprofile, useToLogin } from "@/hooks/use-route";
import { User } from "@/models/user";
import { useTranslations } from "next-intl";
import { Suspense, use, useEffect, useState } from "react";
import NeedLogin from "../common/need-login";
import { toast } from "sonner";
import { getGravatarByUser } from "../common/gravatar";
import { CircleUser, Reply, Trash } from "lucide-react";
import { Textarea } from "../ui/textarea";
import { Comment } from "@/models/comment";
import { createComment, deleteComment, listComments } from "@/api/comment";
import { TargetType } from "@/models/types";
import { OrderBy } from "@/models/common";
import { Separator } from "../ui/separator";
import { getLoginUser } from "@/api/user";
import { Skeleton } from "../ui/skeleton";
import { toggleLike } from "@/api/like";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";

import "./style.css";

const DEFAULT_PAGE_SIZE = 20;

export function CommentSection(
  {
    targetType,
    targetId
  }: {
    targetType: TargetType,
    targetId: number
  }
) {
  const t = useTranslations('Comment')

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [refreshCommentsKey, setRefreshCommentsKey] = useState(0);

  // 获取当前登录用户
  useEffect(() => {
    getLoginUser()
      .then(response => {
        setCurrentUser(response.data);
      })
  }, [])

  // 加载0/顶层评论
  useEffect(() => {
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy: OrderBy.CreatedAt,
      desc: true,
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      commentId: 0
    }).then(response => {
      setComments(response.data);
    });
  }, [refreshCommentsKey])

  const onCommentSubmitted = (commentContent: string) => {
    createComment({
      targetType,
      targetId,
      content: commentContent,
      replyId: null,
      isPrivate: false
    }).then(() => {
      toast.success(t("comment_success"));
      setRefreshCommentsKey(k => k + 1);
    })
  }

  const onCommentDelete = (commentId: number) => {
    deleteComment(commentId).then(() => {
      toast.success(t("delete_success"));
      setRefreshCommentsKey(k => k + 1);
    }).catch(error => {
      toast.error(t("delete_failed") + ": " + error.message);
    });
  }

  return (
    <div>
      <Separator className="my-16" />
      <div className="font-bold text-2xl">{t("comment")}</div>
      <CommentInput
        user={currentUser}
        onCommentSubmitted={onCommentSubmitted}
      />
      <div className="mt-4">
        <Suspense fallback={<CommentLoading />}>
          {comments.map((comment, idx) => (
            <div key={comment.id} className="fade-in-up" style={{ animationDelay: `${idx * 60}ms` }}>
              <Separator className="my-2" />
              <CommentItem
                user={currentUser}
                comment={comment}
                parentComment={null}
                onCommentDelete={onCommentDelete}
              />
            </div>
          ))}
        </Suspense>
      </div>
    </div>
  )
}

export function CommentInput(
  { user, onCommentSubmitted, }: { user: User | null, onCommentSubmitted: (commentContent: string) => void }
) {
  const t = useTranslations('Comment')
  const handleToLogin = useToLogin()

  const [commentContent, setCommentContent] = useState("");

  const handleCommentSubmit = async () => {
    if (!user) {
      toast.error(<NeedLogin>{t("login_required")}</NeedLogin>);
      return;
    }
    if (!commentContent.trim()) {
      toast.error(t("content_required"));
      return;
    }
    onCommentSubmitted(commentContent);
    setCommentContent("");
  };

  return (
    <div className="fade-in-up">
      <div className="flex py-4 fade-in">
        <div onClick={user ? clickToUserprofile(user.username) : handleToLogin} className="flex-shrink-0 w-10 h-10 fade-in">
          {user && getGravatarByUser(user)}
          {!user && <CircleUser className="w-full h-full fade-in" />}
        </div>
        <div className="flex-1 pl-2 fade-in-up">
          <Textarea
            placeholder={t("placeholder")}
            className="w-full p-2 border border-gray-300 rounded-md fade-in-up"
            value={commentContent}
            onChange={(e) => setCommentContent(e.target.value)}
          />
        </div>
      </div>
      {commentContent.trim() && (
        <div className="flex justify-end fade-in-up">
          <button onClick={handleCommentSubmit} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors fade-in-up">
            {t("submit")}
          </button>
        </div>
      )}
    </div>
  );
}

export function CommentItem(
  {
    user,
    comment,
    parentComment,
    onCommentDelete,
  }: {
    user: User | null,
    comment: Comment,
    parentComment: Comment | null,
    onCommentDelete: (commentId: number) => void,
  }
) {
  const t = useTranslations("Comment")
  const { confirming, onClick, onBlur } = useDoubleConfirm();

  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [liked, setLiked] = useState(comment.isLiked);
  const [replyCount, setReplyCount] = useState(comment.replyCount);
  const [showReplies, setShowReplies] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);

  const handleToggleLike = () => {
    toggleLike(
      { targetType: TargetType.Comment, targetId: comment.id }
    ).then(res => {
      toast.success(res.data.status ? t("like_success") : t("unlike_success"));
      setLiked(res.data.status);
      setLikeCount(res.data.status ? likeCount + 1 : likeCount - 1);
    }).catch(error => {
      toast.error(t("like_failed") + ": " + error.message);
    });
  }


  const onReply = (replyContent: string) => {
    setShowReplies(true);
    setShowReplyInput(false);
    setReplyCount(replyCount + 1);
  }

  return (
    <div className="flex">
      <div className="fade-in">
        {getGravatarByUser(comment.user)}
      </div>
      <div className="flex-1 pl-2 fade-in-up">
        <div className="font-bold text-base text-slate-800 dark:text-slate-100 fade-in-up">{comment.user.nickname}</div>
        <p className="text-lg text-slate-600 dark:text-slate-400 fade-in">
          {
            parentComment &&
            <>{t("reply")} <button onClick={clickToUserprofile(parentComment.user.nickname)} className="text-primary">{parentComment?.user.nickname}</button>: </>
          }
          {comment.content}
        </p>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-4 fade-in">
          <span>{new Date(comment.updatedAt).toLocaleString()}</span>
          {/* 点赞按钮 */}
          <button
            title={t(liked ? "unlike" : "like")}
            onClick={handleToggleLike}
            className={`flex items-center justify-center px-2 py-1 h-5 text-xs rounded 
                        ${liked ? 'bg-primary text-primary-foreground dark:text-white' : 'bg-slate-400 hover:bg-slate-600'}
                         dark:hover:bg-slate-500 fade-in`}
          >
            👍 {likeCount}
          </button>
          {/* 回复按钮 */}
          <button
            title={t("reply")}
            onClick={() => setShowReplyInput(!showReplyInput)}
            className="flex items-center justify-center px-2 py-1 h-5 
                        text-primary-foreground dark:text-white text-xs 
                        rounded bg-slate-400 hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up">
            <Reply className="w-3 h-3" />
          </button>
          {/* 删除按钮 仅自己的评论可见 */}
          {user?.id === comment.user.id && (
            <button
              title={t("delete")}
              onClick={() => onClick(() => { comment.id && onCommentDelete(comment.id); })}
              onBlur={onBlur}
              className={`flex items-center justify-center px-2 py-1 h-5 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition animated-btn fade-in`}
            >
              <Trash className="w-3 h-3" />
              {confirming && (
                <span className="ml-1 confirm-delete-anim">{t("confirm_delete")}</span>
              )}
            </button>)}

          {replyCount > 0 &&
            <button onClick={() => setShowReplies(!showReplies)} className="fade-in-up">
              {!showReplies ? t("expand_replies", { count: replyCount }) : t("collapse_replies")}
            </button>
          }
        </div>
        {showReplyInput && <CommentInput user={user} onCommentSubmitted={onReply} />}
      </div>
    </div>
  )
}

function CommentLoading() {
  return (
    <div className="space-y-6 py-8">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-3 fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
          <Skeleton className="w-10 h-10 rounded-full fade-in" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4 fade-in" />
            <Skeleton className="h-4 w-3/4 fade-in" />
            <Skeleton className="h-4 w-2/3 fade-in" />
          </div>
        </div>
      ))}
    </div>
  );
}