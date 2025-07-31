"use client";

import type { Comment } from "@/models/comment";
import { CommentInput } from "@/components/comment/comment-input";
import { useEffect, useState } from "react";
import { listComments } from "@/api/comment";
import { OrderBy } from "@/models/common";

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
    listComments({ page: 1, size: 10, orderBy: OrderBy.CreatedAt, desc: true }, 1)
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
      <h2>评论区</h2>
      <CommentInput />
    </div>
  );
}