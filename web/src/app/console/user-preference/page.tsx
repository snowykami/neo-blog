import { UserPreferencePage } from "@/components/console/user-preference";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const consoleT = await getTranslations('Console');
  return {
    title: consoleT('user_preference.title'),
  };
}

export default function Page() {
  return <UserPreferencePage />
}