"use client";

import type { Comment } from "@/models/comment";
import { CommentInput } from "@/components/comment/comment-input";
import { useEffect, useState } from "react";
import { listComments } from "@/api/comment";
import { OrderBy } from "@/models/common";
import { CommentItem } from "./comment-item";
import { Separator } from "../ui/separator";

interface CommentAreaProps {
  targetType: 'post' | 'page';
  targetId: number;
}

export default function CommentSection(props: CommentAreaProps) {
  const { targetType, targetId } = props;
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      .catch(err => {
        setError("加载评论失败，请稍后再试。");
        console.error("Error loading comments:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [targetType, targetId]);

  return (
    <div>
      <Separator className="my-16" />
      <div className="font-bold text-2xl">评论</div>
      <CommentInput />
      {loading && <p>加载中...</p>}
      {error && <p className="text-red-500">{error}</p>}
      <div className="mt-4">
        {comments.map(comment => (
          <div key={comment.id}>
            <Separator className="my-2" />
            <CommentItem {...comment} />
          </div>
        ))}
      </div>
    </div>
  );
}