"use client";

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from "react";
import type { User } from "@/models/user";
import { getLoginUser, userLogout } from "@/api/user";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getCommonT } from "@/utils/client/translations";

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
  const commonT = getCommonT();

  useEffect(() => {
    if (!user){
      getLoginUser().then(res => {
      setUser(res.data);
    }).catch(() => {
      setUser(null);
    });
    }
  }, [user]);

  const logout = useCallback(() => {
    userLogout().then(() => {
      toast.success(commonT("logout_success"));
      setUser(null);
    }).catch(() => {
      toast.error(commonT("logout_failed"));
    });
  }, [commonT]);
  const value = useMemo(() => ({ user, setUser, logout }), [user, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}