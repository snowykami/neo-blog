import { getUserByUsername } from "@/api/user";
import { UserPage } from "@/components/user";
import { formatDisplayName } from "@/utils/common/username";
import { Metadata } from "next";

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const user = await getUserByUsername(params.username).then(r => r.data).catch(() => null);
  return {title: user ? `${formatDisplayName(user)}` : "error"};
}

export default function Page() {
  return (
    <div>
      <UserPage />
    </div>
  )
}
