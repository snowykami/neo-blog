"use client"
import { getUserByUsername } from "@/api/user";
import { User } from "@/models/user";
import { useEffect, useState } from "react";
import { getGravatarByUser } from "../common/gravatar";

export function UserProfile({ user }: { user: User }) {
  return (
    <div className="flex">
      {getGravatarByUser({user,className: "rounded-full mr-4"})}
    </div>
  );
}