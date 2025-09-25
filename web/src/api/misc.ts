import { BaseResponse } from "@/models/resp";
import axiosClient from "./client";
import type { SiteInfo } from "@/contexts/site-info-context";


export async function getSiteInfo(): Promise<BaseResponse<SiteInfo>>{
  const res = await axiosClient.get<BaseResponse<SiteInfo>>('/misc/site-info');
  return res.data;
}