"use client";

import { useEffect } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import copyToClipboard from "@/lib/clipboard";
import { toast } from "sonner";
import { languageMap } from "@/utils/common/post-render";
import { useTranslations } from "next-intl";
import { LinkPreviewPopup } from "@/components/common/link-preview-popup";

/**
 * HtmlEnhancer
 * - containerId: 传入渲染原始 HTML 的父容器 id（backend 存的原始 HTML 放在这个容器内）
 * 功能：
 * - 把 <pre><code class="language-..."> 包装成带工具栏和复制按钮的样式（与 markdown-codeblock 保持一致）
 * - 给外链添加 target/rel，并添加样式类
 * - 给 img/ul/ol/li/hr/inline code 添加样式类
 * - 使用 MutationObserver 处理后续动态注入的内容
 */

declare global {
  interface HTMLElement {
    __enhanced?: boolean;
  }
  interface HTMLAnchorElement {
    __enhanced?: boolean;
  }
  interface Element {
    __enhanced?: boolean;
  }
}

export default function HtmlEnhancer({ containerId }: { containerId: string }) {
  const t = useTranslations("CodeBlock");
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const wrapCodeBlock = (pre: HTMLElement) => {
      if (pre.__enhanced) return;
      pre.__enhanced = true;

      // 找到 code 和语言
      const codeEl = pre.querySelector("code");
      const langMatch = codeEl?.className?.match?.(/language-([\w-]+)/);
      const lang = langMatch ? langMatch[1] : "";

      // 创建 wrapper 与 toolbar（复用你 markdown-codeblock 的类）
      const wrapper = document.createElement("div");
      wrapper.className =
        "relative my-6 rounded-2xl overflow-hidden bg-[#f5f5f7] dark:bg-[#23272f] border border-gray-200 dark:border-gray-700 shadow-sm group";

      const toolbar = document.createElement("div");
      toolbar.className =
        "flex items-center h-8 px-3 bg-[#e5e7eb] dark:bg-[#23272f] border-b border-gray-200 dark:border-gray-700 relative";

      const leftDots = document.createElement("div");
      leftDots.className = "flex items-center";
      const dot = (color: string) => {
        const d = document.createElement("span");
        d.className = `w-3.5 h-3.5 rounded-full ${color} mr-2`;
        return d;
      };
      leftDots.appendChild(dot("bg-red-400"));
      leftDots.appendChild(dot("bg-yellow-400"));
      leftDots.appendChild(dot("bg-green-400"));
      toolbar.appendChild(leftDots);

      if (lang) {
        const langSpan = document.createElement("span");
        langSpan.className =
          "absolute left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-gray-400 font-mono";
        langSpan.textContent = languageMap[lang.toLowerCase()] || lang;
        toolbar.appendChild(langSpan);
      }

      const rightBox = document.createElement("div");
      rightBox.className =
        "absolute right-3 top-1/2 -translate-y-1/2 flex space-x-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "px-2 py-1 rounded text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600";
      btn.textContent = t("copy");
      rightBox.appendChild(btn);
      toolbar.appendChild(rightBox);

      // move pre into wrapper
      const parent = pre.parentNode;
      if (!parent) return;
      parent.replaceChild(wrapper, pre);
      wrapper.appendChild(toolbar);
      wrapper.appendChild(pre);

      // style pre similar to markdown-codeblock
      pre.classList.add("overflow-x-auto", "bg-transparent", "text-sm", "p-4", "m-0", "rounded-t-none", "text-gray-800", "dark:text-gray-100");
      pre.style.margin = "0";

      // copy handler
      btn.addEventListener("click", async () => {
        try {
          const text = pre.innerText;
          const ok = await copyToClipboard(text);
          if (ok) {
            toast.success(t("copy_success"));
            btn.textContent = t("copied");
            setTimeout(() => (btn.textContent = t("copy")), 1200);
          } else {
            toast.error(t("copy_failed"));
            btn.textContent = t("failed");
            setTimeout(() => (btn.textContent = t("copy")), 1200);
          }
        } catch (e) {
          console.error(e);
          toast.error(t("copy_failed"));
          btn.textContent = t("failed");
          setTimeout(() => (btn.textContent = t("copy")), 1200);
        }
      });
    };

    const enhanceLink = (a: HTMLAnchorElement) => {
      if (a.__enhanced) return;
      a.__enhanced = true;
      const href = a.getAttribute("href") || "";
      const isExternal =
        href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");

      // 通用类名（和 EnhancedLink 保持一致）
      const baseClasses = [
        "inline-flex",
        "items-center",
        "gap-1",
        "px-1",
        "text-primary/80",
        "hover:text-primary",
        "font-bold",
        "underline-offset-4",
        "transition-colors",
        "duration-200",
      ].join(" ");

      if (!isExternal) {
        // 内链：直接添加类并保留原有属性
        a.classList.add(...baseClasses.split(" "));
        return;
      }

      // 外链：用 React 的 LinkPreviewPopup 包裹渲染一个新的 anchor（保留原始 innerHTML、类名）
      try {
        const wrapper = document.createElement("span");
        // 保留原始 className 并追加 baseClasses（避免重复）
        const originalClass = a.getAttribute("class") || "";
        // replace the original anchor with the wrapper; React will render the new interactive UI into wrapper
        a.replaceWith(wrapper);

        const CombinedAnchor = () => (
          <LinkPreviewPopup url={href}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={(originalClass + " " + baseClasses).trim()}
              // 使用 dangerouslySetInnerHTML 保留原有节点内部结构（icon/text 等）
              dangerouslySetInnerHTML={{ __html: a.innerHTML }}
            />
          </LinkPreviewPopup>
        );

        const root = createRoot(wrapper);
        root.render(<CombinedAnchor />);
      } catch (e) {
        // 回退：直接设置 target/rel 与类名
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        a.classList.add(...baseClasses.split(" "));
      }
    };

    const enhanceImage = (img: HTMLImageElement) => {
      if (img.__enhanced) return;
      img.__enhanced = true;
      img.classList.add("my-4", "rounded-lg", "border", "border-gray-200", "dark:border-gray-700", "shadow-sm");
    };

    const enhanceInlineCode = (code: HTMLElement) => {
      if (code.__enhanced) return;
      code.__enhanced = true;
      // skip code blocks inside pre (they are handled separately)
      if (code.closest("pre")) return;
      code.classList.add("bg-gray-100", "dark:bg-gray-800", "rounded", "px-1", "py-0.5", "text-sm", "font-mono");
    };

    const enhanceList = (el: Element) => {
      if (el.__enhanced) return;
      el.__enhanced = true;
      if (el.tagName.toLowerCase() === "ul") el.classList.add("my-4", "ml-6", "list-disc");
      if (el.tagName.toLowerCase() === "ol") el.classList.add("my-4", "ml-6", "list-decimal");
      if (el.tagName.toLowerCase() === "li") el.classList.add("my-2");
    };

    const enhanceHr = (hr: HTMLElement) => {
      if (hr.__enhanced) return;
      hr.__enhanced = true;
      hr.classList.add("my-6", "border-gray-200", "dark:border-gray-700");
    };

    const scanAndEnhance = (root: HTMLElement | Document = container) => {
      // code blocks
      root.querySelectorAll("pre").forEach((p) => wrapCodeBlock(p as HTMLElement));
      // links
      root.querySelectorAll("a").forEach((a) => enhanceLink(a as HTMLAnchorElement));
      // images
      root.querySelectorAll("img").forEach((i) => enhanceImage(i as HTMLImageElement));
      // inline code
      root.querySelectorAll("code").forEach((c) => enhanceInlineCode(c as HTMLElement));
      // lists
      root.querySelectorAll("ul, ol, li").forEach((el) => enhanceList(el));
      // hr
      root.querySelectorAll("hr").forEach((hr) => enhanceHr(hr as HTMLElement));
    };

    // initial
    scanAndEnhance(container);

    // observe dynamic changes
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            // 如果是 wrapper 容器 / fragment，scan inside
            if (node.tagName?.toLowerCase() === "pre") wrapCodeBlock(node as HTMLElement);
            else scanAndEnhance(node);
          });
        } else if (m.type === "attributes") {
          // 当 class/innerHTML 变化时再扫描
          const target = m.target as HTMLElement;
          if (target) scanAndEnhance(target);
        }
      }
    });

    mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });

    return () => mo.disconnect();
  }, [containerId]);

  return null;
}