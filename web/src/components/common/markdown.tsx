
import { MDXRemote, MDXRemoteProps } from "next-mdx-remote-client/rsc";
import { Suspense } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css"; // 你可以换成喜欢的主题
import "highlight.js/styles/github-dark.css"; // 适用于暗黑模式
import "highlight.js/styles/github-dark-dimmed.css"; // 适用于暗黑模式
import CodeBlock from "@/components/common/markdown-codeblock";
import { Skeleton } from "@/components/ui/skeleton";
import { EnhancedLink } from "./markdown-a";
import remarkGfm from "remark-gfm";

export const markdownComponents = {
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code
      className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-sm font-mono "
      {...props}
    />
  ),
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) => (
    <CodeBlock {...props}>{children}</CodeBlock>
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <EnhancedLink href={props.href || '#'} {...props}>
      {props.children}
    </EnhancedLink>
  ),
  img: (props: React.ComponentPropsWithoutRef<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element
    // TODO: 增加图片预览
    <img
      className="my-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
      alt={props.alt}
      {...props}
    />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="my-4 ml-6 list-disc" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="my-4 ml-6 list-decimal" {...props} />
  ),
  li: (props: React.ComponentPropsWithoutRef<"li">) => (
    <li className="my-2" {...props} />
  ),
  hr: (props: React.ComponentPropsWithoutRef<"hr">) => (
    <hr className="my-6 border-gray-200 dark:border-gray-700" {...props} />
  ),
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold" {...props} />
  ),
  em: (props: React.ComponentPropsWithoutRef<"em">) => (
    <em className="italic" {...props} />
  ),
  del: (props: React.ComponentPropsWithoutRef<"del">) => (
    <del className="line-through" {...props} />
  ),
};

export function RenderMarkdown(props: Omit<MDXRemoteProps, "components">) {
  return (
    <Suspense fallback={<MarkdownSkeleton />}>
      <MDXRemote {...props}
        components={markdownComponents}
        options={{
          mdxOptions: {
            remarkPlugins: [remarkGfm],
            rehypePlugins: [[rehypeHighlight, { ignoreMissing: true }]],
          }
        }}
      />
    </Suspense>
  );
}

export function RenderMarkdownWithComponents(props: MDXRemoteProps) {
  return (
    <Suspense fallback={<MarkdownSkeleton />}>
      <MDXRemote {...props} components={markdownComponents} />
    </Suspense>
  );
}

export function MarkdownSkeleton() {
  return (
    <div className="space-y-4 mt-8">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}