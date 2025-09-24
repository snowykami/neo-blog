import { BaseResponse } from "@/models/resp"
import axiosClient from "./client"

export interface DashboardResp {
  totalUsers: number
  totalPosts: number
  totalComments: number
  totalViews: number
} 

export async function getDashboard(): Promise<BaseResponse<DashboardResp>> {
  const res = await axiosClient.get<BaseResponse<DashboardResp>>('/admin/dashboard')
  return res.data
}