import { Suspense } from "react";
import type { Post } from "@/models/post";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import PostHeader from "@/components/blog-post-header.client";


async function PostContent({ post }: { post: Post }) {
  return (
    <div className="py-12 px-6">
      {post.type === "html" && (
        <div
          className="prose prose-lg max-w-none dark:prose-invert [&_h1]:text-5xl [&_h2]:text-4xl [&_h3]:text-3xl [&_h4]:text-2xl [&_h5]:text-xl [&_h6]:text-lg [&_p]:text-xl [&_p]:my-6 [&_ul]:my-6 [&_ol]:my-6 [&_pre]:my-8 [&_blockquote]:my-8"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      )}
      {post.type === "markdown" && (
        <div className="prose prose-lg max-w-none dark:prose-invert [&_h1]:text-5xl [&_h2]:text-4xl [&_h3]:text-3xl [&_h4]:text-2xl [&_h5]:text-xl [&_h6]:text-lg [&_p]:text-xl [&_p]:my-6 [&_ul]:my-6 [&_ol]:my-6 [&_pre]:my-8 [&_blockquote]:my-8">
          <Suspense>
            <MDXRemote
              source={post.content}
            />
          </Suspense>
        </div>
      )}
      {post.type === "text" && (
        <div className="text-xl text-slate-700 dark:text-slate-300 my-6">
          {post.content}
        </div>
      )}
    </div>
  );
}


async function BlogPost({ post }: { post: Post }) {
  return (
    <div className="">
      <PostHeader post={post} />
      <div className="">
        <PostContent post={post} />
      </div>
    </div>
  );
}

export default BlogPost;