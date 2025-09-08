"use client";

import type { Comment } from "@/models/comment";
import { CommentInput } from "@/components/comment/comment-input";
import "./comment-animations.css";
import { Suspense, useEffect, useState } from "react";
import { listComments } from "@/api/comment";
import { OrderBy } from "@/models/common";
import { CommentItem } from "./comment-item";
import { Separator } from "../ui/separator";
import { TargetType } from "@/models/types";
import { Skeleton } from "../ui/skeleton";

interface CommentAreaProps {
  targetType: TargetType;
  targetId: number;
}



export default function CommentSection(props: CommentAreaProps) {
  const { targetType, targetId } = props;
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState<string>("");

  useEffect(() => {
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy: OrderBy.CreatedAt,
      desc: true,
      page: 1,
      size: 10
    })
      .then(response => {
        setComments(response.data);
      })
  }, [targetType, targetId]);

  const onCommentSubmitted = () => {
    // 重新加载评论列表
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy: OrderBy.CreatedAt,
      desc: true,
      page: 1,
      size: 10
    })
      .then(response => {
        setComments(response.data);
      })
  }

  return (
    <div>
      <Separator className="my-16" />
      <div className="font-bold text-2xl">评论</div>
      <CommentInput targetType={targetType} targetId={targetId} replyId={0} onCommentSubmitted={onCommentSubmitted} />
      <div className="mt-4">
        <Suspense fallback={<CommentLoading />}>
          {comments.map((comment, idx) => (
            <div key={comment.id} className="fade-in-up" style={{ animationDelay: `${idx * 60}ms` }}>
              <Separator className="my-2" />
              <CommentItem comment={comment} parentComment={null} />
            </div>
          ))}
        </Suspense>
      </div>
    </div>
  );
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