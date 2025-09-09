"use client"

import { User } from "@/models/user";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Comment } from "@/models/comment";
import { createComment, deleteComment, listComments } from "@/api/comment";
import { TargetType } from "@/models/types";
import { OrderBy } from "@/models/common";
import { Separator } from "@/components/ui/separator";
import { getLoginUser } from "@/api/user";
import { Skeleton } from "@/components/ui/skeleton";

import "./style.css";
import { CommentInput } from "./comment-input";
import { CommentItem } from "./comment-item";
import config from "@/config";



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
      size: config.commentsPerPage,
      commentId: 0
    }).then(response => {
      setComments(response.data);
    });
  }, [refreshCommentsKey])

  const onCommentSubmitted = ({ commentContent, isPrivate }: { commentContent: string, isPrivate: boolean }) => {
    createComment({
      targetType,
      targetId,
      content: commentContent,
      replyId: null,
      isPrivate,
    }).then(() => {
      toast.success(t("comment_success"));
      setRefreshCommentsKey(k => k + 1);
    })
  }

  const onCommentDelete = ({ commentId }: { commentId: number }) => {
    deleteComment({ id: commentId }).then(() => {
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