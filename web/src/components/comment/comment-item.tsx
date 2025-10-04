import { useToLogin, useToUserProfile } from "@/hooks/use-route";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Reply, Heart, Lock, Ellipsis } from "lucide-react";
import { Comment } from "@/models/comment";
import { TargetType } from "@/models/types";
import { toggleLike } from "@/api/like";
import { useDoubleConfirm } from "@/hooks/use-double-confirm";
import { CommentInput } from "./comment-input";
import { createComment, deleteComment, getComment, listComments, updateComment } from "@/api/comment";
import { OrderBy } from "@/models/common";
import { formatDateTime } from "@/utils/common/datetime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFirstCharFromUser } from "@/utils/common/username";
import { useAuth } from "@/contexts/auth-context";
import { DropdownMenu } from "@radix-ui/react-dropdown-menu";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSiteInfo } from "@/contexts/site-info-context";
import { Role } from "@/models/user";
import { Badge } from "@/components/ui/badge";


export function CommentItem(
  {
    comment,
    ownerId,
    parentComment,
    onCommentDelete,
    activeInput,
    setActiveInputId,
    onReplySubmitted  // 评论区计数更新用
  }: {
    comment: Comment,
    ownerId?: number, // 不是评论的作者ID，而是文章的作者ID
    parentComment: Comment | null,
    onCommentDelete: ({ commentId }: { commentId: number }) => void,
    activeInput: { id: number; type: 'reply' | 'edit' } | null,
    setActiveInputId: (input: { id: number; type: 'reply' | 'edit' } | null) => void,
    onReplySubmitted: ({ commentContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => void,
  }
) {
  const { siteInfo } = useSiteInfo();
  const { user } = useAuth();
  const locale = useLocale();
  const t = useTranslations("Comment");
  const roleT = useTranslations("Role");
  const commonT = useTranslations("Common");
  const clickToUserProfile = useToUserProfile();
  const clickToLogin = useToLogin();

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
    <div className={`${commentState.replyCount > 0 && showReplies ? "border-l-2" : ""}`}>
      <div className="flex gap-2">
        <div onClick={() => clickToUserProfile(commentState.user.username)} className="cursor-pointer fade-in w-12 h-12">
          <Avatar className="h-full w-full rounded-full border-2">
            <AvatarImage src={getGravatarFromUser({ user: commentState.user, size: 120 })} alt={commentState.user.nickname} />
            <AvatarFallback className="rounded-full">{getFirstCharFromUser(commentState.user)}</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 pl-2 fade-in-up">
          <div className="flex gap-2 md:gap-4 items-center flex-wrap">
            {/* 用户名 */}
            <div
              onClick={() => clickToUserProfile(commentState.user.username)}
              data-user-color={commentState.user.preferredColor || siteInfo.colorSchemes?.[0] || "blue"}
              className="text-primary font-bold text-lg border-b-4 border-primary/40 hover:border-primary/70 cursor-pointer transition-colors duration-200">
              {commentState.user.nickname || commentState.user.username}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* 吧唧 */}
              {commentState.user.id === user?.id && <Badge className="bg-primary text-white"> {roleT("me")} </Badge>}
              {commentState.user.id === ownerId && <Badge className="bg-pink-500 text-white"> {roleT("author")} </Badge>}
              <Badge className={`
              ${commentState.user.role === Role.ADMIN ? "bg-orange-500 text-white" : ""}
              ${commentState.user.role === Role.EDITOR ? "bg-green-500 text-white" : ""}
              ${commentState.user.role === Role.USER ? "bg-blue-500 text-white" : ""}
              `}>
                {roleT(commentState.user.role)}
              </Badge>
              {/* 创建时间 */}
              <span className="text-xs">{formatDateTime({
                dateTimeString: commentState.createdAt,
                locale,
                convertShortAgo: true,
                unitI18n: { secondsAgo: commonT("secondsAgo"), minutesAgo: commonT("minutesAgo"), hoursAgo: commonT("hoursAgo"), daysAgo: commonT("daysAgo") }
              })}</span>
              {commentState.createdAt !== commentState.updatedAt &&
                (new Date(commentState.updatedAt).getTime() - new Date(commentState.createdAt).getTime()) > 10000 &&
                <span className="text-xs">{t("edit_at", {
                  time: formatDateTime({
                    dateTimeString: commentState.updatedAt,
                    locale,
                    convertShortAgo: true,
                    unitI18n: { secondsAgo: commonT("secondsAgo"), minutesAgo: commonT("minutesAgo"), hoursAgo: commonT("hoursAgo"), daysAgo: commonT("daysAgo") }
                  })
                })}</span>}
            </div>

          </div>
          <p className="text-lg text-slate-600 dark:text-slate-400 fade-in bg-accent rounded-xl px-4 py-2 my-2">
            {commentState.isPrivate && <Lock className="inline w-4 h-4 mr-1 mb-1 text-slate-500 dark:text-slate-400" />}
            {/* 回复提示 */}
            {parentComment &&
              <span>
                {t("reply")}
                <span onClick={() => clickToUserProfile(parentComment.user.username)}
                  className="text-primary font-semibold border-b-4 border-primary/40 cursor-pointer hover:border-primary/70 transition-colors mx-1">
                  {parentComment.user.nickname || parentComment.user.username}
                </span>:{" "}
              </span>
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
              {/* 更多 */}
              {user?.id === comment.user.id && <CommentDropdownMenu comment={commentState} setActiveInputId={setActiveInputId} onCommentDelete={onCommentDelete} />}

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
            </div>
          </div>
        </div>
        {/* 这俩输入框一次只能显示一个 */}
      </div >
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
      {showReplies && replies.length > 0 && (
        <div className="mt-4 pl-4 md:pl-8 space-y-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              ownerId={ownerId}
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

function CommentDropdownMenu(
  {
    comment,
    setActiveInputId,
    onCommentDelete
  }: {
    comment: Comment,
    setActiveInputId: (input: { id: number; type: 'reply' | 'edit' } | null) => void,
    onCommentDelete: ({ commentId }: { commentId: number }) => void
  }
) {
  const { confirming: confirmingDelete, onClick: onDeleteClick } = useDoubleConfirm();
  const operationT = useTranslations("Operation");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Ellipsis className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => setActiveInputId({ id: comment.id, type: 'edit' })}>
          {operationT("edit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            if (!confirmingDelete) {
              e.preventDefault();
              onDeleteClick(() => onCommentDelete({ commentId: comment.id }));
            } else {
              onDeleteClick(() => onCommentDelete({ commentId: comment.id }));
            }
          }}
          className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer">
          {confirmingDelete ? operationT("confirm_delete") : operationT("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
