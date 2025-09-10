"use client"
import { User } from "@/models/user";
import GravatarAvatar from "@/components/common/gravatar";

export function UserProfile({ user }: { user: User }) {
  return (
    <div className="flex">
      <GravatarAvatar email={user.email} size={120}/>
    </div>
  );
}