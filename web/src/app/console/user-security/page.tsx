import { UserSecurityPage } from "@/components/console/user-security";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('user_security.title'),
  };
}

export default function Page() {
  return <UserSecurityPage />;
}