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


export interface RegisterRequest {
  username: string
  password: string
  nickname: string
  email: string
  verificationCode?: string
}
