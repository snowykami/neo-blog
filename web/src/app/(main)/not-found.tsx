"use client";
import ErrorPage from "@/components/common/error-page";
import { getCommonT } from "@/utils/client/translations";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const commonT = getCommonT();;
  return <ErrorPage status={404} message={commonT("not_found")} />
}