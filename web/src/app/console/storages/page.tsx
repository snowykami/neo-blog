import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('storages.title'),
  };
}

export default function Page() {
  return (<div><h1>存储管理</h1></div>);
}