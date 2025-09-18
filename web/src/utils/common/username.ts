import { User } from "@/models/user";

export function getFallbackAvatarFromUsername(username: string): string {
  if (!username) {
    return "N";
  }
  const firstChar = username.charAt(0);
  if (/[a-zA-Z]/.test(firstChar)) {
    return firstChar.toUpperCase();
  }
  return firstChar;
}

export function getFirstCharFromUser(user: User): string {
  if (user.nickname) {
    return getFallbackAvatarFromUsername(user.nickname);
  }
  if (user.username) {
    return getFallbackAvatarFromUsername(user.username);
  }
  return "N";
}