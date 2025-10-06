'use client'
import { useTranslations } from "next-intl";
import React from "react";
import { toast } from "sonner";
import copyToClipboard from '@/lib/clipboard';

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (
    React.isValidElement(node) &&
    node.props &&
    typeof node.props === "object" &&
    "children" in node.props
  ) {
    return extractText(node.props.children as React.ReactNode);
  }
  return "";
}

export default function CodeBlock(props: React.ComponentPropsWithoutRef<"pre">) {
  const t = useTranslations('CodeBlock');
  let className: string | undefined = undefined;
  const child = props.children as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
  if (
    child &&
    typeof child === "object" &&
    "props" in child &&
    child.props.className
  ) {
    className = child.props.className as string | undefined;
  }
  let language = "";
  if (className) {
    const match = className.match(/language-(\w+)/);
    if (match) {
      language = match[1];
    }
  }
  let codeContent = "";
  if (
    child &&
    typeof child === "object" &&
    "props" in child
  ) {
    codeContent = extractText(child.props.children);
  }

  async function handleCopy() {
    try {
      const ok = await copyToClipboard(codeContent);
      if (ok) toast.success(t("copy_success"));
      else toast.error(t("copy_failed") || 'Copy failed');
    } catch (err) {
      console.error('copy failed', err);
      toast.error(t("copy_failed") || 'Copy failed');
    }
  }

  return (
    <div className="relative my-6 rounded-2xl overflow-hidden bg-[#f5f5f7] dark:bg-[#23272f] border border-gray-200 dark:border-gray-700 shadow-sm group">
      <div className="flex items-center h-8 px-3 bg-[#e5e7eb] dark:bg-[#23272f] border-b border-gray-200 dark:border-gray-700 relative">
        <span className="w-3.5 h-3.5 rounded-full bg-red-400 mr-2" />
        <span className="w-3.5 h-3.5 rounded-full bg-yellow-400 mr-2" />
        <span className="w-3.5 h-3.5 rounded-full bg-green-400" />
        {language && (
          <span className="absolute left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-gray-400 font-mono">
            {languageMap[language.toLowerCase()] || language}
          </span>
        )}
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2 flex space-x-2
                        opacity-100
                        group-hover:opacity-100
                        sm:opacity-0 sm:group-hover:opacity-100
                        transition-opacity"
        >
          <button
            type="button"
            className="px-2 py-1 rounded text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600"
            title={t("copy")}
            onClick={handleCopy}
            tabIndex={-1}
          >
            {t("copy")}
          </button>
        </div>
      </div>
      <pre
        className="overflow-x-auto bg-transparent text-sm text-gray-800 dark:text-gray-100"
        {...props}
      />
    </div>
  );
}

const languageMap: Record<string, string> = {
  "aiscript": "AiScript",
  "applescript": "AppleScript",
  // C 系列
  "c": "C",
  "cpp": "C++",
  // C#
  "cs": "C#",
  "csharp": "C#",
  // OCI
  "dockerfile": "Docker file",
  "es": "ECMAScript",
  // CSS/HTML/JSON/XML
  "css": "CSS",
  "html": "HTML",
  "json": "JSON",
  "xml": "XML",
  "dart": "Dart",
  // Go / Java / JavaScript
  "go": "Go",
  "java": "Java",
  "js": "JavaScript",
  "javascript": "JavaScript",
  "jsx": "JSX",
  // Kotlin
  "kt": "Kotlin",
  // Liteyuki Function
  "lyf": "Liteyuki Function",
  "lyfunction": "Liteyuki Function",
  // MCfunction
  "mcfunction": "Minecraft Function",
  // Markdown
  "md": "Markdown",
  "markdown": "Markdown",
  "mdx": "MDX",
  "nix": "Nix",
  // Conf
  "conf": "Configuration",
  "ini": "INI",
  "env": "Environment Variables",
  // LaTeX
  "latex": "LaTeX",
  "tex": "TeX",
  // Lua
  "lua": "Lua",
  // Makefile
  "makefile": "Makefile",
  // Python
  "py": "Python",
  "python": "Python",
  "pyi": "Python Interface",
  "pyx": "Cython",
  // Rust
  "rs": "Rust",
  "rust": "Rust",
  // TypeScript
  "ts": "TypeScript",
  "typescript": "TypeScript",
  "tsx": "TSX",
  "txt": "Text",
  // Shell 系列
  "sh": "Shell",
  "bash": "Bash",
  "zsh": "Zsh",
  // SQL
  "sql": "Structured Query Language",
  // YAML
  "yaml": "YAML",
  "yml": "YAML",
}