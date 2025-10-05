"use client";

import { ExternalLinkIcon, LinkIcon } from 'lucide-react';
import { LinkPreviewPopup } from './link-preview-popup';

interface EnhancedLinkProps extends React.ComponentPropsWithoutRef<"a"> {
  href: string;
  children: React.ReactNode;
}

export function EnhancedLink({ href, children, ...props }: EnhancedLinkProps) {
  // 判断是否为外链
  const isExternalLink = (() => {
    try {
      if (href.startsWith('/') || href.startsWith('#')) return false;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
      if (href.startsWith('//')) return true;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (typeof window === 'undefined') return true;
        const url = new URL(href);
        return url.hostname !== window.location.hostname;
      }
      return false;
    } catch {
      return false;
    }
  })();

  const linkContent = (
    <a
      className="inline-flex items-center gap-1 px-1 text-primary/80 hover:text-primary font-bold border-b-2 border-b-dashed border-primary/40 hover:border-primary/70 transition-colors duration-200"
      href={href}
      {...(isExternalLink && {
        target: '_blank',
        rel: 'noopener noreferrer'
      })}
      {...props}
    >
      {children}
      {isExternalLink ? (
        <ExternalLinkIcon className="w-4 h-4" />
      ) : (
        <LinkIcon className="w-4 h-4" />
      )}
    </a>
  );

  // 只有外链才显示预览
  if (isExternalLink) {
    return (
      <LinkPreviewPopup url={href}>
        {linkContent}
      </LinkPreviewPopup>
    );
  }

  return linkContent;
}