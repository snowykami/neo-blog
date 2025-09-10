import { User } from "@/models/user";

export function UserPage({user}: {user: User}) {
  return <div>User: {user.username}</div>;
}