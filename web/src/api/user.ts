import axiosInstance from "./client";

import type { OidcConfig } from "@/models/oidc-config";
import type { User } from "@/models/user";
import type { BaseResponse } from "@/models/resp";

export function userLogin(
    username: string,
    password: string
): Promise<BaseResponse<{ token: string; user: User }>> {
    return axiosInstance
        .post<BaseResponse<{ token: string; user: User }>>(
            "/user/login",
            {
                username,
                password,
            }
        )
        .then(res => res.data);
}

export function userRegister(
    username: string,
    password: string,
    nickname: string,
    email: string,
    verificationCode?: string
): Promise<BaseResponse<{ token: string; user: User }>> {
    return axiosInstance
        .post<BaseResponse<{ token: string; user: User }>>(
            "/user/register",
            {
                username,
                password,
                nickname,
                email,
                verificationCode,
            }
        )
        .then(res => res.data);
}

export function ListOidcConfigs(): Promise<BaseResponse<{ oidcConfigs: OidcConfig[] }>> {
    return axiosInstance
        .get<BaseResponse<{ oidcConfigs: OidcConfig[] }>>("/user/oidc/list")
        .then(res => {
            const data = res.data;
            if ('configs' in data) {
                return {
                    ...data,
                    oidcConfigs: data.configs,
                };
            }
            return data;
        });
}