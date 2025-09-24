"use client";
import { listPosts } from "@/api/post";
import { Separator } from "@/components/ui/separator";
import config from "@/config";
import { OrderBy } from "@/models/common";
import { Post } from "@/models/post"
import { useEffect, useState } from "react";

export function PostManage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [orderBy, setOrderBy] = useState<OrderBy>(OrderBy.CreatedAt);
  const [desc, setDesc] = useState<boolean>(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    listPosts({ page, size: config.postsPerPage, orderBy, desc }).then(res => {
      setPosts(res.data.posts);
    });
  }, [page, orderBy, desc]);

  return <div>
    {posts.map(post => <PostItem key={post.id} post={post} />)}
  </div>;
}

function PostItem({ post }: { post: Post }) {
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-2">
        {/* left */}
        <div>
          <div className="text-sm font-medium">
            {post.title}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">ID: {post.id}</span>
            <span className="mx-2 text-xs text-muted-foreground">|</span>
            <span className="text-xs text-muted-foreground">Created At: {new Date(post.createdAt).toLocaleDateString()}</span>
            <span className="mx-2 text-xs text-muted-foreground">|</span>
            <span className="text-xs text-muted-foreground">Updated At: {new Date(post.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      <Separator className="flex-1" />
    </div>
  )
}