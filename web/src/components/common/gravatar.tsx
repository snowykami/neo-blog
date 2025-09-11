"use client";

import React from "react";
import Image from "next/image";
import crypto from "crypto";

// 生成 Gravatar URL 的函数
function getGravatarUrl(email: string, size: number = 200, defaultType: string = "identicon"): string {
  const hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultType}`;
}

interface GravatarAvatarProps {
  email: string;
  size?: number;
  className?: string;
  alt?: string;
  url?: string;
  defaultType?: 'mm' | 'identicon' | 'monsterid' | 'wavatar' | 'retro' | 'robohash' | 'blank';
}

const GravatarAvatar: React.FC<GravatarAvatarProps> = ({
  email,
  size = 200,
  className = "",
  alt = "avatar",
  url,
  defaultType = "identicon"
}) => {
  // 把尺寸控制交给父组件的 wrapper（父组件通过 tailwind 的 w-.. h-.. 控制）
  const gravatarUrl = url && url.trim() !== "" ? url : getGravatarUrl(email, size , defaultType);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src={gravatarUrl}
        alt={alt}
        fill
        sizes="(max-width: 640px) 64px, 200px"
        className="rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

// 用户类型定义（如果还没有的话）
interface User {
  email?: string;
  displayName?: string;
  name?: string;
  avatarUrl?: string;
}

export function getGravatarByUser({user, className="", size=640}:{user?: User, className?: string, size?: number}): React.ReactElement {
  if (!user) {
    return <GravatarAvatar email="" className={className} />;
  }
  return (
    <GravatarAvatar
      email={user.email || ""}
      size={size}
      className={className}
      alt={user.displayName || user.name || "User Avatar"}
      url={user.avatarUrl}
    />
  );
}

export default GravatarAvatar;
