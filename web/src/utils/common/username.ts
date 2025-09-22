import { User } from "@/models/user";

/**
 * Returns a single-character fallback avatar derived from a username.
 *
 * Rules:
 * - If `username` is falsy (empty string, null, or undefined), returns `"N"`.
 * - If the first character is an ASCII letter, returns the uppercase form of that character.
 * - Otherwise returns the first character as-is.
 *
 * @param username - The username to derive the avatar character from.
 * @returns A single character to use as a fallback avatar.
 *
 * @example
 * getFallbackAvatarFromUsername("alice"); // "A"
 * getFallbackAvatarFromUsername("1user"); // "1"
 * getFallbackAvatarFromUsername(""); // "N"
 */
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

/**
 * Returns the first-character avatar for a User, preferring nickname over username.
 *
 * Behavior:
 * - If `user.nickname` is present, derives the character from the nickname.
 * - Else if `user.username` is present, derives the character from the username.
 * - If neither is present, returns `"N"`.
 *
 * This function delegates the actual character selection logic to `getFallbackAvatarFromUsername`.
 *
 * @param user - The user object to extract the character from.
 * @returns A single character derived from the user's nickname or username, or `"N"` if neither is present.
 *
 * @example
 * getFirstCharFromUser({ nickname: "Bob", username: "bob123" }); // "B"
 * getFirstCharFromUser({ username: "1user" }); // "1"
 * getFirstCharFromUser({}); // "N"
 */
export function getFirstCharFromUser(user: User): string {
  if (user.nickname) {
    return getFallbackAvatarFromUsername(user.nickname);
  }
  if (user.username) {
    return getFallbackAvatarFromUsername(user.username);
  }
  return "N";
}

/**
 * Formats a user's display name.
 *
 * - If the user has a `nickname`, returns `${nickname}(${username})`.
 * - Otherwise returns the `username`.
 *
 * @param user - The user whose display name is to be formatted.
 * @returns The formatted display name. If `username` is missing, the returned value may be falsy.
 *
 * @example
 * formatDisplayName({ nickname: "Sam", username: "sam42" }); // "Sam(sam42)"
 * formatDisplayName({ username: "sam42" }); // "sam42"
 */
export function formatDisplayName(user: User) :string {
  return user?.nickname ? `${user.nickname}(${user.username})` : user.username;
}