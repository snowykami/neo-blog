"use client"

import { User } from "@/models/user";
import { UserHeader } from "./user-header";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getUserByUsername } from "@/api/user";

export function UserPage() {
  const { username } = useParams() as { username: string };
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    getUserByUsername(username).then(res => {
      setUser(res.data);
    });
  }, [username]);

  if (!user) {
    return <div>Loading...</div>;
  }
  return <div>
    <UserHeader user={user} />
  </div>;
}
