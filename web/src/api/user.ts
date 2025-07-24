import axiosClient from "./client";
import type { OidcConfig } from "@/models/oidc-config";
import type { User } from "@/models/user";
import type { BaseResponse } from "@/models/resp";

export interface LoginRequest {
    username: string;
    password: string;
    rememberMe?: boolean;  // 可以轻松添加新字段
    captcha?: string;
}

export interface RegisterRequest {
    username: string;
    password: string;
    nickname: string;
    email: string;
    verificationCode?: string;
}

export async function userLogin(
    data: LoginRequest
): Promise<BaseResponse<{ token: string; user: User }>> {
    const res = await axiosClient.post<BaseResponse<{ token: string; user: User }>>(
        "/user/login",
        data 
    );
    return res.data;
}

export async function userRegister(
    data: RegisterRequest
): Promise<BaseResponse<{ token: string; user: User }>> {
    const res = await axiosClient.post<BaseResponse<{ token: string; user: User }>>(
        "/user/register",
        data
    );
    return res.data;
}

export async function ListOidcConfigs(): Promise<BaseResponse<OidcConfig[]>> {
    const res = await axiosClient.get<BaseResponse<OidcConfig[]>>(
        "/user/oidc/list"
    );
    return res.data;
}