"use client"

import { User } from "@/models/user";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Comment } from "@/models/comment";
import { createComment, deleteComment, getComment, listComments } from "@/api/comment";
import { TargetType } from "@/models/types";
import { OrderBy } from "@/models/common";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CommentInput } from "./comment-input";
import { CommentItem } from "./comment-item";
import config from "@/config";
import "./style.css";
import { getLoginUser } from "@/api/user";


export function CommentSection(
  {
    targetType,
    targetId,
    totalCount = 0,
  }: {
    targetType: TargetType,
    targetId: number,
    totalCount?: number
  }
) {
  const t = useTranslations('Comment')
  const [loginUser, setLoginUser] = useState<User | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeInput, setActiveInput] = useState<{ id: number; type: 'reply' | 'edit' } | null>(null);
  const [page, setPage] = useState(1); // 当前页码
  const [totalCommentCount, setTotalCommentCount] = useState(totalCount); // 评论总数
  const [needLoadMore, setNeedLoadMore] = useState(true); // 是否需要加载更多，当最后一次获取的评论数小于分页大小时设为false

  // 获取登录用户信息
  useEffect(() => {
    getLoginUser().then(res => {
      setLoginUser(res.data);
      console.log("login user:", res.data);
    }).catch(() => {
      setLoginUser(null);
    });
  }, []);
  // 加载0/顶层评论
  useEffect(() => {
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy: OrderBy.CreatedAt,
      desc: true,
      page: page,
      size: config.commentsPerPage,
      commentId: 0
    }).then(response => {
      setComments(response.data.comments);
    });
  }, [])

  const onCommentSubmitted = ({ commentContent, isPrivate, showClientInfo }: { commentContent: string, isPrivate: boolean, showClientInfo: boolean }) => {
    createComment({
      targetType,
      targetId,
      content: commentContent,
      replyId: null,
      isPrivate,
      showClientInfo
    }).then(res => {
      toast.success(t("comment_success"));
      setTotalCommentCount(c => c + 1);
      getComment({ id: res.data.id }).then(response => {
        setComments(prevComments => [response.data, ...prevComments]);
      });
      setActiveInput(null);
    })
  }

  const onReplySubmitted = ({ }: { commentContent: string, isPrivate: boolean }) => {
    setTotalCommentCount(c => c + 1);
  }

  const onCommentDelete = ({ commentId }: { commentId: number }) => {
    deleteComment({ id: commentId }).then(() => {
      toast.success(t("delete_success"));
      setComments(prevComments => prevComments.filter(comment => comment.id !== commentId));
      setTotalCommentCount(c => c - 1);
    }).catch(error => {
      toast.error(t("delete_failed") + ": " + error.message);
    });
  }

  const handleLoadMore = () => {
    const nextPage = page + 1;
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy: OrderBy.CreatedAt,
      desc: true,
      page: nextPage,
      size: config.commentsPerPage,
      commentId: 0
    }).then(response => {
      if (response.data.comments.length < config.commentsPerPage) {
        setNeedLoadMore(false);
      }
      setComments(prevComments => [...prevComments, ...response.data.comments]);
      setPage(nextPage);
    });
  }

  return (
    <div>
      <Separator className="my-16" />
      <div className="font-bold text-2xl">{t("comment")} ({totalCommentCount})</div>
      <CommentInput
        user={loginUser}
        onCommentSubmitted={onCommentSubmitted}
      />
      <div className="mt-4">
        <Suspense fallback={<CommentLoading />}>
          {comments.map((comment, idx) => (
            <div key={comment.id} className="" style={{ animationDelay: `${idx * 60}ms` }}>
              <Separator className="my-2" />
              <CommentItem
                loginUser={loginUser}
                comment={comment}
                parentComment={null}
                onCommentDelete={onCommentDelete}
                activeInput={activeInput}
                setActiveInputId={setActiveInput}
                onReplySubmitted={onReplySubmitted}
              />
            </div>
          ))}
        </Suspense>
        {needLoadMore ?
          <p onClick={handleLoadMore} className="text-center text-sm text-gray-500 my-4 cursor-pointer hover:underline">
              {t("load_more")}
          </p>
          :
          <p className="text-center text-sm text-gray-500 my-4">
            {t("no_more")}
          </p>
        }
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