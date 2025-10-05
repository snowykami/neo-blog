"use client";
import ErrorPage from "@/components/common/error-page";
import { useTranslations } from "next-intl";

export default function Forbidden() {
  const commonT = useTranslations("Common");
  return <ErrorPage status={403} message={commonT("forbidden")} />
}