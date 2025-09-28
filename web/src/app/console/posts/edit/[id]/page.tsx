"use client";

import { getPostById } from "@/api/post";
import { PostEdit } from "@/components/console/post-manage/post-edit";
import { Post } from "@/models/post";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function EditPostPage() {
  const { id } = useParams() as { id: string };
  const [post, setPost] = useState<Post | null>(null);
  useEffect(() => {
    getPostById({ id }).then(res => {
      setPost(res.data);
    });
  }, [id]);
  return (
    <>{post && <PostEdit post={post} />}</>
  );
}