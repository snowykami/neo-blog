"use client";

import { useAuth } from "@/contexts/auth-context";
import { useSiteInfo } from "@/contexts/site-info-context";
import { Post } from "@/models/post";
import { getPostUrl } from "@/utils/common/route";
import { formatDisplayName } from "@/utils/common/username";
import { CopyrightIcon, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";


function CopyrightCard({ post }:
  { post: Post }
) {
  const { siteInfo } = useSiteInfo();
  const copyrightT = useTranslations("Copyright");
  const { user } = useAuth();
  const postUrl = siteInfo.baseUrl + getPostUrl(post);

  return (
    <div className="bg-primary/10 rounded-lg 
    border border-primary/20 p-4 md:p-6">
      {/* 标题 */}
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
        <CopyrightIcon className="w-5 h-5 text-primary" />
        {copyrightT("copyright_notice")} - 《{post.title}》
      </h3>

      {/* 原文链接 */}
      <div className="mb-4">
        <a
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary/80 hover:text-primary break-all flex items-center gap-1"
        >
          {postUrl}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* 版权信息表格 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-gray-500 dark:text-gray-400 mb-1">
            {copyrightT("author")}
          </div>
          <div className="text-gray-800 text-lg font-semibold dark:text-gray-200">
            {formatDisplayName(post.user)}
          </div>
        </div>

        <div>
          <div className="text-gray-500 dark:text-gray-400 mb-1">
            {copyrightT("post_at")}
          </div>
          <div className="text-gray-800 text-lg font-semibold dark:text-gray-200">
            {post.createdAt ? new Date(post.createdAt).toLocaleDateString(user?.language) : "未知日期"}
          </div>
        </div>

        <div>
          <div className="text-gray-500 dark:text-gray-400 mb-1">
            {copyrightT("license")}
          </div>
          <div>
            <Link
              href={siteInfo.copyrightLink || "https://creativecommons.org/licenses/by/4.0/"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-primary/80 hover:text-primary"
            >
              {siteInfo.copyright || "CC BY-NC-SA 4.0"}
            </Link>
          </div>
        </div>

      </div>

      {/* 除非其他声明 */}
      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        {copyrightT("default_copyright", { license: siteInfo.copyright || "CC BY-NC-SA 4.0" })}
      </p>
    </div>
  );
}

export default CopyrightCard;