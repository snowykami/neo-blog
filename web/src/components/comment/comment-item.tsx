import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { User } from "@/models/user";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Reply, Trash, Heart, Pencil, Lock } from "lucide-react";
import { Comment } from "@/models/comment";
import { TargetType } from "@/models/types";
import { toggleLike } from "@/api/like";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";
import { CommentInput } from "./comment-input";
import { createComment, deleteComment, getComment, listComments, updateComment } from "@/api/comment";
import { OrderBy } from "@/models/common";
import { formatDateTime } from "@/utils/common/datetime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser, getGravatarUrl } from "@/utils/common/gravatar";
import { getFirstCharFromUser } from "@/utils/common/username";
import { useAuth } from "@/contexts/auth-context";


export function CommentItem(
  {
    comment,
    parentComment,
    onCommentDelete,
    activeInput,
    setActiveInputId,
    onReplySubmitted  // 评论区计数更新用
  }: {
    comment: Comment,
    parentComment: Comment | null,
    onCommentDelete: ({ commentId }: { commentId: number }) => void,
    activeInput: { id: number; type: 'reply' | 'edit' } | null,
    setActiveInputId: (input: { id: number; type: 'reply' | 'edit' } | null) => void,
    onReplySubmitted: ({ commentContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => void,
  }
) {
  const { user } = useAuth();
  const locale = useLocale();
  const t = useTranslations("Comment");
  const commonT = useTranslations("Common");
  const clickToUserProfile = useToUserProfile();
  const clickToLogin = useToLogin();
  const { confirming, onClick, onBlur } = useDoubleConfirm();

  const [commentState, setCommentState] = useState<Comment>(comment); // 用于更新评论内容
  const [likeCount, setLikeCount] = useState(commentState.likeCount);
  const [liked, setLiked] = useState(commentState.isLiked);
  const [canClickLike, setCanClickLike] = useState(true);
  const [replyCount, setReplyCount] = useState(commentState.replyCount);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);

  const handleToggleLike = () => {
    if (!canClickLike) {
      return;
    }
    setCanClickLike(false);
    if (!user) {
      toast.error(t("login_required"), {
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
      { targetType: TargetType.Comment, targetId: commentState.id }
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
        targetType: commentState.targetType,
        targetId: commentState.targetId,
        depth: commentState.depth + 1,
        orderBy: OrderBy.CreatedAt,
        desc: false,
        page: 1,
        size: 999999,
        commentId: commentState.id
      }
    ).then(response => {
      setReplies(response.data.comments);
      setRepliesLoaded(true);
    });
  }

  const toggleReplies = () => {
    if (!showReplies && !repliesLoaded) {
      reloadReplies();
    }
    setShowReplies(!showReplies);
  }

  const onCommentEdit = ({ commentContent: newContent, isPrivate, showClientInfo }: { commentContent: string, isPrivate: boolean, showClientInfo: boolean }) => {
    updateComment({ id: commentState.id, content: newContent, isPrivate, showClientInfo }).then(() => {
      toast.success(t("edit_success"));
      getComment({ id: commentState.id }).then(response => {
        setCommentState(response.data);
        console.log(response.data);
      });
      setActiveInputId(null);
    }).catch(error => {
      toast.error(t("edit_failed") + ": " + error.message);
    });
  }

  const onReply = ({ commentContent, isPrivate, showClientInfo }: { commentContent: string, isPrivate: boolean, showClientInfo: boolean }) => {
    createComment({
      targetType: commentState.targetType,
      targetId: commentState.targetId,
      content: commentContent,
      replyId: commentState.id,
      isPrivate,
      showClientInfo
    }).then(() => {
      toast.success(t("comment_success"));
      reloadReplies();
      setShowReplies(true);
      setActiveInputId(null);
      setReplyCount(replyCount + 1);
      onReplySubmitted({ commentContent, isPrivate });
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
    <div>
      <div className="flex">
        <div onClick={() => clickToUserProfile(commentState.user.username)} className="cursor-pointer fade-in w-12 h-12">
          <Avatar className="h-full w-full rounded-full">
            <AvatarImage src={getGravatarFromUser({ user: commentState.user, size: 120 })} alt={commentState.user.nickname} />
            <AvatarFallback className="rounded-full">{getFirstCharFromUser(commentState.user)}</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 pl-2 fade-in-up">
          <div className="flex gap-2 md:gap-4 items-center">
            <div onClick={() => clickToUserProfile(commentState.user.username)} className="font-bold text-base text-slate-800 dark:text-slate-100 cursor-pointer fade-in-up">
              {commentState.user.nickname || commentState.user.username}
            </div>
            <span className="text-xs">{formatDateTime({
              dateTimeString: commentState.createdAt,
              locale,
              convertShortAgo: true,
              unitI18n: { secondsAgo: commonT("secondsAgo"), minutesAgo: commonT("minutesAgo"), hoursAgo: commonT("hoursAgo"), daysAgo: commonT("daysAgo") }
            })}</span>
            {commentState.createdAt !== commentState.updatedAt &&
              <span className="text-xs">{t("edit_at", {
                time: formatDateTime({
                  dateTimeString: commentState.updatedAt,
                  locale,
                  convertShortAgo: true,
                  unitI18n: { secondsAgo: commonT("secondsAgo"), minutesAgo: commonT("minutesAgo"), hoursAgo: commonT("hoursAgo"), daysAgo: commonT("daysAgo") }
                })
              })}</span>}
          </div>
          <p className="text-lg text-slate-600 dark:text-slate-400 fade-in">
            {
              commentState.isPrivate && <Lock className="inline w-4 h-4 mr-1 mb-1 text-slate-500 dark:text-slate-400" />
            }
            {
              parentComment &&
              <>{t("reply")} <button onClick={() => clickToUserProfile(parentComment.user.username)} className="text-primary">{parentComment.user.nickname || parentComment.user.username}</button>: </>
            }
            {commentState.content}
          </p>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 fade-in flex flex-col md:flex-row items-start md:items-center md:justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* 用户地理，浏览器，系统信息 */}
              {commentState.location && <span title={commentState.location} >{commentState.location}</span>}
              {commentState.browser && <span title={commentState.browser}>{commentState.browser}</span>}
              {commentState.os && <span title={commentState.os}>{commentState.os}</span>}
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto">
              {replyCount > 0 && (
                <button onClick={toggleReplies} className="fade-in-up">
                  {!showReplies ? t("expand_replies", { count: replyCount }) : t("collapse_replies")}
                </button>
              )}
              {/* 回复按钮 */}
              <button
                title={t("reply")}
                onClick={() => {
                  if (activeInput?.type === 'reply' && activeInput.id === commentState.id) {
                    setActiveInputId(null);
                  } else {
                    setActiveInputId({ id: commentState.id, type: 'reply' });
                  }
                }}
                className={`flex items-center justify-center px-2 py-1 h-5 
              text-primary-foreground dark:text-white text-xs 
              rounded ${activeInput?.type === 'reply' && activeInput.id === commentState.id ? "bg-slate-600" : "bg-slate-400"} hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up`}
              >
                <Reply className="w-3 h-3" />
              </button>
              {/* 点赞按钮 */}
              <button
                title={t(liked ? "unlike" : "like")}
                onClick={handleToggleLike}
                className={`flex items-center justify-center px-2 py-1 h-5 gap-1 text-xs rounded 
                ${liked ? 'bg-primary' : 'bg-slate-400 hover:bg-slate-600'}
                 text-primary-foreground dark:text-white dark:hover:bg-slate-500 fade-in`}
              >
                <Heart className="w-3 h-3" /> <div>{likeCount}</div>
              </button>

              {/* 编辑和删除按钮 仅自己的评论可见 */}
              {user?.id === commentState.user.id && (
                <>
                  <button
                    title={t("edit")}
                    onClick={() => {
                      if (activeInput?.type === 'edit' && activeInput.id === commentState.id) {
                        setActiveInputId(null);
                      } else {
                        setActiveInputId({ id: commentState.id, type: 'edit' });
                      }
                    }}
                    className={`
                flex items-center justify-center px-2 py-1 h-5 
                text-primary-foreground dark:text-white text-xs 
                rounded ${activeInput?.type === 'edit' && activeInput.id === commentState.id ? "bg-slate-600" : "bg-slate-400"} hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>

                  <button
                    title={t("delete")}
                    className={`flex items-center justify-center px-2 py-1 h-5 rounded
                text-primary-foreground dark:text-white text-xs 
                ${confirming ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600' : 'bg-slate-400 hover:bg-slate-600 dark:hover:bg-slate-500'} fade-in`}
                    onClick={() => onClick(() => { onCommentDelete({ commentId: commentState.id }); })}
                    onBlur={onBlur}
                  >
                    <Trash className="w-3 h-3" />
                    {confirming && (
                      <span className="ml-1 confirm-delete-anim">{t("confirm_delete")}</span>
                    )}
                  </button>
                </>
              )}


            </div>
          </div>
          {/* 这俩输入框一次只能显示一个 */}
          {activeInput && activeInput.type === 'reply' && activeInput.id === commentState.id && <CommentInput
            onCommentSubmitted={onReply}
            initIsPrivate={commentState.isPrivate}
            placeholder={`${t("reply")} ${commentState.user.nickname || commentState.user.username} :`}
          />}
          {activeInput && activeInput.type === 'edit' && activeInput.id === commentState.id && <CommentInput
            initContent={commentState.content}
            initIsPrivate={commentState.isPrivate}
            onCommentSubmitted={onCommentEdit}
            isUpdate={true}
            initShowClientInfo={commentState.showClientInfo}
          />}

        </div>
      </div >
      {showReplies && replies.length > 0 && (
        <div className="mt-4 pl-4 md:pl-8 border-l border-slate-300 dark:border-slate-600 space-y-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              parentComment={commentState}
              onCommentDelete={onReplyDelete}
              activeInput={activeInput}
              setActiveInputId={setActiveInputId}
              onReplySubmitted={onReplySubmitted}
            />
          ))}
        </div>
      )}</div>
  )
}
