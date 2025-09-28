import { Dashboard } from "@/components/console/dashboard";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const routeT = await getTranslations('Route');
  return {
    title: routeT('console'),
  };
}

export default function Page() {
  return <Dashboard />;
}