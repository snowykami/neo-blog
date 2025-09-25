export interface User {
    id: number;
    username: string;
    nickname?: string;
    avatarUrl?: string;
    backgroundUrl?: string;
    preferredColor?: string;
    email: string;
    gender?: string;
    role: string;
    language?: string;
}

export enum Role {
  ADMIN = "admin",
  USER = "user",
  EDITOR = "editor",
}
