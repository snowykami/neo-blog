"use client"
import { getUserByUsername } from "@/api/user";
import { UserPage } from "@/components/user";
import { User } from "@/models/user";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function Page() {
  const { username } = useParams() as { username: string };
  const [user,setUser] = useState<User | null>(null);

  useEffect(() => {
    getUserByUsername(username).then(res => {
        setUser(res.data);
    });
  },[username]);

  if (!user) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <UserPage user={user} />
    </div>
  )
}
