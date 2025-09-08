"use client";

import type { Comment } from "@/models/comment";
import { getGravatarByUser } from "@/components/common/gravatar";
import { useEffect, useState } from "react";
import { Reply, Trash } from "lucide-react";
import { toggleLike } from "@/api/like";
import { TargetType } from "@/models/types";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CommentInput } from "./comment-input";
import { deleteComment, listComments } from "@/api/comment";
import { OrderBy } from "@/models/common";
import { getLoginUser } from "@/api/user";
import type { User } from "@/models/user";
import Link from "next/link";
import "./comment-animations.css";

export function CommentItem({comment, parentComment}:{comment: Comment, parentComment: Comment | null}) {
    const t = useTranslations("Comment")
    const [user, setUser] = useState<User | null>(null);
    const [liked, setLiked] = useState(comment.isLiked);
    const [likeCount, setLikeCount] = useState(comment.likeCount);
    const [replyCount, setReplyCount] = useState(comment.replyCount);
    const [showReplyInput, setShowReplyInput] = useState(false);
    const [showReplies, setShowReplies] = useState(false);
    // 二次确认删除
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    useEffect(() => {
        getLoginUser()
            .then(response => {
                setUser(response.data);
            })
    }, []);

    const handleToggleLike = () => {
        toggleLike({ targetType: TargetType.Comment, targetId: comment.id })
            .then(res => {
                setLiked(res.data.status);
                setLikeCount(res.data.status ? likeCount + 1 : likeCount - 1);
                toast.success(res.data.status ? t("like_success") : t("unlike_success"));
            })
            .catch(error => {
                toast.error(t("like_failed") + ": " + error.message);
            });
    }

    const handleDeleteComment = (id: number) => {
        deleteComment(id)
            .then(() => {
                toast.success(t("delete_success"));
            })
            .catch(error => {
                toast.error(t("delete_failed") + ": " + error.message);
            });
    }

    const onReplySubmitted = () => {
        setReplyCount(replyCount + 1);
        setShowReplyInput(false);
        setShowReplies(true);
    }

    return (
        <div className="flex fade-in-up">
            <div className="fade-in">
                {getGravatarByUser(comment.user)}
            </div>
            <div className="flex-1 pl-2 fade-in-up">
                <div className="font-bold text-base text-slate-800 dark:text-slate-100 fade-in-up">{comment.user.nickname}</div>
                <p className="text-lg text-slate-600 dark:text-slate-400 fade-in">
                    {parentComment && <>{t("reply")} <Link href={`/u/${parentComment.user.username}`} className="text-primary">{parentComment?.user.nickname}</Link>: </>}
                    {comment.content}
                </p>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-4 fade-in">
                    <span>{new Date(comment.updatedAt).toLocaleString()}</span>
                    <button
                        onClick={handleToggleLike}
                        className={`flex items-center justify-center px-2 py-1 h-5 text-xs rounded 
                        ${liked ? 'bg-primary text-primary-foreground dark:text-white' : 'bg-slate-400 hover:bg-slate-600'}
                         dark:hover:bg-slate-500 fade-in`}
                    >
                        👍 {likeCount}
                    </button>
                    <button onClick={() => setShowReplyInput(!showReplyInput)}
                        className="flex items-center justify-center px-2 py-1 h-5 
                        text-primary-foreground dark:text-white text-xs 
                        rounded bg-slate-400 hover:bg-slate-600 dark:hover:bg-slate-500 fade-in-up">
                        <Reply className="w-3 h-3" />
                    </button>
                    {comment.user.id === user?.id && (
                        deleteConfirm ? (
                            <button
                                onClick={() => handleDeleteComment(comment.id)}
                                className="flex items-center justify-center px-2 py-1 h-5 text-primary-foreground dark:text-white text-xs rounded bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 fade-in"
                                onBlur={() => setDeleteConfirm(false)}
                                title={t("confirm_delete")}
                            >
                                {t("confirm_delete")}
                            </button>
                        ) : (
                            <button
                                onClick={() => setDeleteConfirm(true)}
                                className="flex items-center justify-center px-2 py-1 h-5 text-primary-foreground dark:text-white text-xs rounded bg-slate-400 hover:bg-red-600 dark:hover:bg-red-500 fade-in"
                                title={t("delete")}
                            >
                                <Trash className="w-3 h-3" />
                            </button>
                        )
                    )}
                    {replyCount > 0 &&
                        <button onClick={() => setShowReplies(!showReplies)} className="fade-in-up">
                            {!showReplies ? t("expand_replies", { count: replyCount }) : t("collapse_replies")}
                        </button>
                    }
                </div>
                {showReplyInput && <CommentInput targetId={comment.targetId} targetType={comment.targetType} replyId={comment.id} onCommentSubmitted={onReplySubmitted} />}
                {showReplies && replyCount > 0 && <RepliesList parentComment={comment} />}
            </div>
        </div>
    );
}

// 一个评论的回复区域组件
function RepliesList({ parentComment }: { parentComment: Comment }) {
    const t = useTranslations("Comment")
    const [replies, setReplies] = useState<Comment[]>([]);
    useEffect(() => {
        listComments({
            targetType: parentComment.targetType,
            targetId: parentComment.targetId,
            commentId: parentComment.id,
            depth: parentComment.depth + 1,
            orderBy: OrderBy.CreatedAt,
            desc: false,
            page: 1,
            size: 9999,
        }).then(res => {
            setReplies(res.data);
        }).catch(error => {
            toast.error(t("load_replies_failed") + ": " + error.message);
        });
    }, [parentComment])

    return (
        <div className="mt-4 border-l border-slate-300 pl-4">
            {replies.map(reply => (
                <div key={reply.id} className="mb-4">
                    <CommentItem comment={reply} parentComment={parentComment} />
                </div>
            ))}
        </div>
    )
}