"use client"

import React from "react";
import { Edit, Eye } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useNav } from "@/contexts/nav-context";
import { Post } from "@/models/post";
import { useRouter } from "next/navigation";
import { getPostEditUrl } from "@/utils/common/route";

export function PostToolbar({ post, onPreviewChange }: { post: Post; onPreviewChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const { setSolidNav, setNavStyle, navClassName } = useNav();
  const [prevNavClassName, setPrevNavClassName] = React.useState<string>("");

  const handlePreviewDown = () => {
    setPrevNavClassName(navClassName);
    setSolidNav();
    onPreviewChange(true);
  };
  const handlePreviewUp = () => {
    setNavStyle(prevNavClassName);
    onPreviewChange(false);
  };

  return (
    <div className="absolute inset-x-0 flex items-center justify-between px-4 md:px-10" style={{ top: '-2.5rem' }}>
      <div className="flex items-center">
        {user && user.id === post.user.id && (
          <button
            onClick={() => router.push(getPostEditUrl(post))}
            className="mr-2 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white border border-white/30 rounded-full p-2 shadow-lg transition-all duration-200"
            aria-label="Quick edit post"
          >
            <Edit className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button
          className="bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white border border-white/30 rounded-full p-2 shadow-lg transition-all duration-300 hover:scale-110"
          onMouseDown={handlePreviewDown}
          onMouseUp={handlePreviewUp}
          onMouseLeave={handlePreviewUp}
          onTouchStart={handlePreviewDown}
          onTouchEnd={handlePreviewUp}
          aria-label="Preview cover image"
        >
          <Eye className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default PostToolbar;
