import { BaseResponse } from "@/models/resp";
import axiosClient from "./client";
import { User } from "@/models/user";
import { Category } from "@/models/category";
import { SiteInfo } from "@/utils/common/siteinfo";


export async function getSiteInfo(): Promise<BaseResponse<SiteInfo>> {
  const res = await axiosClient.get<BaseResponse<SiteInfo>>('/misc/site-info');
  return res.data;
}

export async function setSiteInfo(info: SiteInfo): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/misc/site-info', info);
  return res.data;
}

export async function getPublicConfig<T extends Record<string, unknown>>(
  defaults: T
): Promise<BaseResponse<T>> {
  const keys = Object.keys(defaults);
  const res = await axiosClient.get<BaseResponse<Partial<T>>>('/misc/public-config', {
    params: { keys: keys.join(',') }
  });
  const result = { ...defaults } as T;

  if (res.data.data) {
    for (const key in res.data.data) {
      if (res.data.data[key] !== undefined) {
        (result)[key] = res.data.data[key];
      }
    }
  }
  return {
    ...res.data,
    data: result
  } as BaseResponse<T>;
}

export async function setPublicConfig<T extends Record<string, unknown>>(
  config: T
): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/misc/public-config', config);
  return res.data;
}

type SitemapData = {
  baseUrl: string;
  posts: {
    createdAt: string;
    updatedAt: string;
    slug: string;
    id: number;
  }[]
  editors: {
    id: number;
    username: string;
    updatedAt: string;
  }[]
  categories: {
    id: number;
    slug: string;
    updatedAt: string;
  }[]
  labels: {
    id: number;
    slug: string;
    updatedAt: string;
    name: string;
  }[]
}

export async function getSitemapData(): Promise<BaseResponse<SitemapData>> {
  const res = await axiosClient.get<BaseResponse<SitemapData>>('/misc/sitemap-data');
  return res.data;
}

type RssPostItem = {
  id: number;
  title: string;
  slug: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: User;
  category: Category | null;
  cover: string;
}

type RssData = {
  title: string;
  description: string;
  siteUrl: string; // 网站链接
  feedUrl: string; // RSS 链接
  // 次要信息
  author: string;
  copyright: string;
  imageUrl: string;
  language: string;
  pudDate: string;
  // 额外字段
  postDefaultCover: string;
  // 增量数据
  posts: RssPostItem[];
}

export async function getRssData(): Promise<BaseResponse<RssData>> {
  const res = await axiosClient.get<BaseResponse<RssData>>('/misc/rss-data');
  return res.data;
}