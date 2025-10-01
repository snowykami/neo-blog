import { FileManage } from "@/components/console/file-manage";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('files.title'),
  };
}

export default function Page() {
  return (
    <FileManage />
  )
}