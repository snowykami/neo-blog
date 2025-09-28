import { PostManage } from "@/components/console/post-manage";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('posts.title'),
  };
}

export default function Page() {
  return <PostManage />;
}