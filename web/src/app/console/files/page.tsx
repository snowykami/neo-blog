import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('files.title'),
  };
}

export default function Page() {
  return <div>文件管理</div>;
}