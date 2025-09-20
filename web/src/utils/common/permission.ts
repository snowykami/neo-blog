import { Role, User } from "@/models/user";

export function isAdmin({ user }: { user: User}) {
  return user.role === Role.ADMIN;
}

export function isEditor({ user }: { user: User}) {
  return user.role === Role.EDITOR || user.role === Role.ADMIN;
}