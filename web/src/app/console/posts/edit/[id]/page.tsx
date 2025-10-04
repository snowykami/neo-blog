import { getPostByIdServer } from "@/api/post.server";
import { PostEdit } from "@/components/console/post-manage/post-edit";
import { getTranslations } from "next-intl/server";


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const consoleT = await getTranslations('Console');
  const { id } = await params;
  const post = await getPostByIdServer({id, type: "draft"}).then(r => r.data).catch(() => null);
  return {
    title: `${consoleT('post_edit.title')} ${post?.title}`,
  };
}


export default function EditPostPage() {
  return (
    <PostEdit />
  );
}