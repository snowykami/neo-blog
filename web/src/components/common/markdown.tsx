
import { MDXRemote, MDXRemoteProps } from "next-mdx-remote-client/rsc";
import { Suspense } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css"; // 你可以换成喜欢的主题
import "highlight.js/styles/github-dark.css"; // 适用于暗黑模式
import "highlight.js/styles/github-dark-dimmed.css"; // 适用于暗黑模式
import CodeBlock from "@/components/common/markdown-codeblock";
import * as motion from "motion/react-client"
import config from "@/config";
import { Skeleton } from "@/components/ui/skeleton";


export function MotionDiv(props: React.ComponentPropsWithoutRef<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0.3, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: config.animationDurationSecond, ease: "easeOut" }}
    >{props.children}
    </motion.div>
  );
}

export const markdownComponents = {
  h1: (props: React.ComponentPropsWithoutRef<"h1">) => (
    <MotionDiv>
      <h1
        className="scroll-m-20 text-4xl font-extrabold tracking-tight text-balance mt-10 mb-6"
        {...props}
      />
    </MotionDiv>

  ),
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
    <MotionDiv>
      <h2
        className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mt-8 mb-4"
        {...props}
      />
    </MotionDiv>
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
    <MotionDiv>
      <h3
        className="scroll-m-20 text-2xl font-semibold tracking-tight mt-6 mb-3"
        {...props}
      />
    </MotionDiv>
  ),
  h4: (props: React.ComponentPropsWithoutRef<"h4">) => (
    <MotionDiv>
      <h4
        className="scroll-m-20 text-xl font-semibold tracking-tight mt-5 mb-2"
        {...props}
      /></MotionDiv>
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => (
    <MotionDiv>
      <div className="leading-7 mt-4 mb-4">{props.children}</div>
    </MotionDiv>
  ),
  blockquote: (props: React.ComponentPropsWithoutRef<"blockquote">) => (
    <MotionDiv>
      <blockquote
        className="border-l-4 border-blue-400 pl-4 italic my-6 py-2"
        {...props}
      />
    </MotionDiv>
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code
      className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-sm font-mono"
      {...props}
    />
  ),
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) => (
    <MotionDiv><CodeBlock {...props}>{children}</CodeBlock></MotionDiv>
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-blue-600 hover:underline"
      {...props}
    />
  ),
};

export function RenderMarkdown(props: Omit<MDXRemoteProps, "components">) {
  return (
    <Suspense fallback={<MarkdownSkeleton />}>
      <MDXRemote {...props}
        components={markdownComponents}
        options={{
          mdxOptions: {
            rehypePlugins: [[rehypeHighlight, { ignoreMissing: true }]],
          }
        }} />
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