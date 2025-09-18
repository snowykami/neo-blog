"use client";

import React, { createContext, useContext, useState, useMemo } from "react";
import type { User } from "@/models/user";
import { userLogout } from "@/api/user";

type AuthContextValue = {
  user: User | null;
  setUser: (u: User | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);

  const logout = async () => {
    setUser(null);
    await userLogout();
  };
  const value = useMemo(() => ({ user, setUser, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}