
import { MDXRemote, MDXRemoteProps } from "next-mdx-remote-client/rsc";
import { Suspense } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css"; // 你可以换成喜欢的主题
import "highlight.js/styles/github-dark.css"; // 适用于暗黑模式
import "highlight.js/styles/github-dark-dimmed.css"; // 适用于暗黑模式
import CodeBlock from "@/components/common/markdown-codeblock";
import { Skeleton } from "@/components/ui/skeleton";

export const markdownComponents = {
  h1: (props: React.ComponentPropsWithoutRef<"h1">) => (
      <h1
        className="scroll-m-20 text-4xl font-extrabold tracking-tight text-balance mt-10 mb-6"
        {...props}
      />

  ),
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
      <h2
        className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mt-8 mb-4"
        {...props}
      />
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
      <h3
        className="scroll-m-20 text-2xl font-semibold tracking-tight mt-6 mb-3"
        {...props}
      />
  ),
  h4: (props: React.ComponentPropsWithoutRef<"h4">) => (
      <h4
        className="scroll-m-20 text-xl font-semibold tracking-tight mt-5 mb-2"
        {...props}
      />
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => (

      <div className="leading-7 mt-4 mb-4">{props.children}</div>
  ),
  blockquote: (props: React.ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote
        className="border-l-4 border-blue-400 pl-4 italic my-6 py-2"
        {...props}
      />
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code
      className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-sm font-mono"
      {...props}
    />
  ),
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) => (
    <CodeBlock {...props}>{children}</CodeBlock>
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-blue-600 hover:underline"
      {...props}
    />
  ),
  table: (props: React.ComponentPropsWithoutRef<"table">) => {
    const { children, className, ...rest } = props;
    return (
      <div className="my-4 overflow-auto rounded-md shadow-sm">
        <table
          className={`min-w-full divide-y divide-gray-200 dark:divide-gray-700 ${className ?? ""}`}
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },
  thead: (props: React.ComponentPropsWithoutRef<"thead">) => {
    const { children, className, ...rest } = props;
    return (
      <thead className={`bg-gray-50 dark:bg-gray-800 ${className ?? ""}`} {...rest}>
        {children}
      </thead>
    );
  },
  tbody: (props: React.ComponentPropsWithoutRef<"tbody">) => {
    const { children, className, ...rest } = props;
    return (
      <tbody className={`bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700 ${className ?? ""}`} {...rest}>
        {children}
      </tbody>
    );
  },
  tr: (props: React.ComponentPropsWithoutRef<"tr">) => {
    const { children, className, ...rest } = props;
    return (
      <tr className={`odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900 dark:even:bg-gray-800 ${className ?? ""}`} {...rest}>
        {children}
      </tr>
    );
  },
  th: (props: React.ComponentPropsWithoutRef<"th">) => {
    const { children, className, ...rest } = props;
    return (
      <th
        scope="col"
        className={`px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400 ${className ?? ""}`}
        {...rest}
      >
        {children}
      </th>
    );
  },
  td: (props: React.ComponentPropsWithoutRef<"td">) => {
    const { children, className, ...rest } = props;
    return (
      <td className={`px-3 py-2 align-top text-sm text-gray-700 dark:text-gray-300 ${className ?? ""}`} {...rest}>
        {children}
      </td>
    );
  },
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