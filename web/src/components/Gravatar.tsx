"use client";

import React from "react";
import Image from "next/image";
import crypto from "crypto";

// 生成 Gravatar URL 的函数
function getGravatarUrl(email: string, size: number = 40, defaultType: string = "identicon"): string {
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
  size = 40,
  className = "",
  alt = "avatar",
  url,
  defaultType = "identicon"
}) => {
  // 如果有自定义URL，使用自定义URL
  if (url) {
    return (
      <Image
        src={url}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        alt={alt}
        referrerPolicy="no-referrer"
      />
    );
  }

  const gravatarUrl = getGravatarUrl(email, size * 10, defaultType);
  
  return (
    <Image
      src={gravatarUrl}
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
      alt={alt}
      referrerPolicy="no-referrer"
    />
  );
};

// 用户类型定义（如果还没有的话）
interface User {
  email?: string;
  displayName?: string;
  name?: string;
  avatarUrl?: string;
}

export function getGravatarByUser(user?: User, className: string = ""): React.ReactElement {
  if (!user) {
    return <GravatarAvatar email="" className={className} />;
  }
  return (
    <GravatarAvatar
      email={user.email || ""}
      size={40}
      className={className}
      alt={user.displayName || user.name || "User Avatar"}
      url={user.avatarUrl}
    />
  );
}

export default GravatarAvatar;