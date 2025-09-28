import { BaseResponse } from "@/models/resp"
import { User } from "@/models/user"
import axiosClient from "./client"
import getAuthHeaders from "@/utils/server/auth-headers"

export async function getLoginUserServer(): Promise<BaseResponse<User>> {
  const authHeaders = await getAuthHeaders()
  const res = await axiosClient.get<BaseResponse<User>>('/user/me', { headers: authHeaders })
  return res.data
}