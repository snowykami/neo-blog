import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { User } from "@/models/user";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { getGravatarByUser } from "@/components/common/gravatar";
import { Reply, Trash, Heart, Pencil, Lock } from "lucide-react";
import { Comment } from "@/models/comment";
import { TargetType } from "@/models/types";
import { toggleLike } from "@/api/like";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";
import { CommentInput } from "./comment-input";
import { createComment, deleteComment, listComments, updateComment } from "@/api/comment";
import { OrderBy } from "@/models/common";
import config from "@/config";


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
    onCommentDelete: ({ commentId }: { commentId: number }) => void,
  }
) {
  const t = useTranslations("Comment")
  const commonT = useTranslations('Common')
  const clickToUserProfile = useToUserProfile();
  const clickToLogin = useToLogin();
  const { confirming, onClick, onBlur } = useDoubleConfirm();

  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [liked, setLiked] = useState(comment.isLiked);
  const [canClickLike, setCanClickLike] = useState(true);
  const [isPrivate, setIsPrivate] = useState(comment.isPrivate);
  const [replyCount, setReplyCount] = useState(comment.replyCount);
  const [showReplies, setShowReplies] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [showEditInput, setShowEditInput] = useState(false);

  const handleToggleLike = () => {
    if (!canClickLike) {
      return;
    }
    setCanClickLike(false);
    if (!user) {
      toast.error(t("login_required"), {
        action: <div className="flex justify-end">
          <button
            onClick={clickToLogin}
            className="ml-0 text-left bg-red-400 text-white dark:text-black px-3 py-1 rounded font-semibold hover:bg-red-600 transition-colors"
          >
            {commonT("login")}
          </button>
        </div>,
      });
      return;
    }
    // 提前转换状态，让用户觉得响应很快
    const likedPrev = liked;
    const likeCountPrev = likeCount;
    setLiked(prev => !prev);
    setLikeCount(prev => prev + (likedPrev ? -1 : 1));
    toggleLike(
      { targetType: TargetType.Comment, targetId: comment.id }
    ).then(res => {
      toast.success(res.data.status ? t("like_success") : t("unlike_success"));
      setCanClickLike(true);
    }).catch(error => {
      toast.error(t("like_failed") + ": " + error.message);
      // 失败回滚
      setLiked(likedPrev);
      setLikeCount(likeCountPrev);
      setCanClickLike(true);
    });
  }

  const reloadReplies = () => {
    listComments(
      {
        targetType: comment.targetType,
        targetId: comment.targetId,
        depth: comment.depth + 1,
        orderBy: OrderBy.CreatedAt,
        desc: false,
        page: 1,
        size: config.commentsPerPage,
        commentId: comment.id
      }
    ).then(response => {
      setReplies(response.data);
      setRepliesLoaded(true);
    });
  }

  const toggleReplies = () => {
    if (!showReplies && !repliesLoaded) {
      reloadReplies();
    }
    setShowReplies(!showReplies);
  }

  const onCommentEdit = ({ commentContent: newContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => {
    updateComment({ id: comment.id, content: newContent, isPrivate }).then(() => {
      toast.success(t("edit_success"));
      comment.content = newContent;
      setIsPrivate(isPrivate);
      setShowEditInput(false);
    }).catch(error => {
      toast.error(t("edit_failed") + ": " + error.message);
    });
  }

  const onReply = ({ commentContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => {
    createComment({
      targetType: comment.targetType,
      targetId: comment.targetId,
      content: commentContent,
      replyId: comment.id,
      isPrivate,
    }).then(() => {
      toast.success(t("comment_success"));
      reloadReplies();
      setShowReplies(true);
      setShowReplyInput(false);
      setReplyCount(replyCount + 1);
    }).catch(error => {
      toast.error(t("comment_failed") + ": " +
        error?.response?.data?.message || error?.message
      );
    });
  }

  const onReplyDelete = ({ commentId: replyId }: { commentId: number }) => {
    deleteComment({ id: replyId }).then(() => {
      toast.success(t("delete_success"));
      setReplyCount(replyCount - 1);
      setReplies(replies.filter(r => r.id !== replyId));
    }).catch(error => {
      toast.error(t("delete_failed") + ": " + error.message);
    });
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
            isPrivate && <Lock className="inline w-4 h-4 mr-1 mb-1 text-slate-500 dark:text-slate-400" />
          }
          {
            parentComment &&
            <>{t("reply")} <button onClick={() => clickToUserProfile(parentComment.user.nickname)} className="text-primary">{parentComment?.user.nickname}</button>: </>
          }
          {comment.content}
        </p>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-4 fade-in">
          <span>{new Date(comment.updatedAt).toLocaleString()}</span>
          {/* 点赞按钮 */}
          <button
            title={t(liked ? "unlike" : "like")}
            onClick={handleToggleLike}
            className={`flex items-center justify-center px-2 py-1 h-5 gap-1 text-xs rounded 
                        ${liked ? 'bg-primary ' : 'bg-slate-400 hover:bg-slate-600'}
                         text-primary-foreground dark:text-white dark:hover:bg-slate-500 fade-in`}
          >
            <Heart className="w-3 h-3" /> <div>{likeCount}</div>
          </button>
          {/* 回复按钮 */}
          <button
            title={t("reply")}
            onClick={() => { setShowReplyInput(!showReplyInput); setShowEditInput(false); }}
            className={`flex items-center justify-center px-2 py-1 h-5 
                        text-primary-foreground dark:text-white text-xs 
                        rounded ${showReplyInput ? "bg-slate-600" : "bg-slate-400"} hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up`}>
            <Reply className="w-3 h-3" />
          </button>
          {/* 编辑和删除按钮 仅自己的评论可见 */}
          {user?.id === comment.user.id && (
            <>
              <button
                title={t("edit")}
                className={`
                flex items-center justify-center px-2 py-1 h-5 
                text-primary-foreground dark:text-white text-xs 
                rounded ${showEditInput ? "bg-slate-600" : "bg-slate-400"} hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up`}
                onClick={() => { setShowEditInput(!showEditInput); setShowReplyInput(false); }}
              >
                <Pencil className="w-3 h-3" />
              </button>

              <button
                title={t("delete")}
                className={`flex items-center justify-center px-2 py-1 h-5 rounded
                  text-primary-foreground dark:text-white text-xs 
                  ${confirming ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600' : 'bg-slate-400 hover:bg-slate-600 dark:hover:bg-slate-500'} fade-in`}
                onClick={() => onClick(() => { onCommentDelete({ commentId: comment.id }); })}
                onBlur={onBlur}
              >

                <Trash className="w-3 h-3" />
                {confirming && (
                  <span className="ml-1 confirm-delete-anim">{t("confirm_delete")}</span>
                )}
              </button>
            </>
          )}

          {replyCount > 0 &&
            <button onClick={toggleReplies} className="fade-in-up">
              {!showReplies ? t("expand_replies", { count: replyCount }) : t("collapse_replies")}
            </button>
          }
        </div>
        {/* 这俩输入框一次只能显示一个 */}
        {showReplyInput && !showEditInput && <CommentInput
          user={user}
          onCommentSubmitted={onReply}
        />}
        {showEditInput && !showReplyInput && <CommentInput
          user={user}
          initContent={comment.content}
          initIsPrivate={isPrivate}
          onCommentSubmitted={onCommentEdit}
          isUpdate={true}
        />}
        {showReplies && replies.length > 0 && (
          <div className="mt-4 pl-4 border-l border-slate-300 dark:border-slate-600 space-y-4">
            {replies.map((reply) => (
              <CommentItem
                key={reply.id}
                user={reply.user}
                comment={reply}
                parentComment={comment}
                onCommentDelete={onReplyDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div >
  )
}
