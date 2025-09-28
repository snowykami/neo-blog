import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('users.title'),
  };
}


export default function Page() {
  return <div>用户管理</div>;
}