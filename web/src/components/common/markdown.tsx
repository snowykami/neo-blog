
import { MDXRemote, MDXRemoteProps } from "next-mdx-remote-client/rsc";
import { Suspense } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css"; // 你可以换成喜欢的主题
import CodeBlock from "@/components/common/markdown-codeblock";

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
        <p
            className="leading-7 mt-4 mb-4"
            {...props}
        />
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
};

export function RenderMarkdown(props: Omit<MDXRemoteProps, "components">) {
    return (
        <Suspense fallback={<div>加载中...</div>}>
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
        <Suspense fallback={<div>加载中...</div>}>
            <MDXRemote {...props} components={markdownComponents} />
        </Suspense>
    );
}