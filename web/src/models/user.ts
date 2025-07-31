export interface User {
    id: number;
    username: string;
    nickname: string;
    avatarUrl: string;
    email: string;
    gender: string;
    role: string;
    language: string;
}


export interface LoginRequest {
  username: string
  password: string
  rememberMe?: boolean // 可以轻松添加新字段
  captcha?: string
}

export interface RegisterRequest {
  username: string
  password: string
  nickname: string
  email: string
  verificationCode?: string
}
