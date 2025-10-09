export type SiteInfo = {
  colorSchemes: string[];
  defaultColorScheme: string;
  baseUrl?: string;
  metadata: {
    name: string;
    icon: string;
    description: string;
  };
  keywords?: string[];
  defaultCover: string | string[];
  owner: {
    name: string;
    description?: string;
    motto?: string;
    avatar?: string;
    gravatarEmail?: string;
  };
  postsPerPage: number;
  commentsPerPage: number;
  verifyCodeCoolDown: number;
  animationDurationSecond: number;
  copyright?: string;
  copyrightLink?: string;
  footer: {
    text?: string;
    links?: {
      text: string;
      href: string;
    }[];
  };
};


export const fallbackSiteInfo: SiteInfo = {
  colorSchemes: ["blue", "green", "orange", "red", "pink", "rose", "violet", "yellow"],
  defaultColorScheme: "blue",
  metadata: {
    name: "Fail to fetch name",
    icon: "https://cdn.liteyuki.org/snowykami/avatar_alpha.png",
    description: "Failed to fetch site info from server.",
  },
  keywords: ["blog", "neo-blog", "snowykami", "博客", "个人博客", "远野千束"],
  defaultCover: "https://cdn.liteyuki.org/blog/background.png",
  owner: {
    name: "Fail to fetch owner",
    description: "This is an error description.",
    motto: "This is a default motto.",
    avatar: "",
    gravatarEmail: "",
  },
  postsPerPage: 10,
  commentsPerPage: 10,
  verifyCodeCoolDown: 60,
  animationDurationSecond: 0.3,
  copyright: "CC BY-NC-SA 4.0",
  copyrightLink: "https://creativecommons.org/licenses/by/4.0/",
  footer: {
    text: "Default footer text",
    links: [
      { text: "Home", href: "/" },
      { text: "About", href: "/about" },
    ],
  },
};

export function getDefaultCoverRandomly(siteInfo: SiteInfo): string {
  if (Array.isArray(siteInfo.defaultCover)) {
    if (siteInfo.defaultCover.length === 0) return "";
    const idx = Math.floor(Math.random() * siteInfo.defaultCover.length);
    return siteInfo.defaultCover[idx];
  }
  return siteInfo.defaultCover;
}