import { User } from "@/models/user";
import { UserHeader } from "./user-header";

export function UserPage({user}: {user: User}) {
  return <div>
    <UserHeader user={user} />
  </div>;
}
