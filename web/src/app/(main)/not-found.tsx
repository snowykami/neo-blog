"use client";
import ErrorPage from "@/components/common/error-page";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const commonT = useTranslations("Common");
  return <ErrorPage status={404} message={commonT("not_found")} />
}