"use client";
import ErrorPage from "@/components/common/error-page";
import { getCommonT } from "@/utils/client/translations";
import { useTranslations } from "next-intl";

export default function Forbidden() {
  const commonT = getCommonT();
  return <ErrorPage status={403} message={commonT("forbidden")} />
}